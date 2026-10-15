import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { validateTopupId, validateTopupListQuery } from '../src/modules/topups/topups.validation.js'
import {
  TopupsRepository,
  buildTopupListQueries,
  TOPUP_DETAIL_SQL,
  TOPUP_METHOD_OPTIONS_SQL,
  presentTopupRow,
  presentTopupDetail,
} from '../src/modules/topups/topups.repository.js'
import { TopupsService } from '../src/modules/topups/topups.service.js'
import { createTopupsRouter } from '../src/modules/topups/topups.routes.js'

const id = '12345678-1234-1234-1234-123456789012'
const actorId = '87654321-4321-4321-4321-210987654321'
const methodId = 'abcdefab-abcd-abcd-abcd-abcdefabcdef'
const unusedMethodId = 'abcdefab-abcd-abcd-abcd-abcdefabcdee'
const method = { id: methodId, code: 'LEGACY_GATEWAY', name: 'Legacy gateway' }
const unusedMethod = { id: unusedMethodId, code: 'OTHER_GATEWAY', name: 'Other gateway' }
const source = {
  id,
  topupCode: 'SYNTHETIC-TOPUP',
  technicianId: actorId,
  technicianName: 'Synthetic Actor',
  technicianPhone: null,
  amount: '999999999999.99',
  methodId,
  methodCode: method.code,
  methodName: method.name,
  status: 'PENDING',
  transactionReference: null,
  createdAt: new Date('2026-10-11T17:00:00Z'),
  paidAt: null,
  settledAt: null,
  closureVerifiedAt: null,
  closureReference: null,
  ledgerId: null,
  idempotency_key: 'PRIVATE-IDEMPOTENCY-KEY',
}
const result = {
  items: [presentTopupRow(source)],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
  options: { methods: [method] },
}

