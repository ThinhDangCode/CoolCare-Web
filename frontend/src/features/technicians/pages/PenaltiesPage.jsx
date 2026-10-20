import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  PageHeader,
  Pagination,
  SearchIcon,
  TableState,
} from '../../../shared/components/AdminUi.jsx'
import { TechnicianAvatar } from '../components/TechnicianShared.jsx'
import { formatDate } from '../components/technicianFormat.js'
import '../../../shared/styles/admin.css'
import './technicians.css'
import './penalties.css'

const types = {
  DECLINE: 'Job declined',
  CANCELLATION: 'Job cancellation',
  LATE_HANDLING: 'Late handling',
  RULE_VIOLATION: 'Rule violation',
}
const statuses = {
  ALL: 'All',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
}
export function PenaltiesPage() {
  const { token, logout } = useAuth()
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [type, setType] = useState('ALL')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [data, setData] = useState({
    items: [],
    total: 0,
    summary: { active_penalties: 0, penalized_technicians: 0, active_points: 0 },
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
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
    const query = new URLSearchParams({ search: keyword, status, type, page, limit })
    adminRequest(`/technicians/penalties?${query}`, token, { signal: controller.signal })
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
  }, [token, logout, keyword, status, type, page, limit, refresh])
  const retry = () => {
    setLoading(true)
    setRefresh((n) => n + 1)
  }
  const filter = (setter, value) => {
    setLoading(true)
    setPage(1)
    setter(value)
  }
  return (
    <main className="figma-admin-main technician-main penalty-page">
      <PageHeader
        title="Technician Penalties"
        subtitle="Track technician penalties and penalty points"
        onRefresh={retry}
        refreshing={loading}
      />
      <section className="technician-content">
        <div className="penalty-summary" aria-label="System-wide penalty statistics">
          {[
            ['penalized_technicians', 'Penalized technicians'],
            ['active_penalties', 'Active penalties'],
            ['active_points', 'Points deducted (active)'],
          ].map(([key, title]) => (
            <div key={key}>
              <span>{title}</span>
              <strong>
                {loading || error
                  ? '—'
                  : key === 'active_points' && data.summary[key] > 0
                    ? `−${data.summary[key]}`
                    : data.summary[key]}
              </strong>
              <small>System-wide</small>
            </div>
          ))}
        </div>
        <div className="penalty-toolbar">
          <label className="technician-search">
            <SearchIcon />
            <input
              maxLength={150}
              aria-label="Search penalties"
              placeholder="Search name, phone, booking code or reason..."
              value={search}
              onChange={(e) => {
                setLoading(true)
                setSearch(e.target.value)
              }}
            />
          </label>
          <label className="technician-filter">
            <span>Status</span>
            <select value={status} onChange={(e) => filter(setStatus, e.target.value)}>
              {Object.entries(statuses).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label className="technician-filter">
            <span>Violation type</span>
            <select value={type} onChange={(e) => filter(setType, e.target.value)}>
              <option value="ALL">All violations</option>
              {Object.entries(types).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="figma-users-table technician-table penalty-table">
          <table>
            <thead>
              <tr>
                <th>TECHNICIAN</th>
                <th>VIOLATION &amp; REASON</th>
                <th>REFERENCE</th>
                <th>DEDUCTION</th>
                <th>APPLIED / EXPIRES</th>
                <th>STATUS</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                loading={loading}
                error={error}
                empty={!data.items.length}
                colSpan={7}
                retry={retry}
              />
              {!loading &&
                !error &&
                data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link
                        className="technician-person"
                        to={`/admin/technicians/${row.technician_id}`}
                      >
                        <TechnicianAvatar name={row.full_name} url={row.avatar_url} />
                        <span>
                          <strong>{row.full_name}</strong>
                          <small>{row.phone || row.email}</small>
                        </span>
                      </Link>
                    </td>
                    <td className="penalty-violation">
                      <strong>{types[row.penalty_type] || row.penalty_type}</strong>
                      <details className="penalty-reason">
                        <summary title={row.reason}>
                          {(row.reason || 'No reason provided').replace(
                            row.complaint_code ? row.complaint_code + ': ' : /^$/,
                            ''
                          )}
                        </summary>
                        <p>
                          {(row.reason || 'No reason provided').replace(
                            row.complaint_code ? row.complaint_code + ': ' : /^$/,
                            ''
                          )}
                        </p>
                      </details>
                    </td>
                    <td className="penalty-reference">
                      {row.complaint_id ? (
                        <Link to={`/admin/complaints/${row.complaint_id}`}>
                          Complaint CP{String(row.complaint_number).padStart(3, '0')}
                        </Link>
                      ) : (
                        <span className="technician-muted">No complaint</span>
                      )}
                      <small className="technician-muted">
                        {row.booking_code || 'No linked booking'}
                      </small>
                    </td>
                    <td>
                      <span
                        className="penalty-points"
                        aria-label={`${row.penalty_points} points deducted`}
                      >
                        −{row.penalty_points}
                      </span>
                      <small className="technician-muted">
                        {row.remaining_points ?? 12} / 12 left
                      </small>
                    </td>
                    <td className="penalty-dates">
                      <span>{formatDate(row.applied_at)}</span>
                      <small className="technician-muted">
                        {row.expires_at ? 'Until ' + formatDate(row.expires_at) : 'No expiry'}
                      </small>
                    </td>
                    <td>
                      <span className={`penalty-status ${row.status.toLowerCase()}`}>
                        <i />
                        {statuses[row.status]}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="penalty-profile-action"
                        aria-label={`View profile of ${row.full_name}`}
                        title="View technician profile"
                        to={`/admin/technicians/${row.technician_id}`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          aria-hidden="true"
                        >
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!loading && !error && !data.items.length && (
            <p className="penalty-empty-note">
              {status === 'ACTIVE'
                ? 'No active penalties match your filters.'
                : 'No penalties match your filters.'}
            </p>
          )}
          <div className="penalty-footer">
            <label>
              {data.total} penalties · Rows per page{' '}
              <select
                aria-label="Rows per page"
                value={limit}
                onChange={(e) => filter(setLimit, Number(e.target.value))}
              >
                {[10, 20, 50].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <Pagination
              page={page}
              total={data.total}
              limit={limit}
              loading={loading}
              onPage={(n) => {
                setLoading(true)
                setPage(n)
              }}
            />
          </div>
        </div>
      </section>
    </main>
  )
}
