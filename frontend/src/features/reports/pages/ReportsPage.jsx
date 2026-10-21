import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../../shared/components/AdminUi.jsx'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { getReports } from '../api/reportsApi.js'
import ReportTrend, { ReportSparkline } from '../components/ReportTrend.jsx'
import {
  presetReportRange,
  readReportRange,
  reportCount,
  reportDate,
  reportErrorKey,
  reportMoney,
  reportPercent,
  reportRangeError,
  reportRangePreset,
  reportRangeQuery,
  reportServiceRows,
  reportTimestamp,
} from '../reportPresentation.js'
import './reports.css'

const presets = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: 'YTD', label: 'This year' },
]
const statusLabels = {
  completed: 'Completed',
  processing: 'Pending / in progress',
  cancelled: 'Cancelled',
}

function DateRangeForm({ range, onApply, onCancel }) {
  const { t } = useUiPreferences()
  const [draft, setDraft] = useState(range)
  const error = reportRangeError(draft)
  return (
    <form
      className="reports-date-form"
      aria-label={t('Custom report period')}
      onSubmit={(event) => {
        event.preventDefault()
        if (!error) onApply(draft)
      }}
    >
      <label>
        {t('From')}
        <input
          type="date"
          min="1900-01-01"
          max="9999-12-31"
          required
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.currentTarget.value })}
        />
      </label>
      <label>
        {t('To')}
        <input
          type="date"
          min="1900-01-01"
          max="9999-12-31"
          required
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: event.currentTarget.value })}
        />
      </label>
      <div className="reports-date-actions">
        <button type="button" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="submit" className="reports-primary" disabled={Boolean(error)}>
          {t('Apply')}
        </button>
      </div>
      <p className={error ? 'reports-field-error' : ''} aria-live="polite">
        {t(error || 'Inclusive dates · Maximum 366 days · Vietnam time (UTC+7)')}
      </p>
    </form>
  )
}

function ReportKpi({ title, amount, note, icon, dimensions, blue = false, children }) {
  const { t } = useUiPreferences()
  return (
    <section className="reports-card reports-kpi" aria-label={t(title)}>
      <div>
        <h2>{t(title)}</h2>
        <span className={`reports-kpi-icon${blue ? ' blue' : ''}`}>
          <img src={`/reports/${icon}.svg`} alt="" width={dimensions[0]} height={dimensions[1]} />
        </span>
      </div>
      <strong>{amount}</strong>
      <p>{t(note)}</p>
      {children}
    </section>
  )
}

