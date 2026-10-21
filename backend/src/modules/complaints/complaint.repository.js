import { randomUUID } from 'node:crypto'
import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { writeAdminAudit } from '../audit/admin-audit.js'
import {
  enforcePenaltyBalance,
  lockPenaltyTechnician,
} from '../technicians/technician.points.js'
import { createComplaintCompensationCode } from './complaint-compensation-code.js'

const add = (values, value) => {
  values.push(value)
  return `$${values.length}`
}
const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&')

export class ComplaintRepository {
  constructor({ transaction = withTransaction, audit = writeAdminAudit } = {}) {
    this.transaction = transaction
    this.audit = audit
  }

  async listMine(userId, filters) {
    return this.transaction(async (client) => {
      const values = [userId]
      const statusClause = filters.status === 'ALL' ? '' : ` AND c.status=${add(values, filters.status)}`
      const total = (await client.query(
        `SELECT count(*)::int total FROM complaints c
         JOIN customer_profiles cp ON cp.id=c.customer_id
         WHERE cp.user_id=$1${statusClause}`,
        values
      )).rows[0].total
      const rows = await client.query(
        `SELECT c.id,c.complaint_code,c.booking_id,b.booking_code,c.status,
                c.type,c.subject,
                c.description,c.resolution,c.created_at,c.resolved_at
           FROM complaints c
           JOIN customer_profiles cp ON cp.id=c.customer_id
           JOIN bookings b ON b.id=c.booking_id
          WHERE cp.user_id=$1${statusClause}
          ORDER BY c.created_at DESC,c.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.limit, (filters.page - 1) * filters.limit]
      )
      return { items: rows.rows, total, page: filters.page, limit: filters.limit }
    })
  }

  async getMine(userId, id) {
    const row = await this.transaction(async (client) => (
      await client.query(
        `SELECT c.id,c.complaint_code,c.booking_id,b.booking_code,c.status,
                c.type,c.subject,
                c.description,c.resolution,c.created_at,c.resolved_at,
                tu.full_name technician_name
           FROM complaints c
           JOIN customer_profiles cp ON cp.id=c.customer_id
           JOIN bookings b ON b.id=c.booking_id
           LEFT JOIN technician_profiles tp ON tp.id=c.technician_id
           LEFT JOIN users tu ON tu.id=tp.user_id
          WHERE c.id=$1 AND cp.user_id=$2`,
        [id, userId]
      )
    ).rows[0])
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy khiếu nại.')
    return row
  }

  async submit(userId, data) {
    return this.transaction(async (client) => {
      const booking = (await client.query(
        `SELECT b.id,b.customer_id,
                (SELECT bt.technician_id FROM booking_technicians bt
                  WHERE bt.booking_id=b.id AND bt.status IN ('SELECTED','ACCEPTED','COMPLETED')
                  ORDER BY CASE bt.status WHEN 'COMPLETED' THEN 1 WHEN 'ACCEPTED' THEN 2 ELSE 3 END LIMIT 1) technician_id
           FROM bookings b JOIN customer_profiles cp ON cp.id=b.customer_id
          WHERE b.id=$1 AND cp.user_id=$2 FOR UPDATE OF b`,
        [data.booking_id, userId]
      )).rows[0]
      if (!booking)
        throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn dịch vụ thuộc tài khoản của bạn.')
      if (data.type === 'TECHNICIAN' && !booking.technician_id)
        throw new AppError(422, 'VALIDATION_ERROR', 'Đơn này chưa có kỹ thuật viên để khiếu nại.', {
          booking_id: 'Vui lòng chọn đơn đã có kỹ thuật viên.',
        })
      const duplicate = (await client.query(
        `SELECT id FROM complaints WHERE booking_id=$1 AND customer_id=$2
          AND status IN ('OPEN','IN_PROGRESS') LIMIT 1`,
        [booking.id, booking.customer_id]
      )).rows[0]
      if (duplicate)
        throw new AppError(409, 'ACTIVE_COMPLAINT_EXISTS', 'Đơn này đang có một khiếu nại được xử lý.')
      const id = randomUUID()
      const code = `CP-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 4).toUpperCase()}`
      const created = (await client.query(
        `INSERT INTO complaints
           (id,complaint_code,booking_id,customer_id,technician_id,type,subject,description,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN') RETURNING *`,
        [id, code, booking.id, booking.customer_id, booking.technician_id, data.type, data.subject, data.description]
      )).rows[0]
      return {
        ...created,
        type: data.type,
        subject: data.subject,
      }
    })
  }

  async list(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = []
      const clauses = []
      if (filters.search) {
        const term = add(values, `%${escapeLike(filters.search)}%`)
        clauses.push(
          `(c.complaint_code ILIKE ${term} OR c.subject ILIKE ${term} OR b.booking_code ILIKE ${term} OR cu.full_name ILIKE ${term})`
        )
      }
      if (filters.status !== 'ALL') clauses.push(`c.status=${add(values, filters.status)}`)
      if (filters.type !== 'ALL') clauses.push(`c.type=${add(values, filters.type)}`)
      const from =
        ' FROM (SELECT complaints.*,ROW_NUMBER() OVER(ORDER BY created_at ASC,id ASC)::int complaint_number FROM complaints) c JOIN bookings b ON b.id=c.booking_id JOIN customer_profiles cp ON cp.id=c.customer_id JOIN users cu ON cu.id=cp.user_id LEFT JOIN technician_profiles tp ON tp.id=c.technician_id LEFT JOIN users tu ON tu.id=tp.user_id LEFT JOIN users ru ON ru.id=c.resolved_by_id'
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const count = await client.query(`SELECT count(*)::int total${from}${where}`, values)
      const order =
        filters.sortBy === 'customer_name'
          ? `LOWER(cu.full_name) ${filters.sortOrder === 'asc' ? 'ASC' : 'DESC'},c.id ${filters.sortOrder === 'asc' ? 'ASC' : 'DESC'}`
          : `c.created_at ${filters.sortOrder === 'asc' ? 'ASC' : 'DESC'},c.id ${filters.sortOrder === 'asc' ? 'ASC' : 'DESC'}`
      const rows = await client.query(
        `SELECT c.*,b.booking_code,cu.full_name customer_name,cu.phone customer_phone,tu.full_name technician_name,ru.full_name resolved_by_name${from}${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.limit, (filters.page - 1) * filters.limit]
      )
      return {
        items: rows.rows,
        total: count.rows[0].total,
        page: filters.page,
        limit: filters.limit,
      }
    })
  }

  async get(id) {
    const row = await this.transaction(
      async (client) =>
        (
          await client.query(
            `SELECT c.*,b.booking_code,b.status booking_status,b.scheduled_at,b.service_address,b.ward,b.city,
              cu.full_name customer_name,cu.phone customer_phone,cu.email customer_email,
              tu.full_name technician_name,tu.phone technician_phone,tp.qualification_level technician_qualification,
              ru.full_name resolved_by_name,
              (SELECT p.id FROM technician_penalties p WHERE split_part(p.reason, ' ', 1) = '[COMPLAINT:' || c.id::text || ']') penalty_id,
              (SELECT p.penalty_points FROM technician_penalties p WHERE split_part(p.reason, ' ', 1) = '[COMPLAINT:' || c.id::text || ']') penalty_points,
              (SELECT p.expires_at FROM technician_penalties p WHERE split_part(p.reason, ' ', 1) = '[COMPLAINT:' || c.id::text || ']') penalty_expires_at,
              (SELECT string_agg(DISTINCT s.name, ', ' ORDER BY s.name) FROM booking_units bu
                JOIN booking_unit_services bus ON bus.booking_unit_id=bu.id JOIN services s ON s.id=bus.service_id
               WHERE bu.booking_id=b.id) service_names
         FROM (SELECT complaints.*,ROW_NUMBER() OVER(ORDER BY created_at ASC,id ASC)::int complaint_number FROM complaints) c
         JOIN bookings b ON b.id=c.booking_id JOIN customer_profiles cp ON cp.id=c.customer_id JOIN users cu ON cu.id=cp.user_id
         LEFT JOIN technician_profiles tp ON tp.id=c.technician_id LEFT JOIN users tu ON tu.id=tp.user_id
         LEFT JOIN users ru ON ru.id=c.resolved_by_id WHERE c.id=$1`,
            [id]
          )
        ).rows[0]
    )
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy khiếu nại.')
    return row
  }

  async resolve(id, data, actorId) {
    let auditEvent
    const row = await this.transaction(async (client) => {
      const before = (await client.query('SELECT * FROM complaints WHERE id=$1 FOR UPDATE', [id]))
        .rows[0]
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy khiếu nại.')
      if (before.status === 'CLOSED')
        throw new AppError(409, 'COMPLAINT_CLOSED', 'Khiếu nại đã đóng và không thể cập nhật thêm.')
      const transitions = {
        OPEN: ['OPEN', 'IN_PROGRESS'],
        IN_PROGRESS: ['IN_PROGRESS', 'RESOLVED', 'REJECTED'],
        RESOLVED: ['RESOLVED', 'CLOSED'],
        REJECTED: ['REJECTED', 'CLOSED'],
      }
      if (!transitions[before.status]?.includes(data.status))
        throw new AppError(
          409,
          'INVALID_STATUS_TRANSITION',
          `Không thể chuyển trạng thái khiếu nại từ ${before.status} sang ${data.status}.`
        )
      if (data.is_draft && data.status !== before.status)
        throw new AppError(
          409,
          'INVALID_DRAFT_STATUS',
          'Bản nháp không được thay đổi trạng thái khiếu nại.'
        )
      const existingPenalty = (
        await client.query(
          `SELECT id,penalty_points,expires_at,status
             FROM technician_penalties
            WHERE split_part(reason, ' ', 1) = '[COMPLAINT:' || $1::text || ']'
            FOR UPDATE`,
          [id]
        )
      ).rows[0]
      const applyPenalty =
        !data.is_draft &&
        data.status === 'RESOLVED' &&
        ['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(before.status) &&
        !existingPenalty &&
        Boolean(before.technician_id || before.type === 'TECHNICIAN')
      if (applyPenalty && !before.technician_id)
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'No technician is linked to this complaint.'
        )
      if (
        (applyPenalty || data.penalty_expires_at !== undefined) &&
        (typeof data.penalty_expires_at !== 'string' ||
          !Number.isFinite(Date.parse(data.penalty_expires_at)) ||
          Date.parse(data.penalty_expires_at) <= Date.now() ||
          data.is_draft ||
          data.status !== 'RESOLVED' ||
          (!applyPenalty &&
            (!existingPenalty ||
              existingPenalty.status !== 'ACTIVE' ||
              (existingPenalty.expires_at &&
                new Date(existingPenalty.expires_at).getTime() !==
                  Date.parse(data.penalty_expires_at)))))
      )
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'Choose a future expiry for a new penalty or an active penalty without an expiry.'
        )
      if (
        applyPenalty &&
        (!Number.isInteger(data.penalty_points) ||
          data.penalty_points < 1 ||
          data.penalty_points > 12)
      )
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'Enter positive whole-number penalty points.',
          {
            penalty_points:
              'Penalty points are required when accepting a complaint with a linked technician.',
          }
        )
      if (
        data.penalty_points !== undefined &&
        !applyPenalty &&
        (data.is_draft ||
          data.status !== 'RESOLVED' ||
          existingPenalty?.penalty_points !== data.penalty_points)
      )
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'Penalty points can only be applied when accepting a complaint.'
        )
      const terminal = ['RESOLVED', 'REJECTED', 'CLOSED'].includes(data.status)
      const after = (
        await client.query(
          'UPDATE complaints SET status=$1,resolution=$2,resolved_by_id=$3,resolved_at=$4 WHERE id=$5 RETURNING *',
          [data.status, data.resolution, actorId, terminal ? new Date() : null, id]
        )
      ).rows[0]
      if (applyPenalty) {
        const technician = await lockPenaltyTechnician(client, before.technician_id)
        const penalty = (
          await client.query(
            `INSERT INTO technician_penalties
               (technician_id,booking_id,penalty_type,penalty_points,reason,status,applied_at,expires_at)
             VALUES ($1,$2,'RULE_VIOLATION',$3,$4,'ACTIVE',CURRENT_TIMESTAMP,$5)
             RETURNING id,penalty_points,expires_at`,
            [
              before.technician_id,
              before.booking_id,
              data.penalty_points,
              `[COMPLAINT:${id}] ${before.complaint_code}: ${data.resolution}`,
              data.penalty_expires_at,
            ]
          )
        ).rows[0]
        after.penalty_id = penalty.id
        after.penalty_points = penalty.penalty_points
        after.penalty_expires_at = penalty.expires_at
        after.remaining_points = await enforcePenaltyBalance(client, technician)
      }
      if (!applyPenalty && existingPenalty) {
        if (data.penalty_expires_at !== undefined) {
          await client.query('UPDATE technician_penalties SET expires_at=$1 WHERE id=$2', [
            data.penalty_expires_at,
            existingPenalty.id,
          ])
          existingPenalty.expires_at = data.penalty_expires_at
        }
        after.penalty_id = existingPenalty.id
        after.penalty_points = existingPenalty.penalty_points
        after.penalty_expires_at = existingPenalty.expires_at
      }
      if (data.notify_customer && !data.is_draft)
        await client.query(
          `INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id) SELECT cp.user_id,'COMPLAINT','Complaint status updated',$2,'COMPLAINT',$1::text FROM complaints c JOIN customer_profiles cp ON cp.id=c.customer_id WHERE c.id=$1::uuid`,
          [id, `Your complaint is now ${data.status.toLowerCase().replace('_', ' ')}.`]
        )
      auditEvent = {
        actorId,
        action:
          before.status === data.status ? 'SAVE_COMPLAINT_RESOLUTION_DRAFT' : 'RESOLVE_COMPLAINT',
        entityType: 'COMPLAINT',
        entityId: id,
        before,
        after,
      }
      return after
    })
    this.audit(auditEvent)
    return row
  }

  async createCompensationVoucher(id, data, actorId) {
    let auditEvent
    const voucher = await this.transaction(async (client) => {
      const complaint = (
        await client.query(
          `SELECT c.id,c.complaint_code,c.status,c.customer_id,cp.user_id FROM complaints c JOIN customer_profiles cp ON cp.id=c.customer_id WHERE c.id=$1 FOR UPDATE OF c`,
          [id]
        )
      ).rows[0]
      if (!complaint) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy khiếu nại.')
      if (!['RESOLVED', 'CLOSED'].includes(complaint.status))
        throw new AppError(
          409,
          'COMPLAINT_NOT_RESOLVED',
          'Cần giải quyết khiếu nại trước khi tặng voucher bồi thường.'
        )
      const name = `Complaint compensation ${complaint.complaint_code}`
      if ((await client.query('SELECT id FROM vouchers WHERE name=$1 LIMIT 1', [name])).rowCount)
        throw new AppError(
          409,
          'COMPENSATION_ALREADY_GRANTED',
          'Khiếu nại này đã được tặng voucher bồi thường.'
        )
      const voucherId = randomUUID()
      const code = createComplaintCompensationCode(complaint.customer_id, voucherId)
      const created = (
        await client.query(
          `INSERT INTO vouchers(id,code,name,discount_type,discount_value,minimum_order_amount,maximum_discount,usage_limit,usage_limit_per_customer,start_at,end_at,is_active) VALUES($1,$2,$3,'FIXED_AMOUNT',$4,$5,$4,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+($6::int*INTERVAL '1 day'),true) RETURNING *`,
          [voucherId, code, name, data.discount_value, data.minimum_order_amount, data.valid_days]
        )
      ).rows[0]
      if (data.notify_customer)
        await client.query(
          `INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id) VALUES($1,'COMPLAINT','Voucher bồi thường khiếu nại',$2,'VOUCHER',$3)`,
          [
            complaint.user_id,
            `Bạn đã nhận voucher ${code} trị giá ${Number(data.discount_value).toLocaleString('vi-VN')}đ cho khiếu nại ${complaint.complaint_code}.`,
            voucherId,
          ]
        )
      auditEvent = {
        actorId,
        action: 'GIFT_COMPLAINT_VOUCHER',
        entityType: 'VOUCHER',
        entityId: voucherId,
        before: null,
        after: {
          complaintId: complaint.id,
          discountType: created.discount_type,
          discountValue: created.discount_value,
          endAt: created.end_at,
        },
      }
      return created
    })
    this.audit(auditEvent)
    return voucher
  }
}
