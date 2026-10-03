import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './features/auth/components/ProtectedRoute.jsx'
import { LoginPage } from './features/auth/pages/LoginPage.jsx'
import { DashboardPage } from './features/dashboard/pages/DashboardPage.jsx'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
