import assert from 'node:assert/strict'
import test from 'node:test'
import {
  presetReportRange,
  readReportRange,
  reportAxisLabel,
  reportBucketLabel,
  reportChartSeries,
  reportCount,
  reportDate,
  reportErrorKey,
  reportMoney,
  reportMoneyUnits,
  reportPercent,
  reportRangeError,
  reportRangePreset,
  reportServiceRows,
  reportTimestamp,
  vietnamToday,
} from './reportPresentation.js'

test('quick periods include today in Vietnam, with leap years and year boundaries', () => {
  assert.equal(vietnamToday(new Date('2026-12-31T17:00:00Z')), '2027-01-01')
  assert.deepEqual(presetReportRange('7', '2027-01-01'), { from: '2026-12-26', to: '2027-01-01' })
  assert.deepEqual(presetReportRange('30', '2024-03-01'), { from: '2024-02-01', to: '2024-03-01' })
  assert.deepEqual(presetReportRange('YTD', '2024-12-31'), { from: '2024-01-01', to: '2024-12-31' })
  assert.equal(reportRangePreset({ from: '2024-02-01', to: '2024-03-01' }, '2024-03-01'), '30')
})

test('custom periods require two real, ordered dates and at most 366 inclusive days', () => {
  assert.equal(reportRangeError({ from: '2024-01-01', to: '2024-12-31' }), '')
  assert.equal(reportRangeError({ from: '9999-01-01', to: '9999-12-31' }), '')
  for (const range of [
    { from: '2023-02-29', to: '2023-03-01' },
    { from: '2026-10-15', to: '2026-10-14' },
    { from: '2024-01-01', to: '2025-01-01' },
    { from: '1899-12-31', to: '1900-01-01' },
    { from: '', to: '2026-10-15' },
  ])
    assert.ok(reportRangeError(range))
  assert.deepEqual(
    readReportRange(new URLSearchParams('from=2026-10-01'), { from: 'fallback', to: 'fallback' }),
    { from: '2026-10-01', to: '' }
  )
})

test('commission presentation keeps exact cents, zero and unknown values distinct', () => {
  assert.equal(reportMoney('9007199254740993.07'), '9,007,199,254,740,993.07 ₫')
  assert.equal(reportMoneyUnits('9007199254740993.07'), 900719925474099307n)
  assert.equal(reportMoneyUnits(null), null)
  const series = reportChartSeries(
    [
      { commissionAmount: '0.00' },
      { commissionAmount: null },
      { commissionAmount: '9007199254740993.07' },
    ],
    'commission'
  )
  assert.equal(series.values[0], 0n)
  assert.equal(series.values[1], null)
  assert.equal(series.ratio(null), null)
  assert.equal(series.ratio(0n), 0)
  assert.ok(series.ratio(series.values[2]) <= 1)
  assert.ok(series.ratio(series.values[2]) > 0)
})

test('switching locale changes money separators without losing any integer or cents', () => {
  for (const [value, english, vietnamese] of [
    ['300000.00', '300,000 ₫', '300.000 ₫'],
    ['9007199254740993.07', '9,007,199,254,740,993.07 ₫', '9.007.199.254.740.993,07 ₫'],
    [
      '999999999999999999999999999999999999999.10',
      '999,999,999,999,999,999,999,999,999,999,999,999,999.10 ₫',
      '999.999.999.999.999.999.999.999.999.999.999.999.999,10 ₫',
    ],
    ['-9007199254740993.01', '-9,007,199,254,740,993.01 ₫', '-9.007.199.254.740.993,01 ₫'],
    ['-0.05', '-0.05 ₫', '-0,05 ₫'],
    ['0.00', '0 ₫', '0 ₫'],
    [null, '—', '—'],
    [undefined, '—', '—'],
    ['invalid', '—', '—'],
  ]) {
    assert.equal(reportMoney(value), english)
    assert.equal(reportMoney(value, 'vi'), vietnamese)
    assert.equal(reportMoney(value, 'en'), english)
  }
})

