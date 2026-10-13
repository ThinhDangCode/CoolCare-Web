import { useAuth } from '../context/AuthContext.jsx'
import { useUiPreferences } from '../context/UiPreferencesContext.jsx'
import { LanguageControl, ThemeControl } from './PreferenceControls.jsx'

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  )
}
export function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  )
}
export function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" />
    </svg>
  )
}
export function SortIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M7 12h10M10 17h4" />
    </svg>
  )
}
export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
export function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h10" />
    </svg>
  )
}
export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}
export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}
export function TicketIcon() {
  return (
    <img
      className="voucher-icon-image"
      src="/voucher-icon.png"
      width="20"
      height="16"
      alt=""
      aria-hidden="true"
    />
  )
}
export function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
      <path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14ZM5 13l.7 2.3L8 16l-2.3.7L5 19l-.7-2.3L2 16l2.3-.7L5 13Z" />
    </svg>
  )
}
export function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  )
}
export function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
export function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )
}
export function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}
export function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  )
}
export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  )
}
export function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h10m4 0h2M4 17h2m4 0h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  )
}
export function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="19" r="1" fill="currentColor" />
    </svg>
  )
}
export function LockIcon({ open = false }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d={open ? 'M9 10V7a4 4 0 0 1 7-2.5' : 'M8 10V7a4 4 0 0 1 8 0v3'} />
      <circle cx="12" cy="15" r="1" />
    </svg>
  )
}

export function PageHeader({ title, subtitle, children, onRefresh, refreshing = false }) {
  const { user } = useAuth()
  const { t } = useUiPreferences()
  const initials = (user?.fullName || 'Admin User')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <header className="figma-utility-header figma-title-header">
      <div className="figma-header-title">
        <h1>{t(title)}</h1>
        <p>{t(subtitle)}</p>
      </div>
      <div className="figma-header-actions">
        <LanguageControl />
        <button
          className="figma-refresh"
          type="button"
          disabled={refreshing}
          onClick={onRefresh ?? (() => window.location.reload())}
        >
          ↻ <span>{refreshing ? t('Refreshing') : t('Refresh')}</span>
        </button>
        <button className="figma-notification" aria-label="Notifications">
          <BellIcon />
          <i />
        </button>
        <ThemeControl />
        <span
          className="figma-admin-avatar"
          style={user?.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}
        >
          {!user?.avatarUrl && initials}
        </span>
        <small>
          <strong>{user?.fullName || 'Admin User'}</strong>
          <em>{t('Fleet Director')}</em>
        </small>
      </div>
      {children}
    </header>
  )
}

export function TableState({ loading, error, empty, colSpan, retry }) {
  const { t } = useUiPreferences()
  if (loading)
    return (
      <tr>
        <td colSpan={colSpan}>
          <div className="figma-table-state">
            <i className="figma-spinner" />
            {t('Loading data…')}
          </div>
        </td>
      </tr>
    )
  if (error)
    return (
      <tr>
        <td colSpan={colSpan}>
          <div className="figma-table-state error">
            <strong>{t('Unable to load data')}</strong>
            <span>{error}</span>
            <button onClick={retry}>{t('Try again')}</button>
          </div>
        </td>
      </tr>
    )
  if (empty)
    return (
      <tr>
        <td colSpan={colSpan}>
          <div className="figma-table-state">
            <strong>{t('No records found')}</strong>
            <span>{t('Try changing the search or filters.')}</span>
          </div>
        </td>
      </tr>
    )
  return null
}

export function Pagination({
  page,
  total,
  limit,
  loading,
  onPage,
  showTotal = false,
  pageSizeOptions,
  onLimit,
}) {
  const { t } = useUiPreferences()
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const start = Math.min(Math.max(1, page - 1), Math.max(1, totalPages - 3))
  const pages = Array.from({ length: Math.min(4, totalPages) }, (_, index) => start + index)
  const goToPage = (nextPage) => {
    if (loading || nextPage === page || nextPage < 1 || nextPage > totalPages) return
    onPage(nextPage)
  }
  return (
    <footer className="figma-pagination">
      {showTotal && <span>{total} records</span>}
      {pageSizeOptions?.length > 0 && onLimit && (
        <label className="figma-page-size">
          <span>{t('Show')}</span>
          <select
            aria-label={t('Rows per page')}
            value={limit}
            disabled={loading}
            onChange={(event) => onLimit(Number(event.target.value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span>{t('rows')}</span>
        </label>
      )}
      <nav>
        <button
          type="button"
          aria-label={t('Previous page')}
          disabled={page <= 1 || loading}
          onClick={() => goToPage(page - 1)}
        >
          ‹
        </button>
        {start > 1 && <span>…</span>}
        {pages.map((item) => (
          <button
            type="button"
            key={item}
            aria-current={page === item ? 'page' : undefined}
            aria-disabled={page === item || loading}
            className={page === item ? 'active' : ''}
            disabled={loading}
            onClick={() => goToPage(item)}
          >
            {item}
          </button>
        ))}
        {start + pages.length - 1 < totalPages && <span>…</span>}
        <button
          type="button"
          aria-label={t('Next page')}
          disabled={page >= totalPages || loading}
          onClick={() => goToPage(page + 1)}
        >
          ›
        </button>
      </nav>
    </footer>
  )
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm,
}) {
  return (
    <div className="figma-modal-backdrop" onMouseDown={() => !busy && onCancel()}>
      <div
        className="figma-confirm"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <div className="figma-confirm-copy">{children}</div>
        <footer>
          <button disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button disabled={busy} className={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {busy ? 'Processing…' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
