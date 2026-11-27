import test from 'node:test'
import assert from 'node:assert/strict'
import { warnLateArrivals } from '../src/modules/customer-bookings/late-arrival-warning.js'
import { adaptDatabaseQuery } from '../src/config/database-codebook-adapter.js'

function fixture(stage='15', {arrived=false, completed=false}={}) {
  const markers=new Set(), notices=[], calls=[]
  const row={booking_id:'booking',booking_code:'BK1',assignment_id:'assignment',customer_user_id:'customer',technician_user_id:'tech',warning_stage:stage}
  const db={async query(sql,params){
    calls.push(sql)
    if(sql.includes('FOR UPDATE OF b SKIP LOCKED')) {
      assert.match(sql,/b.status=2/);assert.match(sql,/bt.status=2/);assert.match(sql,/ARRIVED/)
      return {rows: arrived||completed||markers.has(`COOLCARE_LATE_V1:assignment:${row.warning_stage}`)?[]:[row]}
    }
    if(sql.includes('INSERT INTO booking_status_history')) {
      if(markers.has(params[2])) return {rowCount:0,rows:[]}
      markers.add(params[2]);return {rowCount:1,rows:[{}]}
    }
    if(sql.includes('INSERT INTO notifications')) {
      const converted=adaptDatabaseQuery(sql,params)
      assert.equal((converted.query.match(/,0,/g)||[]).length,2)
      notices.push(params);return {rowCount:2,rows:[]}
    }
    throw Error('Unexpected query')
  }}
  return {run:()=>warnLateArrivals(async work=>work(db)),row,notices,calls,markers}
}
test('15-minute warning and 30-minute reminder each notify both parties once, no penalty or cancellation',async()=>{
  const f=fixture();await f.run();await f.run();assert.equal(f.notices.length,1)
  f.row.warning_stage='30';await f.run();await f.run();assert.equal(f.notices.length,2)
  assert.match(f.notices[1][2],/đổi thợ/)
  assert.equal(f.markers.size,2)
  assert.ok(!f.calls.some(s=>/UPDATE bookings|UPDATE booking_technicians|technician_penalties/.test(s)))
})
test('arrived and completed jobs do not receive late warnings',async()=>{
  for(const f of [fixture('30',{arrived:true}),fixture('30',{completed:true})]){await f.run();assert.equal(f.notices.length,0)}
})
