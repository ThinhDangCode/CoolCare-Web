
import { randomUUID } from 'node:crypto'
import { pool, withTransaction } from '../../config/database.js'
import { validateUuid } from '../../utils.js'
import { walletError } from './wallet.domain.js'

const TOPUP_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
]

const TRANSACTION_TYPES = [
  'CASH_SETTLEMENT',
  'ONLINE_EARNING',
  'TOP_UP',
  'WITHDRAWAL',
  'ADJUSTMENT',
]

const normalizeTopup = row => {
  if (!row) return row

  const raw = String(row.payment_status ?? '').toUpperCase()
  const index = Number(raw)

  const status =
    raw !== '' &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < TOPUP_STATUSES.length
      ? TOPUP_STATUSES[index]
      : TOPUP_STATUSES.includes(raw)
        ? raw
        : 'UNKNOWN'

  return {
    ...row,
    payment_status: status,
  }
}

const technicianSql = `
  SELECT
    tp.id AS technician_id,
    a.id AS account_id
  FROM technician_profiles tp
  JOIN technician_accounts a
    ON a.technician_id = tp.id
  JOIN users u
    ON u.id = tp.user_id
  WHERE tp.user_id = $1
    AND UPPER(tp.verification_status::text) IN ('1', 'VERIFIED')
    AND tp.is_active = true
    AND UPPER(u.status::text) IN ('0', 'ACTIVE')
`

export class TechnicianWalletRepository {
  constructor({
    queryable = pool,
    transaction = withTransaction,
  } = {}) {
    this.db = queryable
    this.transaction = transaction
  }

  async owner(userId, db = this.db) {
    const result = await db.query(technicianSql, [userId])
    const row = result.rows[0]

    if (!row) {
      walletError(
        'SETTLEMENT_ACCOUNT_UNAVAILABLE',
        'Verified technician settlement account not found.',
        403,
      )
    }

    return row
  }

  async overview(userId, fromDate = null, toDate = null) {
    const owner = await this.owner(userId)

    const [balance, earnings, ledger, weekly] = await Promise.all([
      this.db.query(
        `
        SELECT
          settlement_balance,
          reserved_amount,
          GREATEST(0, available_balance) AS available_balance
        FROM technician_account_balances
        WHERE technician_id = $1
        `,
        [owner.technician_id],
      ),

      this.db.query(
        `
        SELECT
          COALESCE(
            SUM(amount) FILTER (
              WHERE UPPER(payment_kind::text) IN ('0', 'CASH')
            ),
            0
          ) AS cash_collected,

          COALESCE(
            SUM(technician_earning) FILTER (
              WHERE UPPER(payment_kind::text) IN (
                '1', '2', 'VNPAY', 'ZALOPAY'
              )
            ),
            0
          ) AS online_earning,

          COALESCE(
            SUM(commission_amount),
            0
          ) AS platform_commission,

          COALESCE(
            SUM(platform_discount_amount),
            0
          ) AS platform_discount,

          COALESCE(
            SUM(technician_earning),
            0
          ) AS total_earnings

        FROM payments
        WHERE technician_id = $1
          AND UPPER(payment_status::text) IN ('2', 'SUCCESS')
          AND ($2::date IS NULL OR created_at >= $2::date)
          AND ($3::date IS NULL OR created_at < ($3::date + INTERVAL '1 day'))
        `,
        [owner.technician_id, fromDate, toDate],
      ),

      this.db.query(
        `
        SELECT
          COALESCE(
            SUM(amount) FILTER (
              WHERE UPPER(transaction_type::text) IN ('2', 'TOP_UP')
            ),
            0
          ) AS total_topup,

          COALESCE(
            -SUM(amount) FILTER (
              WHERE UPPER(transaction_type::text) IN ('3', 'WITHDRAWAL')
            ),
            0
          ) AS total_withdrawal,

          COALESCE(
            SUM(amount) FILTER (
              WHERE UPPER(transaction_type::text) IN ('4', 'ADJUSTMENT')
            ),
            0
          ) AS net_adjustments

        FROM settlement_transactions
        WHERE technician_account_id = $1
          AND ($2::date IS NULL OR created_at >= $2::date)
          AND ($3::date IS NULL OR created_at < ($3::date + INTERVAL '1 day'))
        `,
        [owner.account_id, fromDate, toDate],
      ),

      this.db.query(
        `
        SELECT
          s.id,
          s.settlement_code,
          s.period_start,
          s.period_end,
          s.opening_balance,
          s.total_cash_settlement,
          s.total_online_earning,
          s.total_topup,
          s.total_withdrawal,
          s.total_adjustment,
          s.closing_balance,
          s.debt_amount,
          s.finalized_at,
          d.debt_remaining_amount,
          d.effective_status AS status,
          d.due_at

        FROM settlements s

        LEFT JOIN settlement_debt_balances d
          ON d.settlement_id = s.id

        WHERE s.technician_id = $1

        ORDER BY s.period_start DESC
        LIMIT 8
        `,
        [owner.technician_id],
      ),
    ])

    return {
      balance: balance.rows[0] ?? {
        settlement_balance: '0',
        reserved_amount: '0',
        available_balance: '0',
      },
      earnings: earnings.rows[0],
      movements: ledger.rows[0],
      settlements: weekly.rows,
    }
  }

