import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateSync } from 'node:zlib'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import {
  formatDate, formatDateTime, formatVnd, invoiceFilename, maskEmail, maskPhone,
} from '../src/modules/invoices/invoice.format.js'
import { renderInvoicePdf } from '../src/modules/invoices/invoice.pdf.js'
import { createInvoiceRouter } from '../src/modules/invoices/invoice.routes.js'
import { InvoiceService, buildInvoiceView } from '../src/modules/invoices/invoice.service.js'
import { TrueTypeFont } from '../src/modules/invoices/pdf/truetype-font.js'
import { readFileSync } from 'node:fs'

const userId = '11111111-1111-1111-1111-111111111111'
const otherUserId = '22222222-2222-2222-2222-222222222222'
const paymentId = '33333333-3333-3333-3333-333333333333'

const payment = {
  paymentId, paymentCode: 'PAY-1', amount: '400000.00', status: 'SUCCESS',
  paidAt: new Date('2026-10-24T03:30:00Z'), transactionReference: null, methodCode: 'VNPAY',
  bookingId: '44444444-4444-4444-4444-444444444444', bookingCode: 'BK-DEMO-0001',
  scheduledAt: new Date('2026-10-24T01:00:00Z'), completedAt: null, bookingDescription: 'Máy lạnh phòng ngủ chảy nước',
  serviceAddress: '12 Nguyễn Trãi', ward: 'Phường Ninh Kiều', district: null, city: 'Cần Thơ',
  customerId: 'c1', customerUserId: userId, customerName: 'Nguyễn Văn An', customerPhone: '0909000123',
  customerEmail: 'an.nguyen@example.com', technicianName: 'Trần Minh Khang',
}
const invoice = {
  id: '55555555-5555-5555-5555-555555555555', invoiceNumber: 'CC-DEMO-0001', issuedAt: new Date('2026-10-24T03:30:00Z'),
  partsAmount: '100000.00', subtotal: '450000.00', discountAmount: '50000.00', totalAmount: '400000.00',
}
const items = [
  { id: 'i1', itemType: 'SERVICE', description: 'Vệ sinh máy lạnh treo tường', quantity: '2.00', unit: 'lần', unitPrice: '150000.00', totalPrice: '300000.00' },
  { id: 'i2', itemType: 'LABOR', description: 'Công phát sinh đã duyệt', quantity: '1.00', unit: 'lần', unitPrice: '50000.00', totalPrice: '50000.00' },
]
const found = { payment, invoice, items, paidAmount: '400000.00' }

function fakeRepository(overrides = {}) {
  const calls = { recorded: [] }
  return {
    calls,
    async findForCustomer(user, id) {
      if (overrides.find) return overrides.find(user, id)
      return user === userId && id === paymentId ? found : null
    },
    async ensureInvoice(id) { calls.ensured = [...(calls.ensured ?? []), id]; return overrides.ensure?.() ?? false },
    async findPendingEmails() { return overrides.pending ?? [] },
    async recordEmailSent(entry) { calls.recorded.push(entry) },
  }
}

// The embedded subset deliberately has no cmap (PDF addresses glyphs by id).
function readSubset(buffer) {
  const count = buffer.readUInt16BE(4)
  const tables = new Map()
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16
    tables.set(buffer.toString('latin1', at, at + 4), { offset: buffer.readUInt32BE(at + 8), length: buffer.readUInt32BE(at + 12) })
  }
  let sum = 0
  for (let i = 0; i < buffer.length; i += 4) sum = (sum + buffer.readUInt32BE(i)) >>> 0
  const maxp = tables.get('maxp')
  const head = tables.get('head')
  return {
    tags: [...tables.keys()],
    numGlyphs: buffer.readUInt16BE(maxp.offset + 4),
    magic: buffer.readUInt32BE(head.offset + 12),
    locaFormat: buffer.readInt16BE(head.offset + 50),
    wholeFileChecksum: sum,
  }
}

const silent = { error() {}, info() {}, warn() {} }
const sender = (configured = true) => {
  const sent = []
  return { isConfigured: configured, sent, async sendInvoiceEmail(message) { sent.push(message) } }
}

