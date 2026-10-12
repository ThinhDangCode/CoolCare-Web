import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { adminRequest } from '../../management/api/managementApi.js'
import {
  PageHeader,
  SearchIcon,
  EyeIcon,
  Pagination,
  TableState,
} from '../../management/components/ManagementShared.jsx'
import { BookingStatus } from './BookingShared.jsx'
import { bookingStatusLabels, date, money } from './bookingFormat.js'
import '../../management/pages/management.css'
import './bookings.css'

export function BookingsPage() {
  const { token, logout } = useAuth()
  const [search, setSearch] = useState(''),
    [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('ALL'),
    [service, setService] = useState(''),
    [month, setMonth] = useState('')
  const [page, setPage] = useState(1),
    [limit, setLimit] = useState(10)
  const [data, setData] = useState({ items: [], total: 0 }),
    [services, setServices] = useState([])
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true)
      setKeyword(search.trim())
      setPage(1)
      setRefresh((n) => n + 1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const controller = new AbortController()
    adminRequest('/bookings/options', token, { signal: controller.signal })
      .then(setServices)
      .catch((err) => {
        if (err.status === 401) logout()
      })
    return () => controller.abort()
  }, [token, logout])
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ search: keyword, status, service, month, page, limit })
    adminRequest(`/bookings?${query}`, token, { signal: controller.signal })
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
  }, [token, logout, keyword, status, service, month, page, limit, refresh])
  const change = (setter, value) => {
    setLoading(true)
    setPage(1)
    setter(value)
  }
  const retry = () => {
    setLoading(true)
    setRefresh((n) => n + 1)
  }
  return (
    <main className="figma-admin-main booking-page">
      <PageHeader
        title="Bookings"
        subtitle="Manage customer HVAC appointments, technician allocations, and service progress"
        onRefresh={retry}
        refreshing={loading}
      />
      <section className="booking-content">
        <div className="booking-total">
          <strong>{data.total.toLocaleString('en-US')}</strong> Total Bookings
        </div>
        <div className="booking-toolbar">
          <label className="booking-search">
            <SearchIcon />
            <input
              aria-label="Search bookings"
              placeholder="Search booking ID, customer, phone, service..."
              maxLength={150}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Booking status"
            value={status}
            onChange={(e) => change(setStatus, e.target.value)}
          >
            <option value="ALL">All Statuses</option>
            {Object.entries(bookingStatusLabels).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
          <select
            aria-label="Service"
            value={service}
            onChange={(e) => change(setService, e.target.value)}
          >
            <option value="">All Services</option>
            {services.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <input
            type="month"
            aria-label="Scheduled month"
            value={month}
            onChange={(e) => change(setMonth, e.target.value)}
          />
          {(search || status !== 'ALL' || service || month) && (
            <button
              onClick={() => {
                setSearch('')
                setKeyword('')
                setStatus('ALL')
                setService('')
                setMonth('')
                setPage(1)
                retry()
              }}
            >
              Reset
            </button>
          )}
        </div>
        <section className="booking-table-card">
          <div className="booking-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>BOOKING ID</th>
                  <th>CUSTOMER</th>
                  <th>SERVICE & AC UNITS</th>
                  <th>TECHNICIAN</th>
                  <th>SCHEDULE</th>
                  <th>AMOUNT / PAID</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
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
                          className={`booking-code ${row.status.toLowerCase()}`}
                          to={`/admin/bookings/${row.id}`}
                        >
                          {row.booking_code}
                        </Link>
                      </td>
                      <td>
                        <strong>{row.customer_name}</strong>
                        {row.recipient_name !== row.customer_name && (
                          <small>Recipient: {row.recipient_name}</small>
                        )}
                      </td>
                      <td>
                        {[...new Set(row.services.map((item) => item.name))].join(', ') ||
                          'No services'}
                        <small>
                          {new Set(row.services.map((item) => item.unit_number)).size} AC units
                        </small>
                      </td>
                      <td>
                        {row.technicians.length ? (
                          row.technicians.map((item) => item.full_name).join(', ')
                        ) : (
                          <span className="booking-no-technician">No technician</span>
                        )}
                      </td>
                      <td>{date(row.scheduled_at)}</td>
                      <td>
                        <strong>{money(row.total_amount)}</strong>
                        <small>Paid: {money(row.paid_amount)}</small>
                      </td>
                      <td>
                        <BookingStatus status={row.status} />
                      </td>
                      <td>
                        <Link
                          className="booking-eye"
                          to={`/admin/bookings/${row.id}`}
                          title="View booking details"
                          aria-label={`View booking ${row.booking_code}`}
                        >
                          <EyeIcon />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <footer className="booking-table-footer">
            <span>
              Showing {data.total ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, data.total)}{' '}
              of <strong>{data.total} bookings</strong>
            </span>
            <label>
              Rows:{' '}
              <select
                aria-label="Rows per page"
                value={limit}
                onChange={(e) => change(setLimit, Number(e.target.value))}
              >
                {[10, 20, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
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
          </footer>
        </section>
      </section>
    </main>
  )
}
