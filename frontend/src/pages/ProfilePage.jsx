import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, authApi } from '../services/authApi.js'
import { useAuth } from '../context/AuthContext.jsx'
import { AdminSidebar } from '../components/AdminSidebar.jsx'
import { uploadProfilePhoto } from '../services/cloudinaryApi.js'

const genderLabels = { MALE: 'Nam', FEMALE: 'Nữ', OTHER: 'Khác' }
const emptyForm = { fullName: '', phone: '', dateOfBirth: '', gender: '' }

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (
    parts.length
      ? parts
          .slice(-2)
          .map((part) => part[0])
          .join('')
      : 'AD'
  ).toUpperCase()
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M5 14v5h14v-5" />
    </svg>
  )
}

function validateProfile(form) {
  const errors = {}
  const name = form.fullName.trim()
  if (name.length < 2 || name.length > 100 || !/^[\p{L}\s'-]+$/u.test(name))
    errors.fullName = 'Họ tên từ 2–100 ký tự và không chứa số.'
  if (form.phone) {
    const phone = form.phone.replace(/[\s.-]/g, '')
    const localPhone = phone.startsWith('+84') ? `0${phone.slice(3)}` : phone
    const validPrefix = /^(?:0|\+84)(?:3[2-9]|5[25689]|7[06789]|8[1-689]|9[0-46-9])\d{7}$/.test(
      phone
    )
    if (!validPrefix || /^0(\d)\1{8}$/.test(localPhone))
      errors.phone = 'Nhập số điện thoại Việt Nam hợp lệ, không dùng dãy số lặp.'
  }
  if (form.dateOfBirth && new Date(form.dateOfBirth) > new Date())
    errors.dateOfBirth = 'Ngày sinh không thể ở tương lai.'
  return errors
}

function PasswordGlyph({ name, className = '' }) {
  const paths = {
    lock: (
      <>
        <rect x="5.5" y="10" width="13" height="10" rx="2" />
        <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
        <path d="M12 14v2.5" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 19 6v5c0 4.6-2.7 7.7-7 10-4.3-2.3-7-5.4-7-10V6l7-3Z" />
        <path d="m9.5 12 1.7 1.7 3.5-3.7" />
      </>
    ),
    eye: (
      <>
        <path d="M2.8 12s3.2-5 9.2-5 9.2 5 9.2 5-3.2 5-9.2 5-9.2-5-9.2-5Z" />
        <circle cx="12" cy="12" r="2.2" />
      </>
    ),
    eyeOff: (
      <>
        <path d="m4 4 16 16" />
        <path d="M10.6 7.2A10.5 10.5 0 0 1 12 7c6 0 9.2 5 9.2 5a15 15 0 0 1-2.1 2.6M6.3 6.4C4 7.8 2.8 12 2.8 12s3.2 5 9.2 5c1.3 0 2.5-.2 3.5-.6" />
      </>
    ),
    change: (
      <>
        <path d="M19 7v5h-5" />
        <path d="M18.1 16a7.5 7.5 0 1 1 .2-8.2L19 12" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M6.5 20v-2a5.5 5.5 0 0 1 11 0v2" />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="15" r="3.5" />
        <path d="m10.5 12.5 7-7M15 8l2 2M17 6l2 2" />
      </>
    ),
  }
  return (
    <svg
      className={`password-glyph ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

function PasswordField({
  label,
  value,
  onChange,
  error,
  autoComplete,
  placeholder,
  icon = 'lock',
}) {
  const [visible, setVisible] = useState(false)
  return (
    <label className="profile-field">
      <span>
        {label} <b>*</b>
      </span>
      <div className={`profile-input ${error ? 'invalid' : ''}`}>
        <PasswordGlyph name={icon} className="password-field-icon" />
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        >
          <PasswordGlyph name={visible ? 'eyeOff' : 'eye'} />
        </button>
      </div>
      {error && <small className="field-error">{error}</small>}
    </label>
  )
}

function UtilityIcon({ name }) {
  const paths = {
    portal: (
      <>
        <rect x="3.5" y="7" width="17" height="12" rx="2" />
        <path d="M8.5 7V5.5h7V7M3.5 11h17" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m16 16 4 4" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 6v5h-5" />
        <path d="M18.2 15a7 7 0 1 1-.2-8.2L20 11" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
  }
  return (
    <svg className="utility-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export function ProfilePage() {
  const { token, user, updateUser, logout, clearSession } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [mode, setMode] = useState(location.state?.mode === 'password' ? 'password' : 'edit')
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState({})
  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [pendingMode, setPendingMode] = useState('edit')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarStatus, setAvatarStatus] = useState('idle')
  const [profileRefresh, setProfileRefresh] = useState(0)
  const avatarInputRef = useRef(null)

  const dirty = useMemo(
    () =>
      profile &&
      ['fullName', 'phone', 'dateOfBirth', 'gender'].some((key) => {
        const profileValue = key === 'dateOfBirth' ? profile[key]?.slice(0, 10) : profile[key]
        return (form[key] || '') !== (profileValue || '')
      }),
    [form, profile]
  )

  useEffect(() => {
    let active = true
    authApi
      .getProfile(token)
      .then((data) => {
        if (!active) return
        setProfile(data)
        setAvatarUrl(data.avatarUrl ?? '')
        updateUser(data)
        setForm({
          fullName: data.fullName ?? '',
          phone: data.phone ?? '',
          dateOfBirth: data.dateOfBirth?.slice(0, 10) ?? '',
          gender: data.gender ?? '',
        })
        setStatus('ready')
      })
      .catch((error) => {
        if (!active) return
        if (error.status === 401) {
          clearSession()
          navigate('/login', { replace: true, state: { sessionExpired: true } })
          return
        }
        setMessage(error.message)
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [clearSession, navigate, token, profileRefresh, updateUser])

  function startMode(nextMode) {
    setMessage('')
    setErrors({})
    setMode(nextMode)
  }

  function requestMode(nextMode) {
    if (mode === 'edit' && dirty && nextMode !== 'edit') {
      setPendingMode(nextMode)
      setConfirmDiscard(true)
      return
    }
    startMode(nextMode)
  }

  function cancelEdit() {
    if (dirty) {
      setPendingMode('edit')
      return setConfirmDiscard(true)
    }
    startMode('edit')
  }

  async function handleAvatarChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setAvatarStatus('uploading')
    setMessage('')
    try {
      const url = await uploadProfilePhoto(file)
      const updated = await authApi.updateAvatar(token, url)
      setProfile(updated)
      setAvatarUrl(updated.avatarUrl ?? url)
      updateUser(updated)
      setMessage('Ảnh đại diện đã được tải lên thành công.')
    } catch (error) {
      if (error.status === 401) {
        clearSession()
        navigate('/login', { replace: true, state: { sessionExpired: true } })
        return
      }
      setMessage(error.message)
    } finally {
      setAvatarStatus('idle')
    }
  }

  async function removeAvatar() {
    setAvatarStatus('uploading')
    setMessage('')
    try {
      const updated = await authApi.updateAvatar(token, null)
      setProfile(updated)
      setAvatarUrl('')
      updateUser(updated)
      setMessage('Ảnh đại diện đã được gỡ thành công.')
    } catch (error) {
      if (error.status === 401) {
        clearSession()
        navigate('/login', { replace: true, state: { sessionExpired: true } })
        return
      }
      setMessage(error.message)
    } finally {
      setAvatarStatus('idle')
    }
  }

  async function saveProfile(event) {
    event.preventDefault()
    const nextErrors = validateProfile(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setStatus('saving')
    setMessage('')
    try {
      const updated = await authApi.updateProfile(token, {
        ...form,
        fullName: form.fullName.trim(),
        phone: form.phone.replace(/[\s.-]/g, '') || null,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
      })
      setProfile(updated)
      updateUser(updated)
      setStatus('ready')
      setMode('edit')
      setMessage('Hồ sơ đã được cập nhật thành công.')
    } catch (error) {
      if (error.status === 401) {
        clearSession()
        navigate('/login', { replace: true, state: { sessionExpired: true } })
        return
      }
      setErrors(error instanceof ApiError ? error.details : {})
      setMessage(error.message)
      setStatus('ready')
    }
  }

  async function changePassword(event) {
    event.preventDefault()
    const nextErrors = {}
    if (!passwords.currentPassword) nextErrors.currentPassword = 'Vui lòng nhập mật khẩu hiện tại.'
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/.test(passwords.newPassword))
      nextErrors.newPassword = 'Cần 8–72 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.'
    if (passwords.confirmPassword !== passwords.newPassword)
      nextErrors.confirmPassword = 'Mật khẩu xác nhận không khớp.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setStatus('saving')
    setMessage('')
    try {
      const result = await authApi.changePassword(token, {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      })
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setStatus('ready')
      setMode('password')
      setMessage(result.message)
    } catch (error) {
      if (error.status === 401 && error.code !== 'INVALID_CURRENT_PASSWORD') {
        clearSession()
        navigate('/login', { replace: true, state: { sessionExpired: true } })
        return
      }
      setMessage(error.message)
      setStatus('ready')
      if (error.code === 'INVALID_CURRENT_PASSWORD') setErrors({ currentPassword: error.message })
    }
  }

  return (
    <div className="dashboard-shell profile-shell">
      <AdminSidebar
        user={{ ...user, ...profile, avatarUrl: avatarUrl || user?.avatarUrl || '' }}
        activePage="profile"
        profileMode={mode}
        onProfileMode={requestMode}
        onLogout={logout}
      />
      <main className="dashboard-main">
        <header className="profile-utility profile-title-header">
          <div className="profile-utility-title">
            <h1>{mode === 'password' ? 'Password & Security' : 'Profile Settings'}</h1>
            <small>
              {mode === 'password'
                ? 'Update your administrator password regularly to protect system access, fleet operations, and technician dispatch privileges.'
                : 'Manage your administrator account details, personal credentials, and notification contact preferences.'}
            </small>
          </div>
          <div>
            <button
              type="button"
              disabled={status === 'loading'}
              onClick={() => {
                setStatus('loading')
                setMessage('')
                setProfileRefresh((value) => value + 1)
              }}
            >
              <UtilityIcon name="refresh" /> {status === 'loading' ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="notification-button" type="button" aria-label="Thông báo">
              <UtilityIcon name="bell" />
              <i />
            </button>
            <span className="utility-user">
              <i style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}>
                {!avatarUrl && initials(profile?.fullName ?? user?.fullName)}
              </i>
              <span>
                <strong>{profile?.fullName ?? user?.fullName ?? 'Marcus Vance'}</strong>
                <small>Fleet Director</small>
              </span>
            </span>
          </div>
        </header>
        <section className="profile-content">
          {status === 'loading' && (
            <div className="profile-card profile-state" aria-busy="true">
              <span className="spinner" />
              <h2>Đang tải hồ sơ</h2>
              <p>Vui lòng chờ trong giây lát...</p>
            </div>
          )}
          {status === 'error' && (
            <div className="profile-card profile-state error-state">
              <b>!</b>
              <h2>Không thể tải hồ sơ</h2>
              <p>{message}</p>
              <button onClick={() => location.reload()}>Thử lại</button>
            </div>
          )}
          {status !== 'loading' && status !== 'error' && profile && (
            <div className="profile-card">
              {mode !== 'password' && (
                <div className="profile-hero">
                  <div className="profile-avatar-wrap">
                    <span
                      className="profile-avatar"
                      style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
                    >
                      {!avatarUrl && initials(profile.fullName)}
                    </span>
                    <button
                      type="button"
                      aria-label="Đổi ảnh đại diện"
                      disabled={avatarStatus === 'uploading'}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <img src="/profile-avatar-badge.png" alt="" />
                    </button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      onChange={handleAvatarChange}
                    />
                  </div>
                  <div className="profile-identity">
                    <div>
                      <h2>{profile.fullName || 'Chưa cập nhật tên'}</h2>
                      <em>FLEET DIRECTOR</em>
                      <span>
                        <i /> Active Account
                      </span>
                    </div>
                    <p>
                      <button
                        type="button"
                        disabled={avatarStatus === 'uploading'}
                        onClick={() => avatarInputRef.current?.click()}
                      >
                        {avatarStatus === 'uploading' ? (
                          'Uploading...'
                        ) : (
                          <>
                            <UploadIcon /> Upload New Photo
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={!avatarUrl || avatarStatus === 'uploading'}
                        onClick={removeAvatar}
                      >
                        Remove Photo
                      </button>
                    </p>
                  </div>
                  <div className="profile-clearance">
                    <small>SECURITY CLEARANCE</small>
                    <strong>♙ Level 4 Fleet Controller</strong>
                    <span>MFA Enforced (FIDO2 Key)</span>
                  </div>
                </div>
              )}
              {message && (
                <div
                  className={`profile-alert ${message.includes('thành công') ? 'success' : ''}`}
                  role="status"
                >
                  {message}
                </div>
              )}
              {mode === 'view' && (
                <>
                  <div className="profile-section-title">
                    <div>
                      <h3>Thông tin hồ sơ</h3>
                      <p>Thông tin được sử dụng cho tài khoản quản trị CoolCare.</p>
                    </div>
                    <button onClick={() => startMode('edit')}>Chỉnh sửa</button>
                  </div>
                  <dl className="profile-details">
                    <div>
                      <dt>Họ và tên</dt>
                      <dd>{profile.fullName || 'Chưa cập nhật'}</dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{profile.email}</dd>
                    </div>
                    <div>
                      <dt>Số điện thoại</dt>
                      <dd>{profile.phone || 'Chưa cập nhật'}</dd>
                    </div>
                    <div>
                      <dt>Ngày sinh</dt>
                      <dd>
                        {profile.dateOfBirth
                          ? new Intl.DateTimeFormat('vi-VN').format(new Date(profile.dateOfBirth))
                          : 'Chưa cập nhật'}
                      </dd>
                    </div>
                    <div>
                      <dt>Giới tính</dt>
                      <dd>{genderLabels[profile.gender] || 'Chưa cập nhật'}</dd>
                    </div>
                    <div>
                      <dt>Vai trò</dt>
                      <dd>Admin</dd>
                    </div>
                  </dl>
                  <div className="profile-security-row">
                    <div>
                      <span>⌑</span>
                      <div>
                        <strong>Bảo mật tài khoản</strong>
                        <p>Nên thay đổi mật khẩu định kỳ để bảo vệ tài khoản.</p>
                      </div>
                    </div>
                    <button onClick={() => startMode('password')}>Đổi mật khẩu</button>
                  </div>
                </>
              )}
              {mode === 'edit' && (
                <form onSubmit={saveProfile}>
                  <div className="profile-form-grid">
                    <label className="profile-field">
                      <span>
                        Full Legal Name <b>*</b>
                      </span>
                      <span className="field-control">
                        ♙
                        <input
                          className={errors.fullName ? 'invalid' : ''}
                          value={form.fullName}
                          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                        />
                      </span>
                      {errors.fullName && <small className="field-error">{errors.fullName}</small>}
                    </label>
                    <label className="profile-field">
                      <span>Administrative Email Address</span>
                      <span className="field-control locked">
                        ✉<input value={profile.email} disabled />
                        <em>LOCK</em>
                      </span>
                    </label>
                    <label className="profile-field">
                      <span>
                        Direct Dispatch Phone <b>*</b>
                      </span>
                      <span className="field-control">
                        ⌕
                        <input
                          className={errors.phone ? 'invalid' : ''}
                          placeholder="+84 908 123 456"
                          value={form.phone}
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        />
                      </span>
                      {errors.phone && <small className="field-error">{errors.phone}</small>}
                    </label>
                    <label className="profile-field">
                      <span>Administrative Role &amp; Scope</span>
                      <span className="field-control locked">
                        ♙<input value="Fleet Director" disabled />
                      </span>
                    </label>
                    <label className="profile-field">
                      <span>Employee Identification Number</span>
                      <span className="field-control locked">
                        ▣<input value="CC-ADM-001" disabled />
                      </span>
                    </label>
                    <label className="profile-field">
                      <span>Assigned Department</span>
                      <span className="field-control">
                        ▥<input value="HVAC Operations & Fleet Management" readOnly />
                      </span>
                    </label>
                  </div>
                  <div className="profile-form-actions">
                    <p>☑&nbsp; All sessions synced across 2 active workstations</p>
                    <button type="button" onClick={cancelEdit}>
                      Cancel
                    </button>
                    <button className="primary" disabled={!dirty || status === 'saving'}>
                      {status === 'saving' ? (
                        <>
                          <span className="button-spinner" /> Saving...
                        </>
                      ) : (
                        '▣  Save Changes'
                      )}
                    </button>
                  </div>
                </form>
              )}
              {mode === 'password' && (
                <form className="password-form" onSubmit={changePassword}>
                  <div className="password-card-heading">
                    <span>
                      <PasswordGlyph name="change" />
                    </span>
                    <div>
                      <h2>Change Password</h2>
                      <p>
                        Enter your current password and choose a strong new password to safeguard
                        fleet oversight.
                      </p>
                    </div>
                  </div>
                  <div className="current-password-row">
                    <PasswordField
                      label="Current Password"
                      placeholder="Enter current password"
                      value={passwords.currentPassword}
                      onChange={(e) =>
                        setPasswords({ ...passwords, currentPassword: e.target.value })
                      }
                      error={errors.currentPassword}
                      autoComplete="current-password"
                    />
                  </div>
                  <PasswordField
                    label="New Password"
                    placeholder="Create a strong password"
                    value={passwords.newPassword}
                    onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                    error={errors.newPassword}
                    autoComplete="new-password"
                  />
                  <PasswordField
                    icon="shield"
                    label="Confirm New Password"
                    placeholder="Re-type your new password"
                    value={passwords.confirmPassword}
                    onChange={(e) =>
                      setPasswords({ ...passwords, confirmPassword: e.target.value })
                    }
                    error={errors.confirmPassword}
                    autoComplete="new-password"
                  />
                  <div className="profile-form-actions">
                    <button type="button" onClick={() => startMode('edit')}>
                      Cancel
                    </button>
                    <button className="primary" disabled={status === 'saving'}>
                      {status === 'saving' ? (
                        <>
                          <span className="button-spinner" /> Updating...
                        </>
                      ) : (
                        <>
                          <PasswordGlyph name="change" />
                          Update Password
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </section>
      </main>
      {confirmDiscard && (
        <div className="dialog-backdrop">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>Bỏ thay đổi?</h2>
            <p>Thông tin bạn vừa chỉnh sửa sẽ không được lưu.</p>
            <div className="confirm-dialog-actions">
              <button onClick={() => setConfirmDiscard(false)}>Tiếp tục chỉnh sửa</button>
              <button
                className="danger"
                onClick={() => {
                  setForm({
                    fullName: profile.fullName ?? '',
                    phone: profile.phone ?? '',
                    dateOfBirth: profile.dateOfBirth?.slice(0, 10) ?? '',
                    gender: profile.gender ?? '',
                  })
                  setConfirmDiscard(false)
                  startMode(pendingMode)
                }}
              >
                Bỏ thay đổi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
