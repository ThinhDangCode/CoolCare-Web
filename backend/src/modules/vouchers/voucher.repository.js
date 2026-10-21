import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { writeAdminAudit } from '../audit/admin-audit.js'
import {
  isComplaintCompensationCode,
  verifyComplaintCompensationCode,
} from '../complaints/complaint-compensation-code.js'

const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&')
const add = (values, value) => {
  values.push(value)
  return `$${values.length}`
}

export class VoucherRepository {
  constructor({ transaction = withTransaction, audit = writeAdminAudit } = {}) {
    this.transaction = transaction
    this.audit = audit
  }

  async available(userId, bookingId) {
    return this.transaction(async (client) => {
      const booking = (await client.query(`
        SELECT b.id, b.status, b.subtotal, b.voucher_id, b.customer_id
        FROM bookings b JOIN customer_profiles cp ON cp.id=b.customer_id
        WHERE b.id=$1 AND cp.user_id=$2
      `, [bookingId, userId])).rows[0]
      if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn của bạn.')
      if (!['QUOTATION_ACCEPTED', 'WAITING_CONFIRMATION'].includes(booking.status)) {
        throw new AppError(409, 'BOOKING_NOT_ELIGIBLE', 'Đơn không còn ở giai đoạn áp dụng voucher.')
      }
      const accepted = await client.query(`
        SELECT COALESCE(SUM(subtotal - parts_amount), 0) AS eligible_amount
        FROM quotations WHERE booking_id=$1 AND status='ACCEPTED'
      `, [bookingId])
      const eligibleAmount = Number(accepted.rows[0]?.eligible_amount ?? 0)
      if (eligibleAmount <= 0) throw new AppError(409, 'VOUCHER_REQUIRES_ACCEPTED_QUOTATION', 'Accepted quotation required.')
      const result = await client.query(`
        SELECT v.id, v.code, v.name, v.discount_type, v.discount_value,
               v.minimum_order_amount, v.maximum_discount, v.start_at, v.end_at,
               v.usage_limit, v.usage_count, v.usage_limit_per_customer,
               (SELECT COUNT(*)::int FROM voucher_usages vu
                WHERE vu.voucher_id=v.id AND vu.customer_id=$1
                  AND vu.status IN ('RESERVED','USED')) AS customer_usage_count
        FROM vouchers v
        WHERE v.is_active=true AND v.start_at<=CURRENT_TIMESTAMP
          AND v.end_at>CURRENT_TIMESTAMP
        ORDER BY v.end_at ASC, v.id ASC
      `, [booking.customer_id])
      return result.rows
        .filter((v) => !isComplaintCompensationCode(v.code))
        .map((v) => ({
          id: v.id, code: v.code, name: v.name,
          discountType: v.discount_type, discountValue: Number(v.discount_value),
          minimumOrderAmount: Number(v.minimum_order_amount),
          maximumDiscount: v.maximum_discount == null ? null : Number(v.maximum_discount),
          expiresAt: v.end_at,
          eligible: eligibleAmount >= Number(v.minimum_order_amount)
            && (v.usage_limit == null || Number(v.usage_count) < Number(v.usage_limit))
            && (v.usage_limit_per_customer == null || v.customer_usage_count < Number(v.usage_limit_per_customer)),
        }))
    })
  }

