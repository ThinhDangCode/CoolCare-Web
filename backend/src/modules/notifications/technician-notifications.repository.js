import { CustomerNotificationsRepository } from './customer-notifications.repository.js'

// Notifications are keyed to an authenticated user ID for both roles. The
// technician router supplies the role guard; repository queries remain scoped
// to that user's ID for every read and update.
export class TechnicianNotificationsRepository extends CustomerNotificationsRepository {
  async list(userId, options) {
    // Backfill reviews created before review notifications were introduced.
    // NOT EXISTS also makes repeated refreshes idempotent.
    await this.query(
      `INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id,created_at)
       SELECT tp.user_id,
              'BOOKING',
              'Bạn nhận được đánh giá mới',
              'Bạn nhận được đánh giá ' || r.rating || '/5 sao cho booking ' || b.booking_code ||
                CASE WHEN NULLIF(BTRIM(r.comment),'') IS NULL
                     THEN '.' ELSE ': ' || r.comment END,
              'BOOKING',
              r.booking_id::text,
              r.created_at
         FROM reviews r
         JOIN bookings b ON b.id=r.booking_id
         JOIN technician_profiles tp ON tp.id=r.technician_id
        WHERE tp.user_id=$1
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.user_id=tp.user_id
               AND n.type='BOOKING'
               AND n.title='Bạn nhận được đánh giá mới'
               AND n.reference_type='BOOKING'
               AND n.reference_id=r.booking_id::text
          )`,
      [userId]
    )
    return super.list(userId, options)
  }
}
