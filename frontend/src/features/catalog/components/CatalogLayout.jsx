import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { BellIcon } from '../../../shared/components/AdminUi.jsx'
import { LanguageControl, ThemeControl } from '../../../shared/components/PreferenceControls.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'

export function CatalogLayout({ children }) {
  const { user } = useAuth()
  const { t } = useUiPreferences()
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
          <LanguageControl />
          <button type="button" onClick={() => window.location.reload()}>
            ↻ <span>{t('Refresh')}</span>
          </button>
          <button className="catalog-notification" type="button" aria-label="Notifications">
            <BellIcon />
            <i />
          </button>
          <ThemeControl />
          <span
            className="catalog-avatar"
            style={user?.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}
          >
            {!user?.avatarUrl && initials}
          </span>
          <small>
            <strong>{user?.fullName || 'Admin User'}</strong>
            <em>{t('Fleet Director')}</em>
          </small>
        </div>
      </header>
      {children}
    </main>
  )
}
