import { createHmac } from 'node:crypto'
import { pool } from '../../config/database.js'
import { TechnicianWalletRepository } from './wallet.repository.js'
import { zaloOrderId } from './wallet.domain.js'
import { queryVnpay } from '../payments/vnpay-query.js'

export const TOPUP_TIMEOUT_MS = 15 * 60_000

export async function queryTopupGateway(topup) {
  if (topup.method === 'VNPAY') return queryVnpay({
    txnRef: topup.id, amount: topup.amount,
    orderInfo: `CoolCare Topup ${topup.topup_code}`, createdAt: topup.created_at,
    expired: new Date(topup.created_at).getTime() + TOPUP_TIMEOUT_MS <= Date.now(),
  })
  if (topup.method !== 'ZALOPAY' || !process.env.ZALOPAY_QUERY_URL ||
      !process.env.ZALOPAY_APP_ID || !process.env.ZALOPAY_KEY1) return { status: 'UNKNOWN' }
  const appId = process.env.ZALOPAY_APP_ID
  const key = process.env.ZALOPAY_KEY1
  const orderId = zaloOrderId(topup)
  const mac = createHmac('sha256', key).update(`${appId}|${orderId}|${key}`).digest('hex')
  const response = await fetch(process.env.ZALOPAY_QUERY_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ app_id: appId, app_trans_id: orderId, mac }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`ZaloPay top-up query HTTP ${response.status}`)
  const result = await response.json()
  if (Number(result.return_code) === 1 && result.zp_trans_id) {
    return { status: 'SUCCESS', reference: String(result.zp_trans_id) }
  }
  if (Number(result.return_code) === 2) {
    return { status: 'FAILED', reference: `zalopay:query:${orderId}:2` }
  }
  return { status: 'UNKNOWN' }
}

export async function reconcileTopup(id, {
  repository = new TechnicianWalletRepository(), query = queryTopupGateway,
} = {}) {
  const topup = await repository.getById(id)
  if (!topup || !['PENDING', 'PROCESSING'].includes(topup.payment_status)) return topup
  let result
  try { result = await query(topup) }
  catch (error) {
    console.error('Top-up gateway reconciliation failed', { id, message: error.message })
    return topup
  }
  if (result?.status === 'SUCCESS') {
    await repository.settle(id, topup.method, result.reference)
  } else if (result?.status === 'FAILED') {
    const expired = new Date(topup.created_at).getTime() + TOPUP_TIMEOUT_MS <= Date.now()
    await repository.failVerified(id, topup.method, result.reference,
      expired ? 'CANCELLED' : 'FAILED')
  }
  return repository.getById(id)
}

let topupExpiryOffset = 0
export async function reconcileExpiredTopups({ limit = 30 } = {}) {
  const fetchBatch = offset => pool.query(`SELECT id FROM technician_topups
    WHERE payment_status IN (0,1) AND created_at <= NOW()-INTERVAL '15 minutes'
    ORDER BY created_at ASC,id ASC LIMIT $1 OFFSET $2`, [limit, offset])
  let rows = (await fetchBatch(topupExpiryOffset)).rows
  if (!rows.length && topupExpiryOffset) {
    topupExpiryOffset = 0
    rows = (await fetchBatch(0)).rows
  }
  topupExpiryOffset = rows.length < limit ? 0 : topupExpiryOffset + rows.length
  for (const row of rows) await reconcileTopup(row.id)
  return rows.length
}

export function startTopupExpiryWorker({ intervalMs = 60_000, run = reconcileExpiredTopups } = {}) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { await run() } catch (error) { console.error('Top-up expiry worker failed', error) }
    finally { running = false }
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  void tick()
  return () => clearInterval(timer)
}
