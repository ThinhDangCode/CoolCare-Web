import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { PageHeader, Pagination, TableState } from '../../../shared/components/AdminUi.jsx'
import { listInvoices } from '../api/invoicesApi.js'
import InvoiceDateFilter from '../components/InvoiceDateFilter.jsx'
import useInvoicePdfDownload from '../hooks/useInvoicePdfDownload.js'
import {
  initialInvoiceFilters,
  invoiceApiQuery,
  invoiceStatuses,
  readInvoiceFilters,
  writeInvoiceFilters,
} from '../invoiceFilters.js'
import {
  formatInvoiceAmount,
  formatInvoiceDate,
  invoiceErrorMessage,
  invoiceDetailUrl,
  invoiceServiceLabels,
} from '../invoicePresentation.js'
import './invoices.css'

function InvoiceServices({ invoice }) {
  const { t } = useUiPreferences()
  const labels = invoiceServiceLabels(invoice, t)
  if (labels.length === 1) return <span className="invoices-service-name">{labels[0]}</span>
  return (
    <details className="invoices-services" aria-label={t('Services and additional invoice items')}>
      <summary title={labels.join('\n')}>
        <span className="invoices-service-name">{labels[0]}</span>
        <span
          className="invoices-service-count"
          aria-label={`${t('More invoice items')}: ${labels.length - 1}`}
        >
          +{labels.length - 1}
        </span>
      </summary>
      <ul>
        {labels.map((label, index) => (
          <li key={`${index}:${label}`}>{label}</li>
        ))}
      </ul>
    </details>
  )
}

