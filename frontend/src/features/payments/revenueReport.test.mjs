import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultRevenuePeriod,
  deriveRevenueRange,
  revenueFilename,
  revenueRowCount,
  validReportDate,
} from './revenueReport.js'

test('current month follows Vietnam calendar across UTC year boundary', () => {
  const period = defaultRevenuePeriod(new Date('2026-12-31T17:01:00Z'))
  assert.equal(period.year, '2027')
  assert.equal(period.month, '01')
  assert.equal(period.quarter, '1')
  assert.deepEqual(deriveRevenueRange(period), { from: '2027-01-01', to: '2027-01-31', error: '' })
})

test('month periods include the correct Gregorian last day', () => {
  for (const [year, day] of [
    ['1900', '28'],
    ['2000', '29'],
    ['2024', '29'],
    ['2025', '28'],
  ]) {
    assert.deepEqual(deriveRevenueRange({ mode: 'month', year, month: '02' }), {
      from: `${year}-02-01`,
      to: `${year}-02-${day}`,
      error: '',
    })
  }
})

test('quarter and year periods include complete calendar dates', () => {
  assert.deepEqual(deriveRevenueRange({ mode: 'quarter', year: '2026', quarter: '1' }), {
    from: '2026-01-01',
    to: '2026-03-31',
    error: '',
  })
  assert.deepEqual(deriveRevenueRange({ mode: 'quarter', year: '2026', quarter: '4' }), {
    from: '2026-10-01',
    to: '2026-12-31',
    error: '',
  })
  assert.deepEqual(deriveRevenueRange({ mode: 'year', year: '9999' }), {
    from: '9999-01-01',
    to: '9999-12-31',
    error: '',
  })
})

test('custom range allows a single day and rejects missing, reversed or impossible dates', () => {
  assert.deepEqual(deriveRevenueRange({ mode: 'custom', from: '2026-10-12', to: '2026-10-12' }), {
    from: '2026-10-12',
    to: '2026-10-12',
    error: '',
  })
  for (const [from, to] of [
    ['', '2026-10-12'],
    ['2026-10-12', ''],
    ['2026-10-13', '2026-10-12'],
    ['2026-04-31', '2026-05-01'],
    ['1899-12-31', '1900-01-01'],
    ['9999-12-31', '10000-01-01'],
  ]) {
    assert.ok(deriveRevenueRange({ mode: 'custom', from, to }).error)
  }
  assert.equal(validReportDate('2000-02-29'), true)
  assert.equal(validReportDate('1900-02-29'), false)
})

test('invalid period controls never produce an export date range', () => {
  for (const period of [
    { mode: 'month', year: '2026', month: '13' },
    { mode: 'quarter', year: '2026', quarter: '5' },
    { mode: 'year', year: '1899' },
    { mode: 'year', year: '10000' },
    { mode: 'month', year: '', month: '' },
  ]) {
    const result = deriveRevenueRange(period)
    assert.ok(result.error)
    assert.equal(result.from, '')
    assert.equal(result.to, '')
  }
})

test('download filenames accept a workbook name and reject paths, controls or wrong extensions', () => {
  const from = '2026-10-01'
  const to = '2026-10-31'
  const fallback = 'CoolCare_Revenue_20261001_20261031.xlsx'
  assert.equal(
    revenueFilename('attachment; filename="Revenue_2026.xlsx"', from, to),
    'Revenue_2026.xlsx'
  )
  for (const disposition of [
    null,
    'attachment; filename="../../private.xlsx"',
    'attachment; filename="bad\r\nname.xlsx"',
    'attachment; filename="revenue.html"',
    `attachment; filename="${'x'.repeat(130)}.xlsx"`,
  ]) {
    assert.equal(revenueFilename(disposition, from, to), fallback)
  }
  assert.equal(revenueFilename(null, '../private', 'missing'), 'CoolCare_Revenue_start_end.xlsx')
})

test('row-count header preserves zero and treats missing or unsupported values as unknown', () => {
  assert.equal(revenueRowCount('0'), 0)
  assert.equal(revenueRowCount('10000'), 10000)
  for (const value of [null, '', '-1', '2.5', '10001', 'NaN'])
    assert.equal(revenueRowCount(value), null)
})
