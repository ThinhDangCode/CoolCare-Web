import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../../config/env.js'

const CODE_PREFIX = 'CMP-'

export function createComplaintCompensationCode(customerId, voucherId, secret = env.voucherSecret) {
  if (!secret) throw new Error('VOUCHER_SECRET is not configured.')
  const signature = createHmac('sha256', secret)
    .update(`${customerId}:${voucherId}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase()
  return `${CODE_PREFIX}${signature}`
}

export function isComplaintCompensationCode(code) {
  return String(code ?? '')
    .toUpperCase()
    .startsWith(CODE_PREFIX)
}

export function verifyComplaintCompensationCode(
  code,
  customerId,
  voucherId,
  secret = env.voucherSecret
) {
  const actual = Buffer.from(
    String(code ?? '')
      .trim()
      .toUpperCase()
  )
  const expected = Buffer.from(createComplaintCompensationCode(customerId, voucherId, secret))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
