
import { AppError, validateUuid } from '../../utils.js'
import { randomUUID } from 'node:crypto'
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
      throw new AppError(401, 'UNAUTHORIZED', 'Vui lòng đăng nhập.')
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
      throw new AppError(
        404,
        'BOOKING_NOT_FOUND',
        'Không tìm thấy booking.',
      )
    }

    return booking
  }

  async reportNoShow(userId, bookingId, body) {
    const description = String(body?.description ?? '').trim()
    if (typeof body?.description !== 'string' || description.length < 10 ||
        description.length > 2000 || Object.keys(body).some(k => k !== 'description')) {
      throw new AppError(422, 'VALIDATION_ERROR',
        'Please describe the missing technician (10–2000 characters).')
    }
    return this.transaction(async db => {
      const booking = await this.owned(userId, bookingId, db, true)
      if (booking.status !== 'ACCEPTED' ||
          new Date(booking.scheduled_at).getTime() + 30*60*1000 > Date.now()) {
        throw new AppError(409, 'NO_SHOW_NOT_REPORTABLE',
          'A missing technician can only be reported 30 minutes after the appointment starts.')
      }
      const technician = (await db.query(`
        SELECT technician_id FROM booking_technicians
        WHERE booking_id=$1 AND status='ACCEPTED' LIMIT 1
      `, [bookingId])).rows[0]
      if (!technician) throw new AppError(409, 'TECHNICIAN_NOT_ASSIGNED',
        'No accepted technician assignment was found.')
      const previous = (await db.query(`
        SELECT id FROM complaints WHERE booking_id=$1 AND type='TECHNICIAN'
          AND subject='Technician did not arrive' LIMIT 1
      `, [bookingId])).rows[0]
      if (previous) throw new AppError(409, 'NO_SHOW_ALREADY_REPORTED',
        'This booking already has a technician no-show report.')
      const code = `NS-${randomUUID().replace(/-/g,'').slice(0,16).toUpperCase()}`
      const result = await db.query(`
        INSERT INTO complaints(complaint_code,booking_id,customer_id,technician_id,
          type,subject,description)
        VALUES($1,$2,$3,$4,'TECHNICIAN','Technician did not arrive',$5)
        RETURNING id,complaint_code,status
      `, [code, bookingId, booking.customer_id, technician.technician_id, description])
      return result.rows[0]
    })
  }

  // Convert database fields to the format expected by Flutter.
  async detail(userId, bookingId) {
    const booking = await this.owned(userId, bookingId)

    const [units, technician] = await Promise.all([
      this.repository.findUnits(bookingId),
      this.repository.findTechnician(bookingId),
    ])

    const status = booking.status

    const canCancel = [
      'PENDING',
      'TECHNICIAN_SELECTED',
    ].includes(status)

    const canConfirmCompletion =
      status === 'WAITING_CONFIRMATION' &&
      booking.technician_completed_at != null &&
      booking.completion_confirmed_at == null

    return {
      ...booking,

      // Booking information
      id: booking.id,
      bookingId: booking.id,
      bookingCode: booking.booking_code,
      status: booking.status,
      description: booking.description,

      // Schedule
      scheduledAt: booking.scheduled_at,
      createdAt: booking.created_at,
      updatedAt: booking.updated_at,
      completedAt: booking.completed_at,
      cancelledAt: booking.cancelled_at,

      // Address
      address: {
        id: booking.customer_address_id,
        addressLine: booking.service_address,
        ward: booking.ward,
        city: booking.city,
        latitude: booking.latitude,
        longitude: booking.longitude,
      },

      // Recipient
      recipient: {
        name: booking.recipient_name,
        phone: booking.recipient_phone,
      },

      // Pricing
      pricing: {
        subtotal: booking.subtotal,
        subtotalAmount: booking.subtotal,
        discountAmount: booking.discount_amount,
        totalAmount: booking.total_amount,
      },

      // Technician and services
      technician,
      units,

      // Booking actions
      canCancel,
      canConfirmCompletion,
      canRebook: status === 'CANCELLED',

      // Cancellation information
      cancellationReason: booking.cancellation_reason,
      cancelledById: booking.cancelled_by_id,

      // Completion information
      technicianCompletedAt: booking.technician_completed_at,
      technicianCompletedById: booking.technician_completed_by_id,
      completionConfirmedAt: booking.completion_confirmed_at,
      completionConfirmedById: booking.completion_confirmed_by_id,
    }
  }

  // Booking status history
  async timeline(userId, bookingId) {
    await this.owned(userId, bookingId)

    return this.repository.findTimeline(bookingId)
  }

  // Cancel booking
  async cancel(userId, bookingId, body = {}) {
    return this.transaction(async (db) => {
      const booking = await this.owned(
        userId,
        bookingId,
        db,
        true,
      )

      if (
        ![
          'PENDING',
          'TECHNICIAN_SELECTED',
        ].includes(booking.status)
      ) {
        throw new AppError(
          409,
          'BOOKING_CANNOT_BE_CANCELLED',
          'Không thể hủy booking ở trạng thái hiện tại.',
        )
      }

      const reason = String(body?.reason ?? '')
        .trim()
        .slice(0, 1000)

      const result = await this.repository.cancelBooking(
        userId,
        bookingId,
        reason,
        db,
      )

      if (!result) {
        throw new AppError(
          409,
          'BOOKING_CANCELLATION_FAILED',
          'Không thể hủy booking.',
        )
      }

      await this.repository.cancelPendingRequests(
        bookingId,
        db,
      )

      await this.repository.insertHistory(
        userId,
        bookingId,
        reason,
        db,
      )

      return result
    })
  }

  // Customer confirms technician completion
  async confirmCompletion(userId, bookingId) {
    return this.transaction(async (db) => {
      const booking = await this.owned(
        userId,
        bookingId,
        db,
        true,
      )

      if (
        booking.status === 'COMPLETED' ||
        booking.completion_confirmed_at
      ) {
        throw new AppError(
          409,
          'COMPLETION_ALREADY_CONFIRMED',
          'Booking đã được xác nhận hoàn thành.',
        )
      }

      if (
        booking.status === 'ACCEPTED' ||
        (
          booking.status === 'WAITING_CONFIRMATION' &&
          !booking.technician_completed_at
        )
      ) {
        throw new AppError(
          409,
          'TECHNICIAN_NOT_COMPLETED',
          'Kỹ thuật viên chưa hoàn thành công việc.',
        )
      }

      if (booking.status !== 'WAITING_CONFIRMATION') {
        throw new AppError(
          409,
          'COMPLETION_NOT_ALLOWED',
          'Không thể xác nhận hoàn thành ở trạng thái này.',
        )
      }

      const assignment =
        await this.repository.findAcceptedAssignment(
          bookingId,
          db,
        )

      if (!assignment) {
        throw new AppError(
          409,
          'TECHNICIAN_NOT_ASSIGNED',
          'Không tìm thấy kỹ thuật viên đã nhận việc.',
        )
      }

      const result =
        await this.repository.confirmCompletion(
          userId,
          bookingId,
          db,
        )

      if (!result || result.status !== 'COMPLETED') {
        throw new AppError(
          409,
          'BOOKING_COMPLETION_FAILED',
          'Không thể xác nhận hoàn thành công việc.',
        )
      }

      await this.repository.insertCompletionHistory(
        userId,
        bookingId,
        db,
      )

      await this.repository.notifyTechnician(
        assignment.technician_user_id,
        bookingId,
        result.booking_code,
        db,
      )

      return result
    })
  }
}
