import { randomUUID } from 'node:crypto'
import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { writeAdminAudit } from '../audit/admin-audit.js'
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
      const rows = await client.query(
        `SELECT c.*,b.booking_code,cu.full_name customer_name,cu.phone customer_phone,tu.full_name technician_name,ru.full_name resolved_by_name${from}${where} ORDER BY c.created_at DESC,c.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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
      const terminal = ['RESOLVED', 'REJECTED', 'CLOSED'].includes(data.status)
      const after = (
        await client.query(
          'UPDATE complaints SET status=$1,resolution=$2,resolved_by_id=$3,resolved_at=$4 WHERE id=$5 RETURNING *',
          [data.status, data.resolution, actorId, terminal ? new Date() : null, id]
        )
      ).rows[0]
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
