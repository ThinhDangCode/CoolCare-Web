import { useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Brand } from './Brand.jsx'
import { useUiPreferences } from '../context/UiPreferencesContext.jsx'

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
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
  }
  return (
    <svg className="dashboard-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths[name] ?? paths.dashboard}
    </svg>
  )
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (
    parts.length
      ? parts
          .slice(-2)
          .map((part) => part[0])
          .join('')
      : 'AD'
  ).toUpperCase()
}

export function AdminSidebar({
  user,
  activePage = 'dashboard',
  profileMode = 'view',
  onProfileMode,
  onLogout,
}) {
  const { t } = useUiPreferences()
  const location = useLocation()
  const sidebarRef = useRef(null)
  const [technicianOpen, setTechnicianOpen] = useState(
    () =>
      location.pathname.startsWith('/admin/technicians') ||
      sessionStorage.getItem('admin-sidebar-technician') === 'true'
  )
  const [serviceOpen, setServiceOpen] = useState(
    () => sessionStorage.getItem('admin-sidebar-service') === 'true'
  )
  const [marketingOpen, setMarketingOpen] = useState(
    () => sessionStorage.getItem('admin-sidebar-marketing') === 'true'
  )
  const [settingsOpen, setSettingsOpen] = useState(activePage === 'profile')
  const [failedAvatarUrl, setFailedAvatarUrl] = useState('')

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current
    if (sidebar) sidebar.scrollTop = Number(sessionStorage.getItem('admin-sidebar-scroll') || 0)
  }, [])

  const rememberScroll = () =>
    sessionStorage.setItem('admin-sidebar-scroll', String(sidebarRef.current?.scrollTop || 0))
  const toggleGroup = (key, setter) =>
    setter((open) => {
      sessionStorage.setItem(`admin-sidebar-${key}`, String(!open))
      return !open
    })
  const selectProfileMode = (mode) => {
    const scrollTop = sidebarRef.current?.scrollTop || 0
    onProfileMode?.(mode)
    requestAnimationFrame(() => {
      if (sidebarRef.current) sidebarRef.current.scrollTop = scrollTop
    })
  }

  return (
    <aside ref={sidebarRef} className="dashboard-sidebar" onScroll={rememberScroll}>
      <Brand />
      <Link className="dashboard-admin-card" to="/profile" aria-label="Mở hồ sơ cá nhân">
        <span className="dashboard-avatar">
          {user?.avatarUrl && failedAvatarUrl !== user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" onError={() => setFailedAvatarUrl(user.avatarUrl)} />
          ) : (
            initials(user?.fullName)
          )}
        </span>
        <span>
          <strong>{user?.fullName ?? 'Marcus Vance'}</strong>
          <small>{t('Fleet Director')}</small>
        </span>
        <i aria-label="Đang hoạt động" />
      </Link>
      <span className="dashboard-nav-label">{t('MAIN NAVIGATION')}</span>
      <nav aria-label="Điều hướng quản trị">
        <Link className={activePage === 'dashboard' ? 'active' : ''} to="/">
          <DashboardIcon name="dashboard" />
          <span>{t('Dashboard')}</span>
        </Link>
        {mainNavigation.map(([icon, label, badge]) =>
          label === 'User' ? (
            <NavLink key={label} to="/admin/users">
              <DashboardIcon name={icon} />
              <span>{t(label)}</span>
            </NavLink>
          ) : label === 'Booking' ? (
            <NavLink key={label} to="/admin/bookings">
              <DashboardIcon name={icon} />
              <span>{t(label)}</span>
              {badge && <em>{badge}</em>}
            </NavLink>
          ) : label === 'Technician' ? (
            <div key={label} className="sidebar-accordion">
              <button
                className="sidebar-trigger"
                type="button"
                aria-expanded={technicianOpen}
                onClick={() => toggleGroup('technician', setTechnicianOpen)}
              >
                <DashboardIcon name={icon} />
                <span>{t(label)}</span>
                <b className={`nav-chevron ${technicianOpen ? 'open' : ''}`}>⌄</b>
              </button>
              {technicianOpen && (
                <div className="dashboard-subnav dashboard-technician-subnav">
                  {technicianNavigation.map((item) => (
                    <NavLink
                      key={item}
                      end={item === 'Technician List'}
                      to={
                        item === 'Technician List'
                          ? '/admin/technicians'
                          : `/admin/technicians/${
                              item === 'Certification'
                                ? 'certifications'
                                : item === 'Penalty'
                                  ? 'penalties'
                                  : 'verification'
                            }`
                      }
                      onClick={rememberScroll}
                    >
                      {t(item)}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <a key={label} href={`/#${icon}`}>
              <DashboardIcon name={icon} />
              <span>{t(label)}</span>
              {badge && <em>{badge}</em>}
            </a>
          )
        )}
        {secondaryNavigation.map(([icon, label]) =>
          icon === 'services' ? (
            <div key={label} className="sidebar-accordion">
              <button
                className={
                  location.pathname.startsWith('/catalog/')
                    ? 'sidebar-trigger section-active'
                    : 'sidebar-trigger'
                }
                type="button"
                aria-expanded={serviceOpen}
                onClick={() => toggleGroup('service', setServiceOpen)}
              >
                <DashboardIcon name={icon} />
                <span>{t(label)}</span>
                <b className={`nav-chevron ${serviceOpen ? 'open' : ''}`}>⌄</b>
              </button>
              {serviceOpen && (
                <div className="dashboard-subnav dashboard-catalog-subnav">
                  <NavLink to="/catalog/categories">{t('Category')}</NavLink>
                  <NavLink to="/catalog/services">{t('Services')}</NavLink>
                  <NavLink to="/catalog/brands">{t('AC Brands')}</NavLink>
                  <NavLink to="/catalog/models">{t('AC Models')}</NavLink>
                </div>
              )}
            </div>
          ) : icon === 'marketing' ? (
            <div key={label} className="sidebar-accordion">
              <button
                className={
                  location.pathname.startsWith('/admin/voucher') ||
                  location.pathname.startsWith('/admin/blog')
                    ? 'sidebar-trigger section-active'
                    : 'sidebar-trigger'
                }
                type="button"
                aria-expanded={marketingOpen}
                onClick={() => toggleGroup('marketing', setMarketingOpen)}
              >
                <DashboardIcon name={icon} />
                <span>{t(label)}</span>
                <b className={`nav-chevron ${marketingOpen ? 'open' : ''}`}>⌄</b>
              </button>
              {marketingOpen && (
                <div className="dashboard-subnav dashboard-catalog-subnav">
                  <NavLink to="/admin/blogs" onClick={rememberScroll}>
                    {t('Blog')}
                  </NavLink>
                  <NavLink to="/admin/vouchers" onClick={rememberScroll}>
                    {t('Voucher')}
                  </NavLink>
                  <NavLink to="/admin/voucher-usages" onClick={rememberScroll}>
                    {t('Usage History')}
                  </NavLink>
                </div>
              )}
            </div>
          ) : icon === 'complaint' ? (
            <NavLink key={label} to="/admin/complaints" onClick={rememberScroll}>
              <DashboardIcon name={icon} />
              <span>{t(label)}</span>
            </NavLink>
          ) : (
            <a key={label} href={`/#${icon}`}>
              <DashboardIcon name={icon} />
              <span>{t(label)}</span>
            </a>
          )
        )}
        <button
          className={`settings-trigger sidebar-trigger ${activePage === 'profile' ? 'settings-open section-active' : ''}`}
          type="button"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <DashboardIcon name="settings" />
          <span>{t('Settings')}</span>
          <b className={`nav-chevron ${settingsOpen ? 'open' : ''}`}>⌄</b>
        </button>
        {settingsOpen && (
          <div className="dashboard-subnav settings-subnav">
            {activePage === 'profile' ? (
              <button
                className={profileMode !== 'password' ? 'active' : ''}
                type="button"
                onClick={() => selectProfileMode('edit')}
              >
                {t('Profile')}
              </button>
            ) : (
              <Link to="/profile" onClick={rememberScroll}>
                {t('Profile')}
              </Link>
            )}
            {activePage === 'profile' ? (
              <button
                className={profileMode === 'password' ? 'active' : ''}
                type="button"
                onClick={() => selectProfileMode('password')}
              >
                {t('Change password')}
              </button>
            ) : (
              <Link to="/profile" state={{ mode: 'password' }} onClick={rememberScroll}>
                {t('Change password')}
              </Link>
            )}
          </div>
        )}
      </nav>
      <button className="dashboard-logout" type="button" onClick={onLogout}>
        {t('logout')}
      </button>
    </aside>
  )
}
