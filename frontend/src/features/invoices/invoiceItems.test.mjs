import test from 'node:test'
import assert from 'node:assert/strict'
import { groupInvoiceItems } from './invoiceItems.js'

const serviceId = '6af32092-a705-4f56-9398-7d4edb13d73e'
const otherServiceId = '9a669b75-babd-488d-f036-263aecd01bd0'
const item = (id, overrides = {}) => ({
  id,
  itemType: 'SERVICE',
  service: { id: serviceId, name: 'Bảo dưỡng máy lạnh' },
  description: 'Bảo dưỡng máy lạnh',
  unit: 'lần',
  quantity: '1.000',
  unitPrice: '250000.00',
  discountAmount: '0.00',
  totalPrice: '250000.00',
  ...overrides,
})

test('two equivalent maintenance rows become quantity 2 without changing the unit price', () => {
  const rows = groupInvoiceItems([
    item('first'),
    item('second', { quantity: '1', unitPrice: '250000', discountAmount: '0' }),
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'first')
  assert.equal(rows[0].quantity, '2.000')
  assert.equal(rows[0].unitPrice, '250000.00')
  assert.equal(rows[0].discountAmount, '0.00')
  assert.equal(rows[0].totalPrice, '500000.00')
})

test('fractional quantities and amounts beyond safe integers are summed exactly', () => {
  const fractional = groupInvoiceItems([
    item('a', { quantity: '0.125', unitPrice: '8.00', totalPrice: '1.00' }),
    item('b', { quantity: '0.250', unitPrice: '8', totalPrice: '2' }),
  ])
  assert.equal(fractional[0].quantity, '0.375')
  assert.equal(fractional[0].totalPrice, '3.00')

  const huge = '9007199254740993.27'
  const rows = groupInvoiceItems([
    item('a', { unitPrice: huge, totalPrice: huge }),
    item('b', { unitPrice: huge, quantity: '2', totalPrice: '18014398509481986.54' }),
  ])
  assert.equal(rows[0].quantity, '3.000')
  assert.equal(rows[0].unitPrice, huge)
  assert.equal(rows[0].totalPrice, '27021597764222979.81')
})

test('equivalent per-unit discounts merge, but differing discounts or effective totals stay separate', () => {
  const rows = groupInvoiceItems([
    item('a', { discountAmount: '10000', totalPrice: '240000' }),
    item('b', { quantity: '2', discountAmount: '20000', totalPrice: '480000' }),
    item('different-discount', { discountAmount: '20000', totalPrice: '230000' }),
    item('different-total', { discountAmount: '10000', totalPrice: '239999.99' }),
  ])
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a', 'different-discount', 'different-total']
  )
  assert.equal(rows[0].quantity, '3.000')
  assert.equal(rows[0].discountAmount, '30000.00')
  assert.equal(rows[0].totalPrice, '720000.00')
})

test('different service, type, snapshot description, unit or price never merge', () => {
  const variants = [
    { service: { id: otherServiceId, name: 'Bảo dưỡng máy lạnh' } },
    { itemType: 'LABOR' },
    { description: 'Bảo dưỡng máy lạnh khác' },
    { description: 'Bảo dưỡng máy lạnh ' },
    { unit: 'máy' },
    { unitPrice: '250000.01' },
  ]
  for (const variant of variants) {
    const rows = groupInvoiceItems([item('a'), item('b', variant)])
    assert.equal(rows.length, 2, JSON.stringify(variant))
  }
  const labor = groupInvoiceItems([
    item('a', { itemType: 'LABOR' }),
    item('b', { itemType: 'LABOR' }),
  ])
  assert.equal(labor.length, 1)
  assert.equal(labor[0].quantity, '2.000')
})

test('unlinked and unknown rows remain separate rather than guessing a service from their description', () => {
  for (const variant of [
    { service: null },
    { service: { name: 'Bảo dưỡng máy lạnh' } },
    { service: { id: 'not-a-service-id' } },
    { itemType: null },
    { itemType: 'PART' },
    { description: null },
    { description: '' },
    { unit: null },
  ]) {
    const original = [item('a', variant), item('b', variant)]
    const rows = groupInvoiceItems(original)
    assert.equal(rows.length, 2, JSON.stringify(variant))
    assert.deepEqual(rows, original)
    assert.notEqual(rows[0], original[0])
  }
  assert.deepEqual(groupInvoiceItems([null, undefined]), [null, undefined])
  assert.deepEqual(groupInvoiceItems(), [])
})

test('missing, negative, numeric or overprecision values are retained without fabricated zeroes', () => {
  for (const field of ['quantity', 'unitPrice', 'discountAmount', 'totalPrice']) {
    for (const value of [null, undefined, '', '-1', 'NaN', 'Infinity', 1, '1.0001']) {
      const original = [item('a', { [field]: value }), item('b', { [field]: value })]
      const rows = groupInvoiceItems(original)
      assert.deepEqual(rows, original, `${field}: ${String(value)}`)
      assert.equal(rows.length, 2)
    }
  }
  const zeroQuantity = [item('a', { quantity: '0' }), item('b', { quantity: '0' })]
  assert.deepEqual(groupInvoiceItems(zeroQuantity), zeroQuantity)
})

test('nonadjacent groups keep first-seen order, first IDs and original snapshots', () => {
  const rows = groupInvoiceItems([
    item('a'),
    item('different', { description: 'Kiểm tra' }),
    item('b', { service: { id: serviceId.toUpperCase(), name: 'Current renamed service' } }),
    item('unlinked', { service: null }),
    item('c'),
  ])
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a', 'different', 'unlinked']
  )
  assert.equal(rows[0].quantity, '3.000')
  assert.equal(rows[0].service.name, 'Bảo dưỡng máy lạnh')
})

test('grouping frozen source data never mutates any stored item or changes aggregate sums', () => {
  const original = [
    item('a', { quantity: '0.125', unitPrice: '8', discountAmount: '0.10', totalPrice: '0.90' }),
    item('b', { quantity: '0.250', unitPrice: '8', discountAmount: '0.20', totalPrice: '1.80' }),
    item('c'),
    item('unlinked', { service: null, totalPrice: '9007199254740993.27' }),
  ]
  const snapshot = structuredClone(original)
  for (const row of original) {
    if (row.service) Object.freeze(row.service)
    Object.freeze(row)
  }
  Object.freeze(original)
  const rows = groupInvoiceItems(original)
  assert.deepEqual(original, snapshot)
  assert.notEqual(rows[0], original[0])

  const sum = (data, field, scale) =>
    data.reduce((total, row) => {
      const [whole, fraction = ''] = row[field].split('.')
      return total + BigInt(whole + fraction.padEnd(scale, '0'))
    }, 0n)
  for (const [field, scale] of [
    ['quantity', 3],
    ['discountAmount', 2],
    ['totalPrice', 2],
  ])
    assert.equal(sum(rows, field, scale), sum(original, field, scale), field)
})
