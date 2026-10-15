import { AppError, validateUuid } from '../../utils.js'
import { withTransaction } from '../../config/database.js'
import { BookingDetailRepository } from './booking-detail.repository.js'

export class BookingDetailService {
  constructor(repository = new BookingDetailRepository()) { this.repository = repository }

  async owned(userId, bookingId, db, lock = false) {
    if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.')
    validateUuid(userId)
    validateUuid(bookingId)
    const booking = await this.repository.findOwnedBooking(userId, bookingId, db, lock)
    if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found.')
    return booking
  }

  async detail(userId, bookingId) {
    const b = await this.owned(userId, bookingId)
    const [units, technician, timeline] = await Promise.all([
      this.repository.findUnits(bookingId),
      this.repository.findTechnician(bookingId),
      this.repository.findTimeline(bookingId),
    ])
    return {
      id: b.id, bookingCode: b.booking_code, status: b.status,
      description: b.description, scheduledAt: b.scheduled_at,
      address: { addressLine: b.service_address, ward: b.ward, city: b.city },
      recipient: { name: b.recipient_name, phone: b.recipient_phone },
      pricing: { subtotal: Number(b.subtotal), discountAmount: Number(b.discount_amount), totalAmount: Number(b.total_amount) },
      units, technician, timeline,
      cancellationReason: b.cancellation_reason, cancelledAt: b.cancelled_at,
      canCancel: ['PENDING', 'TECHNICIAN_SELECTED'].includes(b.status),
    }
  }

  async timeline(userId, bookingId) {
    await this.owned(userId, bookingId)
    return this.repository.findTimeline(bookingId)
  }

  async cancel(userId, bookingId, body) {
    const reason = body?.reason
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 1000) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Cancellation reason must contain 5–1000 characters.')
    }
    return withTransaction(async (db) => {
      const b = await this.owned(userId, bookingId, db, true)
      if (!['PENDING', 'TECHNICIAN_SELECTED'].includes(b.status)) {
        throw new AppError(409, 'CANNOT_CANCEL', 'Booking cannot be cancelled at this stage.')
      }
      const cancelled = await this.repository.cancelBooking(userId, bookingId, reason.trim(), db)
      if (!cancelled) throw new AppError(409, 'CANNOT_CANCEL', 'Booking status changed. Please refresh.')
      await this.repository.cancelPendingRequests(bookingId, db)
      await this.repository.insertHistory(userId, bookingId, reason.trim(), db)
      return cancelled
    })
  }
}
