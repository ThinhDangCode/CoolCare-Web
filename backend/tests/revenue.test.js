import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { validateRevenueQuery } from '../src/modules/revenue/revenue.validation.js'
import {
  revenueUnits,
  revenueDecimal,
  roundedDivide,
} from '../src/modules/revenue/revenue.money.js'
import { presentRevenueReport, RevenueService } from '../src/modules/revenue/revenue.service.js'
import {
  RevenueRepository,
  REVENUE_AGGREGATION_SQL,
} from '../src/modules/revenue/revenue.repository.js'
import { createRevenueRouter } from '../src/modules/revenue/revenue.routes.js'

const actorId = '12345678-1234-1234-1234-123456789012'
const serviceId = '87654321-4321-4321-4321-210987654321'
const query = { period: 'MONTH', year: '2026', month: '10' }
const options = {
  services: [{ id: serviceId, name: 'Cleaning' }],
  areas: [{ id: 'Cần Thơ', name: 'Cần Thơ' }],
}
const row = (kind, period, knownAmount, extra = {}) => ({
  kind,
  period,
  amount: knownAmount,
  knownAmount,
  paymentCount: '1',
  missingCommissionCount: '0',
  unknownCount: '0',
  unallocatedCount: '0',
  unclassifiedCount: '0',
  ...extra,
})

test('revenue calendar validation supports leap months, adjacent quarter/year, extreme years and strict parameters', () => {
  const month = validateRevenueQuery({ period: 'MONTH', year: '2024', month: '2' })
  assert.equal(month.period.to, '2024-02-29')
  assert.equal(month.period.previousFrom, '2024-01-01')
  assert.equal(month.period.previousTo, '2024-01-31')
  assert.equal(month.period.monthCount, 1)
  const quarter = validateRevenueQuery({ period: 'QUARTER', year: '2026', quarter: '1' })
  assert.equal(quarter.period.to, '2026-03-31')
  assert.equal(quarter.period.previousFrom, '2025-10-01')
  assert.equal(quarter.period.previousTo, '2025-12-31')
  assert.equal(quarter.period.monthCount, 3)
  const year = validateRevenueQuery({ period: 'YEAR', year: '1900' })
  assert.equal(year.period.previousFrom, '1899-01-01')
  assert.equal(year.period.previousTo, '1899-12-31')
  assert.equal(year.period.monthCount, 12)
  assert.equal(validateRevenueQuery({ period: 'YEAR', year: '9999' }).period.to, '9999-12-31')
  for (const bad of [
    {},
    { ...query, period: 'WEEK' },
    { ...query, year: ['2026', '2025'] },
    { ...query, year: '1899' },
    { ...query, year: '10000' },
    { ...query, month: '13' },
    { ...query, month: ['10'] },
    { ...query, quarter: '4' },
    { period: 'YEAR', year: '2026', month: '10' },
    { period: 'QUARTER', year: '2026', quarter: '0' },
    { ...query, service: 'bad-id' },
    { ...query, service: [serviceId] },
    { ...query, area: ['Cần Thơ'] },
    { ...query, area: '' },
    { ...query, area: 'a'.repeat(101) },
    { ...query, area: 'a\n' },
    { ...query, status: 'SUCCESS' },
    { ...query, page: '1' },
    { ...query, from: '2026-10-01' },
    JSON.parse('{"period":"MONTH","year":"2026","month":"10","__proto__":"x"}'),
  ])
    assert.throws(() => validateRevenueQuery(bad), { status: 422 })
})

