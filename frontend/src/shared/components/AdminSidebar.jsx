import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { Brand } from '../../components/Brand.jsx'

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

export function DashboardIcon({ name }) {
  const paths = {
    dashboard: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </>
    ),
    booking: (
      <>
        <rect x="4" y="6" width="16" height="14" rx="2" />
        <path d="M8 3v5m8-5v5M4 11h16" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M6 20c.4-4 2.4-6 6-6s5.6 2 6 6" />
      </>
    ),
    technician: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M6 20c.4-4 2.4-6 6-6s5.6 2 6 6m5-13 1.5 1.5M6.5 1.5 8 3" />
      </>
    ),
    services: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" />
      </>
    ),
    finance: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18m-5 4h2" />
      </>
    ),
    marketing: (
      <>
        <path d="m4 13 13-6v10L4 11v2Zm0-2v6m13-6c2 0 3 1 3 3s-1 3-3 3" />
      </>
    ),
    complaint: (
      <>
        <path d="M5 5h14v11H9l-4 4V5Z" />
        <path d="M12 8v4m0 2h.01" />
      </>
    ),
    analytics: (
      <>
        <path d="M4 20V10m5 10V4m6 16v-7m5 7V7" />
      </>
    ),
  }

  return (
    <svg className="dashboard-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths[name] ?? paths.dashboard}
    </svg>
  )
}

export function AdminSidebar() {
  const { user, logout } = useAuth()
  const [showLogout, setShowLogout] = useState(false)
  return (
    <>
      <aside className="dashboard-sidebar">
        <Brand />

        <div className="dashboard-admin-card">
          <span className="dashboard-avatar">
            {user?.fullName?.split(' ').at(-1)?.slice(0, 2).toUpperCase() ?? 'MV'}
          </span>
          <span>
            <strong>{user?.fullName ?? 'Marcus Vance'}</strong>
            <small>Fleet Director</small>
          </span>
          <i aria-label="Đang hoạt động" />
        </div>

        <span className="dashboard-nav-label">MAIN NAVIGATION</span>
        <nav aria-label="Điều hướng quản trị">
          {mainNavigation.map(([icon, label, badge]) =>
            label === 'Dashboard' ? (
              <NavLink key={label} to="/" end>
                <DashboardIcon name={icon} />
                <span>{label}</span>
              </NavLink>
            ) : (
              <a key={label} href={`#${icon}`}>
                <DashboardIcon name={icon} />
                <span>{label}</span>
                {badge && <em>{badge}</em>}
              </a>
            )
          )}
          <div className="dashboard-subnav">
            {technicianNavigation.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          {secondaryNavigation.map(([icon, label]) =>
            icon === 'services' ? (
              <div key={label}>
                <Link to="/catalog/services">
                  <DashboardIcon name={icon} />
                  <span>{label}</span>
                </Link>
                <div className="dashboard-subnav dashboard-catalog-subnav">
                  <NavLink to="/catalog/categories">Category</NavLink>
                  <NavLink to="/catalog/services">Services</NavLink>
                  <NavLink to="/catalog/brands">AC Brands</NavLink>
                  <NavLink to="/catalog/models">AC Models</NavLink>
                  <NavLink to="/catalog/skills">Skill Management</NavLink>
                </div>
              </div>
            ) : (
              <a key={label} href={`#${icon}`}>
                <DashboardIcon name={icon} />
                <span>{label}</span>
              </a>
            )
          )}
        </nav>

        <button className="dashboard-logout" type="button" onClick={() => setShowLogout(true)}>
          Đăng xuất
        </button>
      </aside>

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
            <h2 id="logout-title">Đăng xuất?</h2>
            <p>Bạn có chắc muốn kết thúc phiên quản trị hiện tại?</p>
            <div className="confirm-dialog-actions">
              <button type="button" onClick={() => setShowLogout(false)}>
                Hủy
              </button>
              <button className="danger" type="button" onClick={logout}>
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
