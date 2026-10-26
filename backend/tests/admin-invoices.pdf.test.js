import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { pool } from '../src/config/database.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { AppError } from '../src/utils.js'
import { InvoicesService } from '../src/modules/invoices/invoices.service.js'
import { createInvoicesRouter } from '../src/modules/invoices/invoices.routes.js'
import { invoicePdfContentDisposition } from '../src/modules/invoices/invoices.controller.js'

const actorId = '10000000-0000-0000-0000-000000000001'
const invoiceId = 'a0000000-0000-0000-0000-000000000001'
const absentId = 'a0000000-0000-0000-0000-000000000002'
const document = Buffer.from('%PDF-1.3\nSynthetic test document\n%%EOF\n')
const invoice = {
  id: invoiceId, invoiceNumber: 'HĐ-0001', paymentStatus: 'PAID',
  customer: { name: 'Private Customer', phone: '0901234567' },
  booking: { address: 'Private address', completedAt: new Date('2026-10-01T03:30:00Z') },
  totals: { totalAmount: '999999999999.99' }, payments: [{ code: 'Private payment code' }],
  pdfUrl: 'https://example.com/old-invoice.pdf',
}

test('PDF download reads the same invoice once, renders in memory and records EXPORT_PDF metadata only', async () => {
  const reads = []
  const renders = []
  const events = []
  const service = new InvoicesService({ getInvoice: async (id) => { reads.push(id); return invoice } }, {
    renderPdf: async (source) => { renders.push(source); return document },
    audit: (event) => events.push(event),
  })
  const output = await service.downloadInvoicePdf(invoiceId.toUpperCase(), actorId)
  assert.deepEqual(reads, [invoiceId])
  assert.deepEqual(renders, [invoice])
  assert.equal(output.buffer, document)
  assert.equal(output.filename, 'Hoa-don-HĐ-0001.pdf')
  assert.deepEqual(events, [{
    actorId, action: 'EXPORT_PDF', entityType: 'INVOICE', entityId: invoiceId,
    before: null, after: { paymentStatus: 'PAID', byteLength: document.length },
  }])
  for (const privateValue of ['Private', '0901234567', '999999999999.99', 'old-invoice.pdf', 'HĐ-0001'])
    assert.equal(JSON.stringify(events).includes(privateValue), false)
})

test('PDF download rejects malformed IDs and any query input before reading or rendering', async () => {
  const service = new InvoicesService({ getInvoice: async () => assert.fail('Unexpected database read') }, {
    renderPdf: async () => assert.fail('Unexpected PDF rendering'),
    audit: () => assert.fail('Unexpected successful export audit'),
  })
  for (const id of ['bad', null, [invoiceId], `${invoiceId}' OR true`])
    await assert.rejects(service.downloadInvoicePdf(id, actorId), { status: 422 })
  for (const query of [{ locale: 'en' }, { from: '2026-10-01' }, { x: ['1', '2'] }])
    await assert.rejects(service.downloadInvoicePdf(invoiceId, actorId, query), { status: 422 })
})

test('missing and failed PDF reads never render or emit a successful export audit', async () => {
  const options = {
    renderPdf: async () => assert.fail('Unexpected PDF rendering'),
    audit: () => assert.fail('Unexpected successful export audit'),
  }
  const missing = new InvoicesService({ getInvoice: async () => null }, options)
  await assert.rejects(missing.downloadInvoicePdf(invoiceId, actorId), { status: 404, code: 'INVOICE_NOT_FOUND' })
  const failed = new InvoicesService({ getInvoice: async () => { throw new AppError(503, 'DB_UNAVAILABLE', 'Unavailable') } }, options)
  await assert.rejects(failed.downloadInvoicePdf(invoiceId, actorId), { status: 503, code: 'DB_UNAVAILABLE' })
})

test('render errors and invalid renderer output return a safe error without a successful export audit', async () => {
  for (const renderPdf of [
    async () => { throw new Error('Private rendering details') },
    async () => null,
    async () => 'not a buffer',
    async () => Buffer.from('not a pdf'),
  ]) {
    const service = new InvoicesService({ getInvoice: async () => invoice }, {
      renderPdf, audit: () => assert.fail('Unexpected successful export audit'),
    })
    await assert.rejects(service.downloadInvoicePdf(invoiceId, actorId), (error) => {
      assert.equal(error.status, 500)
      assert.equal(error.code, 'INVOICE_PDF_FAILED')
      assert.equal(error.message.includes('Private'), false)
      return true
    })
  }
})

