import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import ExcelJS from 'exceljs'
import { env } from '../src/config/env.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { createPaymentsRouter } from '../src/modules/payments/payments.routes.js'
import { validateRevenueExportQuery } from '../src/modules/payments/payments.export.validation.js'
import { PaymentsExportRepository } from '../src/modules/payments/payments.export.repository.js'
import { PaymentsExportService } from '../src/modules/payments/payments.export.service.js'
import { buildRevenueWorkbook, excelMoney, vietnamExcelDate } from '../src/modules/payments/payments.export.workbook.js'
import { REVENUE_METRICS } from '../src/modules/payments/payments.export.constants.js'

const adminId = '12345678-1234-1234-1234-123456789012'
const dates = { from: '2026-10-01', to: '2026-10-31' }
const filters = { ...dates, method: 'ALL', search: '' }
function report(rows = []) {
  const metrics = Object.fromEntries(REVENUE_METRICS.map(({ key }) => [key, {
    total: '0.00', knownSum: '0.00', knownCount: rows.length, missingCount: 0,
  }]))
  return { rows, rowCount: rows.length, generatedAt: new Date('2026-10-12T00:00:00Z'), metrics }
}
async function readBook(buffer) {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(buffer)
  return book
}

test('revenue export requires real Excel-calendar dates and rejects repeated/unknown/list parameters', () => {
  assert.deepEqual(validateRevenueExportQuery(dates), filters)
  assert.equal(validateRevenueExportQuery({ from: '1900-01-01', to: '9999-12-31', method: 'FREE' }).method, 'FREE')
  assert.equal(validateRevenueExportQuery({ from: '2000-02-29', to: '2000-02-29' }).from, '2000-02-29')
  for (const query of [
    {}, { from: dates.from }, { to: dates.to },
    { ...dates, from: '1899-12-31' }, { ...dates, from: '1900-02-29' },
    { ...dates, from: '2026-02-29' }, { ...dates, to: '2026-04-31' },
    { ...dates, to: '10000-01-01' }, { ...dates, from: '2026-10-31', to: '2026-10-01' },
    { ...dates, from: ['2026-10-01'] }, { ...dates, to: ['2026-10-31'] },
    { ...dates, method: ['CASH'] }, { ...dates, method: 'CARD' },
    { ...dates, search: ['a', 'b'] }, { ...dates, search: 'x'.repeat(151) },
    { ...dates, status: 'SUCCESS' }, { ...dates, page: '1' }, { ...dates, limit: '100' },
    { ...dates, unknown: 'value' }, JSON.parse('{"from":"2026-10-01","to":"2026-10-31","__proto__":"x"}'),
  ]) assert.throws(() => validateRevenueExportQuery(query), { status: 422 })
})

