import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultRevenueFilters,
  readRevenueFilters,
  revenueFilterError,
  writeRevenueFilters,
} from './revenueFilters.js'
import {
  formatRevenueAmount,
  formatRevenuePercent,
  revenueAreaPath,
  revenueLinePath,
  revenueNumber,
} from './revenuePresentation.js'

test('money formatting keeps zero, missing values, cents and large integer precision distinct', () => {
  assert.equal(formatRevenueAmount(null), '—')
  assert.equal(formatRevenueAmount(undefined), '—')
  assert.equal(formatRevenueAmount('0.00'), '0 ₫')
  assert.equal(formatRevenueAmount('12.05'), '12.05 ₫')
  assert.equal(formatRevenueAmount('-0.07'), '-0.07 ₫')
  assert.equal(formatRevenueAmount('9007199254740993.07'), '9,007,199,254,740,993.07 ₫')
  assert.equal(formatRevenueAmount('not money'), '—')
})

test('missing chart amounts create gaps and zero stays a valid point', () => {
  const rows = [{ amount: '0' }, { amount: '5' }, { amount: null }, { amount: '8' }]
  const point = (value, index) => ({ x: index, y: value })
  assert.equal(revenueLinePath(rows, 'amount', point), 'M0.00,0.00 L1.00,5.00 M3.00,8.00')
  assert.equal(revenueNumber(null), null)
  assert.equal(revenueNumber(''), null)
  assert.equal(revenueNumber('0'), 0)
  assert.equal(
    revenueAreaPath(rows, 'amount', point, 20),
    'M0.00,0.00 L1.00,5.00 L1.00,20.00 L0.00,20.00 Z M3.00,8.00 L3.00,20.00 L3.00,20.00 Z'
  )
})

test('missing comparison is not shown as zero percent', () => {
  assert.equal(formatRevenuePercent(null, true), '—')
  assert.equal(formatRevenuePercent('', true), '—')
  assert.equal(formatRevenuePercent(0, true), '0%')
  assert.equal(formatRevenuePercent(12.345, true), '+12.3%')
  assert.equal(formatRevenuePercent(-12.345, true), '-12.3%')
})

test('current default period follows Vietnam midnight rather than UTC midnight', () => {
  const defaults = defaultRevenueFilters(new Date('2026-12-31T17:00:00Z'))
  assert.equal(defaults.year, '2027')
  assert.equal(defaults.month, '01')
  assert.equal(defaults.quarter, '1')
})

test('URL filters escape city names and only send period-specific fields', () => {
  const defaults = defaultRevenueFilters(new Date('2026-10-01T00:00:00Z'))
  const filters = {
    ...defaults,
    period: 'QUARTER',
    quarter: '2',
    service: 'UNCLASSIFIED',
    area: 'Hồ Chí Minh & vùng lân cận',
  }
  const params = writeRevenueFilters(filters)
  assert.equal(params.get('month'), null)
  assert.equal(params.get('quarter'), '2')
  assert.equal(readRevenueFilters(params, defaults).area, filters.area)
  assert.equal(readRevenueFilters(params, defaults).service, 'UNCLASSIFIED')
  const yearParams = writeRevenueFilters({ ...filters, period: 'YEAR' })
  assert.equal(yearParams.get('month'), null)
  assert.equal(yearParams.get('quarter'), null)
})

test('period validation rejects incomplete years without sending a request', () => {
  const defaults = defaultRevenueFilters(new Date('2026-10-01T00:00:00Z'))
  assert.equal(revenueFilterError({ ...defaults, year: '1900' }), '')
  assert.equal(revenueFilterError({ ...defaults, year: '9999' }), '')
  for (const year of ['', '202', '2e3', '1899', '10000'])
    assert.ok(revenueFilterError({ ...defaults, year }))
  assert.ok(revenueFilterError({ ...defaults, month: '13' }))
  assert.ok(revenueFilterError({ ...defaults, period: 'QUARTER', quarter: '0' }))
})

test('switching from a selected month derives the corresponding quarter', () => {
  const defaults = defaultRevenueFilters(new Date('2026-10-01T00:00:00Z'))
  const filters = readRevenueFilters(
    new URLSearchParams('period=MONTH&year=2026&month=02'),
    defaults
  )
  assert.equal(filters.quarter, '1')
})
