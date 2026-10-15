import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { PageHeader, TableState } from '../../management/components/ManagementShared.jsx'
import { listWithdrawals } from '../api/withdrawalsApi.js'
import WithdrawalDateFilter from '../components/WithdrawalDateFilter.jsx'
import WithdrawalPagination from '../components/WithdrawalPagination.jsx'
import {
  initialWithdrawalFilters,
  readWithdrawalFilters,
  writeWithdrawalFilters,
} from '../withdrawalFilters.js'
import {
  formatWithdrawalAmount,
  formatWithdrawalDate,
  withdrawalReference,
  withdrawalStatuses,
  withdrawalText,
} from '../withdrawalPresentation.js'
import './withdrawals.css'

export default function WithdrawalsPage() {
  const { token, clearSession } = useAuth()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const filters = readWithdrawalFilters(params)
  const latestFiltersRef = useRef(filters)
  const [draftSearch, setDraftSearch] = useState(() => ({
    value: filters.search,
    source: location.key,
  }))
  const search = draftSearch.source === location.key ? draftSearch.value : filters.search
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '' })
  const query = writeWithdrawalFilters(filters).toString()
  const requestKey = `${query}:${refresh}:${token}`
  const loading = response.key !== requestKey || search.trim() !== filters.search
  const data = !loading && !response.error ? response.data : null
  const error = response.key === requestKey ? response.error : ''
  const total = data?.pagination.total ?? 0
  const items = data?.items ?? []
  const hasFilters = Boolean(
    search.trim() || filters.status !== 'ALL' || filters.from || filters.to
  )

  useLayoutEffect(() => {
    latestFiltersRef.current = readWithdrawalFilters(params)
  }, [params])

  const setFilters = useCallback(
    (update) => {
      const next = typeof update === 'function' ? update(latestFiltersRef.current) : update
      latestFiltersRef.current = next
      setParams(writeWithdrawalFilters(next), { replace: true })
    },
    [setParams]
  )

  useEffect(() => {
    if (search.trim() === filters.search) return
    const timer = window.setTimeout(() => {
      setFilters((current) =>
        current.search === search.trim() ? current : { ...current, search: search.trim(), page: 1 }
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, filters.search, setFilters])

  useEffect(() => {
    const controller = new AbortController()
    listWithdrawals(query, token, controller.signal)
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
  }, [query, requestKey, token, clearSession, setFilters])

  const updateFilters = (values) =>
    setFilters((current) => ({
      ...current,
      ...values,
      ...(search.trim() !== filters.search ? { search: search.trim() } : {}),
      page: 1,
    }))
  const reload = () => setRefresh((value) => value + 1)
  const reset = () => {
    setDraftSearch({ value: '', source: location.key })
    setFilters((current) => ({ ...initialWithdrawalFilters, limit: current.limit }))
  }
  const start = total ? (filters.page - 1) * filters.limit + 1 : 0
  const end = Math.min(filters.page * filters.limit, total)
  const subtitle = loading
    ? 'Loading withdrawals…'
    : error
      ? 'Unable to load withdrawals'
      : `${total.toLocaleString('en-US')} ${total === 1 ? 'withdrawal' : 'withdrawals'}`

  return (
    <main className="withdrawals-page">
      <PageHeader
        title="Technician wallet"
        subtitle={subtitle}
        onRefresh={reload}
        refreshing={loading}
      />
      <section className="withdrawals-content" aria-label="Withdrawal history">
        <div className="withdrawals-tabs" aria-label="Wallet history">
          <span className="withdrawals-tab active" aria-current="page">
            <img src="/withdrawals/withdrawal-tab.svg" alt="" />
            Withdrawal History
            <strong
              aria-label={
                loading ? 'Loading count' : error ? 'Count unavailable' : `${total} withdrawals`
              }
            >
              {loading ? '…' : error ? '—' : total.toLocaleString('en-US')}
            </strong>
          </span>
          <Link to="/admin/topups" className="withdrawals-tab">
            <img src="/withdrawals/plus.svg" alt="" />
            Top-up History
          </Link>
        </div>
        <div className="withdrawals-toolbar">
          <label className="withdrawals-search">
            <img src="/withdrawals/search.svg" alt="" />
            <input
              aria-label="Search withdrawals"
              placeholder="Search transaction ID, tech name, phone…"
              maxLength={150}
              value={search}
              onChange={(event) =>
                setDraftSearch({ value: event.target.value, source: location.key })
              }
            />
          </label>
          <div className="withdrawals-toolbar-filters">
            <span className="withdrawals-select withdrawals-status-select">
              <select
                aria-label="Filter withdrawal status"
                value={filters.status}
                onChange={(event) => updateFilters({ status: event.target.value })}
              >
                <option value="ALL">Status: All</option>
                {Object.entries(withdrawalStatuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <img src="/withdrawals/status-chevron.svg" alt="" />
            </span>
            <WithdrawalDateFilter
              value={{ from: filters.from, to: filters.to }}
              onChange={updateFilters}
            />
          </div>
        </div>
        <div className="withdrawals-filter-summary">
          <span>Initiated date · Vietnam time (UTC+7)</span>
          {hasFilters && (
            <button type="button" onClick={reset}>
              Clear filters
            </button>
          )}
        </div>
        <div className="withdrawals-table-card" aria-busy={loading}>
          <div className="withdrawals-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">TRANSACTION ID</th>
                  <th scope="col">TECHNICIAN</th>
                  <th scope="col">WITHDRAWAL AMOUNT</th>
                  <th scope="col">STATUS</th>
                  <th scope="col">WITHDRAWAL DATE</th>
                  <th scope="col">ACTION</th>
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
                {!loading &&
                  !error &&
                  items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <code className="withdrawals-code" title={row.payoutReference || row.id}>
                          {withdrawalReference(row)}
                        </code>
                      </td>
                      <td>
                        <strong>{withdrawalText(row.technician.name)}</strong>
                        <small className="withdrawals-phone">
                          {withdrawalText(row.technician.phone)}
                        </small>
                      </td>
                      <td className="withdrawals-amount">{formatWithdrawalAmount(row.amount)}</td>
                      <td>
                        <span className={`withdrawals-status status-${row.status.toLowerCase()}`}>
                          {withdrawalStatuses[row.status] ?? row.status}
                        </span>
                      </td>
                      <td>{formatWithdrawalDate(row.initiatedAt)}</td>
                      <td>
                        <Link
                          to={`/admin/withdrawals/${row.id}${query ? `?${query}` : ''}`}
                          className="withdrawals-eye"
                          aria-label={`View withdrawal ${withdrawalReference(row)}`}
                          title="View withdrawal details"
                        >
                          <img src="/withdrawals/eye.svg" alt="" />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="withdrawals-table-footer">
            <div className="withdrawals-page-summary">
              <span aria-live="polite">
                {loading
                  ? 'Loading withdrawals…'
                  : error
                    ? 'Count unavailable'
                    : `Showing ${start}–${end} of ${total.toLocaleString('en-US')} withdrawal transactions`}
              </span>
              <label className="withdrawals-page-size">
                Show
                <span className="withdrawals-select">
                  <select
                    aria-label="Withdrawals per page"
                    value={filters.limit}
                    onChange={(event) => updateFilters({ limit: Number(event.target.value) })}
                  >
                    {[10, 25, 50, 100].map((limit) => (
                      <option key={limit} value={limit}>
                        {limit} / page
                      </option>
                    ))}
                  </select>
                  <img src="/withdrawals/chevron.svg" alt="" />
                </span>
              </label>
            </div>
            <WithdrawalPagination
              page={filters.page}
              totalPages={data?.pagination.totalPages ?? 0}
              loading={loading || Boolean(error)}
              onPage={(page) => setFilters((current) => ({ ...current, page }))}
            />
          </div>
        </div>
      </section>
    </main>
  )
}
