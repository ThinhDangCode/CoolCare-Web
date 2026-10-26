import { withTransaction } from '../../config/database.js'
import { apiCode, storageCode } from '../../config/database-codebooks.js'

// Use this module's explicit conversions: the derived debt view has no codebook
// metadata and must never be decoded as the stored settlements.status column.
const statusCode = (value) => storageCode('settlements', 'status', value)
const ledgerCode = (value) => storageCode('settlement_transactions', 'transaction_type', value)
const paymentCode = (column, value) => storageCode('payments', column, value)

const source = `FROM settlements s
  JOIN technician_accounts a ON a.id=s.technician_account_id AND a.technician_id=s.technician_id
  JOIN technician_profiles tp ON tp.id=s.technician_id
  JOIN users u ON u.id=tp.user_id
  JOIN settlement_debt_balances d ON d.settlement_id=s.id
    AND d.technician_account_id=s.technician_account_id AND d.technician_id=s.technician_id`

const columns = `s.id,s.settlement_code AS code,s.technician_id AS "technicianId",
  u.full_name AS "technicianName",u.phone AS "technicianPhone",u.avatar_url AS "avatarUrl",
  s.period_start AS "periodStart",s.period_end AS "periodEnd",
  d.effective_status::integer AS "stateCode",s.finalized_at AS "finalizedAt",s.due_at AS "dueAt",
  s.opening_balance::text AS "openingBalance",s.total_cash_settlement::text AS "cashSettlement",
  s.total_online_earning::text AS "onlineEarning",s.total_topup::text AS topup,
  s.total_withdrawal::text AS withdrawal,s.total_adjustment::text AS adjustment,
  s.closing_balance::text AS "closingBalance",s.debt_amount::text AS "debtAmount",
  round(d.debt_remaining_amount,2)::text AS "debtRemainingAmount"`