test('money, date and masking helpers follow the invoice design', () => {
  assert.equal(formatVnd(150000), '150.000 ₫')
  assert.equal(formatVnd('-50000'), '-50.000 ₫')
  assert.equal(formatVnd(0), '0 ₫')
  assert.equal(formatVnd(null), '0 ₫')
  assert.equal(formatDate('2026-10-24T03:30:00Z'), '24/10/2026')
  assert.equal(formatDateTime('2026-10-24T03:30:00Z'), '24/10/2026 · 10:30')
  assert.equal(formatDate('2026-10-24T18:00:00Z'), '25/10/2026') // Vietnam time, not UTC
  assert.equal(formatDate(null), '—')
  assert.equal(formatDateTime('not a date'), '—')
  assert.equal(maskPhone('0909000123'), '09•• ••• 123')
  assert.equal(maskPhone(null), '—')
  assert.equal(maskEmail('an.nguyen@example.com'), 'an•••••••@example.com')
  assert.equal(invoiceFilename('CC/DEMO 0001'), 'HoaDon-CC-DEMO-0001.pdf')
  assert.equal(/[\/\\]/.test(invoiceFilename('../../etc/passwd')), false)
})

test('invoice view model carries every figure of the design and never exposes raw contact data', () => {
  const view = buildInvoiceView(found, { name: 'CoolCare', address: '', hotline: '', taxCode: '' })
  assert.equal(view.invoiceNumber, 'CC-DEMO-0001')
  assert.equal(view.booking.code, 'BK-DEMO-0001')
  assert.equal(view.booking.technicianName, 'Trần Minh Khang')
  assert.equal(view.customer.phoneMasked, '09•• ••• 123')
  assert.equal(view.customer.address, '12 Nguyễn Trãi, Phường Ninh Kiều, Cần Thơ')
  assert.equal(view.payment.statusLabel, 'Đã thanh toán')
  assert.equal(view.payment.methodLabel, 'VNPay')
  assert.deepEqual(view.items.map((i) => [i.type, i.quantity, i.unitPrice, i.totalPrice]), [
    ['SERVICE', 2, 150000, 300000], ['LABOR', 1, 50000, 50000],
  ])
  assert.deepEqual(
    [view.partsAmount, view.subtotal, view.discountAmount, view.totalAmount, view.paidAmount, view.remainingAmount],
    [100000, 450000, 50000, 400000, 400000, 0]
  )
  assert.equal(view.provider.address, null)
  const serialized = JSON.stringify(view)
  assert.equal(serialized.includes('0909000123'), false)
  assert.equal(serialized.includes('an.nguyen@example.com'), false)
})

test('paid amount is capped at the invoice total and remaining never goes negative', () => {
  assert.equal(buildInvoiceView({ ...found, paidAmount: '900000' }).paidAmount, 400000)
  const partial = buildInvoiceView({ ...found, paidAmount: '150000' })
  assert.equal(partial.remainingAmount, 250000)
})

test('PDF is a valid, compact, selectable-text document with Vietnamese text', () => {
  const view = buildInvoiceView(found, { name: 'CoolCare', address: '1 Đường Demo', hotline: '1900 0000', taxCode: '' })
  const pdf = renderInvoicePdf(view)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.match(pdf.subarray(-6).toString(), /%%EOF/)
  assert.ok(pdf.length < 150_000, `PDF too large: ${pdf.length}`)
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page /g) ?? []).length, 1)
  // Embedded font subsets must still parse as TrueType fonts.
  const streams = [...pdf.toString('latin1').matchAll(/\/Length1 (\d+) \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)]
  assert.equal(streams.length, 2)
  for (const match of streams) {
    const start = match.index + match[0].length
    const font = inflateSync(pdf.subarray(start, start + Number(match[2])))
    assert.equal(font.length, Number(match[1]))
    const info = readSubset(font)
    for (const tag of ['glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp']) assert.ok(info.tags.includes(tag), `missing ${tag}`)
    assert.ok(info.numGlyphs > 1000)
    assert.equal(info.magic, 0x5f0f3cf5)
    assert.equal(info.locaFormat, 1)
    assert.equal(info.wholeFileChecksum, 0xb1b0afba)
  }
})

test('long invoices continue on extra pages instead of overflowing', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...items[0], id: `x${i}`, description: `Hạng mục ${i + 1} vệ sinh bảo dưỡng máy lạnh âm trần` }))
  const view = buildInvoiceView({ ...found, items: many })
  const pdf = renderInvoicePdf(view)
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page /g) ?? []).length >= 2)
})

test('font subsetting keeps unused glyph slots empty and survives missing characters', () => {
  const font = new TrueTypeFont(readFileSync(new URL('../assets/fonts/LiberationSans-Regular.ttf', import.meta.url)))
  const glyph = font.glyphId('Ệ'.codePointAt(0))
  assert.ok(glyph > 0)
  assert.equal(font.glyphId(0x1f600), 0) // emoji is not in the font -> .notdef, never throws
  const subset = font.subset(new Set([glyph]))
  assert.equal(readSubset(subset).numGlyphs, font.numGlyphs)
  assert.ok(subset.length < 60_000)
})

