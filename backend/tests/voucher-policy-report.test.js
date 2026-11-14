import assert from 'node:assert/strict'
import test from 'node:test'
import {
  voucherPolicyErrors,voucherDiscount,bookingVoucherLimit,voucherFitsBooking,
} from '../src/modules/vouchers/voucher-policy.js'

const fixed = {discount_type:'FIXED_AMOUNT',discount_value:50000,minimum_order_amount:250000,maximum_discount:50000}
const percentage = {discount_type:'PERCENTAGE',discount_value:20,minimum_order_amount:0,maximum_discount:50000}

for (const [caseId,voucher,errorKey] of [
  ['UTCID01',fixed,null],
  ['UTCID02',percentage,null],
  ['UTCID03',{...percentage,discount_value:21},'discount_value'],
  ['UTCID04',{...fixed,discount_value:50001},'discount_value'],
  ['UTCID05',{...fixed,minimum_order_amount:249999},'minimum_order_amount'],
  ['UTCID06',{...fixed,maximum_discount:50001},'maximum_discount'],
  ['UTCID07',{...fixed,discount_type:'OTHER'},'discount_type'],
  ['UTCID08',{...fixed,minimum_order_amount:-1},'minimum_order_amount'],
]) {
  test(`F233 ${caseId} checks voucher policy`, () => {
    const errors = voucherPolicyErrors(voucher)
    if (errorKey===null) assert.deepEqual(errors,{})
    else assert.equal(typeof errors[errorKey],'string')
  })
}

for (const [caseId,voucher,amount,expected] of [
  ['UTCID01',fixed,250000,50000],
  ['UTCID02',fixed,249999,0],
  ['UTCID03',fixed,0,0],
  ['UTCID04',percentage,300000,50000],
  ['UTCID05',percentage,100000,20000],
  ['UTCID06',{...fixed,minimum_order_amount:0},10000,10000],
]) {
  test(`F234 ${caseId} calculates the actual voucher discount`, () => {
    assert.equal(voucherDiscount(voucher,amount),expected)
  })
}

for (const [caseId,amount,rate,expected] of [
  ['UTCID01',250000,null,50000],
  ['UTCID02',300000,0.1,30000],
  ['UTCID03',300000,0.3,50000],
  ['UTCID04',100000,0.2,20000],
  ['UTCID05',100000,0,0],
]) {
  test(`F235 ${caseId} limits voucher value to commission`, () => {
    assert.equal(bookingVoucherLimit(amount,rate),expected)
  })
}

for (const [caseId,voucher,amount,rate,expected] of [
  ['UTCID01',fixed,250000,0.2,true],
  ['UTCID02',fixed,250000,0.1,false],
  ['UTCID03',fixed,200000,0.2,false],
  ['UTCID04',{...fixed,discount_value:100000},500000,0.2,false],
  ['UTCID05',fixed,300000,0.2,true],
]) {
  test(`F236 ${caseId} checks voucher fit against booking commission and policy`, () => {
    assert.equal(voucherFitsBooking(voucher,amount,rate),expected)
  })
}
