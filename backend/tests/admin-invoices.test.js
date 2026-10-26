import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { pool } from '../src/config/database.js'
import { adaptDatabaseQuery } from '../src/config/database-codebook-adapter.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { AppError } from '../src/utils.js'
import { validateInvoiceId, validateInvoiceListQuery } from '../src/modules/invoices/invoices.validation.js'
import {
  buildInvoiceListQueries, INVOICE_PAID_SQL, INVOICE_SERVICE_OPTIONS_SQL,
  INVOICE_DETAIL_SQL, InvoicesRepository, presentInvoiceDetail, presentInvoiceRow, safeInvoicePdfUrl,
} from '../src/modules/invoices/invoices.repository.js'
import { InvoicesService } from '../src/modules/invoices/invoices.service.js'
import { createInvoicesRouter } from '../src/modules/invoices/invoices.routes.js'

const actorId = '10000000-0000-0000-0000-000000000001'
const serviceId = '20000000-0000-0000-0000-000000000001'
const unusedServiceId = '20000000-0000-0000-0000-000000000002'
const knownService = { id: serviceId, name: 'Synthetic service' }
const unusedService = { id: unusedServiceId, name: 'Unused synthetic service' }
const source = {
  id: actorId, invoiceNumber: 'SYNTHETIC-INVOICE', bookingId: actorId, bookingCode: 'SYNTHETIC-BOOKING',
  customerId: actorId, customerName: 'Synthetic Customer', customerPhone: '0900000000',
  services: [knownService], hasUnlinkedService: false, hasUnlinkedLabor: true,
  amount: '999999999999.99', issuedAt: new Date('2026-10-01T17:00:00Z'),
  paymentStatus: 'PAID', pdfUrl: 'https://example.com/invoice.pdf',
  provider_token: 'PRIVATE-PROVIDER-TOKEN', email: 'private@example.com',
}
const result = {
  items: [presentInvoiceRow(source)],
  pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
  options: { services: [knownService] },
}
const detailSource = {
  ...source,
  bookingAddress: 'Synthetic street, Ward, City', recipientName: 'Synthetic Recipient', recipientPhone: '0911111111',
  scheduledStart: new Date('2026-10-01T02:00:00Z'), scheduledEnd: null,
  completedAt: new Date('2026-10-01T03:30:00Z'),
  technicianId: serviceId, technicianName: 'Synthetic Technician', technicianPhone: '0922222222',
  subtotal: '999999999999.99', partsAmount: '12345.67', discountAmount: '0.00', totalAmount: '999999999999.99',
  items: [{ id: actorId, itemType: 'SERVICE', description: 'Stored invoice snapshot', quantity: '1.234', unit: 'unit',
    unitPrice: '123456789.12', totalPrice: '152345677.77', discountAmount: '12.34', service: knownService, secret: 'PRIVATE' }],
  payments: [{ id: actorId, code: 'SYNTHETIC-PAYMENT', method: 'FREE', amount: '0.00', paidAt: null, provider_token: 'PRIVATE' }],
}
const detail = presentInvoiceDetail(detailSource)

test('invoice detail accepts scalar UUID only and normalizes its case', () => {
  assert.equal(validateInvoiceId('A0000000-0000-0000-0000-000000000001'), 'a0000000-0000-0000-0000-000000000001')
  for (const id of [null, undefined, '', 'bad', actorId + "' OR true --", [actorId], {}])
    assert.throws(() => validateInvoiceId(id), { status: 422 })
})

