import test from 'node:test'
import assert from 'node:assert/strict'
import { validatedTopup, zaloOrderId, zaloCallbackId, vnpSign, hmac, secureSame, vnClock, safeHttps } from '../src/modules/technician-wallet/wallet.domain.js'

const key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const valid = (extra = {}) => ({amount:200000,method:'VNPAY',idempotencyKey:key,...extra})

test('technician top-up accepts approved gateways and integral amounts', () => {
  assert.deepEqual(validatedTopup(valid()),{amount:200000,method:'VNPAY',key})
  assert.equal(validatedTopup(valid({method:'ZALOPAY'})).method,'ZALOPAY')
})
test('rejects zero, negatives, fractions, dangerous values and excessively large amounts', () => {
  for (const amount of [0,-1,1000,9999,200000.5,Infinity,50000001,'not money']) {
    assert.throws(()=>validatedTopup(valid({amount})))
  }
})
test('rejects unrelated gateway and missing idempotency identity', () => {
  assert.throws(()=>validatedTopup(valid({method:'CASH'})))
  assert.throws(()=>validatedTopup(valid({idempotencyKey:'bad'})))
})
test('ZaloPay order id is stable and can be decoded from signed callback', () => {
  const row = {id:key,created_at:'2026-10-22T03:00:00.000Z'}
  const order = zaloOrderId(row)
  assert.match(order,/^\d{6}_[0-9a-f]{32}$/)
  assert.equal(zaloCallbackId(order),key)
  assert.equal(zaloOrderId(row),order)
  assert.equal(zaloCallbackId('bogus'),null)
})
test('Vietnam merchant clock uses GMT+7',()=>{
  assert.equal(vnClock('2026-10-21T18:00:00.000Z'),'20261022010000')
})
test('VNPay signature input has deterministic sorted parameters',()=>{
  const params={vnp_B:'A B',vnp_A:'a/b'}
  assert.equal(vnpSign(params),'vnp_A=a%2Fb&vnp_B=A+B')
  const sig=hmac('shared-secret',vnpSign(params),'sha512')
  assert.ok(secureSame(sig,hmac('shared-secret',vnpSign({...params}),'sha512')))
  assert.ok(!secureSame(sig,hmac('wrong',vnpSign(params),'sha512')))
})
test('rejects insecure gateway checkout URLs',()=>{
  assert.throws(()=>safeHttps('http://fake-gateway.test/checkout'))
  assert.throws(()=>safeHttps('javascript:alert(1)'))
  assert.match(safeHttps('https://example.test/checkout'),/^https:/)
})
