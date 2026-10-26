import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { pool } from '../src/config/database.js'
import { adaptDatabaseQuery } from '../src/config/database-codebook-adapter.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { AppError } from '../src/utils.js'
import { validateSettlementId, validateSettlementListQuery, validateSettlementDetailQuery } from '../src/modules/settlements/settlements.validation.js'
import {
  buildSettlementListQueries, SETTLEMENT_DETAIL_SQL, SETTLEMENT_TRANSACTION_COUNT_SQL,
  SETTLEMENT_TRANSACTIONS_SQL, SETTLEMENT_INCOME_SQL, presentSettlement,
  presentSettlementTransaction, SettlementsRepository,
} from '../src/modules/settlements/settlements.repository.js'
import { SettlementsService } from '../src/modules/settlements/settlements.service.js'
import { createSettlementsRouter } from '../src/modules/settlements/settlements.routes.js'

const id = '10000000-0000-0000-0000-000000000001'
const absentId = '10000000-0000-0000-0000-000000000002'
const actorId = '20000000-0000-0000-0000-000000000001'
const readAt = new Date('2026-10-25T00:00:00Z')
const raw = {
  id, code: 'TEST-SETTLEMENT', technicianId: actorId, technicianName: 'Synthetic Technician',
  technicianPhone: '0900000000', avatarUrl: 'https://example.com/avatar.png',
  periodStart: new Date('2026-10-18T17:00:00Z'), periodEnd: new Date('2026-10-25T17:00:00Z'),
  stateCode: 3, finalizedAt: new Date('2026-10-25T17:01:00Z'), dueAt: new Date('2026-10-28T17:00:00Z'),
  openingBalance: '-999999999999.99', cashSettlement: '0.01', onlineEarning: '0.02', topup: '0.03',
  withdrawal: '0.04', adjustment: '-0.05', closingBalance: '-1000000000000.02', debtAmount: '0.03',
  debtRemainingAmount: '0.01', readAt,
  provider_token: 'PRIVATE', idempotency_key: 'PRIVATE', bank_account: 'PRIVATE', status: 1,
}
const row = presentSettlement(raw)
const summary = { totalPeriods: 11, openPeriods: 2, owingPeriods: 4, settledPeriods: 5, remainingDebt: '0.03' }
const income = { technicianEarning: '0.03', commissionAmount: '0.01', matchedPayments: 2, unavailablePaymentCount: 0 }
const txRaw = { id, createdAt: readAt, transactionCode: 0, description: 'Synthetic ledger row', amount: '-0.01',
  balanceBefore: '0.02', balanceAfter: '0.01', source: { type: 'PAYMENT', id, code: 'TEST-PAY', secret: 'PRIVATE' },
  provider_token: 'PRIVATE', reference_id: 'PRIVATE' }
const tx = presentSettlementTransaction(txRaw)
const result = { items: [row], pagination: { page: 1, limit: 10, total: 11, totalPages: 2 }, summary, readAt }
const detail = { ...row, readAt, income, transactions: { items: [tx], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } } }

test('settlement query validation rejects malformed, repeated, unsupported and unbounded input', () => {
  assert.deepEqual(validateSettlementListQuery(), { search: '', status: 'ALL', from: undefined, to: undefined, page: 1, limit: 10 })
  for (const status of ['ALL', 'OPEN', 'CALCULATED', 'SETTLED', 'OVERDUE']) assert.equal(validateSettlementListQuery({ status }).status, status)
  for (const limit of ['10', '25', '50']) assert.equal(validateSettlementListQuery({ limit }).limit, Number(limit))
  assert.equal(validateSettlementListQuery({ page: '1000000', search: '  %_\\ ' }).search, '%_\\')
  assert.equal(validateSettlementListQuery({ from: '0001-01-01', to: '9999-12-31' }).from, '0001-01-01')
  assert.equal(validateSettlementListQuery({ from: '2000-02-29' }).from, '2000-02-29')
  for (const query of [{ page: 1 }, { page: '0' }, { page: '1.2' }, { page: '1000001' }, { page: ['1'] },
    { limit: '20' }, { limit: ['10'] }, { limit: null }, { status: 'SUCCESS' }, { status: ['OPEN'] },
    { from: '2026-02-29' }, { from: '0000-01-01' }, { from: '2026-1-01' }, { to: '1900-02-29' },
    { from: ['2026-10-01'] }, { from: '2026-10-02', to: '2026-10-01' },
    { search: ['name'] }, { search: 'x'.repeat(151) }, { search: 'name\nphone' }, { search: 'a\u0000b' },
    { sort: 'amount' }, { technicianId: id }, { transactionsPage: '1' }])
    assert.throws(() => validateSettlementListQuery(query), { status: 422 })
})