test('revenue presentation uses exact large totals, 1/3/12 average denominators and comparison unavailable at zero', () => {
  assert.equal(revenueDecimal(revenueUnits('999999999999999999999.99')), '999999999999999999999.99')
  assert.equal(roundedDivide(100001n, 3n), 33334n)
  assert.equal(roundedDivide(-100001n, 3n), -33334n)
  const request = validateRevenueQuery({ period: 'QUARTER', year: '2026', quarter: '4' })
  const data = presentRevenueReport(request, {
    options,
    rows: [
      row('SUMMARY', 'CURRENT', '1000.01', { paymentCount: '2' }),
      row('SUMMARY', 'PREVIOUS', '500.00'),
      row('SERVICE', 'CURRENT', '1000.01', { key: serviceId, label: 'Cleaning' }),
      row('AREA', 'CURRENT', '1000.01', { key: 'Cần Thơ', label: 'Cần Thơ' }),
      row('TREND', 'CURRENT', '1000.01', { key: '1' }),
      row('TREND', 'PREVIOUS', '500.00', { key: '3' }),
    ],
  })
  assert.equal(data.summary.totalRevenue, '1000.01')
  assert.equal(data.summary.averageMonthlyRevenue, '333.34')
  assert.equal(data.summary.comparisonPercent, 100)
  assert.equal(data.summary.topService.id, serviceId)
  assert.equal(data.summary.topService.sharePercent, 100)
  assert.deepEqual(
    data.trend.map((point) => point.amount),
    ['1000.01', '0.00', '0.00']
  )
  assert.deepEqual(
    data.trend.map((point) => point.previousAmount),
    ['0.00', '0.00', '500.00']
  )
  const empty = presentRevenueReport(validateRevenueQuery({ period: 'YEAR', year: '2026' }), {
    options,
    rows: [],
  })
  assert.equal(empty.summary.averageMonthlyRevenue, '0.00')
  assert.equal(empty.summary.comparisonPercent, null)
  assert.equal(empty.summary.topService, null)
  assert.equal(empty.trend.length, 12)
})

test('trend distinguishes nonexistent month dates from zero data and unknown money', () => {
  const data = presentRevenueReport(
    validateRevenueQuery({ period: 'MONTH', year: '2024', month: '2' }),
    {
      options,
      rows: [
        row('SUMMARY', 'CURRENT', '10.00', {
          amount: null,
          missingCommissionCount: '1',
          unknownCount: '1',
        }),
        row('TREND', 'CURRENT', '10.00', { key: '2', amount: null }),
      ],
    }
  )
  assert.equal(data.trend.length, 31)
  assert.equal(data.trend[1].amount, null)
  assert.equal(data.trend[1].knownAmount, '10.00')
  assert.equal(data.trend[28].amount, '0.00')
  assert.equal(data.trend[28].knownAmount, '0.00')
  assert.equal(data.trend[29].amount, null)
  assert.equal(data.trend[29].knownAmount, null)
  assert.equal(data.trend[30].knownAmount, null)
  assert.equal(data.trend[29].previousAmount, '0.00')
  assert.equal(data.summary.totalRevenue, null)
  assert.equal(data.summary.knownRevenue, '10.00')
  assert.equal(data.summary.averageMonthlyRevenue, null)
  assert.equal(data.warnings[0].code, 'MISSING_COMMISSION')
})

test('selected-service uncertainty cannot produce a complete zero or a confident top KPI', () => {
  const request = validateRevenueQuery({ ...query, service: serviceId })
  const data = presentRevenueReport(request, {
    options,
    rows: [
      row('SUMMARY', 'CURRENT', '12.00', {
        amount: null,
        unknownCount: '1',
        unallocatedCount: '1',
        paymentCount: '2',
      }),
      row('SERVICE', 'CURRENT', '12.00', { key: serviceId, label: 'Cleaning', amount: null }),
      row('AREA', 'CURRENT', '12.00', { key: 'Cần Thơ', label: 'Cần Thơ', amount: null }),
    ],
  })
  assert.equal(data.summary.totalRevenue, null)
  assert.equal(data.summary.knownRevenue, '12.00')
  assert.equal(data.summary.missingCommissionCount, 0)
  assert.equal(data.summary.topService, null)
  assert.equal(data.services[0].sharePercent, null)
  assert.ok(data.warnings.some((warning) => warning.code === 'SERVICE_ALLOCATION_UNCERTAIN'))
})

