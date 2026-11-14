import assert from 'node:assert/strict'
import test, {before,after} from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { AppError } from '../src/utils.js'
import { createCatalogRouter } from '../src/modules/catalog/catalog.routes.js'
import { errorHandler,notFoundHandler } from '../src/middleware/error-handler.js'

const id = '12345678-1234-1234-1234-123456789012'
const kinds = [
  ['categories',151,{name:'Cleaning'},{name:'Updated'}],
  ['brands',155,{name:'Daikin'},{name:'Updated'}],
  ['models',159,{model_name:'FTKY25',brand_id:id,ac_type:'WALL_MOUNTED',capacity_btu:9000,inverter:true},{model_name:'Updated'}],
  ['services',163,{name:'Cleaning',category_id:id,base_price:100000},{name:'Updated'}],
  ['skills',167,{name:'Cleaning',service_id:id},{name:'Updated'}],
]
let server,base
let calls=[]
let failure=null
const repository = {
  async list(...args) {
    calls.push(['list',...args])
    if (failure==='list') throw new AppError(503,'REPOSITORY_UNAVAILABLE','Repository unavailable')
    return {items:[],total:0,page:1,limit:10}
  },
  async find(...args) {
    calls.push(['find',...args])
    if (failure==='find') throw new AppError(404,'NOT_FOUND','Not found')
    return {id,base_price:100000,rating:4.5}
  },
  async mutate(...args) {
    calls.push(['mutate',...args])
    if (failure==='mutate') throw new AppError(503,'REPOSITORY_UNAVAILABLE','Repository unavailable')
    return {id,...args[2]}
  },
}
const admin = jwt.sign({sub:id,role:'ADMIN',purpose:'access'},env.jwtSecret,{expiresIn:'5m'})

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/admin',createCatalogRouter(repository))
  app.use('/public',createCatalogRouter(repository,false))
  app.use(notFoundHandler)
  app.use(errorHandler)
  server = app.listen(0,'127.0.0.1')
  await new Promise(resolve => server.once('listening',resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {if (server) await new Promise(resolve => server.close(resolve))})

async function request(path,method='GET',body,authenticated=true) {
  const response = await fetch(base+path,{
    method,
    headers:{...(authenticated?{Authorization:`Bearer ${admin}`}:{}) ,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  })
  return response
}
function reset() { calls=[]; failure=null }
function sheet(number) { return `F${number}` }

for (const [kind,start,createBody,patchBody] of kinds) {
  const invalidBody = kind==='models' ? {model_name:''} : {name:''}

  test(`${sheet(start)} UTCID01 returns an empty catalog list`, async () => {
    reset()
    const response = await request(`/admin/${kind}`)
    assert.equal(response.status,200)
    assert.deepEqual((await response.json()).data.items,[])
    assert.equal(calls.length,1)
    assert.equal(calls[0][1],kind)
  })
  test(`${sheet(start)} UTCID02 rejects page zero before reading`, async () => {
    reset()
    assert.equal((await request(`/admin/${kind}?page=0`)).status,422)
    assert.equal(calls.length,0)
  })
  test(`${sheet(start)} UTCID03 propagates a list repository error`, async () => {
    reset(); failure='list'
    assert.equal((await request(`/admin/${kind}`)).status,503)
    assert.equal(calls.length,1)
  })

  test(`${sheet(start+1)} UTCID01 creates the correct resource with actor`, async () => {
    reset()
    const response = await request(`/admin/${kind}`,'POST',createBody)
    assert.equal(response.status,201)
    assert.deepEqual(calls[0],['mutate',kind,null,createBody,'CREATE',id])
  })
  test(`${sheet(start+1)} UTCID02 rejects an empty name before saving`, async () => {
    reset()
    assert.equal((await request(`/admin/${kind}`,'POST',{...createBody,...invalidBody})).status,422)
    assert.equal(calls.length,0)
  })
  test(`${sheet(start+1)} UTCID03 propagates a create repository error`, async () => {
    reset(); failure='mutate'
    assert.equal((await request(`/admin/${kind}`,'POST',createBody)).status,503)
    assert.equal(calls.length,1)
  })

  test(`${sheet(start+2)} UTCID01 updates the correct resource with actor`, async () => {
    reset()
    assert.equal((await request(`/admin/${kind}/${id}`,'PATCH',patchBody)).status,200)
    assert.deepEqual(calls[0],['mutate',kind,id,patchBody,'UPDATE',id])
  })
  test(`${sheet(start+2)} UTCID02 rejects an empty name before updating`, async () => {
    reset()
    assert.equal((await request(`/admin/${kind}/${id}`,'PATCH',invalidBody)).status,422)
    assert.equal(calls.length,0)
  })
  test(`${sheet(start+2)} UTCID03 rejects an invalid ID before updating`, async () => {
    reset()
    assert.equal((await request(`/admin/${kind}/bad`,'PATCH',patchBody)).status,422)
    assert.equal(calls.length,0)
  })
  test(`${sheet(start+2)} UTCID04 propagates an update repository error`, async () => {
    reset(); failure='mutate'
    assert.equal((await request(`/admin/${kind}/${id}`,'PATCH',patchBody)).status,503)
    assert.equal(calls.length,1)
  })

  test(`${sheet(start+3)} UTCID01 requests soft deletion`, async () => {
    reset()
    assert.equal((await request(`/admin/${kind}/${id}`,'DELETE')).status,204)
    assert.deepEqual(calls[0],['mutate',kind,id,{},'TRASH',id])
  })
  test(`${sheet(start+3)} UTCID02 rejects an invalid ID before deleting`, async () => {
    reset()
    assert.equal((await request(`/admin/${kind}/bad`,'DELETE')).status,422)
    assert.equal(calls.length,0)
  })
  test(`${sheet(start+3)} UTCID03 propagates a delete repository error`, async () => {
    reset(); failure='mutate'
    assert.equal((await request(`/admin/${kind}/${id}`,'DELETE')).status,503)
    assert.equal(calls.length,1)
  })
}

test('F195 UTCID01 reads public service detail with price and rating', async () => {
  reset()
  const response = await request(`/public/services/${id}`,'GET',undefined,false)
  assert.equal(response.status,200)
  assert.deepEqual((await response.json()).data,{id,base_price:100000,rating:4.5})
  assert.deepEqual(calls[0],['find','services',id,true])
})
test('F195 UTCID02 rejects an invalid public service ID', async () => {
  reset()
  assert.equal((await request('/public/services/bad','GET',undefined,false)).status,422)
  assert.equal(calls.length,0)
})
test('F195 UTCID03 propagates public service not found', async () => {
  reset(); failure='find'
  assert.equal((await request(`/public/services/${id}`,'GET',undefined,false)).status,404)
  assert.equal(calls.length,1)
})
