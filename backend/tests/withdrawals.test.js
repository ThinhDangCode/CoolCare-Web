import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import {
  validateWithdrawalId,
  validateWithdrawalListQuery,
} from '../src/modules/withdrawals/withdrawals.validation.js'
import {
  WithdrawalsRepository,
  buildWithdrawalListQueries,
  WITHDRAWAL_DETAIL_SQL,
  presentWithdrawalRow,
  presentWithdrawalDetail,
} from '../src/modules/withdrawals/withdrawals.repository.js'
import { WithdrawalsService } from '../src/modules/withdrawals/withdrawals.service.js'
import { createWithdrawalsRouter } from '../src/modules/withdrawals/withdrawals.routes.js'

const id = '12345678-1234-1234-1234-123456789012'
const technicianId = '87654321-4321-4321-4321-210987654321'
const source = {
  id,
  payoutReference: null,
  technicianId,
  technicianName: 'Synthetic Person',
  technicianPhone: null,
  amount: '999999999999.99',
  feeAmount: null,
  netAmount: null,
  status: 'PENDING',
  initiatedAt: new Date('2026-10-11T17:00:00Z'),
  processedAt: null,
  paidAt: null,
  bankName: 'Synthetic bank',
  accountNumber: '000000001234',
  accountHolder: 'SYNTHETIC PERSON',
  failureReason: null,
  note: 'Private internal note',
  ledgerId: null,
  idempotency_key: 'MUST-NOT-LEAVE-SERVER',
}
const listResult = {
  items: [presentWithdrawalRow(source)],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
}

