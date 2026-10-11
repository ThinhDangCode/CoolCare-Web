import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AdminSidebar } from '../../components/AdminSidebar.jsx'
import { useAuth } from '../../context/AuthContext.jsx'

export function AdminLayout() {
  const { user, logout } = useAuth()
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
            <h2 id="catalog-logout-title">Bạn có chắc muốn đăng xuất?</h2>
            <p>Phiên đăng nhập quản trị hiện tại sẽ kết thúc.</p>
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
    </div>
  )
}
