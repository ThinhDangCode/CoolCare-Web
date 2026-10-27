import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  PageHeader,
  Pagination,
  SearchIcon,
  EyeIcon,
  CloseIcon,
  TableState,
} from '../../../shared/components/AdminUi.jsx'
import { DocumentLink, TechnicianNotification } from '../components/TechnicianShared.jsx'
import { formatDate, safeDocumentUrl } from '../components/technicianFormat.js'
import '../../../shared/styles/admin.css'
import './technicians.css'
import './certifications.css'

const statusLabels = {
  VERIFIED: 'Active',
  PENDING: 'Under Review',
  REJECTED: 'Rejected',
  EXPIRING: 'Expiring Soon',
  EXPIRED: 'Expired',
}
function CertificateStatus({ value }) {
  const { t } = useUiPreferences()
  return (
    <span className={`certification-status ${value.toLowerCase()}`}>
      <i />
      {t(statusLabels[value] || value)}
    </span>
  )
}
function CertificateDialog({ certificate, onClose, onSuccess }) {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const pending = certificate.verification_status === 'PENDING'
  const ref = useRef(null)
  useEffect(() => {
    ref.current.showModal()
  }, [])
  async function review(decision) {
    if (busy) return
    if (decision === 'REJECTED' && reason.trim().length < 5) {
      setError(t('Enter a rejection reason containing at least 5 characters.'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await adminRequest(`/technicians/certifications/${certificate.id}/review`, token, {
        method: 'PATCH',
        body: {
          status: decision,
          expected_updated_at: certificate.updated_at,
          ...(decision === 'REJECTED' ? { reason: reason.trim() } : {}),
        },
      })
      onSuccess(decision)
    } catch (cause) {
      setError(cause.message)
      if (cause.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={ref}
      className="certification-dialog"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onClose()
      }}
      aria-labelledby="certificate-title"
    >
      <header>
        <div>
          <small>{t('CERTIFICATION DETAILS')}</small>
          <h2 id="certificate-title">{certificate.certificate_name}</h2>
        </div>
        <button disabled={busy} autoFocus aria-label={t('Close details')} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <CertificateStatus value={certificate.status} />
      <dl>
        <div>
          <dt>{t('Certificate ID / number')}</dt>
          <dd>{certificate.certificate_number || certificate.id}</dd>
        </div>
        <div>
          <dt>{t('Technician')}</dt>
          <dd>
            <Link to={`/admin/technicians/${certificate.technician_id}?tab=certifications`}>
              {certificate.full_name}
            </Link>
          </dd>
        </div>
        <div>
          <dt>{t('Issuer')}</dt>
          <dd>{certificate.issued_by || '—'}</dd>
        </div>
        <div>
          <dt>{t('Issued date')}</dt>
          <dd>{formatDate(certificate.issued_date)}</dd>
        </div>
        <div>
          <dt>{t('Expiry date')}</dt>
          <dd>{formatDate(certificate.expiry_date)}</dd>
        </div>
        <div>
          <dt>{t('Reviewed at')}</dt>
          <dd>{formatDate(certificate.reviewed_at)}</dd>
        </div>
      </dl>
      {certificate.rejection_reason && (
        <p className="certification-reason">{certificate.rejection_reason}</p>
      )}
      <section className="certificate-document-review">
        <h3>{t('Submitted certificate document')}</h3>
        <DocumentLink url={certificate.document_url}>{t('Open certificate document')}</DocumentLink>
        {safeDocumentUrl(certificate.document_url) && /\.(png|jpe?g|webp|gif)([?#].*)?$/i.test(certificate.document_url) && (
          <img src={safeDocumentUrl(certificate.document_url)} alt={t('Submitted certificate document')} />
        )}
      </section>
      {pending && <p>{t('Review the information and submitted document before approving or rejecting.')}</p>}
      {rejecting && (
        <label className="certificate-rejection-input">
          {t('Rejection reason')}
          <textarea
            required
            minLength={5}
            maxLength={1000}
            disabled={busy}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      )}
      {error && <p className="certification-reason" role="alert">{t(error)}</p>}
      <footer>
        <button disabled={busy} onClick={onClose}>{t('Close')}</button>
        {pending && (
          <div className="certificate-review-decisions">
            {rejecting ? (
              <>
                <button disabled={busy} onClick={() => { setRejecting(false); setError('') }}>
                  {t('Cancel rejection')}
                </button>
                <button className="reject" disabled={busy || reason.trim().length < 5} onClick={() => review('REJECTED')}>
                  {busy ? t('Saving…') : t('Confirm reject')}
                </button>
              </>
            ) : (
              <>
                <button className="reject" disabled={busy} onClick={() => setRejecting(true)}>
                  {t('Reject')}
                </button>
                <button className="approve" disabled={busy || !safeDocumentUrl(certificate.document_url)} onClick={() => review('VERIFIED')}>
                  {busy ? t('Saving…') : t('Approve')}
                </button>
              </>
            )}
          </div>
        )}
      </footer>
    </dialog>
  )
}
export function CertificationsPage() {
  const { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('ALL')
  const [type, setType] = useState('ALL')
  const [issuer, setIssuer] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [data, setData] = useState({ items: [], total: 0, issuers: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState(null)
  const [compact, setCompact] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(search.trim())
      setPage(1)
      setRefresh((n) => n + 1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ search: keyword, status, type, issuer, page, limit })
    adminRequest(`/technicians/certifications?${query}`, token, { signal: controller.signal })
      .then((result) => {
        setData(result)
        setError('')
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message)
          if (err.status === 401) logout()
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [token, logout, keyword, status, type, issuer, page, limit, refresh])
  const retry = () => {
    setLoading(true)
    setRefresh((n) => n + 1)
  }
  const filter = (setter, value) => {
    setLoading(true)
    setPage(1)
    setter(value)
  }
  const first = data.total ? (page - 1) * limit + 1 : 0
  const last = Math.min(page * limit, data.total)
  return (
    <main
      className={`figma-admin-main technician-main certification-page ${compact ? 'is-compact' : ''}`}
    >
      <PageHeader
        title={t('Technician Certifications')}
        subtitle={t('{count} professional certifications', { count: data.total })}
        onRefresh={retry}
        refreshing={loading}
      />
      <section className="certification-content">
        <TechnicianNotification message={notice} onDismiss={setNotice} />
        <div className="certification-card">
          <div className="certification-toolbar">
            <label className="certification-search">
              <SearchIcon />
              <input
                maxLength={150}
                aria-label="Search certifications"
                placeholder={t('Search certificate name, code, technician name')}
                value={search}
                onChange={(e) => {
                  setLoading(true)
                  setSearch(e.target.value)
                }}
              />
            </label>
            <select
              aria-label="Document type"
              title="Filter by certificate document format"
              value={type}
              onChange={(e) => filter(setType, e.target.value)}
            >
              <option value="ALL">{t('All Document Types')}</option>
              <option value="PDF">PDF</option>
              <option value="IMAGE">{t('Image')}</option>
              <option value="OTHER">{t('Other / No document')}</option>
            </select>
            <select
              aria-label="Certification status"
              value={status}
              onChange={(e) => filter(setStatus, e.target.value)}
            >
              <option value="ALL">{t('All Status')}</option>
              {Object.entries(statusLabels).map(([value, text]) => (
                <option key={value} value={value}>
                  {t(text)}
                </option>
              ))}
            </select>
            <select
              aria-label="Issuer"
              value={issuer}
              onChange={(e) => filter(setIssuer, e.target.value)}
            >
              <option value="">{t('Issuer')}</option>
              {(data.issuers || []).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <button
              className="certification-tool"
              disabled={loading}
              aria-label="Refresh certifications"
              title="Refresh certifications"
              onClick={retry}
            >
              ↻
            </button>
            <button
              className={`certification-tool ${compact ? 'active' : ''}`}
              aria-label="Compact table"
              title="Toggle compact rows"
              aria-pressed={compact}
              onClick={() => setCompact((value) => !value)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="5" width="16" height="14" rx="2" />
                <path d="M9 5v14m6-14v14" />
              </svg>
            </button>
          </div>
          <div className="certification-table-scroll">
            <table className="certification-table">
              <thead>
                <tr>
                  <th>{t('CERT ID')}</th>
                  <th>{t('CERTIFICATE NAME')}</th>
                  <th>{t('TECHNICIAN')}</th>
                  <th>{t('STATUS')}</th>
                  <th>{t('ACTIONS')}</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  loading={loading}
                  error={error}
                  empty={!data.items.length}
                  colSpan={5}
                  retry={retry}
                />
                {!loading &&
                  !error &&
                  data.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <button
                          className={`certification-code ${c.status === 'EXPIRED' ? 'expired' : ''}`}
                          title={c.id}
                          onClick={() => setSelected(c)}
                        >
                          {c.certificate_number || c.id.slice(0, 8)}
                        </button>
                      </td>
                      <td>{c.certificate_name}</td>
                      <td>
                        <Link
                          className="certification-technician"
                          to={`/admin/technicians/${c.technician_id}?tab=certifications`}
                        >
                          {c.full_name}
                        </Link>
                      </td>
                      <td>
                        <CertificateStatus value={c.status} />
                      </td>
                      <td>
                        <div className="certification-actions">
                          <button
                            className="certification-action view"
                            aria-label={`${t('View certificate details')}: ${c.certificate_name} — ${c.full_name}`}
                            title={t('View certificate details')}
                            onClick={() => setSelected(c)}
                          >
                            <EyeIcon />
                          </button>
                          {safeDocumentUrl(c.document_url) ? (
                            <a
                              className="certification-action document"
                              href={safeDocumentUrl(c.document_url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open document — ${c.full_name}`}
                              title="Open certificate document"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6" />
                              </svg>
                            </a>
                          ) : (
                            <button
                              className="certification-action document"
                              disabled
                              title="No document available"
                              aria-label="No document available"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M6 3h8l4 4v14H6V3Zm8 0v5h4" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="certification-footer">
            <div>
              {t('Showing {first}–{last} of {total} certifications', { first, last, total: data.total })}{' '}
              <label>
                {t('Rows')}:{' '}
                <select
                  aria-label="Rows per page"
                  value={limit}
                  onChange={(e) => filter(setLimit, Number(e.target.value))}
                >
                  {[10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n} / {t('page')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Pagination
              page={page}
              total={data.total}
              limit={limit}
              loading={loading}
              onPage={(n) => filter(setPage, n)}
            />
          </div>
        </div>
      </section>
      {selected && (
        <CertificateDialog
          key={selected.id}
          certificate={selected}
          onClose={() => setSelected(null)}
          onSuccess={(decision) => {
            setNotice(t(decision === 'VERIFIED' ? 'Certification approved.' : 'Certification rejected.'))
            setSelected(null)
            retry()
          }}
        />
      )}
    </main>
  )
}
