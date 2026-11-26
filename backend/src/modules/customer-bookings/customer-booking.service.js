import { AppError, validateUuid } from '../../utils.js'
import { withTransaction } from '../../config/database.js'
import { validateCreateBookingBody } from './customer-booking.validation.js'
import { CustomerBookingRepository } from './customer-booking.repository.js'

export class CustomerBookingService {
  constructor(repository = new CustomerBookingRepository()) {
    this.repository = repository
  }

  async createBooking(userId, body) {
    if (!userId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.')
    }
    validateUuid(userId)
    const input = validateCreateBookingBody(body)

    return withTransaction(async (db) => {
      const customer = await this.repository.findCustomer(userId, db)
      if (!customer) {
        throw new AppError(403, 'CUSTOMER_PROFILE_REQUIRED', 'Active customer profile is required.')
      }

      // Serialize booking creation/cancellation for the same customer.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId])
      const cancellations = await db.query(`SELECT COUNT(*)::int AS total FROM bookings
        WHERE customer_id=$1 AND status='CANCELLED' AND cancelled_by_id=$2
          AND cancelled_at >= NOW() - INTERVAL '24 hours'
          AND cancellation_reason NOT LIKE '[LATE_TECHNICIAN]%'`, [customer.id,userId])
      if (cancellations.rows[0].total >= 5) {
        throw new AppError(429, 'BOOKING_RATE_LIMIT',
          'Bạn đã hủy quá nhiều đơn trong 24 giờ; vui lòng thử lại sau.')
      }
      const overlapping = await db.query(`SELECT 1 FROM bookings
        WHERE customer_id=$1 AND status IN ('PENDING','TECHNICIAN_SELECTED','ACCEPTED')
          AND scheduled_at BETWEEN $2::timestamptz - INTERVAL '30 minutes'
                               AND $2::timestamptz + INTERVAL '30 minutes' LIMIT 1`,
        [customer.id,input.scheduledAt])
      if (overlapping.rowCount) throw new AppError(409, 'OVERLAPPING_BOOKING',
        'Bạn đã có đơn đang hoạt động gần thời gian này.')

      const address = await this.repository.findAddress(
        customer.id, input.customerAddressId, db
      )
      if (!address) {
        throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Customer address was not found.')
      }

      const ids = [...new Set(input.units.flatMap((unit) => unit.serviceIds))]
      const services = await this.repository.findActiveServices(ids, db)
      const prices = new Map(services.map((service) => [service.id, Number(service.base_price)]))
      if (prices.size !== ids.length) {
        throw new AppError(422, 'INVALID_SERVICES', 'One or more selected services are unavailable.')
      }

      for (const unit of input.units) {
        if (unit.acBrandId) {
          const brand = await this.repository.findBrand(unit.acBrandId, db)
          if (!brand) {
            throw new AppError(422, 'INVALID_AC_BRAND', 'Selected AC brand is unavailable.')
          }
        }
        if (unit.acModelId) {
          const previous = await db.query(`SELECT 1 FROM bookings b
            JOIN booking_units bu ON bu.booking_id=b.id
            WHERE b.customer_id=$1 AND b.service_location_id=$2
              AND b.status='COMPLETED' AND bu.ac_brand_id=$3 AND bu.ac_model_id=$4 LIMIT 1`,
            [customer.id,address.service_location_id,unit.acBrandId,unit.acModelId])
          if (!previous.rowCount) throw new AppError(422, 'AC_MODEL_NOT_PREVIOUSLY_CONFIRMED',
            'Chỉ được chọn lại model máy lạnh đã được xác nhận trong đơn hoàn thành tại địa chỉ này.')
          const model = await this.repository.findModel(unit.acModelId, unit.acBrandId, db)
          if (!model) {
            throw new AppError(422, 'INVALID_AC_MODEL', 'Selected AC model does not belong to the active brand.')
          }
        }
      }

      const subtotal = input.units.reduce(
        (total, unit) => total + unit.serviceIds.reduce(
          (sum, serviceId) => sum + prices.get(serviceId), 0
        ), 0
      )
      if (!Number.isSafeInteger(Math.round(subtotal * 100))) {
        throw new AppError(422, 'INVALID_TOTAL', 'Booking total is out of range.')
      }

      const booking = await this.repository.createBooking({
        customerId: customer.id,
        addressId: address.id,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        description: input.description,
        addressLine: address.address_line,
        ward: address.ward,
        city: address.city,
        latitude: address.latitude,
        longitude: address.longitude,
        scheduledAt: input.scheduledAt,
        subtotal,
      }, db)

      for (const [index, unit] of input.units.entries()) {
        const createdUnit = await this.repository.createUnit(booking.id, index + 1, unit, db)
        for (const serviceId of unit.serviceIds) {
          await this.repository.createUnitService(
            createdUnit.id, serviceId, prices.get(serviceId), db
          )
        }
      }
      await this.repository.insertStatusHistory(booking.id, userId, db)

      return {
        id: booking.id,
        bookingCode: booking.booking_code,
        status: booking.status,
        scheduledAt: booking.scheduled_at,
        subtotal: Number(booking.subtotal),
        discountAmount: Number(booking.discount_amount),
        totalAmount: Number(booking.total_amount),
        createdAt: booking.created_at,
      }
    })
  }
}