export default function InvoicesPage() {
  const { token, clearSession } = useAuth()
  const { t, locale } = useUiPreferences()
  const pdfDownload = useInvoicePdfDownload(token, clearSession)
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const filters = readInvoiceFilters(params)
  const latestFiltersRef = useRef(filters)
  const [draftSearch, setDraftSearch] = useState(() => ({
    value: filters.search,
    source: location.key,
  }))
  const search = draftSearch.source === location.key ? draftSearch.value : filters.search
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '' })
  const query = invoiceApiQuery(filters)
  const requestKey = `${query}:${refresh}:${token}`
  const loading = response.key !== requestKey || search.trim() !== filters.search
  const data = !loading && !response.error ? response.data : null
  const error = response.key === requestKey ? t(response.error) : ''
  const items = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const services = response.data?.options.services ?? []
  const selectedServiceExists =
    filters.service === 'ALL' || services.some((service) => service.id === filters.service)
  const number = (value) => value.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')

  useLayoutEffect(() => {
    latestFiltersRef.current = readInvoiceFilters(params)
  }, [params])
  const setFilters = useCallback(
    (update) => {
      const next = typeof update === 'function' ? update(latestFiltersRef.current) : update
      latestFiltersRef.current = next
      setParams(writeInvoiceFilters(next), { replace: true })
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
    listInvoices(query, token, controller.signal)
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
        setResponse((current) => ({
          key: requestKey,
          data: current.data,
          error: invoiceErrorMessage(err),
        }))
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
    setFilters((current) => ({ ...initialInvoiceFilters(), limit: current.limit }))
  }
  const initial = initialInvoiceFilters()
  const hasFilters = Boolean(
    search.trim() ||
    filters.status !== 'ALL' ||
    filters.service !== 'ALL' ||
    filters.from !== initial.from ||
    filters.to !== initial.to
  )
  const start = total ? (filters.page - 1) * filters.limit + 1 : 0
  const end = Math.min(filters.page * filters.limit, total)
  const subtitle = loading
    ? t('Loading invoices…')
    : error
      ? t('Unable to load invoices')
      : `${number(total)} ${t(total === 1 ? 'invoice' : 'invoices')}`

  return (
    <main className="invoices-page">
      <PageHeader title="Invoices" subtitle={subtitle} onRefresh={reload} refreshing={loading} />
      <section className="invoices-content" aria-label={t('Invoice records')}>
        <div className="invoices-toolbar">
          <label className="invoices-search">
            <img src="/invoices/search.svg" width="12" height="12" alt="" />
            <input
              aria-label={t('Search invoices')}
              placeholder={t('Search invoice number, booking, customer…')}
              maxLength={150}
              value={search}
              onChange={(event) =>
                setDraftSearch({ value: event.target.value, source: location.key })
              }
            />
          </label>
          <div className="invoices-toolbar-filters">
            <InvoiceDateFilter filters={filters} onChange={updateFilters} />
            <span className="invoices-select invoices-status-select">
              <img
                src="/invoices/status.svg"
                width="12"
                height="11.25"
                alt=""
                className="invoices-select-icon"
              />
              <select
                aria-label={t('Filter invoice payment status')}
                value={filters.status}
                onChange={(event) => updateFilters({ status: event.target.value })}
              >
                <option value="ALL">{t('All Status')}</option>
                {Object.entries(invoiceStatuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
              <img
                src="/invoices/chevron.svg"
                width="8.75"
                height="5"
                alt=""
                className="invoices-select-chevron"
              />
            </span>
            <span className="invoices-select invoices-service-select">
              <img
                src="/invoices/service.svg"
                width="12"
                height="12"
                alt=""
                className="invoices-select-icon"
              />
              <select
                aria-label={t('Filter invoices by service')}
                value={filters.service}
                onChange={(event) => updateFilters({ service: event.target.value })}
              >
                <option value="ALL">{t('All Services')}</option>
                {!selectedServiceExists && (
                  <option value={filters.service}>{t('Selected service')}</option>
                )}
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
              <img
                src="/invoices/chevron.svg"
                width="8.75"
                height="5"
                alt=""
                className="invoices-select-chevron"
              />
            </span>
          </div>
        </div>
        {hasFilters && (
          <div className="invoices-filter-summary">
            <span>{t('Invoice issue date · Vietnam time (UTC+7)')}</span>
            <button type="button" onClick={reset}>
              {t('Reset filters')}
            </button>
          </div>
        )}
        {(pdfDownload.busy || pdfDownload.error || pdfDownload.notice) && (
          <p
            className={`invoices-pdf-notice${pdfDownload.error ? ' error' : ''}`}
            role={pdfDownload.error ? 'alert' : 'status'}
          >
            {t(
              pdfDownload.busy
                ? 'Downloading invoice PDF…'
                : pdfDownload.error || pdfDownload.notice
            )}
          </p>
        )}
        <div className="invoices-table-card" aria-busy={loading}>
          <div className="invoices-table-scroll">
            <table aria-label={t('Invoice records')}>
              <thead>
                <tr>
                  <th scope="col">{t('INVOICE NUMBER')}</th>
                  <th scope="col">{t('CUSTOMER')}</th>
                  <th scope="col">{t('SERVICES')}</th>
                  <th scope="col">{t('AMOUNT')}</th>
                  <th scope="col">{t('PAYMENT CONDITION')}</th>
                  <th scope="col">{t('ACTIONS')}</th>
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
                  items.map((invoice) => {
                    const downloadingPdf = pdfDownload.busyId === invoice.id
                    return (
                      <tr key={invoice.id}>
                        <td>
                          <strong className="invoices-code">{invoice.invoiceNumber}</strong>
                          <span className="invoices-secondary">{invoice.booking.code || '—'}</span>
                          <time
                            className="invoices-secondary"
                            dateTime={invoice.issuedAt}
                            title={t('Invoice issue date')}
                          >
                            {formatInvoiceDate(invoice.issuedAt)}
                          </time>
                        </td>
                        <td>
                          <strong>{invoice.customer.name || '—'}</strong>
                          {invoice.customer.phone && (
                            <span className="invoices-secondary">{invoice.customer.phone}</span>
                          )}
                        </td>
                        <td>
                          <InvoiceServices invoice={invoice} />
                        </td>
                        <td className="invoices-amount">
                          {formatInvoiceAmount(invoice.amount, locale)}
                        </td>
                        <td>
                          <span
                            className={`invoices-status status-${invoice.paymentStatus.toLowerCase()}`}
                          >
                            {t(invoiceStatuses[invoice.paymentStatus] ?? 'No payment recorded')}
                          </span>
                        </td>
                        <td>
                          <div className="invoices-row-actions">
                            <Link
                              to={invoiceDetailUrl(invoice.id, location.search)}
                              className="invoices-icon-button"
                              title={t('View invoice details')}
                              aria-label={`${t('View invoice details')}: ${invoice.invoiceNumber}`}
                            >
                              <img src="/invoices/eye.svg" width="16" height="16" alt="" />
                            </Link>
                            <button
                              type="button"
                              className="invoices-icon-button"
                              disabled={pdfDownload.busy}
                              aria-busy={downloadingPdf}
                              onClick={() => pdfDownload.download(invoice)}
                              title={t(
                                downloadingPdf ? 'Downloading invoice PDF…' : 'Download invoice PDF'
                              )}
                              aria-label={`${t(downloadingPdf ? 'Downloading invoice PDF…' : 'Download invoice PDF')}: ${invoice.invoiceNumber}`}
                            >
                              {downloadingPdf ? (
                                <i className="figma-spinner" aria-hidden="true" />
                              ) : (
                                <img src="/invoices/download.svg" width="16" height="16" alt="" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
          <div className="invoices-table-footer">
            <div className="invoices-page-summary">
              <span aria-live="polite">
                {loading
                  ? t('Loading…')
                  : error
                    ? t('Unable to load invoices')
                    : t('Showing {start}–{end} of {total} invoices', {
                        start: number(start),
                        end: number(end),
                        total: number(total),
                      })}
              </span>
              <span className="invoices-select invoices-page-size">
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
                <img
                  src="/invoices/chevron.svg"
                  width="8.75"
                  height="5"
                  alt=""
                  className="invoices-select-chevron"
                />
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
    </main>
  )
}
