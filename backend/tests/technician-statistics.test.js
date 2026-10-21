import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { pool } from '../src/config/database.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { validateTechnicianStatisticsQuery } from '../src/modules/technician-statistics/technician-statistics.validation.js'
import { TechnicianStatisticsRepository, TECHNICIAN_STATISTICS_SQL } from '../src/modules/technician-statistics/technician-statistics.repository.js'
import { TechnicianStatisticsService, presentTechnicianStatistics } from '../src/modules/technician-statistics/technician-statistics.service.js'
import { createTechnicianStatisticsRouter } from '../src/modules/technician-statistics/technician-statistics.routes.js'

const query = { from: '2026-10-01', to: '2026-10-31' }
const actorId = '12345678-1234-1234-1234-123456789012'

function rawReport() {
  const counts = { totalRequests: '7', acceptedRequests: '4', completedRequests: '3', declinedRequests: '1',
    technicianCancelledRequests: '1', otherCancelledRequests: '1', pendingRequests: '1', expiredRequests: '0' }
  return {
    asOf: '2026-10-21T00:00:00.000Z',
    summary: { totalTechnicians: '4', activeTechnicians: '2', inactiveTechnicians: '1', lockedTechnicians: '1',
      verifiedTechnicians: '3', pendingVerification: '1', rejectedVerification: '0' },
    income: { knownAmount: '1100.01', missingPayments: '0', settledPayments: '3', earningTechnicians: '2', completedJobs: '2',
      technicians: [{ id: 't1', name: 'One', knownAmount: '400.00', missingPayments: '0' },
        { id: 't2', name: 'Two', knownAmount: '700.01', missingPayments: '0' }],
      trend: [{ date: '2026-10-01', knownAmount: '1100.01', missingPayments: '0', settledPayments: '3' }] },
    areas: { coveredTechnicians: '3', items: [
      { key: 'a', label: 'Ward A, City', city: 'City', ward: 'Ward A', count: '3' },
      { key: 'b', label: 'Ward B, City', city: 'City', ward: 'Ward B', count: '2' },
    ] },
    activity: { ...counts, reviewCount: '4', ratingSum: '18',
      trend: [{ date: '2026-10-01', ...counts, reviewCount: '4', ratingSum: '18' }] },
    issues: { complaints: '3', penalties: '2', openComplaints: '1', resolvedComplaints: '1',
      rejectedComplaints: '0', closedComplaints: '1', affectedTechnicians: '2',
      trend: [{ date: '2026-10-01', complaints: '3', penalties: '2', resolvedComplaints: '1' }] },
    locked: { total: '1', items: [{ id: 't4', name: 'Locked technician', email: 'private@example.com',
      phone: null, avatarUrl: null, verificationStatus: 'VERIFIED', isActive: false,
      registeredAt: '2026-09-01T00:00:00.000Z' }] },
  }
}

test('technician statistics validates Vietnam date ranges, literal search and bounded locked-table pagination', () => {
  assert.deepEqual(validateTechnicianStatisticsQuery({}, new Date('2026-10-20T17:00:00Z')), {
    from: '2026-09-22', to: '2026-10-21', timeZone: 'Asia/Ho_Chi_Minh', granularity: 'day', search: '', page: 1, limit: 10,
  })
  const validated = validateTechnicianStatisticsQuery({ ...query, search: ' %_\\ literal ', page: '2', limit: '50' })
  assert.equal(validated.search, '%_\\ literal')
  assert.equal(validated.page, 2)
  assert.equal(validated.limit, 50)
  assert.equal(validateTechnicianStatisticsQuery({ from: '2024-01-01', to: '2024-12-31' }).granularity, 'month')
  for (const invalid of [null, [], { ...query, search: ['x'] }, { ...query, search: 'x'.repeat(151) },
    { ...query, search: 'x\u0000' }, { ...query, search: 'line\nbreak' }, { ...query, search: 1 },
    { ...query, page: ['1'] }, { ...query, page: '0' }, { ...query, page: '-1' }, { ...query, page: '01' },
    { ...query, page: '1e2' }, { ...query, page: '1000001' }, { ...query, page: '9007199254740993' },
    { ...query, page: 1 }, { ...query, limit: '010' }, { ...query, limit: '11' }, { ...query, limit: ['10'] },
    { ...query, limit: 10 }, { ...query, unknown: 'value' }, { ...query, from: [query.from] },
    { ...query, from: '2026-02-29' }, { from: query.from }, { ...query, to: '2026-09-30' },
    { from: '2024-01-01', to: '2025-01-01' }]) {
    assert.throws(() => validateTechnicianStatisticsQuery(invalid), { status: 422 })
  }
})