  async transactions(userId, page = 1, limit = 20) {
    const owner = await this.owner(userId)

    const result = await this.db.query(
      `
      SELECT
        st.id,

        CASE UPPER(st.transaction_type::text)
          WHEN '0' THEN 'CASH_SETTLEMENT'
          WHEN '1' THEN 'ONLINE_EARNING'
          WHEN '2' THEN 'TOP_UP'
          WHEN '3' THEN 'WITHDRAWAL'
          WHEN '4' THEN 'ADJUSTMENT'
          ELSE UPPER(st.transaction_type::text)
        END AS transaction_type,

        st.amount,
        st.balance_before,
        st.balance_after,
        st.description,
        st.created_at,
        st.payment_id,
        st.topup_id,
        st.withdrawal_id

      FROM settlement_transactions st

      WHERE st.technician_account_id = $1

      ORDER BY
        st.created_at DESC,
        st.id DESC

      LIMIT $2
      OFFSET $3
      `,
      [owner.account_id, limit, (page - 1) * limit],
    )

    return {
      items: result.rows,
      page,
      limit,
    }
  }

  async withdrawals(userId, page = 1, limit = 20) {
    const owner = await this.owner(userId)
    const result = await this.db.query(`
      SELECT id, amount, fee_amount, net_amount, bank_name, account_number,
        account_holder, status, payout_reference, initiated_at, processed_at, paid_at
      FROM withdrawals WHERE technician_id = $1
      ORDER BY initiated_at DESC, id DESC LIMIT $2 OFFSET $3
    `, [owner.technician_id, limit, (page - 1) * limit])
    return { items: result.rows.map(r => ({...r, status: ['PENDING','PROCESSING','SUCCESS','FAILED','CANCELLED'][Number(r.status)] ?? r.status})), page, limit }
  }

