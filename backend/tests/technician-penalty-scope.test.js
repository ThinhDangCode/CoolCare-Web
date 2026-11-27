import assert from 'node:assert/strict'
import test from 'node:test'
import bcrypt from 'bcryptjs'
import { enforcePenaltyBalance, assertTechnicianNotPenaltyLocked } from '../src/modules/technicians/technician.points.js'
import { AuthService } from '../src/modules/auth/auth.service.js'
import { adaptDatabaseQuery } from '../src/config/database-codebook-adapter.js'

for (const status of ['ACTIVE', 'LOCKED', 'INACTIVE']) {
  test(`exhausted points preserve user status ${status}`, async () => {
    const user = {status}; const profile = {id:'tech',user_id:'user',is_active:true,availability_status:'ONLINE'}
    const account = {is_receiving_jobs_allowed:true}; const calls=[]
    const db={async query(sql,params){
      calls.push(sql)
      if(sql.includes('AS remaining_points')) return {rows:[{remaining_points:0}]}
      if(sql.startsWith('UPDATE technician_profiles')) {profile.is_active=false;profile.availability_status='OFFLINE';return {rows:[]}}
      if(sql.startsWith('UPDATE technician_accounts')) {account.is_receiving_jobs_allowed=false;return {rows:[]}}
      throw Error('Unexpected query: '+sql)
    }}
    assert.equal(await enforcePenaltyBalance(db,profile),0)
    assert.equal(user.status,status)
    assert.equal(profile.is_active,false); assert.equal(profile.availability_status,'OFFLINE')
    assert.equal(account.is_receiving_jobs_allowed,false)
    assert.ok(!calls.some(sql=>/UPDATE users/i.test(sql)))
    await assert.rejects(assertTechnicianNotPenaltyLocked('user',db),{status:403,code:'TECHNICIAN_POINTS_EXHAUSTED'})
  })
}
test('positive remaining points do not suspend profile',async()=>{
  const db={async query(sql){assert.match(sql,/AS remaining_points/);return {rows:[{remaining_points:2}]}}}
  assert.equal(await enforcePenaltyBalance(db,{id:'tech'}),2)
  await assertTechnicianNotPenaltyLocked('user',db)
})
test('customer without technician profile is not treated as penalty locked',async()=>{
  await assertTechnicianNotPenaltyLocked('user',{query:async()=>({rows:[]})})
})
test('customer login and refresh still work with exhausted technician points; actual global lock still rejects login',async()=>{
  const user={id:'user',email:'user@example.test',role:'CUSTOMER',status:'ACTIVE',email_verified_at:new Date(),password_hash:await bcrypt.hash('password123',4),has_technician_profile:true,is_technician_verified:true,technician_penalty_locked:true}
  const service=new AuthService({repository:{findUserByEmail:async()=>user,findUserById:async()=>user,startSession:async()=>'session',isCurrentSession:async()=>true}})
  const session=await service.login({email:user.email,password:'password123'})
  assert.equal(session.user.role,'CUSTOMER');assert.equal(session.user.isTechnicianVerified,true);assert.equal(session.user.technicianPenaltyLocked,true);assert.ok(session.token)
  assert.equal((await service.refreshSession(user.id,'session')).user.technicianPenaltyLocked,true)
  user.status='LOCKED'
  await assert.rejects(service.login({email:user.email,password:'password123'}),{code:'ACCOUNT_UNAVAILABLE'})
})
test('remaining points query retains numeric revoked status and technician-only updates use numeric codebook',()=>{
  const query=adaptDatabaseQuery("UPDATE technician_profiles SET is_active=false,availability_status='OFFLINE' WHERE id=$1").query
  assert.match(query,/availability_status=1/)
})

import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { pool } from '../src/config/database.js'
import { authenticate } from '../src/middleware/authenticate.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createTechnicianPortalRouter } from '../src/modules/technician-portal/technician-portal.routes.js'

test('same session can access customer route but not technician portal after point exhaustion',async()=>{
  const original=pool.query; let points=0; let status='ACTIVE'; let portalCalls=0
  pool.query=async sql=>{
    if(sql.includes('AS session_id'))return {rows:[{session_id:'s1',status}]}
    if(sql.includes('AS remaining_points'))return {rows:[{remaining_points:points}]}
    throw Error('Unexpected query '+sql)
  }
  const app=express(); app.get('/customer',authenticate,(_req,res)=>res.json({ok:true}))
  app.use('/portal',createTechnicianPortalRouter({dashboard:async()=>{portalCalls++;return {ok:true}}}))
  app.use(errorHandler); const server=app.listen(0)
  const token=jwt.sign({sub:'user',role:'CUSTOMER',purpose:'access',jti:'s1'},env.jwtSecret)
  const get=path=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{headers:{authorization:`Bearer ${token}`}})
  try {
    assert.equal((await get('/customer')).status,200)
    const locked=await get('/portal/dashboard');assert.equal(locked.status,403);assert.equal((await locked.json()).error.code,'TECHNICIAN_POINTS_EXHAUSTED');assert.equal(portalCalls,0)
    points=2;assert.equal((await get('/portal/dashboard')).status,200);assert.equal(portalCalls,1)
    status='LOCKED';assert.equal((await get('/customer')).status,403)
  }finally{pool.query=original;await new Promise(resolve=>server.close(resolve))}
})
