import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler, AppError, validateUuid } from '../../utils.js'
import { withTransaction } from '../../config/database.js'

export function createComplaintRouter(controller) {
  const router = Router()
  router.use(authenticate, requireRole('ADMIN'))
  router.get('/', asyncHandler(controller.list))
  router.get('/:id', asyncHandler(controller.get))
  router.patch('/:id/resolve', asyncHandler(controller.resolve))
  // Admin-confirmed no-show reassigns the ORIGINAL booking, not a customer cancellation.
  // The same booking row lock is used by travel arrival to prevent concurrent arrival/reassignment.
  router.post('/:id/reassign-technician', asyncHandler(async (req, res) => {
    const complaintId = validateUuid(req.params.id)
    const nextAt = new Date(req.body?.scheduledAt)
    if (!Number.isFinite(nextAt.getTime()) || nextAt.getTime() <= Date.now()) {
      throw new AppError(422, 'INVALID_REASSIGNMENT', 'Cần chọn giờ hẹn mới trong tương lai trước khi đổi thợ.')
    }
    const result = await withTransaction(async db => {
      const owner = await db.query(`SELECT cp.user_id FROM complaints c JOIN bookings b ON b.id=c.booking_id
        JOIN customer_profiles cp ON cp.id=b.customer_id WHERE c.id=$1`, [complaintId])
      if (owner.rows[0]) await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [owner.rows[0].user_id])
      const { rows } = await db.query(`SELECT c.id,c.booking_id,c.technician_id,c.status,
          b.status AS booking_status,b.booking_code,b.customer_id,b.scheduled_at,b.technician_completed_at,
          cp.user_id AS customer_user_id,tp.user_id AS technician_user_id
        FROM complaints c JOIN bookings b ON b.id=c.booking_id
        JOIN customer_profiles cp ON cp.id=b.customer_id
        JOIN technician_profiles tp ON tp.id=c.technician_id
        WHERE c.id=$1 AND c.type='TECHNICIAN' AND c.subject='Technician did not arrive'
        FOR UPDATE OF c,b`, [complaintId])
      const item = rows[0]
      if (!item) throw new AppError(404, 'NO_SHOW_REPORT_NOT_FOUND', 'Không tìm thấy báo cáo thợ không đến.')
      if (!['OPEN','IN_PROGRESS'].includes(item.status) || item.booking_status !== 'ACCEPTED' || item.technician_completed_at) {
        throw new AppError(409, 'REASSIGNMENT_NOT_ALLOWED', 'Booking không còn đủ điều kiện đổi thợ.')
      }
      if (Date.now() < new Date(item.scheduled_at).getTime() + 30 * 60000) {
        throw new AppError(409, 'NO_SHOW_TOO_EARLY', 'Chỉ xử lý đổi thợ khi quá giờ hẹn ít nhất 30 phút.')
      }
      const arrival = await db.query(`SELECT 1 FROM booking_status_history WHERE booking_id=$1
        AND note LIKE 'COOLCARE_TRAVEL_V1:%ARRIVED%'
        AND created_at >= (SELECT MAX(bt.responded_at) FROM booking_technicians bt WHERE bt.booking_id=$1 AND bt.status=2) LIMIT 1`, [item.booking_id])
      if (arrival.rowCount) throw new AppError(409, 'TECHNICIAN_ALREADY_ARRIVED', 'Thợ đã xác nhận đến nơi. Cần xử lý tranh chấp, không đổi tự động.')
      const extra = await db.query(`SELECT 1 FROM quotations
        WHERE booking_id=$1 AND quotation_type='ADDITIONAL' LIMIT 1`, [item.booking_id])
      if (extra.rowCount) throw new AppError(409, 'WORK_ALREADY_QUOTED', 'Đơn có báo giá phát sinh, cần xử lý tranh chấp trước.')
      if (nextAt.getTime() <= Date.now()) throw new AppError(422, 'INVALID_REASSIGNMENT', 'Giờ hẹn mới đã hết hạn.')
      const overlap = await db.query(`SELECT 1 FROM bookings b WHERE b.customer_id=$1 AND b.id<>$2
        AND b.status IN ('PENDING','TECHNICIAN_SELECTED','ACCEPTED')
        AND (b.status='ACCEPTED' OR b.scheduled_at>clock_timestamp())
        AND b.scheduled_at BETWEEN $3::timestamptz - INTERVAL '30 minutes' AND $3::timestamptz + INTERVAL '30 minutes' LIMIT 1`,
        [item.customer_id,item.booking_id,nextAt.toISOString()])
      if (overlap.rowCount) throw new AppError(409, 'OVERLAPPING_BOOKING', 'Khách đã có đơn đang hoạt động gần giờ này.')
      const paid = await db.query(`SELECT 1 FROM payments WHERE booking_id=$1 AND payment_status='SUCCESS' LIMIT 1`, [item.booking_id])
      if (paid.rowCount) throw new AppError(409, 'PAYMENT_REVIEW_REQUIRED', 'Đơn đã thanh toán, cần xử lý tiền trước khi đổi thợ.')
      const assignment = await db.query(`UPDATE booking_technicians
        SET status='CANCELLED',cancelled_at=CURRENT_TIMESTAMP,
            cancellation_reason='Admin xác nhận thợ không đến; cho khách chọn lại'
        WHERE booking_id=$1 AND technician_id=$2 AND status='ACCEPTED' RETURNING id`,
        [item.booking_id,item.technician_id])
      if (assignment.rowCount !== 1) throw new AppError(409, 'ASSIGNMENT_CHANGED', 'Thợ được phân công đã thay đổi.')
      await db.query(`UPDATE bookings SET status='PENDING',scheduled_at=$2,updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND status='ACCEPTED'`, [item.booking_id,nextAt.toISOString()])
      await db.query(`INSERT INTO booking_status_history(booking_id,status,changed_by_id,note)
        VALUES($1,'PENDING',$2,$3)`, [item.booking_id,req.auth.userId,`Admin xác minh thợ không đến; lịch cũ: ${new Date(item.scheduled_at).toISOString()}; lịch mới: ${nextAt.toISOString()}.`])
      await db.query(`UPDATE complaints SET status='RESOLVED',resolution=$2,
        resolved_by_id=$3,resolved_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [complaintId,'Đã xác minh không đến; giải phóng thợ cũ và mở chọn lại thợ trên booking hiện tại.',req.auth.userId])
      await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
        VALUES($1,'BOOKING','Được chọn thợ khác',$2,'BOOKING',$3),
              ($4,'BOOKING','Đơn đã được chuyển thợ',$5,'BOOKING',$3)`,
        [item.customer_user_id,`Booking ${item.booking_code}: bạn có thể chọn thợ khác.`,item.booking_id,
          item.technician_user_id,`Booking ${item.booking_code}: Admin đã xác minh báo cáo không đến.`])
      return { booking_id:item.booking_id,booking_status:'PENDING',complaint_status:'RESOLVED',scheduled_at:nextAt.toISOString(),can_select_technician:true }
    })
    res.json({ data: result })
  }))

  router.post('/:id/compensation-voucher', asyncHandler(controller.createCompensationVoucher))
  return router
}

export function createCustomerComplaintRouter(controller) {
  const router = Router()
  router.use(authenticate, requireRole('CUSTOMER'))
  router.get('/', asyncHandler(controller.listMine))
  router.post('/', asyncHandler(controller.submit))
  router.get('/:id', asyncHandler(controller.getMine))
  return router
}
