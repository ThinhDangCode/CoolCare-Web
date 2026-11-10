import { isVerifiedTechnician, isActiveAccount } from './technician-status.js'
import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { ensureDefaultQuotation } from '../quotations/auto-quotation.js'
import { storageCode } from '../../config/database-codebooks.js'

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
      if (!isVerifiedTechnician(technician.verification_status)) {
        throw new AppError(403, 'TECHNICIAN_NOT_VERIFIED', 'Hồ sơ kỹ thuật viên chưa được xác minh.')
      }
      if (!technician.is_active || !isActiveAccount(technician.account_status)) {
        throw new AppError(403, 'TECHNICIAN_INACTIVE', 'Hồ sơ kỹ thuật viên hiện không hoạt động.')
      }

      await client.query('SELECT id FROM technician_accounts WHERE technician_id=$1 FOR UPDATE', [technician.id])

      const requestResult = await client.query(
        `SELECT bt.id,bt.booking_id,bt.status,b.status AS booking_status,b.booking_code,
                cp.user_id AS customer_user_id,b.scheduled_at
         FROM booking_technicians bt
         JOIN bookings b ON b.id=bt.booking_id
         JOIN customer_profiles cp ON cp.id=b.customer_id
         WHERE bt.id=$1 AND bt.technician_id=$2
         FOR UPDATE OF bt,b`,
        [requestId, technician.id],
      )
      const job = requestResult.rows[0]
      if (!job) throw new AppError(404, 'JOB_REQUEST_NOT_FOUND', 'Không tìm thấy công việc của kỹ thuật viên.')
      if (storageCode('booking_technicians', 'status', job.status) === 6 ||
          storageCode('bookings', 'status', job.booking_status) === 9) {
        throw new AppError(409, 'JOB_ALREADY_COMPLETED', 'Công việc đã được hoàn thành trước đó.')
      }
      if (storageCode('booking_technicians', 'status', job.status) !== 2 ||
          storageCode('bookings', 'status', job.booking_status) !== 2) {
        throw new AppError(409, 'JOB_CANNOT_BE_COMPLETED', 'Chỉ công việc đang thực hiện mới có thể được hoàn thành.')
      }

      // An accepted job cannot be completed without a real departure and
      // GPS-verified arrival. Do not fabricate travel events on completion.
      const travelEvidence = await client.query(
        `SELECT
           bool_or(note=$2) AS departed,
           bool_or(note=$3) AS arrived
         FROM booking_status_history WHERE booking_id=$1`,
        [job.booking_id,
         'COOLCARE_TRAVEL_V1:{"event":"DEPARTED"}',
         'COOLCARE_TRAVEL_V1:{"event":"ARRIVED"}'],
      )
      if (!travelEvidence.rows[0]?.departed || !travelEvidence.rows[0]?.arrived) {
        throw new AppError(409, 'ARRIVAL_CONFIRMATION_REQUIRED',
          'Phải bắt đầu di chuyển và xác nhận Đã đến nơi trước khi hoàn thành công việc.')
      }

      // Arrival alone is not permission to work more than 15 minutes early.
      // Check at completion as a final safety gate; the UI uses the same threshold.
      if (job.scheduled_at && Date.now() < new Date(job.scheduled_at).getTime() - 15 * 60000) {
        const approval = await client.query(
          `SELECT 1 FROM booking_status_history
           WHERE booking_id=$1 AND note=$2 LIMIT 1`,
          [job.booking_id, 'COOLCARE_TRAVEL_V1:{"event":"EARLY_APPROVED"}'],
        )
        if (!approval.rowCount) {
          throw new AppError(409, 'EARLY_START_APPROVAL_REQUIRED',
            'Còn hơn 15 phút đến giờ hẹn. Cần khách xác nhận bắt đầu sớm hoặc chờ đến ngưỡng 15 phút.')
        }
      }

      const outstanding = await client.query(
        `SELECT 1 FROM quotations WHERE booking_id=$1 AND status IN (0,1) LIMIT 1`,
        [job.booking_id],
      )
      if (outstanding.rowCount) {
        throw new AppError(409, 'OUTSTANDING_QUOTATION', 'Cần xử lý báo giá đang chờ trước khi KTV hoàn thành.')
      }

      const initialQuotation = await ensureDefaultQuotation(
        client,
        job.booking_id,
        technician.id,
      )

      const bookingResult = await client.query(
        `UPDATE bookings
         SET technician_completed_by_id=$2,
             technician_completed_at=CURRENT_TIMESTAMP,
             status=8,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND status=2
         RETURNING id,booking_code,status,subtotal,discount_amount,total_amount,completed_at,updated_at`,
        [job.booking_id, technician.user_id],
      )
      const booking = bookingResult.rows[0]
      if (!booking || storageCode('bookings', 'status', booking.status) !== 8) throw unavailable()

      await client.query(
        `INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
         VALUES($1,8,$2,'Kỹ thuật viên đã hoàn thành công việc và đang chờ khách hàng xác nhận.')`,
        [job.booking_id, technician.user_id],
      )
      await client.query(
        `INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
         VALUES($1,0,'Hóa đơn dịch vụ và xác nhận hoàn thành',$2,'BOOKING',$3)`,
        [
          job.customer_user_id,
          `Kỹ thuật viên đã hoàn thành booking ${job.booking_code}. Tổng tiền dịch vụ: ${Number(booking.total_amount).toLocaleString('vi-VN')}đ. Vui lòng kiểm tra hóa đơn và xác nhận hoàn thành.`,
          job.booking_id,
        ],
      )

      return {
        id: job.id,
        booking_id: job.booking_id,
        status: job.status,
        booking,
        initial_quotation: initialQuotation,
      }
    })
  }
}

const unavailable = () => new AppError(
  409,
  'JOB_COMPLETION_FAILED',
  'Không thể hoàn thành công việc ở trạng thái hiện tại. Vui lòng tải lại và thử lại.',
)
