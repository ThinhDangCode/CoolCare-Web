import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateCreateBookingBody } from '../src/modules/customer-bookings/customer-booking.validation.js'
import { validateAcceptDeclineJobRequest } from '../src/modules/technician-portal/accept-decline-job-request.validation.js'
import { validatedTopup, vnpSign, hmac, secureSame, safeHttps } from '../src/modules/technician-wallet/wallet.domain.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = p => readFileSync(path.join(root, p), 'utf8')
const id1 = '11111111-1111-4111-8111-111111111111'
const id2 = '22222222-2222-4222-8222-222222222222'
const future = () => new Date(Date.now() + 86400000 * 7).toISOString()
const booking = (change = {}) => ({customerAddressId:id1,recipientName:'Khach Test',recipientPhone:'0900000000',scheduledAt:future(),units:[{serviceIds:[id2]}],...change})
const invalid = (fn, code = 'VALIDATION_ERROR') => assert.throws(fn, e => e?.status === 422 && e?.code === code)

test('B01 booking hợp lệ: dữ liệu cơ bản qua validation', () => {
  const result = validateCreateBookingBody(booking())
  assert.equal(result.units.length,1)
  assert.equal(result.units[0].serviceIds[0],id2)
})
test('B02 booking: không cho ngày quá khứ', () => invalid(() => validateCreateBookingBody(booking({scheduledAt:'2020-01-01T10:00:00Z'}))))
test('B03 booking: địa chỉ không hợp lệ', () => invalid(() => validateCreateBookingBody(booking({customerAddressId:'invalid'}))))
test('B04 booking: số điện thoại không hợp lệ', () => invalid(() => validateCreateBookingBody(booking({recipientPhone:'123'}))))
test('B05 booking: không có điều hòa/dịch vụ', () => {
  invalid(() => validateCreateBookingBody(booking({units:[]})))
  invalid(() => validateCreateBookingBody(booking({units:[{serviceIds:[]}]})))
})
test('B06 booking: không cho duplicate service trong cùng AC', () => invalid(() => validateCreateBookingBody(booking({units:[{serviceIds:[id2,id2]}]}))))
test('B07 booking: không nhận quá 20 máy', () => invalid(() => validateCreateBookingBody(booking({units:Array.from({length:21},()=>({serviceIds:[id2]}))}))))
test('B08 booking: không cho client xác nhận acModelId', () => invalid(() => validateCreateBookingBody(booking({units:[{serviceIds:[id2],acModelId:id1}]}))))
test('J01 nhận việc: action ACCEPT hợp lệ', () => assert.deepEqual(validateAcceptDeclineJobRequest({action:'ACCEPT'}),{action:'ACCEPT',reason:null}))
test('J02 từ chối việc: lưu lý do đã trim', () => assert.deepEqual(validateAcceptDeclineJobRequest({action:'DECLINE',reason:'  Ban  '}),{action:'DECLINE',reason:'Ban'}))
test('J03 nhận việc: không cho reason khi ACCEPT', () => invalid(() => validateAcceptDeclineJobRequest({action:'ACCEPT',reason:'abc'})))
test('J04 nhận việc: không cho action giả hoặc field lạ', () => {
  invalid(() => validateAcceptDeclineJobRequest({action:'FINISH'}))
  invalid(() => validateAcceptDeclineJobRequest({action:'DECLINE',status:'ACCEPTED'}))
})
test('P01 VNPay: chữ ký đổi khi payload bị sửa', () => {
  const data={vnp_Amount:'10000000',vnp_TxnRef:'TEST123'}
  const signed=hmac('test-secret',vnpSign(data),'sha512')
  assert.ok(secureSame(signed,hmac('test-secret',vnpSign(data),'sha512')))
  assert.equal(secureSame(signed,hmac('test-secret',vnpSign({...data,vnp_Amount:'20000000'}),'sha512')),false)
})
test('P02 payment URL: chặn http/script URL', () => {
  assert.throws(()=>safeHttps('http://untrusted.example/checkout'))
  assert.throws(()=>safeHttps('javascript:alert(1)'))
  assert.match(safeHttps('https://example.com/checkout'),/^https:/)
})
test('W01 nạp ví: chỉ chấp nhận đúng phương thức', () => {
  assert.equal(validatedTopup({amount:100000,method:'VNPAY',idempotencyKey:randomUUID()}).method,'VNPAY')
  assert.equal(validatedTopup({amount:100000,method:'ZALOPAY',idempotencyKey:randomUUID()}).method,'ZALOPAY')
  assert.throws(()=>validatedTopup({amount:100000,method:'CASH',idempotencyKey:randomUUID()}))
})
test('W02 nạp ví: số tiền không hợp lệ', () => {
  for (const amount of [0,-1,200000.5,50000001]) assert.throws(()=>validatedTopup({amount,method:'VNPAY',idempotencyKey:randomUUID()}))
})
test('W03 nạp ví: bắt buộc idempotency UUID', () => assert.throws(()=>validatedTopup({amount:100000,method:'VNPAY',idempotencyKey:'bad'})))

test('S01 code booking: transaction và giá do backend tính, không lấy giá client', () => {
  const code=src('src/modules/customer-bookings/customer-booking.service.js')
  assert.match(code,/withTransaction\(/)
  assert.match(code,/findActiveServices/)
  assert.match(code,/service\.base_price/)
  assert.match(code,/createBooking\(/)
})
test('S02 code nhận việc: transaction row lock để giảm race condition', () => {
  const code=src('src/modules/technician-portal/accept-decline-job-request.repository.js')
  assert.match(code,/FOR UPDATE/i)
  assert.match(code,/TECHNICIAN_SELECTED/)
})
test('S03 code thanh toán: có trạng thái đang xử lý, chống tạo payment hoạt động trùng', () => {
  const code=src('src/modules/payments/customer-payment.routes.js')
  for(const state of ['PENDING','PROCESSING','SUCCESS']) assert.ok(code.includes(state))
  assert.match(code,/idempotency_key/)
})
test('S04 code rút tiền: phải giới hạn số tiền, phương thức và key', () => {
  const code=src('src/modules/technician-wallet/wallet.routes.js')
  assert.match(code,/amount < 100000 \|\| amount > 50000000/)
  assert.match(code,/bankName !== 'ZaloPay'/)
  assert.match(code,/idempotencyKey/)
})
test('S05 code ví: repo có lock và idempotency cho rút tiền', () => {
  const code=src('src/modules/technician-wallet/wallet.repository.js')
  assert.match(code,/createMockWithdrawal/)
  assert.match(code,/FOR UPDATE/i)
  assert.match(code,/idempotency_key/)
})
