import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { writeManagementAudit } from './management.audit.js'

const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&')
const add = (values, value) => {
  values.push(value)
  return `$${values.length}`
}

export class ManagementRepository {
  constructor({ transaction = withTransaction, audit = writeManagementAudit } = {}) {
    this.transaction = transaction
    this.audit = audit
  }

  async listUsers(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = []
      const clauses = []
      const roleExpression =
        "CASE WHEN r.code='ADMIN' THEN 'ADMIN' WHEN tp.id IS NOT NULL THEN 'TECHNICIAN' ELSE r.code END"
      if (filters.search) {
        const term = add(values, `%${escapeLike(filters.search)}%`)
        clauses.push(
          `(u.full_name ILIKE ${term} OR u.email ILIKE ${term} OR COALESCE(u.phone,'') ILIKE ${term})`
        )
      }
      if (filters.status !== 'ALL') clauses.push(`u.status=${add(values, filters.status)}`)
      if (filters.role !== 'ALL') clauses.push(`${roleExpression}=${add(values, filters.role)}`)
      const joins =
        ' JOIN roles r ON r.id=u.role_id LEFT JOIN technician_profiles tp ON tp.user_id=u.id'
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const count = await client.query(
        `SELECT count(*)::int total FROM users u${joins}${where}`,
        values
      )
      const rows = await client.query(
        `SELECT u.id,u.full_name,u.email,u.phone,u.avatar_url,u.status,u.email_verified_at,u.phone_verified_at,u.last_login_at,u.created_at,u.updated_at,${roleExpression} role FROM users u${joins}${where} ORDER BY u.created_at ASC,u.id ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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

  async changeUserStatus(id, status, actorId) {
    if (id === actorId)
      throw new AppError(409, 'SELF_LOCK_FORBIDDEN', 'Bạn không thể khóa tài khoản đang đăng nhập.')
    const result = await this.transaction(async (client) => {
      const before = (
        await client.query('SELECT id,status FROM users WHERE id=$1 FOR UPDATE', [id])
      ).rows[0]
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy người dùng.')
      if (before.status === status) return { row: before, beforeStatus: status }
      const row = (
        await client.query(
          'UPDATE users SET status=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id,status,updated_at',
          [status, id]
        )
      ).rows[0]
      return { row, beforeStatus: before.status }
    })
    if (result.beforeStatus !== result.row.status)
      this.audit({
        actorId,
        action: status === 'LOCKED' ? 'LOCK_USER' : 'UNLOCK_USER',
        entityType: 'USER',
        entityId: id,
        before: { status: result.beforeStatus },
        after: { status },
      })
    return result.row
  }

  async listVouchers(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = []
      const clauses = []
      if (filters.search) {
        const term = add(values, `%${escapeLike(filters.search)}%`)
        clauses.push(`(v.code ILIKE ${term} OR v.name ILIKE ${term})`)
      }
      if (filters.status === 'ACTIVE') clauses.push('v.is_active=true')
      if (filters.status === 'INACTIVE') clauses.push('v.is_active=false')
      if (filters.status === 'EXPIRED') clauses.push('v.end_at<CURRENT_TIMESTAMP')
      if (filters.status === 'UPCOMING')
        clauses.push('v.is_active=true AND v.start_at>CURRENT_TIMESTAMP')
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const count = await client.query(`SELECT count(*)::int total FROM vouchers v${where}`, values)
      const order =
        filters.sort === 'OLDEST' ? 'v.created_at ASC,v.id ASC' : 'v.created_at DESC,v.id DESC'
      const rows = await client.query(
        `SELECT v.*,(SELECT count(*)::int FROM voucher_usages vu WHERE vu.voucher_id=v.id AND vu.status='USED') used_count FROM (SELECT vouchers.*,ROW_NUMBER() OVER(ORDER BY created_at ASC,id ASC)::int voucher_number FROM vouchers) v${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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

  async mutateVoucher(id, data, actorId, action) {
    let auditEvent
    try {
      const row = await this.transaction(async (client) => {
        let before = null
        if (id) {
          before = (await client.query('SELECT * FROM vouchers WHERE id=$1 FOR UPDATE', [id]))
            .rows[0]
          if (!before) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy voucher.')
        }
        const type = data.discount_type ?? before?.discount_type
        const value = data.discount_value ?? Number(before?.discount_value)
        if (type === 'PERCENTAGE' && value > 100)
          throw new AppError(422, 'VALIDATION_ERROR', 'Phần trăm giảm không được vượt quá 100.', {
            discount_value: 'Tối đa 100%.',
          })
        if (type === 'PERCENTAGE' && !Number.isInteger(Number(value)))
          throw new AppError(422, 'VALIDATION_ERROR', 'Phần trăm giảm phải là số nguyên.', {
            discount_value: 'Nhập số nguyên từ 1 đến 100.',
          })
        const start = data.start_at ?? before?.start_at
        const end = data.end_at ?? before?.end_at
        if (new Date(end) <= new Date(start))
          throw new AppError(
            422,
            'VALIDATION_ERROR',
            'Thời gian kết thúc phải sau thời gian bắt đầu.',
            { end_at: 'Thời gian kết thúc phải sau thời gian bắt đầu.' }
          )
        const totalLimit = data.usage_limit !== undefined ? data.usage_limit : before?.usage_limit
        const customerLimit =
          data.usage_limit_per_customer !== undefined
            ? data.usage_limit_per_customer
            : before?.usage_limit_per_customer
        if (
          totalLimit !== null &&
          customerLimit !== null &&
          Number(customerLimit) > Number(totalLimit)
        )
          throw new AppError(
            422,
            'VALIDATION_ERROR',
            'Giới hạn mỗi khách vượt quá tổng lượt sử dụng.',
            { usage_limit_per_customer: 'Không được vượt quá tổng lượt sử dụng.' }
          )
        if (
          data.usage_limit !== undefined &&
          data.usage_limit !== null &&
          data.usage_limit < Number(before?.usage_count ?? 0)
        )
          throw new AppError(
            422,
            'VALIDATION_ERROR',
            'Giới hạn lượt dùng thấp hơn số lượt đã dùng.',
            { usage_limit: 'Giới hạn không hợp lệ.' }
          )
        if (data.code) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['admin:voucher-code'])
          if (
            (
              await client.query(
                'SELECT id FROM vouchers WHERE upper(trim(code))=$1 AND ($2::uuid IS NULL OR id<>$2)',
                [data.code, id]
              )
            ).rowCount
          )
            throw new AppError(409, 'DUPLICATE_CODE', 'Mã voucher đã tồn tại.', {
              code: 'Vui lòng dùng mã khác.',
            })
        }
        const fields = Object.keys(data)
        const values = Object.values(data)
        const after = id
          ? (
              await client.query(
                `UPDATE vouchers SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=$${values.length + 1} RETURNING *`,
                [...values, id]
              )
            ).rows[0]
          : (
              await client.query(
                `INSERT INTO vouchers(${fields.join(',')}) VALUES(${fields.map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`,
                values
              )
            ).rows[0]
        auditEvent = { actorId, action, entityType: 'VOUCHER', entityId: after.id, before, after }
        return after
      })
      this.audit(auditEvent)
      return row
    } catch (error) {
      if (error.code === '23505')
        throw new AppError(409, 'DUPLICATE_CODE', 'Mã voucher đã tồn tại.', {
          code: 'Vui lòng dùng mã khác.',
        })
      throw error
    }
  }

  async listVoucherUsages(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = []
      const clauses = []
      if (filters.voucherId) clauses.push(`vu.voucher_id=${add(values, filters.voucherId)}`)
      if (filters.status !== 'ALL') clauses.push(`vu.status=${add(values, filters.status)}`)
      if (filters.search) {
        const term = add(values, `%${escapeLike(filters.search)}%`)
        clauses.push(
          `(v.code ILIKE ${term} OR u.full_name ILIKE ${term} OR COALESCE(u.phone,'') ILIKE ${term} OR b.booking_code ILIKE ${term})`
        )
      }
      if (filters.voucherSearch)
        clauses.push(`v.code ILIKE ${add(values, `%${escapeLike(filters.voucherSearch)}%`)}`)
      if (filters.customerSearch) {
        const term = add(values, `%${escapeLike(filters.customerSearch)}%`)
        clauses.push(`(u.full_name ILIKE ${term} OR COALESCE(u.phone,'') ILIKE ${term})`)
      }
      if (filters.fromDate)
        clauses.push(
          `COALESCE(vu.used_at,vu.reserved_at,vu.released_at)>=${add(values, filters.fromDate)}::date`
        )
      if (filters.toDate)
        clauses.push(
          `COALESCE(vu.used_at,vu.reserved_at,vu.released_at)<${add(values, filters.toDate)}::date+INTERVAL '1 day'`
        )
      if (!filters.fromDate && !filters.toDate && filters.period === 'THIS_MONTH')
        clauses.push(
          "COALESCE(vu.used_at,vu.reserved_at,vu.released_at)>=date_trunc('month',CURRENT_TIMESTAMP) AND COALESCE(vu.used_at,vu.reserved_at,vu.released_at)<date_trunc('month',CURRENT_TIMESTAMP)+INTERVAL '1 month'"
        )
      const from =
        ' FROM voucher_usages vu JOIN vouchers v ON v.id=vu.voucher_id JOIN customer_profiles cp ON cp.id=vu.customer_id JOIN users u ON u.id=cp.user_id JOIN bookings b ON b.id=vu.booking_id'
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const count = await client.query(`SELECT count(*)::int total${from}${where}`, values)
      const rows = await client.query(
        `SELECT vu.*,v.code voucher_code,v.name voucher_name,u.full_name customer_name,u.phone customer_phone,b.booking_code${from}${where} ORDER BY COALESCE(vu.used_at,vu.reserved_at,vu.released_at) DESC,vu.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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

  async listBlogs(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = []
      const clauses = []
      if (filters.search) {
        const term = add(values, `%${escapeLike(filters.search)}%`)
        clauses.push(`(b.title ILIKE ${term} OR b.slug ILIKE ${term} OR u.full_name ILIKE ${term})`)
      }
      if (filters.status !== 'ALL') clauses.push(`b.status=${add(values, filters.status)}`)
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const from =
        ' FROM (SELECT blogs.*,ROW_NUMBER() OVER(ORDER BY created_at ASC,id ASC)::int blog_number FROM blogs) b JOIN users u ON u.id=b.author_id'
      const count = await client.query(`SELECT count(*)::int total${from}${where}`, values)
      const order =
        filters.sort === 'OLDEST' ? 'b.created_at ASC,b.id ASC' : 'b.created_at DESC,b.id DESC'
      const rows = await client.query(
        `SELECT b.*,u.full_name author_name${from}${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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

  async mutateBlog(id, data, actorId, action) {
    let auditEvent
    try {
      const row = await this.transaction(async (client) => {
        let before = null
        if (id) {
          before = (await client.query('SELECT * FROM blogs WHERE id=$1 FOR UPDATE', [id])).rows[0]
          if (!before) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy bài viết.')
        }
        if (data.slug) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['admin:blog-slug'])
          if (
            (
              await client.query(
                'SELECT id FROM blogs WHERE lower(slug)=lower($1) AND ($2::uuid IS NULL OR id<>$2)',
                [data.slug, id]
              )
            ).rowCount
          )
            throw new AppError(409, 'DUPLICATE_SLUG', 'Slug bài viết đã tồn tại.', {
              slug: 'Vui lòng dùng slug khác.',
            })
        }
        if (data.status !== undefined)
          data.published_at =
            data.status === 'PUBLISHED' ? (before?.published_at ?? new Date()) : null
        const fields = Object.keys(data)
        const values = Object.values(data)
        const after = id
          ? (
              await client.query(
                `UPDATE blogs SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=$${values.length + 1} RETURNING *`,
                [...values, id]
              )
            ).rows[0]
          : (
              await client.query(
                `INSERT INTO blogs(author_id,${fields.join(',')}) VALUES($1,${fields.map((_, index) => `$${index + 2}`).join(',')}) RETURNING *`,
                [actorId, ...values]
              )
            ).rows[0]
        auditEvent = { actorId, action, entityType: 'BLOG', entityId: after.id, before, after }
        return after
      })
      this.audit(auditEvent)
      return row
    } catch (error) {
      if (error.code === '23505')
        throw new AppError(409, 'DUPLICATE_SLUG', 'Slug bài viết đã tồn tại.', {
          slug: 'Vui lòng dùng slug khác.',
        })
      throw error
    }
  }

  async getBlog(id) {
    return this.transaction(async (client) => {
      const row = (
        await client.query(
          'SELECT b.*,u.full_name author_name FROM blogs b JOIN users u ON u.id=b.author_id WHERE b.id=$1',
          [id]
        )
      ).rows[0]
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy bài viết.')
      return row
    })
  }

  async listComplaints(filters) {
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
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const from =
        ' FROM (SELECT complaints.*,ROW_NUMBER() OVER(ORDER BY created_at ASC,id ASC)::int complaint_number FROM complaints) c JOIN bookings b ON b.id=c.booking_id JOIN customer_profiles cp ON cp.id=c.customer_id JOIN users cu ON cu.id=cp.user_id LEFT JOIN technician_profiles tp ON tp.id=c.technician_id LEFT JOIN users tu ON tu.id=tp.user_id LEFT JOIN users ru ON ru.id=c.resolved_by_id'
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

  async getComplaint(id) {
    return this.transaction(async (client) => {
      const row = (
        await client.query(
          `SELECT c.*,b.booking_code,b.status booking_status,b.scheduled_at,b.service_address,b.ward,b.city,
                  cu.full_name customer_name,cu.phone customer_phone,cu.email customer_email,
                  tu.full_name technician_name,tu.phone technician_phone,tp.qualification_level technician_qualification,
                  ru.full_name resolved_by_name,
                  (SELECT string_agg(DISTINCT s.name, ', ' ORDER BY s.name)
                     FROM booking_units bu
                     JOIN booking_unit_services bus ON bus.booking_unit_id=bu.id
                     JOIN services s ON s.id=bus.service_id
                    WHERE bu.booking_id=b.id) service_names
             FROM (SELECT complaints.*,ROW_NUMBER() OVER(ORDER BY created_at ASC,id ASC)::int complaint_number FROM complaints) c
             JOIN bookings b ON b.id=c.booking_id
             JOIN customer_profiles cp ON cp.id=c.customer_id
             JOIN users cu ON cu.id=cp.user_id
        LEFT JOIN technician_profiles tp ON tp.id=c.technician_id
        LEFT JOIN users tu ON tu.id=tp.user_id
        LEFT JOIN users ru ON ru.id=c.resolved_by_id
            WHERE c.id=$1`,
          [id]
        )
      ).rows[0]
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy khiếu nại.')
      return row
    })
  }

  async resolveComplaint(id, data, actorId) {
    let auditEvent
    const row = await this.transaction(async (client) => {
      const before = (await client.query('SELECT * FROM complaints WHERE id=$1 FOR UPDATE', [id]))
        .rows[0]
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy khiếu nại.')
      if (before.status === 'CLOSED')
        throw new AppError(409, 'COMPLAINT_CLOSED', 'Khiếu nại đã đóng và không thể cập nhật thêm.')
      const allowedTransitions = {
        OPEN: ['OPEN', 'IN_PROGRESS'],
        IN_PROGRESS: ['IN_PROGRESS', 'RESOLVED', 'REJECTED'],
        RESOLVED: ['RESOLVED', 'CLOSED'],
        REJECTED: ['REJECTED', 'CLOSED'],
      }
      if (!allowedTransitions[before.status]?.includes(data.status))
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
      if (data.notify_customer && !data.is_draft) {
        await client.query(
          `INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
           SELECT cp.user_id,'COMPLAINT','Complaint status updated',$2,'COMPLAINT',$1::text
             FROM complaints c
             JOIN customer_profiles cp ON cp.id=c.customer_id
            WHERE c.id=$1::uuid`,
          [id, `Your complaint is now ${data.status.toLowerCase().replace('_', ' ')}.`]
        )
      }
      auditEvent = {
        actorId,
        action:
          before.status === data.status
            ? 'SAVE_COMPLAINT_RESOLUTION_DRAFT'
            : 'RESOLVE_COMPLAINT',
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
}
