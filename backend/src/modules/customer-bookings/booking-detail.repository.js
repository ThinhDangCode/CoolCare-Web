import { pool } from '../../config/database.js'

export class BookingDetailRepository {
  constructor(db = pool) { this.db = db }

  async findOwnedBooking(userId, bookingId, db = this.db, lock = false) {
    const result = await db.query(`
      SELECT b.* FROM bookings b
      JOIN customer_profiles cp ON cp.id = b.customer_id
      WHERE cp.user_id = $1 AND b.id = $2
      ${lock ? 'FOR UPDATE OF b' : ''}
    `, [userId, bookingId])
    return result.rows[0] ?? null
  }

  async findUnits(bookingId) {
    const result = await this.db.query(`
      SELECT bu.id, bu.unit_number, bu.description, bu.diagnosis,
             bu.ac_brand_id,bu.ac_model_id,
             ab.name AS brand_name, am.model_name,
             COALESCE((SELECT json_agg(json_build_object(
               'id', s.id, 'name', s.name, 'unitPrice', bus.unit_price
             ) ORDER BY s.name)
             FROM booking_unit_services bus JOIN services s ON s.id = bus.service_id
             WHERE bus.booking_unit_id = bu.id), '[]'::json) AS services
      FROM booking_units bu
      LEFT JOIN ac_brands ab ON ab.id = bu.ac_brand_id
      LEFT JOIN ac_models am ON am.id = bu.ac_model_id
      WHERE bu.booking_id = $1 ORDER BY bu.unit_number
    `, [bookingId])
    return result.rows
  }

  async findTechnician(bookingId) {
    const result = await this.db.query(`
      SELECT tp.id, u.full_name AS name, u.avatar_url, bt.status AS request_status,
             tp.rating_average AS rating
      FROM booking_technicians bt
      JOIN technician_profiles tp ON tp.id = bt.technician_id
      JOIN users u ON u.id = tp.user_id
      WHERE bt.booking_id = $1 AND bt.status IN ('SELECTED','ACCEPTED','COMPLETED')
      ORDER BY bt.requested_at DESC LIMIT 1
    `, [bookingId])
    return result.rows[0] ?? null
  }

  async findTimeline(bookingId, db = this.db) {
    const result = await db.query(`
      SELECT id, status, note, changed_by_id, created_at
      FROM booking_status_history WHERE booking_id = $1
      ORDER BY created_at ASC, id ASC
    `, [bookingId])
    return result.rows
  }

  async cancelBooking(userId, bookingId, reason, db) {
    const result = await db.query(`
      UPDATE bookings SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by_id = $1, cancellation_reason = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND status IN ('PENDING','TECHNICIAN_SELECTED')
      RETURNING id, status, cancelled_at
    `, [userId, bookingId, reason])
    return result.rows[0] ?? null
  }

  async cancelPendingRequests(bookingId, db) {
    await db.query(`
      UPDATE booking_technicians SET status = 'CANCELLED',
        cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = 'Customer cancelled booking'
      WHERE booking_id = $1 AND status = 'SELECTED'
    `, [bookingId])
  }

  async insertHistory(userId, bookingId, reason, db) {
    await db.query(`
      INSERT INTO booking_status_history (booking_id, status, changed_by_id, note)
      VALUES ($1, 'CANCELLED', $2, $3)
    `, [bookingId, userId, reason])
  }

  async findAcceptedAssignment(bookingId, db) {
    const result = await db.query(`
      SELECT bt.id,bt.technician_id,tp.user_id AS technician_user_id
      FROM booking_technicians bt
      JOIN technician_profiles tp ON tp.id=bt.technician_id
      WHERE bt.booking_id=$1 AND bt.status='ACCEPTED'
      ORDER BY bt.responded_at DESC NULLS LAST
      LIMIT 1
      FOR UPDATE OF bt
    `, [bookingId])
    return result.rows[0] ?? null
  }

  async confirmCompletion(userId, bookingId, technicianUserId, db) {
    const result = await db.query(`
      UPDATE bookings
      SET completion_confirmed_by_id=$2,
          completion_confirmed_at=CURRENT_TIMESTAMP,
          technician_completed_by_id=COALESCE(technician_completed_by_id,$3),
          technician_completed_at=COALESCE(technician_completed_at,CURRENT_TIMESTAMP),
          updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status IN ('ACCEPTED','WAITING_CONFIRMATION')
      RETURNING id,booking_code,status,completed_at,updated_at
    `, [bookingId, userId, technicianUserId])
    return result.rows[0] ?? null
  }

  async insertCompletionHistory(userId, bookingId, db) {
    await db.query(`
      INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
      VALUES($1,'COMPLETED',$2,'Khách hàng đã xác nhận hoàn thành công việc.')
    `, [bookingId, userId])
  }

  async notifyTechnician(technicianUserId, bookingId, bookingCode, db) {
    await db.query(`
      INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
      VALUES($1,'BOOKING','Khách hàng đã xác nhận hoàn thành',$2,'BOOKING',$3)
    `, [technicianUserId, `Booking ${bookingCode} đã được khách hàng xác nhận hoàn thành.`, bookingId])
  }
}
