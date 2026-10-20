
import { pool } from '../../config/database.js'

export class MyBookingsRepository {
  constructor({ db = pool } = {}) {
    this.db = db
  }

  /**
   * Find the customer profile associated with
   * the authenticated user.
   */
  async findCustomerByUserId(
    userId,
    db = this.db
  ) {
    const result = await db.query(
      `
        SELECT
          cp.id,
          cp.user_id
        FROM customer_profiles cp
        JOIN users u
          ON u.id = cp.user_id
        WHERE cp.user_id = $1
          AND u.status = 'ACTIVE'
        LIMIT 1
      `,
      [userId]
    )

    return result.rows[0] ?? null
  }

  /**
   * Count bookings belonging to a customer.
   *
   * Optional status filtering uses the actual
   * booking statuses defined in the database.
   */
  async countCustomerBookings(
    customerId,
    status = null,
    db = this.db
  ) {
    const result = await db.query(
      `
        SELECT COUNT(*)::integer AS total
        FROM bookings b
        WHERE b.customer_id = $1
          AND (
            $2::varchar IS NULL
            OR b.status = $2
          )
      `,
      [customerId, status]
    )

    return result.rows[0]?.total ?? 0
  }

  /**
   * #41 - View My Bookings
   *
   * Only returns bookings owned by the
   * authenticated customer.
   *
   * Results are sorted by creation time,
   * newest first.
   */
  async findCustomerBookings(
    customerId,
    {
      status = null,
      limit = 20,
      offset = 0,
    } = {},
    db = this.db
  ) {
    const result = await db.query(
      `
        SELECT
          b.id,
          b.booking_code,
          b.status,
          b.description,
          b.scheduled_at,

          b.service_address,
          b.ward,
          b.city,

          b.recipient_name,
          b.recipient_phone,

          b.subtotal,
          b.discount_amount,
          b.total_amount,

          b.created_at,
          b.updated_at,
          b.completed_at,
          b.cancelled_at,

          (
            SELECT COUNT(*)::integer
            FROM booking_units bu
            WHERE bu.booking_id = b.id
          ) AS unit_count,

          (
            SELECT COUNT(*)::integer
            FROM booking_unit_services bus
            JOIN booking_units bu
              ON bu.id = bus.booking_unit_id
            WHERE bu.booking_id = b.id
          ) AS service_count,

          selected.technician_id,
          selected.technician_name,
          selected.technician_avatar_url,
          selected.technician_rating,
          selected.request_status,
          EXISTS (
            SELECT 1 FROM reviews r
            WHERE r.booking_id = b.id AND r.customer_id = b.customer_id
          ) AS reviewed,
          (
            SELECT string_agg(DISTINCT s.name, ', ' ORDER BY s.name)
            FROM booking_units bu
            JOIN booking_unit_services bus ON bus.booking_unit_id = bu.id
            JOIN services s ON s.id = bus.service_id
            WHERE bu.booking_id = b.id
          ) AS service_names

        FROM bookings b

        LEFT JOIN LATERAL (
          SELECT
            tp.id AS technician_id,
            u.full_name AS technician_name,
            u.avatar_url AS technician_avatar_url,
            tp.rating_average AS technician_rating,
            bt.status AS request_status

          FROM booking_technicians bt

          JOIN technician_profiles tp
            ON tp.id = bt.technician_id

          JOIN users u
            ON u.id = tp.user_id

          WHERE bt.booking_id = b.id
            AND bt.status IN (
              'SELECTED',
              'ACCEPTED',
              'COMPLETED'
            )

          ORDER BY
            CASE bt.status
              WHEN 'ACCEPTED' THEN 1
              WHEN 'COMPLETED' THEN 2
              WHEN 'SELECTED' THEN 3
              ELSE 4
            END,
            bt.requested_at DESC

          LIMIT 1
        ) selected ON TRUE

        WHERE b.customer_id = $1
          AND (
            $2::varchar IS NULL
            OR b.status = $2
          )

        ORDER BY
          b.created_at DESC,
          b.id DESC

        LIMIT $3
        OFFSET $4
      `,
      [
        customerId,
        status,
        limit,
        offset,
      ]
    )

    return result.rows
  }
}
