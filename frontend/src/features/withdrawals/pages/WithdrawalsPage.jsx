import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { PageHeader, TableState } from '../../../shared/components/AdminUi.jsx'
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
  const { t, locale } = useUiPreferences()
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
    ? t('Loading withdrawals…')
    : error
      ? t('Unable to load withdrawals')
      : `${total.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')} ${t(total === 1 ? 'withdrawal' : 'withdrawals')}`

  return (
    <main className="withdrawals-page">
      <PageHeader
        title={t('Withdrawal history')}
        subtitle={subtitle}
        onRefresh={reload}
        refreshing={loading}
      />
      <section className="withdrawals-content" aria-label={t('Withdrawal history')}>
        <div className="withdrawals-tabs" aria-label={t('Wallet history')}>
          <span className="withdrawals-tab active" aria-current="page">
            <img src="/withdrawals/withdrawal-tab.svg" alt="" />
            {t('Withdrawal history')}
            <strong
              aria-label={
                loading ? t('Loading count') : error ? t('Count unavailable') : `${total} ${t('withdrawals')}`
              }
            >
              {loading ? '…' : error ? '—' : total.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}
            </strong>
          </span>
          <Link to="/admin/topups" className="withdrawals-tab">
            <img src="/withdrawals/plus.svg" alt="" />
            {t('Top-up history')}
          </Link>
        </div>
        <div className="withdrawals-toolbar">
          <label className="withdrawals-search">
            <img src="/withdrawals/search.svg" alt="" />
            <input
              aria-label={t('Search withdrawals')}
              placeholder={t('Search transaction ID, tech name, phone…')}
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
                aria-label={t('Filter withdrawal status')}
                value={filters.status}
                onChange={(event) => updateFilters({ status: event.target.value })}
              >
                <option value="ALL">{t('Status: All')}</option>
                {Object.entries(withdrawalStatuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
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
          <span>{t('Initiated date · Vietnam time (UTC+7)')}</span>
          {hasFilters && (
            <button type="button" onClick={reset}>
              {t('Clear filters')}
            </button>
          )}
        </div>
        <div className="withdrawals-table-card" aria-busy={loading}>
          <div className="withdrawals-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('TRANSACTION ID')}</th>
                  <th scope="col">{t('TECHNICIAN')}</th>
                  <th scope="col">{t('WITHDRAWAL AMOUNT')}</th>
                  <th scope="col">{t('STATUS')}</th>
                  <th scope="col">{t('WITHDRAWAL DATE')}</th>
                  <th scope="col">{t('ACTION')}</th>
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
                          {t(withdrawalStatuses[row.status] ?? row.status)}
                        </span>
                      </td>
                      <td>{formatWithdrawalDate(row.initiatedAt)}</td>
                      <td>
                        <Link
                          to={`/admin/withdrawals/${row.id}${query ? `?${query}` : ''}`}
                          className="withdrawals-eye"
                          aria-label={`${t('View withdrawal details')} ${withdrawalReference(row)}`}
                          title={t('View withdrawal details')}
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
                  ? t('Loading withdrawals…')
                  : error
                    ? t('Count unavailable')
                    : t('Showing {start}–{end} of {total} withdrawal transactions', { start, end, total: total.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US') })}
              </span>
              <label className="withdrawals-page-size">
                {t('Show')}
                <span className="withdrawals-select">
                  <select
                    aria-label={t('Withdrawals per page')}
                    value={filters.limit}
                    onChange={(event) => updateFilters({ limit: Number(event.target.value) })}
                  >
                    {[10, 25, 50, 100].map((limit) => (
                      <option key={limit} value={limit}>
                        {t('{count} / page', { count: limit })}
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