test('service only exposes successful, owned, issued invoices', async () => {
  const service = new InvoiceService({ repository: fakeRepository(), emailSender: sender(), logger: silent })
  await assert.rejects(service.getInvoice(otherUserId, paymentId), { status: 404, code: 'PAYMENT_NOT_FOUND' })
  const pending = new InvoiceService({
    repository: fakeRepository({ find: async () => ({ payment: { ...payment, status: 'PENDING' }, invoice: null, items: [], paidAmount: 0 }) }),
    logger: silent,
  })
  await assert.rejects(pending.getInvoice(userId, paymentId), { status: 409, code: 'INVOICE_NOT_AVAILABLE' })
  const unissued = new InvoiceService({
    repository: fakeRepository({ find: async () => ({ payment, invoice: null, items: [], paidAmount: 0 }) }),
    logger: silent,
  })
  await assert.rejects(unissued.getInvoice(userId, paymentId), { status: 404, code: 'INVOICE_NOT_FOUND' })
  assert.equal((await service.getInvoice(userId, paymentId)).invoiceNumber, 'CC-DEMO-0001')
})

test('emailing sends the PDF to the account email, records it and is rate limited', async () => {
  const mail = sender()
  const repository = fakeRepository()
  let clock = 1_000_000
  const service = new InvoiceService({ repository, emailSender: mail, now: () => clock, logger: silent })
  const result = await service.emailInvoice(userId, paymentId)
  assert.equal(result.sentTo, 'an•••••••@example.com')
  assert.equal(mail.sent.length, 1)
  assert.equal(mail.sent[0].email, 'an.nguyen@example.com')
  assert.equal(mail.sent[0].filename, 'HoaDon-CC-DEMO-0001.pdf')
  assert.equal(mail.sent[0].pdf.subarray(0, 5).toString(), '%PDF-')
  assert.equal(repository.calls.recorded.length, 1)
  await service.emailInvoice(userId, paymentId)
  await service.emailInvoice(userId, paymentId)
  await assert.rejects(service.emailInvoice(userId, paymentId), (error) => {
    assert.equal(error.status, 429)
    assert.ok(error.details.retryAfter > 0)
    return true
  })
  assert.equal(mail.sent.length, 3)
  clock += 16 * 60_000
  await service.emailInvoice(userId, paymentId)
  assert.equal(mail.sent.length, 4)
})

test('emailing fails clearly without SMTP and for foreign payments', async () => {
  const off = new InvoiceService({ repository: fakeRepository(), emailSender: sender(false), logger: silent })
  await assert.rejects(off.emailInvoice(userId, paymentId), { status: 503, code: 'EMAIL_NOT_CONFIGURED' })
  const on = new InvoiceService({ repository: fakeRepository(), emailSender: sender(), logger: silent })
  await assert.rejects(on.emailInvoice(otherUserId, paymentId), { status: 404 })
  const noEmail = new InvoiceService({
    repository: fakeRepository({ find: async () => ({ ...found, payment: { ...payment, customerEmail: ' ' } }) }),
    emailSender: sender(), logger: silent,
  })
  await assert.rejects(noEmail.emailInvoice(userId, paymentId), { status: 422, code: 'EMAIL_REQUIRED' })
})

test('automatic dispatch emails each pending payment once and backs off after a failure', async () => {
  const mail = sender()
  const repository = fakeRepository({ pending: [{ paymentId, userId }] })
  const service = new InvoiceService({ repository, emailSender: mail, logger: silent })
  assert.equal(await service.dispatchPendingEmails(), 1)
  assert.equal(mail.sent.length, 1)
  assert.equal(repository.calls.recorded.length, 1)

  const failing = sender()
  failing.sendInvoiceEmail = async () => { throw new Error('smtp down') }
  let clock = 0
  const retry = new InvoiceService({ repository: fakeRepository({ pending: [{ paymentId, userId }] }), emailSender: failing, now: () => clock, logger: silent })
  assert.equal(await retry.dispatchPendingEmails(), 0)
  let attempts = 0
  failing.sendInvoiceEmail = async () => { attempts += 1; throw new Error('smtp down') }
  await retry.dispatchPendingEmails()
  assert.equal(attempts, 0) // still backing off
  clock += 11 * 60_000
  await retry.dispatchPendingEmails()
  assert.equal(attempts, 1)

  const disabled = new InvoiceService({ repository: fakeRepository({ pending: [{ paymentId, userId }] }), emailSender: sender(false), logger: silent })
  assert.equal(await disabled.dispatchPendingEmails(), 0)
})

