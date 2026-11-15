import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { REPORT_ROW_LIMIT, REVENUE_METRICS } from './payments.export.constants.js'
import { searchPattern, searchSql } from '../../search.js'

export class PaymentsExportRepository {
  constructor({ transaction = withTransaction } = {}) { this.transaction = transaction }

  async readRevenueReport(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = [filters.from, filters.to]
      const clauses = [
        "p.payment_status = 'SUCCESS'",
        'p.paid_at IS NOT NULL',
        "p.paid_at >= ($1::date::timestamp AT TIME ZONE INTERVAL '+07:00')",
        "p.paid_at < (($2::date + 1)::timestamp AT TIME ZONE INTERVAL '+07:00')",
      ]
      const bind = (value) => { values.push(value); return `$${values.length}` }
      if (filters.method !== 'ALL') clauses.push(`upper(trim(pm.code)) = ${bind(filters.method)}`)
      if (filters.search) {
        const term = bind(searchPattern(filters.search))
        clauses.push(`(${searchSql('p.payment_code')} LIKE ${term} OR ${searchSql('p.id::text')} LIKE ${term}
          OR ${searchSql('b.booking_code')} LIKE ${term} OR ${searchSql('u.full_name')} LIKE ${term}
          OR ${searchSql("COALESCE(u.phone, '')")} LIKE ${term})`)
      }
      const source = `FROM payments p
        JOIN bookings b ON b.id=p.booking_id
        JOIN customer_profiles cp ON cp.id=p.customer_id
        JOIN users u ON u.id=cp.user_id
        JOIN payment_methods pm ON pm.id=p.payment_method_id
        LEFT JOIN technician_profiles tp ON tp.id=p.technician_id
        LEFT JOIN users tu ON tu.id=tp.user_id
        WHERE ${clauses.join(' AND ')}`
      const aggregations = REVENUE_METRICS.map(({ key, column }) =>
        `COALESCE(SUM(p.${column}),0::numeric)::text AS "${key}KnownSum",
         count(p.${column})::int AS "${key}KnownCount",
         (count(*)-count(p.${column}))::int AS "${key}MissingCount"`
      ).join(', ')
      const summary = (await client.query(
        `SELECT count(*)::int AS "rowCount", transaction_timestamp() AS "generatedAt", ${aggregations} ${source}`,
        values
      )).rows[0]
      if (summary.rowCount > REPORT_ROW_LIMIT) {
        throw new AppError(422, 'REPORT_TOO_LARGE', 'Báo cáo vượt quá 10.000 giao dịch. Vui lòng thu hẹp khoảng ngày hoặc bộ lọc.')
      }
      const rows = (await client.query(
        `SELECT p.id, p.payment_code AS "paymentCode", b.booking_code AS "bookingCode",
          u.full_name AS "customerName", u.phone AS "customerPhone",
          tu.full_name AS "technicianName", upper(trim(pm.code)) AS "methodCode",
          pm.name AS "methodName", p.payment_status AS status, p.payment_kind AS kind,
          p.amount, p.commission_amount AS "commissionAmount",
          p.platform_discount_amount AS "platformDiscountAmount",
          p.technician_earning AS "technicianEarning", p.created_at AS "createdAt",
          p.paid_at AS "paidAt", p.settled_at AS "settledAt"
         ${source} ORDER BY p.paid_at DESC, p.id DESC`, values
      )).rows
      const metrics = Object.fromEntries(REVENUE_METRICS.map(({ key }) => [key, {
        total: summary[`${key}MissingCount`] === 0 ? summary[`${key}KnownSum`] : null,
        knownSum: summary[`${key}KnownSum`],
        knownCount: summary[`${key}KnownCount`],
        missingCount: summary[`${key}MissingCount`],
      }]))
      return { rows, rowCount: summary.rowCount, generatedAt: summary.generatedAt, metrics }
    })
  }
}