test('PDF filenames preserve a bounded document number and exclude path, header and bidi controls', async () => {
  const service = new InvoicesService({ getInvoice: async () => ({
    ...invoice, invoiceNumber: `../HĐ-0001/\\\r\n"; filename="evil\u202e${'x'.repeat(200)}`,
  }) }, { renderPdf: async () => document, audit: () => {} })
  const output = await service.downloadInvoicePdf(invoiceId, actorId)
  assert.ok(output.filename.startsWith('Hoa-don-'))
  assert.ok(output.filename.endsWith('.pdf'))
  assert.ok(output.filename.length <= 112)
  assert.doesNotMatch(output.filename, /[\r\n/\\";\u202e]/)
  const fallback = new InvoicesService({ getInvoice: async () => ({ ...invoice, invoiceNumber: null }) }, {
    renderPdf: async () => document, audit: () => {},
  })
  assert.equal((await fallback.downloadInvoicePdf(invoiceId, actorId)).filename, `Hoa-don-${invoiceId}.pdf`)
  const unicode = new InvoicesService({ getInvoice: async () => ({
    ...invoice, invoiceNumber: `${'x'.repeat(99)}\u{2000B}more`,
  }) }, { renderPdf: async () => document, audit: () => {} })
  const unicodeFilename = (await unicode.downloadInvoicePdf(invoiceId, actorId)).filename
  assert.ok(unicodeFilename.endsWith('\u{2000B}.pdf'))
  assert.doesNotThrow(() => invoicePdfContentDisposition(unicodeFilename))
})

test('PDF HTTP endpoint is Admin-only, sends protected attachment headers and leaves error responses as JSON', async () => {
  let reads = 0
  let renders = 0
  let renderFailure = false
  const events = []
  const app = express()
  app.use('/api/admin/invoices', createInvoicesRouter({ getInvoice: async (id) => {
    reads += 1
    return id === invoiceId ? invoice : null
  } }, {
    renderPdf: async () => {
      renders += 1
      if (renderFailure) throw new Error('Sensitive render failure')
      return document
    },
    audit: (event) => events.push(event),
  }))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const base = `http://127.0.0.1:${server.address().port}/api/admin/invoices`
  const sign = (role, expiresIn = '5m') => jwt.sign({ sub: actorId, role, purpose: 'access' }, env.jwtSecret, { expiresIn })
  const request = (path = `/${invoiceId}/pdf`, auth, method = 'GET') => fetch(`${base}${path}`, {
    method, headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  })
  const rawQuery = pool.query
  try {
    for (const auth of [undefined, 'bad-token', sign('ADMIN', '-1s')]) {
      const response = await request(undefined, auth)
      assert.equal(response.status, 401)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.match(response.headers.get('content-type'), /application\/json/)
      assert.equal(response.headers.has('content-disposition'), false)
    }
    pool.query = async () => ({ rows: [{ status: 'ACTIVE' }] })
    for (const role of ['CUSTOMER', 'TECHNICIAN']) {
      const response = await request(undefined, sign(role))
      assert.equal(response.status, 403)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    pool.query = rawQuery
    assert.equal(reads, 0)
    assert.equal(renders, 0)
    const admin = sign('ADMIN')
    for (const path of ['/bad/pdf', `/${invoiceId}/pdf?locale=vi`, `/${invoiceId}/pdf?x=1&x=2`]) {
      const response = await request(path, admin)
      assert.equal(response.status, 422)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    assert.equal(reads, 0)
    const missing = await request(`/${absentId}/pdf`, admin)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'INVOICE_NOT_FOUND')
    assert.equal(renders, 0)
    const response = await request(undefined, admin)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('content-type'), 'application/pdf')
    assert.equal(response.headers.get('content-length'), String(document.length))
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('access-control-expose-headers'), 'Content-Disposition')
    assert.equal(response.headers.get('content-disposition'),
      'attachment; filename="Hoa-don-HD-0001.pdf"; filename*=UTF-8\'\'Hoa-don-H%C4%90-0001.pdf')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), document)
    assert.equal(events.length, 1)
    assert.equal(events[0].action, 'EXPORT_PDF')
    const found = await request(`/${invoiceId}`, admin)
    assert.equal(found.status, 200)
    assert.match(found.headers.get('content-type'), /application\/json/)
    assert.equal((await found.json()).data.id, invoiceId)
    assert.equal(events[1].action, 'READ_DETAIL')
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const blocked = await request(undefined, admin, method)
      assert.equal(blocked.status, 404)
      assert.equal(blocked.headers.get('cache-control'), 'no-store')
    }
    const eventCount = events.length
    renderFailure = true
    const failed = await request(undefined, admin)
    assert.equal(failed.status, 500)
    assert.equal(failed.headers.get('cache-control'), 'no-store')
    assert.equal(failed.headers.has('content-disposition'), false)
    assert.match(failed.headers.get('content-type'), /application\/json/)
    const failedBody = await failed.json()
    assert.equal(failedBody.error.code, 'INVOICE_PDF_FAILED')
    assert.equal(JSON.stringify(failedBody).includes('Sensitive'), false)
    assert.equal(events.length, eventCount)
  } finally {
    pool.query = rawQuery
    await new Promise((resolve) => server.close(resolve))
  }
})

test.after(async () => { await pool.end() })