function ReportOverview({ data }) {
  const { t, locale } = useUiPreferences()
  const { summary, bookingOverview, services, trend } = data
  const serviceRows = reportServiceRows(services)
  return (
    <div className="reports-overview-grid">
      <section className="reports-card reports-overview" aria-labelledby="reports-booking-overview">
        <div className="reports-card-heading">
          <h2 id="reports-booking-overview">{t('Booking Overview')}</h2>
          <span className="reports-tag">
            {t('Bookings: {count}', { count: reportCount(summary.bookings, locale) })}
          </span>
        </div>
        <p className="reports-card-description">
          {t('Current status of bookings created in this period.')}
        </p>
        <div className="reports-status-track" aria-hidden="true">
          {bookingOverview.map((row) => (
            <span key={row.key} className={row.key} style={{ width: `${row.percentage}%` }} />
          ))}
        </div>
        <ul className="reports-status-list">
          {bookingOverview.map((row) => (
            <li key={row.key}>
              <span>
                <i className={row.key} />
                {t(statusLabels[row.key])}
              </span>
              <strong>{reportCount(row.count, locale)}</strong>
              <small>{reportPercent(row.percentage, locale)}</small>
            </li>
          ))}
        </ul>
        {summary.bookings === 0 && (
          <p className="reports-empty-note">{t('No bookings were created in this period.')}</p>
        )}
      </section>
      <section className="reports-card reports-overview" aria-labelledby="reports-revenue-overview">
        <div className="reports-card-heading">
          <h2 id="reports-revenue-overview">{t('Revenue Overview')}</h2>
          <span className="reports-tag">{t('Commission')}</span>
        </div>
        <strong className="reports-overview-amount">
          {reportMoney(summary.commissionAmount, locale)}
        </strong>
        {summary.commissionAmount === null && (
          <p className="reports-partial">
            {t('Known partial amount: {amount}', {
              amount: reportMoney(summary.knownCommissionAmount, locale),
            })}
          </p>
        )}
        <div className="reports-average">
          <span>{t('Average per settled payment')}</span>
          <strong>{reportMoney(summary.averageCommissionAmount, locale)}</strong>
        </div>
        <p className="reports-card-description">
          {t('Successful payments settled in this period: {count}.', {
            count: reportCount(summary.settledPayments, locale),
          })}
        </p>
        <ReportSparkline rows={trend} />
        <p className="reports-sparkline-label">{t('Commission trend · Selected period')}</p>
      </section>
      <section
        className="reports-card reports-overview"
        aria-labelledby="reports-services-overview"
      >
        <div className="reports-card-heading">
          <h2 id="reports-services-overview">{t('Service Overview')}</h2>
          <span className="reports-tag">
            {t('Service uses: {count}', { count: reportCount(services.totalUses, locale) })}
          </span>
        </div>
        <p className="reports-card-description">
          {t(
            'Services on bookings created in this period. Each service selected for one AC unit counts as one use.'
          )}
        </p>
        {serviceRows.length ? (
          <ul className="reports-service-list">
            {serviceRows.map((row, index) => (
              <li key={row.id}>
                <div>
                  <strong>
                    {row.id === 'other-services'
                      ? t('Other services')
                      : row.id === 'UNCLASSIFIED'
                        ? t('Unclassified service')
                        : row.name}
                  </strong>
                  <span>
                    {reportPercent(row.percentage, locale)}{' '}
                    <small>({reportCount(row.count, locale)})</small>
                  </span>
                </div>
                <div className={`reports-service-track color-${index % 4}`} aria-hidden="true">
                  <span style={{ width: `${Math.min(100, Math.max(0, row.percentage))}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="reports-empty-note">
            {t('No service usage was recorded for these bookings.')}
          </p>
        )}
      </section>
    </div>
  )
}

export default function ReportsPage() {
  const { token, clearSession } = useAuth()
  const { t, locale } = useUiPreferences()
  const [params, setParams] = useSearchParams()
  const [defaults] = useState(() => presetReportRange())
  const range = readReportRange(params, defaults)
  const [customOpen, setCustomOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '' })
  const validation = reportRangeError(range)
  const query = reportRangeQuery(range)
  const requestKey = `${query}:${refresh}:${token}`
  const loading = !validation && response.key !== requestKey
  const data = !validation && !loading && !response.error ? response.data : null
  const error = response.key === requestKey ? response.error : ''
  const selectedPreset = reportRangePreset(range)
  const reload = () => setRefresh((value) => value + 1)
  const updateRange = (next) => {
    setParams(reportRangeQuery(next), { replace: true })
    setCustomOpen(false)
  }

  useEffect(() => {
    if (validation) return
    const controller = new AbortController()
    getReports(query, token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setResponse({ key: requestKey, data: result, error: '' })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({ key: requestKey, data: null, error: reportErrorKey(err) })
        if (err.status === 401) clearSession()
      })
    return () => controller.abort()
  }, [query, requestKey, validation, token, clearSession])

  return (
    <main className="reports-page">
      <PageHeader
        title="Reports"
        subtitle="Business activity overview"
        onRefresh={reload}
        refreshing={loading}
      />
      <div className="reports-content">
        <section className="reports-card reports-toolbar" aria-label={t('Report filters')}>
          <div className="reports-toolbar-heading">
            <div>
              <p className="reports-breadcrumb">
                {t('CoolCare Admin')} · {t('Analytics')} · {t('Reports')}
              </p>
              <h2>{t('Reports')}</h2>
              <p>{t('Bookings, platform commission and service usage at a glance.')}</p>
            </div>
            <button
              className="reports-range-trigger"
              type="button"
              aria-expanded={customOpen}
              aria-controls="reports-custom-period"
              onClick={() => setCustomOpen((value) => !value)}
            >
              <img src="/reports/calendar.svg" alt="" width="18" height="20" />
              <span>
                {validation
                  ? t('Choose report period')
                  : `${reportDate(range.from)} – ${reportDate(range.to)}`}
              </span>
            </button>
          </div>
          <div className="reports-toolbar-bottom">
            <div className="reports-presets" role="group" aria-label={t('Report period')}>
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
                aria-controls="reports-custom-period"
                onClick={() => setCustomOpen((value) => !value)}
              >
                {t('Custom')}
              </button>
            </div>
            <p>{t('Inclusive dates · Vietnam time (UTC+7)')}</p>
          </div>
          {customOpen && (
            <div id="reports-custom-period">
              <DateRangeForm
                key={query}
                range={range}
                onApply={updateRange}
                onCancel={() => setCustomOpen(false)}
              />
            </div>
          )}
        </section>
        {validation ? (
          <div className="reports-state error" role="alert">
            <strong>{t('Check the report period')}</strong>
            <p>{t(validation)}</p>
            <button type="button" onClick={() => setCustomOpen(true)}>
              {t('Choose dates')}
            </button>
          </div>
        ) : loading ? (
          <div className="reports-state" role="status">
            <span className="reports-loading-mark" aria-hidden="true" />
            {t('Loading reports…')}
          </div>
        ) : error ? (
          <div className="reports-state error" role="alert">
            <strong>{t('Unable to load reports')}</strong>
            <p>{t(error)}</p>
            <button type="button" onClick={reload}>
              {t('Try again')}
            </button>
          </div>
        ) : (
          data && (
            <>
              <div className="reports-kpis">
                <ReportKpi
                  title="Total Bookings"
                  amount={reportCount(data.summary.bookings, locale)}
                  note="Created in the selected period"
                  icon="bookings"
                  dimensions={[18, 20]}
                />
                <ReportKpi
                  title="Platform Commission"
                  amount={reportMoney(data.summary.commissionAmount, locale)}
                  note="Successful payments settled in this period"
                  icon="commission"
                  dimensions={[22, 16]}
                >
                  {data.summary.commissionAmount === null && (
                    <small className="reports-partial">
                      {t('Known partial amount: {amount}', {
                        amount: reportMoney(data.summary.knownCommissionAmount, locale),
                      })}
                    </small>
                  )}
                </ReportKpi>
                <ReportKpi
                  title="Total Customers"
                  amount={reportCount(data.summary.customers, locale)}
                  note="Current total · All registered customer profiles"
                  icon="customers"
                  dimensions={[22, 16]}
                  blue
                />
                <ReportKpi
                  title="Total Technicians"
                  amount={reportCount(data.summary.technicians, locale)}
                  note="Current total · All registered technician profiles"
                  icon="technicians"
                  dimensions={[21.9, 18]}
                />
              </div>
              {data.summary.missingCommissionPayments > 0 && (
                <p className="reports-data-note" role="status">
                  {t(
                    'Payments with unavailable commission: {count}. Known partial amounts are shown separately; unavailable totals use —.',
                    { count: reportCount(data.summary.missingCommissionPayments, locale) }
                  )}
                </p>
              )}
              <ReportTrend key={query} rows={data.trend} period={data.period} />
              <ReportOverview data={data} />
              <p className="reports-footnote">
                {t(
                  'Customer and technician cards are current totals and do not change with the report period. A technician can also have a customer profile.'
                )}
                {data.asOf && (
                  <> {t('Updated {time} (UTC+7).', { time: reportTimestamp(data.asOf, locale) })}</>
                )}
              </p>
            </>
          )
        )}
      </div>
    </main>
  )
}
