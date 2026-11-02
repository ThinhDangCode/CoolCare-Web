
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { randomUUID } from 'node:crypto'
import { pool, withTransaction } from '../src/config/database.js'
import { TechnicianWalletRepository } from '../src/modules/technician-wallet/wallet.repository.js'
import { AcceptDeclineJobRequestRepository } from '../src/modules/technician-portal/accept-decline-job-request.repository.js'

const enabled = process.env.RUN_COOLCARE_DEEP_DB === '1'
const opts = { skip: !enabled }

if (enabled) {
  after(async () => {
    await pool.end()
  })
}

async function expectNoRows(label, sql) {
  const result = await pool.query(sql)

  assert.deepEqual(
    result.rows,
    [],
    `${label}: ${JSON.stringify(result.rows.slice(0, 5))}`
  )
}

// ================================
// BOOKING
// ================================

test('D01: một booking chỉ có tối đa một thợ ACCEPTED', opts, async () => {
  await expectNoRows('Duplicate accepted booking', `
    SELECT booking_id, COUNT(*)::int AS accepted_count
    FROM booking_technicians
    WHERE status = 'ACCEPTED'
    GROUP BY booking_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `)
})

test('D02: một thợ không được ACCEPTED trùng cùng booking', opts, async () => {
  await expectNoRows('Duplicate technician assignment', `
    SELECT
      booking_id,
      technician_id,
      COUNT(*)::int AS duplicate_count
    FROM booking_technicians
    WHERE status = 'ACCEPTED'
    GROUP BY booking_id, technician_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `)
})

// ================================
// PAYMENT
// ================================

test('D03: mỗi booking có tối đa một payment SUCCESS', opts, async () => {
  await expectNoRows('Duplicate successful payment', `
    SELECT booking_id, COUNT(*)::int AS duplicate_count
    FROM payments
    WHERE payment_status = 'SUCCESS'
    GROUP BY booking_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `)
})

test('D04: một payment không được ghi ledger nhiều lần', opts, async () => {
  await expectNoRows('Duplicate payment ledger', `
    SELECT payment_id, COUNT(*)::int AS duplicate_count
    FROM settlement_transactions
    WHERE payment_id IS NOT NULL
    GROUP BY payment_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `)
})

// ================================
// WALLET / WITHDRAWAL
// ================================

test('D05: một withdrawal không được ghi ledger hai lần', opts, async () => {
  await expectNoRows('Duplicate withdrawal ledger', `
    SELECT withdrawal_id, COUNT(*)::int AS duplicate_count
    FROM settlement_transactions
    WHERE withdrawal_id IS NOT NULL
    GROUP BY withdrawal_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `)
})

test('D06: withdrawal SUCCESS phải trừ đúng số tiền', opts, async () => {
  await expectNoRows('Wrong withdrawal debit', `
    SELECT
      w.id,
      w.amount,
      COUNT(st.id)::int AS ledger_rows,
      COALESCE(SUM(st.amount), 0) AS ledger_total
    FROM withdrawals w
    LEFT JOIN settlement_transactions st
      ON st.withdrawal_id = w.id
    WHERE w.status = 'SUCCESS'
    GROUP BY w.id, w.amount
    HAVING COUNT(st.id) <> 1
      OR COALESCE(SUM(st.amount), 0) <> -w.amount
    LIMIT 10
  `)
})

test('D07: không có idempotency key rút tiền trùng', opts, async () => {
  await expectNoRows('Duplicate withdrawal key', `
    SELECT
      idempotency_key,
      COUNT(*)::int AS duplicate_count
    FROM withdrawals
    WHERE idempotency_key IS NOT NULL
    GROUP BY idempotency_key
    HAVING COUNT(*) > 1
    LIMIT 10
  `)
})

test('D08: withdrawal ledger phải tham chiếu giao dịch có thật', opts, async () => {
  await expectNoRows('Orphan withdrawal ledger', `
    SELECT st.id, st.withdrawal_id
    FROM settlement_transactions st
    LEFT JOIN withdrawals w
      ON w.id = st.withdrawal_id
    WHERE st.withdrawal_id IS NOT NULL
      AND w.id IS NULL
    LIMIT 10
  `)
})

