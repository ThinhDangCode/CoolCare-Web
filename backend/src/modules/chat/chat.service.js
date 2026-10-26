import { pool } from '../../config/database.js'
import { AppError } from '../../utils.js'

/**
 * Booking-scoped chat. Profile IDs are stored on chat_rooms; sender_id is users.id.
 * A room can only be accessed by the customer or the technician assigned to that booking.
 */
export class ChatService {
  constructor({ db = pool, ioProvider = () => null } = {}) {
    this.db = db
    this.ioProvider = ioProvider
  }

  async getOrCreateRoom(bookingId, userId, role) {
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      const booking = await client.query(
        `SELECT b.id AS booking_id, b.customer_id,
                cp.user_id AS customer_user_id,
                bt.technician_id,
                tp.user_id AS technician_user_id
         FROM bookings b
         JOIN customer_profiles cp ON cp.id = b.customer_id
         LEFT JOIN LATERAL (
           SELECT technician_id FROM booking_technicians
           WHERE booking_id = b.id AND status = 2
           ORDER BY responded_at DESC NULLS LAST, requested_at DESC
           LIMIT 1
         ) bt ON TRUE
         LEFT JOIN technician_profiles tp ON tp.id = bt.technician_id
         WHERE b.id = $1
         FOR UPDATE OF b`,
        [bookingId]
      )
      const b = booking.rows[0]
      if (!b) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy booking.')
      // Technicians sign in through the CUSTOMER role in this app (the technician portal
      // is mounted behind requireRole('CUSTOMER')), so membership is decided by user id
      // against the booking's customer/technician profiles, never by the token role.
      const isCustomer = b.customer_user_id === userId
      const isTechnician = !!b.technician_user_id && b.technician_user_id === userId
      if (!isCustomer && !isTechnician) {
        throw new AppError(403, 'CHAT_FORBIDDEN', 'Bạn không có quyền truy cập cuộc trò chuyện này.')
      }
      if (!b.technician_id || !b.technician_user_id) {
        throw new AppError(409, 'TECHNICIAN_NOT_ASSIGNED', 'Booking chưa có kỹ thuật viên nhận việc.')
      }

      // The booking row is locked above (FOR UPDATE), so select-then-insert is race-free
      // and does not depend on a unique index existing on chat_rooms.booking_id.
      let room = await client.query('SELECT id, booking_id FROM chat_rooms WHERE booking_id=$1 LIMIT 1', [bookingId])
      if (!room.rows[0]) {
        room = await client.query(
          `INSERT INTO chat_rooms (booking_id, customer_id, technician_id)
           VALUES ($1, $2, $3)
           RETURNING id, booking_id`,
          [bookingId, b.customer_id, b.technician_id]
        )
      }
      await client.query('COMMIT')
      return room.rows[0]
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async assertRoomAccess(roomId, userId, role) {
    const { rows } = await this.db.query(
      `SELECT cr.id, cr.booking_id,
              cp.user_id AS customer_user_id, tp.user_id AS technician_user_id
       FROM chat_rooms cr
       JOIN bookings b ON b.id=cr.booking_id
       JOIN customer_profiles cp ON cp.id=cr.customer_id
       LEFT JOIN technician_profiles tp ON tp.id=cr.technician_id
       WHERE cr.id=$1 AND (cp.user_id=$2 OR tp.user_id=$2)`,
      [roomId, userId]
    )
    if (!rows[0]) throw new AppError(403, 'CHAT_FORBIDDEN', 'Bạn không có quyền truy cập cuộc trò chuyện này.')
    return rows[0]
  }

  /** Conversations of the signed-in user (as customer and/or technician), newest first. */
  async listRooms(userId) {
    const { rows } = await this.db.query(
      `SELECT cr.id, cr.booking_id, b.booking_code, b.scheduled_at,
              (SELECT string_agg(DISTINCT sv.name, ', ' ORDER BY sv.name)
               FROM booking_units bu
               JOIN booking_unit_services bus ON bus.booking_unit_id = bu.id
               JOIN services sv ON sv.id = bus.service_id
               WHERE bu.booking_id = b.id) AS service_names,
              cu.full_name AS customer_name, tu.full_name AS technician_name,
              cp.user_id AS customer_user_id, tp.user_id AS technician_user_id,
              lm.id AS last_message_id, lm.sender_id AS last_sender_id,
              lm.content AS last_content, lm.created_at AS last_created_at
       FROM chat_rooms cr
       JOIN bookings b ON b.id=cr.booking_id
       JOIN customer_profiles cp ON cp.id=cr.customer_id
       JOIN users cu ON cu.id=cp.user_id
       LEFT JOIN technician_profiles tp ON tp.id=cr.technician_id
       LEFT JOIN users tu ON tu.id=tp.user_id
       LEFT JOIN LATERAL (
         SELECT id, sender_id, content, created_at FROM chat_messages
         WHERE room_id=cr.id ORDER BY created_at DESC LIMIT 1
       ) lm ON TRUE
       WHERE cp.user_id=$1 OR tp.user_id=$1
       ORDER BY lm.created_at DESC NULLS LAST
       LIMIT 100`,
      [userId]
    )
    return rows.map(r => {
      const iAmCustomer = r.customer_user_id === userId
      return {
        id: r.id,
        booking_id: r.booking_id,
        booking_code: r.booking_code,
        scheduled_at: r.scheduled_at,
        service_names: r.service_names ?? '',
        other_name: (iAmCustomer ? r.technician_name : r.customer_name) ?? '',
        last_message: r.last_message_id ? {
          id: r.last_message_id, sender_id: r.last_sender_id,
          content: r.last_content, created_at: r.last_created_at,
        } : null,
      }
    })
  }

  async listMessages(roomId, userId, role, limit = 50, before = null) {
    await this.assertRoomAccess(roomId, userId, role)
    const { rows } = await this.db.query(
      `SELECT m.id, m.room_id, m.sender_id, m.message_type, m.content, m.created_at,
              u.full_name AS sender_name
       FROM chat_messages m
       LEFT JOIN users u ON u.id=m.sender_id
       WHERE m.room_id=$1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
       ORDER BY m.created_at DESC
       LIMIT $3`,
      [roomId, before, Math.min(Math.max(Number(limit) || 50, 1), 100)]
    )
    return rows.reverse()
  }

  async sendMessage(roomId, userId, role, content) {
    const room = await this.assertRoomAccess(roomId, userId, role)
    const message = String(content ?? '').trim()
    if (!message || message.length > 4000) {
      throw new AppError(400, 'INVALID_MESSAGE', 'Tin nhắn phải có từ 1 đến 4000 ký tự.')
    }
    const { rows } = await this.db.query(
      `INSERT INTO chat_messages (room_id, sender_id, message_type, content)
       VALUES ($1, $2, 0, $3)
       RETURNING id, room_id, sender_id, message_type, content, created_at`,
      [roomId, userId, message]
    )
    const saved = rows[0]
    const sender = await this.db.query('SELECT full_name FROM users WHERE id=$1', [userId])
    saved.sender_name = sender.rows[0]?.full_name ?? null
    const io = this.ioProvider()
    if (io) {
      io.to(`chat:${roomId}`).emit('chat:message', saved)
      // Per-user ping so the other party's inbox/badge updates even when the room is closed.
      const recipient = room.customer_user_id === userId ? room.technician_user_id : room.customer_user_id
      if (recipient) {
        io.to(`user:${recipient}`).emit('chat:notify', { roomId, bookingId: room.booking_id, message: saved })
      }
    }
    return saved
  }
}
