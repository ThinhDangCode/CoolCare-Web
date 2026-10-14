import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { pool } from '../src/config/database.js'
import { PaymentsExportRepository } from '../src/modules/payments/payments.export.repository.js'
import { PaymentsExportService } from '../src/modules/payments/payments.export.service.js'

test('export matches actual successful paid dates, frozen sums and literal filters with unchanged database',
  { skip: process.env.RUN_PAYMENT_EXPORT_DB_TESTS !== '1' }, async () => {
    const repository = new PaymentsExportRepository()
    const snapshot = async () => Promise.all(
      ['payments', 'bookings', 'users', 'customer_profiles', 'technician_profiles', 'payment_methods', 'technician_accounts', 'settlement_transactions', 'quotations', 'invoices'].map(async (table) => (
        await pool.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) AS checksum FROM ${table} t`)
      ).rows[0].checksum)
    )
    try {
      const before = await snapshot()
      const fixtureRows = (await pool.query(
        `SELECT p.id,p.payment_code,p.paid_at,p.amount,p.commission_amount,p.platform_discount_amount,p.technician_earning,
          upper(trim(pm.code)) AS method, b.booking_code,u.full_name,u.phone
         FROM payments p JOIN payment_methods pm ON pm.id=p.payment_method_id
         JOIN bookings b ON b.id=p.booking_id JOIN customer_profiles cp ON cp.id=p.customer_id
         JOIN users u ON u.id=cp.user_id WHERE p.payment_status='SUCCESS' AND p.paid_at IS NOT NULL
         ORDER BY p.paid_at DESC,p.id DESC`
      )).rows
      assert.ok(fixtureRows.length > 0, 'Needs successful local paid fixtures')
      const allFilters = { from: '1900-01-01', to: '9999-12-31', method: 'ALL', search: '' }
      const all = await repository.readRevenueReport(allFilters)
      assert.deepEqual(all.rows.map((row) => row.id), fixtureRows.map((row) => row.id))
      const sums = (await pool.query(
        `SELECT SUM(amount)::text AS gross, SUM(commission_amount)::text AS commission,
          SUM(platform_discount_amount)::text AS discount,SUM(technician_earning)::text AS earning
         FROM payments WHERE payment_status='SUCCESS' AND paid_at IS NOT NULL`
      )).rows[0]
      assert.equal(all.metrics.paymentAmount.total, sums.gross)
      assert.equal(all.metrics.commission.total, sums.commission)
      assert.equal(all.metrics.platformDiscount.total, sums.discount)
      assert.equal(all.metrics.technicianEarning.total, sums.earning)
      const first = fixtureRows[0]
      const day = new Date(first.paid_at.getTime() + 7*60*60*1000).toISOString().slice(0,10)
      const filtered = await repository.readRevenueReport({ ...allFilters, from: day, to: day, method: first.method, search: first.payment_code })
      assert.ok(filtered.rows.some((row) => row.id === first.id))
      assert.ok(filtered.rows.every((row) => row.methodCode === first.method && new Date(row.paidAt.getTime()+7*60*60*1000).toISOString().slice(0,10) === day))
      for (const search of ['%', '_', '\\', "' OR 1=1 --"]) {
        const value = await repository.readRevenueReport({ ...allFilters, search })
        const expected = fixtureRows.filter((row) => [row.id,row.payment_code,row.booking_code,row.full_name,row.phone].some((field) => field?.toLowerCase().includes(search.toLowerCase())))
        assert.deepEqual(value.rows.map((row) => row.id), expected.map((row) => row.id))
      }
      const historical = (await pool.query("SELECT ('1900-01-01'::date::timestamp AT TIME ZONE INTERVAL '+07:00') AS start, (('1900-01-01'::date+1)::timestamp AT TIME ZONE INTERVAL '+07:00') AS finish")).rows[0]
      assert.equal(historical.start.toISOString(), '1899-12-31T17:00:00.000Z')
      assert.equal(historical.finish.toISOString(), '1900-01-01T17:00:00.000Z')
      const output = await new PaymentsExportService(repository, {audit:()=>{}}).exportRevenue(allFilters, 'readonly-test')
      const book = new ExcelJS.Workbook(); await book.xlsx.load(output.buffer)
      assert.equal(book.getWorksheet('Revenue Summary').getCell('B4').value, '1900-01-01')
      assert.equal(book.getWorksheet('Revenue Summary').getCell('B11').value, fixtureRows.length)
      assert.equal(book.getWorksheet('Paid Payments').getCell('A2').value, first.id)
      assert.equal(book.getWorksheet('Paid Payments').getCell('O2').value.toISOString(), new Date(first.paid_at.getTime()+7*60*60*1000).toISOString())
      const empty = await repository.readRevenueReport({ ...allFilters, from: '1900-01-01', to: '1900-01-01' })
      assert.equal(empty.rowCount, 0)
      assert.equal(empty.metrics.paymentAmount.total, '0')
      assert.deepEqual(await snapshot(), before)
    } finally { await pool.end() }
  }
)
