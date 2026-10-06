import { Outlet } from 'react-router-dom'
import { AdminSidebar } from './AdminSidebar.jsx'

export function AdminLayout() {
  return <div className="dashboard-shell"><AdminSidebar /><Outlet /></div>
}
