import { useAuth } from '../../../context/AuthContext.jsx'

export function CatalogLayout({ children }) {
  const { user } = useAuth()
  return     <main className="dashboard-main">
      <header className="catalog-topbar"><span>Workspace <b>/</b> <strong>Service & AC Catalog</strong></span><div><span className="catalog-system"><i /> System online</span><span className="catalog-avatar">{user?.fullName?.slice(0, 1) || 'A'}</span></div></header>
      {children}
    </main>

}
