import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../../shared/components/AdminUi.jsx'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import {
  presetReportRange,
  reportDate,
  reportRangePreset,
  reportRangeQuery,
  reportTimestamp,
} from '../../reports/reportPresentation.js'
import { getCustomerStatistics } from '../api/customerStatisticsApi.js'
import {
  customerApiQuery,
  customerErrorKey,
  customerFiltersQuery,
  customerTabs,
  readCustomerFilters,
} from '../customerPresentation.js'
import CustomerPanels from '../components/CustomerPanels.jsx'
import { CustomerDateForm, CustomerIcon } from '../components/CustomerUi.jsx'
import './customer-statistics.css'

const presets = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'YTD', label: 'This year' },
]
const descriptions = {
  overview: 'Monitor customer registrations, booking history, service usage, and account status.',
  new: 'Track new customer registrations and compare them with the preceding period.',
  areas: 'Explore customer distribution using each profile’s current default address.',
  services: 'Understand service demand and repeat bookings among completed appointments.',
  cancellations:
    'Review customer cancellations and quotation rejections for bookings created in this period.',
  locked: 'View currently locked customer accounts and search their contact information.',
}

export default function CustomerStatisticsPage() {
  const { token, clearSession } = useAuth()
  const { t, locale } = useUiPreferences()
  const [params, setParams] = useSearchParams()
  const [defaults] = useState(() => presetReportRange())
  const filters = readCustomerFilters(params, defaults)
  const [customOpen, setCustomOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '' })
  const query = customerApiQuery(filters)
  const requestKey = `${query}:${refresh}:${token}`
  const validation = filters.error
  const loading = !validation && response.key !== requestKey
  const error = response.key === requestKey ? response.error : ''
  const data = !validation && !loading && !error ? response.data : null
  const selectedPreset = reportRangePreset(filters.range)
  const currentTab = customerTabs.find((item) => item.key === filters.tab) ?? customerTabs[0]
  const paramKey = params.toString()
  const updateFilters = useCallback(
    (patch) => {
      const current = readCustomerFilters(new URLSearchParams(paramKey), defaults)
      setParams(customerFiltersQuery({ ...current, ...patch }), { replace: true })
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
    getCustomerStatistics(query, token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setResponse({ key: requestKey, data: result, error: '' })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({ key: requestKey, data: null, error: customerErrorKey(err) })
        if (err.status === 401) clearSession()
      })
    return () => controller.abort()
  }, [query, token, clearSession, requestKey, validation])

  return (
    <main className="figma-admin-main customer-statistics-page">
      <PageHeader
        title="Customer Analytics"
        subtitle="Customer registrations, service demand, and account overview"
        onRefresh={reload}
        refreshing={loading}
      />
      <div className="customer-content">
        <section className="customer-toolbar" aria-label={t('Customer statistics filters')}>
          <div className="customer-toolbar-heading">
            <div>
              <p className="customer-breadcrumb">
                {t('Analytics')} / {t('Customer Analytics')}
              </p>
              <h2>{t(filters.tab === 'overview' ? 'Customer Overview' : currentTab.label)}</h2>
              <p>{t(descriptions[filters.tab] ?? descriptions.overview)}</p>
            </div>
            <button
              type="button"
              className="customer-range-trigger"
              aria-expanded={customOpen}
              aria-controls="customer-custom-period"
              onClick={() => setCustomOpen((value) => !value)}
            >
              <CustomerIcon name="calendar" />
              <span>
                {validation
                  ? t('Choose report period')
                  : `${reportDate(filters.range.from)} – ${reportDate(filters.range.to)}`}
              </span>
            </button>
          </div>
          <div className="customer-toolbar-bottom">
            <div className="customer-presets" role="group" aria-label={t('Report period')}>
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
                aria-controls="customer-custom-period"
                onClick={() => setCustomOpen((value) => !value)}
              >
                {t('Custom')}
              </button>
            </div>
            <p>{t('Inclusive dates · Vietnam time (UTC+7)')}</p>
          </div>
          {customOpen && (
            <div id="customer-custom-period">
              <CustomerDateForm
                key={reportRangeQuery(filters.range)}
                range={filters.range}
                onApply={updateRange}
                onCancel={() => setCustomOpen(false)}
              />
            </div>
          )}
        </section>
        <nav className="customer-tabs" aria-label={t('Customer statistics sections')}>
          {customerTabs.map((tab) => (
            <button
              type="button"
              key={tab.key}
              aria-pressed={filters.tab === tab.key}
              onClick={() => {
                updateFilters({ tab: tab.key, page: 1 })
                setCustomOpen(false)
              }}
            >
              <CustomerIcon name={`nav-${tab.key}${filters.tab === tab.key ? '-active' : ''}`} />
              <span>{t(tab.label)}</span>
              {tab.key === 'locked' && data && (
                <small>
                  {new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(
                    data.summary.lockedCustomers
                  )}
                </small>
              )}
            </button>
          ))}
        </nav>
        {validation ? (
          <div className="customer-state error" role="alert">
            <strong>{t('Check the customer statistics filters')}</strong>
            <p>{t(validation)}</p>
            <button
              type="button"
              onClick={() => {
                setParams(
                  customerFiltersQuery({
                    ...readCustomerFilters(new URLSearchParams(), defaults),
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
          <CustomerPanels
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
          <div className="customer-state" role="status">
            <span className="customer-loading-mark" aria-hidden="true" />
            {t('Loading customer statistics…')}
          </div>
        ) : error ? (
          <div className="customer-state error" role="alert">
            <strong>{t('Unable to load customer statistics')}</strong>
            <p>{t(error)}</p>
            <button type="button" onClick={reload}>
              {t('Try again')}
            </button>
          </div>
        ) : (
          data && (
            <>
              <CustomerPanels
                data={data}
                filters={filters}
                onSearch={search}
                onPage={(page) => updateFilters({ page })}
                onLimit={(limit) => updateFilters({ limit, page: 1 })}
              />
            </>
          )
        )}
        {data && (
          <p className="customer-footnote">
            {t('— means unavailable. All dates use Vietnam time (UTC+7).')}
            {data.asOf && (
              <> {t('Updated {time} (UTC+7).', { time: reportTimestamp(data.asOf, locale) })}</>
            )}
          </p>
        )}
      </div>
    </main>
  )
}