  async apply(userId, bookingId, code) {
    return this.transaction(async (client) => {
      const customer = (
        await client.query('SELECT id FROM customer_profiles WHERE user_id=$1', [userId])
      ).rows[0]
      if (!customer)
        throw new AppError(403, 'CUSTOMER_PROFILE_REQUIRED', 'Tài khoản chưa có hồ sơ khách hàng.')

      const booking = (
        await client.query('SELECT id, status FROM bookings WHERE id=$1 AND customer_id=$2 FOR UPDATE', [
          bookingId,
          customer.id,
        ])
      ).rows[0]
      if (!booking)
        throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy lịch dịch vụ của bạn.')

      if (!['QUOTATION_ACCEPTED', 'WAITING_CONFIRMATION'].includes(booking.status)) {
        throw new AppError(409, 'VOUCHER_REQUIRES_ACCEPTED_QUOTATION', 'Accepted quotation required.')
      }
      const accepted = await client.query(
        "SELECT 1 FROM quotations WHERE booking_id=$1 AND status='ACCEPTED' LIMIT 1", [bookingId]
      )
      if (!accepted.rowCount) throw new AppError(409, 'VOUCHER_REQUIRES_ACCEPTED_QUOTATION', 'Accepted quotation required.')

      const voucher = (
        await client.query('SELECT * FROM vouchers WHERE upper(code)=$1 FOR UPDATE', [code])
      ).rows[0]
      if (!voucher) throw new AppError(404, 'VOUCHER_NOT_FOUND', 'Mã voucher không tồn tại.')

      if (
        isComplaintCompensationCode(voucher.code) &&
        !verifyComplaintCompensationCode(voucher.code, customer.id, voucher.id)
      )
        throw new AppError(
          403,
          'VOUCHER_NOT_ASSIGNED',
          'Voucher này không thuộc tài khoản của bạn.'
        )

      let priced
      try {
        priced = (
          await client.query('SELECT (refresh_booking_pricing($1,$2)).*', [bookingId, voucher.id])
        ).rows[0]
      } catch (error) {
        throw new AppError(409, 'VOUCHER_CANNOT_BE_APPLIED', 'Voucher cannot be applied at this stage.')
      }
      if (priced.voucher_id !== voucher.id)
        throw new AppError(
          409,
          'VOUCHER_NOT_ELIGIBLE',
          'Voucher đã hết hạn, hết lượt hoặc không đáp ứng giá trị đơn tối thiểu.'
        )
      return priced
    })
  }

  async list(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      // Expiration is a system transition, not an administrator decision. Persist it
      // before applying filters so every consumer observes the same effective state.
      await client.query(
        `UPDATE vouchers
         SET is_active=false, updated_at=CURRENT_TIMESTAMP
         WHERE is_active=true AND end_at<=CURRENT_TIMESTAMP`
      )
      const values = []
      const clauses = []
      if (filters.search) {
        const term = add(values, `%${escapeLike(filters.search)}%`)
        clauses.push(`(v.code ILIKE ${term} OR v.name ILIKE ${term})`)
      }
      if (filters.status === 'ACTIVE') clauses.push('v.is_active=true')
      if (filters.status === 'INACTIVE') clauses.push('v.is_active=false')
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

  async save(id, data, actorId, action) {
    let auditEvent
    try {
      const row = await this.transaction(async (client) => {
        const before = id
          ? (await client.query('SELECT * FROM vouchers WHERE id=$1 FOR UPDATE', [id])).rows[0]
          : null
        if (id && !before) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy voucher.')
        if (before && new Date(before.end_at) <= new Date())
          throw new AppError(
            409,
            'VOUCHER_EXPIRED_READ_ONLY',
            'Voucher đã hết hạn và chỉ có thể xem, không thể chỉnh sửa hoặc kích hoạt lại.'
          )
        const type = data.discount_type ?? before?.discount_type
        const value = data.discount_value ?? Number(before?.discount_value)
        if (type === 'PERCENTAGE' && (value > 100 || !Number.isInteger(Number(value))))
          throw new AppError(
            422,
            'VALIDATION_ERROR',
            'Phần trăm giảm phải là số nguyên từ 1 đến 100.'
          )
        const start = data.start_at ?? before?.start_at
        const end = data.end_at ?? before?.end_at
        if (new Date(end) <= new Date(start))
          throw new AppError(
            422,
            'VALIDATION_ERROR',
            'Thời gian kết thúc phải sau thời gian bắt đầu.'
          )
        if (new Date(end) <= new Date())
          throw new AppError(
            422,
            'VOUCHER_END_DATE_EXPIRED',
            'Thời gian kết thúc phải ở tương lai.',
            { end_at: 'Voucher phải có thời gian kết thúc ở tương lai.' }
          )
        const totalLimit = data.usage_limit !== undefined ? data.usage_limit : before?.usage_limit
        const customerLimit =
          data.usage_limit_per_customer !== undefined
            ? data.usage_limit_per_customer
            : before?.usage_limit_per_customer
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
        if (
          totalLimit !== null &&
          customerLimit !== null &&
          Number(customerLimit) > Number(totalLimit)
        )
          throw new AppError(
            422,
            'VALIDATION_ERROR',
            'Giới hạn mỗi khách vượt quá tổng lượt sử dụng.'
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

  async listUsages(filters) {
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
          "COALESCE(vu.used_at,vu.reserved_at,vu.released_at)>=date_trunc('month',CURRENT_TIMESTAMP)"
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
}
