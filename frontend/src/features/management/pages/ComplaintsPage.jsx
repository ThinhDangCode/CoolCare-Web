import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss.js'
import { adminRequest } from '../api/managementApi.js'
import {
  CheckIcon,
  CloseIcon,
  PageHeader,
  Pagination,
  SearchIcon,
  TableState,
} from '../components/ManagementShared.jsx'
import './management.css'

const statusLabel = (value) =>
  value
    .split('_')
    .map((part) => part[0] + part.slice(1).toLowerCase())
    .join(' ')
const ViewIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
)

const complaintStatusLabel = {
  OPEN: 'Pending',
  IN_PROGRESS: 'Processing',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
}

export function ComplaintsPage() {
  const { token, logout } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [type, setType] = useState('ALL')
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [target, setTarget] = useState(null)
  const [resolution, setResolution] = useState('')
  const [nextStatus, setNextStatus] = useState('RESOLVED')
  const [fieldError, setFieldError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const noticeHover = useAutoDismiss(notice, setNotice)
  const errorHover = useAutoDismiss(error, setError)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ search, status, type, page, limit: 10 })
      adminRequest(`/complaints?${query}`, token, { signal: controller.signal })
        .then(setData)
        .then(() => setError(''))
        .catch((err) => {
          if (err.name !== 'AbortError') {
            setError(err.message)
            if (err.status === 401) logout()
          }
        })
        .finally(() => setLoading(false))
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [token, search, status, type, page, refresh, logout])
  const reload = () => {
    setLoading(true)
    setRefresh((v) => v + 1)
  }
  const open = (row) => {
    navigate(`/admin/complaints/${row.id}`)
  }
  async function resolve(event) {
    event.preventDefault()
    if (resolution.trim().length < 10) {
      setFieldError('Nội dung xử lý phải có ít nhất 10 ký tự.')
      return
    }
    setBusy(true)
    try {
      await adminRequest(`/complaints/${target.id}/resolve`, token, {
        method: 'PATCH',
        body: { status: nextStatus, resolution: resolution.trim() },
      })
      setTarget(null)
      setNotice(`Complaint ${statusLabel(nextStatus).toLowerCase()} successfully.`)
      reload()
    } catch (err) {
      setError(err.message)
      setFieldError(err.details?.resolution || '')
      if (err.status === 401) logout()
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="figma-admin-main">
      <PageHeader
        title="Complaints"
        subtitle="Manage customer issues, booking impact, and resolution status."
        refreshing={loading}
        onRefresh={reload}
      />
      <section className="management-content complaint-management-content">
        {notice && (
          <div className="figma-toast" {...noticeHover}>
            <CheckIcon />
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>
              <CloseIcon />
            </button>
          </div>
        )}
        {error && !target && (
          <div className="figma-toast danger" {...errorHover}>
            <span className="toast-symbol">!</span>
            <span>{error}</span>
            <button onClick={() => setError('')}>
              <CloseIcon />
            </button>
          </div>
        )}
        <div className="management-toolbar complaints">
          <label>
            <SearchIcon />
            <input
              placeholder="Search code, subject, booking, customer..."
              value={search}
              onChange={(e) => {
                setLoading(true)
                setPage(1)
                setSearch(e.target.value)
              }}
            />
          </label>
          <select
            aria-label="Filter complaints by status"
            value={status}
            onChange={(e) => {
              setLoading(true)
              setPage(1)
              setStatus(e.target.value)
            }}
          >
            <option value="ALL">All Statuses</option>
            <option value="OPEN">Pending</option>
            <option value="IN_PROGRESS">Processing</option>
            <option value="RESOLVED">Resolved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CLOSED">Closed</option>
          </select>
          <label className="select-filter">
            <select
              aria-label="Filter complaints by issue type"
              value={type}
              onChange={(e) => {
                setLoading(true)
                setPage(1)
                setType(e.target.value)
              }}
            >
              <option value="ALL">All Issue Types</option>
              <option value="SERVICE">Service</option>
              <option value="TECHNICIAN">Technician</option>
              <option value="PAYMENT">Payment</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
        </div>
        <div className="figma-table-card">
          <table className="management-table complaints-table">
            <thead>
              <tr>
                <th>COMPLAINT ID</th>
                <th>CUSTOMER</th>
                <th>ISSUE</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                loading={loading}
                error=""
                empty={!data.items.length}
                colSpan={5}
                retry={reload}
              />
              {!loading &&
                data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>CP{String(row.complaint_number).padStart(3, '0')}</strong>
                    </td>
                    <td>
                      <strong>{row.customer_name}</strong>
                    </td>
                    <td>
                      <strong>{row.subject}</strong>
                      <small>{statusLabel(row.type)}</small>
                    </td>
                    <td>
                      <span className={`figma-status complaint-${row.status.toLowerCase()}`}>
                        <i />
                        {complaintStatusLabel[row.status] || statusLabel(row.status)}
                      </span>
                    </td>
                    <td>
                      <div className="voucher-inline-actions">
                        <button
                          title="View complaint details"
                          aria-label={`View ${row.complaint_code}`}
                          onClick={() => open(row)}
                        >
                          <ViewIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            total={data.total}
            limit={10}
            loading={loading}
            showTotal
            onPage={(value) => {
              setLoading(true)
              setPage(value)
            }}
          />
        </div>
      </section>
      {target && (
        <div className="figma-modal-backdrop" onMouseDown={() => !busy && setTarget(null)}>
          <form
            className="management-modal complaint-modal"
            onSubmit={resolve}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <div className="complaint-detail-heading">
                <span className="complaint-detail-icon">
                  <ViewIcon />
                </span>
                <div>
                  <h2>Complaint Details</h2>
                  <p>{target.complaint_code}</p>
                </div>
                <span className={`figma-status complaint-${target.status.toLowerCase()}`}>
                  <i />
                  {complaintStatusLabel[target.status] || statusLabel(target.status)}
                </span>
              </div>
              <button
                type="button"
                aria-label="Close complaint details"
                onClick={() => setTarget(null)}
              >
                <CloseIcon />
              </button>
            </header>
            <div className="complaint-summary">
              <div>
                <span>Customer</span>
                <strong>{target.customer_name}</strong>
                <small>{target.customer_phone || 'No phone number'}</small>
              </div>
              <div>
                <span>Booking</span>
                <strong>#{target.booking_code}</strong>
              </div>
              <div>
                <span>Issue Type</span>
                <strong>{statusLabel(target.type)}</strong>
              </div>
              <div>
                <span>Assigned Technician</span>
                <strong>{target.technician_name || 'Not assigned'}</strong>
              </div>
              <div>
                <span>Submitted Date</span>
                <strong>{new Date(target.created_at).toLocaleString('vi-VN')}</strong>
              </div>
            </div>
            <div className="complaint-description">
              <span>ISSUE DESCRIPTION</span>
              <h3>{target.subject}</h3>
              <p>{target.description}</p>
            </div>
            <div className="complaint-resolution-title">
              <div>
                <strong>Resolution Management</strong>
                <small>Update the processing status and record the administrator response.</small>
              </div>
            </div>
            <div className="management-form">
              <label>
                Resolution Status *
                <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                  <option value="IN_PROGRESS">Processing</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </label>
              <label className="full">
                Resolution notes *
                <textarea
                  placeholder="Describe the investigation, decision, and action taken..."
                  value={resolution}
                  onChange={(e) => {
                    setResolution(e.target.value)
                    setFieldError('')
                  }}
                />
                <small>{fieldError}</small>
              </label>
            </div>
            {error && <div className="figma-form-error">{error}</div>}
            <footer>
              <button type="button" onClick={() => setTarget(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Update Complaint'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
