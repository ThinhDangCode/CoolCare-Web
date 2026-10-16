import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'

const LATE_CANCELLATION_POINTS = 10

export class CancelAcceptedJobRepository {
  constructor({ transaction = withTransaction } = {}) {
    this.transaction = transaction
  }

  async cancel(userId, requestId, reason) {
    return this.transaction(async (client) => {
      const technicianResult = await client.query(
        `SELECT tp.id,tp.user_id,tp.verification_status,tp.is_active,u.status AS account_status
         FROM technician_profiles tp
         JOIN users u ON u.id=tp.user_id
         WHERE tp.user_id=$1
         FOR UPDATE OF tp,u`,
        [userId],
      )
      const technician = technicianResult.rows[0]
      if (!technician) throw new AppError(403, 'TECHNICIAN_PROFILE_REQUIRED', 'Tài khoản chưa có hồ sơ kỹ thuật viên.')
      if (technician.verification_status !== 'VERIFIED') {
        throw new AppError(403, 'TECHNICIAN_NOT_VERIFIED', 'Hồ sơ kỹ thuật viên chưa được xác minh.')
      }
      if (!technician.is_active || technician.account_status !== 'ACTIVE') {
        throw new AppError(403, 'TECHNICIAN_INACTIVE', 'Hồ sơ kỹ thuật viên hiện không hoạt động.')
      }

      await client.query('SELECT id FROM technician_accounts WHERE technician_id=$1 FOR UPDATE', [technician.id])
      const requestResult = await client.query(
        `SELECT bt.id,bt.booking_id,bt.status,b.status AS booking_status,b.booking_code,
                b.scheduled_at,b.technician_completed_at,cp.user_id AS customer_user_id,
                (b.scheduled_at<=CURRENT_TIMESTAMP+INTERVAL '24 hours') AS penalty_applies
         FROM booking_technicians bt
         JOIN bookings b ON b.id=bt.booking_id
         JOIN customer_profiles cp ON cp.id=b.customer_id
         WHERE bt.id=$1 AND bt.technician_id=$2
         FOR UPDATE OF bt,b`,
        [requestId, technician.id],
      )
      const job = requestResult.rows[0]
      if (!job) throw new AppError(404, 'JOB_REQUEST_NOT_FOUND', 'Không tìm thấy công việc của kỹ thuật viên.')
      if (job.technician_completed_at || job.booking_status === 'WAITING_CONFIRMATION') {
        throw new AppError(409, 'JOB_COMPLETION_ALREADY_SUBMITTED', 'Công việc đã gửi xác nhận hoàn thành và không thể hủy.')
      }
      if (job.status !== 'ACCEPTED' || job.booking_status !== 'ACCEPTED') {
        throw new AppError(409, 'ACCEPTED_JOB_CANNOT_BE_CANCELLED', 'Chỉ công việc đã nhận và đang thực hiện mới có thể hủy.')
      }

      const assignmentResult = await client.query(
        `UPDATE booking_technicians
         SET status='CANCELLED',cancelled_at=CURRENT_TIMESTAMP,cancellation_reason=$3
         WHERE id=$1 AND technician_id=$2 AND status='ACCEPTED'
         RETURNING id,booking_id,status,cancelled_at,cancellation_reason`,
        [job.id, technician.id, reason],
      )
      if (!assignmentResult.rows.length) throw unavailable()

      const cancellationReason = `Kỹ thuật viên hủy công việc đã nhận: ${reason}`
      const bookingResult = await client.query(
        `UPDATE bookings
         SET status='CANCELLED',cancelled_at=CURRENT_TIMESTAMP,cancelled_by_id=$2,
             cancellation_reason=$3,updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND status='ACCEPTED' AND technician_completed_at IS NULL
         RETURNING id,booking_code,status,cancelled_at,cancellation_reason,updated_at`,
        [job.booking_id, technician.user_id, cancellationReason],
      )
      const booking = bookingResult.rows[0]
      if (!booking) throw unavailable()

      await client.query(
        `INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
         VALUES($1,'CANCELLED',$2,$3)`,
        [job.booking_id, technician.user_id, cancellationReason],
      )
      await client.query(
        `INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
         VALUES($1,'BOOKING','Kỹ thuật viên đã hủy công việc',$2,'BOOKING',$3)`,
        [job.customer_user_id, `Booking ${job.booking_code} đã bị kỹ thuật viên hủy. Bạn có thể đặt lại dịch vụ.`, job.booking_id],
      )

      let penalty = null
      if (job.penalty_applies) {
        const penaltyResult = await client.query(
          `INSERT INTO technician_penalties(
             technician_id,booking_id,penalty_type,penalty_points,reason,status,applied_at,expires_at
           ) VALUES($1,$2,'CANCELLATION',$3,$4,'ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+INTERVAL '30 days')
           RETURNING id,penalty_type,penalty_points,status,applied_at,expires_at`,
          [technician.id, job.booking_id, LATE_CANCELLATION_POINTS, reason],
        )
        penalty = penaltyResult.rows[0] ?? null
      }

      return { ...assignmentResult.rows[0], booking, penalty }
    })
  }
}

const unavailable = () => new AppError(
  409,
  'ACCEPTED_JOB_CANCELLATION_FAILED',
  'Không thể hủy công việc ở trạng thái hiện tại. Vui lòng tải lại và thử lại.',
)
