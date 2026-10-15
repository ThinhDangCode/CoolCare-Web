import { withTransaction } from '../../config/database.js'

const source = `FROM withdrawals w
  JOIN technician_profiles tp ON tp.id=w.technician_id
  JOIN users u ON u.id=tp.user_id`
const fields = `w.id,w.payout_reference AS "payoutReference",w.technician_id AS "technicianId",
  u.full_name AS "technicianName",u.phone AS "technicianPhone",w.amount,
  w.fee_amount AS "feeAmount",w.net_amount AS "netAmount",w.status,
  w.initiated_at AS "initiatedAt",w.processed_at AS "processedAt",w.paid_at AS "paidAt"`

export function buildWithdrawalListQueries(filters) {
  const values = []
  const clauses = []
  const bind = (value) => {
    values.push(value)
    return `$${values.length}`
  }
  if (filters.search) {
    const term = bind(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`)
    clauses.push(`(w.id::text ILIKE ${term} OR COALESCE(w.payout_reference,'') ILIKE ${term}
      OR u.full_name ILIKE ${term} OR COALESCE(u.phone,'') ILIKE ${term})`)
  }
  if (filters.status !== 'ALL') clauses.push(`w.status=${bind(filters.status)}`)
  if (filters.from)
    clauses.push(
      `w.initiated_at >= (${bind(filters.from)}::date::timestamp AT TIME ZONE INTERVAL '+07:00')`
    )
  if (filters.to)
    clauses.push(
      `w.initiated_at < ((${bind(filters.to)}::date+1)::timestamp AT TIME ZONE INTERVAL '+07:00')`
    )
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  return {
    countSql: `SELECT count(*)::int AS total ${source}${where}`,
    rowsSql: `SELECT ${fields} ${source}${where} ORDER BY w.initiated_at DESC,w.id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    values,
    rowValues: [...values, filters.limit, (filters.page - 1) * filters.limit],
  }
}

export const WITHDRAWAL_DETAIL_SQL = `SELECT ${fields},
  w.bank_name AS "bankName",w.account_number AS "accountNumber",w.account_holder AS "accountHolder",
  w.failure_reason AS "failureReason",w.note,
  st.id AS "ledgerId",st.transaction_type AS "ledgerType",st.amount AS "ledgerAmount",
  st.balance_before AS "balanceBefore",st.balance_after AS "balanceAfter",
  st.created_at AS "ledgerCreatedAt",st.reference_id AS "ledgerReferenceId"
  ${source}
  LEFT JOIN technician_accounts a ON a.id=w.technician_account_id AND a.technician_id=w.technician_id
  LEFT JOIN settlement_transactions st ON st.withdrawal_id=w.id
    AND st.transaction_type='WITHDRAWAL' AND st.technician_account_id=w.technician_account_id
    AND a.id=st.technician_account_id
  WHERE w.id=$1`

export function presentWithdrawalRow(row) {
  return {
    id: row.id,
    payoutReference: row.payoutReference,
    technician: { id: row.technicianId, name: row.technicianName, phone: row.technicianPhone },
    amount: row.amount,
    feeAmount: row.feeAmount,
    netAmount: row.netAmount,
    status: row.status,
    initiatedAt: row.initiatedAt,
    processedAt: row.processedAt,
    paidAt: row.paidAt,
  }
}
export function presentWithdrawalDetail(row) {
  return {
    ...presentWithdrawalRow(row),
    bank: {
      name: row.bankName,
      accountNumber: row.accountNumber,
      accountHolder: row.accountHolder,
    },
    failureReason: row.failureReason,
    note: row.note,
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

export class WithdrawalsRepository {
  constructor({ transaction = withTransaction } = {}) {
    this.transaction = transaction
  }
  async listWithdrawals(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const { countSql, rowsSql, values, rowValues } = buildWithdrawalListQueries(filters)
      const total = (await client.query(countSql, values)).rows[0].total
      const rows = (await client.query(rowsSql, rowValues)).rows
      return {
        items: rows.map(presentWithdrawalRow),
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          totalPages: Math.ceil(total / filters.limit),
        },
      }
    })
  }
  async getWithdrawal(id) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const row = (await client.query(WITHDRAWAL_DETAIL_SQL, [id])).rows[0]
      return row ? presentWithdrawalDetail(row) : null
    })
  }
}