  async createMockWithdrawal(userId, input) {
    return this.transaction(async db => {
      const owner = await this.owner(userId, db)
      // Serialize withdrawals for this wallet. The database lifecycle trigger
      // performs the final reservation check and owns all ledger posting.
      await db.query('SELECT id FROM technician_accounts WHERE id = $1 FOR UPDATE', [owner.account_id])
      const existing = await db.query('SELECT * FROM withdrawals WHERE idempotency_key = $1', [input.key])
      if (existing.rows.length) {
        const row = existing.rows[0]
        if (row.technician_id !== owner.technician_id || Number(row.amount) !== input.amount ||
            row.bank_name !== input.bankName || row.account_number !== input.accountNumber ||
            row.account_holder !== input.accountHolder) {
          walletError('IDEMPOTENCY_CONFLICT', 'Withdrawal request key was already used.', 409)
        }
        return { id: row.id, status: ['PENDING','PROCESSING','SUCCESS','FAILED','CANCELLED'][Number(row.status)], amount: row.amount, netAmount: row.net_amount }
      }
      const balance = await db.query('SELECT available_balance FROM technician_account_balances WHERE technician_account_id = $1', [owner.account_id])
      if (Number(balance.rows[0]?.available_balance ?? 0) < input.amount) {
        walletError('INSUFFICIENT_BALANCE', 'Not enough available settlement balance.', 409)
      }
      const id = randomUUID()
      await db.query(`INSERT INTO withdrawals
        (id,idempotency_key,technician_id,technician_account_id,amount,bank_name,account_number,account_holder,initiated_at,note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP,$9)`,
        [id,input.key,owner.technician_id,owner.account_id,input.amount,input.bankName,input.accountNumber,input.accountHolder,'MOCK PAYOUT - NO REAL MONEY TRANSFER'])
      await db.query('UPDATE withdrawals SET status = 1 WHERE id = $1', [id])
      // This is explicitly a simulated payout. The trigger posts one debit.
      const result = await db.query(`UPDATE withdrawals SET status = 2, fee_amount = 0,
        payout_reference = $2, paid_at = CURRENT_TIMESTAMP WHERE id = $1
        RETURNING id,amount,net_amount,status,payout_reference,paid_at`,
        [id, `MOCK-${id}`])
      const row = result.rows[0]
      return { id: row.id, amount: row.amount, netAmount: row.net_amount,
        status: 'SUCCESS', payoutReference: row.payout_reference, paidAt: row.paid_at,
        simulated: true }
    })
  }

  async topups(userId, page = 1, limit = 20) {
    const owner = await this.owner(userId)

    const result = await this.db.query(
      `
      SELECT
        t.id,
        t.topup_code,
        t.amount,

        CASE UPPER(t.payment_status::text)
          WHEN '0' THEN 'PENDING'
          WHEN '1' THEN 'PROCESSING'
          WHEN '2' THEN 'SUCCESS'
          WHEN '3' THEN 'FAILED'
          WHEN '4' THEN 'CANCELLED'
          ELSE UPPER(t.payment_status::text)
        END AS status,

        pm.code AS method,
        t.paid_at,
        t.created_at,
        t.transaction_reference

      FROM technician_topups t

      JOIN payment_methods pm
        ON pm.id = t.payment_method_id

      WHERE t.technician_id = $1

      ORDER BY
        t.created_at DESC,
        t.id DESC

      LIMIT $2
      OFFSET $3
      `,
      [owner.technician_id, limit, (page - 1) * limit],
    )

    return {
      items: result.rows,
      page,
      limit,
    }
  }

