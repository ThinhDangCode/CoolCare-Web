import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { adminRequest } from '../../management/api/managementApi.js'
import {
  PageHeader,
  Pagination,
  SearchIcon,
  EyeIcon,
  CheckIcon,
  CloseIcon,
  TableState,
} from '../../management/components/ManagementShared.jsx'
import { DocumentLink, TechnicianNotification, formatDate, safeDocumentUrl } from '../components/TechnicianShared.jsx'
import '../../management/pages/management.css'
import './technicians.css'
import './certifications.css'
import { ReviewDialog } from '../components/TechnicianActions.jsx'

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
function CertificateDialog({ certificate, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="certification-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      aria-labelledby="certificate-title"
    >
      <header>
        <div>
          <small>CERTIFICATION DETAILS</small>
          <h2 id="certificate-title">{certificate.certificate_name}</h2>
        </div>
        <button autoFocus aria-label="Close details" onClick={onClose}>
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
      <footer>
        <DocumentLink url={certificate.document_url} />
        <button onClick={onClose}>Close</button>
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
  const [review, setReview] = useState(null)
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
                  <th>CERT ID</th>
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
                            aria-label={`View ${c.certificate_name} — ${c.full_name}`}
                            title="View certificate details"
                            onClick={() => setSelected(c)}
                          >
                            <EyeIcon />
                          </button>
                          {c.verification_status === 'PENDING' && (
                            <>
                              <button
                                className="certification-action document"
                                aria-label={`Approve ${c.certificate_name}`}
                                title="Approve certification"
                                onClick={() =>
                                  setReview({
                                    path: `/technicians/certifications/${c.id}/review`,
                                    status: 'VERIFIED',
                                    name: `${c.certificate_name} — ${c.full_name}`,
                                    kind: 'certification',
                                    updatedAt: c.updated_at,
                                  })
                                }
                              >
                                <CheckIcon />
                              </button>
                              <button
                                className="certification-action reject"
                                aria-label={`Reject ${c.certificate_name}`}
                                title="Reject certification"
                                onClick={() =>
                                  setReview({
                                    path: `/technicians/certifications/${c.id}/review`,
                                    status: 'REJECTED',
                                    name: `${c.certificate_name} — ${c.full_name}`,
                                    kind: 'certification',
                                    updatedAt: c.updated_at,
                                  })
                                }
                              >
                                <CloseIcon />
                              </button>
                            </>
                          )}
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
      {selected && <CertificateDialog certificate={selected} onClose={() => setSelected(null)} />}
      {review && (
        <ReviewDialog
          target={review}
          onClose={() => setReview(null)}
          onSuccess={() => {
            setNotice('Certification review saved.')
            setReview(null)
            retry()
          }}
        />
      )}
    </main>
  )
}
