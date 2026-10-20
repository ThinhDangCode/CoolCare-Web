import { randomUUID } from 'node:crypto'
import { pool, withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { writeAdminAudit as writeManagementAudit } from '../audit/admin-audit.js'
import { validateTechnicianAreas } from './technician.validation.js'
import { remainingPointsSql } from './technician.points.js'

const notFound = () => new AppError(404,'TECHNICIAN_NOT_FOUND','Technician not found.')
export class TechnicianMutations {
  constructor({ transaction = withTransaction, audit = writeManagementAudit } = {}) { this.transaction=transaction;this.audit=audit }
  async lock(client,id) {
    // Repair legacy profiles that were created without the account required by
    // can_recommend_technician(). ON CONFLICT deliberately preserves wallet and
    // debt restrictions on accounts that already exist.
    await client.query(`INSERT INTO technician_accounts
      (id,technician_id,settlement_balance,is_receiving_jobs_allowed,created_at,updated_at)
      SELECT $2,$1,0,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      WHERE EXISTS (SELECT 1 FROM technician_profiles WHERE id=$1)
      ON CONFLICT (technician_id) DO NOTHING`,[id,randomUUID()])
    // Serialize administration with the existing job-assignment account lock.
    await client.query('SELECT id FROM technician_accounts WHERE technician_id=$1 FOR UPDATE',[id])
    const result=await client.query('SELECT * FROM technician_profiles WHERE id=$1 FOR UPDATE',[id])
    if (!result.rows.length) throw notFound()
    return result.rows[0]
  }
  async verification(id,input,actorId) {
    const data=await this.transaction(async client=>{
      const before=await this.lock(client,id)
      if(before.verification_status!=='PENDING') throw new AppError(409,'ALREADY_REVIEWED','This profile has already been reviewed. Refresh the page.')
      if(input.status==='VERIFIED' && (!before.identity_number || !before.identity_front_url || !before.identity_back_url)) throw new AppError(422,'INCOMPLETE_IDENTITY','Citizen ID and both identity documents are required for approval.')
      const result=await client.query(`UPDATE technician_profiles SET verification_status=$2::varchar,
        reviewed_by_id=$3,reviewed_at=CURRENT_TIMESTAMP,rejection_reason=$4,
        is_active=CASE WHEN $2='VERIFIED' THEN true ELSE false END,
        availability_status=CASE WHEN $2='VERIFIED' THEN availability_status ELSE 'OFFLINE' END,
        updated_at=CURRENT_TIMESTAMP WHERE id=$1
        RETURNING id,verification_status,reviewed_by_id,reviewed_at,is_active,availability_status`,[id,input.status,actorId,input.reason])
      // Do not enable receiving jobs here: wallet/debt restrictions are independent.
      return result.rows[0]
    })
    this.audit({actorId,action:input.status==='VERIFIED'?'APPROVE_TECHNICIAN':'REJECT_TECHNICIAN',entityType:'TECHNICIAN',entityId:id,before:{verification_status:'PENDING'},after:{verification_status:input.status}})
    return data
  }
  async certification(id,input,actorId) {
    const result=await this.transaction(async client=>{
      const found=await client.query('SELECT technician_id FROM technician_certifications WHERE id=$1',[id])
      if(!found.rows.length) throw new AppError(404,'CERTIFICATION_NOT_FOUND','Certification not found.')
      await this.lock(client,found.rows[0].technician_id)
      const before=(await client.query('SELECT *,expiry_date < CURRENT_DATE AS expired FROM technician_certifications WHERE id=$1 FOR UPDATE',[id])).rows[0]
      if(before.verification_status!=='PENDING' || new Date(before.updated_at).getTime()!==new Date(input.expected_updated_at).getTime()) throw new AppError(409,'STALE_CERTIFICATION','This certification has changed or has already been reviewed. Refresh the page.')
      if(input.status==='VERIFIED' && (!before.document_url || before.expired)) throw new AppError(422,'INVALID_CERTIFICATION','A valid document and a non-expired certificate are required for approval.')
      if(input.status==='VERIFIED') {
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1)) || chr(31) || lower(btrim($2)) || chr(31) || lower(btrim($3))))',
          [before.certificate_name,before.issued_by,before.certificate_number]
        )
        const duplicate=await client.query(`SELECT id FROM technician_certifications
          WHERE id<>$1
            AND lower(btrim(certificate_name))=lower(btrim($2))
            AND lower(btrim(issued_by))=lower(btrim($3))
            AND lower(btrim(certificate_number))=lower(btrim($4))
          LIMIT 1`,[id,before.certificate_name,before.issued_by,before.certificate_number])
        if(duplicate.rows.length) throw new AppError(409,'CERTIFICATE_NUMBER_ALREADY_VERIFIED','This certificate number already belongs to another certification.')
      }
      const row=(await client.query(`UPDATE technician_certifications SET verification_status=$2,reviewed_by_id=$3,
        reviewed_at=CURRENT_TIMESTAMP,rejection_reason=$4,verification_evidence=$5::jsonb,updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 RETURNING id,verification_status,reviewed_by_id,reviewed_at`,[id,input.status,actorId,input.reason,JSON.stringify(input.verification_evidence ?? null)])).rows[0]
      await client.query(`UPDATE technician_certification_submissions SET verification_status=$2,reviewed_by_id=$3,
        reviewed_at=CURRENT_TIMESTAMP,rejection_reason=$4 WHERE id=(SELECT id FROM technician_certification_submissions
        WHERE certification_id=$1 ORDER BY submission_number DESC LIMIT 1) AND verification_status='PENDING'`,[id,input.status,actorId,input.reason])
      return row
    })
    this.audit({actorId,action:input.status==='VERIFIED'?'APPROVE_CERTIFICATION':'REJECT_CERTIFICATION',entityType:'TECHNICIAN_CERTIFICATION',entityId:id,after:{verification_status:input.status}})
    return result
  }
  async update(id,input,actorId) {
    const event=await this.transaction(async client=>{
      const before=await this.lock(client,id)
      const fields=['qualification_level','years_experience','bio']
      const after=(await client.query(`UPDATE technician_profiles SET qualification_level=$2,years_experience=$3,
        bio=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING qualification_level,years_experience,bio`,[id,...fields.map(k=>input[k])])).rows[0]
      await client.query('UPDATE users SET full_name=$2,phone=$3::varchar,phone_verified_at=CASE WHEN phone IS DISTINCT FROM $3::varchar THEN NULL ELSE phone_verified_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$1',[before.user_id,input.full_name,input.phone])
      return {before:Object.fromEntries(fields.map(k=>[k,before[k]])),after}
    }).catch(error => {
      if (error.code === '23505') throw new AppError(409, 'DUPLICATE_PHONE', 'Phone number is already in use.', {
        phone: 'This phone number is already used by another account.',
      })
      throw error
    })
    this.audit({actorId,action:'UPDATE_TECHNICIAN',entityType:'TECHNICIAN',entityId:id,...event})
    return {id,...event.after}
  }
  async deactivate(id,actorId) {
    await this.transaction(async client=>{
      const before=await this.lock(client,id)
      await client.query("UPDATE technician_profiles SET is_active=false,availability_status='OFFLINE',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[id])
      await client.query("UPDATE users SET status='INACTIVE',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[before.user_id])
    })
    this.audit({actorId,action:'DEACTIVATE_TECHNICIAN',entityType:'TECHNICIAN',entityId:id,after:{is_active:false}})
    return {id,is_active:false}
  }
  async activate(id,actorId) {
    await this.transaction(async client=>{
      const before=await this.lock(client,id)
      const user=(await client.query('SELECT status FROM users WHERE id=$1 FOR UPDATE',[before.user_id])).rows[0]
      const balance=(await client.query(`SELECT ${remainingPointsSql('$1')} AS remaining_points`,[id])).rows[0]
      if(balance.remaining_points===0) throw new AppError(409,'POINTS_EXHAUSTED','This technician has no remaining points.')
      if(user.status==='LOCKED') throw new AppError(409,'ACCOUNT_LOCKED','Unlock the user account before activating this technician.')
      await client.query('UPDATE technician_profiles SET is_active=true,updated_at=CURRENT_TIMESTAMP WHERE id=$1',[id])
      await client.query("UPDATE users SET status='ACTIVE',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[before.user_id])
    })
    this.audit({actorId,action:'ACTIVATE_TECHNICIAN',entityType:'TECHNICIAN',entityId:id,after:{is_active:true}})
    return {id,is_active:true}
  }
  async skills(id,input,actorId) {
    await this.transaction(async client=>{
      const technician = await this.lock(client,id)
      if (technician.verification_status === 'VERIFIED' && !input.skills.length) {
        throw new AppError(422,'SKILL_REQUIRED','A verified technician must have at least one skill.')
      }
      for(const item of input.skills){
        if(!(await client.query('SELECT id FROM skills WHERE id=$1 AND is_active AND deleted_at IS NULL',[item.skill_id])).rows.length) throw new AppError(422,'INVALID_SKILL','Choose an active skill.')
        if(item.ac_brand_id && !(await client.query('SELECT id FROM ac_brands WHERE id=$1 AND is_active AND deleted_at IS NULL',[item.ac_brand_id])).rows.length) throw new AppError(422,'INVALID_BRAND','Choose an active AC brand.')
      }
      await client.query('DELETE FROM technician_skills WHERE technician_id=$1',[id])
      for(const item of input.skills) await client.query('INSERT INTO technician_skills(id,technician_id,skill_id,ac_brand_id,skill_level) VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,item.skill_id,item.ac_brand_id,item.skill_level])
    })
    this.audit({actorId,action:'UPDATE_TECHNICIAN_SKILLS',entityType:'TECHNICIAN',entityId:id,after:{skills:input.skills}})
    return {id,skills:input.skills}
  }
  async skillOptions() {
    const [skills,brands]=await Promise.all([pool.query('SELECT id,name FROM skills WHERE is_active AND deleted_at IS NULL ORDER BY name'),pool.query('SELECT id,name FROM ac_brands WHERE is_active AND deleted_at IS NULL ORDER BY name')])
    return {skills:skills.rows,brands:brands.rows}
  }
  async areas(id,input,actorId) {
    input = validateTechnicianAreas(input)
    const result = await this.transaction(async client => {
      const technician = await this.lock(client,id)
      if (technician.verification_status !== 'VERIFIED') throw new AppError(409,'TECHNICIAN_NOT_VERIFIED','Service areas can only be updated for verified technicians.')
      const before = (await client.query('SELECT city,ward FROM technician_areas WHERE technician_id=$1 ORDER BY city,ward',[id])).rows
      await client.query('DELETE FROM technician_areas WHERE technician_id=$1',[id])
      for (const area of input.areas) await client.query('INSERT INTO technician_areas(technician_id,city,ward) VALUES($1,$2,$3)',[id,area.city,area.ward])
      await client.query('UPDATE technician_profiles SET updated_at=CURRENT_TIMESTAMP WHERE id=$1',[id])
      return {before,areas:input.areas}
    })
    this.audit({actorId,action:'UPDATE_TECHNICIAN_SERVICE_AREAS',entityType:'TECHNICIAN',entityId:id,before:{areas:result.before},after:{areas:result.areas}})
    return {id,areas:result.areas}
  }
}
