import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { TechnicianMutations } from '../src/modules/technicians/technician.mutations.js'
import { TechnicianPortalRepository } from '../src/modules/technician-portal/technician-portal.repository.js'

test('technician administration is atomic and preserves eligibility and review history', {skip:process.env.RUN_TECHNICIAN_DB_TESTS!=='1'}, async()=>{
  const client=await pool.connect()
  await client.query('BEGIN')
  const audits=[]
  const service=new TechnicianMutations({audit:event=>audits.push(event),transaction:async work=>{
    await client.query('SAVEPOINT admin_test')
    try{const result=await work(client);await client.query('RELEASE SAVEPOINT admin_test');return result}
    catch(error){await client.query('ROLLBACK TO SAVEPOINT admin_test');throw error}
  }})
  try{
    const actor=(await client.query("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='ADMIN' LIMIT 1")).rows[0].id
    const pending=(await client.query("SELECT t.*,u.full_name,u.phone FROM technician_profiles t JOIN users u ON u.id=t.user_id WHERE t.verification_status='PENDING' ORDER BY t.id LIMIT 1")).rows[0]
    assert.ok(pending,'A pending demo profile is required')
    await client.query(`UPDATE technician_profiles SET is_active=true,availability_status='ONLINE',
      identity_number=COALESCE(identity_number,$2),
      identity_front_url=COALESCE(identity_front_url,'https://example.com/test-front.jpg'),
      identity_back_url=COALESCE(identity_back_url,'https://example.com/test-back.jpg') WHERE id=$1`,
      [pending.id, Date.now().toString().slice(-12)])
    await client.query("UPDATE users SET status='ACTIVE' WHERE id=$1",[pending.user_id])
    await client.query('UPDATE technician_accounts SET is_receiving_jobs_allowed=true WHERE technician_id=$1',[pending.id])
    assert.equal((await client.query('SELECT can_recommend_technician($1) AS allowed',[pending.id])).rows[0].allowed,false)
    const approved=await service.verification(pending.id,{status:'VERIFIED',reason:null},actor)
    assert.equal(approved.reviewed_by_id,actor)
    assert.ok(approved.reviewed_at)
    assert.equal((await client.query('SELECT can_recommend_technician($1) AS allowed',[pending.id])).rows[0].allowed,true)
    await assert.rejects(service.verification(pending.id,{status:'REJECTED',reason:'Missing identity details'},actor),{status:409})
    await service.update(pending.id,{full_name:pending.full_name,phone:pending.phone,qualification_level:'EXPERT',years_experience:7,bio:'Test only'},actor)
    assert.equal((await client.query('SELECT years_experience FROM technician_profiles WHERE id=$1',[pending.id])).rows[0].years_experience,7)
    const bookings=(await client.query("SELECT id FROM bookings b WHERE NOT EXISTS (SELECT 1 FROM booking_technicians j WHERE j.booking_id=b.id AND j.status IN ('SELECTED','ACCEPTED')) LIMIT 4")).rows
    assert.equal(bookings.length,4)
    await client.query("INSERT INTO booking_technicians(booking_id,technician_id,status,requested_at) VALUES($1,$2,'ACCEPTED',CURRENT_TIMESTAMP)",[bookings[0].id,pending.id])
    assert.equal((await client.query('SELECT can_recommend_technician($1) AS allowed',[pending.id])).rows[0].allowed,false)
    await client.query('SAVEPOINT capacity_test')
    await assert.rejects(client.query("INSERT INTO booking_technicians(booking_id,technician_id,status,requested_at) VALUES($1,$2,'ACCEPTED',CURRENT_TIMESTAMP)",[bookings[3].id,pending.id]))
    await client.query('ROLLBACK TO SAVEPOINT capacity_test')
    const skill=(await client.query(`SELECT s.id FROM skills s
      JOIN services v ON v.id=s.service_id JOIN service_categories c ON c.id=v.category_id
      WHERE s.is_active AND s.deleted_at IS NULL AND v.is_active AND v.deleted_at IS NULL
        AND c.is_active AND c.deleted_at IS NULL LIMIT 1`)).rows[0]
    await service.skills(pending.id,{skills:[{skill_id:skill.id,ac_brand_id:null,skill_level:'EXPERT'}]},actor)
    await assert.rejects(service.skills(pending.id,{skills:[]},actor),{status:422,code:'SKILL_REQUIRED'})
    await assert.rejects(service.skills(pending.id,{skills:[{skill_id:'00000000-0000-0000-0000-000000000000',ac_brand_id:null,skill_level:'EXPERT'}]},actor),{status:422})
    assert.equal((await client.query('SELECT count(*)::int AS count FROM technician_skills WHERE technician_id=$1',[pending.id])).rows[0].count,1)
    await assert.rejects(service.deactivate(pending.id,actor),{status:409,code:'TECHNICIAN_HAS_ACTIVE_JOB'})
    assert.equal((await client.query('SELECT is_active FROM technician_profiles WHERE id=$1',[pending.id])).rows[0].is_active,true)
    await client.query("UPDATE booking_technicians SET status='COMPLETED' WHERE booking_id=$1 AND technician_id=$2",[bookings[0].id,pending.id])
    await service.deactivate(pending.id,actor)
    assert.equal((await client.query('SELECT can_recommend_technician($1) AS allowed',[pending.id])).rows[0].allowed,false)
    assert.equal((await client.query('SELECT status FROM users WHERE id=$1',[pending.user_id])).rows[0].status,'ACTIVE')
    await service.activate(pending.id,actor)
    assert.equal((await client.query('SELECT status FROM users WHERE id=$1',[pending.user_id])).rows[0].status,'ACTIVE')
    assert.equal((await client.query('SELECT is_active FROM technician_profiles WHERE id=$1',[pending.id])).rows[0].is_active,true)
    assert.equal((await client.query('SELECT availability_status FROM technician_profiles WHERE id=$1',[pending.id])).rows[0].availability_status,'ONLINE')
    await client.query("UPDATE users SET status='LOCKED' WHERE id=$1",[pending.user_id])
    await assert.rejects(service.activate(pending.id,actor),{status:409})
    const portal = new TechnicianPortalRepository({ transaction: service.transaction, queryable: client })
    const certificateInput = {
      certificate_name: 'Technical Certificate',
      issued_by: 'Test Institute',
      certificate_number: randomUUID().slice(0, 24),
      issued_date: '2020-01-01',
      expiry_date: null,
      document_url: 'https://example.com/test-certificate.jpg',
    }
    const certificate = await portal.addCertification(pending.user_id, certificateInput)
    const submittedAt = certificate.submitted_at.toISOString()
    await service.certification(certificate.id,{status:'REJECTED',reason:'Unreadable certificate document',expected_updated_at:submittedAt},actor)
    const rejected=(await client.query('SELECT * FROM technician_certifications WHERE id=$1',[certificate.id])).rows[0]
    assert.equal(rejected.reviewed_by_id,actor)
    assert.equal(rejected.rejection_reason,'Unreadable certificate document')
    await assert.rejects(service.certification(certificate.id,{status:'VERIFIED',reason:null,expected_updated_at:submittedAt},actor),{status:409})
    const resubmitted = await portal.resubmitCertification(pending.user_id, certificate.id, {
      ...certificateInput,
      document_url: 'https://example.com/clear-certificate.jpg',
    })
    assert.equal(resubmitted.verification_status, 'PENDING')
    assert.equal(resubmitted.certificate_number, certificate.certificate_number)
    const verifiedCertificate=await service.certification(certificate.id,{status:'VERIFIED',reason:null,expected_updated_at:resubmitted.submitted_at.toISOString()},actor)
    assert.equal(verifiedCertificate.verification_status,'VERIFIED')
    assert.equal(verifiedCertificate.reviewed_by_id,actor)
    const submissions=(await client.query('SELECT verification_status FROM technician_certification_submissions WHERE certification_id=$1 ORDER BY submission_number',[certificate.id])).rows
    assert.deepEqual(submissions.map(row => row.verification_status), ['REJECTED', 'VERIFIED'])
    assert.ok(audits.some(event=>event.action==='APPROVE_TECHNICIAN'))
    assert.equal(audits.some(event => Object.hasOwn(event.before ?? {}, 'identity_number') ||
      Object.hasOwn(event.after ?? {}, 'identity_number')), false)
  }finally{await client.query('ROLLBACK');client.release();await pool.end()}
})
