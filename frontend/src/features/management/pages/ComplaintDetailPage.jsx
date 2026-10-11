import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss.js'
import { adminRequest } from '../api/managementApi.js'
import { ArrowLeftIcon, CheckIcon, CloseIcon, PageHeader } from '../components/ManagementShared.jsx'
import './management.css'

const label = (value) =>
  value
    .split('_')
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(' ')
const statusName = {
  OPEN: 'Pending',
  IN_PROGRESS: 'Processing',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
}
const nextStatusOptions = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['IN_PROGRESS', 'RESOLVED', 'REJECTED'],
  RESOLVED: ['RESOLVED', 'CLOSED'],
  REJECTED: ['REJECTED', 'CLOSED'],
  CLOSED: ['CLOSED'],
}

function DetailIcon({ name }) {
  const paths = {
    complaint: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M14.8 9.4a3.5 3.5 0 1 0 0 5.2M14.8 9.4v3h-3" />
      </>
    ),
    customer: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M6.5 19c.6-3.1 2.4-5 5.5-5s4.9 1.9 5.5 5" />
      </>
    ),
    booking: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" />
      </>
    ),
    technician: (
      <>
        <path d="M14.8 6.2a4 4 0 0 0-5 5l-5.6 5.6a1.4 1.4 0 0 0 2 2l5.6-5.6a4 4 0 0 0 5-5l-2.4 2.4-2-2 2.4-2.4Z" />
      </>
    ),
    print: (
      <>
        <path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
        <path d="M7 14h10v6H7z" />
      </>
    ),
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export function ComplaintDetailPage() {
  const { id } = useParams()
  const { token, logout } = useAuth()
  const [complaint, setComplaint] = useState(null)
  const [status, setStatus] = useState('IN_PROGRESS')
  const [resolution, setResolution] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState('')
  const [showResolution, setShowResolution] = useState(false)
  const [notifyCustomer, setNotifyCustomer] = useState(true)
  const savedHover = useAutoDismiss(saved, setSaved)
  const errorHover = useAutoDismiss(error, setError)

  const load = () => {
    setLoading(true)
    adminRequest(`/complaints/${id}`, token)
      .then((row) => {
        setComplaint(row)
        setStatus(row.status === 'OPEN' ? 'IN_PROGRESS' : row.status)
        setResolution(row.resolution || '')
        setError('')
      })
      .catch((err) => {
        setError(err.message)
        if (err.status === 401) logout()
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const controller = new AbortController()
    adminRequest(`/complaints/${id}`, token, { signal: controller.signal })
      .then((row) => {
        setComplaint(row)
        setStatus(row.status === 'OPEN' ? 'IN_PROGRESS' : row.status)
        setResolution(row.resolution || '')
        setError('')
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message)
          if (err.status === 401) logout()
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [id, token, logout])

  async function saveResolution(nextStatus = status, { draft = false } = {}) {
    if (!draft && resolution.trim().length < 10)
      return setError('Resolution notes must contain at least 10 characters.')
    if (draft && !resolution.trim())
      return setError('Enter a resolution note before saving a draft.')
    setBusy(true)
    setSaved('')
    try {
      const row = await adminRequest(`/complaints/${id}/resolve`, token, {
        method: 'PATCH',
        body: {
          status: nextStatus,
          resolution: resolution.trim(),
          notify_customer: draft ? false : notifyCustomer,
          is_draft: draft,
        },
      })
      setComplaint((current) => ({ ...current, ...row }))
      setStatus(row.status === 'OPEN' ? 'IN_PROGRESS' : row.status)
      if (!draft) setShowResolution(false)
      setSaved(draft ? 'Resolution draft saved successfully.' : 'Complaint updated successfully.')
      setError('')
    } catch (err) {
      setError(err.message)
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }

  function submit(event) {
    event.preventDefault()
    saveResolution()
  }

  return (
    <main className="figma-admin-main complaint-detail-page">
      <PageHeader
        title={
          complaint ? (
            <span className="complaint-header-title">
              <span>Complaint Detail</span>
              <b>#CP{String(complaint.complaint_number).padStart(3, '0')}</b>
              <span className={`figma-status complaint-${complaint.status.toLowerCase()}`}>
                <i />
                {statusName[complaint.status] || label(complaint.status)}
              </span>
            </span>
          ) : (
            'Complaint Detail'
          )
        }
        subtitle=""
        refreshing={loading}
        onRefresh={load}
      />
      <section className="complaint-detail-content">
        {saved && (
          <div className="figma-toast" role="status" {...savedHover}>
            <CheckIcon />
            <span>{saved}</span>
            <button aria-label="Dismiss notification" onClick={() => setSaved('')}>
              <CloseIcon />
            </button>
          </div>
        )}
        {error && complaint && (
          <div className="figma-toast danger" role="alert" {...errorHover}>
            <span className="toast-symbol">!</span>
            <span>{error}</span>
            <button aria-label="Dismiss notification" onClick={() => setError('')}>
              <CloseIcon />
            </button>
          </div>
        )}
        {complaint && (
          <header className="complaint-print-heading">
            <h1>Complaint Detail</h1>
            <p>
              <strong>#CP{String(complaint.complaint_number).padStart(3, '0')}</strong>
              <span>{statusName[complaint.status] || label(complaint.status)}</span>
            </p>
          </header>
        )}
        <div className="complaint-detail-top">
          <div className="complaint-detail-actions">
            <Link to="/admin/complaints">
              <ArrowLeftIcon /> Back to List
            </Link>
            <button type="button" onClick={() => window.print()}>
              <DetailIcon name="print" /> Print Log
            </button>
          </div>
        </div>
        {loading ? (
          <div className="figma-table-state">
            <i className="figma-spinner" />
            Loading complaint…
          </div>
        ) : error && !complaint ? (
          <div className="figma-table-state error">{error}</div>
        ) : (
          complaint && (
            <form className="complaint-figma-layout" onSubmit={submit}>
              <div className="complaint-figma-main">
                <section className="complaint-info-card">
                  <header>
                    <div>
                      <span>
                        <DetailIcon name="complaint" />
                      </span>
                      <strong>Complaint Information</strong>
                    </div>
                    <small>ID: CP{String(complaint.complaint_number).padStart(3, '0')}</small>
                  </header>
                  <div className="complaint-facts">
                    <div>
                      <small>ISSUE CATEGORY</small>
                      <strong>{label(complaint.type)}</strong>
                    </div>
                    <div>
                      <small>SUBMISSION DATE</small>
                      <strong>{new Date(complaint.created_at).toLocaleString('vi-VN')}</strong>
                    </div>
                    <div>
                      <small>CURRENT STATUS</small>
                      <span className={`figma-status complaint-${complaint.status.toLowerCase()}`}>
                        <i />
                        {statusName[complaint.status] || label(complaint.status)}
                      </span>
                    </div>
                  </div>
                  <div className="complaint-quote">
                    <small>CUSTOMER COMPLAINT DESCRIPTION</small>
                    <blockquote>“{complaint.description}”</blockquote>
                    <footer>
                      <span>● Sent via CoolCare Customer App</span>
                      <span>{complaint.description.length} characters</span>
                    </footer>
                  </div>
                  <div className="complaint-evidence">
                    <header>
                      <strong>CUSTOMER UPLOADED EVIDENCE &amp; PHOTOS</strong>
                      <span>0 ATTACHMENTS FOUND</span>
                    </header>
                    <div>No evidence files were submitted with this complaint.</div>
                  </div>
                </section>
                <section id="resolution-panel" className="complaint-detail-resolution">
                  <header className="complaint-resolution-heading">
                    <span>
                      <CheckIcon />
                    </span>
                    <div>
                      <h3>Resolution &amp; Operational Actions</h3>
                      <p>Review resolution findings, assign outcomes, and complete the workflow.</p>
                    </div>
                    <span className={`figma-status complaint-${complaint.status.toLowerCase()}`}>
                      <i />
                      {statusName[complaint.status] || label(complaint.status)}
                    </span>
                  </header>
                  {complaint.resolution && (
                    <p className="complaint-resolution-summary">{complaint.resolution}</p>
                  )}
                  <button
                    className="complaint-process-button"
                    type="button"
                    disabled={complaint.status === 'CLOSED'}
                    onClick={() => setShowResolution(true)}
                  >
                    <CheckIcon /> Process Resolution
                  </button>
                </section>
              </div>
              <aside className="complaint-related">
                <section>
                  <header>
                    <strong>
                      <DetailIcon name="customer" /> RELATED CUSTOMER
                    </strong>
                    <span>View Profile</span>
                  </header>
                  <div className="related-person">
                    <b>
                      {complaint.customer_name
                        ?.split(' ')
                        .map((part) => part[0])
                        .slice(-2)
                        .join('')}
                    </b>
                    <span>
                      <strong>{complaint.customer_name}</strong>
                      <small>Verified Customer</small>
                    </span>
                  </div>
                  <dl>
                    <dt>Phone:</dt>
                    <dd>{complaint.customer_phone || '—'}</dd>
                    <dt>Email:</dt>
                    <dd>{complaint.customer_email || '—'}</dd>
                  </dl>
                </section>
                <section>
                  <header>
                    <strong>
                      <DetailIcon name="booking" /> RELATED BOOKING
                    </strong>
                    <span>{label(complaint.booking_status || 'UNKNOWN')}</span>
                  </header>
                  <dl>
                    <dt>BOOKING ID</dt>
                    <dd className="accent">#{complaint.booking_code}</dd>
                    <dt>SERVICE ORDERED</dt>
                    <dd>{complaint.service_names || '—'}</dd>
                    <dt>EXECUTED SLOT</dt>
                    <dd>
                      {complaint.scheduled_at
                        ? new Date(complaint.scheduled_at).toLocaleString('vi-VN')
                        : '—'}
                    </dd>
                    <dt>SERVICE ADDRESS</dt>
                    <dd>
                      {[complaint.service_address, complaint.ward, complaint.city]
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </dd>
                  </dl>
                </section>
                <section>
                  <header>
                    <strong>
                      <DetailIcon name="technician" /> ASSIGNED TECHNICIAN
                    </strong>
                    <span>History</span>
                  </header>
                  <div className="related-person">
                    <b>
                      {complaint.technician_name
                        ? complaint.technician_name
                            .split(' ')
                            .map((part) => part[0])
                            .slice(-2)
                            .join('')
                        : '—'}
                    </b>
                    <span>
                      <strong>{complaint.technician_name || 'Not assigned'}</strong>
                      <small>Service Technician</small>
                    </span>
                  </div>
                  <dl>
                    <dt>Qualification Level:</dt>
                    <dd>
                      {complaint.technician_qualification
                        ? label(complaint.technician_qualification)
                        : '—'}
                    </dd>
                    <dt>Phone:</dt>
                    <dd>{complaint.technician_phone || '—'}</dd>
                  </dl>
                </section>
              </aside>
              {showResolution && (
                <div className="figma-modal-backdrop complaint-resolution-backdrop">
                  <section className="complaint-resolution-dialog" role="dialog" aria-modal="true">
                    <header>
                      <span>
                        <CheckIcon />
                      </span>
                      <div>
                        <h2>Resolution &amp; Operational Actions</h2>
                        <p>
                          Record supporting findings, select resolution decision, and notify the
                          customer.
                        </p>
                      </div>
                      <small>#CP{String(complaint.complaint_number).padStart(3, '0')}</small>
                      <button
                        type="button"
                        aria-label="Close"
                        onClick={() => setShowResolution(false)}
                      >
                        <CloseIcon />
                      </button>
                    </header>
                    <div className="complaint-resolution-dialog-body">
                      <label>
                        RESOLUTION DECISION
                        <select value={status} onChange={(event) => setStatus(event.target.value)}>
                          {(nextStatusOptions[complaint.status] || []).map((value) => (
                            <option key={value} value={value}>
                              {statusName[value]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        ADMIN RESOLUTION NOTE / ACTION TAKEN
                        <textarea
                          value={resolution}
                          onChange={(event) => setResolution(event.target.value)}
                          placeholder="Describe the investigation, decision, and action taken..."
                        />
                      </label>
                      <label className="complaint-notify-customer">
                        <input
                          type="checkbox"
                          checked={notifyCustomer}
                          onChange={(event) => setNotifyCustomer(event.target.checked)}
                        />
                        Notify customer via in-app notification immediately
                      </label>
                    </div>
                    <footer>
                      {complaint.status === 'IN_PROGRESS' && (
                        <button
                          className="reject"
                          type="button"
                          disabled={busy}
                          onClick={() => saveResolution('REJECTED')}
                        >
                          Reject Complaint
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => saveResolution(complaint.status, { draft: true })}
                      >
                        Save as Draft
                      </button>
                      <button
                        className="confirm"
                        type="button"
                        disabled={busy}
                        onClick={() => saveResolution(status)}
                      >
                        <CheckIcon /> {busy ? 'Saving…' : 'Confirm Resolution'}
                      </button>
                    </footer>
                  </section>
                </div>
              )}
            </form>
          )
        )}
      </section>
    </main>
  )
}
