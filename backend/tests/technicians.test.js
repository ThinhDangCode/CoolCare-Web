import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { AppError } from '../src/utils.js'
import { TechnicianMutations } from '../src/modules/technicians/technician.mutations.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createTechnicianRouter } from '../src/modules/technicians/technician.routes.js'
import { validateTechnicianQuery, validatePenaltyQuery, validateReview, validateTechnicianUpdate, validateTechnicianSkills } from '../src/modules/technicians/technician.validation.js'

test('verified technicians cannot clear all skills or produce a successful audit', async () => {
  const queries = []
  const audits = []
  const service = new TechnicianMutations({
    audit: event => audits.push(event),
    transaction: work => work({ query: async sql => {
      queries.push(sql)
      return { rows: sql.includes('technician_profiles') ? [{ verification_status: 'VERIFIED' }] : [] }
    } }),
  })
  await assert.rejects(service.skills('test-id', { skills: [] }, 'admin-id'), {
    status: 422, code: 'SKILL_REQUIRED',
  })
  assert.ok(!queries.some(sql => sql.includes('DELETE')))
  assert.equal(audits.length, 0)
})

test('technician mutations validate decisions, limits and unique skill assignments', () => {
  assert.throws(()=>validateReview({status:'PENDING'}),{status:422})
  assert.throws(()=>validateReview({status:'REJECTED',reason:'no'}),{status:422})
  assert.equal(validateReview({status:'REJECTED',reason:' Missing documents '}).reason,'Missing documents')
  assert.throws(()=>validateReview({status:'VERIFIED'},true),{status:422})
  const input={full_name:'Tran Nhat Nam',phone:'0908341882',qualification_level:'EXPERT',years_experience:4,bio:''}
  assert.equal(validateTechnicianUpdate(input).years_experience,4)
  assert.throws(()=>validateTechnicianUpdate({...input,years_experience:-1}),{status:422})
  assert.throws(()=>validateTechnicianUpdate({...input,is_active:true}),{status:422})
  const skill={skill_id:'12345678-1234-1234-1234-123456789012',ac_brand_id:null,skill_level:'INTERMEDIATE'}
  assert.throws(()=>validateTechnicianSkills({skills:[skill,skill]}),{status:422})
  assert.deepEqual(validateTechnicianSkills({skills:[]}),{skills:[]})
})

test('penalty queries default to active penalties and reject invalid filters', () => {
  assert.equal(validatePenaltyQuery({}).status, 'ACTIVE')
  assert.equal(validatePenaltyQuery({ search: ' Linh ' }).search, 'Linh')
  for (const query of [{status:'PENDING'}, {type:'OTHER'}, {page:0}, {limit:101}, {search:[]}]) assert.throws(() => validatePenaltyQuery(query), {status:422})
})

test('technician filters reject malformed query values and distinguish certification states', () => {
  assert.equal(validateTechnicianQuery({ search: ' Linh ' }).search, 'Linh')
  for (const query of [{ page: 0 }, { page: 'abc' }, { limit: 101 }, { search: ['a'] }, { search: 'x'.repeat(151) }, { qualification: 'ADMIN' }, { availability: 'INVALID' }, { verification: 'APPROVED' }, { skill: {} }, { area: ['a'] }]) {
    assert.throws(() => validateTechnicianQuery(query), { status: 422 })
  }
  assert.throws(() => validateTechnicianQuery({ status: 'EXPIRED' }), { status: 422 })
  assert.equal(validateTechnicianQuery({ status: 'EXPIRED' }, true).status, 'EXPIRED')
})

