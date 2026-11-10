// Work time is estimated from the existing ARRIVED event; no extra technician button
// or database migration is necessary. Quotation review time pauses the work clock.
const MINUTE = 60000
const validMinutes = (value) => Math.max(0, Number(value) || 0)

/** Pure calculation so it can be tested without a running PostgreSQL server. */
export function calculateWorkEstimate({ arrivedAt, baseMinutes, quotations = [], now = new Date(), completedAt = null, graceMinutes = 15 }) {
  const arrival = new Date(arrivedAt).getTime()
  if (!Number.isFinite(arrival)) return null
  let deadline = arrival + validMinutes(baseMinutes) * MINUTE
  let additionalMinutes = 0
  let pausedMinutes = 0
  let waitingForQuotation = false
  for (const quote of [...quotations].sort((a, b) => new Date(a.sent_at || 0) - new Date(b.sent_at || 0))) {
    // Only customer-approved SERVICE items change the duration. LABOR items have
    // no catalog service duration and must not generate invented work minutes.
    if (quote.sent_at && ['ACCEPTED', 'REJECTED', 'PENDING'].includes(quote.status)) {
      const started = Math.max(arrival, new Date(quote.sent_at).getTime())
      const ended = quote.responded_at ? new Date(quote.responded_at).getTime() : new Date(now).getTime()
      if (Number.isFinite(started) && Number.isFinite(ended) && ended > started) {
        const minutes = (ended - started) / MINUTE
        pausedMinutes += minutes
        deadline += minutes * MINUTE
      }
    }
    if (quote.status === 'ACCEPTED') {
      const minutes = validMinutes(quote.minutes)
      additionalMinutes += minutes
      const approvedAt = new Date(quote.responded_at || quote.sent_at || arrivedAt).getTime()
      deadline = Math.max(deadline, Number.isFinite(approvedAt) ? approvedAt : deadline) + minutes * MINUTE
    }
    if (quote.status === 'PENDING') waitingForQuotation = true
  }
  const endTime = completedAt ? new Date(completedAt).getTime() : new Date(now).getTime()
  return {
    work_estimated_minutes: validMinutes(baseMinutes) + additionalMinutes,
    work_additional_minutes: additionalMinutes,
    quotation_wait_minutes: Math.round(pausedMinutes),
    work_expected_completion_at: new Date(deadline).toISOString(),
    work_grace_minutes: graceMinutes,
    work_waiting_for_quotation: waitingForQuotation,
    work_late: !waitingForQuotation && Number.isFinite(endTime) && endTime > deadline + graceMinutes * MINUTE,
  }
}

export async function bookingWorkEstimate(db, bookingId, arrivedAt) {
  const [base, quotes, booking] = await Promise.all([
    db.query(`SELECT COALESCE(SUM(GREATEST(COALESCE(s.estimated_duration, 0),0)),0) AS minutes
      FROM booking_units bu JOIN booking_unit_services bus ON bus.booking_unit_id=bu.id
      JOIN services s ON s.id=bus.service_id WHERE bu.booking_id=$1`, [bookingId]),
    db.query(`SELECT q.status, q.sent_at, q.responded_at,
        COALESCE((SELECT SUM(GREATEST(COALESCE(s.estimated_duration,0),0)*qi.quantity)
          FROM quotation_items qi JOIN services s ON s.id=qi.service_id
          WHERE qi.quotation_id=q.id AND qi.item_type='SERVICE'),0) AS minutes
        FROM quotations q WHERE q.booking_id=$1 AND q.quotation_type='ADDITIONAL'
          AND q.status IN ('PENDING','ACCEPTED','REJECTED')
        ORDER BY q.quotation_number`, [bookingId]),
    db.query('SELECT technician_completed_at FROM bookings WHERE id=$1', [bookingId]),
  ])
  return calculateWorkEstimate({
    arrivedAt, baseMinutes: base.rows[0]?.minutes, quotations: quotes.rows,
    completedAt: booking.rows[0]?.technician_completed_at,
  })
}
