import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { PageHeader } from '../../../shared/components/AdminUi.jsx'
import '../../../shared/styles/admin.css'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { getPayment } from '../api/paymentsApi.js'
import { readPaymentFilters, writePaymentFilters } from '../paymentListFilters.js'
import {
  formatPaymentAmount,
  formatPaymentTime,
  humanizeStatus,
  paymentLedgerEvidence,
  paymentMethods,
  paymentStatuses,
  personInitials,
  safePdfUrl,
} from '../paymentPresentation.js'
import './payments.css'
import './paymentDetail.css'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 })
const quantity = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })
const formatQuantity = (value) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? quantity.format(Number(value))
    : null

function DetailIcon({ name }) {
  return <img src={`/payments/detail/${name}.svg`} alt="" aria-hidden="true" />
}

function CardHeader({ icon, children, tone = '' }) {
  return (
    <header className="payment-detail-card-header">
      <span className={`payment-detail-icon ${tone}`}>
        <DetailIcon name={icon} />
      </span>
      <h2>{children}</h2>
    </header>
  )
}

function PersonAvatar({ name, url }) {
  const [failedUrl, setFailedUrl] = useState('')
  return (
    <span className="payment-detail-person-avatar">
      {url && url !== failedUrl ? (
        <img src={url} alt="" onError={() => setFailedUrl(url)} />
      ) : (
        personInitials(name)
      )}
    </span>
  )
}

function Fact({ label, value, icon, children }) {
  return (
    <div className="payment-detail-fact">
      <div>
        <dt>{label}</dt>
        <dd>
          {value}
          {children}
        </dd>
      </div>
      {icon && <DetailIcon name={icon} />}
    </div>
  )
}

