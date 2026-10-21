import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../../shared/components/AdminUi.jsx'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { CustomerDateForm } from '../../customer-statistics/components/CustomerUi.jsx'
import '../../customer-statistics/pages/customer-statistics.css'
import {
  presetReportRange,
  reportDate,
  reportRangePreset,
  reportRangeQuery,
  reportTimestamp,
} from '../../reports/reportPresentation.js'
import { getTechnicianStatistics } from '../api/technicianStatisticsApi.js'
import {
  readTechnicianFilters,
  technicianApiQuery,
  technicianErrorKey,
  technicianFiltersQuery,
  technicianTabs,
} from '../technicianPresentation.js'
import TechnicianPanels from '../components/TechnicianPanels.jsx'
import { TechnicianIcon } from '../components/TechnicianUi.jsx'
import './technician-statistics.css'

const presets = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'YTD', label: 'This year' },
]
const descriptions = {
  overview: 'Monitor technician profiles, verification, and current account status.',
  income: 'Review technician earnings from successful, settled payments.',
  areas: 'Explore current registered technician coverage by city and ward.',
  services: 'Review assignment outcomes and published customer ratings.',
  issues: 'Track complaints linked to technicians and applied penalties.',
  locked: 'Search technician accounts that are currently locked.',
}

export default function TechnicianStatisticsPage() {
  const { token, clearSession } = useAuth()
  const { t, locale } = useUiPreferences()
  const [params, setParams] = useSearchParams()
  const [defaults] = useState(() => presetReportRange())
  const filters = readTechnicianFilters(params, defaults)
  const [customOpen, setCustomOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '' })
  const query = technicianApiQuery(filters)
  const requestKey = `${query}:${refresh}:${token}`
  const validation = filters.error
  const loading = !validation && response.key !== requestKey
  const error = response.key === requestKey ? response.error : ''
  const data = !validation && !loading && !error ? response.data : null
  const selectedPreset = reportRangePreset(filters.range)
  const currentTab = technicianTabs.find((item) => item.key === filters.tab) ?? technicianTabs[0]
  const paramKey = params.toString()
  const updateFilters = useCallback(
    (patch) => {
      const current = readTechnicianFilters(new URLSearchParams(paramKey), defaults)
      setParams(technicianFiltersQuery({ ...current, ...patch }), { replace: true })
    },
    [paramKey, defaults, setParams]
  )
  const search = useCallback((value) => updateFilters({ search: value, page: 1 }), [updateFilters])
  const updateRange = (range) => {
    updateFilters({ range, page: 1 })
    setCustomOpen(false)
  }
  const reload = () => setRefresh((value) => value + 1)

  useEffect(() => {
    if (validation) return
    const controller = new AbortController()
    getTechnicianStatistics(query, token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setResponse({ key: requestKey, data: result, error: '' })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({ key: requestKey, data: null, error: technicianErrorKey(err) })
        if (err.status === 401) clearSession()
      })
    return () => controller.abort()
  }, [query, token, clearSession, requestKey, validation])

  return (
    <main className="figma-admin-main tech-statistics-page">
      <PageHeader
        title="Technician Analytics"
        subtitle="Technician activity, earnings, coverage, and service quality"
        onRefresh={reload}
        refreshing={loading}
      />
      <div className="tech-content">
        <section className="tech-toolbar" aria-label={t('Technician statistics filters')}>
          <div className="tech-toolbar-heading">
            <div>
              <p className="tech-breadcrumb">
                {t('Analytics')} / {t('Technician Analytics')}
              </p>
              <h2>{t(filters.tab === 'overview' ? 'Technician Overview' : currentTab.label)}</h2>
              <p>{t(descriptions[filters.tab] ?? descriptions.overview)}</p>
            </div>
            <button
              type="button"
              className="tech-range-trigger"
              aria-expanded={customOpen}
              aria-controls="tech-custom-period"
              onClick={() => setCustomOpen((value) => !value)}
            >
              <TechnicianIcon name="calendar" />
              <span>
                {validation
                  ? t('Choose report period')
                  : `${reportDate(filters.range.from)} – ${reportDate(filters.range.to)}`}
              </span>
            </button>
          </div>
          <div className="tech-toolbar-bottom">
            <div className="tech-presets" role="group" aria-label={t('Report period')}>
              {presets.map((preset) => (
                <button
                  type="button"
                  key={preset.key}
                  aria-pressed={!customOpen && selectedPreset === preset.key}
                  onClick={() => updateRange(presetReportRange(preset.key))}
                >
                  {t(preset.label)}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={customOpen || selectedPreset === 'CUSTOM'}
                aria-expanded={customOpen}
                aria-controls="tech-custom-period"
                onClick={() => setCustomOpen((value) => !value)}
              >
                {t('Custom')}
              </button>
            </div>
            <p>{t('Inclusive dates · Vietnam time (UTC+7)')}</p>
          </div>
          {customOpen && (
            <div id="tech-custom-period">
              <CustomerDateForm
                key={reportRangeQuery(filters.range)}
                range={filters.range}
                onApply={updateRange}
                onCancel={() => setCustomOpen(false)}
              />
            </div>
          )}
        </section>
        <nav className="tech-tabs" aria-label={t('Technician statistics sections')}>
          {technicianTabs.map((tab) => (
            <button
              type="button"
              key={tab.key}
              aria-pressed={filters.tab === tab.key}
              onClick={() => {
                updateFilters({ tab: tab.key, page: 1 })
                setCustomOpen(false)
              }}
            >
              <span>{t(tab.label)}</span>
              {tab.key === 'locked' && data && (
                <small>
                  {new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(
                    data.summary.lockedTechnicians
                  )}
                </small>
              )}
            </button>
          ))}
        </nav>
        {validation ? (
          <div className="tech-state error" role="alert">
            <strong>{t('Check the technician statistics filters')}</strong>
            <p>{t(validation)}</p>
            <button
              type="button"
              onClick={() => {
                setParams(
                  technicianFiltersQuery({
                    ...readTechnicianFilters(new URLSearchParams(), defaults),
                    range: presetReportRange(),
                  }),
                  { replace: true }
                )
                setCustomOpen(false)
              }}
            >
              {t('Reset filters')}
            </button>
          </div>
        ) : filters.tab === 'locked' ? (
          <TechnicianPanels
            data={data}
            filters={filters}
            onSearch={search}
            onPage={(page) => updateFilters({ page })}
            onLimit={(limit) => updateFilters({ limit, page: 1 })}
            loading={loading}
            error={error}
            retry={reload}
          />
        ) : loading ? (
          <div className="tech-state" role="status">
            <span className="tech-spinner" aria-hidden="true" />
            {t('Loading technician statistics…')}
          </div>
        ) : error ? (
          <div className="tech-state error" role="alert">
            <strong>{t('Unable to load technician statistics')}</strong>
            <p>{t(error)}</p>
            <button type="button" onClick={reload}>
              {t('Try again')}
            </button>
          </div>
        ) : (
          <TechnicianPanels data={data} filters={filters} />
        )}
        {data && (
          <p className="tech-footnote">
            {t(
              '— means unavailable. All dates and times use Vietnam time (UTC+7). Updated {time} (UTC+7).',
              { time: reportTimestamp(data.asOf, locale) }
            )}
          </p>
        )}
      </div>
    </main>
  )
}
