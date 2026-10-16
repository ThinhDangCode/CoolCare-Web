
import { pool } from '../../config/database.js'

export const RECOMMENDATION_LIMIT = 50

export class TechnicianMatchingRepository {
  constructor({ db = pool } = {}) {
    this.db = db
  }

  async findCustomerBooking(
    bookingId,
    userId,
    db = this.db
  ) {
    const result = await db.query(
      `
        SELECT
          b.id,
          b.booking_code,
          b.customer_id,
          b.city,
          b.ward,
          b.scheduled_at,
          b.status
        FROM bookings b
        JOIN customer_profiles cp
          ON cp.id = b.customer_id
        WHERE b.id = $1
          AND cp.user_id = $2
        LIMIT 1
      `,
      [bookingId, userId]
    )

    return result.rows[0] ?? null
  }

  async lockCustomerBooking(
    bookingId,
    userId,
    db
  ) {
    const result = await db.query(
      `
        SELECT
          b.id,
          b.booking_code,
          b.customer_id,
          b.city,
          b.ward,
          b.scheduled_at,
          b.status
        FROM bookings b
        JOIN customer_profiles cp
          ON cp.id = b.customer_id
        WHERE b.id = $1
          AND cp.user_id = $2
        FOR UPDATE OF b
      `,
      [bookingId, userId]
    )

    return result.rows[0] ?? null
  }

  async findExistingRequest(
    bookingId,
    db = this.db
  ) {
    const result = await db.query(
      `
        SELECT
          id,
          booking_id,
          technician_id,
          status,
          requested_at
        FROM booking_technicians
        WHERE booking_id = $1
          AND status IN ('SELECTED', 'ACCEPTED')
        ORDER BY requested_at DESC
        LIMIT 1
      `,
      [bookingId]
    )

    return result.rows[0] ?? null
  }

  async lockTechnician(
    technicianId,
    db
  ) {
    const result = await db.query(
      `
        SELECT
          tp.id,
          tp.user_id
        FROM technician_profiles tp
        WHERE tp.id = $1
        FOR UPDATE OF tp
      `,
      [technicianId]
    )

    return result.rows[0] ?? null
  }

  /**
   * Match technicians using the existing CoolCare schema.
   *
   * Eligibility:
   * - Database can_recommend_technician() predicate
   * - Active user
   * - Matching the registered service city and ward
   * - Required service skills and optional AC brands
   *
   * Ranking:
   * - Rating first
   * - Review count
   * - Historical completion performance
   * - Active penalty points
   * - Experience
   * - Same-ward preference after quality/performance
   *
   * The schema has no separate working-shift calendar.
   * No unverified schedule table is queried.
   */
  async findRecommendedTechnicians(
    bookingId,
    { limit = RECOMMENDATION_LIMIT } = {},
    db = this.db
  ) {
    const result = await db.query(
      `
        WITH target_booking AS (
          SELECT
            id,
            city,
            ward
          FROM bookings
          WHERE id = $1
        ),

        requested_services AS (
          SELECT DISTINCT
            bus.service_id,
            bu.ac_brand_id
          FROM booking_units bu
          JOIN booking_unit_services bus
            ON bus.booking_unit_id = bu.id
          WHERE bu.booking_id = $1
        ),

        technician_performance AS (
          SELECT
            bt.technician_id,

            COUNT(*) FILTER (
              WHERE bt.status IN (
                'ACCEPTED',
                'COMPLETED',
                'DECLINED',
                'CANCELLED'
              )
            ) AS resolved_jobs,

            COUNT(*) FILTER (
              WHERE bt.status = 'COMPLETED'
            ) AS completed_jobs,

            COUNT(*) FILTER (
              WHERE bt.status = 'DECLINED'
            ) AS declined_jobs,

            COUNT(*) FILTER (
              WHERE bt.status = 'CANCELLED'
            ) AS cancelled_jobs

          FROM booking_technicians bt
          GROUP BY bt.technician_id
        ),

        active_penalties AS (
          SELECT
            p.technician_id,
            COALESCE(
              SUM(p.penalty_points),
              0
            ) AS penalty_points
          FROM technician_penalties p
          WHERE p.status = 'ACTIVE'
            AND (
              p.expires_at IS NULL
              OR p.expires_at > CURRENT_TIMESTAMP
            )
          GROUP BY p.technician_id
        ),

        eligible AS (
          SELECT
            tp.id,
            tp.user_id,
            u.full_name,
            u.avatar_url,
            tp.rating_average,
            tp.total_reviews,
            tp.years_experience,
            tp.bio,

            EXISTS (
              SELECT 1
              FROM technician_areas local_area
              WHERE local_area.technician_id = tp.id
                AND LOWER(BTRIM(local_area.city)) =
                    LOWER(BTRIM(target.city))
                AND LOWER(BTRIM(local_area.ward)) =
                    LOWER(BTRIM(target.ward))
            ) AS same_ward,

            COALESCE(
              perf.resolved_jobs,
              0
            ) AS resolved_jobs,

            COALESCE(
              perf.completed_jobs,
              0
            ) AS completed_jobs,

            COALESCE(
              perf.declined_jobs,
              0
            ) AS declined_jobs,

            COALESCE(
              perf.cancelled_jobs,
              0
            ) AS cancelled_jobs,

            COALESCE(
              penalties.penalty_points,
              0
            ) AS penalty_points

          FROM technician_profiles tp

          JOIN users u
            ON u.id = tp.user_id

          CROSS JOIN target_booking target

          LEFT JOIN technician_performance perf
            ON perf.technician_id = tp.id

          LEFT JOIN active_penalties penalties
            ON penalties.technician_id = tp.id

          WHERE u.status = 'ACTIVE'

            AND can_recommend_technician(tp.id)

            AND EXISTS (
              SELECT 1
              FROM technician_areas area
              WHERE area.technician_id = tp.id
                AND LOWER(BTRIM(area.city)) =
                    LOWER(BTRIM(target.city))
                AND LOWER(BTRIM(area.ward)) =
                    LOWER(BTRIM(target.ward))
            )

            AND EXISTS (
              SELECT 1
              FROM requested_services
            )

            AND NOT EXISTS (
              SELECT 1
              FROM requested_services requested
              WHERE NOT EXISTS (
                SELECT 1
                FROM technician_skills ts

                JOIN skills skill
                  ON skill.id = ts.skill_id

                WHERE ts.technician_id = tp.id
                  AND skill.is_active = TRUE
                  AND skill.service_id =
                      requested.service_id
                  AND (
                    requested.ac_brand_id IS NULL
                    OR ts.ac_brand_id IS NULL
                    OR ts.ac_brand_id =
                        requested.ac_brand_id
                  )
              )
            )
        ),

        ranked AS (
          SELECT
            eligible.*,

            ROW_NUMBER() OVER (
              ORDER BY
                rating_average DESC,
                total_reviews DESC,

                CASE
                  WHEN resolved_jobs > 0 THEN
                    completed_jobs::numeric /
                    resolved_jobs
                  ELSE 0
                END DESC,

                penalty_points ASC,
                declined_jobs ASC,
                cancelled_jobs ASC,
                years_experience DESC,
                same_ward DESC,
                id ASC
            ) AS recommendation_rank

          FROM eligible
        )

        SELECT
          ranked.id,
          ranked.user_id,
          ranked.full_name,
          ranked.avatar_url,
          ranked.rating_average,
          ranked.total_reviews,
          ranked.years_experience,
          ranked.bio,
          ranked.completed_jobs,
          ranked.declined_jobs,
          ranked.cancelled_jobs,
          ranked.penalty_points,

          COALESCE(
            (
              SELECT json_agg(
                DISTINCT skill.name
              )
              FROM technician_skills ts
              JOIN skills skill
                ON skill.id = ts.skill_id
              WHERE ts.technician_id = ranked.id
                AND skill.is_active = TRUE
            ),
            '[]'::json
          ) AS skills,

          COALESCE(
            (
              SELECT json_agg(
                json_build_object(
                  'city', area.city,
                  'ward', area.ward
                )
              )
              FROM technician_areas area
              WHERE area.technician_id = ranked.id
            ),
            '[]'::json
          ) AS service_areas

        FROM ranked

        WHERE recommendation_rank <= $2

        ORDER BY recommendation_rank ASC
      `,
      [bookingId, limit]
    )

    return result.rows
  }

