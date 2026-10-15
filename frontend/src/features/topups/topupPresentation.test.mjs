import assert from 'node:assert/strict'
import test from 'node:test'
import {
  currentTopupMonth,
  initialTopupFilters,
  readTopupFilters,
  writeTopupFilters,
} from './topupFilters.js'
import {
  formatTopupAmount,
  formatTopupDate,
  formatTopupTime,
  topupMethodName,
  topupReference,
  validTopupId,
} from './topupPresentation.js'

test('top-up amount and linked wallet credit preserve exact stored values', () => {
  assert.equal(formatTopupAmount('300000.00'), '300,000 ₫')
  assert.equal(formatTopupAmount('0.00'), '0 ₫')
  assert.equal(formatTopupAmount(null), '—')
  assert.equal(formatTopupAmount('9007199254740993.07'), '9,007,199,254,740,993.07 ₫')
  assert.equal(formatTopupAmount('invalid'), '—')
})

test('top-up dates use fixed UTC+7 for modern and historical timestamps', () => {
  assert.equal(formatTopupDate('2026-10-11T17:00:00Z'), '12/10/2026')
  assert.equal(formatTopupTime('1900-12-31T16:58:00Z'), '31/12/1900, 23:58:00')
  assert.equal(formatTopupTime(null), '—')
  assert.deepEqual(currentTopupMonth(new Date('1900-12-31T16:58:00Z')), {
    from: '1900-12-01',
    to: '1900-12-31',
  })
})

test('selected method UUID survives a detail/back URL together with all filters', () => {
  const method = 'fecee0a1-0af4-9add-8d41-d6910140b1b7'
  const filters = {
    search: 'Nguyễn An % _',
    status: 'SUCCESS',
    method,
    from: '2026-10-01',
    to: '2026-10-31',
    page: 3,
    limit: 25,
  }
  assert.deepEqual(readTopupFilters(writeTopupFilters(filters)), filters)
  assert.equal(
    readTopupFilters(new URLSearchParams({ method: method.toUpperCase() })).method,
    method
  )
  assert.equal(writeTopupFilters(initialTopupFilters).toString(), '')
})

test('unknown and malformed method filters remain selected for server validation', () => {
  for (const method of ['00000000-0000-0000-0000-000000000000', 'unknown-method', '']) {
    const parsed = readTopupFilters(new URLSearchParams({ method }))
    assert.equal(parsed.method, method)
    assert.equal(writeTopupFilters(parsed).get('method'), method)
    assert.notEqual(parsed.method, 'ALL')
  }
})

test('method display comes from saved names or codes, without invented providers', () => {
  assert.equal(topupMethodName({ name: 'VNPay historical', code: 'VNPAY' }), 'VNPay historical')
  assert.equal(topupMethodName({ name: null, code: 'ZALOPAY' }), 'ZALOPAY')
  assert.equal(topupMethodName(null), '—')
})

test('detail references use top-up code and only real UUIDs pass the local guard', () => {
  const id = 'fecee0a1-0af4-9add-8d41-d6910140b1b7'
  assert.equal(topupReference({ id, topupCode: 'DEMO-TU-001' }), 'DEMO-TU-001')
  assert.equal(topupReference({ id, topupCode: null }), 'fecee0a1…b1b7')
  assert.equal(validTopupId(id.toUpperCase()), true)
  assert.equal(validTopupId('TU-9021'), false)
})
