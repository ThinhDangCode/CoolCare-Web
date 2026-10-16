import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { CalendarIcon, ChevronDownIcon, PageHeader } from '../../../shared/components/AdminUi.jsx'
import MonthYearPicker from '../../payments/components/MonthYearPicker.jsx'
import layersIcon from '../assets/layers.svg'
import areaIcon from '../assets/map-pin.svg'
import resetIcon from '../assets/reset.svg'
import { getRevenue } from '../api/revenueApi.js'
import RevenueTrend from '../components/RevenueTrend.jsx'
import {
  defaultRevenueFilters,
  readRevenueFilters,
  revenueFilterError,
  writeRevenueFilters,
} from '../revenueFilters.js'
import {
  formatRevenueAmount,
  formatRevenuePercent,
  revenuePeriodLabel,
} from '../revenuePresentation.js'
import './revenue.css'

const groupColors = ['var(--orange)', '#994700', '#4f6073', '#03b67e', '#8c7263', '#64748b']

function GroupRevenueCard({ title, description, rows, area = false }) {
  const { t } = useUiPreferences()
  return (
    <section className="revenue-card revenue-breakdown-card" aria-label={title}>
      <div className="revenue-card-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {rows.length ? (
        <ul className="revenue-group-list">
          {rows.map((row, index) => (
            <li key={row.id} style={{ '--group-color': groupColors[index % groupColors.length] }}>
              <div className="revenue-group-heading">
                {area ? (
                  <img src={areaIcon} alt="" />
                ) : (
                  <span className="revenue-service-dot" aria-hidden="true" />
                )}
                <strong>{row.name}</strong>
                <span>{formatRevenuePercent(row.sharePercent)}</span>
              </div>
              <div className="revenue-group-track" aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(100, row.sharePercent ?? 0))}%` }} />
              </div>
              <p>
                {formatRevenueAmount(row.amount)}
                {row.amount === null && (
                  <small>{t('Known partial amount: {amount}', { amount: formatRevenueAmount(row.knownAmount) })}</small>
                )}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="revenue-group-empty">{t('No revenue recorded for this period and filters.')}</p>
      )}
    </section>
  )
}

function FilterSelect({ label, icon, value, onChange, options, allLabel }) {
  const { t } = useUiPreferences()
  const hasSelection = value === 'ALL' || options.some((option) => option.id === value)
  return (
    <label className="revenue-filter">
      <span>{label}</span>
      <span className="revenue-filter-select">
        <img src={icon} alt="" />
        <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
          <option value="ALL">{allLabel}</option>
          {!hasSelection && <option value={value}>{t('Selected {label}', { label: label.toLowerCase() })}</option>}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <ChevronDownIcon />
      </span>
    </label>
  )
}

export default function RevenuePage() {
  const { token, clearSession } = useAuth()
  const { t, locale } = useUiPreferences()
  const [params, setParams] = useSearchParams()
  const [defaults] = useState(defaultRevenueFilters)
  const filters = readRevenueFilters(params, defaults)
  const latestFiltersRef = useRef(filters)
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '' })
  const validation = revenueFilterError(filters)
  const query = writeRevenueFilters(filters).toString()
  const requestKey = `${query}:${refresh}:${token}`
  const loading = !validation && response.key !== requestKey
  const data = !validation && !loading && !response.error ? response.data : null
  const error = response.key === requestKey ? response.error : ''
  const options = response.data?.options ?? { services: [], areas: [] }

  useLayoutEffect(() => {
    latestFiltersRef.current = readRevenueFilters(params, defaults)
  }, [params, defaults])

  const updateFilters = useCallback(
    (values) => {
      const next = { ...latestFiltersRef.current, ...values }
      latestFiltersRef.current = next
      setParams(writeRevenueFilters(next), { replace: true })
    },
    [setParams]
  )

  useEffect(() => {
    if (validation) return
    const controller = new AbortController()
    getRevenue(query, token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setResponse({ key: requestKey, data: result, error: '' })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({ key: requestKey, data: null, error: err.message })
        if (err.status === 401) clearSession()
      })
    return () => controller.abort()
  }, [query, requestKey, validation, token, clearSession])

  const reload = () => setRefresh((value) => value + 1)
  const summary = data?.summary
  const comparison = summary?.comparisonPercent
  // Unclassified labor remains visible in the service breakdown; it does not make revenue incomplete.
  const warnings = data?.warnings.filter((warning) => warning.code !== 'UNCLASSIFIED_LABOR') ?? []

  return (
    <main className="revenue-page">
      <PageHeader
        title={t('Revenue')}
        subtitle={t('Platform commission overview')}
        onRefresh={reload}
        refreshing={loading}
      />
      <div className="revenue-content">
        <section className="revenue-card revenue-toolbar" aria-label={t('Revenue filters')}>
          <p className="revenue-breadcrumb">{t('CoolCare Admin · Finance · Revenue')}</p>
          <div className="revenue-filters">
            <label className="revenue-filter">
              <span>{t('Report period')}</span>
              <span className="revenue-filter-select">
                <CalendarIcon />
                <select
                  value={filters.period}
                  onChange={(event) => updateFilters({ period: event.currentTarget.value })}
                >
                  <option value="MONTH">{t('Month')}</option>
                  <option value="QUARTER">{t('Quarter')}</option>
                  <option value="YEAR">{t('Year')}</option>
                </select>
                <ChevronDownIcon />
              </span>
            </label>
            {filters.period === 'MONTH' ? (
              <MonthYearPicker
                year={filters.year}
                month={filters.month}
                onChange={({ year, month }) =>
                  updateFilters({ year, month, quarter: String(Math.ceil(Number(month) / 3)) })
                }
              />
            ) : (
              <div className="revenue-year-period">
                {filters.period === 'QUARTER' && (
                  <label className="revenue-filter">
                    <span>{t('Quarter')}</span>
                    <span className="revenue-filter-select revenue-quarter-select">
                      <select
                        value={filters.quarter}
                        onChange={(event) => updateFilters({ quarter: event.currentTarget.value })}
                      >
                        <option value="1">Q1</option>
                        <option value="2">Q2</option>
                        <option value="3">Q3</option>
                        <option value="4">Q4</option>
                      </select>
                      <ChevronDownIcon />
                    </span>
                  </label>
                )}
                <label className="revenue-filter">
                  <span>{t('Year')}</span>
                  <input
                    type="number"
                    min="1900"
                    max="9999"
                    step="1"
                    required
                    value={filters.year}
                    aria-invalid={Boolean(validation)}
                    onChange={(event) => updateFilters({ year: event.currentTarget.value })}
                  />
                </label>
              </div>
            )}
            <FilterSelect
              label={t('Service')}
              icon={layersIcon}
              value={filters.service}
              onChange={(service) => updateFilters({ service })}
              options={options.services}
              allLabel={t('All Services')}
            />
            <FilterSelect
              label={t('Service area')}
              icon={areaIcon}
              value={filters.area}
              onChange={(area) => updateFilters({ area })}
              options={options.areas}
              allLabel={t('All Service Areas')}
            />
            <button
              type="button"
              className="revenue-reset"
              onClick={() => {
                const next = defaultRevenueFilters()
                latestFiltersRef.current = next
                setParams(writeRevenueFilters(next), { replace: true })
              }}
            >
              <img src={resetIcon} alt="" />
              {t('Reset')}
            </button>
          </div>
          <p className="revenue-filter-basis">
            {t('Settled payments · Commission only · Vietnam time (UTC+7)')}
            {filters.service !== 'ALL' && ` · ${t('Selected service allocation')}`}
          </p>
        </section>

        {validation ? (
          <div className="revenue-state error" role="alert">
            <strong>{t('Check the report period')}</strong>
            <p>{t(validation)}</p>
          </div>
        ) : loading ? (
          <div className="revenue-state" role="status">
            <span className="revenue-loading-mark" aria-hidden="true" />
            {t('Loading revenue…')}
          </div>
        ) : error ? (
          <div className="revenue-state error" role="alert">
            <strong>{t('Unable to load revenue')}</strong>
            <p>{error}</p>
            <button type="button" onClick={reload}>
              {t('Try again')}
            </button>
          </div>
        ) : data ? (
          <>
            {warnings.length > 0 && (
              <aside className="revenue-warning" aria-label={t('Revenue data warnings')}>
                <strong>{t('Some revenue data needs attention')}</strong>
                <ul>
                  {warnings.map((warning) => (
                    <li key={warning.code}>{warning.message}</li>
                  ))}
                </ul>
                <p>{t('— means unavailable. Known partial amounts are shown separately.')}</p>
              </aside>
            )}
            {summary.paymentCount === 0 && (
              <p className="revenue-empty-notice" role="status">
                {t('No qualifying payments matched this period and filters. The previous period remains visible for comparison.')}
              </p>
            )}
            <div className="revenue-kpis">
              <section className="revenue-card revenue-kpi" aria-label={t('Total Revenue')}>
                <div>
                  <h2>{t('Total Revenue')}</h2>
                  {comparison !== null && (
                    <span className={`revenue-badge ${comparison < 0 ? 'negative' : ''}`}>
                      {formatRevenuePercent(comparison, true)}
                    </span>
                  )}
                </div>
                <strong>{formatRevenueAmount(summary.totalRevenue)}</strong>
                <p>
                  {summary.totalRevenue === null
                    ? t('Known partial amount: {amount}', { amount: formatRevenueAmount(summary.knownRevenue) })
                    : `${summary.paymentCount.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')} ${t(summary.paymentCount === 1 ? 'qualifying payment' : 'qualifying payments')} · ${revenuePeriodLabel(data.period)}`}
                </p>
                <small>
                  {t(comparison === null ? 'Previous total is not comparable' : 'vs. previous period')}
                </small>
              </section>
              <section className="revenue-card revenue-kpi" aria-label={t('Average Revenue per Month')}>
                <div>
                  <h2>{t('Avg. Revenue / Month')}</h2>
                </div>
                <strong>{formatRevenueAmount(summary.averageMonthlyRevenue)}</strong>
                <p>
                  {t('Across {count} calendar {unit}', { count: data.period.monthCount, unit: t(data.period.monthCount === 1 ? 'month' : 'months') })}
                </p>
                <small>{t('Commission total ÷ months in period')}</small>
              </section>
              <section className="revenue-card revenue-kpi" aria-label={t('Top Service Share')}>
                <div>
                  <h2>{t('Top Service Share')}</h2>
                  {summary.topService && (
                    <span className="revenue-badge">
                      {formatRevenuePercent(summary.topService.sharePercent)}
                    </span>
                  )}
                </div>
                <strong>{formatRevenueAmount(summary.topService?.amount)}</strong>
                <p>
                  {summary.topService?.name ??
                    (summary.totalRevenue === null
                      ? t('Service revenue unavailable')
                      : t('No service revenue recorded'))}
                </p>
                <small>{t('Allocated platform commission')}</small>
              </section>
              <section className="revenue-card revenue-kpi" aria-label={t('Top Area Share')}>
                <div>
                  <h2>{t('Top Area Share')}</h2>
                  {summary.topArea && (
                    <span className="revenue-badge">
                      {formatRevenuePercent(summary.topArea.sharePercent)}
                    </span>
                  )}
                </div>
                <strong>{formatRevenueAmount(summary.topArea?.amount)}</strong>
                <p>
                  {summary.topArea?.name ??
                    (summary.totalRevenue === null
                      ? t('Area revenue unavailable')
                      : t('No area revenue recorded'))}
                </p>
                <small>{t('Service address city')}</small>
              </section>
            </div>
            <RevenueTrend rows={data.trend} period={data.period} />
            <div className="revenue-breakdowns">
              <GroupRevenueCard
                title={t('Revenue by Service')}
                description={t('Platform commission allocated by service contribution')}
                rows={data.services}
              />
              <GroupRevenueCard
                title={t('Revenue by Area')}
                description={t('Service address city distribution')}
                rows={data.areas}
                area
              />
            </div>
          </>
        ) : null}
      </div>
    </main>
  )
}
