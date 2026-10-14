import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { createPaymentsRouter } from '../src/modules/payments/payments.routes.js'
import { PaymentsService } from '../src/modules/payments/payments.service.js'
import { PaymentsRepository } from '../src/modules/payments/payments.repository.js'
import { validatePaymentId, validatePaymentListQuery } from '../src/modules/payments/payments.validation.js'

const adminId = '12345678-1234-1234-1234-123456789012'

test('payment filters validate calendar years, exact enum values and bounded single pagination values', () => {
  assert.deepEqual(validatePaymentListQuery({}), {
    page: 1,
    limit: 10,
    search: '',
    status: 'ALL',
    method: 'ALL',
    from: undefined,
    to: undefined,
  })
  const filters = validatePaymentListQuery({
    search: '  Customer_100%  ',
    page: '1000000',
    limit: '100',
    status: 'CANCELLED',
    method: 'FREE',
    from: '2000-02-29',
    to: '2000-02-29',
  })
  assert.equal(filters.search, 'Customer_100%')
  assert.equal(filters.page, 1_000_000)
  assert.equal(filters.limit, 100)
  assert.equal(filters.method, 'FREE')
  assert.equal(validatePaymentListQuery({ from: '0001-01-01', to: '9999-12-31' }).from, '0001-01-01')
  for (const query of [
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '1000001' },
    { page: '' },
    { page: 1 },
    { page: ['1', '2'] },
    { limit: '101' },
    { limit: ['10'] },
    { search: 'x'.repeat(151) },
    { search: ['one', 'two'] },
    { status: 'PAID' },
    { status: 'success' },
    { status: ['SUCCESS'] },
    { method: 'CARD' },
    { method: ['CASH'] },
    { from: '0000-01-01' },
    { from: '1900-02-29' },
    { from: '2026-02-29' },
    { from: '2026-04-31' },
    { from: '2026-1-01' },
    { from: '10000-01-01' },
    { from: ['2026-10-01'] },
    { from: '2026-10-12', to: '2026-10-11' },
  ]) {
    assert.throws(() => validatePaymentListQuery(query), { status: 422 })
  }
})

test('payment reads audit successful access without raw search or financial/customer data', async () => {
  const events = []
  const result = { items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } }
  const service = new PaymentsService(
    { async listPayments() { return result } },
    { audit: (event) => events.push(event) }
  )
  assert.equal(await service.listPayments({ search: 'Sensitive Name 0901234567' }, adminId), result)
  assert.equal(events.length, 1)
  assert.equal(events[0].actorId, adminId)
  assert.equal(events[0].action, 'READ_LIST')
  assert.equal(events[0].entityType, 'PAYMENT')
  assert.equal(events[0].after.hasSearch, true)
  assert.equal(JSON.stringify(events[0]).includes('Sensitive Name'), false)
  assert.equal(JSON.stringify(events[0]).includes('0901234567'), false)
  await assert.rejects(service.listPayments({ limit: '101' }, adminId), { status: 422 })
  const failing = new PaymentsService(
    { async listPayments() { throw new Error('Database unavailable') } },
    { audit: (event) => events.push(event) }
  )
  await assert.rejects(failing.listPayments({}, adminId), { message: 'Database unavailable' })
  assert.equal(events.length, 1)
})

