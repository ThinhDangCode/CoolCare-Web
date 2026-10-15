import assert from 'node:assert/strict'
import test from 'node:test'
import {
  currentWithdrawalMonth,
  initialWithdrawalFilters,
  readWithdrawalFilters,
  validWithdrawalDay,
  withdrawalRangeError,
  writeWithdrawalFilters,
} from './withdrawalFilters.js'
import {
  formatWithdrawalAmount,
  formatWithdrawalDate,
  formatWithdrawalTime,
  validWithdrawalId,
  withdrawalReference,
  withdrawalText,
} from './withdrawalPresentation.js'

test('stored gross, fee, net and wallet debit are formatted independently', () => {
  assert.equal(formatWithdrawalAmount('100000.00'), '100,000 ₫')
  assert.equal(formatWithdrawalAmount('5000.00'), '5,000 ₫')
  assert.equal(formatWithdrawalAmount('95000.00'), '95,000 ₫')
  assert.equal(formatWithdrawalAmount('-100000.00'), '-100,000 ₫')
})

test('unknown fee/net remain distinct from zero and large decimal money stays exact', () => {
  assert.equal(formatWithdrawalAmount(null), '—')
  assert.equal(formatWithdrawalAmount(undefined), '—')
  assert.equal(formatWithdrawalAmount('0.00'), '0 ₫')
  assert.equal(formatWithdrawalAmount('-0.07'), '-0.07 ₫')
  assert.equal(formatWithdrawalAmount('9007199254740993.07'), '9,007,199,254,740,993.07 ₫')
  assert.equal(formatWithdrawalAmount('invalid'), '—')
})

test('withdrawal timestamps use fixed UTC+7 including historical dates', () => {
  assert.equal(formatWithdrawalDate('2026-10-11T16:59:00Z'), '11/10/2026')
  assert.equal(formatWithdrawalTime('2026-10-11T16:59:00Z'), '11/10/2026, 23:59:00')
  assert.equal(formatWithdrawalDate('2026-10-11T17:00:00Z'), '12/10/2026')
  assert.equal(formatWithdrawalTime('1800-01-01T17:00:00Z'), '02/01/1800, 00:00:00')
  assert.equal(formatWithdrawalTime(null), '—')
})

test('real UUID fallback is compact and payout reference remains unchanged', () => {
  const id = 'fecee0a1-0af4-9add-8d41-d6910140b1b7'
  assert.equal(withdrawalReference({ id, payoutReference: null }), 'fecee0a1…b1b7')
  assert.equal(withdrawalReference({ id, payoutReference: 'PAYOUT-001' }), 'PAYOUT-001')
  assert.equal(validWithdrawalId(id.toUpperCase()), true)
  assert.equal(validWithdrawalId('WD001'), false)
  assert.equal(withdrawalText('00123456789'), '00123456789')
})

test('real calendar dates and open-ended ranges match backend limits', () => {
  assert.equal(validWithdrawalDay('0001-01-01'), true)
  assert.equal(validWithdrawalDay('9999-12-31'), true)
  assert.equal(validWithdrawalDay('2024-02-29'), true)
  assert.equal(validWithdrawalDay('2026-02-29'), false)
  assert.equal(validWithdrawalDay('0000-01-01'), false)
  assert.equal(withdrawalRangeError({ from: '2026-10-01', to: '' }), '')
  assert.ok(withdrawalRangeError({ from: '2026-10-31', to: '2026-10-01' }))
})

test('This month follows Vietnam date when UTC is still in previous month', () => {
  assert.deepEqual(currentWithdrawalMonth(new Date('2026-12-31T17:00:00Z')), {
    from: '2027-01-01',
    to: '2027-01-31',
  })
  assert.deepEqual(currentWithdrawalMonth(new Date('1900-12-31T16:58:00Z')), {
    from: '1900-12-01',
    to: '1900-12-31',
  })
  assert.deepEqual(currentWithdrawalMonth(new Date('0001-02-01T00:00:00Z')), {
    from: '0001-02-01',
    to: '0001-02-28',
  })
  assert.deepEqual(currentWithdrawalMonth(new Date('2024-02-01T00:00:00Z')), {
    from: '2024-02-01',
    to: '2024-02-29',
  })
})

test('list filters round-trip through detail URL without losing search/date/page', () => {
  const filters = {
    search: 'Nguyễn An % _',
    status: 'PENDING',
    from: '2026-10-01',
    to: '2026-10-31',
    page: 3,
    limit: 25,
  }
  const query = writeWithdrawalFilters(filters)
  assert.deepEqual(readWithdrawalFilters(query), filters)
  assert.equal(writeWithdrawalFilters(initialWithdrawalFilters).toString(), '')
  assert.deepEqual(
    readWithdrawalFilters(new URLSearchParams('page=0&limit=999&status=MADE_UP&from=2026-02-30')),
    initialWithdrawalFilters
  )
})