  async create(userId, { amount, method, key }) {
    return this.transaction(async db => {
      const owner = await this.owner(userId, db)

      const priorResult = await db.query(
        `
        SELECT
          t.*,
          pm.code AS method

        FROM technician_topups t

        JOIN payment_methods pm
          ON pm.id = t.payment_method_id

        WHERE t.idempotency_key = $1

        FOR UPDATE OF t
        `,
        [key],
      )

      const prior = priorResult.rows[0]

      if (prior) {
        if (
          prior.technician_id !== owner.technician_id ||
          Number(prior.amount) !== Number(amount) ||
          prior.method !== method
        ) {
          walletError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key belongs to a different top-up.',
            409,
          )
        }

        return normalizeTopup(prior)
      }

      const methodResult = await db.query(
        `
        SELECT id
        FROM payment_methods
        WHERE code = $1
          AND is_active = true
          AND is_online = true
        `,
        [method],
      )

      const methodRow = methodResult.rows[0]

      if (!methodRow) {
        walletError(
          'PAYMENT_METHOD_UNAVAILABLE',
          'Online payment method not available.',
          409,
        )
      }

      const id = randomUUID()

      const topupCode = (
        `TU${Date.now().toString(36).toUpperCase()}` +
        id.slice(0, 5).toUpperCase()
      ).slice(0, 20)

      const result = await db.query(
        `
        INSERT INTO technician_topups (
          id,
          idempotency_key,
          topup_code,
          technician_id,
          technician_account_id,
          amount,
          payment_method_id,
          payment_status,
          created_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          0,
          CURRENT_TIMESTAMP
        )
        RETURNING *, $8::text AS method
        `,
        [
          id,
          key,
          topupCode,
          owner.technician_id,
          owner.account_id,
          amount,
          methodRow.id,
          method,
        ],
      )

      return normalizeTopup(result.rows[0])
    })
  }

  async getOwned(userId, id) {
    const owner = await this.owner(userId)

    const result = await this.db.query(
      `
      SELECT
        t.*,
        pm.code AS method

      FROM technician_topups t

      JOIN payment_methods pm
        ON pm.id = t.payment_method_id

      WHERE t.id = $1
        AND t.technician_id = $2
      `,
      [validateUuid(id), owner.technician_id],
    )

    if (!result.rowCount) {
      walletError(
        'TOPUP_NOT_FOUND',
        'Top-up not found.',
        404,
      )
    }

    return normalizeTopup(result.rows[0])
  }

  async markProcessing(id) {
    return this.transaction(async db => {
      const result = await db.query(
        `
        SELECT *
        FROM technician_topups
        WHERE id = $1
        FOR UPDATE
        `,
        [id],
      )

      const row = result.rows[0]

      if (!row) {
        walletError(
          'TOPUP_NOT_FOUND',
          'Top-up not found.',
          404,
        )
      }

      if (normalizeTopup(row).payment_status === 'PENDING') {
        await db.query(
          `
          UPDATE technician_topups
          SET payment_status = 1
          WHERE id = $1
          `,
          [id],
        )

        return true
      }

      return false
    })
  }

  async settle(id, provider, reference) {
    return this.transaction(async db => {
      const result = await db.query(
        `
        SELECT
          t.*,
          pm.code AS method

        FROM technician_topups t

        JOIN payment_methods pm
          ON pm.id = t.payment_method_id

        WHERE t.id = $1

        FOR UPDATE OF t
        `,
        [id],
      )

      const row = result.rows[0]

      if (!row || row.method !== provider) {
        return false
      }

      const status = normalizeTopup(row).payment_status

      if (status === 'SUCCESS') {
        return true
      }

      if (['FAILED', 'CANCELLED'].includes(status)) {
        return false
      }

      if (!reference || !String(reference).trim()) {
        return false
      }

      // The PostgreSQL trigger creates the TOP_UP ledger entry
      // and updates the technician balance atomically.
      // This method must only be called after provider verification.

      await db.query(
        `
        UPDATE technician_topups
        SET
          payment_status = 2,
          transaction_reference = $2,
          paid_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [id, String(reference).trim()],
      )

      return true
    })
  }

  async failVerified(id, provider, reason) {
    return this.transaction(async db => {
      const result = await db.query(
        `
        SELECT
          t.payment_status,
          pm.code AS method

        FROM technician_topups t

        JOIN payment_methods pm
          ON pm.id = t.payment_method_id

        WHERE t.id = $1

        FOR UPDATE OF t
        `,
        [id],
      )

      const row = result.rows[0]

      if (!row || row.method !== provider) {
        return false
      }

      const status = normalizeTopup(row).payment_status

      if (status === 'SUCCESS') {
        return false
      }

      if (['FAILED', 'CANCELLED'].includes(status)) {
        return true
      }

      await db.query(
        `
        UPDATE technician_topups
        SET
          payment_status = 3,
          closure_verified_at = CURRENT_TIMESTAMP,
          closure_reference = $2
        WHERE id = $1
        `,
        [
          id,
          String(reason ?? 'PROVIDER_VERIFIED_FAILED').slice(0, 150),
        ],
      )

      return true
    })
  }

  async getById(id) {
    const result = await this.db.query(
      `
      SELECT
        t.*,
        pm.code AS method

      FROM technician_topups t

      JOIN payment_methods pm
        ON pm.id = t.payment_method_id

      WHERE t.id = $1
      `,
      [validateUuid(id)],
    )

    return normalizeTopup(result.rows[0])
  }
}
