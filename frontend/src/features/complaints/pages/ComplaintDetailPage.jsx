import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { useAutoDismiss } from '../../../shared/hooks/useAutoDismiss.js'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  ArrowLeftIcon,
  CheckIcon,
  CloseIcon,
  PageHeader,
} from '../../../shared/components/AdminUi.jsx'
import '../../../shared/styles/admin.css'

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
  const { locale, t } = useUiPreferences()
  const [complaint, setComplaint] = useState(null)
  const [status, setStatus] = useState('IN_PROGRESS')
  const [resolution, setResolution] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState('')
  const [showResolution, setShowResolution] = useState(false)
  const [notifyCustomer, setNotifyCustomer] = useState(true)
  const [showVoucher, setShowVoucher] = useState(false)
  const [voucherAmount, setVoucherAmount] = useState('100000')
  const [voucherMinimum, setVoucherMinimum] = useState('0')
  const [voucherDays, setVoucherDays] = useState('30')
  const [createdVoucher, setCreatedVoucher] = useState(null)
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
    const note = resolution.trim()
    if (!draft && note.length < 10)
      return setError('Resolution notes must contain at least 10 characters.')
    if (draft && !note) return setError('Enter a resolution note before saving a draft.')
    if (note.length > 5000) return setError('Resolution notes must not exceed 5,000 characters.')
    if (!(nextStatusOptions[complaint.status] || []).includes(nextStatus))
      return setError('The selected status transition is not allowed.')
    setBusy(true)
    setSaved('')
    try {
      const row = await adminRequest(`/complaints/${id}/resolve`, token, {
        method: 'PATCH',
        body: {
          status: nextStatus,
          resolution: note,
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

  async function giftVoucher(event) {
    event.preventDefault()
    const amount = Number(voucherAmount)
    const minimum = Number(voucherMinimum)
    const days = Number(voucherDays)
    if (!Number.isInteger(amount) || amount < 1 || amount > 10000000)
      return setError('Compensation amount must be a whole number from 1 to 10,000,000 VND.')
    if (!Number.isInteger(minimum) || minimum < 0)
      return setError('Minimum order amount must be a non-negative whole number.')
    if (!Number.isInteger(days) || days < 1 || days > 365)
      return setError('Voucher validity must be a whole number from 1 to 365 days.')
    setBusy(true)
    setSaved('')
    try {
      const voucher = await adminRequest(`/complaints/${id}/compensation-voucher`, token, {
        method: 'POST',
        body: {
          discount_value: amount,
          minimum_order_amount: minimum,
          valid_days: days,
          notify_customer: true,
        },
      })
      setCreatedVoucher(voucher)
      setShowVoucher(false)
      setSaved(`Voucher ${voucher.code} đã được gửi cho khách hàng.`)
      setError('')
    } catch (err) {
      setError(err.message)
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="figma-admin-main complaint-detail-page">
      <PageHeader
        title={
          complaint ? (
            <span className="complaint-header-title">
              <span>{t('Complaint Detail')}</span>
              <b>#{complaint.complaint_code}</b>
              <span className={`figma-status complaint-${complaint.status.toLowerCase()}`}>
                <i />
                {statusName[complaint.status] || label(complaint.status)}
              </span>
            </span>
          ) : (
            t('Complaint Detail')
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
            <h1>{t('Complaint Detail')}</h1>
            <p>
              <strong>#{complaint.complaint_code}</strong>
              <span>{statusName[complaint.status] || label(complaint.status)}</span>
            </p>
          </header>
        )}
        <div className="complaint-detail-top">
          <div className="complaint-detail-actions">
            <Link to="/admin/complaints">
              <ArrowLeftIcon /> {t('Back to List')}
            </Link>
            <button type="button" onClick={() => window.print()}>
              <DetailIcon name="print" /> {t('Print Log')}
            </button>
          </div>
        </div>
        {loading ? (
          <div className="figma-table-state">
            <i className="figma-spinner" />
            {t('Loading complaint…')}
          </div>
        ) : error && !complaint ? (
          <div className="figma-table-state error">{error}</div>
        ) : (
          complaint && (
            <div className="complaint-figma-layout">
              <div className="complaint-figma-main">
                <section className="complaint-info-card">
                  <header>
                    <div>
                      <span>
                        <DetailIcon name="complaint" />
                      </span>
                      <strong>{t('Complaint Information')}</strong>
                    </div>
                    <small>ID: {complaint.complaint_code}</small>
                  </header>
                  <div className="complaint-facts">
                    <div>
                      <small>{t('ISSUE CATEGORY')}</small>
                      <strong>{label(complaint.type)}</strong>
                    </div>
                    <div>
                      <small>{t('SUBMISSION DATE')}</small>
                      <strong>
                        {new Date(complaint.created_at).toLocaleString(
                          locale === 'vi' ? 'vi-VN' : 'en-US'
                        )}
                      </strong>
                    </div>
                    <div>
                      <small>{t('CURRENT STATUS')}</small>
                      <span className={`figma-status complaint-${complaint.status.toLowerCase()}`}>
                        <i />
                        {statusName[complaint.status] || label(complaint.status)}
                      </span>
                    </div>
                  </div>
                  <div className="complaint-quote">
                    <small>{t('CUSTOMER COMPLAINT DESCRIPTION')}</small>
                    <blockquote>“{complaint.description}”</blockquote>
                    <footer>
                      <span>● {t('Sent via CoolCare Customer App')}</span>
                      <span>
                        {complaint.description.length} {t('characters')}
                      </span>
                    </footer>
                  </div>
                </section>
                <section id="resolution-panel" className="complaint-detail-resolution">
                  <header className="complaint-resolution-heading">
                    <span>
                      <CheckIcon />
                    </span>
                    <div>
                      <h3>{t('Resolution & Operational Actions')}</h3>
                      <p>
                        {t(
                          'Review resolution findings, assign outcomes, and complete the workflow.'
                        )}
                      </p>
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
                    <CheckIcon /> {t('Process Resolution')}
                  </button>
                  {['RESOLVED', 'CLOSED'].includes(complaint.status) && (
                    <button
                      className="complaint-voucher-button"
                      type="button"
                      onClick={() => setShowVoucher(true)}
                    >
                      Gift Compensation Voucher
                    </button>
                  )}
                  {createdVoucher && (
                    <div className="complaint-voucher-result">
                      <span>Customer-only voucher</span>
                      <strong>{createdVoucher.code}</strong>
                      <small>
                        {Number(createdVoucher.discount_value).toLocaleString('vi-VN')}đ · Valid
                        until {new Date(createdVoucher.end_at).toLocaleDateString('vi-VN')}
                      </small>
                    </div>
                  )}
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
                        <h2>{t('Resolution & Operational Actions')}</h2>
                        <p>
                          {t('Record supporting findings, select resolution decision, and notify the customer.')}
                        </p>
                      </div>
                      <small>#{complaint.complaint_code}</small>
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
                        {t('RESOLUTION DECISION')}
                        <select value={status} onChange={(event) => setStatus(event.target.value)}>
                          {(nextStatusOptions[complaint.status] || []).map((value) => (
                            <option key={value} value={value}>
                              {t(statusName[value])}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t('ADMIN RESOLUTION NOTE / ACTION TAKEN')}
                        <textarea
                          maxLength="5000"
                          value={resolution}
                          onChange={(event) => setResolution(event.target.value)}
                          placeholder={t('Describe the investigation, decision, and action taken...')}
                        />
                      </label>
                      <label className="complaint-notify-customer">
                        <input
                          type="checkbox"
                          checked={notifyCustomer}
                          onChange={(event) => setNotifyCustomer(event.target.checked)}
                        />
                        {t('Notify customer via in-app notification immediately')}
                      </label>
                    </div>
                    <footer>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => saveResolution(complaint.status, { draft: true })}
                      >
                        {t('Save as Draft')}
                      </button>
                      <button
                        className="confirm"
                        type="button"
                        disabled={busy}
                        onClick={() => saveResolution(status)}
                      >
                        <CheckIcon /> {busy ? t('Saving…') : t('Confirm Resolution')}
                      </button>
                    </footer>
                  </section>
                </div>
              )}
              {showVoucher && (
                <div className="figma-modal-backdrop complaint-resolution-backdrop">
                  <form
                    className="complaint-resolution-dialog complaint-voucher-dialog"
                    role="dialog"
                    aria-modal="true"
                    onSubmit={giftVoucher}
                  >
                    <header>
                      <span aria-hidden="true">%</span>
                      <div>
                        <h2>Gift Compensation Voucher</h2>
                        <p>Create a one-time voucher assigned only to this customer.</p>
                      </div>
                      <small>#{complaint.complaint_code}</small>
                      <button
                        type="button"
                        aria-label="Close"
                        onClick={() => setShowVoucher(false)}
                      >
                        <CloseIcon />
                      </button>
                    </header>
                    <div className="complaint-resolution-dialog-body complaint-voucher-fields">
                      <label>
                        COMPENSATION AMOUNT (VND)
                        <input
                          type="number"
                          min="1"
                          max="10000000"
                          step="1"
                          required
                          value={voucherAmount}
                          onChange={(event) => setVoucherAmount(event.target.value)}
                        />
                      </label>
                      <label>
                        MINIMUM ORDER AMOUNT (VND)
                        <input
                          type="number"
                          min="0"
                          step="1"
                          required
                          value={voucherMinimum}
                          onChange={(event) => setVoucherMinimum(event.target.value)}
                        />
                      </label>
                      <label>
                        VALID FOR (DAYS)
                        <input
                          type="number"
                          min="1"
                          max="365"
                          step="1"
                          required
                          value={voucherDays}
                          onChange={(event) => setVoucherDays(event.target.value)}
                        />
                      </label>
                      <p>
                        The code can be redeemed once and is cryptographically bound to the
                        complaint customer. A notification will be sent immediately.
                      </p>
                    </div>
                    <footer>
                      <button type="button" disabled={busy} onClick={() => setShowVoucher(false)}>
                        Cancel
                      </button>
                      <button className="confirm" type="submit" disabled={busy}>
                        {busy ? 'Creating…' : 'Create & Send Voucher'}
                      </button>
                    </footer>
                  </form>
                </div>
              )}
            </div>
          )
        )}
      </section>
    </main>
  )
}
