import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { PageHeader, Pagination, TableState } from '../../../shared/components/AdminUi.jsx'
import { listSettlements } from '../api/settlementsApi.js'
import SettlementDateFilter from '../components/SettlementDateFilter.jsx'
import {
  initialSettlementFilters,
  readSettlementFilters,
  settlementApiQuery,
  settlementStatuses,
  writeSettlementFilters,
} from '../settlementFilters.js'
import {
  formatSettlementAmount,
  formatSettlementPeriod,
  settlementAmountTone,
  settlementErrorMessage,
  technicianInitials,
} from '../settlementPresentation.js'
import './settlements.css'

const summaryCards = [
  {
    key: 'totalPeriods',
    label: 'Total settlement periods',
    icon: 'metric-total.svg',
    width: 15,
    height: 16.6667,
    tone: 'blue',
  },
  {
    key: 'owingPeriods',
    label: 'Periods with debt',
    icon: 'metric-owing.svg',
    width: 13.3333,
    height: 16.6667,
    tone: 'amber',
  },
  {
    key: 'settledPeriods',
    label: 'Settled periods',
    icon: 'metric-settled.svg',
    width: 16.6667,
    height: 16.6667,
    tone: 'green',
  },
  {
    key: 'remainingDebt',
    label: 'Remaining debt',
    icon: 'metric-debt.svg',
    width: 18.3333,
    height: 15.8333,
    tone: 'red',
    money: true,
  },
]
const balanceColumns = [
  { key: 'openingBalance', label: 'Opening balance', shortLabel: 'Opening' },
  { key: 'cashSettlement', label: 'Cash settlement', shortLabel: 'Cash', signed: true },
  { key: 'onlineEarning', label: 'Online earnings', shortLabel: 'Online' },
  { key: 'topup', label: 'Top-up' },
  { key: 'withdrawal', label: 'Withdrawal' },
  { key: 'closingBalance', label: 'Closing balance', shortLabel: 'Closing', strong: true },
  { key: 'debtRemainingAmount', label: 'Remaining debt', shortLabel: 'Debt left', debt: true },
]

function Technician({ technician }) {
  const [failedUrl, setFailedUrl] = useState('')
  const avatarUrl = /^https?:\/\//i.test(technician.avatarUrl || '') ? technician.avatarUrl : ''
  return (
    <div className="settlements-technician">
      <span className="settlements-avatar">
        {avatarUrl && avatarUrl !== failedUrl ? (
          <img src={avatarUrl} alt="" onError={() => setFailedUrl(avatarUrl)} />
        ) : (
          technicianInitials(technician.name)
        )}
      </span>
      <span>
        <strong>{technician.name || '—'}</strong>
        <small>{technician.phone || '—'}</small>
      </span>
    </div>
  )
}