async function withServer(service, work) {
  const app = express()
  app.use('/api/payments', createInvoiceRouter(service))
  app.use('/api/payments', (_req, res) => res.json({ passedThrough: true }))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0)
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/payments`
    await work((path, { token, method = 'GET' } = {}) => fetch(`${base}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} }))
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const token = (role, sub = userId) => jwt.sign({ sub, role, purpose: 'access' }, env.jwtSecret, { expiresIn: '5m' })

test('HTTP: authentication, role, id validation and ownership are enforced', async () => {
  const service = new InvoiceService({ repository: fakeRepository(), emailSender: sender(), logger: silent })
  await withServer(service, async (request) => {
    for (const path of [`/${paymentId}/invoice`, `/${paymentId}/invoice/pdf`]) {
      assert.equal((await request(path)).status, 401)
      assert.equal((await request(path, { token: 'garbage' })).status, 401)
      assert.equal((await request(path, { token: token('ADMIN') })).status, 403)
    }
    assert.equal((await request(`/${paymentId}/invoice/email`, { method: 'POST' })).status, 401)
    assert.equal((await request('/not-a-uuid/invoice', { token: token('CUSTOMER') })).status, 422)
    assert.equal((await request(`/${paymentId}/invoice`, { token: token('CUSTOMER', otherUserId) })).status, 404)
    assert.equal((await request(`/${paymentId}/invoice/pdf`, { token: token('CUSTOMER', otherUserId) })).status, 404)
  })
})

test('HTTP: JSON, PDF download and email responses', async () => {
  const mail = sender()
  const service = new InvoiceService({ repository: fakeRepository(), emailSender: mail, logger: silent })
  await withServer(service, async (request) => {
    const customer = token('CUSTOMER')
    const json = await request(`/${paymentId}/invoice`, { token: customer })
    assert.equal(json.status, 200)
    assert.equal(json.headers.get('cache-control'), 'private, no-store')
    assert.equal((await json.json()).data.totalAmount, 400000)

    const pdf = await request(`/${paymentId}/invoice/pdf`, { token: customer })
    assert.equal(pdf.status, 200)
    assert.equal(pdf.headers.get('content-type'), 'application/pdf')
    assert.match(pdf.headers.get('content-disposition'), /attachment; filename="HoaDon-CC-DEMO-0001\.pdf"/)
    assert.equal(pdf.headers.get('x-content-type-options'), 'nosniff')
    const body = Buffer.from(await pdf.arrayBuffer())
    assert.equal(body.subarray(0, 5).toString(), '%PDF-')
    assert.equal(String(body.length), pdf.headers.get('content-length'))

    const sent = await request(`/${paymentId}/invoice/email`, { token: customer, method: 'POST' })
    assert.equal(sent.status, 200)
    assert.equal((await sent.json()).data.sentTo, 'an•••••••@example.com')
    assert.equal(mail.sent.length, 1)
  })
})

test('HTTP: email rate limit answers 429 with Retry-After; other payment routes fall through', async () => {
  const service = new InvoiceService({ repository: fakeRepository(), emailSender: sender(), logger: silent })
  await withServer(service, async (request) => {
    const customer = token('CUSTOMER')
    for (let i = 0; i < 3; i += 1) assert.equal((await request(`/${paymentId}/invoice/email`, { token: customer, method: 'POST' })).status, 200)
    const limited = await request(`/${paymentId}/invoice/email`, { token: customer, method: 'POST' })
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) > 0)
    assert.equal((await (await request('/history')).json()).passedThrough, true)
  })
})

test('a paid payment without an invoice gets one issued on demand', async () => {
  let issued = false
  const repository = fakeRepository({
    find: async () => (issued ? found : { payment, invoice: null, items: [], paidAmount: 0 }),
    ensure: () => { issued = true; return true },
  })
  const service = new InvoiceService({ repository, emailSender: sender(), logger: silent })
  assert.equal((await service.getInvoice(userId, paymentId)).invoiceNumber, 'CC-DEMO-0001')
  assert.deepEqual(repository.calls.ensured, [paymentId])
  const never = fakeRepository({ find: async () => ({ payment: { ...payment, status: 'PENDING' }, invoice: null, items: [], paidAmount: 0 }) })
  await assert.rejects(new InvoiceService({ repository: never, logger: silent }).getInvoice(userId, paymentId), { status: 409 })
  assert.equal(never.calls.ensured, undefined) // unpaid payments never get invoices
})
