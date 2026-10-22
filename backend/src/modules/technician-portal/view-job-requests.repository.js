import { pool } from '../../config/database.js'

const effectiveStatus = `CASE
  WHEN b.status='COMPLETED' AND bt.status='ACCEPTED' THEN 'COMPLETED'
  WHEN b.status='CANCELLED' AND bt.status IN ('SELECTED','ACCEPTED') THEN 'CANCELLED'
  WHEN bt.status='SELECTED' AND bt.expires_at IS NOT NULL AND bt.expires_at<=CURRENT_TIMESTAMP
    THEN 'EXPIRED'
  ELSE CASE bt.status
    WHEN 0 THEN 'RECOMMENDED' WHEN 1 THEN 'SELECTED' WHEN 2 THEN 'ACCEPTED'
    WHEN 3 THEN 'DECLINED' WHEN 4 THEN 'NOT_SELECTED' WHEN 5 THEN 'EXPIRED'
    WHEN 6 THEN 'COMPLETED' ELSE 'CANCELLED' END
END`

const visibleStatuses = `('SELECTED','ACCEPTED','DECLINED','EXPIRED','COMPLETED','CANCELLED')`
const historyStatuses = `('DECLINED','EXPIRED','COMPLETED','CANCELLED')`
const statusFilter = `(
  $2::varchar IS NULL
  OR ($2='HISTORY' AND ${effectiveStatus} IN ${historyStatuses})
  OR ($2<>'HISTORY' AND ${effectiveStatus}=$2)
)`

export class ViewJobRequestsRepository {
  constructor({ queryable = pool } = {}) {
    this.queryable = queryable
  }

  async findTechnicianByUserId(userId) {
    const result = await this.queryable.query(
      `SELECT tp.id, tp.verification_status, tp.is_active, u.status AS account_status
       FROM technician_profiles tp
       JOIN users u ON u.id=tp.user_id
       WHERE tp.user_id=$1
       LIMIT 1`,
      [userId],
    )
    return result.rows[0] ?? null
  }

  async countJobRequests(technicianId, status = null) {
    const result = await this.queryable.query(
      `SELECT count(*)::int AS total
       FROM booking_technicians bt
       JOIN bookings b ON b.id=bt.booking_id
       WHERE bt.technician_id=$1
         AND bt.status IN ${visibleStatuses}
         AND ${statusFilter}`,
      [technicianId, status],
    )
    return result.rows[0]?.total ?? 0
  }

  async findJobRequests(technicianId, { status = null, limit = 20, offset = 0 } = {}) {
    const result = await this.queryable.query(
      `SELECT
         bt.id AS request_id,
         bt.status AS stored_request_status,
         ${effectiveStatus} AS request_status,
         bt.match_score,
         bt.match_reason,
         bt.requested_at,
         bt.responded_at,
         bt.expires_at,
         bt.decline_reason,
         bt.cancelled_at AS request_cancelled_at,
         bt.cancellation_reason AS request_cancellation_reason,
         b.id AS booking_id,
         b.booking_code,
         b.status AS booking_status,
         b.description,
         b.scheduled_at,
         b.service_address,
         b.ward,
         b.city,
         b.latitude,
         b.longitude,
         b.recipient_name,
         b.recipient_phone,
         b.subtotal,
         b.discount_amount,
         b.total_amount,
         b.completed_at AS booking_completed_at,
         b.created_at AS booking_created_at,
         b.updated_at AS booking_updated_at,
         b.cancelled_at AS booking_cancelled_at,
         b.cancellation_reason AS booking_cancellation_reason,
         cu.id AS customer_id,
         u.full_name AS customer_name,
         u.avatar_url AS customer_avatar_url,
         COALESCE(units.items, '[]'::jsonb) AS units
       FROM booking_technicians bt
       JOIN bookings b ON b.id=bt.booking_id
       JOIN customer_profiles cu ON cu.id=b.customer_id
       JOIN users u ON u.id=cu.user_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'id', bu.id,
             'unitNumber', bu.unit_number,
             'description', bu.description,
             'brandId', ab.id,
             'brandName', ab.name,
             'modelId', am.id,
             'modelName', am.model_name,
             'services', COALESCE(service_items.items, '[]'::jsonb)
           ) ORDER BY bu.unit_number, bu.id
         ) AS items
         FROM booking_units bu
         LEFT JOIN ac_brands ab ON ab.id=bu.ac_brand_id
         LEFT JOIN ac_models am ON am.id=bu.ac_model_id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'unitPrice', bus.unit_price
             ) ORDER BY s.name, s.id
           ) AS items
           FROM booking_unit_services bus
           JOIN services s ON s.id=bus.service_id
           WHERE bus.booking_unit_id=bu.id
         ) service_items ON TRUE
         WHERE bu.booking_id=b.id
       ) units ON TRUE
       WHERE bt.technician_id=$1
         AND bt.status IN ${visibleStatuses}
         AND ${statusFilter}
       ORDER BY
         CASE WHEN $2='HISTORY' THEN
           CASE ${effectiveStatus}
             WHEN 'COMPLETED' THEN COALESCE(b.completed_at,b.updated_at)
             WHEN 'CANCELLED' THEN COALESCE(bt.cancelled_at,b.cancelled_at,b.updated_at)
             WHEN 'DECLINED' THEN COALESCE(bt.responded_at,bt.requested_at)
             WHEN 'EXPIRED' THEN COALESCE(bt.expires_at,bt.requested_at)
           END
         END DESC NULLS LAST,
         CASE ${effectiveStatus}
           WHEN 'SELECTED' THEN 1
           WHEN 'ACCEPTED' THEN 2
           WHEN 'DECLINED' THEN 3
           WHEN 'EXPIRED' THEN 4
           WHEN 'CANCELLED' THEN 5
           WHEN 'COMPLETED' THEN 6
           ELSE 7
         END,
         bt.requested_at DESC,
         bt.id DESC
       LIMIT $3 OFFSET $4`,
      [technicianId, status, limit, offset],
    )
    return result.rows
  }
}
