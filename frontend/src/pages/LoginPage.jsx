import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function LoginPage() {
  const { isAuthenticated, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '', remember: true })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isAuthenticated) return <Navigate to="/" replace />

  const updateField = ({ target }) => {
    const value = target.type === 'checkbox' ? target.checked : target.value
    setForm((current) => ({ ...current, [target.name]: value }))
    setError('')
  }

  const submit = async (event) => {
    event.preventDefault()
    const email = form.email.trim()
    if (!email || !form.password) {
      setError('Vui lòng nhập đầy đủ email và mật khẩu.')
      return
    }
    if (!emailPattern.test(email)) {
      setError('Email không đúng định dạng.')
      return
    }

    setIsSubmitting(true)
    setError('')
    try {
      await login(form)
      navigate(location.state?.from?.pathname ?? '/', { replace: true })
    } catch (requestError) {
      setError(requestError.message ?? 'Đăng nhập không thành công.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-visual" aria-label="Giới thiệu hệ thống CoolCare">
        <div className="admin-visual-glow" aria-hidden="true" />

        <div className="admin-brand-lockup">
          <span className="admin-brand-mark" aria-hidden="true">
            <img src="/coolcare-logo.png" alt="" />
          </span>
          <span className="admin-brand-copy">
            <span className="admin-brand-line">
              <strong>CoolCare</strong>
              <em>ADMIN</em>
            </span>
            <small>HVAC Service Platform</small>
          </span>
        </div>

        <div className="admin-visual-body">
          <span className="system-status">
            <i /> Hệ thống vận hành ổn định
          </span>
          <h2>
            <span>Vận hành dịch vụ HVAC</span>
            <br />
            thông minh hơn.
          </h2>
          <p>
            Theo dõi lịch hẹn, kỹ thuật viên và chất lượng dịch vụ trong
            <br className="desktop-only" /> một không gian quản trị tập trung.
          </p>

          <section className="operation-card" aria-label="Tổng quan vận hành">
            <header>
              <span>
                <strong>Tổng quan vận hành</strong>
                <small>Cập nhật 5 phút trước</small>
              </span>
              <em>
                <i /> LIVE
              </em>
            </header>
            <div className="operation-stats">
              <span>
                <small>Lịch hẹn hôm nay</small>
                <strong>
                  <i className="orange-dot" />
                  48
                </strong>
              </span>
              <span>
                <small>Kỹ thuật viên</small>
                <strong>
                  <i className="green-dot" />
                  36 online
                </strong>
              </span>
              <span>
                <small>Hoàn thành</small>
                <strong>
                  <i className="blue-dot" />
                  92%
                </strong>
              </span>
            </div>
            <div className="operation-job">
              <span className="job-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M5 7h14v9H5zM8 16v2h8v-2M8 10h8M8 13h5" />
                </svg>
              </span>
              <span>
                <strong>Bảo trì điều hòa trung tâm</strong>
                <small>#BK-0421 · Quận Bình Thạnh · Đang thực hiện</small>
              </span>
              <em>90 phút</em>
            </div>
          </section>
        </div>

        <footer>© 2026 CoolCare. Nền tảng quản trị dịch vụ HVAC.</footer>
      </section>

      <section className="admin-login-content">
        <header className="admin-login-topbar">
          <span>CỔNG QUẢN TRỊ VIÊN</span>
          <button type="button" aria-label="Ngôn ngữ">
            VI⌄
          </button>
        </header>

        <div className="admin-login-form-wrap">
          <form className="admin-login-form" onSubmit={submit} noValidate>
            <header>
              <h1>Chào mừng trở lại</h1>
              <p>Đăng nhập để tiếp tục quản lý hoạt động của CoolCare.</p>
            </header>

            {location.state?.sessionExpired && (
              <div className="form-notice" role="status">
                Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.
              </div>
            )}

            <label className="admin-field">
              <span>Email</span>
              <span className="admin-input-wrap">
                <span className="admin-input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M4 6h16v12H4z" />
                    <path d="m4 7 8 6 8-6" />
                  </svg>
                </span>
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  placeholder="admin@coolcare.vn"
                  value={form.email}
                  onChange={updateField}
                  disabled={isSubmitting}
                />
              </span>
            </label>

            <label className="admin-field">
              <span>Mật khẩu</span>
              <span className="admin-input-wrap">
                <span className="admin-input-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="10" width="14" height="10" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  value={form.password}
                  onChange={updateField}
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M3 12s3.3-5 9-5 9 5 9 5-3.3 5-9 5-9-5-9-5Z" />
                    <circle cx="12" cy="12" r="2.5" />
                    {showPassword && <path d="m4 4 16 16" />}
                  </svg>
                </button>
              </span>
            </label>

            <div className="admin-login-options">
              <label>
                <input
                  type="checkbox"
                  name="remember"
                  checked={form.remember}
                  onChange={updateField}
                />{' '}
                Ghi nhớ đăng nhập
              </label>
            </div>

            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="admin-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}{' '}
              {!isSubmitting && <span aria-hidden="true">→</span>}
            </button>

            <p className="admin-security-note">
              <span aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z" />
                  <path d="m9.5 12 1.7 1.7 3.6-3.9" />
                </svg>
              </span>
              Phiên đăng nhập được mã hóa và tự động khóa sau 15 phút không hoạt động.
            </p>
          </form>
        </div>

        <footer>
          Bạn cần hỗ trợ? <a href="mailto:support@coolcare.vn">Liên hệ bộ phận kỹ thuật</a>
        </footer>
      </section>
    </main>
  )
}