export default function PaymentDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const { token, clearSession } = useAuth()
  const { t } = useUiPreferences()
  const displayText = (value) => value || t('Not available')
  const displayQuantity = (value) => formatQuantity(value) ?? t('Not available')
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '', status: null })
  const validId = uuid.test(id ?? '')
  const requestKey = `${id}:${refresh}:${token}`
  const loading = validId && response.key !== requestKey
  const payment = validId && response.key === requestKey && !response.error ? response.data : null
  const error = !validId
      ? t('The payment ID is invalid.')
    : response.key === requestKey
      ? response.error
      : ''
  const errorTitle =
    !validId || [400, 422].includes(response.status)
      ? t('Invalid payment ID')
      : response.status === 404
        ? t('Payment not found')
        : t('Unable to load payment')
  const listQuery = writePaymentFilters(
    readPaymentFilters(new URLSearchParams(location.search))
  ).toString()
  const backUrl = `/admin/payments${listQuery ? `?${listQuery}` : ''}`

  useEffect(() => {
    if (!validId) return undefined
    const controller = new AbortController()
    getPayment(id, token, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResponse({ key: requestKey, data, error: '', status: null })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({ key: requestKey, data: null, error: err.message, status: err.status })
        if (err.status === 401) clearSession()
      })
    return () => controller.abort()
  }, [id, validId, token, requestKey, clearSession])

  const booking = payment?.booking
  const customer = payment?.customer
  const technician = payment?.technician
  const evidence = payment ? paymentLedgerEvidence(payment) : null
  const pdfUrl = safePdfUrl(payment?.invoice?.pdfUrl)
  const statusLabel =
    payment?.status === 'SUCCESS' && payment.paidAt && payment.settledAt
      ? 'Paid & Settled'
      : (paymentStatuses[payment?.status] ?? humanizeStatus(payment?.status))
  const serviceScope =
    booking?.items
      ?.filter((item) => item.itemType === 'SERVICE')
      .map((item) => `${item.description} × ${displayQuantity(item.quantity)}`)
      .join(' · ') ||
    booking?.description ||
    t('Not available')
  const zones =
    technician?.serviceZones
      ?.map((zone) => [zone.ward, zone.district, zone.city].filter(Boolean).join(', '))
      .filter(Boolean)
      .join(' · ') || t('Not available')
  const pricingMismatch = booking?.pricingMatchesPayment === false
  const breakdownMismatch =
    booking?.quotationTotalsMatchBooking === false ||
    booking?.itemBreakdownMatchesQuotation === false
  const serviceAddress = [booking?.serviceAddress, booking?.ward, booking?.district, booking?.city]
    .filter(Boolean)
    .join(', ')

  return (
    <main className="payments-page payment-detail-page">
      <PageHeader
        title="Payment Detail"
        subtitle="Payments"
        onRefresh={() => setRefresh((current) => current + 1)}
        refreshing={loading || !validId}
      />
      <section className="payment-detail-content" aria-busy={loading}>
        <div className="payment-detail-heading">
          <Link className="payment-detail-back" to={backUrl}>
            <DetailIcon name="back" /> {t('Back to Payments List')}
          </Link>
          <div>
            {payment && (
              <>
                <code>{payment.paymentCode}</code>
                <span className={`payments-status status-${payment.status.toLowerCase()}`}>
                  <i />
                  {t(statusLabel)}
                </span>
              </>
            )}
          </div>
        </div>
        {loading && (
          <div className="payment-detail-state" role="status">
            <i className="figma-spinner" />
            {t('Loading payment…')}
          </div>
        )}
        {!loading && error && (
          <div className="payment-detail-state error" role="alert">
            <h2>{errorTitle}</h2>
            <p>{error}</p>
            {validId && response.status !== 404 && ![400, 422].includes(response.status) && (
              <button type="button" onClick={() => setRefresh((current) => current + 1)}>
                {t('Try again')}
              </button>
            )}
          </div>
        )}
        {payment && (
          <div className="payment-detail-grid">
            <div className="payment-detail-main-column">
              <section className="payment-detail-card payment-detail-financial-card">
                <CardHeader icon="payment-card" tone="orange">
                  {t('Payment Information')}
                </CardHeader>
                <div className="payment-detail-amount-banner">
                  <span>
                    {payment.status === 'SUCCESS' && payment.paidAt
                      ? t('TOTAL PAID AMOUNT')
                      : t('PAYMENT AMOUNT')}
                  </span>
                  <strong>{formatPaymentAmount(payment.amount)}</strong>
                </div>
                <div className="payment-detail-specifications">
                  <h3>{t('TRANSACTION SPECIFICATIONS')}</h3>
                  <dl className="payment-detail-metadata">
                    <Fact
                      label={t('Payment method')}
                      value={paymentMethods[payment.methodCode] ?? displayText(payment.methodName)}
                      icon="method"
                    />
                    <Fact label={t('Wallet posting')} value={evidence.label} icon="settlement">
                      <small>{evidence.explanation}</small>
                    </Fact>
                    <Fact
                      label={t('Created at (UTC+7)')}
                      value={formatPaymentTime(payment.createdAt)}
                      icon="created"
                    />
                    <Fact
                      label={t('Paid at (UTC+7)')}
                      value={formatPaymentTime(payment.paidAt)}
                      icon="paid"
                    >
                      <small>
                        {t('Settled at')}: {formatPaymentTime(payment.settledAt)}
                      </small>
                    </Fact>
                  </dl>
                  <dl className="payment-detail-reference">
                    <div>
                      <dt>{t('Transaction reference')}</dt>
                      <dd>{displayText(payment.transactionReference)}</dd>
                    </div>
                    {payment.kind === 'CASH' && (
                      <div>
                        <dt>{t('Cash received at (UTC+7)')}</dt>
                        <dd>{formatPaymentTime(payment.cashReceivedAt)}</dd>
                      </div>
                    )}
                    {payment.closureReference && (
                      <div>
                        <dt>{t('Closure reference')}</dt>
                        <dd>{payment.closureReference}</dd>
                      </div>
                    )}
                    {payment.closureVerifiedAt && (
                      <div>
                        <dt>{t('Closure verified at (UTC+7)')}</dt>
                        <dd>{formatPaymentTime(payment.closureVerifiedAt)}</dd>
                      </div>
                    )}
                  </dl>
                </div>
                <div className="payment-detail-breakdown">
                  <h3>{t('BOOKING PRICE BREAKDOWN')}</h3>
                  <p className="payment-detail-source-note">
                    {t('Current accepted quotations and booking totals.')}
                  </p>
                  {pricingMismatch && (
                    <p className="payment-detail-data-note">
                      {t('Booking pricing differs from this payment attempt. The payment amount above remains {amount}.', {
                        amount: formatPaymentAmount(payment.amount),
                      })}
                    </p>
                  )}
                  {breakdownMismatch && (
                    <p className="payment-detail-data-note">
                      {t(
                        'The accepted item breakdown and booking totals do not fully match. Amounts below are shown as recorded.'
                      )}
                    </p>
                  )}
                  <dl className="payment-detail-line-items">
                    {booking?.items?.length ? (
                      booking.items.map((item) => (
                        <div key={item.id}>
                          <dt>
                            <span>{displayText(item.description)}</span>
                            <small>
                              {displayQuantity(item.quantity)} {item.unit || ''} ×{' '}
                              {formatPaymentAmount(item.unitPrice)}
                            </small>
                          </dt>
                          <dd>{formatPaymentAmount(item.totalPrice)}</dd>
                        </div>
                      ))
                    ) : (
                      <div>
                        <dt>{t('Service and labor items')}</dt>
                        <dd>{t('Not available')}</dd>
                      </div>
                    )}
                    <div>
                      <dt>{t('Parts')}</dt>
                      <dd>{formatPaymentAmount(booking?.totals?.partsAmount)}</dd>
                    </div>
                    <div className="payment-detail-subtotal">
                      <dt>{t('Booking subtotal')}</dt>
                      <dd>{formatPaymentAmount(booking?.totals?.subtotal)}</dd>
                    </div>
                    <div>
                      <dt>{t('Discount')}</dt>
                      <dd>{formatPaymentAmount(booking?.totals?.discountAmount)}</dd>
                    </div>
                    <div className="payment-detail-total">
                      <dt>{t('Booking total')}</dt>
                      <dd>{formatPaymentAmount(booking?.totals?.totalAmount)}</dd>
                    </div>
                  </dl>
                </div>
              </section>
              <section className="payment-detail-card">
                <CardHeader icon="booking-card" tone="blue">
                  {t('Linked Booking')}
                </CardHeader>
                <div className="payment-detail-booking-identity">
                  <div>
                    <span>{t('BOOKING CODE')}</span>
                    <strong>{displayText(booking?.bookingCode)}</strong>
                  </div>
                  <span
                    className={`payment-detail-booking-status booking-${booking?.status?.toLowerCase()}`}
                  >
                    {t(humanizeStatus(booking?.status))}
                  </span>
                </div>
                <div className="payment-detail-booking-scope">
                  <span>{t('SERVICE SCOPE')}</span>
                  <p>{serviceScope}</p>
                </div>
                <div className="payment-detail-booking-schedule">
                  <span className="payment-detail-small-icon">
                    <DetailIcon name="schedule" />
                  </span>
                  <div>
                    <span>{t('SCHEDULED AT (UTC+7)')}</span>
                    <strong>{formatPaymentTime(booking?.scheduledAt)}</strong>
                  </div>
                </div>
                <div
                  className={`payment-detail-confirmation ${booking?.customerConfirmedCompletion ? 'confirmed' : ''}`}
                >
                  <DetailIcon name="confirmation" />
                  <div>
                    <strong>
                      {booking?.customerConfirmedCompletion
                        ? t('Customer confirmed completion')
                        : t('Customer completion not confirmed')}
                    </strong>
                    <span>{formatPaymentTime(booking?.completionConfirmedAt)}</span>
                  </div>
                </div>
              </section>
            </div>
            <aside
              className="payment-detail-side-column"
              aria-label={t('Customer and technician')}
            >
              <section className="payment-detail-card">
                <CardHeader icon="customer-card">{t('Customer Details')}</CardHeader>
                <div className="payment-detail-person">
                  <PersonAvatar name={customer?.name} url={customer?.avatarUrl} />
                  <strong>{displayText(customer?.name)}</strong>
                </div>
                <dl className="payment-detail-person-facts">
                  <Fact label={t('PHONE NUMBER')} value={displayText(customer?.phone)} />
                  <Fact label={t('SERVICE ADDRESS')} value={displayText(serviceAddress)} />
                  <Fact
                    label={t('Completed bookings')}
                    value={
                      customer?.completedBookingCount === null ||
                      customer?.completedBookingCount === undefined
                        ? t('Not available')
                        : `${customer.completedBookingCount} ${t(
                            customer.completedBookingCount === 1 ? 'booking' : 'bookings'
                          )}`
                    }
                  />
                </dl>
              </section>
              <section className="payment-detail-card">
                <CardHeader icon="technician-card" tone="orange">
                  {t('Payment Technician')}
                </CardHeader>
                {technician ? (
                  <>
                    <div className="payment-detail-person">
                      <PersonAvatar name={technician.name} url={technician.avatarUrl} />
                      <div>
                        <strong>{displayText(technician.name)}</strong>
                        <span className="payment-detail-rating">
                          <DetailIcon name="rating" />
                          {technician.totalReviews === 0
                            ? t('No ratings yet')
                            : technician.ratingAverage === null
                              ? t('Not available')
                              : Number(technician.ratingAverage).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <dl className="payment-detail-person-facts">
                      <Fact label={t('SERVICE ZONES')} value={zones} />
                      <Fact
                        label={t('TECHNICIAN EARNING')}
                        value={formatPaymentAmount(payment.technicianEarning)}
                      >
                        <small>
                          {payment.status !== 'SUCCESS'
                            ? t('Stored calculation; this payment has not succeeded.')
                            : payment.kind === 'CASH'
                              ? t('Payment entitlement; cash is collected separately.')
                              : t('Payment entitlement before any withdrawal.')}
                        </small>
                      </Fact>
                      <Fact
                        label={t('COMMISSION RATE')}
                        value={
                          payment.commissionRate === null || payment.commissionRate === undefined
                            ? t('Not available')
                            : percent.format(Number(payment.commissionRate))
                        }
                      />
                    </dl>
                    <div
                      className={`payment-detail-wallet-evidence ${evidence.recorded ? `recorded movement-${evidence.direction}` : ''}`}
                    >
                      <strong>{evidence.label}</strong>
                      <span>{evidence.explanation}</span>
                      {evidence.record && (
                        <small>
                          {t('Wallet movement')}: {formatPaymentAmount(evidence.record.amount)}
                        </small>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="payment-detail-unassigned">
                    {t('Technician is not recorded for this payment.')}
                  </p>
                )}
                <button
                  type="button"
                  className="payment-detail-profile-button"
                  disabled
                  title={t('Technician profile is not available')}
                >
                  <span>{t('View Technician Profile')}</span>
                  <DetailIcon name="profile-arrow" />
                </button>
                <small className="payment-detail-action-note">
                  {t('Technician profile is not available.')}
                </small>
              </section>
            </aside>
          </div>
        )}
        <footer className="payment-detail-footer">
          <Link className="payment-detail-back" to={backUrl}>
            <DetailIcon name="back" />
            {t('Back to Payments List')}
          </Link>
          <div>
            {pdfUrl ? (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="payment-detail-pdf"
              >
                <DetailIcon name="pdf" />
                {t('Open Invoice PDF')}
              </a>
            ) : (
              <button
                type="button"
                className="payment-detail-pdf"
                disabled
                title={t('Invoice PDF is not available')}
              >
                <DetailIcon name="pdf" />
                {t('Invoice PDF')}
              </button>
            )}
            <button
              type="button"
              className="payment-detail-booking-button"
              disabled
              title={t('Booking detail is not available')}
            >
              <DetailIcon name="booking-view" />
              {t('View Booking Detail')}
            </button>
          </div>
          <small className="payment-detail-action-note">
            {!pdfUrl && `${t('Invoice PDF is not available.')} `}
            {t('Booking detail is not available.')}
          </small>
        </footer>
      </section>
    </main>
  )
}
