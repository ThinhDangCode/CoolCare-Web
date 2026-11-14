import assert from 'node:assert/strict'
import test from 'node:test'
import {
  validateComplaintId,validateComplaintListQuery,validateCustomerComplaintQuery,
  validateComplaintSubmission,validateCompensationVoucher,
} from '../src/modules/complaints/complaint.validation.js'

const id = '12345678-1234-1234-1234-123456789012'

for (const [caseId,query,valid,expected] of [
  ['UTCID01',{},true,{page:1,limit:10,search:'',status:'ALL',type:'ALL',sortBy:'created_at',sortOrder:'desc'}],
  ['UTCID02',{page:0},false],
  ['UTCID03',{limit:101},false],
  ['UTCID04',{status:'UNKNOWN'},false],
  ['UTCID05',{limit:100},true,{limit:100}],
  ['UTCID06',{limit:0},false],
  ['UTCID07',{type:'BAD'},false],
  ['UTCID08',{sort_by:'private'},false],
  ['UTCID09',{search:'a'.repeat(151)},false],
]) {
  test(`F036 ${caseId} validates admin complaint filters`, () => {
    if (!valid) assert.throws(() => validateComplaintListQuery(query),{status:422})
    else assert.deepEqual(validateComplaintListQuery(query),{
      page:1,limit:10,search:'',status:'ALL',type:'ALL',sortBy:'created_at',sortOrder:'desc',...expected,
    })
  })
}

for (const [caseId,query,valid,expected] of [
  ['UTCID01',{},true,{page:1,limit:20,status:'ALL'}],
  ['UTCID02',{page:0},false],
  ['UTCID03',{limit:101},false],
  ['UTCID04',{status:'UNKNOWN'},false],
  ['UTCID05',{limit:50},true,{page:1,limit:50,status:'ALL'}],
  ['UTCID06',{limit:0},false],
  ['UTCID07',{limit:51},false],
  ['UTCID08',{extra:'Yes'},false],
  ['UTCID09',{page:1000000},true,{page:1000000,limit:20,status:'ALL'}],
  ['UTCID10',{page:1000001},false],
]) {
  test(`F037 ${caseId} validates customer complaint filters`, () => {
    if (!valid) assert.throws(() => validateCustomerComplaintQuery(query),{status:422})
    else assert.deepEqual(validateCustomerComplaintQuery(query),expected)
  })
}

const complaint = {
  booking_id:id,type:'SERVICE',subject:'Chất lượng dịch vụ',
  description:'Dịch vụ chưa được thực hiện đúng như thỏa thuận.',
}
for (const [caseId,body,valid] of [
  ['UTCID01',complaint,true],
  ['UTCID02',{...complaint,subject:'abcd'},false],
  ['UTCID03',{...complaint,description:'ngắn'},false],
  ['UTCID04',{...complaint,type:'BAD'},false],
  ['UTCID05',{...complaint,booking_id:'bad'},false],
]) {
  test(`F039 ${caseId} validates a complaint submission`, () => {
    if (!valid) assert.throws(() => validateComplaintSubmission(body),{status:422})
    else assert.deepEqual(validateComplaintSubmission(body),complaint)
  })
}

const compensation = {discount_value:50000,minimum_order_amount:250000,valid_days:30,notify_customer:true}
for (const [caseId,body,valid] of [
  ['UTCID01',compensation,true],
  ['UTCID02',{...compensation,discount_value:1,minimum_order_amount:5},true],
  ['UTCID03',{...compensation,discount_value:50001},false],
  ['UTCID04',{...compensation,discount_value:0},false],
  ['UTCID05',{...compensation,minimum_order_amount:249999},false],
  ['UTCID06',{...compensation,minimum_order_amount:undefined},false],
  ['UTCID07',{...compensation,valid_days:1},true],
  ['UTCID08',{...compensation,valid_days:365},true],
  ['UTCID09',{...compensation,valid_days:0},false],
  ['UTCID10',{...compensation,valid_days:366},false],
  ['UTCID11',{...compensation,notify_customer:'true'},false],
  ['UTCID12',{...compensation,notify_customer:false},true],
]) {
  test(`F040 ${caseId} validates a compensation voucher`, () => {
    if (!valid) assert.throws(() => validateCompensationVoucher(body),{status:422})
    else assert.deepEqual(validateCompensationVoucher(body),body)
  })
}

for (const [caseId,value,valid] of [
  ['UTCID01',id,true],['UTCID02','bad',false],['UTCID03',undefined,false],
]) {
  test(`F066 ${caseId} validates a complaint ID`, () => {
    if (valid) assert.equal(validateComplaintId(value),value)
    else assert.throws(() => validateComplaintId(value),{status:422,code:'INVALID_ID'})
  })
}
