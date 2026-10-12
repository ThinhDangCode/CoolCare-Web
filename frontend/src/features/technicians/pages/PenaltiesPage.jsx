import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { adminRequest } from '../../management/api/managementApi.js'
import {
  PageHeader,
  Pagination,
  SearchIcon,
  TableState,
} from '../../management/components/ManagementShared.jsx'
import { TechnicianAvatar, formatDate } from '../components/TechnicianShared.jsx'
import '../../management/pages/management.css'
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
            ['active_points', 'Active penalty points'],
          ].map(([key, title]) => (
            <div key={key}>
              <span>{title}</span>
              <strong>{loading || error ? '—' : data.summary[key]}</strong>
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
                <th>VIOLATION / BOOKING</th>
                <th>PENALTY POINTS</th>
                <th>REASON</th>
                <th>APPLIED DATE</th>
                <th>EXPIRES</th>
                <th>STATUS</th>
                <th>PROFILE</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                loading={loading}
                error={error}
                empty={!data.items.length}
                colSpan={8}
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
                    <td>
                      {types[row.penalty_type]}
                      <small className="technician-muted">
                        {row.booking_code || 'No linked booking'}
                      </small>
                    </td>
                    <td>
                      <span className="penalty-points">+{row.penalty_points}</span>
                    </td>
                    <td className="penalty-reason">{row.reason || 'No reason provided'}</td>
                    <td>{formatDate(row.applied_at)}</td>
                    <td>{row.expires_at ? formatDate(row.expires_at) : 'No expiry'}</td>
                    <td>
                      <span className={`penalty-status ${row.status.toLowerCase()}`}>
                        <i />
                        {statuses[row.status]}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="technician-view"
                        to={`/admin/technicians/${row.technician_id}`}
                      >
                        View profile →
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
              onPage={(n) => filter(setPage, n)}
            />
          </div>
        </div>
      </section>
    </main>
  )
}
