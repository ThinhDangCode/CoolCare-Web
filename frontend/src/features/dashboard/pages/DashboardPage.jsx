import { useState } from 'react'
import { useAuth } from '../../auth/context/AuthContext.jsx'
import { Brand } from '../../../shared/components/Brand.jsx'

const mainNavigation = [
  ['dashboard', 'Dashboard'],
  ['booking', 'Booking', '12'],
  ['user', 'User'],
  ['technician', 'Technician'],
]

const technicianNavigation = ['Technician List', 'Certification', 'Verification', 'Penalty']

const secondaryNavigation = [
  ['services', 'Service'],
  ['finance', 'Finance & Wallet'],
  ['marketing', 'Marketing'],
  ['complaint', 'Complaint'],
  ['analytics', 'Analytics'],
]

const metrics = [
  { label: 'TOTAL REVENUE', value: '$248,500', trend: '+14.8%', note: 'vs last month', tone: 'orange', icon: 'revenue' },
  { label: 'TOTAL BOOKINGS', value: '3,842', trend: '+8.2%', note: 'vs last month', tone: 'blue', icon: 'booking' },
  { label: 'COMPLETED SERVICES', value: '3,618', trend: '+2.1%', note: 'improvement benchmark', tone: 'green', icon: 'complete' },
  { label: 'ACTIVE TECHNICIANS', value: '148', trend: null, note: 'Out of 163 registered', tone: 'purple', icon: 'technician' },
]

const bookingRows = [
  ['Pending', '142 bookings', '3.7%', 'yellow'],
  ['Confirm', '384 bookings', '10.0%', 'blue'],
  ['In Progress', '258 bookings', '6.7%', 'purple'],
  ['Completed', '3,010 bookings', '78.3%', 'green'],
  ['Customer Cancelled', '50 bookings', '1.3%', 'red'],
]

function DashboardIcon({ name }) {
  const paths = {
    dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    booking: <><rect x="4" y="6" width="16" height="14" rx="2" /><path d="M8 3v5m8-5v5M4 11h16" /></>,
    user: <><circle cx="12" cy="8" r="3" /><path d="M6 20c.4-4 2.4-6 6-6s5.6 2 6 6" /></>,
    technician: <><circle cx="12" cy="8" r="3" /><path d="M6 20c.4-4 2.4-6 6-6s5.6 2 6 6m5-13 1.5 1.5M6.5 1.5 8 3" /></>,
    services: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" /></>,
    finance: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18m-5 4h2" /></>,
    marketing: <><path d="m4 13 13-6v10L4 11v2Zm0-2v6m13-6c2 0 3 1 3 3s-1 3-3 3" /></>,
    complaint: <><path d="M5 5h14v11H9l-4 4V5Z" /><path d="M12 8v4m0 2h.01" /></>,
    analytics: <><path d="M4 20V10m5 10V4m6 16v-7m5 7V7" /></>,
  }

  return <svg className="dashboard-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">{paths[name] ?? paths.dashboard}</svg>
}