  /**
   * Recheck the selected technician against the same
   * fixed recommendation window used by the API.
   */
  async findEligibleTechnician(
    bookingId,
    technicianId,
    db = this.db
  ) {
    const recommendations =
      await this.findRecommendedTechnicians(
        bookingId,
        { limit: RECOMMENDATION_LIMIT },
        db
      )

    return recommendations.find(
      (item) => item.id === technicianId
    ) ?? null
  }

  /**
   * Create or reuse the existing historical row.
   *
   * The database has a unique constraint on
   * (booking_id, technician_id), so a previously
   * declined request cannot be inserted again.
   *
   * This implementation deliberately does not
   * reopen declined/cancelled requests.
   */
  async insertTechnicianRequest(
    bookingId,
    technicianId,
    db
  ) {
    const result = await db.query(
      `
        INSERT INTO booking_technicians (
          booking_id,
          technician_id,
          status,
          requested_at
        )
        VALUES (
          $1,
          $2,
          'SELECTED',
          CURRENT_TIMESTAMP
        )
        RETURNING
          id,
          booking_id,
          technician_id,
          status,
          requested_at
      `,
      [bookingId, technicianId]
    )

    return result.rows[0]
  }

  /**
   * Update booking state after the customer sends
   * a technician request.
   *
   * This is NOT technician acceptance.
   */
  async markTechnicianSelected(
    bookingId,
    db
  ) {
    const result = await db.query(
      `
        UPDATE bookings
        SET
          status = 'TECHNICIAN_SELECTED',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status = 'PENDING'
        RETURNING
          id,
          booking_code,
          status,
          scheduled_at
      `,
      [bookingId]
    )

    return result.rows[0] ?? null
  }

  async insertBookingStatusHistory(
    bookingId,
    changedById,
    db
  ) {
    const result = await db.query(
      `
        INSERT INTO booking_status_history (
          booking_id,
          status,
          changed_by_id,
          note,
          created_at
        )
        VALUES (
          $1,
          'TECHNICIAN_SELECTED',
          $2,
          'Customer sent a technician request.',
          CURRENT_TIMESTAMP
        )
        RETURNING
          id,
          booking_id,
          status,
          changed_by_id,
          created_at
      `,
      [bookingId, changedById]
    )

    return result.rows[0]
  }
}
