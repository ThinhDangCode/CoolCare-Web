
import { pool } from '../../config/database.js'

// Customer-scoped, read-only. Every query joins customer_profiles on the signed-in
// user, so another customer's devices are indistinguishable from missing ones.
export class CustomerAcUnitRepository {
  constructor({ query = (...args) => pool.query(...args) } = {}) {
    this.query = query
  }

  async listGroups(userId) {
    const result = await this.query(
      `SELECT bu.ac_brand_id AS "brandId", bu.ac_model_id AS "modelId",
              ab.name AS "brandName", am.model_name AS "modelName",
              am.capacity_btu AS "capacityBtu",
              count(*)::int AS "serviceCount",
              count(*) FILTER (WHERE b.status = 'COMPLETED')::int AS "completedCount",
              max(COALESCE(b.completed_at, b.scheduled_at)) AS "lastServiceAt"
         FROM booking_units bu
         JOIN bookings b ON b.id = bu.booking_id
         JOIN customer_profiles cp ON cp.id = b.customer_id
         LEFT JOIN ac_brands ab ON ab.id = bu.ac_brand_id
         LEFT JOIN ac_models am ON am.id = bu.ac_model_id
        WHERE cp.user_id = $1
        GROUP BY bu.ac_brand_id, bu.ac_model_id, ab.name, am.model_name, am.capacity_btu
        ORDER BY max(COALESCE(b.completed_at, b.scheduled_at)) DESC NULLS LAST,
                 ab.name NULLS LAST, am.model_name NULLS LAST
        LIMIT 100`,
      [userId]
    )

    return result.rows
  }

  async findGroup(userId, brandId, modelId) {
    const result = await this.query(
      `SELECT count(*)::int AS total, max(ab.name) AS "brandName",
              max(am.model_name) AS "modelName", max(am.capacity_btu) AS "capacityBtu"
         FROM booking_units bu
         JOIN bookings b ON b.id = bu.booking_id
         JOIN customer_profiles cp ON cp.id = b.customer_id
         LEFT JOIN ac_brands ab ON ab.id = bu.ac_brand_id
         LEFT JOIN ac_models am ON am.id = bu.ac_model_id
        WHERE cp.user_id = $1
          AND bu.ac_brand_id IS NOT DISTINCT FROM $2::uuid
          AND bu.ac_model_id IS NOT DISTINCT FROM $3::uuid`,
      [userId, brandId, modelId]
    )

    return result.rows[0]
  }

  async findHistory(userId, { brandId, modelId, limit, offset }) {
    const result = await this.query(
      `SELECT b.id AS "bookingId",
              b.booking_code AS "bookingCode",
              b.status AS "bookingStatus",
              b.scheduled_at AS "scheduledAt",
              b.completed_at AS "completedAt",
              b.total_amount AS "totalAmount",
              bu.id AS "unitId",
              bu.unit_number AS "unitNumber",
              bu.description,
              bu.diagnosis,
              bu.service_notes AS "serviceNotes",
              tech.full_name AS "technicianName",
              tech.phone AS "technicianPhone",
              COALESCE((
                SELECT json_agg(
                  json_build_object(
                    'id', s.id,
                    'name', s.name,
                    'unitPrice', bus.unit_price
                  )
                  ORDER BY s.name, s.id
                )
                FROM booking_unit_services bus
                JOIN services s ON s.id = bus.service_id
                WHERE bus.booking_unit_id = bu.id
              ), '[]'::json) AS services,
              COALESCE((
                SELECT json_agg(
                  json_build_object(
                    'description', qi.description,
                    'totalPrice', qi.total_price
                  )
                  ORDER BY q.quotation_number, qi.id
                )
                FROM quotations q
                JOIN quotation_items qi ON qi.quotation_id = q.id
                WHERE q.booking_id = b.id
                  AND q.quotation_type = 'ADDITIONAL'
                  AND q.status = 'ACCEPTED'
              ), '[]'::json) AS "additionalWork"
         FROM booking_units bu
         JOIN bookings b ON b.id = bu.booking_id
         JOIN customer_profiles cp ON cp.id = b.customer_id
         LEFT JOIN LATERAL (
           SELECT u.full_name, u.phone
             FROM booking_technicians assignment
             JOIN technician_profiles tp
               ON tp.id = assignment.technician_id
             JOIN users u
               ON u.id = tp.user_id
            WHERE assignment.booking_id = b.id
              AND assignment.status IN ('ACCEPTED', 'COMPLETED')
            ORDER BY assignment.responded_at DESC NULLS LAST,
                     assignment.id DESC
            LIMIT 1
         ) tech ON TRUE
        WHERE cp.user_id = $1
          AND bu.ac_brand_id IS NOT DISTINCT FROM $2::uuid
          AND bu.ac_model_id IS NOT DISTINCT FROM $3::uuid
        ORDER BY COALESCE(b.completed_at, b.scheduled_at) DESC NULLS LAST,
                 b.id DESC,
                 bu.unit_number
        LIMIT $4 OFFSET $5`,
      [userId, brandId, modelId, limit, offset]
    )

    return result.rows
  }
}