test('presentation keeps profile snapshots separate from overlapping area coverage and weighted activity metrics', () => {
  const data = presentTechnicianStatistics(validateTechnicianStatisticsQuery(query), rawReport())
  assert.deepEqual(data.period, { ...query, timeZone: 'Asia/Ho_Chi_Minh', granularity: 'day' })
  assert.equal(data.summary.totalTechnicians, 4)
  assert.equal(data.summary.activeTechnicians + data.summary.inactiveTechnicians + data.summary.lockedTechnicians, 4)
  assert.equal(data.areas.coveredTechnicians, 3)
  assert.equal(data.areas.unassignedTechnicians, 1)
  assert.equal(data.areas.areaCount, 2)
  assert.equal(data.areas.coverageAssignments, 5)
  assert.equal(data.areas.averageTechniciansPerArea, 2.5)
  assert.equal(data.areas.topArea.key, 'a')
  assert.deepEqual(data.areas.items.map((area) => area.percentage), [75, 50])
  assert.equal(data.activity.completedRequests, 3)
  assert.equal(data.activity.technicianCancelledRequests, 1)
  assert.equal(data.activity.otherCancelledRequests, 1)
  assert.equal(data.activity.completionPercent, 42.86)
  assert.equal(data.activity.averageRating, 4.5)
  assert.equal(data.activity.trend[0].averageRating, 4.5)
  assert.equal(data.issues.totalIssues, 5)
  assert.equal(data.issues.affectedTechnicians, 2)
  assert.equal(data.locked.items[0].registeredAt, '2026-09-01T00:00:00.000Z')
})

test('income uses exact cents and ranks technicians without converting large amounts to floating point', () => {
  const raw = rawReport()
  const data = presentTechnicianStatistics(validateTechnicianStatisticsQuery(query), raw)
  assert.equal(data.income.amount, '1100.01')
  assert.equal(data.income.averageAmount, '550.01')
  assert.equal(data.income.topTechnician.id, 't2')
  assert.equal(data.income.topTechnician.amount, '700.01')
  assert.equal(data.income.trend[0].amount, '1100.01')

  raw.income.knownAmount = '9007199254740993.01'
  raw.income.technicians = [
    { id: 'higher', name: 'Higher', knownAmount: '4503599627370496.51', missingPayments: '0' },
    { id: 'lower', name: 'Lower', knownAmount: '4503599627370496.50', missingPayments: '0' },
  ]
  raw.income.trend[0].knownAmount = raw.income.knownAmount
  const exact = presentTechnicianStatistics(validateTechnicianStatisticsQuery(query), raw)
  assert.equal(exact.income.amount, '9007199254740993.01')
  assert.equal(exact.income.averageAmount, '4503599627370496.51')
  assert.equal(exact.income.topTechnician.id, 'higher')
})

test('missing entitlement leaves totals, averages and rankings unavailable while retaining known partial amounts', () => {
  const raw = rawReport()
  raw.income.missingPayments = '1'
  raw.income.technicians[0].missingPayments = '1'
  raw.income.trend[0].missingPayments = '1'
  const data = presentTechnicianStatistics(validateTechnicianStatisticsQuery(query), raw)
  assert.equal(data.income.amount, null)
  assert.equal(data.income.knownAmount, '1100.01')
  assert.equal(data.income.averageAmount, null)
  assert.equal(data.income.topTechnician, null)
  assert.equal(data.income.trend[0].amount, null)
  assert.equal(data.income.trend[0].knownAmount, '1100.01')
})

test('empty activity has no artificial rating, rate or income average and rejects unsafe counts', () => {
  const raw = rawReport()
  raw.summary = Object.fromEntries(Object.keys(raw.summary).map((key) => [key, '0']))
  raw.income = { knownAmount: '0', missingPayments: '0', settledPayments: '0', earningTechnicians: '0', completedJobs: '0', technicians: [], trend: [] }
  raw.areas = { coveredTechnicians: '0', items: [] }
  raw.activity = Object.fromEntries(Object.keys(raw.activity).map((key) => [key, key === 'trend' ? [] : '0']))
  raw.issues = Object.fromEntries(Object.keys(raw.issues).map((key) => [key, key === 'trend' ? [] : '0']))
  raw.locked = { total: '0', items: [] }
  const data = presentTechnicianStatistics(validateTechnicianStatisticsQuery(query), raw)
  assert.equal(data.income.amount, '0.00')
  assert.equal(data.income.averageAmount, null)
  assert.equal(data.income.topTechnician, null)
  assert.equal(data.areas.averageTechniciansPerArea, null)
  assert.equal(data.areas.topArea, null)
  assert.equal(data.activity.completionPercent, null)
  assert.equal(data.activity.averageRating, null)
  assert.equal(data.issues.totalIssues, 0)
  raw.summary.totalTechnicians = '9007199254740992'
  assert.throws(() => presentTechnicianStatistics(validateTechnicianStatisticsQuery(query), raw), /Invalid technician statistics count/)
})

