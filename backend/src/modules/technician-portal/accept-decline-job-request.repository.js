import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'

export class AcceptDeclineJobRequestRepository {
  constructor({ transaction = withTransaction } = {}) {
    this.transaction = transaction
  }

  async respond(userId, requestId, input) {
    return this.transaction(async (client) => {
      const technicianResult = await client.query(
        `SELECT tp.id, tp.user_id, tp.verification_status, tp.is_active, tp.availability_status,
                u.status AS account_status
         FROM technician_profiles tp
         JOIN users u ON u.id=tp.user_id
         WHERE tp.user_id=$1
         FOR UPDATE OF tp,u`,
        [userId],
      )
      const technician = technicianResult.rows[0]
      if (!technician) {
        throw new AppError(403, 'TECHNICIAN_PROFILE_REQUIRED', 'Tài khoản chưa có hồ sơ kỹ thuật viên.')
      }
      if (technician.verification_status !== 'VERIFIED') {
        throw new AppError(403, 'TECHNICIAN_NOT_VERIFIED', 'Hồ sơ kỹ thuật viên chưa được xác minh.')
      }
      if (!technician.is_active || technician.account_status !== 'ACTIVE') {
        throw new AppError(403, 'TECHNICIAN_INACTIVE', 'Hồ sơ kỹ thuật viên hiện không hoạt động.')
      }

      // Keep the lock order consistent with database job-eligibility triggers.
      await client.query(
        'SELECT id FROM technician_accounts WHERE technician_id=$1 FOR UPDATE',
        [technician.id],
      )

      const requestResult = await client.query(
        `SELECT bt.id,bt.booking_id,bt.status,bt.expires_at,
                (bt.expires_at IS NOT NULL AND bt.expires_at<=CURRENT_TIMESTAMP) AS expired,
                b.status AS booking_status,
                b.booking_code,cp.user_id AS customer_user_id
         FROM booking_technicians bt
         JOIN bookings b ON b.id=bt.booking_id
         JOIN customer_profiles cp ON cp.id=b.customer_id
         WHERE bt.id=$1 AND bt.technician_id=$2
         FOR UPDATE OF bt,b`,
        [requestId, technician.id],
      )
      const jobRequest = requestResult.rows[0]
      if (!jobRequest) {
        throw new AppError(404, 'JOB_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu công việc của kỹ thuật viên.')
      }
      if (jobRequest.status !== 'SELECTED') {
        throw new AppError(409, 'JOB_REQUEST_ALREADY_RESPONDED', 'Yêu cầu công việc đã được phản hồi hoặc không còn hoạt động.')
      }
      if (jobRequest.expired) {
        throw new AppError(409, 'JOB_REQUEST_EXPIRED', 'Đã quá thời hạn phản hồi yêu cầu công việc.')
      }
      if (jobRequest.booking_status !== 'TECHNICIAN_SELECTED') {
        throw new AppError(409, 'JOB_REQUEST_UNAVAILABLE', 'Booking không còn khả dụng để phản hồi.')
      }

      return input.action === 'ACCEPT'
        ? this._accept(client, technician, jobRequest)
        : this._decline(client, technician, jobRequest, input.reason)
    })
  }

  async _accept(client, technician, jobRequest) {
    const activeJob = await client.query(
      `SELECT EXISTS(
         SELECT 1 FROM booking_technicians
         WHERE technician_id=$1 AND status='ACCEPTED'
       ) AS exists`,
      [technician.id],
    )
    if (activeJob.rows[0]?.exists) {
      throw new AppError(
        409,
        'TECHNICIAN_ACTIVE_JOB_CONFLICT',
        'Kỹ thuật viên đang có một công việc đã nhận và không thể nhận thêm yêu cầu mới.',
      )
    }

    const eligibility = await client.query(
      'SELECT can_recommend_technician($1) AS allowed',
      [technician.id],
    )
    if (!eligibility.rows[0]?.allowed) {
      throw new AppError(409, 'TECHNICIAN_CANNOT_ACCEPT_JOB', 'Kỹ thuật viên hiện không đủ điều kiện nhận công việc mới.')
    }

    const assignment = await client.query(
      `UPDATE booking_technicians
       SET status='ACCEPTED',responded_at=CURRENT_TIMESTAMP,decline_reason=NULL
       WHERE id=$1 AND technician_id=$2 AND status='SELECTED'
       RETURNING id,booking_id,status,responded_at`,
      [jobRequest.id, technician.id],
    )
    if (!assignment.rows.length) throw unavailable()

    const booking = await client.query(
      `UPDATE bookings SET status='ACCEPTED',updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND status='TECHNICIAN_SELECTED'
       RETURNING id,booking_code,status,updated_at`,
      [jobRequest.booking_id],
    )
    if (!booking.rows.length) throw unavailable()

    await client.query(
      `INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
       VALUES($1,'ACCEPTED',$2,'Kỹ thuật viên đã chấp nhận yêu cầu công việc.')`,
      [jobRequest.booking_id, technician.user_id],
    )
    await this._notifyCustomer(
      client,
      jobRequest,
      'Kỹ thuật viên đã nhận công việc',
      `Yêu cầu cho booking ${jobRequest.booking_code} đã được kỹ thuật viên chấp nhận.`,
    )

    return { ...assignment.rows[0], booking: booking.rows[0] }
  }

  async _decline(client, technician, jobRequest, reason) {
    const assignment = await client.query(
      `UPDATE booking_technicians
       SET status='DECLINED',responded_at=CURRENT_TIMESTAMP,decline_reason=$3
       WHERE id=$1 AND technician_id=$2 AND status='SELECTED'
       RETURNING id,booking_id,status,responded_at,decline_reason`,
      [jobRequest.id, technician.id, reason],
    )
    if (!assignment.rows.length) throw unavailable()

    const cancellationReason = reason
      ? `Kỹ thuật viên từ chối công việc: ${reason}`
      : 'Kỹ thuật viên đã từ chối yêu cầu công việc.'
    const booking = await client.query(
      `UPDATE bookings SET status='CANCELLED',cancelled_at=CURRENT_TIMESTAMP,
         cancelled_by_id=$2,cancellation_reason=$3,updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 AND status='TECHNICIAN_SELECTED'
       RETURNING id,booking_code,status,updated_at`,
      [jobRequest.booking_id, technician.user_id, cancellationReason],
    )
    if (!booking.rows.length) throw unavailable()

    await client.query(
      `INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
       VALUES($1,'CANCELLED',$2,$3)`,
      [jobRequest.booking_id, technician.user_id,
        cancellationReason],
    )
    await this._notifyCustomer(
      client,
      jobRequest,
      'Kỹ thuật viên đã từ chối công việc',
      `Yêu cầu cho booking ${jobRequest.booking_code} đã bị từ chối. Bạn có thể chọn kỹ thuật viên khác.`,
    )

    return { ...assignment.rows[0], booking: booking.rows[0] }
  }

  async _notifyCustomer(client, jobRequest, title, message) {
    await client.query(
      `INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
       VALUES($1,'BOOKING',$2,$3,'BOOKING',$4)`,
      [jobRequest.customer_user_id, title, message, jobRequest.booking_id],
    )
  }
}

const unavailable = () => new AppError(409, 'JOB_REQUEST_UNAVAILABLE', 'Yêu cầu công việc không còn khả dụng. Vui lòng tải lại danh sách.')
