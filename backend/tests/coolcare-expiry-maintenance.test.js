import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { verifyVnpayQueryResponse } from '../src/modules/payments/vnpay-query.js'

const secret = 'sandbox-secret'
const fields = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message',
  'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate',
  'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus',
  'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount']
const context = { txnRef: '12345678-1234-1234-1234-123456789012', amount: 150000,
  orderInfo: 'CoolCare PAY00001', tmnCode: 'DEMO1234', secret }
const sign = result => ({ ...result,
  vnp_SecureHash: createHmac('sha512', secret).update(fields.map(k => String(result[k] ?? '')).join('|')).digest('hex') })
const base = { vnp_ResponseId: 'r1', vnp_Command: 'querydr', vnp_ResponseCode: '00',
  vnp_Message: 'OK', vnp_TmnCode: context.tmnCode, vnp_TxnRef: context.txnRef,
  vnp_Amount: 15000000, vnp_BankCode: 'NCB', vnp_PayDate: '20261118090000',
  vnp_TransactionNo: '123456', vnp_TransactionType: '01', vnp_TransactionStatus: '00',
  vnp_OrderInfo: context.orderInfo, vnp_PromotionCode: '', vnp_PromotionAmount: '' }

test('VNPay signed querydr SUCCESS is accepted', () => {
  assert.deepEqual(verifyVnpayQueryResponse(sign(base), context), { status: 'SUCCESS', reference: '123456' })
})
test('VNPay signed failed transaction is closed; incomplete transaction is not', () => {
  assert.equal(verifyVnpayQueryResponse(sign({ ...base, vnp_TransactionStatus: '02' }), context).status, 'FAILED')
  assert.equal(verifyVnpayQueryResponse(sign({ ...base, vnp_TransactionStatus: '01' }), context).status, 'UNKNOWN')
})
test('VNPay signed not-found only closes after QR expiry', () => {
  const notFound = sign({ ...base, vnp_ResponseCode: '91', vnp_TransactionStatus: '' })
  assert.equal(verifyVnpayQueryResponse(notFound, context).status, 'UNKNOWN')
  assert.equal(verifyVnpayQueryResponse(notFound, { ...context, expired: true }).status, 'FAILED')
})
test('VNPay tampering and mismatched amounts cannot close or credit', () => {
  assert.equal(verifyVnpayQueryResponse({ ...sign(base), vnp_Amount: 100 }, context), null)
  assert.equal(verifyVnpayQueryResponse({ ...sign(base), vnp_TransactionStatus: '02' }, context), null)
  assert.equal(verifyVnpayQueryResponse(sign(base), { ...context, amount: 500000 }), null)
})
test('maintenance reminder is service-specific and uses booking completion date', () => {
  const source = readFileSync(new URL('../src/modules/maintenance-reminders/maintenance-reminder.worker.js', import.meta.url), 'utf8')
  assert.match(source, /b\.completed_at\s*\+\s*s\.maintenance_interval_days/)
  assert.match(source, /maintenance_reminder_sent_at/)
  assert.match(source, /s\.maintenance_interval_days\s*>\s*0/)
  assert.match(source, /vệ sinh|bảo dưỡng/)
  assert.match(source, /Đã đến kỳ/)
  assert.match(source, /INSERT INTO notifications/)
  assert.doesNotMatch(source, /CREATE TABLE|ALTER TABLE/)
})
test('technician owns payment replacement and withdrawal does not expire at 15 minutes', () => {
  const payment = readFileSync(new URL('../src/modules/payments/customer-payment.routes.js', import.meta.url), 'utf8')
  const withdrawal = readFileSync(new URL('../src/modules/stripe-withdrawals/routes.js', import.meta.url), 'utf8')
  assert.match(payment, /close-for-retry/)
  assert.match(payment, /assigned\(db, req\.auth\.userId, p\.booking_id\)/)
  assert.match(payment, /cashNotReceived/)
  assert.match(withdrawal, /reconcileProcessingStripeWithdrawals/)
  assert.match(withdrawal, /20 \* 3600_000/)
})

