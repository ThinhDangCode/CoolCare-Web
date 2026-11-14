import assert from 'node:assert/strict'
import test from 'node:test'
import { validateReviewInput, validateReviewUpdateInput } from '../src/modules/reviews/review.validation.js'
import { ReviewService } from '../src/modules/reviews/review.service.js'
import { ReviewRepository } from '../src/modules/reviews/review.repository.js'

const bookingId = '12345678-1234-1234-1234-123456789012'
const spaced = '  Dịch vụ tốt  '
const cases = [
  ['UTCID01', 1, spaced, true, 'Dịch vụ tốt'],
  ['UTCID02', 3, spaced, true, 'Dịch vụ tốt'],
  ['UTCID03', 5, spaced, true, 'Dịch vụ tốt'],
  ['UTCID04', 3, '', true, null],
  ['UTCID05', 0, spaced, false],
  ['UTCID06', 6, spaced, false],
  ['UTCID07', 2.5, spaced, false],
  ['UTCID08', 3, 'a'.repeat(1001), false],
  ['UTCID09', 3, 'a'.repeat(1000), true, 'a'.repeat(1000)],
]

for (const [id, rating, comment, valid, expectedComment] of cases) {
  test(`F026 ${id} validates review update`, () => {
    const body = {rating,comment}
    if (!valid) assert.throws(() => validateReviewUpdateInput(body), {status:422})
    else assert.deepEqual(validateReviewUpdateInput(body), {rating,comment:expectedComment})
  })
}

const creation = [
  ...cases.slice(0,8),
  ['UTCID09', 3, spaced, false, null, 'bad'],
  ['UTCID10', 3, 'a'.repeat(1000), true, 'a'.repeat(1000)],
]
for (const [id, rating, comment, valid, expectedComment, explicitBookingId] of creation) {
  test(`F025 ${id} validates review creation`, () => {
    const body = {booking_id:explicitBookingId ?? bookingId,rating,comment}
    if (!valid) assert.throws(() => validateReviewInput(body), {status:422})
    else assert.deepEqual(validateReviewInput(body), {
      booking_id:bookingId,rating,comment:expectedComment,
    })
  })
}

const serviceCases = [
  ['F138','listBookings',['customer-id']],
  ['F139','create',['customer-id',{booking_id:bookingId,rating:5,comment:'Good'}]],
  ['F140','update',['customer-id','review-id',{rating:3,comment:null}]],
  ['F141','remove',['customer-id','review-id']],
]
for (const [sheet,method,args] of serviceCases) {
  for (const [caseId,response] of [
    ['UTCID01',{id:'review-id'}],
    ['UTCID02',null],
    ['UTCID03',new Error('repository failed')],
  ]) {
    test(`${sheet} ${caseId} delegates review operation`, async () => {
      const calls=[]
      const repository={[method]:(...received)=>{
        calls.push(received)
        if(response instanceof Error)throw response
        return response
      }}
      const action=()=>new ReviewService(repository)[method](...args)
      if(response instanceof Error)await assert.rejects(async()=>action(),response)
      else assert.deepEqual(await action(),response)
      assert.deepEqual(calls,[args])
    })
  }
}

for (const [caseId,comment,expectedSuffix] of [
  ['UTCID01','Good service',': Good service'],
  ['UTCID02',null,'.'],
]) {
  test(`F247 ${caseId} notifies the assigned technician`, async () => {
    const queries=[]
    const repository=new ReviewRepository({transaction:async work=>work({
      query:async(sql,params)=>{
        queries.push({sql,params})
        if(sql.includes('FROM customer_profiles'))return {rows:[{id:'customer-id'}]}
        if(sql.includes('SELECT b.id,b.booking_code'))return {rows:[{
          id:bookingId,booking_code:'BK-001',status:'COMPLETED',technician_id:'technician-id',
        }]}
        if(sql.includes('INSERT INTO reviews'))return {rows:[{id:'review-id',rating:5,comment}]}
        return {rows:[]}
      },
    })})
    const result=await repository.create('user-id',{booking_id:bookingId,rating:5,comment})
    assert.equal(result.id,'review-id')
    const notice=queries.find(({sql})=>sql.includes('INSERT INTO notifications'))
    assert.ok(notice)
    assert.equal(notice.params[0],'technician-id')
    assert.equal(notice.params[1],`Bạn nhận được đánh giá 5/5 sao cho booking BK-001${expectedSuffix}`)
    assert.equal(notice.params[2],bookingId)
  })
}
