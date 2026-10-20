import { pool } from '../../config/database.js'

const sameUnit = `history_unit.ac_brand_id IS NOT DISTINCT FROM current_unit.ac_brand_id
  AND history_unit.ac_model_id IS NOT DISTINCT FROM current_unit.ac_model_id`

export class AcServiceHistoryRepository {
  constructor({ queryable = pool } = {}) { this.queryable = queryable }

  async findAccessibleUnit(userId, requestId, unitId) {
    const result = await this.queryable.query(`
      SELECT bt.id AS request_id,b.id AS booking_id,b.customer_id,b.booking_code,b.status AS booking_status,
        current_unit.id AS unit_id,current_unit.unit_number,current_unit.description,
        current_unit.ac_brand_id,current_unit.ac_model_id,ab.name AS brand_name,am.model_name
      FROM booking_technicians bt
      JOIN technician_profiles tp ON tp.id=bt.technician_id
      JOIN users technician_user ON technician_user.id=tp.user_id
      JOIN bookings b ON b.id=bt.booking_id
      JOIN booking_units current_unit ON current_unit.booking_id=b.id AND current_unit.id=$3
      LEFT JOIN ac_brands ab ON ab.id=current_unit.ac_brand_id
      LEFT JOIN ac_models am ON am.id=current_unit.ac_model_id
      WHERE bt.id=$2 AND tp.user_id=$1
        AND tp.verification_status='VERIFIED' AND tp.is_active=true
        AND technician_user.status='ACTIVE'
        AND bt.status IN ('SELECTED','ACCEPTED')
        AND b.status IN ('TECHNICIAN_SELECTED','ACCEPTED','WAITING_CONFIRMATION')
      LIMIT 1`, [userId, requestId, unitId])
    return result.rows[0] ?? null
  }

  async countHistory(context) {
    const result = await this.queryable.query(`
      SELECT count(*)::int AS total
      FROM booking_units current_unit
      JOIN booking_units history_unit ON ${sameUnit}
      JOIN bookings history_booking ON history_booking.id=history_unit.booking_id
      WHERE current_unit.id=$1 AND history_booking.customer_id=$2
        AND (current_unit.ac_brand_id IS NOT NULL OR current_unit.ac_model_id IS NOT NULL)
        AND history_booking.id<>$3 AND history_booking.status='COMPLETED'`,
    [context.unit_id, context.customer_id, context.booking_id])
    return result.rows[0]?.total ?? 0
  }

  async findHistory(context, { limit, offset }) {
    const result = await this.queryable.query(`
      SELECT history_booking.id AS booking_id,history_booking.booking_code,
        history_booking.scheduled_at,history_booking.completed_at,history_booking.description AS booking_description,
        history_booking.total_amount,history_unit.id AS unit_id,history_unit.unit_number,
        history_unit.description,history_unit.diagnosis,history_unit.service_notes,
        ab.name AS brand_name,am.model_name,technician_user.full_name AS technician_name,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id',s.id,'name',s.name,'unitPrice',bus.unit_price
          ) ORDER BY s.name,s.id)
          FROM booking_unit_services bus JOIN services s ON s.id=bus.service_id
          WHERE bus.booking_unit_id=history_unit.id
        ),'[]'::json) AS services,
        COALESCE((
          SELECT json_agg(json_build_object(
            'quotationId',q.id,'quotationNumber',q.quotation_number,
            'reason',q.issue_description,'note',q.note,
            'itemId',qi.id,'itemType',qi.item_type,'description',qi.description,
            'quantity',qi.quantity,'unit',qi.unit,'unitPrice',qi.unit_price,
            'totalPrice',qi.total_price
          ) ORDER BY q.quotation_number,qi.id)
          FROM quotations q
          JOIN quotation_items qi ON qi.quotation_id=q.id
          WHERE q.booking_id=history_booking.id
            AND q.quotation_type='ADDITIONAL' AND q.status='ACCEPTED'
        ),'[]'::json) AS additional_work
      FROM booking_units current_unit
      JOIN booking_units history_unit ON ${sameUnit}
      JOIN bookings history_booking ON history_booking.id=history_unit.booking_id
      LEFT JOIN ac_brands ab ON ab.id=history_unit.ac_brand_id
      LEFT JOIN ac_models am ON am.id=history_unit.ac_model_id
      LEFT JOIN LATERAL (
        SELECT users.full_name
        FROM booking_technicians assignment
        JOIN technician_profiles technician ON technician.id=assignment.technician_id
        JOIN users ON users.id=technician.user_id
        WHERE assignment.booking_id=history_booking.id
          AND assignment.status IN ('ACCEPTED','COMPLETED')
        ORDER BY assignment.responded_at DESC NULLS LAST,assignment.id DESC LIMIT 1
      ) technician_user ON TRUE
      WHERE current_unit.id=$1 AND history_booking.customer_id=$2
        AND (current_unit.ac_brand_id IS NOT NULL OR current_unit.ac_model_id IS NOT NULL)
        AND history_booking.id<>$3 AND history_booking.status='COMPLETED'
      ORDER BY history_booking.completed_at DESC NULLS LAST,history_booking.updated_at DESC,history_booking.id DESC
      LIMIT $4 OFFSET $5`,
    [context.unit_id, context.customer_id, context.booking_id, limit, offset])
    return result.rows
  }
}
