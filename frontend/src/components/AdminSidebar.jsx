import { Link } from 'react-router-dom'
import { Brand } from './Brand.jsx'

const mainNavigation = [
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
    dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    booking: <><rect x="4" y="6" width="16" height="14" rx="2" /><path d="M8 3v5m8-5v5M4 11h16" /></>,
    user: <><circle cx="12" cy="8" r="3" /><path d="M6 20c.4-4 2.4-6 6-6s5.6 2 6 6" /></>,
    technician: <><circle cx="12" cy="8" r="3" /><path d="M6 20c.4-4 2.4-6 6-6s5.6 2 6 6m5-13 1.5 1.5M6.5 1.5 8 3" /></>,
    services: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" /></>,
    finance: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18m-5 4h2" /></>,
    marketing: <><path d="m4 13 13-6v10L4 11v2Zm0-2v6m13-6c2 0 3 1 3 3s-1 3-3 3" /></>,
    complaint: <><path d="M5 5h14v11H9l-4 4V5Z" /><path d="M12 8v4m0 2h.01" /></>,
    analytics: <><path d="M4 20V10m5 10V4m6 16v-7m5 7V7" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  }
  return <svg className="dashboard-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">{paths[name] ?? paths.dashboard}</svg>
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts.length ? parts.slice(-2).map((part) => part[0]).join('') : 'AD').toUpperCase()
}

export function AdminSidebar({ user, activePage = 'dashboard', profileMode = 'view', onProfileMode, onLogout }) {
  const settingsOpen = activePage === 'profile'

  return <aside className="dashboard-sidebar">
    <Brand />
    <Link className="dashboard-admin-card" to="/profile" aria-label="Mở hồ sơ cá nhân">
      <span className="dashboard-avatar" style={user?.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}>{!user?.avatarUrl && initials(user?.fullName)}</span>
      <span><strong>{user?.fullName ?? 'Marcus Vance'}</strong><small>Super Admin</small></span><i aria-label="Đang hoạt động" />
    </Link>
    <span className="dashboard-nav-label">MAIN NAVIGATION</span>
    <nav aria-label="Điều hướng quản trị">
      <Link className={activePage === 'dashboard' ? 'active' : ''} to="/"><DashboardIcon name="dashboard" /><span>Dashboard</span></Link>
      {mainNavigation.map(([icon, label, badge]) => <a key={label} href={`/#${icon}`}><DashboardIcon name={icon} /><span>{label}</span>{badge && <em>{badge}</em>}</a>)}
      <div className="dashboard-subnav">{technicianNavigation.map((label) => <span key={label}>{label}</span>)}</div>
      {secondaryNavigation.map(([icon, label]) => <a key={label} href={`/#${icon}`}><DashboardIcon name={icon} /><span>{label}</span></a>)}
      {settingsOpen
        ? <button className="settings-trigger settings-open" type="button" aria-expanded="true"><DashboardIcon name="settings" /><span>Settings</span><b className="nav-chevron">⌄</b></button>
        : <Link to="/profile"><DashboardIcon name="settings" /><span>Settings</span><b className="nav-chevron">⌄</b></Link>}
      {settingsOpen && <div className="dashboard-subnav settings-subnav">
        <button className={profileMode !== 'password' ? 'active' : ''} type="button" onClick={() => onProfileMode?.('edit')}>Profile</button>
        <button className={profileMode === 'password' ? 'active' : ''} type="button" onClick={() => onProfileMode?.('password')}>Password</button>
      </div>}
    </nav>
    <button className="dashboard-logout" type="button" onClick={onLogout}>Đăng xuất</button>
  </aside>
}
