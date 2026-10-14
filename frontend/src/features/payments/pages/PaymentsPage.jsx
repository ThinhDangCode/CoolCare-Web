import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import {
  CalendarIcon,
  ChevronDownIcon,
  EyeIcon,
  PageHeader,
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
  const { token, clearSession } = useAuth()
  const { t, locale } = useUiPreferences()
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
  const transactionLabel = t(total === 1 ? 'transaction' : 'transactions')
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
      ? `${filters.from ? formatDay(filters.from) : t('Any date')} – ${filters.to ? formatDay(filters.to) : t('Any date')}`
      : t('All time')
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
      <PageHeader
        title="Payments"
        subtitle={
          loading
            ? t('Loading transactions…')
            : error
              ? t('Unable to load transactions')
              : `${total.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')} ${transactionLabel}`
        }
        onRefresh={reload}
        refreshing={loading}
      />
      <section className="payments-content" aria-label={t('Payment transactions')}>
        <div className="payments-toolbar">
          <div className="payments-search-filters">
            <label className="payments-search">
              <SearchIcon />
              <input
                ref={searchRef}
                aria-label={t('Search payments')}
                placeholder={t('Search transaction ID, booking ID, customer…')}
                maxLength={150}
                value={search}
                onChange={(event) =>
                  setDraftSearch({ value: event.target.value, source: location.key })
                }
              />
            </label>
            <span className="payments-select payments-status-select">
              <select
                aria-label={t('Filter payment status')}
                value={filters.status}
                onChange={(event) => updateFilters({ status: event.target.value })}
              >
                <option value="ALL">{t('All Status')}</option>
                {Object.entries(paymentStatuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
              <ChevronDownIcon />
            </span>
            <span className="payments-select payments-method-select">
              <select
                aria-label={t('Filter payment method')}
                value={filters.method}
                onChange={(event) => updateFilters({ method: event.target.value })}
              >
                <option value="ALL">{t('All Methods')}</option>
                {Object.entries(paymentMethods).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
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
                title={t('Created date · Vietnam time')}
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
                  <h2 id="payments-date-title">{t('Created date')}</h2>
                  <p>{t('Calendar dates in Vietnam time (UTC+7).')}</p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (rangeError) return
                      updateFilters(draftRange)
                      closeCalendar()
                    }}
                  >
                    <label>
                      {t('From date')}
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
                      {t('To date')}
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
                        {t('All time')}
                      </button>
                      <button type="button" onClick={closeCalendar}>
                        {t('Cancel')}
                      </button>
                      <button
                        className="payments-apply"
                        type="submit"
                        disabled={Boolean(rangeError)}
                      >
                        {t('Apply')}
                      </button>
                    </footer>
                  </form>
                </div>
              )}
            </div>
            <button type="button" className="payments-refresh" onClick={reload} disabled={loading}>
              <img src="/payments/refresh.svg" width="14" height="14" alt="" aria-hidden="true" />
              {t('Refresh')}
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
              {t('Export Revenue Report')}
            </button>
          </div>
        </div>
        {hasFilters && (
          <div className="payments-filter-summary">
            <span>
              {t('Filtered transactions')}
              {filters.from || filters.to ? ` · ${t('Created date')}` : ''}
            </span>
            <button type="button" onClick={resetFilters}>
              {t('Reset filters')}
            </button>
          </div>
        )}
        <div className="payments-table-card" aria-busy={loading}>
          <div className="payments-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('TRANSACTION ID')}</th>
                  <th>{t('CUSTOMER')}</th>
                  <th>{t('AMOUNT')}</th>
                  <th>{t('METHOD')}</th>
                  <th>{t('STATUS')}</th>
                  <th>{t('ACTIONS')}</th>
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
                          {t(paymentMethods[row.methodCode] ?? row.methodName)}
                        </span>
                      </td>
                      <td>
                        <span className={`payments-status status-${row.status.toLowerCase()}`}>
                          {t(paymentStatuses[row.status] ?? row.status)}
                        </span>
                      </td>
                      <td>
                        <Link
                          to={`/admin/payments/${row.id}${listQuery ? `?${listQuery}` : ''}`}
                          className="payments-eye"
                          aria-label={`View payment ${row.paymentCode}`}
                          title={t('View payment details')}
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
                  ? t('Loading…')
                  : error
                    ? t('Unable to load transactions')
                    : `${t('Showing')} ${start}–${end} ${t('of')} ${total.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')} ${transactionLabel}`}
              </span>
              <span className="payments-select payments-page-size">
                <select
                  aria-label={t('Rows per page')}
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
