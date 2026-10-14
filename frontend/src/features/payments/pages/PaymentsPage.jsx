import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import {
  BellIcon,
  CalendarIcon,
  ChevronDownIcon,
  EyeIcon,
  Pagination,
  SearchIcon,
  TableState,
} from '../../../shared/components/AdminUi.jsx'
import { listPayments } from '../api/paymentsApi.js'
import ExportRevenueDialog from '../components/ExportRevenueDialog.jsx'
import {
  initialPaymentFilters,
  readPaymentFilters,
  validPaymentDay,
  writePaymentFilters,
} from '../paymentListFilters.js'
import { formatPaymentAmount, paymentMethods, paymentStatuses } from '../paymentPresentation.js'
import './payments.css'

const emptyRange = { from: '', to: '' }
const formatDay = (value) => value.split('-').reverse().join('/')

function validateRange(range) {
  if ((range.from && !validPaymentDay(range.from)) || (range.to && !validPaymentDay(range.to))) {
    return 'Enter valid dates in YYYY-MM-DD format.'
  }
  if (range.from && range.to && range.from > range.to) {
    return 'To date must be on or after From date.'
  }
  return ''
}

export default function PaymentsPage() {
  const { token, user, clearSession } = useAuth()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const filters = readPaymentFilters(params)
  // Search-param updater callbacks do not queue like React state updates.
  // Merge rapid filter changes before the next render, then sync external navigation.
  const latestFiltersRef = useRef(filters)
  useLayoutEffect(() => {
    latestFiltersRef.current = readPaymentFilters(params)
  }, [params])
  const [draftSearch, setDraftSearch] = useState(() => ({
    value: filters.search,
    source: location.key,
  }))
  const search = draftSearch.source === location.key ? draftSearch.value : filters.search
  const setFilters = useCallback(
    (update) => {
      const next = typeof update === 'function' ? update(latestFiltersRef.current) : update
      latestFiltersRef.current = next
      setParams(writePaymentFilters(next), { replace: true })
    },
    [setParams]
  )
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '' })
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [draftRange, setDraftRange] = useState(emptyRange)
  const searchRef = useRef(null)
  const dateFilterRef = useRef(null)
  const dateButtonRef = useRef(null)
  const dateFromRef = useRef(null)
  const exportTriggerRef = useRef(null)

  const query = new URLSearchParams({
    search: filters.search,
    status: filters.status,
    method: filters.method,
    page: filters.page,
    limit: filters.limit,
  })
  if (filters.from) query.set('from', filters.from)
  if (filters.to) query.set('to', filters.to)
  const queryString = query.toString()
  const listQuery = writePaymentFilters(filters).toString()
  const requestKey = `${queryString}:${refresh}:${token}`
  const loading = response.key !== requestKey || search.trim() !== filters.search
  const data = !loading && !response.error ? response.data : null
  const error = response.key === requestKey ? response.error : ''
  const total = data?.pagination.total ?? 0
  const transactionLabel = total === 1 ? 'transaction' : 'transactions'
  const items = data?.items ?? []
  const rangeError = validateRange(draftRange)
  const hasFilters = Boolean(
    search.trim() ||
    filters.status !== 'ALL' ||
    filters.method !== 'ALL' ||
    filters.from ||
    filters.to
  )
  const rangeLabel =
    filters.from || filters.to
      ? `${filters.from ? formatDay(filters.from) : 'Any date'} – ${filters.to ? formatDay(filters.to) : 'Any date'}`
      : 'All time'
  const initials = (user?.fullName || 'Admin')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  useEffect(() => {
    if (search.trim() === filters.search) return undefined
    const timer = window.setTimeout(() => {
      setFilters((current) =>
        current.search === search.trim() ? current : { ...current, search: search.trim(), page: 1 }
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, filters.search, setFilters])

  useEffect(() => {
    const controller = new AbortController()
    listPayments(queryString, token, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        const lastPage = Math.max(1, result.pagination.totalPages)
        if (result.pagination.page > lastPage) {
          setFilters((current) => ({ ...current, page: lastPage }))
          return
        }
        setResponse({ key: requestKey, data: result, error: '' })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({ key: requestKey, data: null, error: err.message })
        if (err.status === 401) clearSession()
      })
    return () => controller.abort()
  }, [queryString, requestKey, token, clearSession, setFilters])

  useEffect(() => {
    if (!calendarOpen) return undefined
    dateFromRef.current?.focus()
    const closeOutside = (event) => {
      if (!dateFilterRef.current?.contains(event.target)) setCalendarOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [calendarOpen])

  const updateFilters = (values) =>
    setFilters((current) => ({
      ...current,
      ...values,
      ...(search.trim() !== filters.search ? { search: search.trim() } : {}),
      page: 1,
    }))
  const reload = () => setRefresh((current) => current + 1)
  const closeCalendar = () => {
    setCalendarOpen(false)
    dateButtonRef.current?.focus()
  }
  const resetFilters = () => {
    setDraftSearch({ value: '', source: location.key })
    setFilters((current) => ({ ...initialPaymentFilters, limit: current.limit }))
    setDraftRange(emptyRange)
    setCalendarOpen(false)
  }
  const start = total ? (filters.page - 1) * filters.limit + 1 : 0
  const end = Math.min(filters.page * filters.limit, total)

  return (
    <main className="payments-page">
      <header className="payments-header">
        <div className="figma-header-title">
          <h1>Payments</h1>
          <p aria-live="polite">
            {loading
              ? 'Loading transactions…'
              : error
                ? 'Unable to load transactions'
                : `${total.toLocaleString('en-US')} ${transactionLabel}`}
          </p>
        </div>
        <div className="payments-header-actions">
          <button
            type="button"
            aria-label="Focus transaction search"
            onClick={() => searchRef.current?.focus()}
          >
            <SearchIcon />
          </button>
          <button type="button" aria-label="Notifications" disabled>
            <BellIcon />
          </button>
          <Link
            className="payments-avatar"
            to="/profile"
            aria-label="Open profile"
            style={user?.avatarUrl ? { backgroundImage: `url(${user.avatarUrl})` } : undefined}
          >
            {!user?.avatarUrl && initials}
          </Link>
        </div>
      </header>
      <section className="payments-content" aria-label="Payment transactions">
        <div className="payments-toolbar">
          <div className="payments-search-filters">
            <label className="payments-search">
              <SearchIcon />
              <input
                ref={searchRef}
                aria-label="Search payments"
                placeholder="Search transaction ID, booking ID, customer…"
                maxLength={150}
                value={search}
                onChange={(event) =>
                  setDraftSearch({ value: event.target.value, source: location.key })
                }
              />
            </label>
            <span className="payments-select payments-status-select">
              <select
                aria-label="Filter payment status"
                value={filters.status}
                onChange={(event) => updateFilters({ status: event.target.value })}
              >
                <option value="ALL">All Status</option>
                {Object.entries(paymentStatuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon />
            </span>
            <span className="payments-select payments-method-select">
              <select
                aria-label="Filter payment method"
                value={filters.method}
                onChange={(event) => updateFilters({ method: event.target.value })}
              >
                <option value="ALL">All Methods</option>
                {Object.entries(paymentMethods).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon />
            </span>
          </div>
          <div className="payments-date-refresh">
            <div className="payments-date-filter" ref={dateFilterRef}>
              <button
                ref={dateButtonRef}
                type="button"
                className="payments-date-button"
                aria-label={`Filter by created date: ${rangeLabel}`}
                aria-expanded={calendarOpen}
                aria-controls="payments-date-range"
                title="Created date · Vietnam time"
                onClick={() => {
                  setDraftRange({ from: filters.from, to: filters.to })
                  setCalendarOpen((current) => !current)
                }}
              >
                <CalendarIcon /> <span>{rangeLabel}</span>
              </button>
              {calendarOpen && (
                <div
                  id="payments-date-range"
                  className="payments-calendar"
                  role="dialog"
                  aria-labelledby="payments-date-title"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') closeCalendar()
                  }}
                >
                  <h2 id="payments-date-title">Created date</h2>
                  <p>Calendar dates in Vietnam time (UTC+7).</p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (rangeError) return
                      updateFilters(draftRange)
                      closeCalendar()
                    }}
                  >
                    <label>
                      From date
                      <input
                        ref={dateFromRef}
                        type="date"
                        min="0001-01-01"
                        max={draftRange.to || '9999-12-31'}
                        value={draftRange.from}
                        onChange={(event) =>
                          setDraftRange((current) => ({ ...current, from: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      To date
                      <input
                        type="date"
                        min={draftRange.from || '0001-01-01'}
                        max="9999-12-31"
                        value={draftRange.to}
                        onChange={(event) =>
                          setDraftRange((current) => ({ ...current, to: event.target.value }))
                        }
                      />
                    </label>
                    {rangeError && (
                      <p className="payments-date-error" role="alert">
                        {rangeError}
                      </p>
                    )}
                    <footer>
                      <button
                        type="button"
                        onClick={() => {
                          updateFilters(emptyRange)
                          closeCalendar()
                        }}
                      >
                        All time
                      </button>
                      <button type="button" onClick={closeCalendar}>
                        Cancel
                      </button>
                      <button
                        className="payments-apply"
                        type="submit"
                        disabled={Boolean(rangeError)}
                      >
                        Apply
                      </button>
                    </footer>
                  </form>
                </div>
              )}
            </div>
            <button type="button" className="payments-refresh" onClick={reload} disabled={loading}>
              <img src="/payments/refresh.svg" width="14" height="14" alt="" aria-hidden="true" />
              Refresh
            </button>
            <button
              ref={exportTriggerRef}
              type="button"
              className="payments-export"
              onClick={() => {
                setCalendarOpen(false)
                setExportOpen(true)
              }}
            >
              Export Revenue Report
            </button>
          </div>
        </div>
        {hasFilters && (
          <div className="payments-filter-summary">
            <span>Filtered transactions{filters.from || filters.to ? ' · Created date' : ''}</span>
            <button type="button" onClick={resetFilters}>
              Reset filters
            </button>
          </div>
        )}
        <div className="payments-table-card" aria-busy={loading}>
          <div className="payments-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>TRANSACTION ID</th>
                  <th>CUSTOMER</th>
                  <th>AMOUNT</th>
                  <th>METHOD</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  loading={loading}
                  error={error}
                  empty={!items.length}
                  colSpan={6}
                  retry={reload}
                />
                {data &&
                  items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong className="payments-code" title={row.paymentCode}>
                          {row.paymentCode}
                        </strong>
                      </td>
                      <td>
                        <strong>{row.customerName}</strong>
                      </td>
                      <td className="payments-amount">{formatPaymentAmount(row.amount)}</td>
                      <td>
                        <span className={`payments-method method-${row.methodCode.toLowerCase()}`}>
                          {paymentMethods[row.methodCode] ?? row.methodName}
                        </span>
                      </td>
                      <td>
                        <span className={`payments-status status-${row.status.toLowerCase()}`}>
                          {paymentStatuses[row.status] ?? row.status}
                        </span>
                      </td>
                      <td>
                        <Link
                          to={`/admin/payments/${row.id}${listQuery ? `?${listQuery}` : ''}`}
                          className="payments-eye"
                          aria-label={`View payment ${row.paymentCode}`}
                          title="View payment details"
                        >
                          <EyeIcon />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="payments-table-footer">
            <div className="payments-page-summary">
              <span aria-live="polite">
                {loading
                  ? 'Loading…'
                  : error
                    ? 'Unable to load transactions'
                    : `Showing ${start}–${end} of ${total.toLocaleString('en-US')} ${transactionLabel}`}
              </span>
              <span className="payments-select payments-page-size">
                <select
                  aria-label="Rows per page"
                  value={filters.limit}
                  onChange={(event) => updateFilters({ limit: Number(event.target.value) })}
                >
                  <option value={10}>10 / page</option>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                </select>
                <ChevronDownIcon />
              </span>
            </div>
            <Pagination
              page={filters.page}
              total={total}
              limit={filters.limit}
              loading={loading || Boolean(error)}
              onPage={(page) => setFilters((current) => ({ ...current, page }))}
            />
          </div>
        </div>
      </section>
      {exportOpen && (
        <ExportRevenueDialog
          token={token}
          initialSearch={search}
          initialMethod={filters.method}
          onClose={() => setExportOpen(false)}
          onUnauthorized={clearSession}
          returnFocusRef={exportTriggerRef}
        />
      )}
    </main>
  )
}
