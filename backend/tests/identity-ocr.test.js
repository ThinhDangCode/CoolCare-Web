import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { IdentityOcr, compareIdentity } from '../src/modules/technicians/technician.identity-ocr.js'
import { createTechnicianRouter } from '../src/modules/technicians/technician.routes.js'
import { errorHandler } from '../src/middleware/error-handler.js'

const profile = {id:'12345678-1234-1234-1234-123456789012',identity_number:'012345678901',full_name:'Nguyễn Văn A',identity_front_url:'https://res.cloudinary.com/demo/front.jpg',identity_back_url:'https://res.cloudinary.com/demo/back.jpg'}
function fixture({ frontType='new',errorCode=0 } = {}) {
  const calls=[]
  const fetchImpl = async (url,options) => {
    calls.push({url,options})
    if (!String(url).includes('api.fpt.ai')) return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}})
    const front = options.body.get('image').name.includes('front')
    return Response.json({errorCode,data:[front ? {type:frontType,id:'012345678901',name:'NGUYỄN VĂN A',id_prob:'0.99',name_prob:'0.97'} : {type:'new_back',issue_date:'01/01/2024'}]})
  }
  return {calls,service:new IdentityOcr({apiKey:'test-key',allowedHosts:['res.cloudinary.com'],fetchImpl})}
}
test('reads two stored images as multipart, compares fields and never claims authenticity',async()=>{
  const {calls,service}=fixture()
  const result=await service.check(profile)
  assert.equal(result.front.status,'READ')
  assert.equal(result.back.correct_side,true)
  assert.equal(result.front.fields.id.confidence,0.99)
  assert.deepEqual(result.comparison,{identity_number:'MATCH',full_name:'MATCH'})
  assert.equal(result.authenticity_verified,false)
  assert.equal(calls.length,4)
  for (const call of calls.filter(call=>String(call.url).includes('api.fpt.ai'))) {
    assert.equal(call.options.headers['api-key'],'test-key')
    assert.ok(call.options.body.get('image') instanceof Blob)
  }
})
test('missing key fails before sending identity images',async()=>{
  let called=false
  await assert.rejects(new IdentityOcr({apiKey:'',fetchImpl:()=>{called=true}}).check(profile),{code:'FPT_NOT_CONFIGURED'})
  assert.equal(called,false)
})
test('blocks arbitrary hosts and reports missing side without losing successful OCR',async()=>{
  const {service,calls}=fixture()
  const blocked=await service.check({...profile,identity_front_url:'http://127.0.0.1/private',identity_back_url:null})
  assert.equal(blocked.front.status,'ERROR')
  assert.equal(blocked.back.status,'ERROR')
  assert.equal(calls.length,0)
  const partial=await service.check({...profile,identity_back_url:null})
  assert.equal(partial.front.status,'READ')
  assert.equal(partial.back.status,'ERROR')
})
test('wrong side cannot produce a matching profile result; provider recognition errors are visible',async()=>{
  const wrong=await fixture({frontType:'new_back'}).service.check(profile)
  assert.equal(wrong.front.correct_side,false)
  assert.equal(wrong.comparison.identity_number,'UNAVAILABLE')
  const failure=await fixture({errorCode:3}).service.check(profile)
  assert.equal(failure.front.status,'ERROR')
  assert.match(failure.front.message,/Không tìm thấy/)
  assert.equal(compareIdentity({fields:{id:{value:'000'},name:{value:'Khác'}}},profile).identity_number,'MISMATCH')
})
test('rejects redirects, oversized images and bad upstream responses',async()=>{
  for (const fetchImpl of [
    async()=>new Response('',{status:302,headers:{location:'http://localhost/'}}),
    async()=>new Response('image',{headers:{'content-type':'image/jpeg','content-length':String(6*1024*1024)}}),
    async(url)=>String(url).includes('api.fpt.ai') ? new Response('denied',{status:401}) : new Response('image',{headers:{'content-type':'image/jpeg'}}),
  ]) {
    const result=await new IdentityOcr({apiKey:'key',allowedHosts:['res.cloudinary.com'],fetchImpl}).check(profile)
    assert.equal(result.front.status,'ERROR')
    assert.equal(result.authenticity_verified,false)
  }
})
test('OCR route is admin only, returns no-store, and audits no identity content',async()=>{
  const app=express()
  const calls=[]
  const audits=[]
  app.use('/technicians',createTechnicianRouter({detail:async()=>profile},e=>audits.push(e),{}, {check:async p=>{calls.push(p);return {authenticity_verified:false}}}))
  app.use(errorHandler)
  const server=app.listen(0,'127.0.0.1')
  await new Promise(resolve=>server.once('listening',resolve))
  const base=`http://127.0.0.1:${server.address().port}/technicians`
  const headers=role=>({Authorization:`Bearer ${jwt.sign({role,purpose:'access'},env.jwtSecret,{subject:profile.id,expiresIn:'1m'})}`})
  try {
    assert.equal((await fetch(`${base}/${profile.id}/identity-ocr`,{method:'POST'})).status,401)
    assert.equal((await fetch(`${base}/${profile.id}/identity-ocr`,{method:'POST',headers:headers('CUSTOMER')})).status,403)
    assert.equal((await fetch(`${base}/bad-id/identity-ocr`,{method:'POST',headers:headers('ADMIN')})).status,422)
    assert.equal(calls.length,0)
    const response=await fetch(`${base}/${profile.id}/identity-ocr`,{method:'POST',headers:headers('ADMIN')})
    assert.equal(response.status,200)
    assert.equal(response.headers.get('cache-control'),'no-store')
    assert.equal(calls.length,1)
    assert.equal(JSON.stringify(audits).includes(profile.identity_number),false)
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})