test('settlement detail validates UUID and transaction pagination separately', () => {
  assert.equal(validateSettlementId(id.toUpperCase()), id)
  assert.equal(validateSettlementId('A0000000-0000-0000-0000-000000000001'), 'a0000000-0000-0000-0000-000000000001')
  for (const value of [null, undefined, '', 'bad', [id], {}, `${id}' OR true --`]) assert.throws(() => validateSettlementId(value), { status: 422 })
  assert.deepEqual(validateSettlementDetailQuery(), { page: 1, limit: 10 })
  assert.deepEqual(validateSettlementDetailQuery({ transactionsPage: '2', transactionsLimit: '25' }), { page: 2, limit: 25 })
  for (const query of [{ page: '1' }, { from: '2026-10-01' }, { transactionsPage: '0' }, { transactionsPage: '1000001' },
    { transactionsPage: ['1'] }, { transactionsLimit: '20' }, { transactionsLimit: ['10'] }])
    assert.throws(() => validateSettlementDetailQuery(query), { status: 422 })
})

test('settlement list binds literal search and inclusive UTC7 period-start dates, with effective status and global summary', () => {
  const search = "%'_\\ OR true --"
  const query = buildSettlementListQueries(validateSettlementListQuery({ search, status: 'OVERDUE',
    from: '2026-10-01', to: '2026-10-31', page: '2', limit: '25' }))
  assert.deepEqual(query.values, ["%\\%'\\_\\\\ OR true --%", 3, '2026-10-01', '2026-10-31'])
  assert.deepEqual(query.rowValues, [...query.values, 25, 25])
  for (const sql of [query.rowsSql, query.summarySql]) {
    assert.equal(sql.includes(search), false)
    assert.match(sql, /d\.effective_status=\$2::smallint/)
    assert.match(sql, /s\.period_start >= .*AT TIME ZONE INTERVAL '\+07:00'/)
    assert.match(sql, /s\.period_start < .*::date\+1/)
    assert.match(sql, /a\.technician_id=s\.technician_id/)
    assert.doesNotMatch(sql, /s\.status|CURRENT_DATE|due_at\s*</)
    const adapted = adaptDatabaseQuery(sql, sql === query.rowsSql ? query.rowValues : query.values)
    assert.deepEqual(adapted.params, sql === query.rowsSql ? query.rowValues : query.values)
  }
  assert.match(query.rowsSql, /ORDER BY s\.period_start DESC,s\.id DESC/)
  assert.doesNotMatch(query.summarySql, /LIMIT|OFFSET/)
  assert.match(query.summarySql, /WHEN count\(\*\)=0 THEN '0\.00'/)
  assert.match(query.summarySql, /WHERE s\.finalized_at IS NOT NULL\)=0 THEN NULL/)
  assert.match(query.summarySql, /sum\(d\.debt_remaining_amount\)/)
  assert.doesNotMatch(query.summarySql, /sum\([^)]*closing_balance/)
})

test('settlement presentation maps numeric view status, retains exact amounts and never calls OPEN placeholder totals final', () => {
  assert.equal(row.status, 'OVERDUE')
  assert.equal(row.totals.openingBalance, '-999999999999.99')
  assert.equal(row.totals.closingBalance, '-1000000000000.02')
  assert.equal(row.totals.debtRemainingAmount, '0.01')
  for (const [stateCode, status] of [[0, 'OPEN'], [1, 'CALCULATED'], [2, 'SETTLED'], [3, 'OVERDUE']])
    assert.equal(presentSettlement({ ...raw, stateCode }).status, status)
  const open = presentSettlement({ ...raw, finalizedAt: null, stateCode: 0 })
  assert.ok(Object.values(open.totals).every((value) => value === null))
  assert.equal(presentSettlement({ ...raw, avatarUrl: 'javascript:alert(1)' }).technician.avatarUrl, null)
  for (const secret of ['PRIVATE', 'provider_token', 'idempotency_key', 'bank_account']) assert.equal(JSON.stringify(row).includes(secret), false)
})

test('settlement ledger responses expose only public source identity and exact signed movement', () => {
  assert.equal(tx.type, 'CASH_SETTLEMENT')
  assert.equal(tx.amount, '-0.01')
  assert.deepEqual(tx.source, { type: 'PAYMENT', id, code: 'TEST-PAY' })
  for (const [transactionCode, type] of [[0, 'CASH_SETTLEMENT'], [1, 'ONLINE_EARNING'], [2, 'TOP_UP'], [3, 'WITHDRAWAL'], [4, 'ADJUSTMENT']])
    assert.equal(presentSettlementTransaction({ ...txRaw, transactionCode }).type, type)
  assert.equal(presentSettlementTransaction({ ...txRaw, source: null }).source, null)
  assert.equal(JSON.stringify(tx).includes('PRIVATE'), false)
})

