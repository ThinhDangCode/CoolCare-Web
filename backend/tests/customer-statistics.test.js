import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { validateCustomerStatisticsQuery } from '../src/modules/customer-statistics/customer-statistics.validation.js'
import { CustomerStatisticsRepository, CUSTOMER_STATISTICS_SQL } from '../src/modules/customer-statistics/customer-statistics.repository.js'
import { CustomerStatisticsService, presentCustomerStatistics } from '../src/modules/customer-statistics/customer-statistics.service.js'
import { createCustomerStatisticsRouter } from '../src/modules/customer-statistics/customer-statistics.routes.js'

const query = { from: '2026-10-01', to: '2026-10-31' }
const actorId = '12345678-1234-1234-1234-123456789012'
function rawReport() {
  return { asOf: '2026-10-15T00:00:00.000Z',
    summary: { totalCustomers: '4', newCustomers: '2', activeCustomers: '2', lockedCustomers: '1', inactiveCustomers: '1',
      customersWithBookings: '3', customersWithoutBookings: '1' },
    acquisition: { currentCount: '2', previousCount: '1', monthCount: '2', yearCount: '4', trend: [{ date: '2026-10-01', count: '2' }] },
    areas: [{ key: 'a', label: 'A', city: 'A', district: 'A', ward: null, missing: false, count: '2', newCount: '2', previousNewCount: '1' },
      { key: 'b', label: 'Unknown area', city: null, district: null, ward: null, missing: true, count: '2', newCount: '0', previousNewCount: '0' }],
    usage: { totalBookings: '3', distinctCustomers: '2', totalUses: '4', repeatCustomers: '1',
      services: [{ id: 'a', name: 'Repair', count: '3', customers: '2', bookings: '3' }, { id: 'b', name: 'Clean', count: '1', customers: '1', bookings: '1' }],
      categories: [{ id: 'a', name: 'AC', count: '4' }] },
    cancellations: { totalBookings: '7', cancelledBookings: '1', rejectedBookings: '2', affectedBookings: '2',
      trend: [{ date: '2026-10-01', totalBookings: '7', cancelledBookings: '1', rejectedBookings: '2' }] },
    locked: { total: '1', items: [{ id: 'locked', name: 'Admin-only customer', email: 'private@example.com', phone: null,
      avatarUrl: null, status: 'LOCKED', registeredAt: '2026-10-01T00:00:00.000Z' }] } }
}

test('customer statistics validates dates and applies strict literal search and bounded table pagination', () => {
  assert.deepEqual(validateCustomerStatisticsQuery({}, new Date('2026-10-14T17:00:00Z')), {
    from: '2026-09-16', to: '2026-10-15', timeZone: 'Asia/Ho_Chi_Minh', granularity: 'day', search: '', page: 1, limit: 10,
  })
  assert.equal(validateCustomerStatisticsQuery({ ...query, search: ' %_\\ literal ', page: '2', limit: '50' }).search, '%_\\ literal')
  for (const invalid of [null, [], { ...query, search: ['x'] }, { ...query, search: 'x'.repeat(151) },
    { ...query, search: 'x\u0000' }, { ...query, search: 'line\nbreak' }, { ...query, search: 1 },
    { ...query, page: ['1'] }, { ...query, page: '0' }, { ...query, page: '-1' }, { ...query, page: '1e2' },
    { ...query, page: '1000001' }, { ...query, page: '9007199254740993' }, { ...query, page: 1 },
    { ...query, limit: '11' }, { ...query, limit: ['10'] }, { ...query, limit: 10 },
    { ...query, unknown: 'value' }, { ...query, from: [query.from] }, { ...query, from: '2026-02-29' },
    { from: query.from }, { ...query, to: '2026-09-30' }, { from: '2024-01-01', to: '2025-01-01' }]) {
    assert.throws(() => validateCustomerStatisticsQuery(invalid), { status: 422 })
  }
})

test('presentation distinguishes overlapping service customers, account snapshot, growth and booking cancellation union', () => {
  const data = presentCustomerStatistics(validateCustomerStatisticsQuery(query), rawReport())
  assert.equal(data.acquisition.growthPercent, 100)
  assert.equal(data.areas.totalCustomers, 4)
  assert.equal(data.areas.knownCustomers, 2)
  assert.equal(data.areas.unknownCustomers, 2)
  assert.equal(data.areas.areaCount, 1)
  assert.equal(data.areas.averageCustomersPerArea, 2)
  assert.deepEqual(data.areas.items.map((item) => item.percentage), [50, 50])
  assert.equal(data.areas.fastestGrowingArea.key, 'a')
  assert.equal(data.usage.averageBookingsPerCustomer, 1.5)
  assert.equal(data.usage.repeatCustomerPercent, 50)
  assert.equal(data.usage.topService.name, 'Repair')
  assert.deepEqual(data.usage.services.map((item) => item.percentage), [75, 25])
  assert.equal(data.usage.services.reduce((sum, item) => sum + item.customers, 0), 3)
  assert.equal(data.usage.distinctCustomers, 2)
  assert.equal(data.cancellations.cancellationPercent, 14.29)
  assert.equal(data.cancellations.rejectionPercent, 28.57)
  assert.equal(data.cancellations.affectedBookings, 2)
})