export function DashboardPage() {
  const { user, logout } = useAuth()
  const [showLogout, setShowLogout] = useState(false)

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <Brand />

        <div className="dashboard-admin-card">
          <span className="dashboard-avatar">{user?.fullName?.split(' ').at(-1)?.slice(0, 2).toUpperCase() ?? 'MV'}</span>
          <span><strong>{user?.fullName ?? 'Marcus Vance'}</strong><small>Super Admin</small></span>
          <i aria-label="Đang hoạt động" />
        </div>

        <span className="dashboard-nav-label">MAIN NAVIGATION</span>
        <nav aria-label="Điều hướng quản trị">
          {mainNavigation.map(([icon, label, badge]) => (
            <a key={label} className={label === 'Dashboard' ? 'active' : ''} href={label === 'Dashboard' ? '#overview' : `#${icon}`}>
              <DashboardIcon name={icon} /><span>{label}</span>{badge && <em>{badge}</em>}
            </a>
          ))}
          <div className="dashboard-subnav">
            {technicianNavigation.map((label) => <span key={label}>{label}</span>)}
          </div>
          {secondaryNavigation.map(([icon, label]) => (
            <a key={label} href={`#${icon}`}><DashboardIcon name={icon} /><span>{label}</span></a>
          ))}
        </nav>

        <button className="dashboard-logout" type="button" onClick={() => setShowLogout(true)}>Đăng xuất</button>
      </aside>

      <main className="dashboard-main" id="overview">
        <header className="dashboard-topbar">
          <div>
            <p><strong>Overview</strong><span>/</span>Live operations</p>
            <h1>Dashboard Overview</h1>
          </div>
          <div className="dashboard-actions">
            <span className="updated-pill"><i /> Updated 5 mins ago</span>
            <button type="button">▣&nbsp;&nbsp; Last 30 Days⌄</button>
            <button className="round-action" type="button" aria-label="Tìm kiếm">⌕</button>
            <button className="round-action notification" type="button" aria-label="Thông báo">●</button>
            <span className="top-avatar">MV</span>
          </div>
        </header>

        <section className="dashboard-content">
          <div className="metric-grid">
            {metrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <span className={`metric-icon ${metric.tone}`}><DashboardIcon name={metric.icon} /></span>
                <small>{metric.label}</small>
                <strong>{metric.value}</strong>
                <p>{metric.trend && <b>↑ {metric.trend}</b>}<span>{metric.note}</span></p>
              </article>
            ))}
          </div>

          <div className="analytics-grid">
            <article className="dashboard-panel booking-overview">
              <header><div><h2>Booking Overview</h2><p>Progress distribution of scheduled and fulfilled services</p></div><strong>3,842 Total</strong><button type="button">⌘</button></header>
              <div className="booking-progress" aria-label="Phân bổ booking"><i className="yellow" /><i className="blue" /><i className="purple" /><i className="green" /><i className="red" /></div>
              <div className="booking-rows">
                {bookingRows.map(([label, value, percent, tone]) => (
                  <div key={label}><span><i className={tone} />{label}</span><strong>{value}</strong><em>{percent}</em></div>
                ))}
              </div>
            </article>

            <article className="dashboard-panel revenue-overview">
              <header><div><h2>Revenue Overview</h2><p>Monthly revenue trend &amp; growth trajectory</p></div><strong>2024 YTD</strong></header>
              <div className="revenue-summary"><span>$248,500 <small>Total revenue</small></span><b>↑ +16.4% <small>vs. MoM</small></b></div>
              <svg className="revenue-chart" viewBox="0 0 560 220" role="img" aria-label="Biểu đồ doanh thu từ tháng 5 đến tháng 10">
                <defs><linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff7a1a" stopOpacity=".25" /><stop offset="1" stopColor="#ff7a1a" stopOpacity="0" /></linearGradient></defs>
                <path className="chart-grid" d="M20 45h520M20 95h520M20 145h520M20 195h520" />
                <path className="chart-area" d="M28 178 126 132 225 98 324 75 422 62 525 38V205H28Z" />
                <path className="chart-line" d="M28 178 126 132 225 98 324 75 422 62 525 38" />
                {[['28','178'],['126','132'],['225','98'],['324','75'],['422','62'],['525','38']].map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r="5" />)}
              </svg>
              <div className="chart-months"><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span className="active">Oct</span></div>
            </article>
          </div>
        </section>
      </main>

      {showLogout && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setShowLogout(false)}>
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="logout-title">Đăng xuất?</h2>
            <p>Bạn có chắc muốn kết thúc phiên quản trị hiện tại?</p>
            <div className="confirm-dialog-actions">
              <button type="button" onClick={() => setShowLogout(false)}>Hủy</button>
              <button className="danger" type="button" onClick={logout}>Đăng xuất</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
