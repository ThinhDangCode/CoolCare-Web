import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { PageHeader } from '../../../shared/components/AdminUi.jsx'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { paymentMethods } from '../../payments/paymentPresentation.js'
import { getInvoice } from '../api/invoicesApi.js'
import { invoiceStatuses } from '../invoiceFilters.js'
import { groupInvoiceItems } from '../invoiceItems.js'
import useInvoicePdfDownload from '../hooks/useInvoicePdfDownload.js'
import {
  formatInvoiceAmount,
  formatInvoiceQuantity,
  formatInvoiceTime,
  invoiceDetailErrorMessage,
  invoiceDetailUrl,
  invoiceListUrl,
  validInvoiceId,
} from '../invoicePresentation.js'
import './invoiceDetail.css'

function DetailIcon({ name }) {
  return <img src={`/payments/detail/${name}.svg`} alt="" aria-hidden="true" />
}

function CardHeader({ icon, children, tone = '' }) {
  return (
    <header className="invoice-detail-card-header">
      <span className={`invoice-detail-icon ${tone}`}>
        <DetailIcon name={icon} />
      </span>
      <h2>{children}</h2>
    </header>
  )
}

function Fact({ label, children }) {
  return (
    <div className="invoice-detail-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const { token, clearSession } = useAuth()
  const { t, locale } = useUiPreferences()
  const pdfDownload = useInvoicePdfDownload(token, clearSession, id)
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '', status: null })
  const validId = validInvoiceId(id)
  const requestKey = `${id}:${refresh}:${token}`
  const loading = validId && response.key !== requestKey
  const invoice = validId && response.key === requestKey && !response.error ? response.data : null
  const error = !validId
    ? 'The invoice ID is invalid.'
    : response.key === requestKey
      ? response.error
      : ''
  const errorTitle =
    !validId || [400, 422].includes(response.status)
      ? 'Invalid invoice ID'
      : response.status === 404
        ? 'Invoice not found'
        : 'Unable to load invoice'
  const reload = () => setRefresh((value) => value + 1)
  const backUrl = invoiceListUrl(location.search)
  const returnUrl = invoiceDetailUrl(id, location.search)
  const display = (value) => value || t('Not available')
  const money = (value) => formatInvoiceAmount(value, locale)
  const items = groupInvoiceItems(invoice?.items ?? [])
  const payments = invoice?.payments ?? []
  const booking = invoice?.booking
  const customer = invoice?.customer
  const technician = invoice?.technician

  useEffect(() => {
    if (!validId) return undefined
    const controller = new AbortController()
    getInvoice(id, token, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResponse({ key: requestKey, data, error: '', status: null })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({
          key: requestKey,
          data: null,
          error: invoiceDetailErrorMessage(err),
          status: err.status,
        })
        if (err.status === 401) clearSession()
      })
    return () => controller.abort()
  }, [id, token, requestKey, validId, clearSession])

  return (
    <main className="invoice-detail-page">
      <PageHeader
        title="Invoice Details"
        subtitle={loading ? 'Loading invoice details…' : invoice?.invoiceNumber || 'Invoice'}
        onRefresh={reload}
        refreshing={loading}
      />
      <section className="invoice-detail-content" aria-busy={loading}>
        <Link className="invoice-detail-back" to={backUrl}>
          <DetailIcon name="back" />
          {t('Back to Invoices List')}
        </Link>
        {loading ? (
          <div className="invoice-detail-state" role="status">
            <i className="figma-spinner" />
            <span>{t('Loading invoice details…')}</span>
          </div>
        ) : error ? (
          <div className="invoice-detail-state error" role="alert">
            <h2>{t(errorTitle)}</h2>
            <p>{t(error)}</p>
            {validId && ![400, 401, 403, 404, 422].includes(response.status) && (
              <button type="button" onClick={reload}>
                {t('Try again')}
              </button>
            )}
          </div>
        ) : invoice ? (
          <>
            <header className="invoice-detail-summary">
              <div>
                <span className="invoice-detail-eyebrow">{t('Invoice information')}</span>
                <div className="invoice-detail-summary-title">
                  <strong>{display(invoice.invoiceNumber)}</strong>
                  <span
                    className={`invoice-detail-status status-${invoice.paymentStatus?.toLowerCase()}`}
                  >
                    {t(invoiceStatuses[invoice.paymentStatus] ?? 'No payment recorded')}
                  </span>
                </div>
                <p>
                  {t('Invoice issue date (UTC+7)')}:{' '}
                  <time dateTime={invoice.issuedAt}>{formatInvoiceTime(invoice.issuedAt)}</time>
                </p>
              </div>
              <div className="invoice-detail-summary-total">
                <span>{t('Total invoice amount')}</span>
                <strong>{money(invoice.totals?.totalAmount)}</strong>
              </div>
            </header>

            <div className="invoice-detail-grid">
              <div className="invoice-detail-main-column">
                <section className="invoice-detail-card">
                  <CardHeader icon="payment-card" tone="orange">
                    {t('Invoice items')}
                  </CardHeader>
                  <div className="invoice-detail-table-scroll">
                    <table className="invoice-detail-items" aria-label={t('Invoice items')}>
                      <thead>
                        <tr>
                          <th scope="col">{t('ITEM DESCRIPTION')}</th>
                          <th scope="col">{t('QUANTITY')}</th>
                          <th scope="col">{t('UNIT PRICE')}</th>
                          <th scope="col">{t('LINE DISCOUNT')}</th>
                          <th scope="col">{t('LINE TOTAL')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.length ? (
                          items.map((item) => (
                            <tr key={item.id}>
                              <td>
                                <strong>
                                  {item.description || item.service?.name || t('Not available')}
                                </strong>
                                {item.service?.name &&
                                  item.description &&
                                  item.description !== item.service.name && (
                                    <small>{item.service.name}</small>
                                  )}
                              </td>
                              <td>{formatInvoiceQuantity(item.quantity, locale)}</td>
                              <td>{money(item.unitPrice)}</td>
                              <td>{money(item.discountAmount)}</td>
                              <td>{money(item.totalPrice)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="invoice-detail-empty">
                              {t('No invoice items recorded.')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <dl className="invoice-detail-totals">
                    <div>
                      <dt>{t('Parts and materials')}</dt>
                      <dd>{money(invoice.totals?.partsAmount)}</dd>
                    </div>
                    <div>
                      <dt>{t('Subtotal including parts')}</dt>
                      <dd>{money(invoice.totals?.subtotal)}</dd>
                    </div>
                    <div>
                      <dt>{t('Invoice discount')}</dt>
                      <dd>{money(invoice.totals?.discountAmount)}</dd>
                    </div>
                    <div className="invoice-detail-grand-total">
                      <dt>{t('Invoice total')}</dt>
                      <dd>{money(invoice.totals?.totalAmount)}</dd>
                    </div>
                  </dl>
                </section>

                <section className="invoice-detail-card">
                  <CardHeader icon="paid" tone="orange">
                    {t('Payment Information')}
                  </CardHeader>
                  {payments.length ? (
                    <div className="invoice-detail-payments">
                      {payments.map((payment) => (
                        <article key={payment.id} className="invoice-detail-payment">
                          {validInvoiceId(payment.id) ? (
                            <Link
                              to={`/admin/payments/${payment.id}`}
                              state={{ invoiceReturnUrl: returnUrl }}
                              className="invoice-detail-code-link"
                              title={t('View payment details')}
                            >
                              {display(payment.code)}
                            </Link>
                          ) : (
                            <strong>{display(payment.code)}</strong>
                          )}
                          <dl>
                            <Fact label={t('Payment method')}>
                              {t(paymentMethods[payment.method] ?? 'Not available')}
                            </Fact>
                            <Fact label={t('Payment amount')}>{money(payment.amount)}</Fact>
                            <Fact label={t('Paid at (UTC+7)')}>
                              {formatInvoiceTime(payment.paidAt)}
                            </Fact>
                          </dl>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="invoice-detail-empty">{t('No matching payment recorded.')}</p>
                  )}
                </section>
              </div>

              <aside className="invoice-detail-side-column" aria-label={t('Related information')}>
                <section className="invoice-detail-card">
                  <CardHeader icon="customer-card">{t('Customer')}</CardHeader>
                  <strong className="invoice-detail-person-name">{display(customer?.name)}</strong>
                  <dl className="invoice-detail-facts">
                    <Fact label={t('PHONE NUMBER')}>{display(customer?.phone)}</Fact>
                  </dl>
                </section>

                <section className="invoice-detail-card">
                  <CardHeader icon="booking-card" tone="blue">
                    {t('Booking Information')}
                  </CardHeader>
                  <dl className="invoice-detail-facts">
                    <Fact label={t('BOOKING CODE')}>
                      {validInvoiceId(booking?.id) ? (
                        <Link
                          to={`/admin/bookings/${booking.id}`}
                          state={{ invoiceReturnUrl: returnUrl }}
                          className="invoice-detail-code-link"
                          title={t('View booking details')}
                        >
                          {display(booking.code)}
                        </Link>
                      ) : (
                        display(booking?.code)
                      )}
                    </Fact>
                    <Fact label={t('Service address')}>{display(booking?.address)}</Fact>
                    <Fact label={t('Scheduled start (UTC+7)')}>
                      {formatInvoiceTime(booking?.scheduledStart)}
                    </Fact>
                    {booking?.scheduledEnd && (
                      <Fact label={t('Scheduled end (UTC+7)')}>
                        {formatInvoiceTime(booking.scheduledEnd)}
                      </Fact>
                    )}
                    {(booking?.recipientName || booking?.recipientPhone) && (
                      <>
                        <Fact label={t('Recipient name')}>{display(booking.recipientName)}</Fact>
                        <Fact label={t('Recipient phone')}>{display(booking.recipientPhone)}</Fact>
                      </>
                    )}
                  </dl>
                </section>

                <section className="invoice-detail-card">
                  <CardHeader icon="technician-card" tone="orange">
                    {t('Technician')}
                  </CardHeader>
                  {technician ? (
                    <>
                      <strong className="invoice-detail-person-name">
                        {display(technician.name)}
                      </strong>
                      <dl className="invoice-detail-facts">
                        <Fact label={t('PHONE NUMBER')}>{display(technician.phone)}</Fact>
                      </dl>
                    </>
                  ) : (
                    <p className="invoice-detail-empty">
                      {t('Technician is not recorded for this invoice.')}
                    </p>
                  )}
                </section>
              </aside>
            </div>

            <footer className="invoice-detail-footer">
              <Link className="invoice-detail-back" to={backUrl}>
                <DetailIcon name="back" />
                {t('Back to Invoices List')}
              </Link>
              <div>
                <button
                  type="button"
                  disabled={pdfDownload.busy}
                  aria-busy={pdfDownload.busy}
                  className="invoice-detail-pdf"
                  onClick={() => pdfDownload.download(invoice)}
                >
                  {pdfDownload.busy ? (
                    <i className="figma-spinner" aria-hidden="true" />
                  ) : (
                    <img src="/invoices/download.svg" width="16" height="16" alt="" />
                  )}
                  {t(pdfDownload.busy ? 'Downloading invoice PDF…' : 'Download invoice PDF')}
                </button>
                {(pdfDownload.error || pdfDownload.notice) && (
                  <p
                    className={`invoice-detail-pdf-notice${pdfDownload.error ? ' error' : ''}`}
                    role={pdfDownload.error ? 'alert' : 'status'}
                  >
                    {t(pdfDownload.error || pdfDownload.notice)}
                  </p>
                )}
              </div>
            </footer>
          </>
        ) : null}
      </section>
    </main>
  )
}
