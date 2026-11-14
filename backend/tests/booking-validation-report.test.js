import assert from 'node:assert/strict'
import test from 'node:test'
import { validateBookingQuery } from '../src/modules/bookings/booking.validation.js'

const id = '12345678-1234-1234-1234-123456789012'
for (const [caseId,query,valid,expected] of [
  ['UTCID01',{},true,{page:1,limit:10,search:'',status:'ALL',service:'',month:''}],
  ['UTCID02',{search:'  vệ sinh  '},true,{search:'vệ sinh'}],
  ['UTCID03',{page:1000000,limit:100},true,{page:1000000,limit:100}],
  ['UTCID04',{search:'a'.repeat(150)},true,{search:'a'.repeat(150)}],
  ['UTCID05',{month:'2026-11',status:'COMPLETED',service:id},true,{month:'2026-11',status:'COMPLETED',service:id}],
  ['UTCID06',{page:0},false],
  ['UTCID07',{limit:101},false],
  ['UTCID08',{search:'a'.repeat(151)},false],
  ['UTCID09',{status:'UNKNOWN'},false],
  ['UTCID10',{month:'2026-13'},false],
  ['UTCID11',{service:'bad'},false],
  ['UTCID12',{page:1000001},false],
]) {
  test(`F048 ${caseId} validates booking list query`, () => {
    if (!valid) assert.throws(() => validateBookingQuery(query),{status:422})
    else assert.deepEqual(validateBookingQuery(query),{page:1,limit:10,search:'',status:'ALL',service:'',month:'',...expected})
  })
}
