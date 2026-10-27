import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { adminRequest } from '../../management/api/managementApi.js'
import {
  PageHeader,
  Pagination,
  SearchIcon,
  EyeIcon,
  CloseIcon,
  TableState,
} from '../../management/components/ManagementShared.jsx'
import { DocumentLink, TechnicianNotification } from '../components/TechnicianShared.jsx'
import { formatDate, safeDocumentUrl } from '../components/technicianFormat.js'
import '../../management/pages/management.css'
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
  return (
    <span className={`certification-status ${value.toLowerCase()}`}>
      <i />
      {statusLabels[value] || value}
    </span>
  )
}
function CertificateDialog({ certificate, onClose, onSuccess }) {
  const { token, logout } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const pending = certificate.verification_status === 'PENDING'
  async function review(status) {
    if (busy) return
    if (status === 'REJECTED' && reason.trim().length < 5) {
      setError('Enter a rejection reason containing at least 5 characters.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await adminRequest('/technicians/certifications/' + certificate.id + '/review', token, {
        method: 'PATCH',
        body: { status, expected_updated_at: certificate.updated_at, ...(status === 'REJECTED' ? { reason: reason.trim() } : {}) },
      })
      onSuccess(status)
    } catch (err) {
      setError(err.message)
      if (err.status === 401) logout()
    } finally { setBusy(false) }
  }
  const ref = useRef(null)
  useEffect(() => {
    ref.current.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="certification-dialog"
      onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onClose()
      }}
      aria-labelledby="certificate-title"
    >
      <header>
        <div>
          <small>CERTIFICATION DETAILS</small>
          <h2 id="certificate-title">{certificate.certificate_name}</h2>
        </div>
        <button disabled={busy} autoFocus aria-label="Close details" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <CertificateStatus value={certificate.status} />
      <dl>
        <div>
          <dt>Certificate ID / number</dt>
          <dd>{certificate.certificate_number || certificate.id}</dd>
        </div>
        <div>
          <dt>Technician</dt>
          <dd>
            <Link to={`/admin/technicians/${certificate.technician_id}?tab=certifications`}>
              {certificate.full_name}
            </Link>
          </dd>
        </div>
        <div>
          <dt>Issuer</dt>
          <dd>{certificate.issued_by || '—'}</dd>
        </div>
        <div>
          <dt>Issued date</dt>
          <dd>{formatDate(certificate.issued_date)}</dd>
        </div>
        <div>
          <dt>Expiry date</dt>
          <dd>{formatDate(certificate.expiry_date)}</dd>
        </div>
        <div>
          <dt>Reviewed at</dt>
          <dd>{formatDate(certificate.reviewed_at)}</dd>
        </div>
      </dl>
      {certificate.rejection_reason && (
        <p className="certification-reason">{certificate.rejection_reason}</p>
      )}
      <section className="certificate-document-review">
        <h3>Submitted certificate document</h3>
        <DocumentLink url={certificate.document_url}>Open certificate document</DocumentLink>
        {safeDocumentUrl(certificate.document_url) && /\.(png|jpe?g|webp|gif)([?#].*)?$/i.test(certificate.document_url) && (
          <img src={safeDocumentUrl(certificate.document_url)} alt="Submitted certificates" />
        )}
      </section>
      {pending && <p>Review the information and submitted document before approving or rejecting.</p>}
      {rejecting && <label className="certificate-rejection-input">Rejection reason
        <textarea required minLength={5} maxLength={1000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} />
      </label>}
      {error && <p className="certification-reason" role="alert">{error}</p>}
      <footer>
        <button disabled={busy} onClick={onClose}>Close</button>
        {pending && <div className="certificate-review-decisions">
          {rejecting ? <>
            <button disabled={busy} onClick={() => { setRejecting(false); setError('') }}>Cancel rejection</button>
            <button className="reject" disabled={busy || reason.trim().length < 5} onClick={() => review('REJECTED')}>{busy ? 'Saving…' : 'Confirm reject'}</button>
          </> : <>
            <button className="reject" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
            <button className="approve" disabled={busy || !safeDocumentUrl(certificate.document_url)} onClick={() => review('VERIFIED')}>{busy ? 'Saving…' : 'Approve'}</button>
          </>}
        </div>}
      </footer>
    </dialog>
  )
}
export function CertificationsPage() {
  const { token, logout } = useAuth()
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
        title="Technician Certifications"
        subtitle={`${data.total} professional certifications`}
        onRefresh={retry}
        refreshing={loading}
      />
      <section className="certification-content">
        <TechnicianNotification message={notice} onDismiss={setNotice} />
        <div className="certification-section-label">
          TECHNICIAN OPERATIONS <span aria-hidden="true">⌄</span>
        </div>
        <div className="certification-card">
          <div className="certification-toolbar">
            <label className="certification-search">
              <SearchIcon />
              <input
                maxLength={150}
                aria-label="Search certifications"
                placeholder="Search certificate name, code, technician name"
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
              <option value="ALL">All Document Types</option>
              <option value="PDF">PDF</option>
              <option value="IMAGE">Image</option>
              <option value="OTHER">Other / No document</option>
            </select>
            <select
              aria-label="Certification status"
              value={status}
              onChange={(e) => filter(setStatus, e.target.value)}
            >
              <option value="ALL">All Status</option>
              {Object.entries(statusLabels).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
            <select
              aria-label="Issuer"
              value={issuer}
              onChange={(e) => filter(setIssuer, e.target.value)}
            >
              <option value="">Issuer</option>
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
                  <th className="certification-numeric">ID</th>
                  <th>CERTIFICATE NAME</th>
                  <th>TECHNICIAN</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
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
                  data.items.map((c, index) => (
                    <tr key={c.id}>
                      <td className="certification-numeric">{(page - 1) * limit + index + 1}</td>
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
                            aria-label={`View ${c.certificate_name} — ${c.full_name}`}
                            title="View certificate details"
                            onClick={() => setSelected(c)}
                          >
                            <EyeIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="certification-footer">
            <div>
              Showing {first}–{last} of {data.total} certifications{' '}
              <label>
                Rows:{' '}
                <select
                  aria-label="Rows per page"
                  value={limit}
                  onChange={(e) => filter(setLimit, Number(e.target.value))}
                >
                  {[10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n} / page
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
      {selected && <CertificateDialog
        key={selected.id}
        certificate={selected}
        onClose={() => setSelected(null)}
        onSuccess={status => {
          setNotice(status === 'VERIFIED' ? 'Certification approved.' : 'Certification rejected.')
          setSelected(null)
          retry()
        }}
      />}
    </main>
  )
}
