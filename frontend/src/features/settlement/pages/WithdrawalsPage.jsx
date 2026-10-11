import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import {
  CalendarIcon,
  EyeIcon,
  Pagination,
  SearchIcon,
  TableState,
} from '../../management/components/ManagementShared.jsx'
import { listWithdrawals } from '../api/settlementApi.js'
import './withdrawals.css'

const statusLabels = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  SUCCESS: 'Success',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}
const emptyRange = { from: '', to: '' }
const currency = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const requestedDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })
const money = (value) => `${currency.format(Number(value))} ₫`
const localDay = (date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
const displayDay = (value) => value.split('-').reverse().join('/')

export function WithdrawalsPage() {
  const { token, logout, user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const savedList = location.state?.withdrawalListState
  const [search, setSearch] = useState(savedList?.search ?? '')
  const [filters, setFilters] = useState(
    savedList?.filters ?? {
      search: '',
      status: 'ALL',
      page: 1,
      limit: 10,
      ...emptyRange,
    }
  )
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [draftRange, setDraftRange] = useState(emptyRange)
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: { items: [], total: 0 }, error: '' })
  const query = new URLSearchParams({
    search: filters.search,
    status: filters.status,
    page: filters.page,
    limit: filters.limit,
  })
  if (filters.from) query.set('from_date', filters.from)
  if (filters.to) query.set('to_date', filters.to)
  const queryString = query.toString()
  const requestKey = `${queryString}:${refresh}:${token}`
  const loading = response.key !== requestKey || search.trim() !== filters.search
  const { data, error } = response

  // Keep the list entry in browser history in sync, so browser Back and reload
  // restore the same filters as the detail page's explicit return link.
  useEffect(() => {
    const saved = location.state?.withdrawalListState
    if (saved?.search === search && JSON.stringify(saved?.filters) === JSON.stringify(filters))
      return
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: { ...location.state, withdrawalListState: { search, filters } },
    })
  }, [search, filters, navigate, location.pathname, location.search, location.hash, location.state])

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) =>
        current.search === search.trim() ? current : { ...current, search: search.trim(), page: 1 }
      )
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const controller = new AbortController()
    listWithdrawals(queryString, token, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        const lastPage = Math.max(1, Math.ceil(result.total / result.limit))
        if (result.page > lastPage) {
          setFilters((current) => ({ ...current, page: lastPage }))
          return
        }
        setResponse({ key: requestKey, data: result, error: '' })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({ key: requestKey, data: { items: [], total: 0 }, error: err.message })
        if (err.status === 401) logout()
      })
    return () => controller.abort()
  }, [queryString, requestKey, token, logout])

  const updateFilters = (values) => setFilters((current) => ({ ...current, ...values, page: 1 }))
  const reload = () => {
    setFilters((current) => ({ ...current, page: 1 }))
    setRefresh((current) => current + 1)
  }
  const rangeInvalid = Boolean(draftRange.from && draftRange.to && draftRange.from > draftRange.to)
  const rangeLabel =
    filters.from || filters.to
      ? `${filters.from ? displayDay(filters.from) : 'Any date'} – ${filters.to ? displayDay(filters.to) : 'Any date'}`
      : 'All time'
  const initials = (user?.fullName || 'Admin')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
  const start = data.total ? (filters.page - 1) * filters.limit + 1 : 0
  const end = Math.min(filters.page * filters.limit, data.total)

  return (
    <main className="withdrawals-page">
      <header className="withdrawals-topbar">
        <p>
          Finance <span>/</span> <strong>Technician Wallet</strong>
        </p>
        <div>
          <button
            type="button"
            className="withdrawals-refresh"
            onClick={reload}
            disabled={loading}
            aria-label="Refresh withdrawals"
          >
            ↻ Refresh
          </button>
          <Link className="withdrawals-avatar" to="/profile" aria-label="Open profile">
            {initials}
          </Link>
        </div>
      </header>
      <section className="withdrawals-content">
        <div className="withdrawals-heading">
          <h1>Technician Wallet</h1>
          <p aria-live="polite">
            {loading
              ? 'Loading withdrawals…'
              : error
                ? 'Unable to load withdrawals'
                : `${data.total.toLocaleString('en-US')} withdrawal request${data.total === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="withdrawals-tabs">
          <span className="withdrawals-tab-active">
            <span aria-hidden="true">↓</span> Withdrawal History{' '}
            {!loading && !error && <b>{data.total}</b>}
          </span>
          <button type="button" disabled>
            ＋ Top-up History
          </button>
        </div>
        <div className="withdrawals-filters">
          <label className="withdrawals-search">
            <SearchIcon />
            <input
              aria-label="Search withdrawal requests"
              placeholder="Search by request ID, technician name, phone…"
              value={search}
              maxLength={150}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="withdrawals-status-filter">
            <select
              aria-label="Filter withdrawal status"
              value={filters.status}
              onChange={(event) => updateFilters({ status: event.target.value })}
            >
              <option value="ALL">Status: All</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m3 6 5 5 5-5" />
            </svg>
          </div>
          <div className="withdrawals-date-filter">
            <button
              type="button"
              aria-expanded={calendarOpen}
              aria-controls="withdrawals-date-range"
              onClick={() => {
                setDraftRange({ from: filters.from, to: filters.to })
                setCalendarOpen(!calendarOpen)
              }}
            >
              {rangeLabel} <CalendarIcon />
            </button>
            {calendarOpen && (
              <div
                id="withdrawals-date-range"
                className="withdrawals-calendar"
                role="dialog"
                aria-label="Filter request dates"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setCalendarOpen(false)
                }}
              >
                <label>
                  From date
                  <input
                    type="date"
                    value={draftRange.from}
                    max={draftRange.to || undefined}
                    onChange={(event) => setDraftRange({ ...draftRange, from: event.target.value })}
                  />
                </label>
                <label>
                  To date
                  <input
                    type="date"
                    value={draftRange.to}
                    min={draftRange.from || undefined}
                    onChange={(event) => setDraftRange({ ...draftRange, to: event.target.value })}
                  />
                </label>
                {rangeInvalid && <p role="alert">End date must be on or after start date.</p>}
                <div className="withdrawals-presets">
                  <button
                    type="button"
                    onClick={() => {
                      const today = localDay(new Date())
                      setDraftRange({ from: `${today.slice(0, 7)}-01`, to: today })
                    }}
                  >
                    This month
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateFilters(emptyRange)
                      setCalendarOpen(false)
                    }}
                  >
                    All time
                  </button>
                </div>
                <footer>
                  <button type="button" onClick={() => setCalendarOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="withdrawals-apply"
                    disabled={rangeInvalid}
                    onClick={() => {
                      updateFilters(draftRange)
                      setCalendarOpen(false)
                    }}
                  >
                    Apply
                  </button>
                </footer>
              </div>
            )}
          </div>
        </div>
        <div className="withdrawals-table-card" aria-busy={loading}>
          <div className="withdrawals-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>TRANSACTION ID</th>
                  <th>TECHNICIAN</th>
                  <th>WITHDRAWAL AMOUNT</th>
                  <th>REQUESTED DATE</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  loading={loading}
                  error={error}
                  empty={!data.items.length}
                  colSpan={5}
                  retry={reload}
                />
                {!loading &&
                  !error &&
                  data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong className="withdrawals-id" title={row.id}>
                          {row.id.slice(0, 8)}…
                        </strong>
                        <span className={`withdrawals-status status-${row.status.toLowerCase()}`}>
                          {statusLabels[row.status]}
                        </span>
                      </td>
                      <td>
                        <strong>{row.technician_name}</strong>
                        <small>{row.technician_phone || '—'}</small>
                      </td>
                      <td className="withdrawals-amount">{money(row.amount)}</td>
                      <td>{requestedDate.format(new Date(row.initiated_at))}</td>
                      <td>
                        <Link
                          to={`/admin/settlement/withdrawals/${row.id}`}
                          state={{ withdrawalListState: { search, filters } }}
                          className="withdrawals-eye"
                          aria-label={`View withdrawal ${row.id}`}
                          title="View details"
                        >
                          <EyeIcon />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="withdrawals-table-footer">
            <div>
              <span>
                {loading
                  ? 'Loading…'
                  : error
                    ? '—'
                    : `Showing ${start}–${end} of ${data.total} requests`}
              </span>
              <label>
                Show{' '}
                <span className="withdrawals-page-size">
                  <select
                    aria-label="Rows per page"
                    value={filters.limit}
                    onChange={(event) => updateFilters({ limit: Number(event.target.value) })}
                  >
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                  </select>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m3 6 5 5 5-5" />
                  </svg>
                </span>
              </label>
            </div>
            <Pagination
              page={filters.page}
              total={data.total}
              limit={filters.limit}
              loading={loading || Boolean(error)}
              onPage={(page) => setFilters((current) => ({ ...current, page }))}
            />
          </div>
        </div>
      </section>
    </main>
  )
}
