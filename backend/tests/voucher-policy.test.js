import test from 'node:test'
import assert from 'node:assert/strict'
import { validateVoucherInput } from '../src/modules/vouchers/voucher.validation.js'
import { validateCompensationVoucher } from '../src/modules/complaints/complaint.validation.js'
import { voucherFitsBooking } from '../src/modules/vouchers/voucher-policy.js'
import { VoucherRepository } from '../src/modules/vouchers/voucher.repository.js'
import { ensureVoucherMarginGuard } from '../src/config/database.js'

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

test('backend startup installs the voucher margin guard only when missing', async () => {
  for (const installed of [false, true]) {
    const statements = []
    await ensureVoucherMarginGuard(async work => work({
      query: async sql => {
        statements.push(sql)
        if (sql.includes('SELECT EXISTS')) return { rows: [{ installed }] }
        return { rowCount: 1 }
      },
    }))
    const constraint = statements.find(sql => sql.includes('ADD CONSTRAINT'))
    assert.equal(Boolean(constraint), !installed)
    if (constraint) {
      assert.match(constraint, /platform_discount_amount <= 50000/)
      assert.match(constraint, /commission_base_amount \* 0\.20/)
      assert.match(constraint, /platform_discount_amount <= commission_amount/)
      assert.match(constraint, /NOT VALID/)
    }
    const deactivation = statements.find(sql => sql.includes('UPDATE vouchers'))
    assert.match(deactivation, /v\.discount_value > 20/)
    assert.match(deactivation, /v\.discount_value > 50000/)
    assert.match(deactivation, /vu\.status = 'RESERVED'/)
  }
})