test('export repository rejects oversized reports before rows and binds paid-date/literal search filters read-only', async () => {
  const queries = []
  const repository = new PaymentsExportRepository({ transaction: async (work) => work({
    async query(sql, values) {
      queries.push({ sql, values })
      if (sql.startsWith('SELECT count(*)')) return { rows: [{ rowCount: 10001 }] }
      return { rows: [] }
    },
  }) })
  await assert.rejects(repository.readRevenueReport({ ...filters, method: 'CASH', search: 'a%_\\' }), {
    status: 422, code: 'REPORT_TOO_LARGE',
  })
  assert.equal(queries.length, 2)
  assert.equal(queries[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.match(queries[1].sql, /p.payment_status = 'SUCCESS'/)
  assert.match(queries[1].sql, /p.paid_at IS NOT NULL/)
  assert.match(queries[1].sql, /AT TIME ZONE INTERVAL '\+07:00'/)
  assert.equal(queries[1].sql.includes('p.created_at >='), false)
  assert.deepEqual(queries[1].values, [dates.from, dates.to, 'CASH', '%a\\%\\_\\\\%'])
  assert.match(queries[1].sql, /LEFT JOIN technician_profiles tp ON tp.id=p.technician_id/)
  assert.equal(queries[1].sql.includes('booking_technicians'), false)
})

test('XLSX is readable, preserves literals/phones/nulls/exact large totals and uses UTC+7 wall-clock dates', async () => {
  const sample = {
    id: adminId, paymentCode: '=HYPERLINK("https://example.com","click")', bookingCode: 'BK001',
    customerName: '=1+1', customerPhone: '0901234567', technicianName: null,
    methodCode: 'FREE', methodName: 'Free', status: 'SUCCESS', kind: 'FREE',
    amount: '0.00', commissionAmount: null, platformDiscountAmount: '150000.00', technicianEarning: '120000.00',
    createdAt: new Date('2026-10-01T16:59:59Z'), paidAt: new Date('2026-10-01T17:00:00Z'), settledAt: null,
  }
  const data = report([sample])
  data.metrics.commission = { total: null, knownSum: '0.00', knownCount: 0, missingCount: 1 }
  data.metrics.technicianEarning = { total: '99999999999999.99', knownSum: '99999999999999.99', knownCount: 1, missingCount: 0 }
  const book = await readBook(await buildRevenueWorkbook(data, { ...filters, search: '=CMD()' }))
  assert.deepEqual(book.worksheets.map((sheet) => sheet.name), ['Revenue Summary', 'Paid Payments'])
  const summary = book.getWorksheet('Revenue Summary')
  const paid = book.getWorksheet('Paid Payments')
  assert.equal(summary.getCell('B11').value, 1)
  assert.equal(summary.getCell('B16').value, null)
  assert.equal(summary.getCell('C16').value, 0)
  assert.equal(summary.getCell('D16').value, 1)
  assert.equal(summary.getCell('E16').value, 0)
  assert.equal(summary.getCell('F16').value, 'INCOMPLETE')
  assert.equal(summary.getCell('B18').value, '99999999999999.99')
  assert.equal(summary.getCell('B18').type, ExcelJS.ValueType.String)
  assert.equal(summary.getCell('B9').value, '=CMD()')
  assert.equal(paid.getCell('B2').value, sample.paymentCode)
  assert.equal(paid.getCell('D2').value, '=1+1')
  assert.equal(paid.getCell('D2').type, ExcelJS.ValueType.String)
  assert.equal(paid.getCell('D2').formula, undefined)
  assert.equal(paid.getCell('B2').hyperlink, undefined)
  assert.equal(paid.getCell('E2').value, '0901234567')
  assert.equal(paid.getCell('F2').value, null)
  assert.equal(paid.getCell('J2').value, 0)
  assert.equal(paid.getCell('K2').value, null)
  assert.equal(paid.getCell('N2').value.toISOString(), '2026-10-01T23:59:59.000Z')
  assert.equal(paid.getCell('O2').value.toISOString(), '2026-10-02T00:00:00.000Z')
  assert.equal(paid.getCell('P2').value, null)
  assert.match(paid.getCell('O1').value, /UTC\+7/)
  assert.equal(excelMoney('999999999999.99'), 999999999999.99)
  assert.equal(excelMoney(null), null)
  assert.throws(() => excelMoney('NaN'))
  assert.equal(vietnamExcelDate('1900-01-01T00:00:00Z'), '1900-01-01 07:00:00.000 UTC+7')
  assert.equal(vietnamExcelDate('1900-02-28T16:59:59Z'), '1900-02-28 23:59:59.000 UTC+7')
  assert.equal(vietnamExcelDate('1900-02-28T17:00:00Z').toISOString(), '1900-03-01T00:00:00.000Z')
  const early = await readBook(await buildRevenueWorkbook(report(), { ...filters, from: '1900-01-01', to: '1900-02-28' }))
  assert.equal(early.getWorksheet('Revenue Summary').getCell('B4').value, '1900-01-01')
  assert.equal(early.getWorksheet('Revenue Summary').getCell('B5').value, '1900-02-28')
})

test('empty reports remain valid two-sheet workbooks with zero counts/totals and headers', async () => {
  const book = await readBook(await buildRevenueWorkbook(report(), filters))
  assert.equal(book.getWorksheet('Revenue Summary').getCell('B11').value, 0)
  for (let row = 15; row <= 18; row += 1) {
    assert.equal(book.getWorksheet('Revenue Summary').getCell(`B${row}`).value, 0)
    assert.equal(book.getWorksheet('Revenue Summary').getCell(`F${row}`).value, 'Complete')
  }
  assert.equal(book.getWorksheet('Paid Payments').rowCount, 1)
})

test('EXPORT audit happens only after successful generation and contains metadata without PII/search/money', async () => {
  const events = []
  let generated = false
  const service = new PaymentsExportService({ async readRevenueReport() { return report() } }, {
    buildWorkbook: async () => { generated = true; return Buffer.from('xlsx') },
    audit: (event) => { assert.equal(generated, true); events.push(event) },
  })
  const result = await service.exportRevenue({ ...dates, search: 'Private Customer 0901234567' }, adminId)
  assert.equal(result.filename, 'coolcare-revenue-2026-10-01-2026-10-31.xlsx')
  assert.deepEqual(events[0].after, { ...dates, method: 'ALL', hasSearch: true, count: 0 })
  assert.equal(JSON.stringify(events).includes('Private Customer'), false)
  assert.equal(JSON.stringify(events).includes('0901234567'), false)
  const failing = new PaymentsExportService({ async readRevenueReport() { return report() } }, {
    buildWorkbook: async () => { throw new Error('Failed generation') }, audit: (event) => events.push(event),
  })
  await assert.rejects(failing.exportRevenue(dates, adminId), { message: 'Failed generation' })
  assert.equal(events.length, 1)
})

test('export route is Admin-only, precedes UUID detail, exposes download headers and rejects forbidden parameters', async () => {
  const calls = []
  const events = []
  const app = express()
  app.use('/api/admin/payments', createPaymentsRouter({ async getPayment() { throw new Error('Export reached UUID route') } }, {
    exportRepository: { async readRevenueReport(value) { calls.push(value); return report() } },
    audit: (event) => events.push(event),
  }))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const base = `http://127.0.0.1:${server.address().port}/api/admin/payments/export`
  const sign = (role) => jwt.sign({ sub: adminId, role, purpose: 'access' }, env.jwtSecret, { expiresIn: '5m' })
  const admin = sign('ADMIN')
  const request = (query = '', token, method = 'GET') => fetch(`${base}${query}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  try {
    assert.equal((await request()).status, 401)
    assert.equal((await request('', 'bad-token')).status, 401)
    assert.equal((await request('', sign('CUSTOMER'))).status, 403)
    assert.equal((await request('', sign('TECHNICIAN'))).status, 403)
    for (const query of ['', '?from=2026-10-01&to=2026-10-31&page=1', '?from=2026-10-01&from=2026-10-02&to=2026-10-31']) {
      assert.equal((await request(query, admin)).status, 422)
    }
    assert.equal(calls.length, 0)
    assert.equal(events.length, 0)
    const response = await request('?from=2026-10-01&to=2026-10-31', admin)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="coolcare-revenue-2026-10-01-2026-10-31.xlsx"')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-report-row-count'), '0')
    assert.equal(response.headers.get('access-control-expose-headers'), 'Content-Disposition, X-Report-Row-Count')
    const book = await readBook(Buffer.from(await response.arrayBuffer()))
    assert.equal(book.worksheets.length, 2)
    assert.equal(events[0].action, 'EXPORT')
    assert.equal(events[0].actorId, adminId)
    assert.deepEqual(calls, [filters])
    for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await request('', admin, method)).status, 404)
    assert.equal(events.length, 1)
  } finally { await new Promise((resolve) => server.close(resolve)) }
})
