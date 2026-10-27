import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Brand } from './Brand.jsx'
import { adminRequest } from '../api/adminApi.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUiPreferences } from '../context/UiPreferencesContext.jsx'
import './AdminSidebar.css'

const mainNavigation = [
  ['booking', 'Booking'],
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
  const { token } = useAuth()
  const location = useLocation()
  const sidebarRef = useRef(null)
  const [bookingTotal, setBookingTotal] = useState(null)
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
  const analyticsActive = location.pathname.startsWith('/admin/analytics/')
  const [analyticsOpen, setAnalyticsOpen] = useState(
    () => analyticsActive || sessionStorage.getItem('admin-sidebar-analytics') === 'true'
  )
  const walletActive =
    location.pathname.startsWith('/admin/withdrawals') ||
    location.pathname.startsWith('/admin/topups') ||
    location.pathname.startsWith('/admin/settlements')
  const financeActive =
    location.pathname.startsWith('/admin/payments') ||
    location.pathname.startsWith('/admin/invoices') ||
    location.pathname.startsWith('/admin/revenue') ||
    walletActive
  const [financeOpen, setFinanceOpen] = useState(
    () => financeActive || sessionStorage.getItem('admin-sidebar-finance') === 'true'
  )
  const [walletOpen, setWalletOpen] = useState(
    () => walletActive || sessionStorage.getItem('admin-sidebar-wallet') === 'true'
  )
  const [settingsOpen, setSettingsOpen] = useState(activePage === 'profile')
  const [failedAvatarUrl, setFailedAvatarUrl] = useState('')

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current
    if (sidebar) sidebar.scrollTop = Number(sessionStorage.getItem('admin-sidebar-scroll') || 0)
  }, [])

  useEffect(() => {
    if (!token) return undefined
    const controller = new AbortController()
    adminRequest('/bookings?page=1&limit=1', token, { signal: controller.signal })
      .then((result) => setBookingTotal(Number(result.total) || 0))
      .catch((error) => {
        if (error.name !== 'AbortError') setBookingTotal(null)
      })
    return () => controller.abort()
  }, [token])

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
          <small>Admin</small>
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
              {bookingTotal !== null && <em>{bookingTotal.toLocaleString()}</em>}
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
                  <NavLink to="/catalog/skills">{t('Skill Management')}</NavLink>
                </div>
              )}
            </div>
          ) : icon === 'finance' ? (
            <div key={label} className="sidebar-accordion">
              <button
                className={`sidebar-trigger ${financeActive ? 'section-active' : ''}`}
                type="button"
                aria-expanded={financeOpen}
                aria-controls="admin-finance-navigation"
                onClick={() => toggleGroup('finance', setFinanceOpen)}
              >
                <DashboardIcon name={icon} />
                <span>{t(label)}</span>
                <b className={`nav-chevron ${financeOpen ? 'open' : ''}`}>⌄</b>
              </button>
              {financeOpen && (
                <div
                  id="admin-finance-navigation"
                  className="dashboard-subnav dashboard-catalog-subnav finance-subnav"
                >
                  <NavLink to="/admin/payments" onClick={rememberScroll}>
                    {t('Payments')}
                  </NavLink>
                  <NavLink to="/admin/revenue" onClick={rememberScroll}>
                    {t('Revenue')}
                  </NavLink>
                  <button
                    className="dashboard-subnav-action finance-wallet-trigger"
                    type="button"
                    aria-expanded={walletOpen}
                    aria-controls="admin-wallet-navigation"
                    onClick={() => toggleGroup('wallet', setWalletOpen)}
                  >
                    {t('Wallet')}
                    <b className={`nav-chevron ${walletOpen ? 'open' : ''}`}>⌄</b>
                  </button>
                  {walletOpen && (
                    <div id="admin-wallet-navigation" className="finance-wallet-subnav">
                      <NavLink to="/admin/withdrawals" onClick={rememberScroll}>
                        {t('Withdrawal')}
                      </NavLink>
                      <NavLink to="/admin/topups" onClick={rememberScroll}>
                        {t('Top-up')}
                      </NavLink>
                      <NavLink to="/admin/settlements" onClick={rememberScroll}>
                        {t('Settlements')}
                      </NavLink>
                    </div>
                  )}
                  <NavLink to="/admin/invoices" onClick={rememberScroll}>
                    {t('Invoice')}
                  </NavLink>
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
          ) : icon === 'analytics' ? (
            <div key={label} className="sidebar-accordion">
              <button
                className={`sidebar-trigger ${analyticsActive ? 'section-active' : ''}`}
                type="button"
                aria-expanded={analyticsOpen}
                aria-controls="admin-analytics-navigation"
                onClick={() => toggleGroup('analytics', setAnalyticsOpen)}
              >
                <DashboardIcon name={icon} />
                <span>{t(label)}</span>
                <b className={`nav-chevron ${analyticsOpen ? 'open' : ''}`}>⌄</b>
              </button>
              {analyticsOpen && (
                <div
                  id="admin-analytics-navigation"
                  className="dashboard-subnav dashboard-catalog-subnav analytics-subnav"
                >
                  <NavLink to="/admin/analytics/customers" onClick={rememberScroll}>
                    {t('Customer Analytics')}
                  </NavLink>
                  <NavLink to="/admin/analytics/technicians" onClick={rememberScroll}>
                    {t('Technician Analytics')}
                  </NavLink>
                  <NavLink to="/admin/analytics/reports" onClick={rememberScroll}>
                    {t('Reports')}
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