test('empty denominators and zero previous growth stay unavailable; unsafe counts are rejected', () => {
  const raw = rawReport()
  raw.acquisition.previousCount = '0'
  raw.usage = { totalBookings: '0', distinctCustomers: '0', totalUses: '0', repeatCustomers: '0', services: [], categories: [] }
  raw.areas = []
  raw.cancellations = { totalBookings: '0', cancelledBookings: '0', rejectedBookings: '0', affectedBookings: '0', trend: [] }
  const data = presentCustomerStatistics(validateCustomerStatisticsQuery(query), raw)
  assert.equal(data.acquisition.growthPercent, null)
  assert.equal(data.areas.topArea, null)
  assert.equal(data.areas.fastestGrowingArea, null)
  assert.equal(data.areas.averageCustomersPerArea, null)
  assert.equal(data.usage.averageBookingsPerCustomer, null)
  assert.equal(data.usage.repeatCustomerPercent, null)
  assert.equal(data.cancellations.cancellationPercent, null)
  assert.equal(data.cancellations.rejectionPercent, null)
  raw.summary.totalCustomers = '9007199254740992'
  assert.throws(() => presentCustomerStatistics(validateCustomerStatisticsQuery(query), raw), /Invalid customer statistics count/)
})

test('repository enforces a single read-only snapshot and parameterizes literal search and table offsets', async () => {
  const calls = []
  const repository = new CustomerStatisticsRepository(async (work) => work({ query: async (...args) => {
    calls.push(args)
    return { rows: [{ ...rawReport(), asOf: new Date('2026-10-15T00:00:00Z') }] }
  } }))
  const validated = validateCustomerStatisticsQuery({ ...query, search: '%_\\', page: '3', limit: '20' })
  await repository.readCustomerStatistics(validated)
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(calls[1][0], CUSTOMER_STATISTICS_SQL)
  assert.deepEqual(calls[1][1], ['2026-10-01', '2026-10-31', 'day', '%_\\', 20, 40])
  assert.equal(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(CUSTOMER_STATISTICS_SQL), false)
  await assert.rejects(new CustomerStatisticsRepository(async () => { throw new Error('database offline') })
    .readCustomerStatistics(validated), /database offline/)
})

test('successful report reads audit aggregates only without customer fields or search text', async () => {
  const events = []
  const service = new CustomerStatisticsService({ readCustomerStatistics: async () => rawReport() }, { audit: (event) => events.push(event) })
  await service.getCustomerStatistics({ ...query, search: 'private@example.com' }, actorId)
  assert.deepEqual(events, [{ actorId, action: 'READ_REPORT', entityType: 'CUSTOMER_STATISTICS', entityId: null, before: null,
    after: { from: query.from, to: query.to, granularity: 'day', page: 1, limit: 10, totalCustomers: 4 } }])
  assert.equal(JSON.stringify(events).includes('private'), false)
  await assert.rejects(service.getCustomerStatistics({ ...query, search: ['x'] }, actorId), { status: 422 })
  const failure = new CustomerStatisticsService({ readCustomerStatistics: async () => { throw new Error('offline') } }, { audit: (event) => events.push(event) })
  await assert.rejects(failure.getCustomerStatistics(query, actorId), /offline/)
  assert.equal(events.length, 1)
})

test('customer statistics endpoint requires Admin, rejects malformed queries and has GET reporting only', async () => {
  const calls = []
  const app = express()
  app.use('/api/admin/customer-statistics', createCustomerStatisticsRouter({ readCustomerStatistics: async (q) => {
    calls.push(q); return rawReport()
  } }, { audit: () => {}, now: () => new Date('2026-10-15T00:00:00Z') }))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const url = `http://127.0.0.1:${server.address().port}/api/admin/customer-statistics`
  const token = (role, expiresIn = '5m') => jwt.sign({ sub: actorId, role, purpose: 'access' }, env.jwtSecret, { expiresIn })
  const request = (suffix = '', auth, method = 'GET') => fetch(`${url}${suffix}`, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {} })
  try {
    for (const [auth, status] of [[undefined, 401], [token('ADMIN', '-1s'), 401], [token('CUSTOMER'), 403], [token('TECHNICIAN'), 403]]) {
      const response = await request('', auth)
      assert.equal(response.status, status)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    const admin = token('ADMIN')
    for (const suffix of ['?from=2026-10-01', '?from=2026-10-01&to=2026-10-31&from=2026-10-02',
      '?page=1&page=2', '?search=x&search=y', '?limit=10&limit=20', '?search[value]=x', '?status=LOCKED']) {
      assert.equal((await request(suffix, admin)).status, 422)
    }
    assert.equal(calls.length, 0)
    const response = await request('?from=2026-10-01&to=2026-10-31&search=%25_&page=2&limit=20', admin)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await response.json()).data.usage.distinctCustomers, 2)
    assert.equal(calls[0].search, '%_')
    assert.equal((await request('', admin)).status, 200)
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal((await request('', admin, method)).status, 404)
    assert.equal(calls.length, 2)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