test('payment list routes are Admin-only, return the contract and reject mutations', async () => {
  const calls = []
  const events = []
  const result = {
    items: [{
      id: adminId,
      paymentCode: 'PAY001',
      bookingCode: 'BK001',
      customerName: 'Demo Customer',
      customerPhone: null,
      amount: '0.00',
      methodCode: 'FREE',
      methodName: 'Zero amount',
      status: 'SUCCESS',
      createdAt: '2026-10-12T00:00:00.000Z',
    }],
    pagination: { page: 2, limit: 1, total: 2, totalPages: 2 },
  }
  const repository = {
    async listPayments(filters) {
      calls.push(filters)
      return result
    },
    async getPayment() { return null },
  }
  const app = express()
  app.use('/api/admin/payments', createPaymentsRouter(repository, { audit: (event) => events.push(event) }))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}/api/admin/payments`
  const sign = (role, expiresIn = '5m') =>
    jwt.sign({ sub: adminId, role, purpose: 'access' }, env.jwtSecret, { expiresIn })
  const admin = sign('ADMIN')
  const request = (path = '', token, method = 'GET') => fetch(`${base}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  try {
    assert.equal((await request()).status, 401)
    assert.equal((await request('', 'bad-token')).status, 401)
    assert.equal((await request('', sign('ADMIN', '-1s'))).status, 401)
    assert.equal((await request('', sign('CUSTOMER'))).status, 403)
    assert.equal((await request('', sign('TECHNICIAN'))).status, 403)
    assert.equal((await request('?status=REFUNDED', admin)).status, 422)
    assert.equal((await request('?page=1&page=2', admin)).status, 422)
    assert.equal(calls.length, 0)
    assert.equal(events.length, 0)
    const response = await request('?page=2&limit=1&method=FREE&status=SUCCESS&from=2026-10-01&to=2026-10-12', admin)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { success: true, data: result })
    assert.deepEqual(calls[0], {
      page: 2,
      limit: 1,
      search: '',
      status: 'SUCCESS',
      method: 'FREE',
      from: '2026-10-01',
      to: '2026-10-12',
    })
    assert.equal(events[0].actorId, adminId)
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      assert.equal((await request('', admin, method)).status, 404)
    }
    assert.equal((await request('/00000000-0000-0000-0000-000000000000', admin)).status, 404)
    assert.equal(calls.length, 1)
    assert.equal(events.length, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('payment detail validates UUIDs before querying and never audits failed reads', async () => {
  const calls = []
  const events = []
  const service = new PaymentsService(
    { async getPayment(id) { calls.push(id); return null } },
    { audit: (event) => events.push(event) }
  )
  for (const value of [undefined, null, 1, '', 'PAY001', [adminId], `${adminId}' OR true`]) {
    assert.throws(() => validatePaymentId(value), { status: 422 })
    await assert.rejects(service.getPayment(value, adminId), { status: 422 })
  }
  assert.equal(calls.length, 0)
  assert.equal(validatePaymentId(adminId.toUpperCase()), adminId.toUpperCase())
  await assert.rejects(service.getPayment(adminId, adminId), {
    status: 404,
    code: 'PAYMENT_NOT_FOUND',
  })
  assert.deepEqual(calls, [adminId])
  assert.deepEqual(events, [])
})

test('payment detail sanitizes only stored PDF links and keeps audit metadata minimal', async () => {
  const events = []
  for (const [stored, safe] of [
    [null, null],
    ['', null],
    ['javascript:alert(1)', null],
    ['data:application/pdf;base64,abc', null],
    ['/invoices/123.pdf', null],
    ['https://user:secret@example.com/invoice.pdf', null],
    ['https://example.com/invoice.pdf', 'https://example.com/invoice.pdf'],
    ['http://localhost:3000/invoices/123.pdf', 'http://localhost:3000/invoices/123.pdf'],
  ]) {
    const data = {
      id: adminId,
      status: 'SUCCESS',
      amount: '9999999999.99',
      booking: { id: '22345678-1234-1234-1234-123456789012' },
      customer: { name: 'Private Customer', phone: '0901234567' },
      invoice: { pdfUrl: stored },
    }
    const service = new PaymentsService(
      { async getPayment() { return data } },
      { audit: (event) => events.push(event) }
    )
    const result = await service.getPayment(adminId, adminId)
    assert.equal(result.invoice.pdfUrl, safe)
    assert.equal(result.amount, '9999999999.99')
    assert.deepEqual(events.at(-1), {
      actorId: adminId,
      action: 'READ_DETAIL',
      entityType: 'PAYMENT',
      entityId: adminId,
      before: null,
      after: { bookingId: data.booking.id, status: 'SUCCESS' },
    })
  }
  assert.equal(JSON.stringify(events).includes('Private Customer'), false)
  assert.equal(JSON.stringify(events).includes('0901234567'), false)
  assert.equal(JSON.stringify(events).includes('9999999999.99'), false)
})

test('payment detail preserves an unpaid attempt with no technician and never borrows a later invoice', async () => {
  const queries = []
  const base = {
    id: adminId,
    paymentCode: 'FAILED001',
    status: 'FAILED',
    amount: '100000.00',
    kind: 'ONLINE',
    technicianId: null,
    commissionRate: null,
    commissionBaseAmount: null,
    commissionAmount: null,
    platformDiscountAmount: null,
    technicianEarning: null,
    paidAt: null,
    settledAt: null,
    bookingId: '22345678-1234-1234-1234-123456789012',
    customerId: '32345678-1234-1234-1234-123456789012',
    customerName: 'Existing Customer',
    subtotal: '300000.00',
    discountAmount: '0.00',
    totalAmount: '300000.00',
    partsAmount: null,
    quotationSubtotal: null,
    itemServiceLaborTotal: null,
    pricingMatchesPayment: false,
    quotationTotalsMatchBooking: null,
    itemBreakdownMatchesQuotation: null,
    idempotency_key: 'must-not-be-returned',
  }
  const repository = new PaymentsRepository({
    transaction: async (work) => work({
      async query(sql, values) {
        queries.push({ sql, values })
        if (sql.includes('FROM payments p')) return { rows: [base] }
        return { rows: [] }
      },
    }),
  })
  const result = await repository.getPayment(adminId)
  assert.equal(queries[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.deepEqual(queries[1].values, [adminId])
  assert.match(queries[1].sql, /LEFT JOIN technician_profiles tp ON tp.id = p.technician_id/)
  assert.equal(queries.some(({ sql }) => /booking_technicians|base_price/.test(sql)), false)
  assert.equal(queries.some(({ sql }) => /FROM invoices|FROM technician_areas|FROM settlement_transactions/.test(sql)), false)
  assert.equal(result.technician, null)
  assert.equal(result.invoice, null)
  assert.deepEqual(result.ledger, [])
  assert.deepEqual(result.booking.items, [])
  assert.equal(result.amount, '100000.00')
  assert.equal(result.booking.totals.totalAmount, '300000.00')
  assert.equal(result.booking.pricingMatchesPayment, false)
  assert.equal(result.commissionRate, null)
  assert.equal(result.paidAt, null)
  assert.equal(JSON.stringify(result).includes('must-not-be-returned'), false)
})

test('payment detail binds ledger to its actual technician and invoice to its successful financial snapshot', async () => {
  const technicianId = '42345678-1234-1234-1234-123456789012'
  const bookingId = '22345678-1234-1234-1234-123456789012'
  const customerId = '32345678-1234-1234-1234-123456789012'
  const queries = []
  const repository = new PaymentsRepository({
    transaction: async (work) => work({
      async query(sql, values) {
        queries.push({ sql, values })
        if (sql.includes('FROM payments p')) return { rows: [{
          id: adminId, status: 'SUCCESS', kind: 'CASH', amount: '500000.00',
          technicianId, bookingId, customerId,
        }] }
        if (sql.includes('FROM settlement_transactions')) return { rows: [{
          id: 'ledger-id', transactionType: 'CASH_SETTLEMENT', amount: '-100000.00', createdAt: new Date(),
        }] }
        return { rows: [] }
      },
    }),
  })
  const result = await repository.getPayment(adminId)
  assert.equal(result.technician.id, technicianId)
  assert.equal(result.ledger[0].transactionType, 'CASH_SETTLEMENT')
  assert.equal(result.ledger[0].amount, '-100000.00')
  const ledgerQuery = queries.find(({ sql }) => sql.includes('FROM settlement_transactions'))
  assert.match(ledgerQuery.sql, /a.technician_id = \$2/)
  assert.deepEqual(ledgerQuery.values, [adminId, technicianId])
  const invoiceQuery = queries.find(({ sql }) => sql.includes('FROM invoices'))
  assert.match(invoiceQuery.sql, /customer_id = \$2 AND total_amount = \$3/)
  assert.deepEqual(invoiceQuery.values, [bookingId, customerId, '500000.00'])
  assert.equal(result.invoice, null)
})

test('payment detail routes enforce Admin access, no-store, unknown IDs and successful read audit', async () => {
  const calls = []
  const events = []
  const missingId = '00000000-0000-0000-0000-000000000000'
  const detail = {
    id: adminId, paymentCode: 'PAY001', status: 'PENDING', amount: '0.00',
    booking: { id: 'booking-id' }, technician: null, ledger: [], invoice: null,
  }
  const repository = {
    async getPayment(id) { calls.push(id); return id === adminId ? detail : null },
  }
  const app = express()
  app.use('/api/admin/payments', createPaymentsRouter(repository, { audit: (event) => events.push(event) }))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const base = `http://127.0.0.1:${server.address().port}/api/admin/payments`
  const sign = (role) => jwt.sign({ sub: adminId, role, purpose: 'access' }, env.jwtSecret, { expiresIn: '5m' })
  const admin = sign('ADMIN')
  const request = (id, token, method = 'GET') => fetch(`${base}/${id}`, {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  try {
    assert.equal((await request(adminId)).status, 401)
    assert.equal((await request(adminId, 'bad-token')).status, 401)
    assert.equal((await request(adminId, sign('CUSTOMER'))).status, 403)
    assert.equal((await request(adminId, sign('TECHNICIAN'))).status, 403)
    assert.equal((await request('PAY001', admin)).status, 422)
    assert.deepEqual(calls, [])
    const missing = await request(missingId, admin)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'PAYMENT_NOT_FOUND')
    assert.deepEqual(events, [])
    const response = await request(adminId, admin)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { success: true, data: detail })
    assert.equal(events.length, 1)
    assert.equal(events[0].action, 'READ_DETAIL')
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      assert.equal((await request(adminId, admin, method)).status, 404)
    }
    assert.deepEqual(calls, [missingId, adminId])
    assert.equal(events.length, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
