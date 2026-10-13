import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { AdminSidebar, DashboardIcon } from '../../../shared/components/AdminSidebar.jsx'
import { LanguageControl, ThemeControl } from '../../../shared/components/PreferenceControls.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'

const metrics = [
  {
    label: 'TOTAL REVENUE',
    value: '$248,500',
    trend: '+14.8%',
    note: 'vs last month',
    tone: 'orange',
    icon: 'revenue',
  },
  {
    label: 'TOTAL BOOKINGS',
    value: '3,842',
    trend: '+8.2%',
    note: 'vs last month',
    tone: 'blue',
    icon: 'booking',
  },
  {
    label: 'COMPLETED SERVICES',
    value: '3,618',
    trend: '+2.1%',
    note: 'improvement benchmark',
    tone: 'green',
    icon: 'complete',
  },
  {
    label: 'ACTIVE TECHNICIANS',
    value: '148',
    trend: null,
    note: 'Out of 163 registered',
    tone: 'purple',
    icon: 'technician',
  },
]

const bookingRows = [
  ['Pending', '142 bookings', '3.7%', 'yellow'],
  ['Confirm', '384 bookings', '10.0%', 'blue'],
  ['In Progress', '258 bookings', '6.7%', 'purple'],
  ['Completed', '3,010 bookings', '78.3%', 'green'],
  ['Customer Cancelled', '50 bookings', '1.3%', 'red'],
]

export function DashboardPage() {
  const { user, logout } = useAuth()
  const { t } = useUiPreferences()
  const [showLogout, setShowLogout] = useState(false)

  return (
    <div className="dashboard-shell">
      <AdminSidebar user={user} activePage="dashboard" onLogout={() => setShowLogout(true)} />

      <main className="dashboard-main" id="overview">
        <header className="dashboard-topbar">
          <div>
            <p>
              <strong>{t('Overview')}</strong>
              <span>/</span>
              {t('Live operations')}
            </p>
            <h1>{t('Dashboard Overview')}</h1>
          </div>
          <div className="dashboard-actions">
            <LanguageControl />
            <span className="updated-pill">
              <i /> {t('Updated 5 mins ago')}
            </span>
            <button type="button">▣&nbsp;&nbsp; {t('Last 30 Days')}⌄</button>
            <button className="round-action" type="button" aria-label="Tìm kiếm">
              ⌕
            </button>
            <button className="round-action notification" type="button" aria-label="Thông báo">
              ●
            </button>
            <ThemeControl />
            <Link
              className="top-avatar"
              to="/profile"
              aria-label="Mở hồ sơ cá nhân"
              style={user?.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}
            >
              {!user?.avatarUrl &&
                (user?.fullName?.split(' ').at(-1)?.slice(0, 2).toUpperCase() ?? 'MV')}
            </Link>
          </div>
        </header>

        <section className="dashboard-content">
          <div className="metric-grid">
            {metrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <span className={`metric-icon ${metric.tone}`}>
                  <DashboardIcon name={metric.icon} />
                </span>
                <small>{t(metric.label)}</small>
                <strong>{metric.value}</strong>
                <p>
                  {metric.trend && <b>↑ {metric.trend}</b>}
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
                  <p>{t('Progress distribution of scheduled and fulfilled services')}</p>
                </div>
                <strong>3,842 Total</strong>
                <button type="button">⌘</button>
              </header>
              <div className="booking-progress" aria-label="Phân bổ booking">
                <i className="yellow" />
                <i className="blue" />
                <i className="purple" />
                <i className="green" />
                <i className="red" />
              </div>
              <div className="booking-rows">
                {bookingRows.map(([label, value, percent, tone]) => (
                  <div key={label}>
                    <span>
                      <i className={tone} />
                      {t(label)}
                    </span>
                    <strong>{value}</strong>
                    <em>{percent}</em>
                  </div>
                ))}
              </div>
            </article>

            <article className="dashboard-panel revenue-overview">
              <header>
                <div>
                  <h2>{t('Revenue Overview')}</h2>
                  <p>{t('Monthly revenue trend & growth trajectory')}</p>
                </div>
                <strong>2024 YTD</strong>
              </header>
              <div className="revenue-summary">
                <span>
                  $248,500 <small>{t('Total revenue')}</small>
                </span>
                <b>
                  ↑ +16.4% <small>{t('vs. MoM')}</small>
                </b>
              </div>
              <svg
                className="revenue-chart"
                viewBox="0 0 560 220"
                role="img"
                aria-label="Biểu đồ doanh thu từ tháng 5 đến tháng 10"
              >
                <defs>
                  <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ff7a1a" stopOpacity=".25" />
                    <stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path className="chart-grid" d="M20 45h520M20 95h520M20 145h520M20 195h520" />
                <path
                  className="chart-area"
                  d="M28 178 126 132 225 98 324 75 422 62 525 38V205H28Z"
                />
                <path className="chart-line" d="M28 178 126 132 225 98 324 75 422 62 525 38" />
                {[
                  ['28', '178'],
                  ['126', '132'],
                  ['225', '98'],
                  ['324', '75'],
                  ['422', '62'],
                  ['525', '38'],
                ].map(([cx, cy]) => (
                  <circle key={cx} cx={cx} cy={cy} r="5" />
                ))}
              </svg>
              <div className="chart-months">
                <span>May</span>
                <span>Jun</span>
                <span>Jul</span>
                <span>Aug</span>
                <span>Sep</span>
                <span className="active">Oct</span>
              </div>
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
