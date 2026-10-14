import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { TechnicianMutations } from '../src/modules/technicians/technician.mutations.js'

test('service areas preserve database rules atomically', {skip:process.env.RUN_BOOKING_DB_TESTS !== '1'}, async () => {
  const client = await pool.connect(), audits = []
  await client.query('BEGIN')
  const transaction = async work => {
    await client.query('SAVEPOINT feature_test')
    try {const result=await work(client);await client.query('RELEASE SAVEPOINT feature_test');return result}
    catch(err){await client.query('ROLLBACK TO SAVEPOINT feature_test');throw err}
  }
  const technicians = new TechnicianMutations({transaction,audit:event => audits.push(event)})
  try {
    const actor = (await client.query("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='ADMIN' LIMIT 1")).rows[0].id
    const tech = (await client.query("SELECT id FROM technician_profiles WHERE verification_status='VERIFIED' LIMIT 1")).rows[0].id
    await technicians.areas(tech,{areas:[{city:'Thành phố Cần Thơ',ward:'Phường Cái Răng'}]},actor)
    await assert.rejects(technicians.areas(tech,{areas:[]},actor),{status:422,code:'AREA_REQUIRED'})
    assert.deepEqual((await client.query('SELECT city,ward FROM technician_areas WHERE technician_id=$1',[tech])).rows,[{city:'Thành phố Cần Thơ',ward:'Phường Cái Răng'}])
    await assert.rejects(technicians.areas(tech,{areas:[{city:'Other city',ward:'Valid ward'},{city:'Other city',ward:''}]},actor))
    assert.equal((await client.query('SELECT ward FROM technician_areas WHERE technician_id=$1',[tech])).rows[0].ward,'Phường Cái Răng')
    assert.ok(audits.some(event => event.action==='UPDATE_TECHNICIAN_SERVICE_AREAS'))
  } finally {await client.query('ROLLBACK');client.release();await pool.end()}
})
