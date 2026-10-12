import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import { adminRequest } from '../../management/api/managementApi.js'
import { BellIcon } from '../../management/components/ManagementShared.jsx'
import { TechnicianAvatar } from '../../technicians/components/TechnicianShared.jsx'
import { BookingStatus } from './BookingShared.jsx'
import { bookingStatusLabels, date, time, money } from './bookingFormat.js'
import '../../management/pages/management.css'
import './bookings.css'

function DetailField({ title, children }) {
  return (
    <div className="booking-detail-field">
      <dt>{title}</dt>
      <dd>{children || 'Not provided'}</dd>
    </div>
  )
}
export function BookingDetailPage() {
  const { id } = useParams(),
    { token, user, logout } = useAuth()
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
      <header className="booking-detail-topbar">
        <div>
          <Link to="/admin/bookings" aria-label="Back to bookings">
            ←
          </Link>
          <span>BOOKING</span>
          <strong>{data?.booking_code || 'Details'}</strong>
          {data && <BookingStatus status={data.status} />}
        </div>
        <div>
          <button onClick={retry} disabled={loading} aria-label="Refresh booking">
            ↻
          </button>
          <BellIcon />
          <span className="booking-admin">
            <strong>{user?.fullName || 'Admin'}</strong>
            <small>Admin</small>
          </span>
          <TechnicianAvatar name={user?.fullName} url={user?.avatarUrl} />
        </div>
      </header>
      <section className="booking-content">
        {loading ? (
          <div className="booking-state" role="status">
            <i className="figma-spinner" /> Loading booking details…
          </div>
        ) : error ? (
          <div className="booking-state" role="alert">
            <p>{error}</p>
            <button onClick={retry}>Try again</button>
          </div>
        ) : (
          data && (
            <>
              <div className="booking-summary-grid">
                <article>
                  <div>
                    <small>TOTAL AMOUNT</small>
                    <strong>{money(data.total_amount)}</strong>
                    <span>Paid: {money(data.paid_amount)}</span>
                  </div>
                  <b className="orange">▣</b>
                </article>
                <article>
                  <div>
                    <small>SCHEDULED DATE</small>
                    <strong>{date(data.scheduled_at)}</strong>
                  </div>
                  <b className="blue">▦</b>
                </article>
                <article>
                  <div>
                    <small>APPOINTMENT WINDOW</small>
                    <strong>
                      {time(data.scheduled_at)}
                      {end && ` – ${time(end)}`}
                    </strong>
                    <span>
                      {duration ? `Estimated: ${duration} mins` : 'Duration not provided'}
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
                        <h2>Service Details</h2>
                        <p>Assigned AC units & services</p>
                      </div>
                      {duration > 0 && <span className="booking-duration">◷ {duration} mins</span>}
                    </header>
                    {data.units.length ? (
                      data.units.map((unit) => (
                        <article className="booking-service-package" key={unit.id}>
                          <div>
                            <small>AC UNIT {unit.unit_number}</small>
                            <span>
                              {[unit.brand, unit.model_name].filter(Boolean).join(' · ') ||
                                'Model not specified'}
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
                              <strong>Diagnosis:</strong> {unit.diagnosis}
                            </p>
                          )}
                          {unit.service_notes && (
                            <p>
                              <strong>Service notes:</strong> {unit.service_notes}
                            </p>
                          )}
                        </article>
                      ))
                    ) : (
                      <p className="booking-muted">No AC units or services recorded.</p>
                    )}
                  </section>
                  <section className="booking-card">
                    <header>
                      <span className="booking-card-icon orange">♙</span>
                      <h2>Assigned Technician</h2>
                    </header>
                    {data.technicians.length ? (
                      data.technicians.map((t) => (
                        <Link
                          className="booking-assigned-person"
                          to={`/admin/technicians/${t.id}`}
                          key={t.id}
                        >
                          <TechnicianAvatar name={t.full_name} url={t.avatar_url} />
                          <div>
                            <strong>{t.full_name}</strong>
                            <small>
                              {t.total_reviews
                                ? `★ ${Number(t.rating_average).toFixed(2)} (${t.total_reviews} reviews)`
                                : 'No reviews yet'}
                            </small>
                          </div>
                          <span className="booking-assignment-status">
                            {t.status === 'SELECTED'
                              ? 'Selected'
                              : t.status === 'ACCEPTED'
                                ? 'Assigned'
                                : 'Completed'}
                          </span>
                        </Link>
                      ))
                    ) : (
                      <p className="booking-muted">No technician assigned.</p>
                    )}
                  </section>
                  <section className="booking-card">
                    <header>
                      <span className="booking-card-icon blue">◷</span>
                      <h2>Booking History</h2>
                    </header>
                    {data.history.length ? (
                      <ol className="booking-history">
                        {data.history.map((h) => (
                          <li key={h.id}>
                            <strong>{bookingStatusLabels[h.status] || h.status}</strong>
                            <small>
                              {date(h.created_at)} · {time(h.created_at)}
                              {h.changed_by && ` · ${h.changed_by}`}
                            </small>
                            {h.note && <p>{h.note}</p>}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="booking-muted">No status history recorded.</p>
                    )}
                  </section>
                </div>
                <div className="booking-detail-column">
                  <section className="booking-card">
                    <header>
                      <span className="booking-card-icon purple">♙</span>
                      <h2>Customer Information</h2>
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
                      <h2>Booking Summary</h2>
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
                        <h2>Cancellation Details</h2>
                      </header>
                      <>
                        <p className="booking-description">{data.cancellation_reason}</p>
                        <small className="booking-muted">
                          Cancelled: {date(data.cancelled_at)} · {time(data.cancelled_at)}
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
