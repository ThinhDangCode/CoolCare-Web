import { useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss.js'
import { CheckIcon, CloseIcon } from '../../management/components/ManagementShared.jsx'

export function TechnicianNotification({ message, onDismiss, danger = false }) {
  const hover = useAutoDismiss(danger ? '' : message, onDismiss)
  if (!message) return null
  return (
    <div className={`figma-toast${danger ? ' danger' : ''}`} role={danger ? 'alert' : 'status'} {...hover}>
      {danger ? <span className="toast-symbol" aria-hidden="true">!</span> : <CheckIcon />}
      <span>{message}</span>
      <button type="button" aria-label="Dismiss notification" onClick={() => onDismiss('')}><CloseIcon /></button>
    </div>
  )
}

const labels = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
  EXPERT: 'Expert',
  PENDING: 'Pending review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  EXPIRING: 'Expiring soon',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  LOCKED: 'Blocked',
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  BUSY: 'Busy',
}
export const label = (value) => labels[value] ?? value ?? '—'
export const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB') : '—')
export function safeDocumentUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
export function TechnicianBadge({ value }) {
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
      {label(value)}
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
  const safeUrl = safeDocumentUrl(url)
  return safeUrl ? (
    <a className="technician-view" href={safeUrl} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  ) : (
    <span className="technician-muted">No document</span>
  )
}
export function CertificateTable({ items }) {
  return (
    <div className="figma-users-table technician-table">
      <table>
        <thead>
          <tr>
            <th>CERTIFICATE</th>
            <th>NUMBER</th>
            <th>ISSUED BY</th>
            <th>ISSUED</th>
            <th>EXPIRES</th>
            <th>STATUS</th>
            <th>DOCUMENT</th>
          </tr>
        </thead>
        <tbody>
          {!items.length && (
            <tr>
              <td colSpan={7}>
                <div className="figma-table-state">No certifications submitted.</div>
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
