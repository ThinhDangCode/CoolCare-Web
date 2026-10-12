import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute } from './routes/ProtectedRoute.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { DashboardPage } from './pages/DashboardPage.jsx'
import { ProfilePage } from './pages/ProfilePage.jsx'
import { CatalogPage, CreateCatalogPage } from './features/catalog/pages/CatalogPage.jsx'
import { AcModelsPage, CreateAcModelPage } from './features/catalog/pages/AcModelsPage.jsx'
import { AdminLayout } from './shared/components/AdminLayout.jsx'
import { UsersPage } from './features/management/pages/UsersPage.jsx'
import { VouchersPage } from './features/management/pages/VouchersPage.jsx'
import { CreateVoucherPage } from './features/management/pages/CreateVoucherPage.jsx'
import { VoucherUsagePage } from './features/management/pages/VoucherUsagePage.jsx'
import { BlogsPage } from './features/management/pages/BlogsPage.jsx'
import { ComplaintsPage } from './features/management/pages/ComplaintsPage.jsx'
import { BlogEditorPage } from './features/management/pages/BlogEditorPage.jsx'
import { ComplaintDetailPage } from './features/management/pages/ComplaintDetailPage.jsx'
import { TechniciansPage } from './features/technicians/pages/TechniciansPage.jsx'
import { TechnicianDetailPage } from './features/technicians/pages/TechnicianDetailPage.jsx'
import { CertificationsPage } from './features/technicians/pages/CertificationsPage.jsx'
import { VerificationPage } from './features/technicians/pages/VerificationPage.jsx'
import { PenaltiesPage } from './features/technicians/pages/PenaltiesPage.jsx'
import { BookingsPage } from './features/bookings/pages/BookingsPage.jsx'
import { BookingDetailPage } from './features/bookings/pages/BookingDetailPage.jsx'
import './features/technicians/pages/technicianTypography.css'

function App() {
  const location = useLocation()

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />

        <Route element={<AdminLayout />}>
          <Route path="/admin/bookings" element={<BookingsPage />} />
          <Route path="/admin/bookings/:id" element={<BookingDetailPage key={location.pathname} />} />
          <Route path="/admin/technicians" element={<TechniciansPage />} />
          <Route path="/admin/technicians/certifications" element={<CertificationsPage />} />
          <Route path="/admin/technicians/verification" element={<VerificationPage />} />
          <Route path="/admin/technicians/penalties" element={<PenaltiesPage />} />
          <Route
            path="/admin/technicians/:id"
            element={<TechnicianDetailPage key={location.pathname} />}
          />
          <Route path="/catalog/models" element={<AcModelsPage />} />
          <Route path="/catalog/models/new" element={<CreateAcModelPage />} />
          <Route path="/catalog/:kind" element={<CatalogPage key={location.pathname} />} />
          <Route
            path="/catalog/:kind/new"
            element={<CreateCatalogPage key={location.pathname} />}
          />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/vouchers" element={<VouchersPage />} />
          <Route path="/admin/vouchers/new" element={<CreateVoucherPage />} />
          <Route path="/admin/voucher-usages" element={<VoucherUsagePage />} />
          <Route path="/admin/blogs" element={<BlogsPage />} />
          <Route path="/admin/blogs/new" element={<BlogEditorPage />} />
          <Route path="/admin/blogs/:id/edit" element={<BlogEditorPage />} />
          <Route path="/admin/complaints" element={<ComplaintsPage />} />
          <Route path="/admin/complaints/:id" element={<ComplaintDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
