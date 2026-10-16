import { AppError, validateUuid } from '../../utils.js'
import { withTransaction } from '../../config/database.js'
import { BookingDetailRepository } from './booking-detail.repository.js'

export class BookingDetailService {
  constructor(repository = new BookingDetailRepository(), transaction = withTransaction) {
    this.repository = repository
    this.transaction = transaction
  }

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
      customerAddressId: b.customer_address_id,
      address: { addressLine: b.service_address, ward: b.ward, city: b.city },
      recipient: { name: b.recipient_name, phone: b.recipient_phone },
      pricing: { subtotal: Number(b.subtotal), discountAmount: Number(b.discount_amount), totalAmount: Number(b.total_amount) },
      units, technician, timeline,
      cancellationReason: b.cancellation_reason, cancelledAt: b.cancelled_at,
      canCancel: ['PENDING', 'TECHNICIAN_SELECTED'].includes(b.status),
      technicianCompletedAt: b.technician_completed_at ?? null,
      completionConfirmedAt: b.completion_confirmed_at ?? null,
      canConfirmCompletion: ['ACCEPTED', 'WAITING_CONFIRMATION'].includes(b.status),
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
    return this.transaction(async (db) => {
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

  async confirmCompletion(userId, bookingId) {
    return this.transaction(async (db) => {
      const booking = await this.owned(userId, bookingId, db, true)
      if (booking.status === 'COMPLETED') {
        throw new AppError(409, 'BOOKING_ALREADY_COMPLETED', 'Booking đã được hoàn thành trước đó.')
      }
      if (!['ACCEPTED', 'WAITING_CONFIRMATION'].includes(booking.status)) {
        throw new AppError(409, 'BOOKING_CANNOT_BE_COMPLETED', 'Booking chưa ở trạng thái có thể xác nhận hoàn thành.')
      }
      const assignment = await this.repository.findAcceptedAssignment(bookingId, db)
      if (!assignment) {
        throw new AppError(409, 'ACCEPTED_TECHNICIAN_REQUIRED', 'Booking không có kỹ thuật viên đang thực hiện.')
      }
      const completed = await this.repository.confirmCompletion(
        userId,
        bookingId,
        assignment.technician_user_id,
        db,
      )
      if (!completed || completed.status !== 'COMPLETED') {
        throw new AppError(409, 'BOOKING_COMPLETION_FAILED', 'Không thể xác nhận hoàn thành. Vui lòng tải lại và thử lại.')
      }
      await this.repository.insertCompletionHistory(userId, bookingId, db)
      await this.repository.notifyTechnician(
        assignment.technician_user_id,
        bookingId,
        completed.booking_code,
        db,
      )
      return {
        id: completed.id,
        bookingCode: completed.booking_code,
        status: completed.status,
        completedAt: completed.completed_at,
        updatedAt: completed.updated_at,
      }
    })
  }
}
