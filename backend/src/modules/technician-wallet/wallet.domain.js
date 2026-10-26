import { createHmac, timingSafeEqual } from 'node:crypto'
import { AppError, validateUuid } from '../../utils.js'

export const walletError = (code, message, status = 409) => { throw new AppError(status, code, message) }
export const hmac = (secret, message, algorithm = 'sha256') => createHmac(algorithm, secret).update(message).digest('hex')
export const secureSame = (left, right) => typeof left === 'string' && typeof right === 'string' &&
  left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right))
export const vnpSign = (params) => Object.keys(params).sort().map(key =>
  `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key])).replace(/%20/g, '+')}`).join('&')
export const vnClock = (value) => new Date(new Date(value).getTime() + 7 * 3600000)
  .toISOString().replace(/[-:T]/g, '').slice(0, 14)
export const zaloOrderId = (topup) => `${vnClock(topup.created_at).slice(2, 8)}_${topup.id.replace(/-/g, '')}`
export function validatedTopup(body) {
  const amount = Number(body?.amount)
  if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 50000000) {
    walletError('INVALID_TOPUP_AMOUNT', 'Top-up must be an integer from 10,000 to 50,000,000 VND.', 422)
  }
  if (!['VNPAY', 'ZALOPAY'].includes(body?.method)) {
    walletError('INVALID_TOPUP_METHOD', 'Choose VNPay or ZaloPay.', 422)
  }
  return { amount, method: body.method, key: validateUuid(body?.idempotencyKey) }
}
export const safeHttps = value => {
  let url
  try { url = new URL(value) } catch { walletError('INVALID_GATEWAY_URL', 'Invalid payment gateway URL.', 503) }
  if (url.protocol !== 'https:') walletError('INVALID_GATEWAY_URL', 'Payment gateway requires HTTPS.', 503)
  return url.toString()
}
export function requireGateway(key) {
  const value = process.env[key]?.trim()
  if (!value) walletError('GATEWAY_NOT_CONFIGURED', `${key} is not configured.`, 503)
  return value
}
export function zaloCallbackId(orderId) {
  if (typeof orderId !== 'string' || !/^\d{6}_[0-9a-f]{32}$/.test(orderId)) return null
  const s = orderId.slice(7)
  const id = `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
  try { return validateUuid(id) } catch { return null }
}