test('detail queries guard account, membership and exclusive end; income requires trustworthy deduplicated payment evidence', () => {
  for (const sql of [SETTLEMENT_TRANSACTION_COUNT_SQL, SETTLEMENT_TRANSACTIONS_SQL, SETTLEMENT_INCOME_SQL]) {
    assert.match(sql, /t\.technician_account_id=s\.technician_account_id/)
    assert.match(sql, /t\.created_at>=s\.period_start AND t\.created_at<s\.period_end/)
    assert.match(sql, /si\.settlement_id=s\.id AND si\.settlement_transaction_id=t\.id/)
    assert.match(sql, /s\.id=\$1::uuid/)
    assert.doesNotMatch(sql, /provider_token|idempotency_key|account_number|fee_amount|p\.paid_at/)
  }
  assert.match(SETTLEMENT_TRANSACTION_COUNT_SQL, /s\.finalized_at IS NULL OR EXISTS/)
  assert.match(SETTLEMENT_INCOME_SQL, /GROUP BY evidence\.payment_id/)
  assert.match(SETTLEMENT_INCOME_SQL, /p\.payment_status=2 AND p\.settled_at IS NOT NULL/)
  assert.match(SETTLEMENT_INCOME_SQL, /p\.technician_id=s\.technician_id/)
  assert.match(SETTLEMENT_INCOME_SQL, /t\.amount=p\.platform_discount_amount-p\.commission_amount/)
  assert.match(SETTLEMENT_INCOME_SQL, /t\.amount=p\.technician_earning/)
  assert.match(SETTLEMENT_INCOME_SQL, /THEN NULL/)
  assert.doesNotMatch(SETTLEMENT_INCOME_SQL, /LIMIT|OFFSET/)
  assert.match(SETTLEMENT_TRANSACTIONS_SQL, /ORDER BY t\.created_at DESC,t\.id DESC LIMIT \$2 OFFSET \$3/)
  for (const sql of [SETTLEMENT_DETAIL_SQL, SETTLEMENT_INCOME_SQL, SETTLEMENT_TRANSACTIONS_SQL])
    assert.deepEqual(adaptDatabaseQuery(sql, [id, 10, 0]).params, [id, 10, 0])
})

test('list repository keeps filtered rows, count, summary and readAt in one repeatable-read read-only snapshot', async () => {
  const calls = []
  const repository = new SettlementsRepository({ transaction: async (work) => work({ query: async (sql, values) => {
    calls.push({ sql, values })
    if (sql.includes('AS "totalPeriods"')) return { rows: [{ ...summary, readAt }] }
    return { rows: sql.startsWith('SET TRANSACTION') ? [] : [raw] }
  } }) })
  const result = await repository.listSettlements(validateSettlementListQuery({ page: '2', limit: '10' }))
  assert.equal(calls[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(calls.length, 3)
  assert.deepEqual(result.summary, summary)
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 11, totalPages: 2 })
  assert.equal(result.readAt, readAt)
  assert.equal(result.items[0].status, 'OVERDUE')
  assert.deepEqual(calls[2].values, [10, 10])
})

