import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'

import { env } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { stripeWithdrawalRouter, stripeWebhook } from '../src/modules/stripe-withdrawals/routes.js'

test('Stripe webhook rejects an invalid signature and accepts a signed raw payload', async () => {
  const previous = process.env.STRIPE_WEBHOOK_SECRET
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_webhook_secret'
  const app = express()
  app.post('/webhook', express.raw({ type: 'application/json' }), stripeWebhook)
  const server = app.listen(0, '127.0.0.1')

  try {
    await new Promise(resolve => server.once('listening', resolve))
    const url = `http://127.0.0.1:${server.address().port}/webhook`
    const payload = JSON.stringify({ id: 'evt_test', type: 'account.updated' })
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
      .update(`${timestamp}.${payload}`).digest('hex')

    const invalid = await fetch(url, { method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${'0'.repeat(64)}` },
      body: payload })
    assert.equal(invalid.status, 400)

    const valid = await fetch(url, { method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
      body: payload })
    assert.equal(valid.status, 200)
    assert.deepEqual(await valid.json(), { received: true })
  } finally {
    if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = previous
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test('Stripe withdrawal route requires a technician login and validates amount before side effects', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/stripe-withdrawals', stripeWithdrawalRouter)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')

  try {
    await new Promise(resolve => server.once('listening', resolve))
    const url = `http://127.0.0.1:${server.address().port}/api/stripe-withdrawals/withdraw`
    const body = JSON.stringify({ amount: 99999, idempotencyKey: randomUUID() })
    const anonymous = await fetch(url, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body })
    assert.equal(anonymous.status, 401)

    const adminToken = jwt.sign({ role: 'ADMIN', purpose: 'access' }, env.jwtSecret,
      { subject: randomUUID(), expiresIn: '5m' })
    const admin = await fetch(url, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` }, body })
    assert.equal(admin.status, 403)

    const technicianToken = jwt.sign({ role: 'CUSTOMER', purpose: 'access' }, env.jwtSecret,
      { subject: randomUUID(), expiresIn: '5m' })
    const invalid = await fetch(url, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${technicianToken}` }, body })
    assert.equal(invalid.status, 422)
    assert.equal((await invalid.json()).error.code, 'INVALID_INPUT')
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
