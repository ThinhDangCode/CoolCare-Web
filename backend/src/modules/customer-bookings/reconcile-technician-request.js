import { withTransaction } from '../../config/database.js'

// Reconcile a customer's outstanding request using existing tables only.
// This is idempotent and locks the booking before changing request state.
export async function reconcileTechnicianRequest(userId, bookingId) {
  return withTransaction(async (db) => {
    const booking = (await db.query(`
      SELECT b.id, b.status FROM bookings b
      JOIN customer_profiles cp ON cp.id=b.customer_id
      WHERE b.id=$1 AND cp.user_id=$2 FOR UPDATE OF b
    `, [bookingId, userId])).rows[0]
    if (!booking || booking.status !== 'TECHNICIAN_SELECTED') return

    // Mark a timed-out request expired only if it is still SELECTED.
    await db.query(`
      UPDATE booking_technicians SET status='EXPIRED', responded_at=CURRENT_TIMESTAMP
      WHERE booking_id=$1 AND status='SELECTED'
        AND COALESCE(expires_at,requested_at+INTERVAL '10 minutes')<=CURRENT_TIMESTAMP
    `, [bookingId])
    const live = await db.query(`
      SELECT 1 FROM booking_technicians
      WHERE booking_id=$1 AND status IN ('SELECTED','ACCEPTED') LIMIT 1
    `, [bookingId])
    if (live.rowCount) return
    const last = (await db.query(`
      SELECT status FROM booking_technicians WHERE booking_id=$1
      ORDER BY requested_at DESC, id DESC LIMIT 1
    `, [bookingId])).rows[0]
    if (!['DECLINED', 'EXPIRED'].includes(last?.status)) return
    const updated = await db.query(`
      UPDATE bookings SET status='PENDING', updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status='TECHNICIAN_SELECTED' RETURNING id
    `, [bookingId])
    if (updated.rowCount) {
      await db.query(`
        INSERT INTO booking_status_history (booking_id,status,note)
        VALUES ($1,'PENDING',$2)
      `, [bookingId, last.status === 'EXPIRED'
        ? 'Technician request expired; customer can select again'
        : 'Technician declined; customer can select again'])
    }
  })
}

// Process a bounded batch without depending on an open mobile application.
// Lock the booking first, expire only SELECTED requests, and preserve history.
export async function reconcileExpiredRequests() {
  return withTransaction(async (db) => {
    const result = await db.query(`
      SELECT b.id
      FROM bookings b
      WHERE b.status='TECHNICIAN_SELECTED'
        AND EXISTS (
          SELECT 1 FROM booking_technicians bt WHERE bt.booking_id=b.id
            AND bt.status='SELECTED'
            AND COALESCE(bt.expires_at,bt.requested_at+INTERVAL '10 minutes')<=CURRENT_TIMESTAMP
        )
      ORDER BY b.id
      LIMIT 100
      FOR UPDATE OF b SKIP LOCKED
    `)
    let completed = 0
    for (const booking of result.rows) {
      const expired = await db.query(`
        UPDATE booking_technicians SET status='EXPIRED',responded_at=CURRENT_TIMESTAMP
        WHERE booking_id=$1 AND status='SELECTED'
          AND COALESCE(expires_at,requested_at+INTERVAL '10 minutes')<=CURRENT_TIMESTAMP
        RETURNING id
      `, [booking.id])
      if (!expired.rowCount) continue
      const ready = await db.query(`
        UPDATE bookings SET status='PENDING',updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND status='TECHNICIAN_SELECTED'
          AND NOT EXISTS (SELECT 1 FROM booking_technicians
                          WHERE booking_id=$1 AND status IN ('SELECTED','ACCEPTED'))
        RETURNING id
      `, [booking.id])
      if (ready.rowCount) {
        completed++
        await db.query(`
          INSERT INTO booking_status_history(booking_id,status,note)
          VALUES($1,'PENDING','Technician request expired; customer can choose another technician.')
        `, [booking.id])
      }
    }
    return completed
  })
}