export default function SettlementsPage() {
  const { token, clearSession } = useAuth()
  const { t, locale } = useUiPreferences()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const filters = readSettlementFilters(params)
  const latestFiltersRef = useRef(filters)
  const [draftSearch, setDraftSearch] = useState(() => ({
    value: filters.search,
    source: location.key,
  }))
  const search = draftSearch.source === location.key ? draftSearch.value : filters.search
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '' })
  const query = settlementApiQuery(filters)
  const requestKey = `${query}:${refresh}:${token}`
  const loading = response.key !== requestKey || search.trim() !== filters.search
  const error = response.key === requestKey ? t(response.error) : ''
  const data = !loading && !response.error ? response.data : null
  const items = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const hasWideAmounts = items.some((row) =>
    balanceColumns.some(
      (column) =>
        formatSettlementAmount(row.totals[column.key], locale, column.signed, false).length > 11
    )
  )
  const number = (value) => value?.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US') ?? '—'

  useLayoutEffect(() => {
    latestFiltersRef.current = readSettlementFilters(params)
  }, [params])
  const setFilters = useCallback(
    (update) => {
      const next = typeof update === 'function' ? update(latestFiltersRef.current) : update
      latestFiltersRef.current = next
      setParams(writeSettlementFilters(next), { replace: true })
    },
    [setParams]
  )
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
    listSettlements(query, token, controller.signal)
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
        setResponse({ key: requestKey, data: null, error: settlementErrorMessage(err) })
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
    setFilters((current) => ({ ...initialSettlementFilters(), limit: current.limit }))
  }
  const start = total ? (filters.page - 1) * filters.limit + 1 : 0
  const end = Math.min(filters.page * filters.limit, total)
  return (
    <main className="settlements-page">
      <PageHeader
        title="Technician settlements"
        subtitle="Weekly reconciliation and technician debt clearance"
        onRefresh={reload}
        refreshing={loading}
      />
      <section className="settlements-content" aria-label={t('Technician settlements')}>
        <div
          className="settlements-summary"
          aria-label={t('Settlement overview')}
          aria-busy={loading}
        >
          {summaryCards.map((card) => (
            <article className={`settlements-metric metric-${card.tone}`} key={card.key}>
              <div>
                <h2>{t(card.label)}</h2>
                <span className="settlements-metric-icon">
                  <img
                    src={`/settlements/${card.icon}`}
                    width={card.width}
                    height={card.height}
                    alt=""
                  />
                </span>
              </div>
              <strong>
                {card.money
                  ? formatSettlementAmount(data?.summary[card.key], locale)
                  : number(data?.summary[card.key])}
              </strong>
            </article>
          ))}
        </div>
        <div className="settlements-toolbar">
          <label className="settlements-search">
            <img src="/settlements/search.svg" width="13.5" height="13.5" alt="" />
            <input
              aria-label={t('Search settlements')}
              placeholder={t('Search technician name, ID, phone, settlement code…')}
              maxLength={150}
              value={search}
              onChange={(event) =>
                setDraftSearch({ value: event.target.value, source: location.key })
              }
            />
          </label>
          <div className="settlements-toolbar-filters">
            <SettlementDateFilter filters={filters} onChange={updateFilters} />
            <span className="settlements-select settlements-status-select">
              <select
                aria-label={t('Filter settlement status')}
                value={filters.status}
                onChange={(event) => updateFilters({ status: event.target.value })}
              >
                <option value="ALL">{t('All Status')}</option>
                {Object.entries(settlementStatuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
              <img src="/settlements/chevron-down.svg" width="21" height="21" alt="" />
            </span>
            <button type="button" className="settlements-reset" onClick={reset}>
              <img src="/settlements/reset.svg" width="10.6667" height="12.3" alt="" />
              {t('Reset filters')}
            </button>
          </div>
        </div>
        <div className="settlements-filter-note">
          <span>{t('Settlement period start · Vietnam time (UTC+7)')}</span>
          {data && data.summary.openPeriods > 0 && (
            <span>
              {t('{count} periods are not finalized; their balances are unavailable.', {
                count: number(data.summary.openPeriods),
              })}
            </span>
          )}
        </div>
        <div className="settlements-table-card" aria-busy={loading}>
          <div className="settlements-table-caption">
            <span>{t('Settlement records')}</span>
            <span>{t('Unit: VND')}</span>
          </div>
          <div
            className="settlements-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t('Settlement records')}
          >
            <table
              className="settlements-table"
              role="table"
              aria-label={t('Settlement records')}
              data-wide-amounts={hasWideAmounts ? 'true' : undefined}
            >
              <colgroup>
                <col className="settlements-col-technician" />
                <col className="settlements-col-period" />
                {balanceColumns.map((column) => (
                  <col key={column.key} className="settlements-col-money" />
                ))}
                <col className="settlements-col-status" />
              </colgroup>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col">{t('Technician')}</th>
                  <th scope="col">{t('Settlement period')}</th>
                  {balanceColumns.map((column) => (
                    <th
                      scope="col"
                      className="settlements-number-heading"
                      key={column.key}
                      title={t(column.label)}
                    >
                      {t(column.shortLabel ?? column.label)}
                    </th>
                  ))}
                  <th scope="col">{t('Status')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                <TableState
                  loading={loading}
                  error={error}
                  empty={!items.length}
                  colSpan={balanceColumns.length + 3}
                  retry={reload}
                />
                {data &&
                  items.map((row) => (
                    <tr key={row.id} role="row" className="settlements-record-row">
                      <td
                        role="cell"
                        className="settlements-technician-cell"
                        data-label={t('Technician')}
                      >
                        <Technician technician={row.technician} />
                      </td>
                      <td
                        role="cell"
                        className="settlements-period-cell"
                        data-label={t('Settlement period')}
                      >
                        <strong className="settlements-code">{row.code}</strong>
                        <span className="settlements-secondary">
                          {formatSettlementPeriod(row.period)}
                        </span>
                      </td>
                      {balanceColumns.map((column) => {
                        const value = row.totals[column.key]
                        return (
                          <td
                            role="cell"
                            key={column.key}
                            data-label={t(column.label)}
                            className={`settlements-money ${column.strong ? 'settlements-closing' : ''} ${column.debt && settlementAmountTone(value) === 'positive' ? 'negative' : column.signed ? settlementAmountTone(value) : ''}`}
                          >
                            {formatSettlementAmount(value, locale, column.signed, false)}
                          </td>
                        )
                      })}
                      <td role="cell" className="settlements-status-cell" data-label={t('Status')}>
                        <span className={`settlements-status status-${row.status.toLowerCase()}`}>
                          {t(settlementStatuses[row.status] ?? 'Unknown status')}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="settlements-table-footer">
            <div className="settlements-page-summary">
              <span aria-live="polite">
                {loading
                  ? t('Loading…')
                  : error
                    ? t('Unable to load settlements')
                    : t('Showing {start}–{end} of {total} settlement periods', {
                        start: number(start),
                        end: number(end),
                        total: number(total),
                      })}
              </span>
              <label className="settlements-select settlements-page-size">
                <select
                  aria-label={t('Rows per page')}
                  value={filters.limit}
                  onChange={(event) => updateFilters({ limit: Number(event.target.value) })}
                >
                  {[10, 25, 50].map((limit) => (
                    <option key={limit} value={limit}>
                      {t('{count} / page', { count: limit })}
                    </option>
                  ))}
                </select>
                <img src="/settlements/chevron-down.svg" width="21" height="21" alt="" />
              </label>
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
    </main>
  )
}
