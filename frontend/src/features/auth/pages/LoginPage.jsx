import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { PreferenceControls } from '../../../shared/components/PreferenceControls.jsx'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const loginErrorMessages = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  ACCOUNT_UNAVAILABLE: 'This account is currently unavailable.',
  EMAIL_NOT_VERIFIED: 'Your email has not been verified. Please verify it before signing in.',
  GOOGLE_SIGN_IN_REQUIRED: 'This account uses Google sign-in.',
  ADMIN_ONLY: 'This portal is only available to administrators.',
  INTERNAL_SERVER_ERROR: 'The system is busy. Please try again later.',
  REQUEST_FAILED: 'Request failed. Please try again.',
}

export function LoginPage() {
  const { isAuthenticated, login } = useAuth()
  const { t, locale } = useUiPreferences()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '', remember: true })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [overview, setOverview] = useState(null)
  const [overviewError, setOverviewError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/public/overview', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Overview unavailable')
        return response.json()
      })
      .then((body) => setOverview(body.data))
      .catch(() => { if (!controller.signal.aborted) setOverviewError(true) })
    return () => controller.abort()
  }, [])

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
      setError('Please enter both your email and password.')
      return
    }
    if (!emailPattern.test(email)) {
      setError('Please enter a valid email address.')
      return
    }

    setIsSubmitting(true)
    setError('')
    try {
      await login(form)
      navigate(location.state?.from?.pathname ?? '/', { replace: true })
    } catch (requestError) {
      setError(
        requestError.code === 'NETWORK_ERROR'
          ? 'Unable to connect to CoolCare right now. Please try again in a moment.'
          : (loginErrorMessages[requestError.code] ??
              'Sign-in was unsuccessful. Please try again.')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-visual" aria-label={t('CoolCare system introduction')}>
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
            <i /> {overviewError ? t('Live data unavailable') : overview ? t('System operating normally') : t('Loading live data…')}
          </span>
          <h2>{t('Smarter HVAC service operations.')}</h2>
          <p>
            {t(
              'Track appointments, technicians, and service quality in one centralized administration space.'
            )}
          </p>

          <section className="operation-card" aria-label={t('Operations overview')}>
            <header>
              <span>
                <strong>{t('Operations overview')}</strong>
                <small>{overview ? `${t('Updated at')} ${new Date(overview.updated_at).toLocaleTimeString(locale === 'vi' ? 'vi-VN' : 'en-US')}` : t(overviewError ? 'Live data unavailable' : 'Loading live data…')}</small>
              </span>
              <em>
                <i /> LIVE
              </em>
            </header>
            <div className="operation-stats">
              <span>
                <small>{t("Today's appointments")}</small>
                <strong>
                  <i className="orange-dot" />
                  {overview?.today_appointments ?? '—'}
                </strong>
              </span>
              <span>
                <small>{t('Technicians')}</small>
                <strong>
                  <i className="green-dot" />
                  {overview?.online_technicians ?? '—'}
                </strong>
              </span>
              <span>
                <small>{t('Completed today')}</small>
                <strong>
                  <i className="blue-dot" />
                  {overview?.completed_today ?? '—'}
                </strong>
              </span>
            </div>
          </section>
        </div>

        <footer>© 2026 CoolCare. {t('CoolCare HVAC service administration platform.')}</footer>
      </section>

      <section className="admin-login-content">
        <header className="admin-login-topbar">
          <span>{t('portal')}</span>
          <PreferenceControls compact />
        </header>

        <div className="admin-login-form-wrap">
          <form className="admin-login-form" onSubmit={submit} noValidate>
            <header>
              <h1>{t('welcome')}</h1>
              <p>{t('loginSubtitle')}</p>
            </header>

            {location.state?.sessionExpired && (
              <div className="form-notice" role="status">
                {t('Your session has expired. Please sign in again.')}
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
              <span>{t('password')}</span>
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
                  aria-label={t(showPassword ? 'Hide password' : 'Show password')}
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
                {t('remember')}
              </label>
            </div>

            {error && (
              <div className="form-error" role="alert">
                {t(error)}
              </div>
            )}
            <button className="admin-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('loggingIn') : t('login')}{' '}
              {!isSubmitting && <span aria-hidden="true">→</span>}
            </button>

            <p className="admin-security-note">
              <span aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z" />
                  <path d="m9.5 12 1.7 1.7 3.6-3.9" />
                </svg>
              </span>
              {t(
                'Your session is encrypted and automatically locks after 15 minutes of inactivity.'
              )}
            </p>
          </form>
        </div>

        <footer>
          {t('Need help?')}{' '}
          <a href="mailto:support@coolcare.vn">{t('Contact technical support')}</a>
        </footer>
      </section>
    </main>
  )
}
