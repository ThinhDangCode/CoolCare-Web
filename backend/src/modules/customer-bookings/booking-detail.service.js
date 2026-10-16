import { reconcileTechnicianRequest } from './reconcile-technician-request.js'
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
    await reconcileTechnicianRequest(userId, bookingId)
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
      canConfirmCompletion: !b.completion_confirmed_at && !!b.technician_completed_at && ['WAITING_CONFIRMATION','IN_PROGRESS','QUOTATION_ACCEPTED'].includes(b.status),
    }
  }

  async timeline(userId, bookingId) {
    await this.owned(userId, bookingId)
    return this.repository.findTimeline(bookingId)
  }

  async confirmCompletion(userId, bookingId) {
    return withTransaction(async (db) => {
      const booking = await this.owned(userId, bookingId, db, true)
      if (booking.completion_confirmed_at) {
        throw new AppError(409, 'COMPLETION_ALREADY_CONFIRMED', 'Already confirmed.')
      }
      if (!['WAITING_CONFIRMATION', 'IN_PROGRESS', 'QUOTATION_ACCEPTED'].includes(booking.status)) {
        throw new AppError(409, 'COMPLETION_NOT_ALLOWED', 'Booking is not ready for completion.')
      }
      if (!booking.technician_completed_at) {
        throw new AppError(409, 'TECHNICIAN_NOT_COMPLETED', 'Technician has not confirmed completion.')
      }
      const result = await db.query(`
        UPDATE bookings SET completion_confirmed_at=CURRENT_TIMESTAMP,
          completion_confirmed_by_id=$2, updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 RETURNING id, status, completion_confirmed_at, completed_at
      `, [bookingId, userId])
      const updated = result.rows[0]
      // The existing database trigger sets COMPLETED only after both confirmations.
      if (updated.status === 'COMPLETED' && booking.status !== 'COMPLETED') {
        await db.query(`INSERT INTO booking_status_history (booking_id,status,changed_by_id,note)
          VALUES ($1,'COMPLETED',$2,'Customer confirmed work completion')`, [bookingId,userId])
      }
      return updated
    })
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
