
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

  // Customer-initiated reassignment; no complaint or Admin approval.
  async changeLateTechnician(userId, bookingId, body = {}) {
    const reason = String(body.reason ?? '').trim()
    const nextAt = new Date(body.scheduledAt)
    if (reason.length < 10 || reason.length > 1000 ||
        !Number.isFinite(nextAt.getTime()) || nextAt.getTime() <= Date.now()) {
      throw new AppError(422, 'INVALID_REASSIGNMENT', 'Nhập lý do từ 10 ký tự và chọn lịch mới trong tương lai.')
    }
    return this.transaction(async db => {
      const booking = await this.owned(userId, bookingId, db, true)
      if (booking.status !== 'ACCEPTED' || booking.technician_completed_at ||
          Date.now() < new Date(booking.scheduled_at).getTime() + 30 * 60000) {
        throw new AppError(409, 'NO_SHOW_NOT_ELIGIBLE', 'Chỉ đổi thợ sau 30 phút khi công việc chưa bắt đầu.')
      }
      const arrival = await db.query(`SELECT 1 FROM booking_status_history
        WHERE booking_id=$1 AND note LIKE 'COOLCARE_TRAVEL_V1:%ARRIVED%' LIMIT 1`, [bookingId])
      if (arrival.rowCount) throw new AppError(409, 'TECHNICIAN_ALREADY_ARRIVED', 'Thợ đã xác nhận đến nơi.')
      const quotation = await db.query(`SELECT 1 FROM quotations WHERE booking_id=$1
        AND quotation_type='ADDITIONAL' LIMIT 1`, [bookingId])
      if (quotation.rowCount) throw new AppError(409, 'WORK_ALREADY_QUOTED', 'Đơn đã có báo giá phát sinh.')
      const paid = await db.query(`SELECT 1 FROM payments WHERE booking_id=$1
        AND payment_status='SUCCESS' LIMIT 1`, [bookingId])
      if (paid.rowCount) throw new AppError(409, 'PAYMENT_REVIEW_REQUIRED', 'Đơn đã thanh toán, cần xử lý tiền trước khi đổi thợ.')
      const assignment = await this.repository.findAcceptedAssignment(bookingId, db)
      if (!assignment) throw new AppError(409, 'ASSIGNMENT_CHANGED', 'Phân công đã thay đổi.')
      const update = await db.query(`UPDATE booking_technicians
        SET status='CANCELLED',cancelled_at=NOW(),cancellation_reason=$2
        WHERE id=$1 AND status='ACCEPTED' RETURNING id`,
        [assignment.id, `Khách đổi thợ sau 30 phút: ${reason}`])
      if (!update.rowCount) throw new AppError(409, 'ASSIGNMENT_CHANGED', 'Phân công đã thay đổi.')
      await db.query(`UPDATE bookings SET status='PENDING',scheduled_at=$2,updated_at=NOW()
        WHERE id=$1 AND status='ACCEPTED'`, [bookingId, nextAt.toISOString()])
      await db.query(`INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
        VALUES($1,'PENDING',$2,$3)`, [bookingId, userId,
          `Đổi thợ do báo không đến sau 30 phút; lịch cũ: ${new Date(booking.scheduled_at).toISOString()}; lịch mới: ${nextAt.toISOString()}; thợ cũ: ${assignment.technician_id}; lý do: ${reason}`])
      // The unique assignment transition under booking lock makes this penalty idempotent.
      await db.query(`INSERT INTO technician_penalties
        (technician_id,booking_id,penalty_type,penalty_points,reason,status,applied_at,expires_at)
        VALUES($1,$2,'LATE_HANDLING',2,$3,'ACTIVE',NOW(),NULL)`,
        [assignment.technician_id,bookingId,`Khách đổi thợ sau 30 phút: ${reason}`])
      await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
        VALUES($1,'BOOKING','Đã thu hồi công việc',$2,'BOOKING',$3)`,
        [assignment.technician_user_id,`Booking ${booking.booking_code}: khách đã đổi thợ sau 30 phút; hệ thống ghi nhận 2 điểm phạt.`,bookingId])
      return { bookingId, status:'PENDING', scheduledAt:nextAt.toISOString(), penaltyPoints:2 }
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
    const noShowEligibility = status === 'ACCEPTED' ? (await this.repository.db.query(`
      SELECT EXISTS (SELECT 1 FROM booking_status_history
        WHERE booking_id=$1 AND note LIKE 'COOLCARE_TRAVEL_V1:%ARRIVED%') AS arrived
    `, [bookingId])).rows[0] : null
    const canReportNoShow = status === 'ACCEPTED' &&
      Date.now() >= new Date(booking.scheduled_at).getTime() + 30 * 60000 &&
      noShowEligibility?.arrived === false

    const canCancel = [
      'PENDING',
      'TECHNICIAN_SELECTED',
      'ACCEPTED',
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
      canReportNoShow,
      canChangeLateTechnician: canReportNoShow,
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
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId])
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
          'ACCEPTED',
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
      if (!reason) {
        throw new AppError(400, 'BOOKING_CANCELLATION_REASON_REQUIRED', 'Vui lòng nhập lý do hủy.')
      }

      // Paid bookings require a refund workflow, never silently cancel money.
      const paid = await db.query(`SELECT 1 FROM payments WHERE booking_id=$1
        AND payment_status='SUCCESS' LIMIT 1`, [bookingId])
      if (paid.rowCount) throw new AppError(409, 'PAYMENT_REVIEW_REQUIRED',
        'Đơn đã thanh toán; vui lòng liên hệ hỗ trợ để xử lý hoàn tiền.')
      const accepted = booking.status === 'ACCEPTED'
      const assignment = accepted ? await this.repository.findAcceptedAssignment(bookingId, db) : null
      if (accepted && !assignment) throw new AppError(409, 'ASSIGNMENT_CHANGED', 'Phân công đã thay đổi.')
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

      if (assignment) {
        await db.query(`UPDATE booking_technicians SET status='CANCELLED',
          cancelled_at=NOW(),cancellation_reason=$2 WHERE id=$1 AND status='ACCEPTED'`,
          [assignment.id, `Khách hủy: ${reason}`])
        await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
          VALUES($1,'BOOKING','Khách đã hủy đơn',$2,'BOOKING',$3)`,
          [assignment.technician_user_id,`Booking ${booking.booking_code} đã được khách hủy.`,bookingId])
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
      const count = await db.query(`SELECT COUNT(*)::int AS total FROM bookings b
        JOIN customer_profiles cp ON cp.id=b.customer_id
        WHERE cp.user_id=$1 AND b.status='CANCELLED' AND b.cancelled_by_id=$1
          AND b.cancelled_at >= NOW() - INTERVAL '24 hours'
          AND b.cancellation_reason NOT LIKE '[LATE_TECHNICIAN]%'`, [userId])
      if (count.rows[0].total === 3) await db.query(`INSERT INTO notifications
        (user_id,type,title,message,reference_type,reference_id)
        VALUES($1,'BOOKING','Cảnh báo hủy đơn',
          'Bạn đã hủy 3 đơn trong 24 giờ. Hủy 5 đơn sẽ tạm hạn chế đặt lịch.','BOOKING',$2)`,
        [userId,bookingId])

      if (count.rows[0].total === 5) await db.query(`INSERT INTO notifications
        (user_id,type,title,message,reference_type,reference_id)
        VALUES($1,'BOOKING','Tạm hạn chế đặt lịch',
          'Bạn đã hủy 5 đơn trong 24 giờ. Bạn chỉ có thể tạo đơn mới khi số đơn hủy trong 24 giờ gần nhất giảm xuống dưới 5. Các đơn hủy do thợ trễ không được tính.','BOOKING',$2)`,
        [userId,bookingId])

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
