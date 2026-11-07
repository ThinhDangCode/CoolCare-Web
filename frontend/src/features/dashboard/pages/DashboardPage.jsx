import { useEffect, useState } from 'react'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { AdminSidebar, DashboardIcon } from '../../../shared/components/AdminSidebar.jsx'
import { PageHeader } from '../../../shared/components/AdminUi.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { getReports } from '../../reports/api/reportsApi.js'
import {
  reportBucketLabel, reportChartSeries, reportCount, reportErrorKey,
  reportMoney, reportPercent, reportRangeQuery, vietnamToday,
} from '../../reports/reportPresentation.js'
import '../../../shared/styles/admin.css'

function dashboardRange() {
  const to = vietnamToday()
  const firstMonth = new Date(`${to.slice(0, 7)}-01T00:00:00Z`)
  firstMonth.setUTCMonth(firstMonth.getUTCMonth() - 5)
  return { from: firstMonth.toISOString().slice(0, 10), to }
}

const bookingLabels = {
  completed: 'Completed',
  processing: 'Pending / in progress',
  cancelled: 'Cancelled',
}

function commissionPath(trend) {
  if (!trend?.length || trend.some((row) => row.commissionAmount === null)) return null
  const series = reportChartSeries(trend, 'commission')
  const points = trend.map((_, index) => {
    const x = 28 + (index * 497) / Math.max(1, trend.length - 1)
    const y = 190 - series.ratio(series.values[index]) * 150
    return [x, y]
  })
  return {
    points,
    line: points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' '),
  }
}

export function DashboardPage() {
  const { user, token, logout } = useAuth()
  const { t, locale } = useUiPreferences()
  const [showLogout, setShowLogout] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getReports(reportRangeQuery(dashboardRange()), token, controller.signal)
      .then((data) => {
        setReport(data)
        setError(null)
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') {
          setReport(null)
          setError(reportErrorKey(cause))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [token, refreshKey])

  const refresh = () => {
    setLoading(true)
    setError(null)
    setRefreshKey((key) => key + 1)
  }
  const summary = report?.summary
  const completed = report?.bookingOverview.find((row) => row.key === 'completed')?.count ?? 0
  const metrics = [
    {
      label: 'Platform Commission',
      value: reportMoney(summary?.commissionAmount, locale),
      note: 'Successful payments settled in this period',
      tone: 'orange', icon: 'revenue',
    },
    {
      label: 'TOTAL BOOKINGS',
      value: reportCount(summary?.bookings, locale),
      note: 'Created in the selected period',
      tone: 'blue', icon: 'booking',
    },
    {
      label: 'COMPLETED BOOKINGS',
      value: report ? reportCount(completed, locale) : '—',
      note: 'Current status of bookings created in this period.',
      tone: 'green', icon: 'complete',
    },
    {
      label: 'Total Technicians',
      value: reportCount(summary?.technicians, locale),
      note: 'Current total · All registered technician profiles',
      tone: 'purple', icon: 'technician',
    },
  ]
  const chart = commissionPath(report?.trend)

  return (
    <div className="dashboard-shell">
      <AdminSidebar user={user} activePage="dashboard" onLogout={() => setShowLogout(true)} />

      <main className="dashboard-main" id="overview">
        <PageHeader
          title="Dashboard Overview"
          subtitle="Reports for the last six months · Vietnam time (UTC+7)"
          onRefresh={refresh}
          refreshing={loading}
        />

        <section className="dashboard-content">
          {error && (
            <div className="dashboard-load-error" role="alert">
              <span>{t(error)}</span>
              <button type="button" onClick={refresh}>{t('Try again')}</button>
            </div>
          )}
          {loading && !report && <p role="status">{t('Loading reports…')}</p>}
          <div className="metric-grid">
            {metrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <span className={`metric-icon ${metric.tone}`}>
                  <DashboardIcon name={metric.icon} />
                </span>
                <small>{t(metric.label)}</small>
                <strong>{metric.value}</strong>
                <p>
                  <span>{t(metric.note)}</span>
                </p>
              </article>
            ))}
          </div>

          <div className="analytics-grid">
            <article className="dashboard-panel booking-overview">
              <header>
                <div>
                  <h2>{t('Booking Overview')}</h2>
                  <p>{t('Current status of bookings created in this period.')}</p>
                </div>
                <strong>{t('Bookings: {count}', { count: reportCount(summary?.bookings, locale) })}</strong>
              </header>
              <div className="booking-progress" aria-label={t('Booking Overview')}>
                {report?.bookingOverview.map((row) => (
                  <i key={row.key} className={row.key} style={{ width: `${row.percentage}%` }} />
                ))}
              </div>
              <div className="booking-rows">
                {report?.bookingOverview.map((row) => (
                  <div key={row.key}>
                    <span>
                      <i className={row.key} />
                      {t(bookingLabels[row.key])}
                    </span>
                    <strong>{reportCount(row.count, locale)}</strong>
                    <em>{reportPercent(row.percentage, locale)}</em>
                  </div>
                ))}
              </div>
              {report && summary.bookings === 0 && <p>{t('No bookings were created in this period.')}</p>}
            </article>

            <article className="dashboard-panel revenue-overview">
              <header>
                <div>
                  <h2>{t('Platform Commission')}</h2>
                  <p>{t('Monthly commission from settled payments')}</p>
                </div>
                <strong>{report ? `${report.period.from} – ${report.period.to}` : '—'}</strong>
              </header>
              <div className="revenue-summary">
                <span>
                  {reportMoney(summary?.commissionAmount, locale)}
                  <small>{t('Platform Commission')}</small>
                </span>
              </div>
              {chart ? (<>
                <svg
                className="dashboard-revenue-chart"
                viewBox="0 0 560 220"
                role="img"
                aria-label={t('Monthly commission from settled payments')}
              >
                <defs>
                  <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ff7a1a" stopOpacity=".25" />
                    <stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path className="chart-grid" d="M20 45h520M20 95h520M20 145h520M20 195h520" />
                <path className="chart-area" d={`${chart.line} L525 205 H28 Z`} />
                <path className="chart-line" d={chart.line} />
                {chart.points.map(([cx, cy]) => (
                  <circle key={cx} cx={cx} cy={cy} r="5" />
                ))}
              </svg>
              <div className="chart-months">
                {report.trend.map((row, index) => (
                  <span key={row.date} className={index === report.trend.length - 1 ? 'active' : ''}>
                    {reportBucketLabel(row.date, 'month')}
                  </span>
                ))}
              </div>
              </>) : report ? (
                <p className="dashboard-chart-note">
                  {report.summary.missingCommissionPayments
                    ? t('Commission is unavailable for some settled payments.')
                    : t('No commission data is available.')}
                </p>
              ) : null}
            </article>
          </div>
        </section>
      </main>

      {showLogout && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setShowLogout(false)}
        >
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="logout-title">{t('logoutTitle')}</h2>
            <p>{t('logoutCopy')}</p>
            <div className="confirm-dialog-actions">
              <button type="button" onClick={() => setShowLogout(false)}>
                {t('cancel')}
              </button>
              <button className="danger" type="button" onClick={logout}>
                {t('logout')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
