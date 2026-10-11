import { withTransaction } from '../../config/database.js'

export class SettlementRepository {
  constructor({ transaction = withTransaction } = {}) {
    this.transaction = transaction
  }

  async listWithdrawals(filters) {
    return this.transaction(async (client) => {
      // Count and items share a snapshot; this endpoint cannot write financial data.
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = []
      const clauses = []
      const bind = (value) => {
        values.push(value)
        return `$${values.length}`
      }
      if (filters.search) {
        const term = bind(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`)
        clauses.push(
          `(w.id::text ILIKE ${term} OR u.full_name ILIKE ${term} OR COALESCE(u.phone, '') ILIKE ${term})`
        )
      }
      if (filters.status !== 'ALL') clauses.push(`w.status = ${bind(filters.status)}`)
      if (filters.technicianId) clauses.push(`w.technician_id = ${bind(filters.technicianId)}`)
      // Date filters include whole local calendar days, independent of DB timezone.
      if (filters.fromDate)
        clauses.push(
          `w.initiated_at >= (${bind(filters.fromDate)}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`
        )
      if (filters.toDate)
        clauses.push(
          `w.initiated_at < ((${bind(filters.toDate)}::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`
        )
      const source = `FROM withdrawals w
        JOIN technician_profiles tp ON tp.id = w.technician_id
        JOIN users u ON u.id = tp.user_id
        JOIN technician_accounts a ON a.id = w.technician_account_id`
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const count = await client.query(`SELECT count(*)::int AS total ${source}${where}`, values)
      const result = await client.query(
        `SELECT w.id, w.technician_id, u.full_name AS technician_name,
          u.phone AS technician_phone, w.amount, w.fee_amount, w.net_amount,
          w.bank_name, w.status, w.initiated_at,
          a.settlement_balance AS current_settlement_balance
         ${source}${where}
         ORDER BY w.initiated_at DESC, w.id DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.limit, (filters.page - 1) * filters.limit]
      )
      return {
        items: result.rows,
        total: count.rows[0].total,
        page: filters.page,
        limit: filters.limit,
      }
    })
  }

  async getWithdrawal(id) {
    return this.transaction(async (client) => {
      // Details, live balances and the related ledger share the same read-only snapshot.
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const result = await client.query(
        `SELECT w.id, w.technician_id, w.technician_account_id,
          u.full_name AS technician_name, u.phone AS technician_phone,
          u.email AS technician_email, w.amount, w.fee_amount, w.net_amount,
          w.bank_name, w.account_number, w.account_holder, w.status,
          w.initiated_at, w.processed_at, w.paid_at, w.payout_reference,
          w.failure_reason, w.note,
          a.settlement_balance AS current_settlement_balance,
          reserved.amount AS reserved_amount,
          a.settlement_balance - reserved.amount AS available_balance,
          transaction_timestamp() AS read_at
         FROM withdrawals w
         JOIN technician_profiles tp ON tp.id = w.technician_id
         JOIN users u ON u.id = tp.user_id
         JOIN technician_accounts a ON a.id = w.technician_account_id
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(pending.amount), 0::numeric) AS amount
           FROM withdrawals pending
           WHERE pending.technician_account_id = a.id
             AND pending.status IN ('PENDING', 'PROCESSING')
         ) reserved
         WHERE w.id = $1`,
        [id]
      )
      const withdrawal = result.rows[0]
      if (!withdrawal) return null

      const transactions = await client.query(
        `SELECT id, transaction_type, amount, balance_before, balance_after,
          reference_type, reference_id, description, created_at
         FROM settlement_transactions
         WHERE withdrawal_id = $1 AND technician_account_id = $2
         ORDER BY created_at ASC, id ASC`,
        [id, withdrawal.technician_account_id]
      )
      return { ...withdrawal, settlement_transactions: transactions.rows }
    })
  }
}
