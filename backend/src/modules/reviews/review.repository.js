import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'

export class ReviewRepository {
  constructor({ transaction = withTransaction } = {}) {
    this.transaction = transaction
  }

  async getCustomerId(client, userId) {
    const customer = (
      await client.query('SELECT id FROM customer_profiles WHERE user_id=$1', [userId])
    ).rows[0]
    if (!customer)
      throw new AppError(403, 'CUSTOMER_PROFILE_REQUIRED', 'Tài khoản chưa có hồ sơ khách hàng.')
    return customer.id
  }

  async listBookings(userId) {
    return this.transaction(async (client) => {
      const customerId = await this.getCustomerId(client, userId)
      const rows = await client.query(
        `SELECT b.id,b.booking_code,b.status,b.scheduled_at,b.service_address,b.total_amount,
                tp.id technician_id,tu.full_name technician_name,
                r.id review_id,r.rating review_rating,r.comment review_comment,r.created_at reviewed_at,
                (r.id IS NOT NULL) reviewed,
                (SELECT string_agg(DISTINCT s.name, ', ' ORDER BY s.name)
                   FROM booking_units bu
                   JOIN booking_unit_services bus ON bus.booking_unit_id=bu.id
                   JOIN services s ON s.id=bus.service_id
                  WHERE bu.booking_id=b.id) service_names
           FROM bookings b
      LEFT JOIN reviews r ON r.booking_id=b.id AND r.customer_id=b.customer_id
      LEFT JOIN LATERAL (
                 SELECT bt.technician_id FROM booking_technicians bt
                  WHERE bt.booking_id=b.id AND bt.status IN ('ACCEPTED','COMPLETED')
                  ORDER BY bt.responded_at DESC NULLS LAST LIMIT 1
                ) assignment ON true
      LEFT JOIN technician_profiles tp ON tp.id=assignment.technician_id
      LEFT JOIN users tu ON tu.id=tp.user_id
          WHERE b.customer_id=$1
          ORDER BY b.created_at DESC,b.id DESC`,
        [customerId]
      )
      return rows.rows
    })
  }

  async create(userId, data) {
    try {
      return await this.transaction(async (client) => {
        const customerId = await this.getCustomerId(client, userId)
        const booking = (
          await client.query(
            `SELECT b.id,b.status,bt.technician_id FROM bookings b
               JOIN LATERAL (
                    SELECT technician_id FROM booking_technicians
                     WHERE booking_id=b.id AND status='COMPLETED'
                     ORDER BY responded_at DESC NULLS LAST LIMIT 1
               ) bt ON true
              WHERE b.id=$1 AND b.customer_id=$2 FOR UPDATE OF b`,
            [data.booking_id, customerId]
          )
        ).rows[0]
        if (!booking)
          throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy lịch dịch vụ của bạn.')
        if (booking.status !== 'COMPLETED')
          throw new AppError(409, 'BOOKING_NOT_COMPLETED', 'Chỉ có thể đánh giá lịch đã hoàn tất.')
        const review = (
          await client.query(
            `INSERT INTO reviews(booking_id,customer_id,technician_id,rating,comment)
             VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [booking.id, customerId, booking.technician_id, data.rating, data.comment]
          )
        ).rows[0]
        await client.query(
          `UPDATE technician_profiles tp
              SET rating_average=summary.average,total_reviews=summary.total,updated_at=CURRENT_TIMESTAMP
             FROM (SELECT round(avg(rating),2) average,count(*)::int total
                     FROM reviews WHERE technician_id=$1 AND status='PUBLISHED') summary
            WHERE tp.id=$1`,
          [booking.technician_id]
        )
        return review
      })
    } catch (error) {
      if (error.code === '23505')
        throw new AppError(409, 'REVIEW_ALREADY_EXISTS', 'Bạn đã đánh giá lịch dịch vụ này.')
      throw error
    }
  }

  async update(userId, reviewId, data) {
    return this.transaction(async (client) => {
      const customerId = await this.getCustomerId(client, userId)
      const review = (
        await client.query(
          `SELECT r.id,r.technician_id,b.status
             FROM reviews r JOIN bookings b ON b.id=r.booking_id
            WHERE r.id=$1 AND r.customer_id=$2
            FOR UPDATE OF b,r`,
          [reviewId, customerId]
        )
      ).rows[0]
      if (!review)
        throw new AppError(404, 'REVIEW_NOT_FOUND', 'Không tìm thấy đánh giá của bạn.')
      if (review.status !== 'COMPLETED')
        throw new AppError(409, 'BOOKING_NOT_COMPLETED', 'Chỉ có thể sửa đánh giá của lịch đã hoàn tất.')

      const updated = (
        await client.query(
          `UPDATE reviews SET rating=$3,comment=$4,updated_at=CURRENT_TIMESTAMP
            WHERE id=$1 AND customer_id=$2 RETURNING *`,
          [reviewId, customerId, data.rating, data.comment]
        )
      ).rows[0]
      await this.refreshTechnicianRating(client, review.technician_id)
      return updated
    })
  }

  async remove(userId, reviewId) {
    return this.transaction(async (client) => {
      const customerId = await this.getCustomerId(client, userId)
      const review = (
        await client.query(
          `SELECT r.id,r.technician_id,b.status
             FROM reviews r JOIN bookings b ON b.id=r.booking_id
            WHERE r.id=$1 AND r.customer_id=$2
            FOR UPDATE OF b,r`,
          [reviewId, customerId]
        )
      ).rows[0]
      if (!review)
        throw new AppError(404, 'REVIEW_NOT_FOUND', 'Không tìm thấy đánh giá của bạn.')
      if (review.status !== 'COMPLETED')
        throw new AppError(409, 'BOOKING_NOT_COMPLETED', 'Chỉ có thể xóa đánh giá của lịch đã hoàn tất.')

      await client.query('DELETE FROM reviews WHERE id=$1 AND customer_id=$2', [reviewId, customerId])
      await this.refreshTechnicianRating(client, review.technician_id)
      return { id: reviewId, deleted: true }
    })
  }

  refreshTechnicianRating(client, technicianId) {
    return client.query(
      `UPDATE technician_profiles tp
          SET rating_average=summary.average,total_reviews=summary.total,updated_at=CURRENT_TIMESTAMP
         FROM (SELECT round(avg(rating),2) average,count(*)::int total
                 FROM reviews WHERE technician_id=$1 AND status='PUBLISHED') summary
        WHERE tp.id=$1`,
      [technicianId]
    )
  }
}
