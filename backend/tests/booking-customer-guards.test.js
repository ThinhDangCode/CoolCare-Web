import test from 'node:test'
import assert from 'node:assert/strict'
import { BookingDetailService } from '../src/modules/customer-bookings/booking-detail.service.js'
const user='12345678-1234-1234-1234-123456789012', id='22345678-1234-1234-1234-123456789012'
function fixture({arrived=false,overlap=false}={}) {
  const calls=[]
  const booking={id,customer_id:'customer',status:'ACCEPTED',scheduled_at:'2000-01-01T00:00:00Z',booking_code:'BK1'}
  const db={async query(sql,params){
    calls.push(sql)
    if(sql.includes('pg_advisory_xact_lock'))return {rowCount:1,rows:[]}
    if(sql.includes('scheduled_at BETWEEN'))return {rowCount:overlap?1:0,rows:[]}
    if(sql.includes('FROM payments'))return {rowCount:0,rows:[]}
    if(sql.includes('FROM booking_status_history'))return {rowCount:arrived?1:0,rows:[]}
    throw Error(`Unexpected query ${sql}`)
  }}
  const repository={async findOwnedBooking(){return booking},async findAcceptedAssignment(){return {id:'assignment',technician_id:'tech'}},async cancelBooking(){throw Error('Must not cancel')}}
  return {service:new BookingDetailService(repository,async work=>work(db)),calls}
}
test('customer cannot directly cancel after current technician confirms arrival',async()=>{
  const f=fixture({arrived:true});await assert.rejects(f.service.cancel(user,id,{reason:'Personal reason'}),{status:409,code:'TECHNICIAN_ALREADY_ARRIVED'});
  assert.ok(!f.calls.some(s=>/UPDATE|INSERT/.test(s)))
})
test('late reassignment rejects overlapping new schedule without changing booking or points',async()=>{
  const f=fixture({overlap:true});await assert.rejects(f.service.changeLateTechnician(user,id,{reason:'Technician did not arrive',scheduledAt:'2099-01-01T00:00:00Z'}),{status:409,code:'OVERLAPPING_BOOKING'});
  assert.ok(!f.calls.some(s=>/UPDATE|INSERT/.test(s)))
})
test('late reassignment rejects past schedule before any mutation',async()=>{
  const f=fixture();await assert.rejects(f.service.changeLateTechnician(user,id,{reason:'Technician did not arrive',scheduledAt:'2000-01-01T00:00:00Z'}),{status:422,code:'INVALID_REASSIGNMENT'});assert.equal(f.calls.length,0)
})

test('late reassignment reaching zero suspends only the old technician capability',async()=>{
  const calls=[];const booking={id,customer_id:'customer',status:'ACCEPTED',scheduled_at:'2000-01-01T00:00:00Z',booking_code:'BK1'}
  const repository={async findOwnedBooking(){return booking},async findAcceptedAssignment(){return {id:'assignment',technician_id:'tech',technician_user_id:'tech-user'}}}
  const db={async query(sql,params){
    calls.push(sql)
    if(sql.includes('AS remaining_points'))return {rows:[{remaining_points:0}]}
    if(sql.includes('SELECT id,user_id FROM technician_profiles'))return {rows:[{id:'tech',user_id:'tech-user'}]}
    if(sql.includes('UPDATE booking_technicians'))return {rowCount:1,rows:[{id:'assignment'}]}
    if(sql.includes('UPDATE technician_profiles'))return {rowCount:1,rows:[]}
    return {rowCount:0,rows:[]}
  }}
  const service=new BookingDetailService(repository,async work=>work(db))
  const result=await service.changeLateTechnician(user,id,{reason:'Technician did not arrive',scheduledAt:'2099-01-01T00:00:00Z'})
  assert.equal(result.status,'PENDING');assert.equal(result.penaltyPoints,2)
  assert.ok(calls.some(sql=>sql.includes('UPDATE technician_profiles')&&sql.includes('is_active=false')))
  assert.ok(calls.some(sql=>sql.includes('UPDATE technician_accounts')&&sql.includes('is_receiving_jobs_allowed=false')))
  assert.ok(!calls.some(sql=>/UPDATE users/i.test(sql)))
})
