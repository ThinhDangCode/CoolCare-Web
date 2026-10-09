import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute } from './features/auth/components/ProtectedRoute.jsx'
import { LoginPage } from './features/auth/pages/LoginPage.jsx'
import { DashboardPage } from './features/dashboard/pages/DashboardPage.jsx'
import { CatalogPage, CreateCatalogPage } from './features/catalog/pages/CatalogPage.jsx'
import { AdminLayout } from './shared/components/AdminLayout.jsx'
import { AcModelsPage, CreateAcModelPage } from './features/catalog/pages/AcModelsPage.jsx'
import { ProfilePage } from './pages/ProfilePage.jsx'

function App() {
  const location = useLocation()
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AdminLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/catalog/models" element={<AcModelsPage />} />
        <Route path="/catalog/models/new" element={<CreateAcModelPage />} />
        <Route path="/catalog/:kind" element={<CatalogPage key={location.pathname} />} />
        <Route path="/catalog/:kind/new" element={<CreateCatalogPage key={location.pathname} />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
