import { withTransaction } from '../../config/database.js'
import { requireValidBody } from '../../utils.js'

const source = `FROM technician_topups t
  JOIN technician_profiles tp ON tp.id=t.technician_id
  JOIN users u ON u.id=tp.user_id
  JOIN payment_methods pm ON pm.id=t.payment_method_id`
const fields = `t.id,t.topup_code AS "topupCode",t.technician_id AS "technicianId",
  u.full_name AS "technicianName",u.phone AS "technicianPhone",t.amount,
  pm.id AS "methodId",pm.code AS "methodCode",pm.name AS "methodName",
  t.payment_status AS status,t.transaction_reference AS "transactionReference",
  t.created_at AS "createdAt",t.paid_at AS "paidAt",t.settled_at AS "settledAt"`

// No is_active/is_online gate: historical methods are retained even after removal
// from the choices allowed when initiating a new top-up.
export const TOPUP_METHOD_OPTIONS_SQL = `SELECT DISTINCT pm.id,pm.code,pm.name
  FROM payment_methods pm JOIN technician_topups t ON t.payment_method_id=pm.id
  ORDER BY pm.name,pm.id`
const methodLookupSql = 'SELECT id,code,name FROM payment_methods WHERE id=$1'

export function buildTopupListQueries(filters) {
  const values = []
  const clauses = []
  const bind = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  if (filters.search) {
    const term = bind(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`)
    clauses.push(`(t.id::text ILIKE ${term} OR t.topup_code ILIKE ${term}
      OR COALESCE(t.transaction_reference,'') ILIKE ${term} OR u.full_name ILIKE ${term}
      OR COALESCE(u.phone,'') ILIKE ${term})`)
  }
  if (filters.status !== 'ALL') clauses.push(`t.payment_status=${bind(filters.status)}`)
  if (filters.method !== 'ALL') clauses.push(`t.payment_method_id=${bind(filters.method)}::uuid`)
  if (filters.from)
    clauses.push(
      `t.created_at >= (${bind(filters.from)}::date::timestamp AT TIME ZONE INTERVAL '+07:00')`
    )
  if (filters.to)
    clauses.push(
      `t.created_at < ((${bind(filters.to)}::date+1)::timestamp AT TIME ZONE INTERVAL '+07:00')`
    )
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  return {
    countSql: `SELECT count(*)::int AS total ${source}${where}`,
    rowsSql: `SELECT ${fields} ${source}${where} ORDER BY t.created_at DESC,t.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    values,
    rowValues: [...values, filters.limit, (filters.page - 1) * filters.limit],
  }
}

export const TOPUP_DETAIL_SQL = `SELECT ${fields},
  t.closure_verified_at AS "closureVerifiedAt",t.closure_reference AS "closureReference",
  st.id AS "ledgerId",st.transaction_type AS "ledgerType",st.amount AS "ledgerAmount",
  st.balance_before AS "balanceBefore",st.balance_after AS "balanceAfter",
  st.created_at AS "ledgerCreatedAt",st.reference_id AS "ledgerReferenceId"
  ${source}
  LEFT JOIN technician_accounts a ON a.id=t.technician_account_id AND a.technician_id=t.technician_id
  LEFT JOIN settlement_transactions st ON st.topup_id=t.id AND st.transaction_type='TOP_UP'
    AND st.technician_account_id=t.technician_account_id AND a.id=st.technician_account_id
    AND t.payment_status='SUCCESS'
  WHERE t.id=$1`

export function presentTopupRow(row) {
  return {
    id: row.id,
    topupCode: row.topupCode,
    technician: { id: row.technicianId, name: row.technicianName, phone: row.technicianPhone },
    amount: row.amount,
    method: { id: row.methodId, code: row.methodCode, name: row.methodName },
    status: row.status,
    transactionReference: row.transactionReference,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    settledAt: row.settledAt,
  }
}
export function presentTopupDetail(row) {
  return {
    ...presentTopupRow(row),
    closureVerifiedAt: row.closureVerifiedAt,
    closureReference: row.closureReference,
    ledger: row.ledgerId
      ? {
          id: row.ledgerId,
          type: row.ledgerType,
          amount: row.ledgerAmount,
          balanceBefore: row.balanceBefore,
          balanceAfter: row.balanceAfter,
          createdAt: row.ledgerCreatedAt,
          referenceId: row.ledgerReferenceId,
        }
      : null,
  }
}

export class TopupsRepository {
  constructor({ transaction = withTransaction } = {}) {
    this.transaction = transaction
  }
  async listTopups(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const methods = (await client.query(TOPUP_METHOD_OPTIONS_SQL)).rows
      if (filters.method !== 'ALL' && !methods.some((method) => method.id === filters.method)) {
        const method = (await client.query(methodLookupSql, [filters.method])).rows[0]
        requireValidBody({ method: method ? null : 'Không tìm thấy phương thức thanh toán.' })
        // A known unused method returns an empty page, and stays representable in
        // the selected filter rather than being silently changed back to ALL.
        methods.push(method)
        methods.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      }
      const { countSql, rowsSql, values, rowValues } = buildTopupListQueries(filters)
      const total = (await client.query(countSql, values)).rows[0].total
      const rows = (await client.query(rowsSql, rowValues)).rows
      return {
        items: rows.map(presentTopupRow),
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
        },
        options: { methods },
      }
    })
  }
  async getTopup(id) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const row = (await client.query(TOPUP_DETAIL_SQL, [id])).rows[0]
      return row ? presentTopupDetail(row) : null
    })
  }
}
