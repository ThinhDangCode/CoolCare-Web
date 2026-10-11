import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { createSettlementRouter } from '../src/modules/settlement/settlement.routes.js'
import { SettlementRepository } from '../src/modules/settlement/settlement.repository.js'
import { SettlementService } from '../src/modules/settlement/settlement.service.js'
import {
  validateWithdrawalId,
  validateWithdrawalListQuery,
} from '../src/modules/settlement/settlement.validation.js'

const withdrawalId = '12345678-1234-1234-1234-123456789012'
const missingId = '00000000-0000-0000-0000-000000000000'

test('withdrawal filters reject malformed pagination, repeated values and impossible dates', () => {
  for (const query of [
    { page: '1.5' },
    { page: '' },
    { page: ['1', '2'] },
    { limit: '101' },
    { status: 'REJECTED' },
    { technician_id: 'invalid' },
    { search: ['a', 'b'] },
    { from_date: '2026-02-29' },
    { to_date: '2026-04-31' },
    { from_date: '2026-10-12', to_date: '2026-10-11' },
  ]) {
    assert.throws(() => validateWithdrawalListQuery(query), { status: 422 })
  }
  const filters = validateWithdrawalListQuery({
    search: ' Hai ',
    from_date: '2024-02-29',
    to_date: '2024-02-29',
  })
  assert.equal(filters.search, 'Hai')
  assert.equal(filters.page, 1)
  assert.equal(filters.limit, 10)
  assert.equal(filters.status, 'ALL')
})

test('withdrawal detail rejects invalid UUIDs before querying and reports a missing request', async () => {
  let calls = 0
  const service = new SettlementService({
    async getWithdrawal(id) {
      calls += 1
      assert.equal(id, missingId)
      return null
    },
  })
  for (const id of [undefined, '', 'WD001', 123, [withdrawalId], `${withdrawalId}' OR true`]) {
    assert.throws(() => validateWithdrawalId(id), { status: 422 })
    await assert.rejects(service.getWithdrawal(id), { status: 422 })
  }
  assert.equal(calls, 0)
  assert.equal(validateWithdrawalId(withdrawalId), withdrawalId)
  await assert.rejects(service.getWithdrawal(missingId), {
    status: 404,
    code: 'WITHDRAWAL_NOT_FOUND',
  })
  assert.equal(calls, 1)
})

test('withdrawal detail routes require Admin access, preserve unknown amounts and remain read-only', async () => {
  const calls = []
  const detail = {
    id: withdrawalId,
    status: 'PENDING',
    amount: '200000.00',
    fee_amount: null,
    net_amount: null,
    current_settlement_balance: '500000.00',
    reserved_amount: '200000.00',
    available_balance: '300000.00',
    settlement_transactions: [],
  }
  const repository = {
    async getWithdrawal(id) {
      calls.push(id)
      return id === withdrawalId ? detail : null
    },
  }
  const app = express()
  app.use('/api/admin/settlement', createSettlementRouter(repository))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/admin/settlement/withdrawals`
  const sign = (role) =>
    jwt.sign({ sub: withdrawalId, role, purpose: 'access' }, env.jwtSecret, { expiresIn: '5m' })
  const admin = sign('ADMIN')
  async function request(id, token, method = 'GET') {
    return fetch(`${base}/${id}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  }
  try {
    assert.equal((await request(withdrawalId)).status, 401)
    assert.equal((await request(withdrawalId, 'bad-token')).status, 401)
    assert.equal((await request(withdrawalId, sign('CUSTOMER'))).status, 403)
    assert.equal((await request('WD001', admin)).status, 422)
    assert.equal(calls.length, 0)
    const result = await request(withdrawalId, admin)
    assert.equal(result.status, 200)
    assert.deepEqual(await result.json(), { data: detail })
    const missing = await request(missingId, admin)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'WITHDRAWAL_NOT_FOUND')
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      assert.equal((await request(withdrawalId, admin, method)).status, 404)
    }
    assert.deepEqual(calls, [withdrawalId, missingId])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test(
  'withdrawal detail reads local pending and paid fixtures with correct balances and ledger, without changes',
  { skip: process.env.RUN_SETTLEMENT_DB_TESTS !== '1' },
  async () => {
    const { pool } = await import('../src/config/database.js')
    const snapshot = async () => {
      const results = await Promise.all(
        ['withdrawals', 'technician_accounts', 'settlement_transactions'].map((table) =>
          pool.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS rows FROM ${table} t`)
        )
      )
      return results.map((result) => result.rows[0].rows)
    }
    try {
      const before = await snapshot()
      const fixtures = (
        await pool.query(
          `SELECT w.id, w.status, w.technician_account_id, w.amount,
            w.fee_amount, w.net_amount, a.settlement_balance,
            a.settlement_balance - COALESCE((
              SELECT SUM(active.amount) FROM withdrawals active
              WHERE active.technician_account_id = a.id
                AND active.status IN ('PENDING', 'PROCESSING')
            ), 0::numeric) AS available_balance
           FROM withdrawals w
           JOIN technician_accounts a ON a.id = w.technician_account_id
           WHERE w.status IN ('PENDING', 'SUCCESS')
           ORDER BY w.id`
        )
      ).rows
      assert.ok(
        fixtures.some((row) => row.status === 'PENDING'),
        'Needs a pending local fixture'
      )
      assert.ok(
        fixtures.some((row) => row.status === 'SUCCESS'),
        'Needs a paid local fixture'
      )
      const repository = new SettlementRepository()
      for (const fixture of fixtures) {
        const detail = await repository.getWithdrawal(fixture.id)
        assert.equal(detail.amount, fixture.amount)
        assert.equal(detail.fee_amount, fixture.fee_amount)
        assert.equal(detail.net_amount, fixture.net_amount)
        assert.equal(detail.current_settlement_balance, fixture.settlement_balance)
        assert.equal(detail.available_balance, fixture.available_balance)
        assert.equal(typeof detail.reserved_amount, 'string')
        assert.ok(detail.technician_name && detail.technician_email)
        assert.ok(detail.account_number && detail.account_holder && detail.bank_name)
        assert.ok(detail.read_at instanceof Date)
        const ledger = (
          await pool.query(
            'SELECT id FROM settlement_transactions WHERE withdrawal_id = $1 ORDER BY created_at, id',
            [fixture.id]
          )
        ).rows
        assert.deepEqual(
          detail.settlement_transactions.map((row) => row.id),
          ledger.map((row) => row.id)
        )
        for (const transaction of detail.settlement_transactions) {
          assert.equal(transaction.transaction_type, 'WITHDRAWAL')
          assert.equal(typeof transaction.amount, 'string')
          assert.equal(typeof transaction.balance_before, 'string')
          assert.equal(typeof transaction.balance_after, 'string')
        }
      }
      assert.equal(await repository.getWithdrawal(missingId), null)
      assert.deepEqual(await snapshot(), before)
    } finally {
      await pool.end()
    }
  }
)
