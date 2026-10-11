import { useAuth } from '../../../context/AuthContext.jsx'
import { BellIcon } from '../../management/components/ManagementShared.jsx'

export function CatalogLayout({ children }) {
  const { user } = useAuth()
  const initials = (user?.fullName || 'Admin User')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <main className="dashboard-main">
      <header className="catalog-topbar">
        <div>
          <button type="button" onClick={() => window.location.reload()}>
            ↻ <span>Refresh</span>
          </button>
          <button className="catalog-notification" type="button" aria-label="Notifications">
            <BellIcon />
            <i />
          </button>
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
