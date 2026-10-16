import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { PageHeader, TableState } from '../../../shared/components/AdminUi.jsx'
import { listTopups } from '../api/topupsApi.js'
import TopupDateFilter from '../components/TopupDateFilter.jsx'
import TopupPagination from '../components/TopupPagination.jsx'
import { initialTopupFilters, readTopupFilters, writeTopupFilters } from '../topupFilters.js'
import {
  formatTopupAmount,
  formatTopupDate,
  topupMethodName,
  topupReference,
  topupStatuses,
  topupText,
} from '../topupPresentation.js'
import './topups.css'

export default function TopupsPage() {
  const { token, clearSession } = useAuth()
  const { t, locale } = useUiPreferences()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const filters = readTopupFilters(params)
  const latestFiltersRef = useRef(filters)
  const [draftSearch, setDraftSearch] = useState(() => ({
    value: filters.search,
    source: location.key,
  }))
  const search = draftSearch.source === location.key ? draftSearch.value : filters.search
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '' })
  const query = writeTopupFilters(filters).toString()
  const requestKey = `${query}:${refresh}:${token}`
  const loading = response.key !== requestKey || search.trim() !== filters.search
  const data = !loading && !response.error ? response.data : null
  const error = response.key === requestKey ? response.error : ''
  const total = data?.pagination.total ?? 0
  const items = data?.items ?? []
  const methods = response.data?.options.methods ?? []
  const hasSelectedMethod =
    filters.method === 'ALL' || methods.some((method) => method.id === filters.method)
  const hasFilters = Boolean(
    search.trim() ||
    filters.status !== 'ALL' ||
    filters.method !== 'ALL' ||
    filters.from ||
    filters.to
  )

  useLayoutEffect(() => {
    latestFiltersRef.current = readTopupFilters(params)
  }, [params])
  const setFilters = useCallback(
    (update) => {
      const next = typeof update === 'function' ? update(latestFiltersRef.current) : update
      latestFiltersRef.current = next
      setParams(writeTopupFilters(next), { replace: true })
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
    listTopups(query, token, controller.signal)
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
        setResponse((current) => ({ key: requestKey, data: current.data, error: err.message }))
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
    setFilters((current) => ({ ...initialTopupFilters, limit: current.limit }))
  }
  const start = total ? (filters.page - 1) * filters.limit + 1 : 0
  const end = Math.min(filters.page * filters.limit, total)
  const subtitle = loading
    ? t('Loading top-ups…')
    : error
      ? t('Unable to load top-ups')
      : `${total.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')} ${t(total === 1 ? 'top-up transaction' : 'top-up transactions')}`

  return (
    <main className="topups-page">
      <PageHeader
        title={t('Top-up Transactions')}
        subtitle={subtitle}
        onRefresh={reload}
        refreshing={loading}
      />
      <section className="topups-content" aria-label={t('Top-up history')}>
        <nav className="topups-tabs" aria-label={t('Wallet history')}>
          <Link to="/admin/withdrawals" className="topups-tab">
            {t('Withdrawal history')}
          </Link>
          <span className="topups-tab active" aria-current="page">
            {t('Top-up history')}
            <strong
              aria-label={
                loading ? t('Loading count') : error ? t('Count unavailable') : `${total} ${t('top-up transactions')}`
              }
            >
              {loading ? '…' : error ? '—' : total.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}
            </strong>
          </span>
        </nav>
        <div className="topups-table-card" aria-busy={loading}>
          <div className="topups-toolbar">
            <label className="topups-search">
              <img src="/topups/search.svg" alt="" />
              <input
                aria-label={t('Search top-ups')}
                placeholder={t('Search top-up code, tech name, phone…')}
                maxLength={150}
                value={search}
                onChange={(event) =>
                  setDraftSearch({ value: event.target.value, source: location.key })
                }
              />
            </label>
            <div className="topups-toolbar-filters">
              <span className="topups-select topups-status-select">
                <select
                  aria-label={t('Filter top-up status')}
                  value={filters.status}
                  onChange={(event) => updateFilters({ status: event.target.value })}
                >
                  <option value="ALL">{t('All Status')}</option>
                  {Object.entries(topupStatuses).map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
                <img src="/topups/dropdown.svg" alt="" />
              </span>
              <span className="topups-select topups-method-select">
                <select
                  aria-label={t('Filter top-up method')}
                  value={filters.method}
                  onChange={(event) => updateFilters({ method: event.target.value })}
                >
                  <option value="ALL">{t('All Methods')}</option>
                  {!hasSelectedMethod && <option value={filters.method}>{t('Selected method')}</option>}
                  {methods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {topupMethodName(method)}
                    </option>
                  ))}
                </select>
                <img src="/topups/dropdown.svg" alt="" />
              </span>
              <TopupDateFilter
                value={{ from: filters.from, to: filters.to }}
                onChange={updateFilters}
              />
            </div>
            <div className="topups-toolbar-actions">
              <button
                type="button"
                aria-label={t('Clear top-up filters')}
                title={t('Clear filters')}
                disabled={!hasFilters}
                onClick={reset}
              >
                <img src="/topups/clear.svg" alt="" />
              </button>
              <button
                type="button"
                aria-label={t('Refresh top-ups')}
                title={t('Refresh top-ups')}
                disabled={loading}
                onClick={reload}
              >
                <img src="/topups/refresh.svg" alt="" />
              </button>
            </div>
          </div>
          <p className="topups-filter-basis">{t('Created date · Vietnam time (UTC+7)')}</p>
          <div className="topups-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('TRANSACTION ID')}</th>
                  <th scope="col">{t('TECHNICIAN NAME')}</th>
                  <th scope="col">{t('AMOUNT')}</th>
                  <th scope="col">{t('PAYMENT METHOD')}</th>
                  <th scope="col">{t('STATUS')}</th>
                  <th scope="col">{t('CREATED DATE')}</th>
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
                        <Link
                          to={`/admin/topups/${row.id}${query ? `?${query}` : ''}`}
                          className="topups-code"
                          aria-label={`${t('View top-up details')} ${topupReference(row)}`}
                          title={t('View top-up details')}
                        >
                          {topupReference(row)}
                        </Link>
                      </td>
                      <td>
                        <strong>{topupText(row.technician.name)}</strong>
                        <small className="topups-phone">{topupText(row.technician.phone)}</small>
                      </td>
                      <td className="topups-amount">{formatTopupAmount(row.amount)}</td>
                      <td>
                        <span className="topups-method">{topupMethodName(row.method)}</span>
                      </td>
                      <td>
                        <span className={`topups-status status-${row.status.toLowerCase()}`}>
                          {t(topupStatuses[row.status] ?? row.status)}
                        </span>
                      </td>
                      <td>{formatTopupDate(row.createdAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="topups-table-footer">
            <div className="topups-page-summary">
              <span aria-live="polite">
                {loading
                  ? t('Loading top-ups…')
                  : error
                    ? t('Count unavailable')
                    : t('Showing {start}–{end} of {total} transactions', { start, end, total: total.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US') })}
              </span>
              <label className="topups-page-size">
                {t('Rows per page:')}
                <span className="topups-select">
                  <select
                    aria-label={t('Rows per page:')}
                    value={filters.limit}
                    onChange={(event) => updateFilters({ limit: Number(event.target.value) })}
                  >
                    {[10, 25, 50, 100].map((limit) => (
                      <option key={limit} value={limit}>
                        {t('{count} / page', { count: limit })}
                      </option>
                    ))}
                  </select>
                  <img src="/topups/dropdown.svg" alt="" />
                </span>
              </label>
            </div>
            <TopupPagination
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
