import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'

export class UpdateJobStatusRepository {
  constructor({ transaction = withTransaction } = {}) {
    this.transaction = transaction
  }

  async complete(userId, requestId) {
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
                cp.user_id AS customer_user_id
         FROM booking_technicians bt
         JOIN bookings b ON b.id=bt.booking_id
         JOIN customer_profiles cp ON cp.id=b.customer_id
         WHERE bt.id=$1 AND bt.technician_id=$2
         FOR UPDATE OF bt,b`,
        [requestId, technician.id],
      )
      const job = requestResult.rows[0]
      if (!job) throw new AppError(404, 'JOB_REQUEST_NOT_FOUND', 'Không tìm thấy công việc của kỹ thuật viên.')
      if (job.status === 'COMPLETED' || job.booking_status === 'COMPLETED') {
        throw new AppError(409, 'JOB_ALREADY_COMPLETED', 'Công việc đã được hoàn thành trước đó.')
      }
      if (job.status !== 'ACCEPTED' || job.booking_status !== 'ACCEPTED') {
        throw new AppError(409, 'JOB_CANNOT_BE_COMPLETED', 'Chỉ công việc đang thực hiện mới có thể được hoàn thành.')
      }

      const bookingResult = await client.query(
        `UPDATE bookings
         SET technician_completed_by_id=$2,
             technician_completed_at=CURRENT_TIMESTAMP,
             status='WAITING_CONFIRMATION',
             updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND status='ACCEPTED'
         RETURNING id,booking_code,status,completed_at,updated_at`,
        [job.booking_id, technician.user_id],
      )
      const booking = bookingResult.rows[0]
      if (!booking || booking.status !== 'WAITING_CONFIRMATION') throw unavailable()

      await client.query(
        `INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
         VALUES($1,'WAITING_CONFIRMATION',$2,'Kỹ thuật viên đã hoàn thành công việc và đang chờ khách hàng xác nhận.')`,
        [job.booking_id, technician.user_id],
      )
      await client.query(
        `INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
         VALUES($1,'BOOKING','Xác nhận hoàn thành công việc',$2,'BOOKING',$3)`,
        [job.customer_user_id, `Kỹ thuật viên đã hoàn thành booking ${job.booking_code}. Vui lòng xác nhận hoàn thành.`, job.booking_id],
      )

      return {
        id: job.id,
        booking_id: job.booking_id,
        status: job.status,
        booking,
      }
    })
  }
}

const unavailable = () => new AppError(
  409,
  'JOB_COMPLETION_FAILED',
  'Không thể hoàn thành công việc ở trạng thái hiện tại. Vui lòng tải lại và thử lại.',
)