test('detail repository has paginated ledger, whole-period income, OPEN null income and early missing return', async () => {
  const calls = []
  let current = raw
  const repository = new SettlementsRepository({ transaction: async (work) => work({ query: async (sql, values) => {
    calls.push({ sql, values })
    if (sql === SETTLEMENT_DETAIL_SQL) return { rows: current ? [current] : [] }
    if (sql === SETTLEMENT_TRANSACTION_COUNT_SQL) return { rows: [{ total: 12 }] }
    if (sql === SETTLEMENT_TRANSACTIONS_SQL) return { rows: [txRaw] }
    if (sql === SETTLEMENT_INCOME_SQL) return { rows: [income] }
    return { rows: [] }
  } }) })
  const result = await repository.getSettlement(id, { page: 2, limit: 10 })
  assert.equal(calls[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.deepEqual(result.income, income)
  assert.equal(result.readAt, readAt)
  assert.deepEqual(result.transactions.pagination, { page: 2, limit: 10, total: 12, totalPages: 2 })
  assert.deepEqual(calls.find((call) => call.sql === SETTLEMENT_TRANSACTIONS_SQL).values, [id, 10, 10])
  assert.deepEqual(calls.find((call) => call.sql === SETTLEMENT_INCOME_SQL).values, [id])
  const beforeOpen = calls.length
  current = { ...raw, finalizedAt: null, stateCode: 0 }
  const open = await repository.getSettlement(id)
  assert.deepEqual(open.income, { technicianEarning: null, commissionAmount: null, matchedPayments: null, unavailablePaymentCount: null })
  assert.equal(calls.slice(beforeOpen).some((call) => call.sql === SETTLEMENT_INCOME_SQL), false)
  current = null
  const beforeMissing = calls.length
  assert.equal(await repository.getSettlement(absentId), null)
  assert.equal(calls.length - beforeMissing, 2)
})

test('successful read audits omit raw search, financial and technician data, and failed reads create no success audit', async () => {
  const events = []
  const service = new SettlementsService({ listSettlements: async () => result, getSettlement: async (key) => key === id ? detail : null },
    { audit: (event) => events.push(event) })
  assert.equal(await service.listSettlements({ search: 'Private Name 0911111111' }, actorId), result)
  assert.equal(await service.getSettlement(id, { transactionsPage: '2' }, actorId), detail)
  assert.equal(events[0].action, 'READ_LIST')
  assert.equal(events[0].after.hasSearch, true)
  assert.equal(events[1].action, 'READ_DETAIL')
  assert.equal(events[1].after.page, 2)
  assert.equal(events[1].after.status, 'OVERDUE')
  for (const value of ['Private Name', '0911111111', raw.technicianName, raw.technicianPhone, raw.code, raw.closingBalance])
    assert.equal(JSON.stringify(events).includes(value), false)
  await assert.rejects(service.getSettlement('bad', {}, actorId), { status: 422 })
  await assert.rejects(service.getSettlement(absentId, {}, actorId), { status: 404, code: 'SETTLEMENT_NOT_FOUND' })
  await assert.rejects(service.listSettlements({ status: 'REFUNDED' }, actorId), { status: 422 })
  const failed = new SettlementsService({ listSettlements: async () => { throw new Error('Database unavailable') } }, { audit: (event) => events.push(event) })
  await assert.rejects(failed.listSettlements({}, actorId), { message: 'Database unavailable' })
  assert.equal(events.length, 2)
})

test('list and detail routes require Admin, are no-store including errors, validate filters, and expose no mutation', async () => {
  let reads = 0
  let fail = false
  const app = express()
  app.use('/api/admin/settlements', createSettlementsRouter({ listSettlements: async () => {
    reads += 1
    if (fail) throw new AppError(503, 'TEMPORARY_UNAVAILABLE', 'Temporary unavailable')
    return result
  }, getSettlement: async (key) => {
    reads += 1
    if (fail) throw new AppError(503, 'TEMPORARY_UNAVAILABLE', 'Temporary unavailable')
    return key === id ? detail : null
  } }, { audit: () => {} }))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const base = `http://127.0.0.1:${server.address().port}/api/admin/settlements`
  const sign = (role, expiresIn = '5m') => jwt.sign({ sub: actorId, role, purpose: 'access' }, env.jwtSecret, { expiresIn })
  const request = (path = '', auth, method = 'GET') => fetch(`${base}${path}`, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {} })
  const original = pool.query
  try {
    for (const auth of [undefined, 'bad-token', sign('ADMIN', '-1s')]) for (const path of ['', `/${id}`]) {
      const response = await request(path, auth)
      assert.equal(response.status, 401)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    pool.query = async () => ({ rows: [{ status: 'ACTIVE' }] })
    for (const role of ['CUSTOMER', 'TECHNICIAN']) for (const path of ['', `/${id}`]) {
      const response = await request(path, sign(role))
      assert.equal(response.status, 403)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    pool.query = original
    const admin = sign('ADMIN')
    for (const path of ['?status=SUCCESS', '?status=OPEN&status=OPEN', '?search=a&search=b', '?page=1000001', '?limit=20',
      '?from=2026-02-29', '?sort=amount', '/bad', `/${id}?transactionsLimit=20`, `/${id}?transactionsPage=0`,
      `/${id}?transactionsPage=1&transactionsPage=2`, `/${id}?search=name`]) {
      const response = await request(path, admin)
      assert.equal(response.status, 422, path)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    assert.equal(reads, 0)
    for (const [path, expected] of [['?status=OVERDUE', result], [`/${id}?transactionsLimit=25`, detail]]) {
      const response = await request(path, admin)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.deepEqual(await response.json(), JSON.parse(JSON.stringify({ success: true, data: expected })))
    }
    const missing = await request(`/${absentId}`, admin)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'SETTLEMENT_NOT_FOUND')
    assert.equal(missing.headers.get('cache-control'), 'no-store')
    for (const method of ['POST', 'PATCH', 'DELETE']) for (const path of ['', `/${id}`]) {
      const response = await request(path, admin, method)
      assert.equal(response.status, 404)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    fail = true
    for (const path of ['', `/${id}`]) {
      const response = await request(path, admin)
      assert.equal(response.status, 503)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
  } finally {
    pool.query = original
    await new Promise((resolve) => server.close(resolve))
  }
})

test.after(async () => { await pool.end() })
