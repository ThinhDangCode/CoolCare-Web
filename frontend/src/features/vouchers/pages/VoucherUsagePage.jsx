import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import {
  CalendarIcon,
  ClockIcon,
  PageHeader,
  Pagination,
  SearchIcon,
  SlidersIcon,
  TableState,
  TicketIcon,
  UserIcon,
} from '../../../shared/components/AdminUi.jsx'
import '../../../shared/styles/admin.css'

const money = (value) => `–${new Intl.NumberFormat('en-US').format(Number(value))} ₫`
const usedDate = (value) =>
  value ? new Date(value).toLocaleString('en-GB', { hour12: false }).replace(',', '') : '—'
const dateValue = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const today = new Date()
const initialRange = {
  from: dateValue(new Date(today.getFullYear(), today.getMonth(), 1)),
  to: dateValue(today),
}

export function VoucherUsagePage() {
  const { token, logout } = useAuth()
  const { locale, t } = useUiPreferences()
  const [params] = useSearchParams()
  const linkedVoucherCode = params.get('voucher_code') ?? ''
  const [voucherSearch, setVoucherSearch] = useState(linkedVoucherCode)
  const scopedVoucherId =
    voucherSearch.trim() === linkedVoucherCode.trim() ? (params.get('voucher_id') ?? '') : ''
  const [customerSearch, setCustomerSearch] = useState('')
  const [keywords, setKeywords] = useState({ voucher: '', customer: '' })
  const [dateRange, setDateRange] = useState(initialRange)
  const [draftRange, setDraftRange] = useState(initialRange)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const id = setTimeout(() => {
      setKeywords({ voucher: voucherSearch.trim(), customer: customerSearch.trim() })
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [voucherSearch, customerSearch])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ status, period: 'ALL_TIME', page, limit })
    if (dateRange.from) query.set('from_date', dateRange.from)
    if (dateRange.to) query.set('to_date', dateRange.to)
    if (keywords.voucher) query.set('voucher_search', keywords.voucher)
    if (keywords.customer) query.set('customer_search', keywords.customer)
    if (scopedVoucherId) query.set('voucher_id', scopedVoucherId)
    adminRequest(`/voucher-usages?${query}`, token, { signal: controller.signal })
      .then((result) => {
        setData(result)
        setError('')
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message)
          if (err.status === 401) logout()
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [token, keywords, status, dateRange, page, limit, scopedVoucherId, refresh, logout])

  const reload = () => {
    setLoading(true)
    setRefresh((value) => value + 1)
  }
  const rangeLabel =
    dateRange.from && dateRange.to
      ? dateRange.from === initialRange.from && dateRange.to === initialRange.to
        ? `${t('This Month')} (${today.toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US', { month: 'short', year: 'numeric' })})`
        : `${new Date(`${dateRange.from}T00:00:00`).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-GB')} – ${new Date(`${dateRange.to}T00:00:00`).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-GB')}`
      : t('All Time')

  return (
    <main className="figma-admin-main usage-page">
      <PageHeader
        title="Voucher Usage History"
        subtitle={`${data.total.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')} ${t('redemptions')}`}
        refreshing={loading}
        onRefresh={reload}
      />
      <section className="usage-content">
        <div className="usage-filters">
          <label>
            <SearchIcon />
            <input
              aria-label="Search voucher code"
              placeholder={t('Search voucher code (e.g. SUMMER20)')}
              value={voucherSearch}
              onChange={(event) => {
                setLoading(true)
                setVoucherSearch(event.target.value)
              }}
            />
          </label>
          <label>
            <UserIcon />
            <input
              aria-label="Search customer"
              placeholder={t('Customer name, phone')}
              value={customerSearch}
              onChange={(event) => {
                setLoading(true)
                setCustomerSearch(event.target.value)
              }}
            />
          </label>
          <div className="usage-date-filter">
            <button
              type="button"
              className={dateRange.from || dateRange.to ? 'active' : ''}
              aria-expanded={calendarOpen}
              onClick={() => {
                setDraftRange(dateRange)
                setCalendarOpen((value) => !value)
              }}
            >
              <CalendarIcon /> {rangeLabel}
            </button>
            {calendarOpen && (
              <div className="usage-calendar" role="dialog" aria-label="Select usage date range">
                <label>
                  <span>{t('From date')}</span>
                  <input
                    type="date"
                    value={draftRange.from}
                    max={draftRange.to || undefined}
                    onChange={(event) => setDraftRange({ ...draftRange, from: event.target.value })}
                  />
                </label>
                <label>
                  <span>{t('To date')}</span>
                  <input
                    type="date"
                    value={draftRange.to}
                    min={draftRange.from || undefined}
                    onChange={(event) => setDraftRange({ ...draftRange, to: event.target.value })}
                  />
                </label>
                <footer>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftRange({ from: '', to: '' })
                      setDateRange({ from: '', to: '' })
                      setPage(1)
                      setLoading(true)
                      setCalendarOpen(false)
                    }}
                  >
                    {t('All Time')}
                  </button>
                  <button
                    type="button"
                    className="apply"
                    disabled={Boolean(
                      draftRange.from && draftRange.to && draftRange.from > draftRange.to
                    )}
                    onClick={() => {
                      setDateRange(draftRange)
                      setPage(1)
                      setLoading(true)
                      setCalendarOpen(false)
                    }}
                  >
                    {t('Apply')}
                  </button>
                </footer>
              </div>
            )}
          </div>
          <label className="usage-type-filter">
            <select
              aria-label="Filter usage type"
              value={status}
              onChange={(event) => {
                setLoading(true)
                setPage(1)
                setStatus(event.target.value)
              }}
            >
              <option value="ALL">{t('All Types')}</option>
              <option value="USED">{t('Used')}</option>
              <option value="RESERVED">{t('Reserved')}</option>
              <option value="RELEASED">{t('Released')}</option>
            </select>
            <SlidersIcon />
          </label>
        </div>
        <div className="usage-table">
          <table>
            <thead>
              <tr>
                <th>{t('VOUCHER CODE')}</th>
                <th>{t('CUSTOMER NAME')}</th>
                <th>{t('BOOKING ID')}</th>
                <th>{t('DISCOUNT AMOUNT')}</th>
                <th>{t('USED DATE')}</th>
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
                      <span className="usage-cell-icon">
                        <TicketIcon />
                        <strong>{row.voucher_code}</strong>
                      </span>
                    </td>
                    <td>{row.customer_name}</td>
                    <td>#{row.booking_code}</td>
                    <td>
                      <strong>{money(row.discount_amount)}</strong>
                    </td>
                    <td>
                      <span className="usage-cell-icon">
                        <ClockIcon />
                        {usedDate(row.used_at ?? row.reserved_at ?? row.released_at)}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <Pagination
            page={page}
            total={data.total}
            limit={limit}
            loading={loading}
            pageSizeOptions={[5, 10, 15, 20, 25]}
            onLimit={(value) => {
              setLoading(true)
              setPage(1)
              setLimit(value)
            }}
            onPage={(value) => {
              setLoading(true)
              setPage(value)
            }}
          />
        </div>
      </section>
    </main>
  )
}
