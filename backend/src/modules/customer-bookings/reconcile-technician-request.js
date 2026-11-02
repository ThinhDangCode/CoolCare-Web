import { withTransaction } from '../../config/database.js'

// Booking row is always locked before changing its technician request.
async function reconcileLockedBooking(db, booking) {
  if (!['PENDING', 'TECHNICIAN_SELECTED'].includes(booking.status)) return false

  // Once the appointment time arrives, no unaccepted booking may be reused.
  // CANCELLED is an existing booking status; no schema change is required.
  if (booking.scheduled_at && new Date(booking.scheduled_at).getTime() <= Date.now()) {
    await db.query(`
      UPDATE booking_technicians SET status='EXPIRED', responded_at=CURRENT_TIMESTAMP
      WHERE booking_id=$1 AND status='SELECTED'
    `, [booking.id])
    const closed = await db.query(`
      UPDATE bookings SET status='CANCELLED', updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status IN ('PENDING','TECHNICIAN_SELECTED')
        AND scheduled_at<=CURRENT_TIMESTAMP
        AND NOT EXISTS (SELECT 1 FROM booking_technicians
                        WHERE booking_id=$1 AND status='ACCEPTED')
      RETURNING id
    `, [booking.id])
    if (closed.rowCount) {
      await db.query(`
        INSERT INTO booking_status_history (booking_id,status,note)
        VALUES ($1,'CANCELLED','Appointment time passed without an accepted technician; create a new booking.')
      `, [booking.id])
    }
    return Boolean(closed.rowCount)
  }

  if (booking.status !== 'TECHNICIAN_SELECTED') return false
  await db.query(`
    UPDATE booking_technicians SET status='EXPIRED', responded_at=CURRENT_TIMESTAMP
    WHERE booking_id=$1 AND status='SELECTED'
      AND COALESCE(expires_at,requested_at+INTERVAL '10 minutes')<=CURRENT_TIMESTAMP
  `, [booking.id])
  const active = await db.query(`
    SELECT 1 FROM booking_technicians WHERE booking_id=$1
      AND status IN ('SELECTED','ACCEPTED') LIMIT 1
  `, [booking.id])
  if (active.rowCount) return false
  const last = (await db.query(`
    SELECT status FROM booking_technicians WHERE booking_id=$1
    ORDER BY requested_at DESC,id DESC LIMIT 1
  `, [booking.id])).rows[0]
  if (!['DECLINED','EXPIRED'].includes(last?.status)) return false
  const updated = await db.query(`
    UPDATE bookings SET status='PENDING',updated_at=CURRENT_TIMESTAMP
    WHERE id=$1 AND status='TECHNICIAN_SELECTED' RETURNING id
  `, [booking.id])
  if (updated.rowCount) {
    await db.query(`
      INSERT INTO booking_status_history(booking_id,status,note)
      VALUES ($1,'PENDING',$2)
    `, [booking.id, last.status === 'EXPIRED'
      ? 'Technician request expired; customer may select again before the appointment.'
      : 'Technician declined; customer may select again before the appointment.'])
  }
  return Boolean(updated.rowCount)
}

export async function reconcileTechnicianRequest(userId, bookingId) {
  return withTransaction(async (db) => {
    const booking = (await db.query(`
      SELECT b.id,b.status,b.scheduled_at FROM bookings b
      JOIN customer_profiles cp ON cp.id=b.customer_id
      WHERE b.id=$1 AND cp.user_id=$2 FOR UPDATE OF b
    `, [bookingId,userId])).rows[0]
    if (booking) await reconcileLockedBooking(db, booking)
  })
}

// Called by the existing server worker and booking read endpoints.
export async function reconcileExpiredRequests() {
  return withTransaction(async (db) => {
    const result = await db.query(`
      SELECT b.id,b.status,b.scheduled_at FROM bookings b
      WHERE (b.status IN ('PENDING','TECHNICIAN_SELECTED') AND b.scheduled_at<=CURRENT_TIMESTAMP)
         OR (b.status='TECHNICIAN_SELECTED' AND EXISTS (
           SELECT 1 FROM booking_technicians bt WHERE bt.booking_id=b.id
             AND bt.status='SELECTED'
             AND COALESCE(bt.expires_at,bt.requested_at+INTERVAL '10 minutes')<=CURRENT_TIMESTAMP
         ))
      ORDER BY b.id LIMIT 100 FOR UPDATE OF b SKIP LOCKED
    `)
    let completed=0
    for (const booking of result.rows) {
      if (await reconcileLockedBooking(db,booking)) completed++
    }
    return completed
  })
}
