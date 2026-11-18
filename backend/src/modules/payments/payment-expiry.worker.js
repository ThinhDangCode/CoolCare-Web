import { pool, withTransaction } from '../../config/database.js'
import { queryVnpay } from './vnpay-query.js'
import { createHmac } from 'node:crypto'

export const PAYMENT_TIMEOUT_MS = 15 * 60_000

async function queryZaloPay(payment) {
  if (!payment.provider_order_id || !process.env.ZALOPAY_QUERY_URL ||
      !process.env.ZALOPAY_APP_ID || !process.env.ZALOPAY_KEY1) return { status: 'UNKNOWN' }
  const appId = process.env.ZALOPAY_APP_ID
  const orderId = payment.provider_order_id
  const key = process.env.ZALOPAY_KEY1
  const signature = createHmac('sha256', key).update(`${appId}|${orderId}|${key}`).digest('hex')
  const response = await fetch(process.env.ZALOPAY_QUERY_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ app_id: appId, app_trans_id: orderId, mac: signature }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`ZaloPay query HTTP ${response.status}`)
  const result = await response.json()
  if (Number(result.return_code) === 1 && result.zp_trans_id &&
      Number(result.amount) === Number(payment.amount)) {
    return { status: 'SUCCESS', reference: String(result.zp_trans_id) }
  }
  if (Number(result.return_code) === 2) return {
    status: 'FAILED', reference: `zalopay:query:${orderId}:2`,
  }
  return { status: 'UNKNOWN' }
}

export async function queryBookingPayment(payment) {
  if (payment.method_code === 'ZALOPAY') return queryZaloPay(payment)
  if (payment.method_code === 'VNPAY') {
    let transactionDate
    try { transactionDate = new URL(payment.checkout_url).searchParams.get('vnp_CreateDate') }
    catch { /* checkout was not created */ }
    return queryVnpay({
      txnRef: payment.id, amount: payment.amount,
      orderInfo: `CoolCare ${payment.payment_code}`,
      createdAt: payment.created_at, transactionDate,
      expired: new Date(payment.qr_expires_at ?? new Date(new Date(payment.created_at).getTime() + PAYMENT_TIMEOUT_MS)).getTime() <= Date.now(),
    })
  }
  return { status: 'UNKNOWN' }
}

// Reconcile outside the transaction, then lock and recheck before any status
// change. Database lifecycle triggers own the financial posting.
export async function reconcileBookingPayment(id, { query = queryBookingPayment } = {}) {
  const record = (await pool.query(`SELECT p.*, pm.code AS method_code
    FROM payments p JOIN payment_methods pm ON pm.id=p.payment_method_id
    WHERE p.id=$1`, [id])).rows[0]
  if (!record || !['PENDING', 'PROCESSING'].includes(record.payment_status) ||
      record.payment_kind !== 'ONLINE') return record
  const expiresAt = record.qr_expires_at ?? new Date(new Date(record.created_at).getTime() + PAYMENT_TIMEOUT_MS)
  // No gateway checkout exists: no funds can have been captured. For ZaloPay,
  // an order reservation is ambiguous, so it still needs a gateway query.
  if (!record.provider_order_id && !record.checkout_url &&
      new Date(expiresAt).getTime() <= Date.now()) {
    return withTransaction(async db => {
      const locked = (await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [id])).rows[0]
      if (locked?.payment_status !== 'PENDING' || locked.provider_order_id || locked.checkout_url) return locked
      return (await db.query(`UPDATE payments SET payment_status='CANCELLED',
        closure_verified_at=NOW(), closure_reference=$2, updated_at=NOW()
        WHERE id=$1 RETURNING *`, [id, `no-checkout:${id}`])).rows[0]
    })
  }
  let status
  try { status = await query(record) }
  catch (error) {
    console.error('Booking payment gateway reconciliation failed', { id, message: error.message })
    return record
  }
  if (!['SUCCESS', 'FAILED'].includes(status?.status)) return record
  return withTransaction(async db => {
    const locked = (await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [id])).rows[0]
    if (!locked || !['PENDING', 'PROCESSING'].includes(locked.payment_status)) return locked
    if (status.status === 'SUCCESS') {
      return (await db.query(`UPDATE payments SET payment_status='SUCCESS',
        transaction_reference=COALESCE(transaction_reference,$2), paid_at=NOW(), updated_at=NOW()
        WHERE id=$1 RETURNING *`, [id, status.reference])).rows[0]
    }
    return (await db.query(`UPDATE payments SET payment_status=$2,
      closure_verified_at=NOW(), closure_reference=$3, updated_at=NOW()
      WHERE id=$1 RETURNING *`, [id,
      new Date(expiresAt).getTime() <= Date.now() ? 'CANCELLED' : 'FAILED',
      status.reference])).rows[0]
  })
}

let bookingExpiryOffset = 0
export async function reconcileExpiredBookingPayments({ limit = 30 } = {}) {
  const fetchBatch = offset => pool.query(`SELECT p.id FROM payments p
    WHERE p.payment_kind='ONLINE' AND p.payment_status IN ('PENDING','PROCESSING')
      AND COALESCE(p.qr_expires_at,p.created_at + INTERVAL '15 minutes') <= NOW()
    ORDER BY p.created_at ASC,p.id ASC LIMIT $1 OFFSET $2`, [limit, offset])
  let rows = (await fetchBatch(bookingExpiryOffset)).rows
  if (!rows.length && bookingExpiryOffset) {
    bookingExpiryOffset = 0
    rows = (await fetchBatch(0)).rows
  }
  bookingExpiryOffset = rows.length < limit ? 0 : bookingExpiryOffset + rows.length
  for (const row of rows) await reconcileBookingPayment(row.id)
  return rows.length
}

export function startBookingPaymentExpiryWorker({ intervalMs = 60_000, run = reconcileExpiredBookingPayments } = {}) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { await run() } catch (error) { console.error('Booking payment expiry worker failed', error) }
    finally { running = false }
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  void tick()
  return () => clearInterval(timer)
}