test('technician routes protect identity, validate requests and audit successful admin reads', async () => {
  const calls = []
  const mutationCalls = []
  const audits = []
  const targetId = '12345678-1234-1234-1234-123456789012'
  const repository = {
    async list(query) { calls.push(query); return { items: [], total: 0 } },
    async options() { return { areas: [], skills: [] } },
    async certifications() { return { items: [], total: 0 } },
    async penalties(query) { return { items: [], total: 0, status: query.status } },
    async detail(id) { if (id !== targetId) throw new AppError(404, 'TECHNICIAN_NOT_FOUND', 'Technician not found.'); return { id, identity_number: '000000000001' } },
  }
  const app = express()
  app.use(express.json())
  const mutations = Object.fromEntries(['verification','certification','update','skills','areas'].map(action=>[action,async (...args)=>{mutationCalls.push({action,args});return {id:args[0]}}]))
  mutations.deactivate=async (...args)=>{mutationCalls.push({action:'deactivate',args});return {is_active:false}}
  app.use('/technicians', createTechnicianRouter(repository, (event) => audits.push(event), mutations))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/technicians`
  const secret = env.jwtSecret || 'test-only-technician-secret-32-characters'
  const oldSecret = env.jwtSecret
  // Runtime env is frozen; configure JWT_SECRET when running tests as for the existing suite.
  assert.ok(oldSecret, 'JWT_SECRET must be configured for route tests')
  const headers = (role) => ({ Authorization: `Bearer ${jwt.sign({ role, purpose: 'access' }, secret, { subject: targetId, expiresIn: '1m' })}` })
  try {
    assert.equal((await fetch(`${base}/${targetId}`)).status, 401)
    assert.equal((await fetch(`${base}/${targetId}`, { headers: headers('CUSTOMER') })).status, 403)
    assert.equal((await fetch(`${base}/penalties`, { headers: headers('CUSTOMER') })).status, 403)
    assert.equal((await fetch(`${base}/penalties?status=INVALID`, { headers: headers('ADMIN') })).status, 422)
    assert.equal((await fetch(`${base}?limit=101`, { headers: headers('ADMIN') })).status, 422)
    assert.equal((await fetch(`${base}/not-a-uuid`, { headers: headers('ADMIN') })).status, 422)
    assert.equal((await fetch(`${base}/22345678-1234-1234-1234-123456789012`, { headers: headers('ADMIN') })).status, 404)
    const response = await fetch(`${base}/${targetId}`, { headers: headers('ADMIN') })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await response.json()).data.id, targetId)
    assert.equal((await fetch(`${base}/certifications?status=EXPIRED`, { headers: headers('ADMIN') })).status, 200)
    assert.equal((await fetch(`${base}?search=Linh&qualification=EXPERT`, { headers: headers('ADMIN') })).status, 200)
    assert.equal(calls[0].qualification, 'EXPERT')
    assert.equal(calls[0].search, 'Linh')
    assert.equal(audits.length, 3)
    assert.equal(audits[0].action, 'VIEW_TECHNICIAN_IDENTITY_AND_DETAIL')
    assert.equal(audits[0].entityId, targetId)
    assert.equal(JSON.stringify(audits).includes('000000000001'), false)
    const penalties = await fetch(`${base}/penalties`, { headers: headers('ADMIN') })
    assert.equal(penalties.status, 200)
    assert.equal((await penalties.json()).data.status, 'ACTIVE')
    assert.equal(audits.at(-1).action, 'VIEW_TECHNICIAN_PENALTIES')
    const write = (path,role,body,method='PATCH') => fetch(base+path,{method,headers:{...headers(role),'Content-Type':'application/json'},body:JSON.stringify(body)})
    assert.equal((await write(`/${targetId}/verification`,'CUSTOMER',{status:'VERIFIED'})).status,403)
    assert.equal((await write(`/${targetId}/verification`,'ADMIN',{status:'REJECTED',reason:''})).status,422)
    assert.equal((await write(`/${targetId}/verification`,'ADMIN',{status:'VERIFIED'})).status,200)
    assert.equal(mutationCalls.at(-1).args[2],targetId)
    assert.equal((await write(`/certifications/${targetId}/review`,'ADMIN',{status:'REJECTED',reason:'Unreadable document',expected_updated_at:new Date().toISOString()})).status,200)
    assert.equal((await write(`/${targetId}/skills`,'ADMIN',{skills:[]})).status,200)
    assert.equal((await write(`/${targetId}/areas`,'CUSTOMER',{areas:[]})).status,403)
    assert.equal((await write(`/${targetId}/areas`,'ADMIN',{areas:[{city:'Can Tho',ward:''}]})).status,422)
    assert.equal((await write(`/${targetId}/areas`,'ADMIN',{areas:[{city:'Thành phố Cần Thơ',ward:'Phường Ninh Kiều'}]})).status,200)
    assert.equal(mutationCalls.at(-1).args[2],targetId)
    assert.equal((await write(`/${targetId}`,'ADMIN',{full_name:'Tran Nhat Nam',phone:'0908341882',qualification_level:'EXPERT',years_experience:3,bio:''})).status,200)
    assert.equal((await write(`/${targetId}/deactivate`,'CUSTOMER',{},'POST')).status,403)
    assert.equal((await write(`/${targetId}/deactivate`,'ADMIN',{},'POST')).status,200)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
