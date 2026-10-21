import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { validateReportsQuery } from '../src/modules/reports/reports.validation.js'
import { ReportsRepository, REPORTS_AGGREGATION_SQL } from '../src/modules/reports/reports.repository.js'
import { ReportsService, presentReports } from '../src/modules/reports/reports.service.js'
import { createReportsRouter } from '../src/modules/reports/reports.routes.js'

const actorId = '12345678-1234-1234-1234-123456789012'
const query = { from: '2026-10-01', to: '2026-10-31' }
const rawReport = (overrides = {}) => ({
  asOf: '2026-10-15T00:00:00.000Z',
  summary: { bookings: '3', customers: '10', technicians: '4', commissionAmount: '10.01',
    knownCommissionAmount: '10.01', settledPayments: '2', missingCommissionPayments: '0' },
  bookingOverview: [{ key: 'completed', count: '1' }, { key: 'processing', count: '2' }, { key: 'cancelled', count: '0' }],
  trend: [{ date: '2026-10-01', bookings: '3', commissionAmount: '10.01', knownCommissionAmount: '10.01',
    settledPayments: '2', missingCommissionPayments: '0' }],
  services: { totalUses: '4', items: [{ id: 'a', name: 'Cleaning', count: '3' }, { id: 'b', name: 'Repair', count: '1' }] },
  ...overrides,
})

test('reports default to 30 inclusive UTC+7 days, with strict leap dates, boundaries and granularity', () => {
  assert.deepEqual(validateReportsQuery({}, new Date('2026-10-14T17:00:00Z')), {
    from: '2026-09-16', to: '2026-10-15', timeZone: 'Asia/Ho_Chi_Minh', granularity: 'day',
  })
  assert.equal(validateReportsQuery({ from: '2024-01-01', to: '2024-12-31' }).granularity, 'month')
  assert.equal(validateReportsQuery({ from: '2024-02-29', to: '2024-02-29' }).granularity, 'day')
  assert.equal(validateReportsQuery({ from: '1900-01-01', to: '1900-03-31' }).granularity, 'day')
  assert.equal(validateReportsQuery({ from: '1900-01-01', to: '1900-04-01' }).granularity, 'month')
  assert.equal(validateReportsQuery({ from: '9999-12-31', to: '9999-12-31' }).to, '9999-12-31')
  for (const invalid of [
    { from: query.from }, { to: query.to }, { ...query, from: '2026-02-29' },
    { ...query, from: '1900-02-29' }, { ...query, from: '2026-04-31' },
    { ...query, from: '2026-1-01' }, { ...query, from: '1899-12-31' },
    { ...query, to: '10000-01-01' }, { ...query, to: '2026-09-30' },
    { from: '2024-01-01', to: '2025-01-01' }, { ...query, to: `${query.to}T00:00:00Z` },
    { ...query, from: [query.from] }, { ...query, to: { value: query.to } },
    { ...query, page: '1' }, { ...query, period: 'MONTH' },
    JSON.parse('{"from":"2026-10-01","to":"2026-10-31","__proto__":"x"}'),
    null, [],
  ]) assert.throws(() => validateReportsQuery(invalid), { status: 422 })
})

test('report presentation keeps payment average separate from booking cohort and service uses', () => {
  const data = presentReports(validateReportsQuery(query), rawReport())
  assert.equal(data.summary.bookings, 3)
  assert.equal(data.summary.settledPayments, 2)
  assert.equal(data.summary.averageCommissionAmount, '5.01')
  assert.equal(data.summary.customers, 10)
  assert.equal(data.summary.technicians, 4)
  assert.deepEqual(data.bookingOverview.map((item) => item.percentage), [33.33, 66.67, 0])
  assert.deepEqual(data.services.items.map((item) => item.percentage), [75, 25])
  assert.equal(data.services.totalUses, 4)
})

