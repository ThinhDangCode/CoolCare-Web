import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'

import { env } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { hmac, vnpSign, zaloOrderId } from '../src/modules/technician-wallet/wallet.domain.js'
import {
  createTechnicianWalletCallbackRouter,
  createTechnicianWalletRouter,
} from '../src/modules/technician-wallet/wallet.routes.js'

test('sandbox checkout and signed callbacks preserve amount, ownership and idempotency', async () => {
  const config = {
    VNPAY_TMN_CODE: 'sandbox-merchant',
    VNPAY_HASH_SECRET: 'sandbox-vnpay-secret',
    VNPAY_PAY_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    TOPUP_VNPAY_RETURN_URL: 'https://example.com/api/technician-wallet/callbacks/vnpay',
    ZALOPAY_APP_ID: '2553',
    ZALOPAY_KEY1: 'sandbox-zalo-key1',
    ZALOPAY_KEY2: 'sandbox-zalo-key2',
    ZALOPAY_CREATE_URL: 'https://sb-openapi.zalopay.vn/v2/create',
    TOPUP_ZALOPAY_CALLBACK_URL: 'https://example.com/api/technician-wallet/callbacks/zalopay',
  }
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]))
  Object.assign(process.env, config)

  const topups = new Map()
  const settlements = []
  const repository = {
    async create(_userId, input) {
      const row = {
        id: randomUUID(),
        topup_code: 'TU-TEST',
        amount: input.amount,
        method: input.method,
        payment_status: 'PENDING',
        created_at: new Date().toISOString(),
      }
      topups.set(row.id, row)
      return row
    },
    async getById(id) { return topups.get(id) ?? null },
    async markProcessing(id) {
      const row = topups.get(id)
      if (row?.payment_status !== 'PENDING') return false
      row.payment_status = 'PROCESSING'
      return true
    },
    async settle(id, method, reference) {
      const row = topups.get(id)
      if (!row || row.method !== method || ['FAILED', 'CANCELLED'].includes(row.payment_status)) return false
      if (row.payment_status === 'SUCCESS') return true
      row.payment_status = 'SUCCESS'
      settlements.push({ id, method, reference })
      return true
    },
    async failVerified(id, method) {
      const row = topups.get(id)
      if (!row || row.method !== method || row.payment_status === 'SUCCESS') return false
      row.payment_status = 'FAILED'
      return true
    },
  }
  const app = express()
  app.use(express.json())
  app.use('/api/technician-wallet/callbacks', createTechnicianWalletCallbackRouter(repository))
  app.use('/api/technician-wallet', createTechnicianWalletRouter(repository))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  const originalFetch = globalThis.fetch
  let gatewayRequest
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(config.ZALOPAY_CREATE_URL)) {
      gatewayRequest = Object.fromEntries(new URLSearchParams(init.body))
      return new Response(JSON.stringify({
        return_code: 1,
        order_url: 'https://sbgateway.zalopay.vn/test-checkout',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return originalFetch(input, init)
  }

  try {
    await new Promise(resolve => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api/technician-wallet`
    const token = jwt.sign({ role: 'CUSTOMER', purpose: 'access' }, env.jwtSecret, {
      subject: randomUUID(), expiresIn: '5m',
    })
    const create = async method => {
      const response = await fetch(`${base}/topups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 100000, method, idempotencyKey: randomUUID() }),
      })
      assert.equal(response.status, 201)
      return (await response.json()).data
    }

    const vnpay = await create('VNPAY')
    const checkout = new URL(vnpay.checkout.url)
    const unsigned = Object.fromEntries(checkout.searchParams)
    const checkoutSignature = unsigned.vnp_SecureHash
    delete unsigned.vnp_SecureHash
    assert.equal(unsigned.vnp_TxnRef, vnpay.topupId)
    assert.equal(unsigned.vnp_Amount, '10000000')
    assert.equal(checkoutSignature, hmac(config.VNPAY_HASH_SECRET, vnpSign(unsigned), 'sha512'))

    const vnpCallback = {
      vnp_TxnRef: vnpay.topupId,
      vnp_TmnCode: config.VNPAY_TMN_CODE,
      vnp_CurrCode: 'VND',
      vnp_Amount: '10000000',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: 'SANDBOX-REF-1',
    }
    const callbackUrl = new URL(`${base}/callbacks/vnpay`)
    Object.entries(vnpCallback).forEach(([key, value]) => callbackUrl.searchParams.set(key, value))
    callbackUrl.searchParams.set('vnp_SecureHash', 'bad-signature')
    assert.equal((await (await fetch(callbackUrl)).json()).RspCode, '97')
    assert.equal(settlements.length, 0)
    callbackUrl.searchParams.set('vnp_SecureHash', hmac(config.VNPAY_HASH_SECRET, vnpSign(vnpCallback), 'sha512'))
    assert.equal((await (await fetch(callbackUrl)).json()).RspCode, '00')
    assert.equal((await (await fetch(callbackUrl)).json()).RspCode, '02')
    assert.equal(settlements.length, 1)

    const zalopay = await create('ZALOPAY')
    assert.equal(gatewayRequest.amount, '100000')
    assert.equal(gatewayRequest.app_trans_id, zaloOrderId(topups.get(zalopay.topupId)))
    const macData = ['app_id', 'app_trans_id', 'app_user', 'amount', 'app_time', 'embed_data', 'item']
      .map(key => gatewayRequest[key]).join('|')
    assert.equal(gatewayRequest.mac, hmac(config.ZALOPAY_KEY1, macData))
    const callbackData = JSON.stringify({
      app_trans_id: gatewayRequest.app_trans_id,
      app_id: Number(config.ZALOPAY_APP_ID),
      amount: 100000,
      embed_data: gatewayRequest.embed_data,
      zp_trans_id: 'SANDBOX-REF-2',
    })
    const postCallback = async mac => (await (await fetch(`${base}/callbacks/zalopay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: callbackData, mac }),
    })).json())
    assert.equal((await postCallback('bad-signature')).return_code, -1)
    assert.equal(settlements.length, 1)
    assert.equal((await postCallback(hmac(config.ZALOPAY_KEY2, callbackData))).return_code, 1)
    assert.equal(settlements.length, 2)
  } finally {
    globalThis.fetch = originalFetch
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
