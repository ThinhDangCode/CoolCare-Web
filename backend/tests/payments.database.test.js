import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { PaymentsRepository } from '../src/modules/payments/payments.repository.js'
import { validatePaymentListQuery } from '../src/modules/payments/payments.validation.js'

test(
  'payment list/detail read real local snapshots and ledger without changing financial data',
  { skip: process.env.RUN_PAYMENTS_DB_TESTS !== '1' },
  async () => {
    const repository = new PaymentsRepository()
    const list = (query = {}) => repository.listPayments(validatePaymentListQuery(query))
    const snapshot = async () => {
      const results = await Promise.all(
        ['payments', 'technician_accounts', 'settlement_transactions'].map((table) =>
          pool.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb)::text) AS checksum FROM ${table} t`)
        )
      )
      return results.map((result) => result.rows[0].checksum)
    }
    try {
      const before = await snapshot()
      const expected = (await pool.query(
        `SELECT p.id, p.payment_code, p.payment_status, p.amount, p.created_at,
          (p.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS vietnam_date,
          b.booking_code, u.full_name, u.phone, upper(trim(pm.code)) AS method_code
         FROM payments p
         JOIN bookings b ON b.id = p.booking_id
         JOIN customer_profiles cp ON cp.id = p.customer_id
         JOIN users u ON u.id = cp.user_id
         JOIN payment_methods pm ON pm.id = p.payment_method_id
         ORDER BY p.created_at DESC, p.id DESC`
      )).rows
      assert.ok(expected.length > 0, 'Needs existing local payment fixtures')
      assert.ok(expected.length <= 100, 'Local fixture check uses at most 100 rows')
      const all = await list({ limit: '100' })
      const rawCount = (await pool.query('SELECT count(*)::int AS total FROM payments')).rows[0].total
      assert.equal(all.pagination.total, rawCount)
      assert.deepEqual(all.items.map((row) => row.id), expected.map((row) => row.id))
      for (let index = 0; index < all.items.length; index += 1) {
        const row = all.items[index]
        const fixture = expected[index]
        assert.equal(row.paymentCode, fixture.payment_code)
        assert.equal(row.bookingCode, fixture.booking_code)
        assert.equal(row.customerName, fixture.full_name)
        assert.equal(row.customerPhone, fixture.phone)
        assert.equal(row.amount, fixture.amount)
        assert.equal(typeof row.amount, 'string')
        assert.equal(row.methodCode, fixture.method_code)
        assert.equal(row.status, fixture.payment_status)
        assert.equal(row.createdAt.getTime(), fixture.created_at.getTime())
      }
      const pages = []
      for (let page = 1; page <= rawCount; page += 1) {
        const result = await list({ page: String(page), limit: '1' })
        assert.equal(result.pagination.totalPages, rawCount)
        pages.push(result.items[0].id)
      }
      assert.deepEqual(pages, expected.map((row) => row.id))
      const outside = await list({ page: String(rawCount + 1), limit: '1' })
      assert.deepEqual(outside.items, [])
      assert.equal(outside.pagination.total, rawCount)

      const fixture = expected[0]
      for (const search of [fixture.id, fixture.payment_code, fixture.booking_code, fixture.full_name, fixture.phone]) {
        if (!search) continue
        const result = await list({ search, limit: '100' })
        assert.ok(result.items.some((row) => row.id === fixture.id))
      }
      for (const search of ['%', '_', '\\', "' OR 1=1 --"]) {
        const result = await list({ search, limit: '100' })
        const matches = expected.filter((row) =>
          [row.id, row.payment_code, row.booking_code, row.full_name, row.phone]
            .some((value) => value?.toLowerCase().includes(search.toLowerCase()))
        )
        assert.deepEqual(result.items.map((row) => row.id), matches.map((row) => row.id))
      }
      const combined = await list({
        status: fixture.payment_status,
        method: fixture.method_code,
        from: fixture.vietnam_date,
        to: fixture.vietnam_date,
        limit: '100',
      })
      const combinedExpected = expected.filter((row) =>
        row.payment_status === fixture.payment_status &&
        row.method_code === fixture.method_code &&
        row.vietnam_date === fixture.vietnam_date
      )
      assert.deepEqual(combined.items.map((row) => row.id), combinedExpected.map((row) => row.id))
      const empty = await list({ search: 'No payment with this phrase exists 123456789' })
      assert.deepEqual(empty, {
        items: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      })
      for (const fixture of expected) {
        const detail = await repository.getPayment(fixture.id)
        const source = (await pool.query(
          `SELECT p.booking_id, p.customer_id, p.technician_id, p.payment_kind,
            p.commission_rate, p.commission_base_amount, p.commission_amount,
            p.platform_discount_amount, p.technician_earning, p.paid_at, p.settled_at,
            b.total_amount, b.subtotal, b.discount_amount,
            (SELECT SUM(q.parts_amount) FROM quotations q
              WHERE q.booking_id=b.id AND q.status='ACCEPTED') AS parts_amount,
            (SELECT count(*)::int FROM bookings completed
              WHERE completed.customer_id=p.customer_id AND completed.status='COMPLETED') AS completed_bookings
           FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.id=$1`,
          [fixture.id]
        )).rows[0]
        assert.equal(detail.id, fixture.id)
        assert.equal(detail.paymentCode, fixture.payment_code)
        assert.equal(detail.amount, fixture.amount)
        assert.equal(detail.status, fixture.payment_status)
        assert.equal(detail.kind, source.payment_kind)
        assert.equal(detail.methodCode, fixture.method_code)
        assert.equal(detail.commissionRate, source.commission_rate)
        assert.equal(detail.commissionBaseAmount, source.commission_base_amount)
        assert.equal(detail.commissionAmount, source.commission_amount)
        assert.equal(detail.platformDiscountAmount, source.platform_discount_amount)
        assert.equal(detail.technicianEarning, source.technician_earning)
        assert.equal(detail.paidAt?.getTime(), source.paid_at?.getTime())
        assert.equal(detail.settledAt?.getTime(), source.settled_at?.getTime())
        assert.equal(detail.booking.id, source.booking_id)
        assert.equal(detail.booking.bookingCode, fixture.booking_code)
        assert.equal(detail.booking.totals.totalAmount, source.total_amount)
        assert.equal(detail.booking.totals.subtotal, source.subtotal)
        assert.equal(detail.booking.totals.discountAmount, source.discount_amount)
        assert.equal(detail.booking.totals.partsAmount, source.parts_amount)
        assert.equal(detail.customer.id, source.customer_id)
        assert.equal(detail.customer.name, fixture.full_name)
        assert.equal(detail.customer.phone, fixture.phone)
        assert.equal(detail.customer.completedBookingCount, source.completed_bookings)
        assert.ok(detail.readAt instanceof Date)
        const itemSource = (await pool.query(
          `SELECT qi.id, qi.description, qi.unit_price, qi.total_price, qi.quantity
           FROM quotation_items qi JOIN quotations q ON q.id=qi.quotation_id
           WHERE q.booking_id=$1 AND q.status='ACCEPTED'
           ORDER BY q.quotation_number,qi.id`,
          [source.booking_id]
        )).rows
        assert.deepEqual(detail.booking.items.map((item) => ({
          id: item.id, description: item.description,
          unit_price: item.unitPrice, total_price: item.totalPrice, quantity: item.quantity,
        })), itemSource)
        if (source.technician_id === null) {
          assert.equal(detail.technician, null)
          assert.deepEqual(detail.ledger, [])
        } else {
          assert.equal(detail.technician.id, source.technician_id)
          const ledgerSource = (await pool.query(
            `SELECT st.id,st.transaction_type AS "transactionType",st.amount,st.created_at AS "createdAt"
             FROM settlement_transactions st JOIN technician_accounts a ON a.id=st.technician_account_id
             WHERE st.payment_id=$1 AND a.technician_id=$2 ORDER BY st.created_at,st.id`,
            [fixture.id, source.technician_id]
          )).rows
          assert.deepEqual(detail.ledger, ledgerSource)
          for (const ledger of detail.ledger) {
            assert.deepEqual(Object.keys(ledger).sort(), ['amount', 'createdAt', 'id', 'transactionType'])
          }
        }
        if (detail.invoice) {
          assert.equal(detail.status, 'SUCCESS')
          assert.equal(detail.invoice.totalAmount, detail.amount)
        }
        assert.equal('idempotency_key' in detail, false)
      }
      assert.equal(await repository.getPayment('00000000-0000-0000-0000-000000000000'), null)
      assert.deepEqual(await snapshot(), before)
    } finally {
      await pool.end()
    }
  }
)