export function buildSettlementListQueries(filters) {
  const values = []
  const clauses = []
  const bind = (value) => { values.push(value); return `$${values.length}` }
  if (filters.search) {
    const term = bind(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`)
    clauses.push(`(s.settlement_code ILIKE ${term} OR u.full_name ILIKE ${term}
      OR COALESCE(u.phone,'') ILIKE ${term} OR s.technician_id::text ILIKE ${term})`)
  }
  if (filters.status !== 'ALL') clauses.push(`d.effective_status=${bind(statusCode(filters.status))}::smallint`)
  if (filters.from) clauses.push(`s.period_start >= (${bind(filters.from)}::date::timestamp AT TIME ZONE INTERVAL '+07:00')`)
  if (filters.to) clauses.push(`s.period_start < ((${bind(filters.to)}::date+1)::timestamp AT TIME ZONE INTERVAL '+07:00')`)
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  return {
    summarySql: `SELECT count(*)::int AS "totalPeriods",
      count(*) FILTER (WHERE d.effective_status=${statusCode('OPEN')})::int AS "openPeriods",
      count(*) FILTER (WHERE d.effective_status IN (${statusCode('CALCULATED')},${statusCode('OVERDUE')}))::int AS "owingPeriods",
      count(*) FILTER (WHERE d.effective_status=${statusCode('SETTLED')})::int AS "settledPeriods",
      CASE WHEN count(*)=0 THEN '0.00'
        WHEN count(*) FILTER (WHERE s.finalized_at IS NOT NULL)=0 THEN NULL
        ELSE round(COALESCE(sum(d.debt_remaining_amount) FILTER (WHERE s.finalized_at IS NOT NULL),0),2)::text
        END AS "remainingDebt",transaction_timestamp() AS "readAt" ${source}${where}`,
    rowsSql: `SELECT ${columns} ${source}${where}
      ORDER BY s.period_start DESC,s.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    values, rowValues: [...values, filters.limit, (filters.page - 1) * filters.limit],
  }
}

export const SETTLEMENT_DETAIL_SQL = `SELECT ${columns},transaction_timestamp() AS "readAt" ${source} WHERE s.id=$1::uuid`

// Closed periods read only the frozen membership. OPEN periods expose live ledger
// rows, clearly without claiming their placeholder header totals are finalized.
const periodTransactions = `FROM settlements s JOIN settlement_transactions t
  ON t.technician_account_id=s.technician_account_id
    AND t.created_at>=s.period_start AND t.created_at<s.period_end
  WHERE s.id=$1::uuid AND (s.finalized_at IS NULL OR EXISTS (
    SELECT 1 FROM settlement_items si WHERE si.settlement_id=s.id AND si.settlement_transaction_id=t.id))`

export const SETTLEMENT_TRANSACTION_COUNT_SQL = `SELECT count(*)::int AS total ${periodTransactions}`

export const SETTLEMENT_TRANSACTIONS_SQL = `SELECT t.id,t.created_at AS "createdAt",
  t.transaction_type::integer AS "transactionCode",t.description,
  t.amount::text AS amount,t.balance_before::text AS "balanceBefore",t.balance_after::text AS "balanceAfter",
  CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('type','PAYMENT','id',p.id,'code',p.payment_code)
    WHEN tu.id IS NOT NULL THEN jsonb_build_object('type','TOP_UP','id',tu.id,'code',tu.topup_code)
    WHEN w.id IS NOT NULL THEN jsonb_build_object('type','WITHDRAWAL','id',w.id,'code',NULL) END AS source
  FROM settlements s JOIN settlement_transactions t
    ON t.technician_account_id=s.technician_account_id
      AND t.created_at>=s.period_start AND t.created_at<s.period_end
  LEFT JOIN payments p ON p.id=t.payment_id AND p.technician_id=s.technician_id
    AND t.transaction_type IN (${ledgerCode('CASH_SETTLEMENT')},${ledgerCode('ONLINE_EARNING')})
  LEFT JOIN technician_topups tu ON tu.id=t.topup_id AND tu.technician_id=s.technician_id
    AND tu.technician_account_id=s.technician_account_id AND t.transaction_type=${ledgerCode('TOP_UP')}
  LEFT JOIN withdrawals w ON w.id=t.withdrawal_id AND w.technician_id=s.technician_id
    AND w.technician_account_id=s.technician_account_id AND t.transaction_type=${ledgerCode('WITHDRAWAL')}
  WHERE s.id=$1::uuid AND (s.finalized_at IS NULL OR EXISTS (
    SELECT 1 FROM settlement_items si WHERE si.settlement_id=s.id AND si.settlement_transaction_id=t.id))
  ORDER BY t.created_at DESC,t.id DESC LIMIT $2 OFFSET $3`

export const SETTLEMENT_INCOME_SQL = `SELECT
  CASE WHEN COALESCE(sum(payment_evidence.unavailable_count),0)>0 THEN NULL
    ELSE round(COALESCE(sum(payment_evidence.technician_earning) FILTER (WHERE payment_evidence.valid),0),2)::text END AS "technicianEarning",
  CASE WHEN COALESCE(sum(payment_evidence.unavailable_count),0)>0 THEN NULL
    ELSE round(COALESCE(sum(payment_evidence.commission_amount) FILTER (WHERE payment_evidence.valid),0),2)::text END AS "commissionAmount",
  count(*) FILTER (WHERE payment_evidence.valid)::int AS "matchedPayments",
  COALESCE(sum(payment_evidence.unavailable_count),0)::int AS "unavailablePaymentCount"
  FROM (SELECT evidence.payment_id,max(evidence.technician_earning) AS technician_earning,
    max(evidence.commission_amount) AS commission_amount,bool_or(evidence.valid) AS valid,
    count(*) FILTER (WHERE NOT evidence.valid) AS unavailable_count
    FROM (SELECT t.id,p.id AS payment_id,p.technician_earning,p.commission_amount,
    COALESCE(p.id IS NOT NULL AND p.technician_id=s.technician_id
      AND p.payment_status=${paymentCode('payment_status', 'SUCCESS')} AND p.settled_at IS NOT NULL
      AND p.commission_rate BETWEEN 0 AND 1 AND p.commission_base_amount>=0
      AND p.commission_amount>=0 AND p.platform_discount_amount>=0 AND p.technician_earning>=0
      AND p.technician_earning=p.amount+p.platform_discount_amount-p.commission_amount
      AND ((t.transaction_type=${ledgerCode('CASH_SETTLEMENT')} AND p.payment_kind=${paymentCode('payment_kind', 'CASH')}
        AND p.amount>0 AND t.amount=p.platform_discount_amount-p.commission_amount)
        OR (t.transaction_type=${ledgerCode('ONLINE_EARNING')} AND p.payment_kind IN (${paymentCode('payment_kind', 'ONLINE')},${paymentCode('payment_kind', 'FREE')})
          AND ((p.payment_kind=${paymentCode('payment_kind', 'ONLINE')} AND p.amount>0)
            OR (p.payment_kind=${paymentCode('payment_kind', 'FREE')} AND p.amount=0))
          AND t.amount=p.technician_earning)),false) AS valid
    FROM settlements s JOIN settlement_transactions t
      ON t.technician_account_id=s.technician_account_id
        AND t.created_at>=s.period_start AND t.created_at<s.period_end
    LEFT JOIN payments p ON p.id=t.payment_id
    WHERE s.id=$1::uuid AND s.finalized_at IS NOT NULL
      AND (t.transaction_type IN (${ledgerCode('CASH_SETTLEMENT')},${ledgerCode('ONLINE_EARNING')}) OR t.payment_id IS NOT NULL)
      AND EXISTS (SELECT 1 FROM settlement_items si WHERE si.settlement_id=s.id AND si.settlement_transaction_id=t.id)
    ) evidence GROUP BY evidence.payment_id
  ) payment_evidence`

function safeAvatar(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export function presentSettlement(row) {
  const closed = row.finalizedAt != null
  return {
    id: row.id, code: row.code,
    technician: { id: row.technicianId, name: row.technicianName, phone: row.technicianPhone, avatarUrl: safeAvatar(row.avatarUrl) },
    period: { start: row.periodStart, end: row.periodEnd },
    status: apiCode('settlements', 'status', row.stateCode), finalizedAt: row.finalizedAt, dueAt: row.dueAt,
    totals: Object.fromEntries(['openingBalance', 'cashSettlement', 'onlineEarning', 'topup', 'withdrawal', 'adjustment',
      'closingBalance', 'debtAmount', 'debtRemainingAmount'].map((key) => [key, closed ? row[key] : null])),
  }
}

export function presentSettlementTransaction(row) {
  return { id: row.id, createdAt: row.createdAt, type: apiCode('settlement_transactions', 'transaction_type', row.transactionCode),
    description: row.description, amount: row.amount, balanceBefore: row.balanceBefore, balanceAfter: row.balanceAfter,
    source: row.source ? { type: row.source.type, id: row.source.id, code: row.source.code } : null }
}

const pagination = (filters, total) => ({ page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) })
export class SettlementsRepository {
  constructor({ transaction = withTransaction } = {}) { this.transaction = transaction }
  async listSettlements(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const query = buildSettlementListQueries(filters)
      const { readAt, ...summary } = (await client.query(query.summarySql, query.values)).rows[0]
      const rows = (await client.query(query.rowsSql, query.rowValues)).rows
      return { items: rows.map(presentSettlement), pagination: pagination(filters, summary.totalPeriods), summary, readAt }
    })
  }
  async getSettlement(id, filters = { page: 1, limit: 10 }) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const row = (await client.query(SETTLEMENT_DETAIL_SQL, [id])).rows[0]
      if (!row) return null
      const total = (await client.query(SETTLEMENT_TRANSACTION_COUNT_SQL, [id])).rows[0].total
      const rows = (await client.query(SETTLEMENT_TRANSACTIONS_SQL, [id, filters.limit, (filters.page - 1) * filters.limit])).rows
      const income = row.finalizedAt == null
        ? { technicianEarning: null, commissionAmount: null, matchedPayments: null, unavailablePaymentCount: null }
        : (await client.query(SETTLEMENT_INCOME_SQL, [id])).rows[0]
      return { ...presentSettlement(row), readAt: row.readAt, income,
        transactions: { items: rows.map(presentSettlementTransaction), pagination: pagination(filters, total) } }
    })
  }
}
