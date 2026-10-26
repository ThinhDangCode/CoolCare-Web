import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test, { after } from 'node:test'

import { pool, withTransaction } from '../src/config/database.js'
import { TechnicianWalletRepository } from '../src/modules/technician-wallet/wallet.repository.js'

const enabled = process.env.RUN_REVISED_DB_TESTS === '1'
if (enabled) after(async () => { await pool.end() })

test('revised database top-up status, trigger ledger and replay remain atomic', {
  skip: !enabled,
}, async t => {
  const users = await pool.query(`
    SELECT tp.user_id
    FROM technician_profiles tp
    JOIN technician_accounts a ON a.technician_id = tp.id
    WHERE tp.verification_status = 1 AND tp.is_active = true
    LIMIT 1
  `)
  const methods = await pool.query(`
    SELECT code FROM payment_methods
    WHERE is_active = true AND is_online = true
      AND code IN ('VNPAY', 'ZALOPAY')
    LIMIT 1
  `)
  if (!users.rows.length || !methods.rows.length) {
    t.skip('No verified technician and active sandbox method in local database')
    return
  }

  const key = randomUUID()
  const rollback = Symbol('rollback fixture')
  try {
    await withTransaction(async db => {
      const repo = new TechnicianWalletRepository({
        queryable: db,
        transaction: work => work(db),
      })
      const method = methods.rows[0].code
      const row = await repo.create(users.rows[0].user_id, {
        amount: 100000, method, key,
      })
      assert.equal(row.payment_status, 'PENDING')
      assert.equal(await repo.markProcessing(row.id), true)
      assert.equal((await repo.getById(row.id)).payment_status, 'PROCESSING')
      assert.equal(await repo.settle(row.id, method, 'ROLLBACK-TEST-REFERENCE'), true)
      assert.equal((await repo.getById(row.id)).payment_status, 'SUCCESS')
      assert.equal(await repo.settle(row.id, method, 'REPLAY-REFERENCE'), true)
      assert.equal(await repo.failVerified(row.id, method, 'LATE-FAILURE'), false)
      const ledger = await db.query(
        'SELECT count(*)::int AS total FROM settlement_transactions WHERE topup_id = $1',
        [row.id],
      )
      assert.equal(ledger.rows[0].total, 1)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }

  const remaining = await pool.query(
    'SELECT count(*)::int AS total FROM technician_topups WHERE idempotency_key = $1',
    [key],
  )
  assert.equal(remaining.rows[0].total, 0)
})

test('mock withdrawal replay keeps the success response and rolls back the ledger', {
  skip: !enabled,
}, async t => {
  const eligible = await pool.query(`
    SELECT tp.user_id
    FROM technician_profiles tp
    JOIN technician_accounts a ON a.technician_id = tp.id
    JOIN technician_account_balances balance ON balance.technician_account_id = a.id
    WHERE tp.verification_status = 1 AND tp.is_active = true
      AND balance.available_balance >= 100000
    LIMIT 1
  `)
  if (!eligible.rows.length) {
    t.skip('No verified technician with 100000 VND available')
    return
  }

  const key = randomUUID()
  const rollback = Symbol('rollback mock withdrawal')
  try {
    await withTransaction(async db => {
      const repository = new TechnicianWalletRepository({
        queryable: db,
        transaction: work => work(db),
      })
      const input = {
        amount: 100000,
        bankName: 'ZaloPay',
        accountNumber: '0900000000',
        accountHolder: 'Rollback Test',
        key,
      }
      const first = await repository.createMockWithdrawal(eligible.rows[0].user_id, input)
      const replay = await repository.createMockWithdrawal(eligible.rows[0].user_id, input)
      assert.equal(first.status, 'SUCCESS')
      assert.equal(first.simulated, true)
      assert.equal(replay.status, first.status)
      assert.equal(replay.simulated, true)
      assert.equal(replay.id, first.id)
      assert.equal(replay.payoutReference, first.payoutReference)
      const ledger = await db.query(
        'SELECT count(*)::int AS total FROM settlement_transactions WHERE withdrawal_id = $1',
        [first.id],
      )
      assert.equal(ledger.rows[0].total, 1)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }

  const remaining = await pool.query(
    'SELECT count(*)::int AS total FROM withdrawals WHERE idempotency_key = $1',
    [key],
  )
  assert.equal(remaining.rows[0].total, 0)
})
