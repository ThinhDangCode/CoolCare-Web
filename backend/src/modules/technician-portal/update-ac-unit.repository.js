import { withTransaction } from '../../config/database.js'
import { AppError, validateUuid } from '../../utils.js'

// Uses booking_units.ac_brand_id and ac_model_id; no schema changes.
export class UpdateAcUnitRepository {
  constructor({ transaction = withTransaction } = {}) { this.transaction = transaction }

  async update(userId, requestId, unitId, input) {
    const validUserId = validateUuid(userId)
    const validRequestId = validateUuid(requestId)
    const validUnitId = validateUuid(unitId)
    const brandId = validateUuid(input?.brandId)
    const modelId = validateUuid(input?.modelId)
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['brandId','modelId'].includes(key))) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Invalid AC information.')
    }
    return this.transaction(async (client) => {
      const job = (await client.query(`
        SELECT bt.id, bt.booking_id FROM booking_technicians bt
        JOIN technician_profiles tp ON tp.id=bt.technician_id
        JOIN bookings b ON b.id=bt.booking_id
        WHERE bt.id=$1 AND tp.user_id=$2
          AND bt.status='ACCEPTED' AND b.status='ACCEPTED'
        FOR UPDATE OF bt,b
      `, [validRequestId, validUserId])).rows[0]
      if (!job) throw new AppError(403, 'AC_UPDATE_FORBIDDEN',
        'Only the assigned technician can update AC information for an ongoing job.')

      const model = (await client.query(`
        SELECT am.id FROM ac_models am
        JOIN ac_brands ab ON ab.id=am.brand_id
        WHERE am.id=$1 AND am.brand_id=$2 AND am.is_active=TRUE
          AND ab.is_active=TRUE AND am.deleted_at IS NULL AND ab.deleted_at IS NULL
      `, [modelId, brandId])).rows[0]
      if (!model) throw new AppError(422, 'MODEL_BRAND_MISMATCH',
        'The selected model does not belong to an active AC brand.')

      const updated = await client.query(`
        UPDATE booking_units
        SET ac_brand_id=$3,ac_model_id=$4
        WHERE id=$1 AND booking_id=$2
        RETURNING id,unit_number,ac_brand_id AS "brandId",ac_model_id AS "modelId"
      `, [validUnitId, job.booking_id, brandId, modelId])
      if (!updated.rowCount) throw new AppError(404, 'BOOKING_UNIT_NOT_FOUND',
        'AC unit not found in the assigned booking.')
      return updated.rows[0]
    })
  }
}