test('repository binds all filters, aggregates full periods without cap and checks known option IDs in one read-only snapshot', async () => {
  const calls = []
  const repository = new RevenueRepository({
    transaction: async (work) =>
      work({
        query: async (sql, values) => {
          calls.push({ sql, values })
          if (sql.startsWith('SELECT id::text')) return { rows: options.services }
          if (sql.startsWith('SELECT DISTINCT')) return { rows: options.areas }
          return { rows: [] }
        },
      }),
  })
  const request = validateRevenueQuery({ ...query, service: serviceId, area: 'Cần Thơ' })
  const report = await repository.readRevenueReport(request)
  assert.equal(calls[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(calls.length, 4)
  assert.deepEqual(calls[3].values, [
    '2026-10-01',
    '2026-10-31',
    '2026-09-01',
    '2026-09-30',
    serviceId,
    'Cần Thơ',
    'MONTH',
    'Cleaning',
  ])
  assert.equal(report.options.services.length, 3)
  assert.match(REVENUE_AGGREGATION_SQL, /p.payment_status='SUCCESS'/)
  assert.match(REVENUE_AGGREGATION_SQL, /p.settled_at IS NOT NULL/)
  assert.match(REVENUE_AGGREGATION_SQL, /AT TIME ZONE INTERVAL '\+07:00'/)
  assert.match(REVENUE_AGGREGATION_SQL, /bu.booking_id=q.booking_id/)
  assert.match(REVENUE_AGGREGATION_SQL, /div\(round\(p.commission_amount\*100\)/)
  assert.equal(/\bLIMIT\b/i.test(REVENUE_AGGREGATION_SQL), false)
  assert.equal(REVENUE_AGGREGATION_SQL.includes('technician_areas'), false)
  await assert.rejects(
    repository.readRevenueReport(validateRevenueQuery({ ...query, service: actorId })),
    { status: 422 }
  )
  await assert.rejects(
    repository.readRevenueReport(validateRevenueQuery({ ...query, area: 'Absent city' })),
    { status: 422 }
  )
})

test('successful read-report audit contains minimal metadata; invalid/failed reads do not audit', async () => {
  const events = []
  const service = new RevenueService(
    { readRevenueReport: async () => ({ options, rows: [] }) },
    { audit: (event) => events.push(event) }
  )
  await service.getRevenueReport({ ...query, area: 'Cần Thơ' }, actorId)
  assert.equal(events.length, 1)
  assert.equal(events[0].action, 'READ_REPORT')
  assert.equal(events[0].actorId, actorId)
  assert.deepEqual(events[0].after, {
    period: 'MONTH',
    from: '2026-10-01',
    to: '2026-10-31',
    hasServiceFilter: false,
    hasAreaFilter: true,
    count: 0,
  })
  assert.equal(JSON.stringify(events).includes('Cần Thơ'), false)
  await assert.rejects(service.getRevenueReport({ ...query, year: '10000' }, actorId), {
    status: 422,
  })
  const failing = new RevenueService(
    {
      readRevenueReport: async () => {
        throw new Error('DB failed')
      },
    },
    { audit: (event) => events.push(event) }
  )
  await assert.rejects(failing.getRevenueReport(query, actorId), { message: 'DB failed' })
  assert.equal(events.length, 1)
})

test('revenue GET route is Admin-only, rejects repeated/unknown parameters and mutations, and returns no-store', async () => {
  const calls = []
  const app = express()
  app.use(
    '/api/admin/revenue',
    createRevenueRouter(
      {
        readRevenueReport: async (request) => {
          calls.push(request)
          return { options, rows: [] }
        },
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
  const url = `http://127.0.0.1:${server.address().port}/api/admin/revenue`
  const token = (role, expiresIn = '5m') =>
    jwt.sign({ sub: actorId, role, purpose: 'access' }, env.jwtSecret, { expiresIn })
  const get = (suffix = '', auth, method = 'GET') =>
    fetch(`${url}${suffix}`, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {} })
  try {
    assert.equal((await get()).status, 401)
    assert.equal((await get('', token('ADMIN', '-1s'))).status, 401)
    assert.equal((await get('', token('CUSTOMER'))).status, 403)
    assert.equal((await get('', token('TECHNICIAN'))).status, 403)
    const admin = token('ADMIN')
    for (const suffix of [
      '',
      '?year=2026&month=10&year=2025',
      '?year=2026&month=10&page=1',
      '?year=2026&month=10&service=bad',
    ])
      assert.equal((await get(suffix, admin)).status, 422)
    assert.equal(calls.length, 0)
    const response = await get('?period=MONTH&year=2026&month=10', admin)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.success, true)
    assert.equal(body.data.summary.totalRevenue, '0.00')
    assert.equal(body.data.trend.length, 31)
    for (const method of ['POST', 'PATCH', 'DELETE'])
      assert.equal((await get('', admin, method)).status, 404)
    assert.equal(calls.length, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
