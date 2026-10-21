import { label, formatDate, safeDocumentUrl } from './technicianFormat.js'
import { useState } from 'react'
import { useAutoDismiss } from '../../../shared/hooks/useAutoDismiss.js'
import { CheckIcon, CloseIcon } from '../../../shared/components/AdminUi.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'

export function TechnicianNotification({ message, onDismiss, danger = false }) {
  const hover = useAutoDismiss(danger ? '' : message, onDismiss)
  if (!message) return null
  return (
    <div
      className={`figma-toast${danger ? ' danger' : ''}`}
      role={danger ? 'alert' : 'status'}
      {...hover}
    >
      {danger ? (
        <span className="toast-symbol" aria-hidden="true">
          !
        </span>
      ) : (
        <CheckIcon />
      )}
      <span>{message}</span>
      <button type="button" aria-label="Dismiss notification" onClick={() => onDismiss('')}>
        <CloseIcon />
      </button>
    </div>
  )
}

export function TechnicianBadge({ value }) {
  const { t } = useUiPreferences()
  const tone = ['ACTIVE', 'VERIFIED', 'ONLINE'].includes(value)
    ? 'active'
    : ['REJECTED', 'EXPIRED', 'LOCKED'].includes(value)
      ? 'blocked'
      : ['PENDING', 'EXPIRING', 'BUSY'].includes(value)
        ? 'pending'
        : 'inactive'
  return (
    <span className={`figma-status ${tone}`}>
      <i />
      {t(label(value))}
    </span>
  )
}
export function TechnicianAvatar({ name, url }) {
  const [failed, setFailed] = useState('')
  const safeUrl = safeDocumentUrl(url)
  return (
    <span className="technician-avatar">
      {safeUrl && failed !== url ? (
        <img src={safeUrl} alt="" onError={() => setFailed(url)} />
      ) : (
        (name || 'T')
          .split(' ')
          .slice(-2)
          .map((s) => s[0])
          .join('')
      )}
    </span>
  )
}
export function DocumentLink({ url, children = 'View document' }) {
  const { t } = useUiPreferences()
  const safeUrl = safeDocumentUrl(url)
  return safeUrl ? (
    <a className="technician-view" href={safeUrl} target="_blank" rel="noopener noreferrer">
      {t(children)} ↗
    </a>
  ) : (
    <span className="technician-muted">{t('No document')}</span>
  )
}
export function CertificateTable({ items }) {
  const { t } = useUiPreferences()
  return (
    <div className="figma-users-table technician-table">
      <table>
        <thead>
          <tr>
            <th>{t('CERTIFICATE')}</th>
            <th>{t('NUMBER')}</th>
            <th>{t('ISSUED BY')}</th>
            <th>{t('ISSUED')}</th>
            <th>{t('EXPIRES')}</th>
            <th>{t('STATUS')}</th>
            <th>{t('DOCUMENT')}</th>
          </tr>
        </thead>
        <tbody>
          {!items.length && (
            <tr>
              <td colSpan={7}>
                <div className="figma-table-state">{t('No certifications submitted.')}</div>
              </td>
            </tr>
          )}
          {items.map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.certificate_name}</strong>
                {c.rejection_reason && (
                  <small className="technician-muted">{c.rejection_reason}</small>
                )}
              </td>
              <td>{c.certificate_number || '—'}</td>
              <td>{c.issued_by || '—'}</td>
              <td>{formatDate(c.issued_date)}</td>
              <td>{formatDate(c.expiry_date)}</td>
              <td>
                <TechnicianBadge value={c.status} />
              </td>
              <td>
                <DocumentLink url={c.document_url} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