test('top-up filters require strict single calendar/status/method UUID values and reject unsupported parameters', () => {
  assert.deepEqual(validateTopupListQuery({}), {
    page: 1,
    limit: 10,
    search: '',
    status: 'ALL',
    method: 'ALL',
    from: undefined,
    to: undefined,
  })
  assert.equal(validateTopupId(methodId.toUpperCase()), methodId)
  assert.equal(validateTopupListQuery({ method: methodId.toUpperCase() }).method, methodId)
  assert.equal(validateTopupListQuery({ from: '0001-01-01', to: '9999-12-31' }).from, '0001-01-01')
  assert.equal(validateTopupListQuery({ from: '2000-02-29' }).from, '2000-02-29')
  for (const status of ['ALL', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'])
    assert.equal(validateTopupListQuery({ status }).status, status)
  assert.equal(
    validateTopupListQuery({ page: '1000000', limit: '100', search: '  %_\\  ' }).search,
    '%_\\'
  )
  for (const bad of [
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '1000001' },
    { page: ['1'] },
    { limit: '101' },
    { search: ['a'] },
    { search: 'a'.repeat(151) },
    { search: 'a\u0000b' },
    { status: ['SUCCESS'] },
    { status: 'APPROVED' },
    { method: 'VNPAY' },
    { method: [methodId] },
    { method: 'not-uuid' },
    { from: '0000-01-01' },
    { from: '1900-02-29' },
    { from: '2026-02-29' },
    { to: '2026-04-31' },
    { from: ['2026-10-01'] },
    { to: '10000-01-01' },
    { from: '2026-10-02', to: '2026-10-01' },
    { technicianId: actorId },
    { period: 'MONTH' },
    JSON.parse('{"__proto__":"x"}'),
  ])
    assert.throws(() => validateTopupListQuery(bad), { status: 422 })
  for (const bad of [undefined, 'bad', '../id', [id]])
    assert.throws(() => validateTopupId(bad), { status: 422 })
})

test('top-up presentation preserves exact money, nullable times/references and historical ledger while omitting internal keys', () => {
  const item = presentTopupRow(source)
  assert.equal(item.amount, '999999999999.99')
  assert.equal(item.transactionReference, null)
  assert.equal(item.paidAt, null)
  assert.equal(item.settledAt, null)
  assert.deepEqual(item.method, method)
  assert.equal('closureReference' in item, false)
  assert.equal(JSON.stringify(item).includes('PRIVATE-IDEMPOTENCY-KEY'), false)
  const pending = presentTopupDetail(source)
  assert.equal(pending.ledger, null)
  assert.equal(pending.closureReference, null)
  const paid = presentTopupDetail({
    ...source,
    status: 'SUCCESS',
    amount: '150000.00',
    ledgerId: actorId,
    ledgerType: 'TOP_UP',
    ledgerAmount: '150000.00',
    balanceBefore: '-100000.00',
    balanceAfter: '50000.00',
    ledgerCreatedAt: new Date(),
    ledgerReferenceId: null,
  })
  assert.equal(paid.ledger.amount, '150000.00')
  assert.equal(paid.ledger.balanceBefore, '-100000.00')
  assert.equal(paid.ledger.balanceAfter, '50000.00')
  assert.equal(paid.ledger.referenceId, null)
})

test('top-up SQL binds literal search/method UUID/created-date bounds and retains inactive historical methods', () => {
  const filters = validateTopupListQuery({
    search: 'a%_\\',
    status: 'FAILED',
    method: methodId,
    from: '1900-01-01',
    to: '9999-12-31',
    page: '2',
    limit: '1',
  })
  const queries = buildTopupListQueries(filters)
  assert.deepEqual(queries.values, [
    '%a\\%\\_\\\\%',
    'FAILED',
    methodId,
    '1900-01-01',
    '9999-12-31',
  ])
  assert.deepEqual(queries.rowValues, [...queries.values, 1, 1])
  assert.match(queries.rowsSql, /t.payment_method_id=\$3::uuid/)
  assert.match(queries.rowsSql, /ORDER BY t.created_at DESC,t.id DESC/)
  assert.match(
    queries.rowsSql,
    /t.created_at >= \(\$4::date::timestamp AT TIME ZONE INTERVAL '\+07:00'\)/
  )
  assert.match(
    queries.rowsSql,
    /t.created_at < \(\(\$5::date\+1\)::timestamp AT TIME ZONE INTERVAL '\+07:00'\)/
  )
  assert.equal(queries.rowsSql.includes('t.paid_at >='), false)
  assert.equal(queries.rowsSql.includes('settlement_transactions'), false)
  assert.equal(TOPUP_METHOD_OPTIONS_SQL.includes('is_active'), false)
  assert.equal(TOPUP_METHOD_OPTIONS_SQL.includes('is_online'), false)
  assert.match(TOPUP_DETAIL_SQL, /a.id=t.technician_account_id AND a.technician_id=t.technician_id/)
  assert.match(TOPUP_DETAIL_SQL, /st.topup_id=t.id AND st.transaction_type='TOP_UP'/)
  assert.match(
    TOPUP_DETAIL_SQL,
    /st.technician_account_id=t.technician_account_id AND a.id=st.technician_account_id/
  )
  assert.match(TOPUP_DETAIL_SQL, /t.payment_status='SUCCESS'/)
  assert.equal(TOPUP_DETAIL_SQL.includes('settlement_balance'), false)
})

test('method options and count/rows are one read-only snapshot; known unused methods stay selectable, unknown IDs fail', async () => {
  const calls = []
  const repository = new TopupsRepository({
    transaction: async (work) =>
      work({
        query: async (sql, values) => {
          calls.push({ sql, values })
          if (sql === TOPUP_METHOD_OPTIONS_SQL) return { rows: [method] }
          if (sql.startsWith('SELECT id,code,name'))
            return { rows: values[0] === unusedMethodId ? [unusedMethod] : [] }
          if (sql.startsWith('SELECT count(*)')) return { rows: [{ total: 0 }] }
          return { rows: [] }
        },
      }),
  })
  const empty = await repository.listTopups(validateTopupListQuery({ method: unusedMethodId }))
  assert.deepEqual(empty.items, [])
  assert.deepEqual(empty.options.methods, [method, unusedMethod])
  assert.equal(empty.pagination.total, 0)
  assert.equal(calls[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.deepEqual(calls[2].values, [unusedMethodId])
  assert.deepEqual(calls[3].values, [unusedMethodId])
  assert.deepEqual(calls[4].values, [unusedMethodId, 10, 0])
  const before = calls.length
  await assert.rejects(repository.listTopups(validateTopupListQuery({ method: actorId })), {
    status: 422,
  })
  assert.equal(calls.length - before, 3)
  assert.equal(await repository.getTopup(id), null)
})

test('top-up successful audits contain metadata only; invalid/missing/failed reads do not audit', async () => {
  const events = []
  const service = new TopupsService(
    { listTopups: async () => result, getTopup: async () => presentTopupDetail(source) },
    { audit: (event) => events.push(event) }
  )
  await service.listTopups({ search: 'Sensitive Person 0901234567', method: methodId }, actorId)
  await service.getTopup(id, actorId)
  assert.equal(events[0].action, 'READ_LIST')
  assert.equal(events[0].after.hasMethodFilter, true)
  assert.equal(events[0].after.hasSearch, true)
  assert.deepEqual(events[1].after, { status: 'PENDING' })
  for (const value of [
    'Sensitive Person',
    '0901234567',
    'Synthetic Actor',
    '999999999999.99',
    'SYNTHETIC-TOPUP',
    'PRIVATE-IDEMPOTENCY-KEY',
  ])
    assert.equal(JSON.stringify(events).includes(value), false)
  await assert.rejects(service.listTopups({ method: 'VNPAY' }, actorId), { status: 422 })
  await assert.rejects(service.getTopup('bad', actorId), { status: 422 })
  await assert.rejects(service.getTopup(id, actorId, { page: '1' }), { status: 422 })
  const absent = new TopupsService(
    { getTopup: async () => null },
    { audit: (event) => events.push(event) }
  )
  await assert.rejects(absent.getTopup(id, actorId), { status: 404, code: 'TOPUP_NOT_FOUND' })
  const failing = new TopupsService(
    {
      listTopups: async () => {
        throw new Error('DB failed')
      },
    },
    { audit: (event) => events.push(event) }
  )
  await assert.rejects(failing.listTopups({}, actorId), { message: 'DB failed' })
  assert.equal(events.length, 2)
})

test('top-up list/detail GETs enforce Admin auth/no-store and reject creation/provider callbacks/status/amount changes', async () => {
  const calls = []
  const app = express()
  app.use(
    '/api/admin/topups',
    createTopupsRouter(
      {
        listTopups: async (filters) => {
          calls.push(filters)
          return result
        },
        getTopup: async (value) => (value === id ? presentTopupDetail(source) : null),
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
  const base = `http://127.0.0.1:${server.address().port}/api/admin/topups`
  const sign = (role, expiresIn = '5m') =>
    jwt.sign({ sub: actorId, role, purpose: 'access' }, env.jwtSecret, { expiresIn })
  const request = (path = '', auth, method = 'GET') =>
    fetch(`${base}${path}`, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {} })
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
      '?method=VNPAY',
      '?method=ALL&method=ALL',
      '?status=APPROVED',
      '?limit=1&limit=2',
      '?sort=amount',
      '?from=2026-02-29',
      '/invalid',
      `/${id}?status=SUCCESS`,
    ])
      assert.equal((await request(path, admin)).status, 422)
    assert.equal(calls.length, 0)
    const response = await request(
      `?method=${methodId}&status=PENDING&from=2026-10-01&to=2026-10-31`,
      admin
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(
      await response.json(),
      JSON.parse(JSON.stringify({ success: true, data: result }))
    )
    assert.equal(calls[0].method, methodId)
    const detail = await request(`/${id}`, admin)
    assert.equal(detail.status, 200)
    assert.equal(detail.headers.get('cache-control'), 'no-store')
    assert.equal((await detail.json()).data.ledger, null)
    const missing = await request(`/${actorId}`, admin)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'TOPUP_NOT_FOUND')
    for (const method of ['POST', 'PATCH', 'DELETE'])
      for (const path of ['', `/${id}`, `/${id}/status`, `/${id}/amount`, '/callback'])
        assert.equal((await request(path, admin, method)).status, 404)
    assert.equal(calls.length, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