test('withdrawal filters reject unknown/repeated parameters and invalid dates/ranges/UUIDs while accepting all five statuses', () => {
  assert.deepEqual(validateWithdrawalListQuery({}), {
    page: 1,
    limit: 10,
    search: '',
    status: 'ALL',
    from: undefined,
    to: undefined,
  })
  assert.equal(validateWithdrawalId(id.toUpperCase()), id)
  assert.equal(
    validateWithdrawalListQuery({ from: '0001-01-01', to: '9999-12-31' }).from,
    '0001-01-01'
  )
  assert.equal(validateWithdrawalListQuery({ from: '2000-02-29' }).from, '2000-02-29')
  for (const status of ['ALL', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'])
    assert.equal(validateWithdrawalListQuery({ status }).status, status)
  assert.equal(
    validateWithdrawalListQuery({ search: '  %_\\literal  ', page: '1000000', limit: '100' })
      .search,
    '%_\\literal'
  )
  for (const bad of [
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '1000001' },
    { page: ['1'] },
    { limit: '101' },
    { limit: ['10'] },
    { search: ['a', 'b'] },
    { search: 'a'.repeat(151) },
    { search: 'a\u0000b' },
    { status: ['PENDING'] },
    { status: 'APPROVED' },
    { status: 'COMPLETED' },
    { from: '0000-01-01' },
    { from: '1900-02-29' },
    { from: '2026-02-29' },
    { to: '2026-04-31' },
    { from: '2026-1-01' },
    { from: ['2026-10-01'] },
    { to: '10000-01-01' },
    { from: '2026-10-02', to: '2026-10-01' },
    { method: 'CASH' },
    { technicianId },
    { sort: 'amount' },
    JSON.parse('{"__proto__":"x"}'),
  ])
    assert.throws(() => validateWithdrawalListQuery(bad), { status: 422 })
  for (const bad of [undefined, 'bad', '../id', id.replace('-', ''), [id]])
    assert.throws(() => validateWithdrawalId(bad), { status: 422 })
})

test('list/detail use exact stored strings, preserve unknown fees and leading zero bank numbers, and explicitly omit internal keys', () => {
  const item = presentWithdrawalRow(source)
  assert.equal(item.amount, '999999999999.99')
  assert.equal(item.feeAmount, null)
  assert.equal(item.netAmount, null)
  assert.equal(item.technician.phone, null)
  assert.deepEqual(
    Object.keys(item).sort(),
    [
      'id',
      'payoutReference',
      'technician',
      'amount',
      'feeAmount',
      'netAmount',
      'status',
      'initiatedAt',
      'processedAt',
      'paidAt',
    ].sort()
  )
  const detail = presentWithdrawalDetail(source)
  assert.equal(detail.bank.accountNumber, '000000001234')
  assert.equal(detail.ledger, null)
  assert.equal(JSON.stringify(item).includes('Private internal note'), false)
  assert.equal(JSON.stringify(item).includes('Synthetic bank'), false)
  assert.equal(JSON.stringify(detail).includes('MUST-NOT-LEAVE-SERVER'), false)
  const paid = presentWithdrawalDetail({
    ...source,
    status: 'SUCCESS',
    amount: '100000.00',
    feeAmount: '5000.00',
    netAmount: '95000.00',
    ledgerId: technicianId,
    ledgerType: 'WITHDRAWAL',
    ledgerAmount: '-100000.00',
    balanceBefore: '120000.00',
    balanceAfter: '20000.00',
    ledgerCreatedAt: new Date(),
    ledgerReferenceId: null,
  })
  assert.equal(paid.amount, '100000.00')
  assert.equal(paid.ledger.amount, '-100000.00')
  assert.equal(paid.ledger.balanceAfter, '20000.00')
  assert.equal(paid.ledger.referenceId, null)
})

test('queries bind literal search, fixed UTC+7 initiation bounds and stable pagination; detail requires correct ledger account/type/owner', () => {
  const filters = validateWithdrawalListQuery({
    search: 'a%_\\',
    status: 'PROCESSING',
    from: '1900-01-01',
    to: '9999-12-31',
    page: '2',
    limit: '1',
  })
  const queries = buildWithdrawalListQueries(filters)
  assert.deepEqual(queries.values, ['%a\\%\\_\\\\%', 'PROCESSING', '1900-01-01', '9999-12-31'])
  assert.deepEqual(queries.rowValues, [...queries.values, 1, 1])
  assert.match(queries.rowsSql, /ORDER BY w.initiated_at DESC,w.id DESC/)
  assert.match(
    queries.countSql,
    /w.initiated_at >= \(\$3::date::timestamp AT TIME ZONE INTERVAL '\+07:00'\)/
  )
  assert.match(
    queries.rowsSql,
    /w.initiated_at < \(\(\$4::date\+1\)::timestamp AT TIME ZONE INTERVAL '\+07:00'\)/
  )
  assert.equal(queries.rowsSql.includes('w.paid_at >='), false)
  assert.equal(queries.rowsSql.includes('settlement_transactions'), false)
  assert.equal(queries.rowsSql.includes('bank_name'), false)
  assert.match(
    WITHDRAWAL_DETAIL_SQL,
    /a.id=w.technician_account_id AND a.technician_id=w.technician_id/
  )
  assert.match(WITHDRAWAL_DETAIL_SQL, /st.withdrawal_id=w.id/)
  assert.match(
    WITHDRAWAL_DETAIL_SQL,
    /st.transaction_type='WITHDRAWAL' AND st.technician_account_id=w.technician_account_id/
  )
  assert.match(WITHDRAWAL_DETAIL_SQL, /a.id=st.technician_account_id/)
  assert.equal(WITHDRAWAL_DETAIL_SQL.includes('settlement_balance'), false)
})

test('repository count/rows and details are read-only snapshots; pending rows do not require a ledger', async () => {
  const calls = []
  const repository = new WithdrawalsRepository({
    transaction: async (work) =>
      work({
        query: async (sql, values) => {
          calls.push({ sql, values })
          if (sql.startsWith('SELECT count(*)')) return { rows: [{ total: 1 }] }
          return { rows: sql.startsWith('SET ') ? [] : [source] }
        },
      }),
  })
  const result = await repository.listWithdrawals(
    validateWithdrawalListQuery({ page: '2', limit: '1' })
  )
  assert.equal(result.items[0].status, 'PENDING')
  assert.equal(result.pagination.total, 1)
  assert.equal(calls[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.deepEqual(calls[2].values, [1, 1])
  const detail = await repository.getWithdrawal(id)
  assert.equal(detail.ledger, null)
  assert.equal(calls[3].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.deepEqual(calls[4].values, [id])
})

test('list/detail audit excludes raw search, bank, money, phones and notes; invalid/missing/failed reads do not audit', async () => {
  const events = []
  const detail = presentWithdrawalDetail(source)
  const service = new WithdrawalsService(
    { listWithdrawals: async () => listResult, getWithdrawal: async () => detail },
    { audit: (event) => events.push(event) }
  )
  await service.listWithdrawals({ search: 'Sensitive Name 0901234567' }, technicianId)
  await service.getWithdrawal(id, technicianId)
  assert.equal(events[0].action, 'READ_LIST')
  assert.equal(events[0].after.hasSearch, true)
  assert.equal(events[1].action, 'READ_DETAIL')
  assert.equal(events[1].entityId, id)
  assert.deepEqual(events[1].after, { status: 'PENDING' })
  for (const value of [
    'Sensitive Name',
    '0901234567',
    'Synthetic Person',
    'Synthetic bank',
    '000000001234',
    '999999999999.99',
    'Private internal note',
  ])
    assert.equal(JSON.stringify(events).includes(value), false)
  await assert.rejects(service.listWithdrawals({ limit: '101' }, technicianId), { status: 422 })
  await assert.rejects(service.getWithdrawal('invalid', technicianId), { status: 422 })
  await assert.rejects(service.getWithdrawal(id, technicianId, { page: '1' }), { status: 422 })
  const absent = new WithdrawalsService(
    { getWithdrawal: async () => null },
    { audit: (event) => events.push(event) }
  )
  await assert.rejects(absent.getWithdrawal(id, technicianId), {
    status: 404,
    code: 'WITHDRAWAL_NOT_FOUND',
  })
  const failing = new WithdrawalsService(
    {
      listWithdrawals: async () => {
        throw new Error('DB unavailable')
      },
    },
    { audit: (event) => events.push(event) }
  )
  await assert.rejects(failing.listWithdrawals({}, technicianId), { message: 'DB unavailable' })
  assert.equal(events.length, 2)
})

test('Admin GET routes enforce auth/no-store/contracts/status validation and reject approval, payouts and mutations', async () => {
  const calls = []
  const app = express()
  app.use(
    '/api/admin/withdrawals',
    createWithdrawalsRouter(
      {
        listWithdrawals: async (filters) => {
          calls.push(filters)
          return listResult
        },
        getWithdrawal: async (value) => (value === id ? presentWithdrawalDetail(source) : null),
      },
      { audit: () => {} }
    )
  )
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}/api/admin/withdrawals`
  const sign = (role, expiresIn = '5m') =>
    jwt.sign({ sub: technicianId, role, purpose: 'access' }, env.jwtSecret, { expiresIn })
  const request = (path = '', token, method = 'GET') =>
    fetch(`${base}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  try {
    for (const path of ['', `/${id}`]) {
      assert.equal((await request(path)).status, 401)
      assert.equal((await request(path, 'bad-token')).status, 401)
      assert.equal((await request(path, sign('ADMIN', '-1s'))).status, 401)
      assert.equal((await request(path, sign('CUSTOMER'))).status, 403)
      assert.equal((await request(path, sign('TECHNICIAN'))).status, 403)
    }
    const admin = sign('ADMIN')
    for (const path of [
      '?status=APPROVED',
      '?page=1&page=2',
      '?sort=amount',
      '?to=2026-02-29',
      '/invalid',
      `/${id}?page=1`,
    ])
      assert.equal((await request(path, admin)).status, 422)
    assert.equal(calls.length, 0)
    const response = await request('?status=PENDING&from=2026-10-01&to=2026-10-31', admin)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(
      await response.json(),
      JSON.parse(JSON.stringify({ success: true, data: listResult }))
    )
    assert.equal(calls[0].status, 'PENDING')
    const detail = await request(`/${id}`, admin)
    assert.equal(detail.status, 200)
    assert.equal(detail.headers.get('cache-control'), 'no-store')
    assert.equal((await detail.json()).data.bank.accountNumber, '000000001234')
    const missing = await request(`/${technicianId}`, admin)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'WITHDRAWAL_NOT_FOUND')
    for (const method of ['POST', 'PATCH', 'DELETE'])
      for (const path of ['', `/${id}`, `/${id}/approve`, `/${id}/status`, `/${id}/payout`])
        assert.equal((await request(path, admin, method)).status, 404)
    assert.equal(calls.length, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
