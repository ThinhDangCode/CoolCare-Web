import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileLockedBooking, reconcileExpiredRequests } from '../src/modules/customer-bookings/reconcile-technician-request.js'
import { adaptDatabaseQuery } from '../src/config/database-codebook-adapter.js'

// Stateful fake models the SQL predicates. This is not a live PostgreSQL test.
function fixture({status='PENDING', past=true, assignment=null, requestExpired=false}={}) {
  const booking={id:'booking-id', booking_code:'BK-1',status,scheduled_at:past?'2000-01-01':'2099-01-01'}
  const calls=[]
  const db={async query(sql,params){
    calls.push({sql,params})
    const adapted=adaptDatabaseQuery(sql,params)
    if(sql.includes('UPDATE bookings SET status=\'CANCELLED\'')) {
      assert.match(adapted.query,/status=10/)
      assert.match(adapted.query,/status IN \(0,1\)/)
      assert.match(adapted.query,/bt.status=2/)
      assert.match(sql,/cancelled_by_id=NULL/)
      if(past && ['PENDING','TECHNICIAN_SELECTED'].includes(booking.status) && assignment!=='ACCEPTED') {
        booking.status='CANCELLED'; return {rowCount:1,rows:[booking]}
      }
    } else if(sql.includes('UPDATE booking_technicians')) {
      if(assignment==='SELECTED' && (booking.status==='CANCELLED'||requestExpired)) { assignment='EXPIRED'; return {rowCount:1,rows:[{technician_id:'tech-id'}]} }
    } else if(sql.includes('SELECT 1 FROM booking_technicians') && !sql.includes('FOR UPDATE OF b SKIP LOCKED')) {
      return {rowCount:['SELECTED','ACCEPTED'].includes(assignment)?1:0,rows:[]}
    } else if(sql.includes('SELECT status FROM booking_technicians')) {
      return {rows:assignment?[{status:assignment}]:[]}
    } else if(sql.includes("UPDATE bookings SET status='PENDING'")) {
      booking.status='PENDING';return {rowCount:1,rows:[booking]}
    } else if(sql.includes('FOR UPDATE OF b SKIP LOCKED')) {
      assert.match(adapted.query,/b.status IN \(0,1\)/)
      assert.match(adapted.query,/bt.status=2/)
      return {rows:[booking]}
    }
    return {rowCount:0,rows:[]}
  }}
  return {booking,db,calls,assignment:()=>assignment}
}
for(const assignment of [null,'DECLINED','EXPIRED','CANCELLED']) {
  test(`expired pending with previous assignment ${assignment} cancels once`,async()=>{
    const f=fixture({assignment})
    assert.equal(await reconcileLockedBooking(f.db,f.booking),true)
    assert.equal(f.booking.status,'CANCELLED')
    assert.equal(await reconcileLockedBooking(f.db,f.booking),false)
    assert.equal(f.calls.filter(c=>c.sql.includes('INSERT INTO notifications')).length,1)
    assert.equal(f.calls.filter(c=>c.sql.includes('INSERT INTO booking_status_history')).length,1)
    assert.equal(f.calls.some(c=>c.sql.includes('technician_penalties')),false)
  })
}
test('selected request at appointment expires and closes booking',async()=>{
  const f=fixture({status:'TECHNICIAN_SELECTED',assignment:'SELECTED'})
  assert.equal(await reconcileLockedBooking(f.db,f.booking),true)
  assert.equal(f.booking.status,'CANCELLED');assert.equal(f.assignment(),'EXPIRED')
  assert.equal(f.calls.filter(c=>c.sql.includes('INSERT INTO notifications')).length,2)
})
test('10-minute request timeout before appointment returns to pending',async()=>{
  const f=fixture({status:'TECHNICIAN_SELECTED',past:false,assignment:'SELECTED',requestExpired:true})
  assert.equal(await reconcileLockedBooking(f.db,f.booking),true)
  assert.equal(f.booking.status,'PENDING');assert.equal(f.assignment(),'EXPIRED')
  assert.equal(f.calls.filter(c=>c.sql.includes('INSERT INTO notifications')).length,2)
  assert.equal(await reconcileLockedBooking(f.db,f.booking),false)
  assert.equal(f.calls.filter(c=>c.sql.includes('INSERT INTO notifications')).length,2)
})
test('future pending and accepted booking are not cancelled',async()=>{
  for(const options of [{past:false},{status:'ACCEPTED',assignment:'ACCEPTED'},{status:'WAITING_CONFIRMATION'},{status:'COMPLETED'},{status:'CANCELLED'}]) {
    const f=fixture(options)
    assert.equal(await reconcileLockedBooking(f.db,f.booking),false)
    assert.equal(f.calls.some(c=>c.sql.includes('INSERT INTO booking_status_history')),false)
  }
})
test('worker includes pending and locks booking rows',async()=>{
  const f=fixture({assignment:'CANCELLED'})
  assert.equal(await reconcileExpiredRequests(async work=>work(f.db)),1)
  assert.equal(f.booking.status,'CANCELLED')
})
test('history status parameters map to smallint for both cancellation outcomes',()=>{
  for(const [status,code] of [['PENDING',0],['CANCELLED',10]]) {
    const result=adaptDatabaseQuery(`INSERT INTO booking_status_history(booking_id,status,changed_by_id,note) VALUES($1,$2,$3,$4)`,['b',status,'u','note'])
    assert.equal(result.params[1],code)
  }
})

// Opt-in, uses an existing eligible fixture and always rolls back. Run only on a test DB.
test('live PostgreSQL: expired pending booking closes with audit fields', {skip:process.env.RUN_BOOKING_EXPIRY_DB_TESTS!=='1'}, async t=>{
  const {pool}=await import('../src/config/database.js')
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    const fixture=(await db.query(`SELECT b.id,b.status,b.scheduled_at FROM bookings b
      WHERE b.status='PENDING' AND NOT EXISTS (SELECT 1 FROM booking_technicians bt WHERE bt.booking_id=b.id AND bt.status IN ('SELECTED','ACCEPTED'))
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id=b.id AND p.payment_status='SUCCESS')
      LIMIT 1 FOR UPDATE OF b`)).rows[0]
    if(!fixture){t.skip('No eligible pending booking in test database');return}
    await db.query(`UPDATE bookings SET scheduled_at=clock_timestamp()-INTERVAL '1 minute' WHERE id=$1`,[fixture.id])
    assert.equal(await reconcileLockedBooking(db,fixture),true)
    const saved=(await db.query('SELECT status,cancelled_at,cancelled_by_id,cancellation_reason FROM bookings WHERE id=$1',[fixture.id])).rows[0]
    assert.equal(saved.status,'CANCELLED');assert.ok(saved.cancelled_at);assert.equal(saved.cancelled_by_id,null);assert.ok(saved.cancellation_reason)
    assert.equal(await reconcileLockedBooking(db,{...fixture,status:saved.status}),false)
  } finally {await db.query('ROLLBACK');db.release();await pool.end()}
})
