import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AdminSidebar } from './AdminSidebar.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useUiPreferences } from '../context/UiPreferencesContext.jsx'

export function AdminLayout() {
  const { user, logout } = useAuth()
  const { t } = useUiPreferences()
  const [showLogout, setShowLogout] = useState(false)

  return (
    <div className="dashboard-shell">
      <AdminSidebar user={user} activePage="catalog" onLogout={() => setShowLogout(true)} />
      <Outlet />

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
            aria-labelledby="catalog-logout-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="catalog-logout-title">{t('logoutTitle')}</h2>
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
