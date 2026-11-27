import { withTransaction } from '../../config/database.js'
import { validateUuid } from '../../utils.js'

// Caller holds the booking row lock. Database wall clock is used so waiting
// for a lock cannot extend an appointment or request deadline.
export async function reconcileLockedBooking(db, booking) {
  if (!['PENDING', 'TECHNICIAN_SELECTED'].includes(booking.status)) return false

  const closed = await db.query(`
    UPDATE bookings SET status='CANCELLED', cancelled_at=clock_timestamp(),
      cancelled_by_id=NULL, cancellation_reason='Đã hết giờ hẹn mà chưa có kỹ thuật viên nhận đơn.',
      updated_at=clock_timestamp()
    WHERE id=$1 AND status IN ('PENDING','TECHNICIAN_SELECTED')
      AND scheduled_at<=clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM booking_technicians bt
                      WHERE bt.booking_id=$1 AND bt.status='ACCEPTED')
    RETURNING id,booking_code
  `, [booking.id])
  if (closed.rowCount) {
    await expireSelectedRequests(db, booking.id, true)
    await db.query(`INSERT INTO booking_status_history (booking_id,status,note)
      VALUES ($1,'CANCELLED','Appointment time passed without an accepted technician; create a new booking.')`, [booking.id])
    await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
      SELECT cp.user_id,0,'Đơn đã hết giờ hẹn',$2,'BOOKING',b.id::text
      FROM bookings b JOIN customer_profiles cp ON cp.id=b.customer_id WHERE b.id=$1`,
      [booking.id, `Booking ${closed.rows[0].booking_code}: đã hết giờ hẹn mà chưa có thợ nhận. Vui lòng đặt lịch mới.`])
    return true
  }
  if (booking.status !== 'TECHNICIAN_SELECTED') return false

  await expireSelectedRequests(db, booking.id, false)
  const active = await db.query(`SELECT 1 FROM booking_technicians WHERE booking_id=$1
    AND status IN ('SELECTED','ACCEPTED') LIMIT 1`, [booking.id])
  if (active.rowCount) return false
  const last = (await db.query(`SELECT status FROM booking_technicians WHERE booking_id=$1
    ORDER BY requested_at DESC,id DESC LIMIT 1`, [booking.id])).rows[0]
  if (!['DECLINED','EXPIRED','CANCELLED'].includes(last?.status)) return false
  const updated = await db.query(`UPDATE bookings SET status='PENDING',updated_at=clock_timestamp()
    WHERE id=$1 AND status='TECHNICIAN_SELECTED' AND scheduled_at>clock_timestamp() RETURNING id`, [booking.id])
  if (updated.rowCount) {
    await db.query(`INSERT INTO booking_status_history(booking_id,status,note)
      VALUES ($1,'PENDING',$2)`, [booking.id, last.status === 'EXPIRED'
      ? 'Technician request expired; customer may select again before the appointment.'
      : 'Technician request closed; customer may select again before the appointment.'])
    await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
      SELECT cp.user_id,0,$2,$3,'BOOKING',b.id::text
      FROM bookings b JOIN customer_profiles cp ON cp.id=b.customer_id WHERE b.id=$1`,
      [booking.id, last.status === 'EXPIRED' ? 'Yêu cầu kỹ thuật viên đã hết hạn' : 'Yêu cầu kỹ thuật viên đã kết thúc',
        last.status === 'EXPIRED'
          ? 'Kỹ thuật viên chưa phản hồi trong thời hạn. Bạn có thể chọn thợ khác trước giờ hẹn.'
          : 'Bạn có thể chọn kỹ thuật viên khác trước giờ hẹn.'])
  }
  return Boolean(updated.rowCount)
}

// Notify only the technicians whose SELECTED rows were actually changed.
async function expireSelectedRequests(db, bookingId, appointmentExpired) {
  const expired = await db.query(`UPDATE booking_technicians SET status='EXPIRED', responded_at=clock_timestamp()
    WHERE booking_id=$1 AND status='SELECTED'
      AND ($2::boolean OR COALESCE(expires_at,requested_at+INTERVAL '10 minutes')<=clock_timestamp())
    RETURNING technician_id`, [bookingId, appointmentExpired])
  for (const row of expired.rows ?? []) {
    await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
      SELECT tp.user_id,0,'Yêu cầu công việc đã hết hạn',$2,'BOOKING',$1::text
      FROM technician_profiles tp WHERE tp.id=$3`,
      [bookingId, appointmentExpired ? 'Đã đến giờ hẹn, yêu cầu không còn khả dụng.'
        : 'Đã hết thời hạn phản hồi. Yêu cầu không còn khả dụng.', row.technician_id])
  }
}

export async function reconcileTechnicianRequest(userId, bookingId) {
  validateUuid(userId)
  validateUuid(bookingId)
  return withTransaction(async (db) => {
    const booking = (await db.query(`SELECT b.id,b.status,b.scheduled_at FROM bookings b
      JOIN customer_profiles cp ON cp.id=b.customer_id
      WHERE b.id=$1 AND cp.user_id=$2 FOR UPDATE OF b`, [bookingId,userId])).rows[0]
    if (booking) await reconcileLockedBooking(db, booking)
  })
}

export async function reconcileExpiredRequests(transaction = withTransaction) {
  return transaction(async (db) => {
    const result = await db.query(`SELECT b.id,b.status,b.scheduled_at FROM bookings b
      WHERE (b.status IN ('PENDING','TECHNICIAN_SELECTED') AND b.scheduled_at<=clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM booking_technicians bt WHERE bt.booking_id=b.id AND bt.status='ACCEPTED'))
         OR (b.status='TECHNICIAN_SELECTED' AND EXISTS (
           SELECT 1 FROM booking_technicians bt WHERE bt.booking_id=b.id
             AND bt.status='SELECTED'
             AND COALESCE(bt.expires_at,bt.requested_at+INTERVAL '10 minutes')<=clock_timestamp()
         )) OR (b.status='TECHNICIAN_SELECTED'
           AND NOT EXISTS (SELECT 1 FROM booking_technicians bt WHERE bt.booking_id=b.id AND bt.status IN ('SELECTED','ACCEPTED'))
           AND EXISTS (SELECT 1 FROM booking_technicians bt WHERE bt.booking_id=b.id AND bt.status IN ('DECLINED','EXPIRED','CANCELLED')))
      ORDER BY b.scheduled_at,b.id LIMIT 100 FOR UPDATE OF b SKIP LOCKED`)
    let completed=0
    for (const booking of result.rows) {
      if (await reconcileLockedBooking(db,booking)) completed++
    }
    return completed
  })
}
