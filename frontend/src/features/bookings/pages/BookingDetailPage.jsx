import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { adminRequest } from '../../../shared/api/adminApi.js'
import { PageHeader } from '../../../shared/components/AdminUi.jsx'
import { TechnicianAvatar } from '../../technicians/components/TechnicianShared.jsx'
import { BookingStatus } from './BookingShared.jsx'
import { bookingStatusLabels, date, time, money } from './bookingFormat.js'
import '../../../shared/styles/admin.css'
import './bookings.css'

function DetailField({ title, children }) {
  const { t } = useUiPreferences()
  return (
    <div className="booking-detail-field">
      <dt>{t(title)}</dt>
      <dd>{typeof children === 'string' ? t(children) : children || t('Not provided')}</dd>
    </div>
  )
}
export function BookingDetailPage() {
  const { id } = useParams(),
    { token, logout } = useAuth()
  const { t } = useUiPreferences()
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    adminRequest(`/bookings/${id}`, token, { signal: controller.signal })
      .then((result) => {
        setData(result)
        setError('')
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message)
          if (err.status === 401) logout()
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [id, token, logout, refresh])
  const retry = () => {
    setLoading(true)
    setRefresh((n) => n + 1)
  }
  const duration = data
    ? data.units.reduce(
        (total, unit) =>
          total +
          unit.services.reduce((minutes, s) => minutes + Number(s.estimated_duration || 0), 0),
        0
      )
    : 0
  const end =
    data && duration ? new Date(new Date(data.scheduled_at).getTime() + duration * 60000) : null
  return (
    <main className="figma-admin-main booking-page booking-detail-page">
      <PageHeader
        title={data?.booking_code || 'Booking Detail'}
        subtitle="Booking"
        headingAddon={data && <BookingStatus status={data.status} />}
        onRefresh={retry}
        refreshing={loading}
      />
      <section className="booking-content">
        <Link to="/admin/bookings" aria-label={t('Back to bookings')} className="booking-detail-back">
          ← {t('Back to bookings')}
        </Link>
        {loading ? (
          <div className="booking-state" role="status">
            <i className="figma-spinner" /> {t('Loading booking details…')}
          </div>
        ) : error ? (
          <div className="booking-state" role="alert">
            <p>{error}</p>
            <button onClick={retry}>{t('Try again')}</button>
          </div>
        ) : (
          data && (
            <>
              <div className="booking-summary-grid">
                <article>
                  <div>
                    <small>{t('TOTAL AMOUNT')}</small>
                    <strong>{money(data.total_amount)}</strong>
                    <span>
                      {t('Paid')}: {money(data.paid_amount)}
                    </span>
                  </div>
                  <b className="orange">▣</b>
                </article>
                <article>
                  <div>
                    <small>{t('SCHEDULED DATE')}</small>
                    <strong>{date(data.scheduled_at)}</strong>
                  </div>
                  <b className="blue">▦</b>
                </article>
                <article>
                  <div>
                    <small>{t('APPOINTMENT WINDOW')}</small>
                    <strong>
                      {time(data.scheduled_at)}
                      {end && ` – ${time(end)}`}
                    </strong>
                    <span>
                      {duration
                        ? `${t('Estimated')}: ${duration} ${t('mins')}`
                        : t('Duration not provided')}
                    </span>
                  </div>
                  <b className="amber">◷</b>
                </article>
              </div>
              <div className="booking-detail-grid">
                <div className="booking-detail-column">
                  <section className="booking-card">
                    <header>
                      <span className="booking-card-icon orange">▦</span>
                      <div>
                        <h2>{t('Service Details')}</h2>
                        <p>{t('Assigned AC units & services')}</p>
                      </div>
                      {duration > 0 && (
                        <span className="booking-duration">
                          ◷ {duration} {t('mins')}
                        </span>
                      )}
                    </header>
                    {data.units.length ? (
                      data.units.map((unit) => (
                        <article className="booking-service-package" key={unit.id}>
                          <div>
                            <small>
                              {t('AC UNIT')} {unit.unit_number}
                            </small>
                            <span>
                              {[unit.brand, unit.model_name].filter(Boolean).join(' · ') ||
                                t('Model not specified')}
                            </span>
                          </div>
                          {unit.services.map((s, index) => (
                            <div className="booking-unit-service" key={index}>
                              <strong>{s.name}</strong>
                              <span>{money(s.unit_price)}</span>
                              {s.description && <p>{s.description}</p>}
                            </div>
                          ))}
                          {unit.description && <p>{unit.description}</p>}
                          {unit.diagnosis && (
                            <p>
                              <strong>{t('Diagnosis')}:</strong> {unit.diagnosis}
                            </p>
                          )}
                          {unit.service_notes && (
                            <p>
                              <strong>{t('Service notes')}:</strong> {unit.service_notes}
                            </p>
                          )}
                        </article>
                      ))
                    ) : (
                      <p className="booking-muted">{t('No AC units or services recorded.')}</p>
                    )}
                  </section>
                  <section className="booking-card">
                    <header>
                      <span className="booking-card-icon orange">♙</span>
                      <h2>{t('Assigned Technician')}</h2>
                    </header>
                    {data.technicians.length ? (
                      data.technicians.map((technician) => (
                        <Link
                          className="booking-assigned-person"
                          to={`/admin/technicians/${technician.id}`}
                          key={technician.id}
                        >
                          <TechnicianAvatar
                            name={technician.full_name}
                            url={technician.avatar_url}
                          />
                          <div>
                            <strong>{technician.full_name}</strong>
                            <small>
                              {technician.total_reviews
                                ? t('ratingWithReviews', {
                                    rating: Number(technician.rating_average).toFixed(2),
                                    count: technician.total_reviews,
                                  })
                                : t('No reviews yet')}
                            </small>
                          </div>
                          <span className="booking-assignment-status">
                            {t(
                              technician.status === 'SELECTED'
                                ? 'Selected'
                                : technician.status === 'ACCEPTED'
                                  ? 'Assigned'
                                  : 'Completed'
                            )}
                          </span>
                        </Link>
                      ))
                    ) : (
                      <p className="booking-muted">{t('No technician assigned.')}</p>
                    )}
                  </section>
                  <section className="booking-card">
                    <header>
                      <span className="booking-card-icon blue">◷</span>
                      <h2>{t('Booking History')}</h2>
                    </header>
                    {data.history.length ? (
                      <ol className="booking-history">
                        {data.history.map((h) => (
                          <li key={h.id}>
                            <strong>{t(bookingStatusLabels[h.status] || h.status)}</strong>
                            <small>
                              {date(h.created_at)} · {time(h.created_at)}
                              {h.changed_by && ` · ${h.changed_by}`}
                            </small>
                            {h.note && <p>{h.note}</p>}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="booking-muted">{t('No status history recorded.')}</p>
                    )}
                  </section>
                </div>
                <div className="booking-detail-column">
                  <section className="booking-card">
                    <header>
                      <span className="booking-card-icon purple">♙</span>
                      <h2>{t('Customer Information')}</h2>
                    </header>
                    <dl className="booking-customer-fields">
                      <DetailField title="FULL NAME">{data.customer_name}</DetailField>
                      <DetailField title="RECIPIENT">{data.recipient_name}</DetailField>
                      <DetailField title="PHONE NUMBER">{data.recipient_phone}</DetailField>
                      <DetailField title="EMAIL ADDRESS">{data.customer_email}</DetailField>
                      <DetailField title="SERVICE ADDRESS">
                        {[data.service_address, data.ward, data.city].filter(Boolean).join(', ')}
                      </DetailField>
                    </dl>
                  </section>
                  <section className="booking-card">
                    <header>
                      <h2>{t('Booking Summary')}</h2>
                    </header>
                    <dl className="booking-price-breakdown">
                      <DetailField title="SUBTOTAL">{money(data.subtotal)}</DetailField>
                      <DetailField title="DISCOUNT">{money(data.discount_amount)}</DetailField>
                      <DetailField title="TOTAL AMOUNT">{money(data.total_amount)}</DetailField>
                    </dl>
                    {data.description && <p className="booking-description">{data.description}</p>}
                  </section>
                  {data.status === 'CANCELLED' && (
                    <section className="booking-card">
                      <header>
                        <h2>{t('Cancellation Details')}</h2>
                      </header>
                      <>
                        <p className="booking-description">{data.cancellation_reason}</p>
                        <small className="booking-muted">
                          {t('Cancelled')}: {date(data.cancelled_at)} · {time(data.cancelled_at)}
                          {data.cancelled_by && ` · ${data.cancelled_by}`}
                        </small>
                      </>
                    </section>
                  )}
                </div>
              </div>
            </>
          )
        )}
      </section>
    </main>
  )
}
