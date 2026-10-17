import { reconcileTechnicianRequest } from './reconcile-technician-request.js'
import { AppError, validateUuid } from '../../utils.js'
import { withTransaction } from '../../config/database.js'
import { BookingDetailRepository } from './booking-detail.repository.js'

export class BookingDetailService {
  constructor(
    repository = new BookingDetailRepository(),
    transaction = withTransaction,
  ) {
    this.repository = repository
    this.transaction = transaction
  }

  async owned(userId, bookingId, db, lock = false) {
    if (!userId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.')
    }
    validateUuid(userId)
    validateUuid(bookingId)

    const booking = await this.repository.findOwnedBooking(
      userId,
      bookingId,
      db,
      lock,
    )
    if (!booking) {
      throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found.')
    }
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
      id: b.id,
      bookingCode: b.booking_code,
      status: b.status,
      description: b.description,
      scheduledAt: b.scheduled_at,
      customerAddressId: b.customer_address_id,
      address: {
        addressLine: b.service_address,
        ward: b.ward,
        city: b.city,
      },
      recipient: {
        name: b.recipient_name,
        phone: b.recipient_phone,
      },
      pricing: {
        subtotal: Number(b.subtotal),
        discountAmount: Number(b.discount_amount),
        totalAmount: Number(b.total_amount),
      },
      units,
      technician,
      timeline,
      cancellationReason: b.cancellation_reason,
      cancelledAt: b.cancelled_at,
      canCancel: ['PENDING', 'TECHNICIAN_SELECTED'].includes(b.status),
      technicianCompletedAt: b.technician_completed_at ?? null,
      completionConfirmedAt: b.completion_confirmed_at ?? null,
      canConfirmCompletion:
        !b.completion_confirmed_at &&
        !!b.technician_completed_at &&
        b.status === 'WAITING_CONFIRMATION',
    }
  }

  async timeline(userId, bookingId) {
    await this.owned(userId, bookingId)
    return this.repository.findTimeline(bookingId)
  }

  async confirmCompletion(userId, bookingId) {
    return