test('repository reads one read-only snapshot and binds literal search without modifying any source table', async () => {
  const calls = []
  const repository = new TechnicianStatisticsRepository(async (work) => work({ query: async (...args) => {
    calls.push(args)
    return { rows: [{ ...rawReport(), asOf: new Date('2026-10-21T00:00:00Z') }] }
  } }))
  const validated = validateTechnicianStatisticsQuery({ ...query, search: '%_\\', page: '3', limit: '20' })
  const raw = await repository.readTechnicianStatistics(validated)
  assert.equal(raw.asOf, '2026-10-21T00:00:00.000Z')
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(calls[1][0], TECHNICIAN_STATISTICS_SQL)
  assert.deepEqual(calls[1][1], ['2026-10-01', '2026-10-31', 'day', '%_\\', 20, 40])
  assert.equal(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(TECHNICIAN_STATISTICS_SQL), false)
  await assert.rejects(new TechnicianStatisticsRepository(async () => { throw new Error('database offline') })
    .readTechnicianStatistics(validated), /database offline/)
})

test('report audit contains only aggregate metadata and is emitted only after a successful read', async () => {
  const events = []
  const service = new TechnicianStatisticsService({ readTechnicianStatistics: async () => rawReport() }, { audit: (event) => events.push(event) })
  await service.getTechnicianStatistics({ ...query, search: 'private@example.com' }, actorId)
  assert.deepEqual(events, [{ actorId, action: 'READ_REPORT', entityType: 'TECHNICIAN_STATISTICS', entityId: null, before: null,
    after: { from: query.from, to: query.to, granularity: 'day', page: 1, limit: 10, totalTechnicians: 4 } }])
  assert.equal(JSON.stringify(events).includes('private'), false)
  await assert.rejects(service.getTechnicianStatistics({ ...query, search: ['x'] }, actorId), { status: 422 })
  const failure = new TechnicianStatisticsService({ readTechnicianStatistics: async () => { throw new Error('offline') } }, { audit: (event) => events.push(event) })
  await assert.rejects(failure.getTechnicianStatistics(query, actorId), /offline/)
  assert.equal(events.length, 1)
})

test('endpoint is Admin-only, non-cacheable, rejects malformed filters and exposes read-only GET behavior', async (context) => {
  // Exercise the shared technician status gate; the test context restores this mock automatically.
  context.mock.method(pool, 'query', async () => ({ rows: [{ status: 'ACTIVE' }] }))
  const calls = []
  const app = express()
  app.use('/api/admin/technician-statistics', createTechnicianStatisticsRouter({ readTechnicianStatistics: async (validated) => {
    calls.push(validated)
    return rawReport()
  } }, { audit: () => {}, now: () => new Date('2026-10-21T00:00:00Z') }))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const url = `http://127.0.0.1:${server.address().port}/api/admin/technician-statistics`
  const token = (role, expiresIn = '5m', purpose = 'access') => jwt.sign({ sub: actorId, role, purpose }, env.jwtSecret, { expiresIn })
  const request = (suffix = '', auth, method = 'GET') => fetch(`${url}${suffix}`, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {} })
  try {
    for (const [auth, status] of [[undefined, 401], [token('ADMIN', '-1s'), 401], [token('ADMIN', '5m', 'reset'), 401],
      [token('CUSTOMER'), 403], [token('TECHNICIAN'), 403]]) {
      const response = await request('', auth)
      assert.equal(response.status, status)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    const admin = token('ADMIN')
    for (const suffix of ['?from=2026-10-01', '?from=2026-10-01&to=2026-10-31&from=2026-10-02',
      '?page=1&page=2', '?search=x&search=y', '?limit=10&limit=20', '?search[value]=x', '?status=LOCKED', '?limit=010']) {
      assert.equal((await request(suffix, admin)).status, 422)
    }
    assert.equal(calls.length, 0)
    const response = await request('?from=2026-10-01&to=2026-10-31&search=%25_&page=2&limit=20', admin)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.success, true)
    assert.equal(body.data.income.amount, '1100.01')
    assert.equal(body.data.activity.technicianCancelledRequests, 1)
    assert.equal(calls[0].search, '%_')
    assert.equal(calls[0].page, 2)
    assert.equal((await request('', admin)).status, 200)
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal((await request('', admin, method)).status, 404)
    assert.equal(calls.length, 2)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