// ================================
// REAL DATABASE INTEGRATION TEST
// Các thay đổi được ROLLBACK
// ================================

test('I01: rút tiền, retry và rollback', opts, async t => {
  const selected = (await pool.query(`
    SELECT tp.user_id
    FROM technician_profiles tp
    JOIN technician_accounts a
      ON a.technician_id = tp.id
    JOIN technician_account_balances bal
      ON bal.technician_account_id = a.id
    WHERE tp.verification_status = 'VERIFIED'
      AND tp.is_active = true
      AND bal.available_balance >= 100000
    LIMIT 1
  `)).rows[0]

  if (!selected) {
    return t.skip('Cần thợ VERIFIED có ít nhất 100000đ')
  }

  const key = randomUUID()
  const rollbackMarker = Symbol('expected rollback')

  try {
    await withTransaction(async db => {
      const repo = new TechnicianWalletRepository({
        queryable: db,
        transaction: fn => fn(db),
      })

      const input = {
        amount: 100000,
        bankName: 'ZaloPay',
        accountNumber: '0900000000',
        accountHolder: 'COOLCARE TEST',
        key,
      }

      // Lần đầu: tạo withdrawal
      const first = await repo.createMockWithdrawal(
        selected.user_id,
        input
      )

      assert.equal(first.status, 'SUCCESS')

      // Lần hai: retry cùng key
      const retry = await repo.createMockWithdrawal(
        selected.user_id,
        input
      )

      // Phải trả cùng withdrawal
      assert.equal(retry.id, first.id)

      // Kiểm tra ledger thật
      const ledger = await db.query(
        `SELECT amount
         FROM settlement_transactions
         WHERE withdrawal_id = $1`,
        [first.id]
      )

      assert.equal(ledger.rows.length, 1)
      assert.equal(Number(ledger.rows[0].amount), -100000)

      // Cùng key nhưng đổi số tiền phải bị từ chối
      await assert.rejects(
        repo.createMockWithdrawal(selected.user_id, {
          ...input,
          amount: 200000,
        }),
        error =>
          error.code === 'IDEMPOTENCY_CONFLICT' ||
          error.status === 409
      )

      // Chủ động rollback toàn bộ transaction
      throw rollbackMarker
    })
  } catch (error) {
    if (error !== rollbackMarker) throw error
  }

  // Sau rollback không được để lại withdrawal
  const remaining = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM withdrawals
     WHERE idempotency_key = $1`,
    [key]
  )

  assert.equal(remaining.rows[0].n, 0)
})

// ================================
// TECHNICIAN DECLINE JOB
// ================================

test('I02: thợ từ chối, booking trở về PENDING', opts, async t => {
  const selected = (await pool.query(`
    SELECT bt.id, tp.user_id
    FROM booking_technicians bt
    JOIN technician_profiles tp
      ON tp.id = bt.technician_id
    JOIN bookings b
      ON b.id = bt.booking_id
    WHERE bt.status = 'SELECTED'
      AND b.status = 'TECHNICIAN_SELECTED'
      AND (
        bt.expires_at IS NULL
        OR bt.expires_at > CURRENT_TIMESTAMP
      )
      AND tp.verification_status = 'VERIFIED'
      AND tp.is_active = true
    ORDER BY bt.requested_at DESC
    LIMIT 1
  `)).rows[0]

  if (!selected) {
    return t.skip('Cần booking có yêu cầu SELECTED chưa hết hạn')
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const repo = new AcceptDeclineJobRequestRepository({
      transaction: fn => fn(client),
    })

    const result = await repo.respond(
      selected.user_id,
      selected.id,
      {
        action: 'DECLINE',
        reason: 'CoolCare automated rollback test',
      }
    )

    assert.equal(result.status, 'DECLINED')
    assert.equal(result.booking.status, 'PENDING')
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})

// ================================
// CHƯA TRIỂN KHAI
// Không được tính là PASS
// ================================

test.todo(
  'I03: hai thợ ACCEPT cùng lúc qua hai connection và COMMIT'
)

test.todo(
  'I04: hai withdrawal khác key COMMIT đồng thời'
)

test.todo(
  'I05: hai callback payment đồng thời chỉ cộng ví một lần'
)

test.todo(
  'I06: retry tạo booking sau timeout không tạo booking trùng'
)