test('invoice detail SQL binds identity, preserves snapshots and returns only exact successful payment matches', () => {
  assert.match(INVOICE_DETAIL_SQL, /WHERE i\.id=\$1::uuid$/)
  assert.equal(INVOICE_DETAIL_SQL.includes(actorId), false)
  assert.equal(INVOICE_DETAIL_SQL.includes(INVOICE_PAID_SQL), true)
  assert.match(INVOICE_DETAIL_SQL, /p\.booking_id=i\.booking_id AND p\.customer_id=i\.customer_id/g)
  assert.match(INVOICE_DETAIL_SQL, /p\.amount=i\.total_amount AND p\.payment_status='SUCCESS'/)
  assert.match(INVOICE_DETAIL_SQL, /ORDER BY p\.paid_at DESC NULLS LAST,p\.id DESC/)
  for (const column of ['quantity', 'unit_price', 'total_price', 'discount_amount'])
    assert.ok(INVOICE_DETAIL_SQL.includes(`ii.${column}::text`))
  assert.match(INVOICE_DETAIL_SQL, /p\.amount::text/)
  assert.match(INVOICE_DETAIL_SQL, /bu\.booking_id=i\.booking_id/)
  assert.match(INVOICE_DETAIL_SQL, /q\.booking_id=i\.booking_id/)
  assert.match(INVOICE_DETAIL_SQL, /tp\.user_id=b\.technician_completed_by_id/)
  assert.match(INVOICE_DETAIL_SQL, /b\.completed_at AS "completedAt"/)
  assert.doesNotMatch(INVOICE_DETAIL_SQL, /booking_technicians|s\.price|qi\.unit_price|settled_at|SUM\(|provider_token|email/)
  const adapted = adaptDatabaseQuery(INVOICE_DETAIL_SQL, [actorId])
  assert.match(adapted.query, /p\.payment_status=2/)
  assert.match(adapted.query, /ii\.item_type=0 THEN 'SERVICE'/)
  assert.match(adapted.query, /ii\.item_type=1 THEN 'LABOR'/)
  assert.deepEqual(adapted.params, [actorId])
})

test('invoice detail allowlist preserves exact saved totals without subtracting line discounts or adding parts again', () => {
  assert.deepEqual(detail.totals, {
    subtotal: '999999999999.99', partsAmount: '12345.67', discountAmount: '0.00', totalAmount: '999999999999.99',
  })
  assert.equal(detail.items[0].quantity, '1.234')
  assert.equal(detail.items[0].totalPrice, '152345677.77')
  assert.equal(detail.items[0].discountAmount, '12.34')
  assert.equal(detail.booking.scheduledEnd, null)
  assert.equal(detail.booking.completedAt, detailSource.completedAt)
  assert.deepEqual(detail.technician, { id: serviceId, name: 'Synthetic Technician', phone: '0922222222' })
  for (const secret of ['PRIVATE', 'provider_token', 'email', 'hasUnlinkedService', 'services'])
    assert.equal(JSON.stringify(detail).includes(secret), false)
  const empty = presentInvoiceDetail({ ...detailSource, technicianId: null, items: [], payments: [], pdfUrl: 'javascript:alert(1)' })
  assert.equal(empty.technician, null)
  assert.equal(empty.pdfUrl, null)
  assert.deepEqual(empty.items, [])
  assert.deepEqual(empty.payments, [])
})

test('invoice detail repository reads one consistent read-only snapshot and returns null when absent', async () => {
  const calls = []
  const repository = new InvoicesRepository({ transaction: async (work) => work({
    query: async (sql, values) => {
      calls.push({ sql, values })
      return { rows: sql === INVOICE_DETAIL_SQL && values[0] === actorId ? [detailSource] : [] }
    },
  }) })
  assert.deepEqual(await repository.getInvoice(actorId), detail)
  assert.deepEqual(calls, [
    { sql: 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', values: undefined },
    { sql: INVOICE_DETAIL_SQL, values: [actorId] },
  ])
  assert.equal(await repository.getInvoice(serviceId), null)
})

test('invoice detail audits successful reads with minimal metadata and omits audit on invalid, absent or failed reads', async () => {
  const events = []
  const ids = []
  const service = new InvoicesService({ getInvoice: async (id) => { ids.push(id); return id === actorId ? detail : null } },
    { audit: (event) => events.push(event) })
  assert.equal(await service.getInvoice(actorId, actorId), detail)
  assert.deepEqual(events, [{ actorId, action: 'READ_DETAIL', entityType: 'INVOICE', entityId: actorId,
    before: null, after: { paymentStatus: 'PAID' } }])
  await assert.rejects(service.getInvoice('bad', actorId), { status: 422 })
  assert.equal(ids.length, 1)
  await assert.rejects(service.getInvoice(serviceId, actorId), { status: 404, code: 'INVOICE_NOT_FOUND' })
  const failed = new InvoicesService({ getInvoice: async () => { throw new Error('Database unavailable') } },
    { audit: (event) => events.push(event) })
  await assert.rejects(failed.getInvoice(actorId, actorId), { message: 'Database unavailable' })
  assert.equal(events.length, 1)
})

test('invoice queries enforce exact statuses, bounded pagination, scalar values and real calendar dates', () => {
  assert.deepEqual(validateInvoiceListQuery({}), {
    search: '', status: 'ALL', service: 'ALL', from: undefined, to: undefined, page: 1, limit: 10,
  })
  for (const status of ['ALL', 'PAID', 'UNRECORDED'])
    assert.equal(validateInvoiceListQuery({ status }).status, status)
  for (const limit of ['10', '25', '50'])
    assert.equal(validateInvoiceListQuery({ limit }).limit, Number(limit))
  assert.equal(validateInvoiceListQuery({ service: serviceId.toUpperCase() }).service, serviceId)
  assert.equal(validateInvoiceListQuery({ search: '  %_\\  ', page: '1000000' }).search, '%_\\')
  assert.equal(validateInvoiceListQuery({ from: '0001-01-01', to: '9999-12-31' }).from, '0001-01-01')
  assert.equal(validateInvoiceListQuery({ from: '2000-02-29' }).from, '2000-02-29')
  for (const query of [
    { page: '0' }, { page: '-1' }, { page: '1.5' }, { page: '1000001' }, { page: ['1'] }, { page: 1 },
    { limit: '1' }, { limit: '20' }, { limit: '100' }, { limit: ['10'] },
    { search: ['one', 'two'] }, { search: 'x'.repeat(151) }, { search: 'private\nname' },
    { search: 'x\u0000y' }, { status: 'SUCCESS' }, { status: 'REFUNDED' }, { status: ['PAID'] },
    { service: 'AC_CLEANING' }, { service: [serviceId] }, { service: null },
    { from: '0000-01-01' }, { from: '1900-02-29' }, { from: '2026-02-29' }, { to: '2026-04-31' },
    { from: ['2026-10-01'] }, { to: '2026-1-01' }, { from: '2026-10-02', to: '2026-10-01' },
    { sort: 'amount' }, { customerId: actorId }, { month: '2026-10' },
  ]) assert.throws(() => validateInvoiceListQuery(query), { status: 422 })
})

test('invoice SQL binds literal searches, filters invoice issue dates, preserves full totals and maps revised codebooks', () => {
  const search = "%'_\\ OR 1=1 --"
  const query = buildInvoiceListQueries(validateInvoiceListQuery({
    search, status: 'PAID', service: serviceId, from: '2026-10-01', to: '2026-10-31', page: '2', limit: '25',
  }))
  assert.deepEqual(query.values, ["%\\%'\\_\\\\ OR 1=1 --%", serviceId, '2026-10-01', '2026-10-31'])
  assert.deepEqual(query.rowValues, [...query.values, 25, 25])
  assert.equal(query.rowsSql.includes(search), false)
  assert.match(query.rowsSql, /i\.total_amount AS amount/)
  assert.match(query.rowsSql, /i\.issued_at >= .*AT TIME ZONE INTERVAL '\+07:00'/)
  assert.match(query.rowsSql, /i\.issued_at < .*::date\+1/)
  assert.match(query.rowsSql, /ORDER BY i\.issued_at DESC,i\.id DESC/)
  assert.match(INVOICE_PAID_SQL, /p\.booking_id=i\.booking_id AND p\.customer_id=i\.customer_id/)
  assert.match(INVOICE_PAID_SQL, /p\.amount=i\.total_amount AND p\.payment_status='SUCCESS'/)
  assert.doesNotMatch(INVOICE_PAID_SQL, /settled_at|payment_kind|paid_at/)
  assert.match(query.countSql, /EXISTS \(SELECT 1 FROM invoice_items/)
  assert.doesNotMatch(query.countSql, /JOIN payments|GROUP BY|SUM\(/)
  assert.match(INVOICE_SERVICE_OPTIONS_SQL, /bu\.booking_id=i\.booking_id/)
  assert.match(INVOICE_SERVICE_OPTIONS_SQL, /q\.booking_id=i\.booking_id/)
  assert.doesNotMatch(INVOICE_SERVICE_OPTIONS_SQL, /is_active|status|issued_at/)
  const adapted = adaptDatabaseQuery(query.rowsSql, query.rowValues)
  assert.match(adapted.query, /p\.payment_status=2/)
  assert.match(adapted.query, /ii\.item_type=0 AND qi\.item_type=0/)
  assert.match(adapted.query, /ii\.item_type=1 AND s\.id IS NULL/)
  assert.match(adapted.query, /THEN 'PAID' ELSE 'UNRECORDED'/)
  assert.deepEqual(adapted.params, query.rowValues)
})

test('invoice presentation retains exact decimal money and only returns safe public PDF links and allowed fields', () => {
  const row = presentInvoiceRow(source)
  assert.equal(row.amount, '999999999999.99')
  assert.equal(typeof row.amount, 'string')
  assert.equal(row.pdfUrl, 'https://example.com/invoice.pdf')
  assert.equal('provider_token' in row, false)
  assert.equal('email' in row, false)
  for (const value of [null, '', '/invoice.pdf', '//example.com/x', 'javascript:alert(1)', 'data:text/html,x',
    'file:///etc/passwd', 'https://user:password@example.com/x', 'https://example.com/a\nb', 'https://example.com/a b'])
    assert.equal(safeInvoicePdfUrl(value), null)
  assert.equal(safeInvoicePdfUrl('http://localhost:3000/invoice.pdf'), 'http://localhost:3000/invoice.pdf')
})

test('invoice repository uses one read-only snapshot, global billed services and validates known unused selections', async () => {
  const calls = []
  const repository = new InvoicesRepository({ transaction: async (work) => work({
    query: async (sql, values) => {
      calls.push({ sql, values })
      if (sql === INVOICE_SERVICE_OPTIONS_SQL) return { rows: [knownService] }
      if (sql.startsWith('SELECT id,name')) return { rows: values[0] === unusedServiceId ? [unusedService] : [] }
      if (sql.startsWith('SELECT count(*)')) return { rows: [{ total: 0 }] }
      return { rows: [] }
    },
  }) })
  const empty = await repository.listInvoices(validateInvoiceListQuery({ service: unusedServiceId, search: 'absent' }))
  assert.equal(calls[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.deepEqual(empty.items, [])
  assert.deepEqual(empty.options.services, [knownService, unusedService])
  assert.deepEqual(empty.pagination, { page: 1, limit: 10, total: 0, totalPages: 0 })
  assert.deepEqual(calls[2].values, [unusedServiceId])
  const before = calls.length
  await assert.rejects(repository.listInvoices(validateInvoiceListQuery({ service: actorId })), { status: 422 })
  assert.equal(calls.length - before, 3)
})

test('invoice successful read audit contains metadata without raw searches, customer, amounts or service identity', async () => {
  const events = []
  const service = new InvoicesService({ listInvoices: async () => result }, { audit: (event) => events.push(event) })
  assert.equal(await service.listInvoices({ search: 'Private Name 0901234567', service: serviceId }, actorId), result)
  assert.equal(events.length, 1)
  assert.equal(events[0].after.hasSearch, true)
  assert.equal(events[0].after.hasServiceFilter, true)
  assert.equal(events[0].entityType, 'INVOICE')
  for (const privateValue of ['Private Name', '0901234567', serviceId, source.customerName, source.amount, source.invoiceNumber])
    assert.equal(JSON.stringify(events).includes(privateValue), false)
  await assert.rejects(service.listInvoices({ status: 'REFUNDED' }, actorId), { status: 422 })
  const failing = new InvoicesService({ listInvoices: async () => { throw new Error('Database unavailable') } }, { audit: (event) => events.push(event) })
  await assert.rejects(failing.listInvoices({}, actorId), { message: 'Database unavailable' })
  assert.equal(events.length, 1)
})

test('invoice list/detail GET are Admin-only, no-store on success and errors, and expose no mutation endpoint', async () => {
  let reads = 0
  let detailReads = 0
  let fail = false
  const app = express()
  app.use('/api/admin/invoices', createInvoicesRouter({ getInvoice: async (id) => {
    detailReads += 1
    if (fail) throw new AppError(503, 'TEMPORARY_UNAVAILABLE', 'Temporary unavailable')
    return id === actorId ? detail : null
  }, listInvoices: async () => {
    reads += 1
    if (fail) throw new AppError(503, 'TEMPORARY_UNAVAILABLE', 'Temporary unavailable')
    return result
  } }, { audit: () => {} }))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const base = `http://127.0.0.1:${server.address().port}/api/admin/invoices`
  const sign = (role, expiresIn = '5m') => jwt.sign({ sub: actorId, role, purpose: 'access' }, env.jwtSecret, { expiresIn })
  const request = (path = '', auth, method = 'GET') => fetch(`${base}${path}`, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {} })
  const rawQuery = pool.query
  try {
    for (const auth of [undefined, 'bad-token', sign('ADMIN', '-1s')]) {
      const response = await request('', auth)
      assert.equal(response.status, 401)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const blockedDetail = await request(`/${actorId}`, auth)
      assert.equal(blockedDetail.status, 401)
      assert.equal(blockedDetail.headers.get('cache-control'), 'no-store')
    }
    pool.query = async () => ({ rows: [{ status: 'ACTIVE' }] })
    for (const role of ['CUSTOMER', 'TECHNICIAN']) {
      const response = await request('', sign(role))
      assert.equal(response.status, 403)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const blockedDetail = await request(`/${actorId}`, sign(role))
      assert.equal(blockedDetail.status, 403)
      assert.equal(blockedDetail.headers.get('cache-control'), 'no-store')
    }
    pool.query = rawQuery
    const admin = sign('ADMIN')
    for (const path of ['?status=REFUNDED', '?service=bad', '?service=ALL&service=ALL', '?limit=10&limit=25', '?search=a&search=b', '?from=2026-02-29', '?sort=amount']) {
      const response = await request(path, admin)
      assert.equal(response.status, 422)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    assert.equal(reads, 0)
    const response = await request(`?status=PAID&service=${serviceId}&from=2026-10-01&to=2026-10-31`, admin)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), JSON.parse(JSON.stringify({ success: true, data: result })))
    assert.equal(reads, 1)
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const blocked = await request('', admin, method)
      assert.equal(blocked.status, 404)
      assert.equal(blocked.headers.get('cache-control'), 'no-store')
    }
    for (const path of ['/bad', '/%27%20OR%20true']) {
      const invalid = await request(path, admin)
      assert.equal(invalid.status, 422)
      assert.equal(invalid.headers.get('cache-control'), 'no-store')
    }
    assert.equal(detailReads, 0)
    const found = await request(`/${actorId}`, admin)
    assert.equal(found.status, 200)
    assert.equal(found.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await found.json(), JSON.parse(JSON.stringify({ success: true, data: detail })))
    const missing = await request(`/${serviceId}`, admin)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'INVOICE_NOT_FOUND')
    assert.equal(missing.headers.get('cache-control'), 'no-store')
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const blocked = await request(`/${actorId}`, admin, method)
      assert.equal(blocked.status, 404)
      assert.equal(blocked.headers.get('cache-control'), 'no-store')
    }
    assert.equal(detailReads, 2)
    fail = true
    const error = await request('', admin)
    assert.equal(error.status, 503)
    assert.equal(error.headers.get('cache-control'), 'no-store')
    assert.equal(reads, 2)
    const detailError = await request(`/${actorId}`, admin)
    assert.equal(detailError.status, 503)
    assert.equal(detailError.headers.get('cache-control'), 'no-store')
  } finally {
    pool.query = rawQuery
    await new Promise((resolve) => server.close(resolve))
  }
})

test.after(async () => { await pool.end() })
