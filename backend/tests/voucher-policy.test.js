import test from 'node:test'
import assert from 'node:assert/strict'
import { validateVoucherInput } from '../src/modules/vouchers/voucher.validation.js'
import { validateCompensationVoucher } from '../src/modules/complaints/complaint.validation.js'
import { voucherFitsBooking, assertPaymentVoucherMargin } from '../src/modules/vouchers/voucher-policy.js'
import { VoucherRepository } from '../src/modules/vouchers/voucher.repository.js'
import { readFileSync } from 'node:fs'

const voucher = (overrides = {}) => ({
  code: 'SAVE50K',
  name: 'Service discount',
  discount_type: 'FIXED_AMOUNT',
  discount_value: 50_000,
  minimum_order_amount: 250_000,
  maximum_discount: 50_000,
  start_at: '2026-11-01T00:00:00Z',
  end_at: '2026-12-01T00:00:00Z',
  ...overrides,
})

test('admin voucher input respects the 20% and 50,000 VND limits', () => {
  assert.equal(validateVoucherInput(voucher()).discount_value, 50_000)
  assert.equal(validateVoucherInput(voucher({ discount_type: 'PERCENTAGE', discount_value: 20 })).discount_value, 20)
  for (const changes of [
    { discount_type: 'PERCENTAGE', discount_value: 21 },
    { discount_value: 50_001 },
    { maximum_discount: 50_001 },
    { minimum_order_amount: 249_999 },
  ]) {
    assert.throws(() => validateVoucherInput(voucher(changes)), { code: 'VALIDATION_ERROR' })
  }
})

test('compensation vouchers use the same cap and service minimum', () => {
  assert.equal(validateCompensationVoucher({ discount_value: 50_000, minimum_order_amount: 250_000 }).discount_value, 50_000)
  assert.throws(() => validateCompensationVoucher({ discount_value: 50_001, minimum_order_amount: 300_000 }), { code: 'VALIDATION_ERROR' })
  assert.throws(() => validateCompensationVoucher({ discount_value: 50_000, minimum_order_amount: 200_000 }), { code: 'VALIDATION_ERROR' })
})

test('actual discount cannot exceed the booking commission or the cap', () => {
  assert.equal(voucherFitsBooking(voucher(), 250_000, .2), true)
  assert.equal(voucherFitsBooking(voucher(), 250_000, .1), false)
  assert.equal(voucherFitsBooking(voucher(), 200_000, .2), false)
  assert.equal(voucherFitsBooking(voucher({ discount_value: 100_000 }), 500_000, .2), false)
  assert.equal(voucherFitsBooking(voucher({ discount_type: 'PERCENTAGE', discount_value: 20 }), 300_000, .2), true)
})

test('repository caps a new voucher even when the API omits its cap', async () => {
  let inserted
  const repository = new VoucherRepository({
    transaction: async (callback) => callback({
      query: async (sql, values = []) => {
        if (sql.startsWith('SELECT id FROM vouchers')) return { rowCount: 0 }
        if (sql.startsWith('INSERT INTO vouchers')) {
          inserted = { sql, values }
          return { rows: [{ id: 'voucher-id', ...voucher(), maximum_discount: 50_000 }] }
        }
        return { rows: [] }
      },
    }),
    audit: () => {},
  })
  await repository.save(null, validateVoucherInput(voucher({ maximum_discount: null })), 'admin-id', 'CREATE_VOUCHER')
  const capIndex = inserted.sql.match(/INSERT INTO vouchers\(([^)]+)\)/)[1].split(',').indexOf('maximum_discount')
  assert.equal(inserted.values[capIndex], 50_000)
})

test('admin cannot lower voucher limit below used and reserved slots', async () => {
  let updated = false
  const repository = new VoucherRepository({
    transaction: async work => work({ query: async sql => {
      if (sql.startsWith('SELECT * FROM vouchers')) return { rows: [{
        id: 'voucher-id', ...voucher(), usage_count: 1, usage_limit: 3,
        start_at: new Date(Date.now() - 86_400_000),
        end_at: new Date(Date.now() + 86_400_000),
      }] }
      if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 2 }] }
      if (sql.startsWith('UPDATE vouchers')) updated = true
      return { rows: [] }
    } }),
    audit: () => {},
  })
  await assert.rejects(
    repository.save('voucher-id', { usage_limit: 1 }, 'admin-id', 'UPDATE_VOUCHER'),
    { code: 'VALIDATION_ERROR' },
  )
  assert.equal(updated, false)
})

test('payment snapshot preserves voucher margin without schema changes', () => {
  const payment = { platform_discount_amount: '50000.00', commission_base_amount: '250000.00', commission_amount: '50000.00' }
  assert.doesNotThrow(() => assertPaymentVoucherMargin(payment))
  assert.doesNotThrow(() => assertPaymentVoucherMargin({ platform_discount_amount: 0 }))
  for (const overrides of [
    { platform_discount_amount: 50001 }, { commission_base_amount: 249999 },
    { commission_amount: 49999 }, { commission_amount: null }, { commission_base_amount: null },
  ]) assert.throws(() => assertPaymentVoucherMargin({ ...payment, ...overrides }), { code: 'VOUCHER_NOT_ELIGIBLE' })
})

test('startup does not modify the schema or automatically rewrite voucher policy data', () => {
  const source = ['../src/config/database.js', '../src/server.js'].map(path =>
    readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
  assert.doesNotMatch(source, /ALTER TABLE|CREATE INDEX|CREATE TABLE|UPDATE vouchers|ensureServiceLocationKeys|ensureVoucherMarginGuard/i)
})