test('unknown commission stays unavailable while exact partial money and zero eligible periods remain distinct', () => {
  const unknown = rawReport()
  unknown.summary = { ...unknown.summary, commissionAmount: null,
    knownCommissionAmount: '999999999999999999999.99', missingCommissionPayments: '1' }
  unknown.trend[0] = { ...unknown.trend[0], commissionAmount: null,
    knownCommissionAmount: '999999999999999999999.99', missingCommissionPayments: '1' }
  const data = presentReports(validateReportsQuery(query), unknown)
  assert.equal(data.summary.commissionAmount, null)
  assert.equal(data.summary.knownCommissionAmount, '999999999999999999999.99')
  assert.equal(data.summary.averageCommissionAmount, null)
  assert.equal(data.trend[0].commissionAmount, null)
  assert.equal(data.trend[0].knownCommissionAmount, '999999999999999999999.99')
  const empty = rawReport({ summary: { bookings: '0', customers: '10', technicians: '4', commissionAmount: '0',
    knownCommissionAmount: '0', settledPayments: '0', missingCommissionPayments: '0' },
  bookingOverview: [{ key: 'completed', count: '0' }], services: { totalUses: '0', items: [] } })
  const zero = presentReports(validateReportsQuery(query), empty)
  assert.equal(zero.summary.commissionAmount, '0.00')
  assert.equal(zero.summary.averageCommissionAmount, null)
  assert.equal(zero.bookingOverview[0].percentage, 0)
  const huge = rawReport()
  huge.summary = { ...huge.summary, commissionAmount: '999999999999999999999.99', settledPayments: '3' }
  assert.equal(presentReports(validateReportsQuery(query), huge).summary.averageCommissionAmount, '333333333333333333333.33')
  assert.throws(() => presentReports(validateReportsQuery(query), rawReport({
    summary: { ...rawReport().summary, bookings: '9007199254740992' },
  })), /Invalid reports count/)
})

test('repository starts one repeatable read read-only snapshot, uses parameters and propagates failures', async () => {
  const calls = []
  const repository = new ReportsRepository(async (work) => work({
    query: async (...args) => {
      calls.push(args)
      return { rows: [{ ...rawReport(), asOf: new Date('2026-10-15T00:00:00Z') }] }
    },
  }))
  assert.equal((await repository.readReports(validateReportsQuery(query))).asOf, '2026-10-15T00:00:00.000Z')
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(calls[1][0], REPORTS_AGGREGATION_SQL)
  assert.deepEqual(calls[1][1], ['2026-10-01', '2026-10-31', 'day'])
  assert.equal(/\b(?:INSERT|UPDATE|DELETE|LIMIT)\b/i.test(REPORTS_AGGREGATION_SQL), false)
  const failed = new ReportsRepository(async () => { throw new Error('DB unavailable') })
  await assert.rejects(failed.readReports(validateReportsQuery(query)), /DB unavailable/)
})

test('successful reads audit only range and aggregate metadata, while validation and repository failures do not audit', async () => {
  const events = []
  const service = new ReportsService({ readReports: async () => rawReport() }, { audit: (event) => events.push(event) })
  await service.getReports(query, actorId)
  assert.deepEqual(events, [{ actorId, action: 'READ_REPORT', entityType: 'STATISTICAL_REPORT', entityId: null,
    before: null, after: { from: query.from, to: query.to, granularity: 'day', bookings: 3 } }])
  assert.equal(JSON.stringify(events).includes('Cleaning'), false)
  await assert.rejects(service.getReports({ from: query.from }, actorId), { status: 422 })
  const failed = new ReportsService({ readReports: async () => { throw new Error('DB unavailable') } },
    { audit: (event) => events.push(event) })
  await assert.rejects(failed.getReports(query, actorId), /DB unavailable/)
  assert.equal(events.length, 1)
})

test('reports endpoint is Admin-only, validates repeated/unsupported parameters, has no write routes and never caches', async () => {
  const requests = []
  const app = express()
  app.use('/api/admin/reports', createReportsRouter({ readReports: async (period) => {
    requests.push(period)
    return rawReport()
  } }, { audit: () => {}, now: () => new Date('2026-10-15T00:00:00Z') }))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const url = `http://127.0.0.1:${server.address().port}/api/admin/reports`
  const token = (role, expiresIn = '5m') => jwt.sign({ sub: actorId, role, purpose: 'access' }, env.jwtSecret, { expiresIn })
  const request = (suffix = '', auth, method = 'GET') => fetch(`${url}${suffix}`,
    { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {} })
  try {
    for (const [auth, expected] of [[undefined, 401], [token('ADMIN', '-1s'), 401],
      [token('CUSTOMER'), 403], [token('TECHNICIAN'), 403]]) {
      const response = await request('', auth)
      assert.equal(response.status, expected)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    const admin = token('ADMIN')
    for (const suffix of ['?from=2026-10-01', '?from=2026-10-01&to=2026-10-31&from=2026-10-02',
      '?from=2026-10-01&to=2026-10-31&page=1', '?from[value]=2026-10-01&to=2026-10-31']) {
      const response = await request(suffix, admin)
      assert.equal(response.status, 422)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    assert.equal(requests.length, 0)
    const response = await request('?from=2026-10-01&to=2026-10-31', admin)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.success, true)
    assert.equal(body.data.summary.averageCommissionAmount, '5.01')
    assert.equal((await request('', admin)).status, 200)
    assert.equal(requests[1].from, '2026-09-16')
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) assert.equal((await request('', admin, method)).status, 404)
    assert.equal(requests.length, 2)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
