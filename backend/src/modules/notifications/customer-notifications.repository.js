import { pool } from '../../config/database.js'
import { AppError } from '../../utils.js'

export class CustomerNotificationsRepository {
  constructor({ query = (...args) => pool.query(...args) } = {}) {
    this.query = query
  }

  async list(userId, { unreadOnly, limit, offset }) {
    const [items, count] = await Promise.all([
      this.query(
        `SELECT n.id,n.type,n.title,n.message,n.reference_type,n.reference_id,
                n.is_read,n.created_at,b.booking_code
           FROM notifications n
           LEFT JOIN bookings b
             ON b.id::text=n.reference_id
            AND n.reference_type IN ('BOOKING','QUOTATION','CHAT','MESSAGE','PAYMENT','RECONCILIATION','VERIFICATION','COMPLAINT')
          WHERE n.user_id=$1 AND ($2::boolean=false OR n.is_read=false)
          ORDER BY n.created_at DESC,n.id DESC
          LIMIT $3 OFFSET $4`,
        [userId, unreadOnly, limit, offset],
      ),
      this.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE NOT is_read)::int AS unread_count
           FROM notifications
          WHERE user_id=$1`,
        [userId],
      ),
    ])
    const counts = count.rows[0]
    return {
      items: items.rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        message: row.message,
        referenceType: row.reference_type,
        referenceId: row.reference_id,
        bookingCode: row.booking_code ?? null,
        isRead: row.is_read,
        createdAt: row.created_at,
      })),
      pagination: { total: counts.total, unreadCount: counts.unread_count },
    }
  }

  async markRead(userId, notificationId) {
    const result = await this.query(
      `UPDATE notifications SET is_read=true,read_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND user_id=$2
        RETURNING id,type,title,message,reference_type,reference_id,is_read,created_at`,
      [notificationId, userId],
    )
    const row = result.rows[0]
    if (!row) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo.')
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      isRead: row.is_read,
      createdAt: row.created_at,
    }
  }

  async markAllRead(userId) {
    const result = await this.query(
      `UPDATE notifications SET is_read=true,read_at=CURRENT_TIMESTAMP
        WHERE user_id=$1 AND is_read=false`,
      [userId],
    )
    return { updatedCount: result.rowCount }
  }
}
