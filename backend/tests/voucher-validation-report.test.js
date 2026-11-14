import assert from 'node:assert/strict'
import test from 'node:test'
import {
  validateVoucherBookingId,
  validateVoucherCode,
  validateVoucherId,
  validateVoucherInput,
  validateVoucherListQuery,
  validateVoucherStatus,
} from '../src/modules/vouchers/voucher.validation.js'

const id = '12345678-1234-1234-1234-123456789012'
const base = {
  code:'COOL10',name:'Discount',discount_type:'FIXED_AMOUNT',discount_value:50000,
  minimum_order_amount:250000,maximum_discount:50000,
  start_at:'2026-01-01T00:00:00Z',end_at:'2026-12-31T00:00:00Z',
}
const inputCases = [
  ['UTCID01',base,true],
  ['UTCID02',{...base,discount_type:'PERCENTAGE',discount_value:1},true],
  ['UTCID03',{...base,discount_type:'PERCENTAGE',discount_value:20},true],
  ['UTCID04',{...base,discount_type:'PERCENTAGE',discount_value:21},false],
  ['UTCID05',{...base,discount_value:50001},false],
  ['UTCID06',{...base,minimum_order_amount:249999},false],
  ['UTCID07',{...base,minimum_order_amount:250000},true],
  ['UTCID08',{...base,maximum_discount:50001},false],
  ['UTCID09',{...base,discount_value:1.5},false],
  ['UTCID10',{...base,discount_value:undefined},false],
  ['UTCID11',{...base,discount_type:'OTHER'},false],
  ['UTCID12',{...base,end_at:'2025-12-31T00:00:00Z'},false],
  ['UTCID13',{...base,extra:true},false],
  ['UTCID14',{...base,code:'  cool10  '},true],
]
for (const [caseId,body,valid] of inputCases) {
  test(`F027 ${caseId} validates voucher discount input`, () => {
    if (!valid) assert.throws(() => validateVoucherInput(body),{status:422})
    else {
      const result = validateVoucherInput(body)
      assert.equal(result.code,'COOL10')
      assert.equal(result.discount_value,body.discount_value)
      assert.equal(result.minimum_order_amount,body.minimum_order_amount)
    }
  })
}

for (const [caseId,code,expected] of [
  ['UTCID01','  cool10  ','COOL10'],
  ['UTCID02','ab',null],
  ['UTCID03','a'.repeat(21),null],
  ['UTCID04','a b',null],
  ['UTCID05','ABC','ABC'],
  ['UTCID06','A'.repeat(20),'A'.repeat(20)],
]) {
  test(`F028 ${caseId} validates voucher code`, () => {
    if (expected===null) assert.throws(() => validateVoucherCode({code}),{status:422})
    else assert.equal(validateVoucherCode({code}),expected)
  })
}

for (const [caseId,body,expected] of [
  ['UTCID01',{is_active:true},true],
  ['UTCID02',{is_active:'true'},null],
  ['UTCID03',{is_active:true,extra:'Yes'},null],
]) {
  test(`F029 ${caseId} validates voucher activation status`, () => {
    if (expected===null) assert.throws(() => validateVoucherStatus(body),{status:422})
    else assert.equal(validateVoucherStatus(body),expected)
  })
}

const listCases = [
  ['UTCID01',{},false,true,{page:1,limit:10,status:'ALL',sort:'NEWEST'}],
  ['UTCID02',{page:0},false,false],
  ['UTCID03',{limit:101},false,false],
  ['UTCID04',{status:'UNKNOWN'},false,false],
  ['UTCID05',{limit:100},false,true,{limit:100}],
  ['UTCID06',{limit:0},false,false],
  ['UTCID07',{search:'a'.repeat(150)},false,true,{search:'a'.repeat(150)}],
  ['UTCID08',{search:'a'.repeat(151)},false,false],
  ['UTCID09',{status:'USED',voucher_id:id,period:'THIS_MONTH',from_date:'2024-02-29',to_date:'2024-03-01'},true,true,
    {status:'USED',sort:undefined,voucherId:id,period:'THIS_MONTH',fromDate:'2024-02-29',toDate:'2024-03-01'}],
  ['UTCID10',{status:'USED',from_date:'2025-02-29'},true,false],
  ['UTCID11',{status:'USED',from_date:'2026-11-03',to_date:'2026-11-02'},true,false],
  ['UTCID12',{status:'Active'},false,false],
]
for (const [caseId,query,usages,valid,expected] of listCases) {
  test(`F032 ${caseId} validates voucher list filters`, () => {
    if (!valid) assert.throws(() => validateVoucherListQuery(query,usages),{status:422})
    else assert.deepEqual(validateVoucherListQuery(query,usages),{
      page:1,limit:10,search:'',status:'ALL',sort:'NEWEST',voucherId:undefined,
      voucherSearch:'',customerSearch:'',period:undefined,fromDate:undefined,toDate:undefined,
      ...expected,
    })
  })
}

for (const [sheet,validator] of [
  ['F068',validateVoucherBookingId],
  ['F069',validateVoucherId],
]) {
  for (const [caseId,value,valid] of [
    ['UTCID01',id,true],['UTCID02','bad',false],['UTCID03',undefined,false],
  ]) {
    test(`${sheet} ${caseId} validates a UUID`, () => {
      if (valid) assert.equal(validator(value),value)
      else assert.throws(() => validator(value),{code:'INVALID_ID'})
    })
  }
}
