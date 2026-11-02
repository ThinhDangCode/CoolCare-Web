import { createHmac, timingSafeEqual } from 'node:crypto'

const key = () => {
  const k = process.env.STRIPE_SECRET_KEY
  if (!k?.startsWith('sk_test_')) throw new Error('STRIPE_TEST_KEY_REQUIRED')
  return k
}

export async function stripe(path, data, { account, idempotencyKey, method = 'POST', version = 'v1', include } = {}) {
  if (!['v1', 'v2'].includes(version)) throw new Error('Invalid Stripe API version')
  const headers = { Authorization: `Bearer ${key()}` }
  if (version === 'v2') {
  headers['Stripe-Version'] =
    process.env.STRIPE_API_VERSION || '2026-10-28.endive'
}
  if (account) headers['Stripe-Account'] = account
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const url = new URL(`https://api.stripe.com/${version}/${path.replace(/^\/+/, '')}`)
  // Stripe v2 rejects the `include[]` syntax; indexes are required.
  if (include?.length) include.forEach((value, i) => url.searchParams.append(`include[${i}]`, value))
  let body
  if (data != null) {
    headers['Content-Type'] = version === 'v2' ? 'application/json' : 'application/x-www-form-urlencoded'
    body = version === 'v2' ? JSON.stringify(data) : new URLSearchParams(data).toString()
  }
  const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const e = new Error(json.error?.message || `Stripe HTTP ${response.status}`)
    e.stripeStatus = response.status
    e.stripeCode = json.error?.code
    throw e
  }
  return json
}

export function verifyStripeWebhook(raw, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret?.startsWith('whsec_') || !header || !Buffer.isBuffer(raw)) throw new Error('Webhook secret/signature/raw body missing')
  const fields = header.split(',').map(s => s.trim())
  const timestamp = fields.find(s => s.startsWith('t='))?.slice(2)
  const t = Number(timestamp)
  if (!timestamp || !Number.isSafeInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) throw new Error('Webhook timestamp invalid')
  const expected = createHmac('sha256', secret).update(`${t}.`).update(raw).digest()
  const valid = fields.filter(s => s.startsWith('v1=')).some(s => {
    const hex = s.slice(3)
    if (!/^[a-f0-9]{64}$/i.test(hex)) return false
    return timingSafeEqual(Buffer.from(hex, 'hex'), expected)
  })
  if (!valid) throw new Error('Invalid webhook signature')
  return JSON.parse(raw.toString('utf8'))
}