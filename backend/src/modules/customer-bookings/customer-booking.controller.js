import { AppError } from '../../utils.js'
import { pool } from '../../config/database.js'

export class CustomerBookingController {
  constructor(service, technicianMatchingService) {
    this.service = service
    this.technicianMatchingService = technicianMatchingService
  }

  getPreviousAcUnits = async (request, response) => {
    const userId = request.auth?.userId
    const addressId = request.query.addressId
    if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.')
    if (typeof addressId !== 'string' || !/^[0-9a-f-]{36}$/i.test(addressId)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Valid addressId is required.')
    }
    const result = await pool.query(`
      SELECT DISTINCT bu.ac_brand_id AS "brandId", bu.ac_model_id AS "modelId",
             ab.name AS "brandName", am.model_name AS "modelName"
      FROM bookings b
      JOIN customer_profiles cp ON cp.id=b.customer_id
      JOIN booking_units bu ON bu.booking_id=b.id
      JOIN ac_models am ON am.id=bu.ac_model_id
      JOIN ac_brands ab ON ab.id=bu.ac_brand_id
      WHERE cp.user_id=$1 AND b.customer_address_id=$2
        AND b.status='COMPLETED'
        AND bu.ac_brand_id IS NOT NULL AND bu.ac_model_id IS NOT NULL
      ORDER BY "brandName", "modelName"
    `, [userId, addressId])
    response.status(200).json({ data: { items: result.rows } })
  }

  createBooking = async (request, response) => {
    const userId = request.auth?.userId
    if (!userId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.')
    }
    const booking = await this.service.createBooking(userId, request.body)
    response.status(201).json({ data: booking })
  }

  getRecommendedTechnicians = async (request, response) => {
    const result = await this.technicianMatchingService.getRecommendedTechnicians(
      request.auth?.userId, request.params.bookingId, request.query
    )
    response.status(200).json({ data: result })
  }

  selectTechnician = async (request, response) => {
    const result = await this.technicianMatchingService.selectTechnician(
      request.auth?.userId, request.params.bookingId, request.body?.technicianId
    )
    response.status(200).json({ data: result })
  }
}