test('counts and percentages follow the selected locale, including exact large counts', () => {
  assert.equal(reportCount(1234, 'vi'), '1.234')
  assert.equal(reportCount(1234, 'en'), '1,234')
  assert.equal(reportCount('9007199254740993', 'vi'), '9.007.199.254.740.993')
  assert.equal(reportCount('9007199254740993', 'en'), '9,007,199,254,740,993')
  assert.equal(reportCount(-1234n, 'vi'), '-1.234')
  assert.equal(reportPercent(38.7, 'vi'), '38,7%')
  assert.equal(reportPercent(38.7, 'en'), '38.7%')
  for (const locale of ['en', 'vi']) {
    assert.equal(reportCount(0, locale), '0')
    assert.equal(reportPercent(0, locale), '0%')
    assert.equal(reportCount(null, locale), '—')
    assert.equal(reportPercent(null, locale), '—')
  }
})

test('commission axis labels localize exact BigInt scaling and signed cents', () => {
  for (const [units, english, vietnamese] of [
    [0n, '0', '0'],
    [5n, '0.05', '0,05'],
    [-5n, '-0.05', '-0,05'],
    [123_450n, '1.2K', '1,2 nghìn'],
    [125_000n, '1.3K', '1,3 nghìn'],
    [-125_000n, '-1.3K', '-1,3 nghìn'],
    [120_000_000n, '1.2M', '1,2 triệu'],
    [120_000_000_000n, '1.2B', '1,2 tỷ'],
    [120_000_000_000_000n, '1.2T', '1,2 nghìn tỷ'],
    [900719925474099307n, '9,007.2T', '9.007,2 nghìn tỷ'],
  ]) {
    assert.equal(reportAxisLabel(units, 'commission'), english)
    assert.equal(reportAxisLabel(units, 'commission', 'vi'), vietnamese)
  }
  assert.equal(reportAxisLabel(1234n, 'bookings', 'vi'), '1.234')
  assert.equal(reportAxisLabel(1234n, 'bookings', 'en'), '1,234')
})

test('localized snapshot timestamps keep fixed UTC+7 and existing calendar labels', () => {
  const time = '2026-12-31T17:05:00.000Z'
  assert.equal(reportTimestamp(time, 'vi'), '00:05 01/01/2027')
  assert.equal(reportTimestamp(time, 'en'), '01/01/2027, 00:05')
  assert.equal(reportTimestamp('invalid', 'vi'), '—')
  assert.equal(reportTimestamp(null, 'en'), '—')
  assert.equal(reportDate('2026-10-15'), '15/10/2026')
  assert.equal(reportBucketLabel('2026-10-15', 'day'), '15/10')
  assert.equal(reportBucketLabel('2026-10-01', 'month'), '10/2026')
})

test('report request failures map to stable translation keys, without exposing server text', () => {
  assert.equal(
    reportErrorKey({ status: 403, message: 'Admin only' }),
    'You do not have permission to view reports.'
  )
  assert.equal(
    reportErrorKey({ status: 422, message: 'Invalid date from backend' }),
    'Check the report period and try again.'
  )
  assert.equal(
    reportErrorKey(new Error('Không thể kết nối máy chủ. Vui lòng thử lại.')),
    'Unable to connect to the server. Please try again.'
  )
  for (const error of [
    { status: 500, message: 'Database secret' },
    new Error('Unknown error'),
    null,
  ])
    assert.equal(reportErrorKey(error), 'Unable to load reports. Please try again.')
})

test('more than four services keep all remaining uses in Other services', () => {
  const grouped = reportServiceRows({
    totalUses: 10,
    items: Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      name: `Service ${i}`,
      count: i < 4 ? 2 : 1,
      percentage: i < 4 ? 20 : 10,
    })),
  })
  assert.equal(grouped.length, 5)
  assert.equal(grouped.at(-1).count, 2)
  assert.equal(grouped.at(-1).percentage, 20)
  assert.equal(
    grouped.reduce((sum, row) => sum + row.count, 0),
    10
  )
})

test('booking chart grid intervals are whole counts at every tick', () => {
  for (const bookings of [1, 5, 10, 29, 30, 123]) {
    const { maximum } = reportChartSeries([{ bookings }], 'bookings')
    assert.equal(maximum % 4n, 0n)
    assert.ok(maximum >= BigInt(bookings))
  }
})