test('maintenance reminder copy recommends the matching service, without warranty language', () => {
  const source = readFileSync(new URL('../src/modules/maintenance-reminders/maintenance-reminder.worker.js', import.meta.url), 'utf8')
  const start = source.indexOf('export const maintenanceDueAt')
  const end = source.indexOf('const DUE_SERVICE_SQL', start)
  const declarations = source.slice(start, end).replaceAll('export ', '')
  const functions = runInNewContext(`${declarations}; ({ maintenanceDueAt, maintenanceNotification })`)
  const completed = new Date('2026-11-18T03:00:00.000Z')
  const due = functions.maintenanceDueAt(completed, 90)
  assert.equal(due.toISOString().slice(0, 10), '2027-02-16')
  const base = { unit_number: 2, due_at: due }
  const clean = functions.maintenanceNotification({ ...base, service_name: 'Vệ sinh máy lạnh' })
  const maintain = functions.maintenanceNotification({ ...base, service_name: 'Bảo dưỡng máy lạnh' })
  const repair = functions.maintenanceNotification({ ...base, service_name: 'Sửa chữa cơ bản' })
  assert.match(clean.message, /đặt lịch vệ sinh/)
  assert.match(maintain.message, /đặt lịch bảo dưỡng/)
  assert.match(repair.message, /kiểm tra lại tình trạng máy lạnh sau/)
  assert.match(clean.message, /16\/02\/2027/)
  assert.doesNotMatch(clean.message, /bảo hành/)
})

test('booking expiry does not close an uncertain charge, but closes a verified failed charge', async () => {
  const source = readFileSync(new URL('../src/modules/payments/payment-expiry.worker.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replaceAll('export ', '')
  const payment = { id: 'payment-id', payment_status: 'PENDING', payment_kind: 'ONLINE',
    method_code: 'ZALOPAY', provider_order_id: 'order-id', checkout_url: 'https://example.com',
    amount: 150000, created_at: new Date('2026-11-18T00:00:00Z'),
    qr_expires_at: new Date('2026-11-18T00:15:00Z') }
  let updates = 0
  const db = { async query(sql, params) {
    if (/^SELECT \*/.test(sql)) return { rows: [{ ...payment }] }
    if (/^UPDATE payments/.test(sql)) {
      updates++
      payment.payment_status = sql.includes("payment_status='SUCCESS'") ? 'SUCCESS' : params[1]
      return { rows: [{ ...payment }] }
    }
    throw new Error('Unexpected SQL')
  } }
  const context = {
    pool: { async query() { return { rows: [{ ...payment }] } } },
    withTransaction: async work => work(db), queryVnpay: () => ({}),
    createHmac, console, Date, URL, AbortSignal, fetch: () => { throw Error('Unexpected fetch') },
    setInterval, clearInterval,
  }
  const { reconcileBookingPayment } = runInNewContext(`${source}; ({ reconcileBookingPayment })`, context)
  await reconcileBookingPayment(payment.id, { query: async () => ({ status: 'UNKNOWN' }) })
  assert.equal(updates, 0)
  assert.equal(payment.payment_status, 'PENDING')
  await reconcileBookingPayment(payment.id, { query: async () => ({ status: 'FAILED', reference: 'verified:fail' }) })
  assert.equal(updates, 1)
  assert.equal(payment.payment_status, 'CANCELLED')
})

test('maintenance notification worker inserts app message with the configured service recommendation', async () => {
  const source = readFileSync(new URL('../src/modules/maintenance-reminders/maintenance-reminder.worker.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replaceAll('export ', '')
  const rows = [{ unit_service_id: 'service-id', unit_id: 'unit-id',
    unit_number: 1, booking_id: 'booking-id', booking_code: 'BK123', user_id: 'user-id',
    service_name: 'Vệ sinh máy lạnh', due_at: new Date('2026-11-18T00:00:00Z') }]
  const inserted = []
  const context = {
    pool: { async query(sql) { assert.match(sql, /NOT EXISTS/); return { rows } } },
    withTransaction: async work => work({ async query(sql, params) {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [{}] }
      inserted.push(params)
      return { rowCount: 1 }
    } }),
    createEmailSender: () => ({ isConfigured: false }), console, Date,
    setInterval, clearInterval,
  }
  const { dispatchMaintenanceNotifications } = runInNewContext(`${source}; ({ dispatchMaintenanceNotifications })`, context)
  assert.equal(await dispatchMaintenanceNotifications(), 1)
  assert.equal(inserted.length, 1)
  assert.match(inserted[0][1], /Đã đến kỳ: Vệ sinh máy lạnh/)
  assert.match(inserted[0][2], /đặt lịch vệ sinh máy lạnh định kỳ/)
})
