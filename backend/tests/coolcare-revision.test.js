import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCreateBookingBody } from '../src/modules/customer-bookings/customer-booking.validation.js'
import { validateViewJobRequestsQuery } from '../src/modules/technician-portal/view-job-requests.validation.js'
import { AddressService } from '../src/modules/address/address.service.js'

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const booking = () => ({
  customerAddressId: uuid(1), recipientName: 'Test User',recipientPhone:'0912345678',
  scheduledAt: new Date(Date.now() + 24*3600*1000).toISOString(),
  units:[{ acBrandId:null, acModelId:null, description:'',serviceIds:[uuid(2)] }],
})

test('first booking accepts unknown AC brand/model', () => {
  const result=validateCreateBookingBody(booking())
  assert.equal(result.units[0].acBrandId,null)
  assert.equal(result.units[0].acModelId,null)
})
test('customer may select an AC brand without model', () => {
  const source=booking();source.units[0].acBrandId=uuid(3)
  const result=validateCreateBookingBody(source)
  assert.equal(result.units[0].acBrandId,uuid(3))
  assert.equal(result.units[0].acModelId,null)
})
test('customer cannot submit AC model, even when brand is known', () => {
  const source=booking(); source.units[0].acBrandId=uuid(3);source.units[0].acModelId=uuid(4)
  assert.throws(()=>validateCreateBookingBody(source),{code:'VALIDATION_ERROR'})
})
test('CLOSED filter is distinct from COMPLETED/HISTORY', () => {
  assert.equal(validateViewJobRequestsQuery({status:'CLOSED'}).status,'CLOSED')
  assert.equal(validateViewJobRequestsQuery({status:'COMPLETED'}).status,'COMPLETED')
  assert.equal(validateViewJobRequestsQuery({status:'HISTORY'}).status,'HISTORY')
  assert.throws(()=>validateViewJobRequestsQuery({status:'UNKNOWN'}))
})
test('Can Tho address only; city prefix/diacritics supported', () => {
  const address = new AddressService({})
  for (const city of ['Cần Thơ','Thành phố Cần Thơ','TP. Cần Thơ','Can Tho'])
    assert.doesNotThrow(()=>address.ensureCanTho({city}))
  for (const city of ['Hồ Chí Minh','Hà Nội','Vĩnh Long',''])
    assert.throws(()=>address.ensureCanTho({city}),{code:'OUTSIDE_SERVICE_AREA'})
})
