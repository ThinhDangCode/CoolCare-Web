import { useAuth } from '../../../context/AuthContext.jsx'
import { BellIcon } from '../../management/components/ManagementShared.jsx'
import './catalogTables.css'

export function CatalogLayout({
  children,
  heading,
  actions,
  onRefresh,
  refreshing = false,
  className = '',
}) {
  const { user } = useAuth()
  const initials = (user?.fullName || 'Admin User')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <main className={`dashboard-main ${className}`}>
      <header className="catalog-topbar">
        {heading && <div className="catalog-topbar-heading">{heading}</div>}
        <div className="catalog-topbar-controls">
          <button
            className="catalog-refresh"
            type="button"
            onClick={onRefresh ?? (() => window.location.reload())}
            aria-label="Refresh page"
            title="Refresh"
            disabled={refreshing}
          >
            ↻
          </button>
          <button className="catalog-notification" type="button" aria-label="Notifications">
            <BellIcon />
            <i />
          </button>
          {actions}
          <span
            className="catalog-avatar"
            style={user?.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}
          >
            {!user?.avatarUrl && initials}
          </span>
          <small>
            <strong>{user?.fullName || 'Admin User'}</strong>
            <em>Fleet Director</em>
          </small>
        </div>
      </header>
      {children}
    </main>
  )
}
