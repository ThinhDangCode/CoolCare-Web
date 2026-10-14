import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createBookingRouter } from '../src/modules/bookings/booking.routes.js'
import { validateBookingQuery } from '../src/modules/bookings/booking.validation.js'
import { validateTechnicianAreas } from '../src/modules/technicians/technician.validation.js'

test('booking filters and service areas are validated', () => {
  assert.equal(validateBookingQuery({}).status,'ALL')
  assert.equal(validateBookingQuery({month:'2026-10',status:'IN_PROGRESS'}).month,'2026-10')
  for (const query of [{limit:101},{page:0},{month:'2026-13'},{month:['2026-10']},{status:'INVALID'},{service:'bad'},{search:[]}]) assert.throws(() => validateBookingQuery(query),{status:422})
  assert.deepEqual(validateTechnicianAreas({areas:[{city:'  Thành phố Cần Thơ ',ward:'Phường Ninh Kiều'}]}).areas,[{city:'Thành phố Cần Thơ',ward:'Phường Ninh Kiều'}])
  assert.throws(() => validateTechnicianAreas({areas:[{city:'Thành phố Cần Thơ',ward:'Phường Ninh Kiều'},{city:'Thành phố Cần Thơ',ward:'Phường Ninh Kiều'}]}),{status:422,code:'DUPLICATE_AREA'})
  assert.throws(() => validateTechnicianAreas({areas:[]}),{status:422,code:'AREA_REQUIRED'})
  assert.throws(() => validateTechnicianAreas({areas:[{city:'Thành phố Hồ Chí Minh',ward:'Phường Ninh Kiều'}]}),{status:422,code:'INVALID_SERVICE_CITY'})
  assert.throws(() => validateTechnicianAreas({areas:[{city:'Thành phố Cần Thơ',ward:'Phường Xuân Khánh'}]}),{status:422,code:'INVALID_SERVICE_WARD'})
  assert.equal(validateTechnicianAreas({areas:[{city:'Thành phố Cần Thơ',ward:'Phường Tân Lộc'}]}).areas.length,1)
  assert.throws(() => validateTechnicianAreas({areas:[{city:'Can Tho',ward:''}]}),{status:422})
})
test('booking routes enforce Admin access, reject cancellation requests and audit reads', async () => {
  const id = '12345678-1234-1234-1234-123456789012', audits = [], writes = []
  const repository = {
    options:async () => [], list:async query => ({items:[],total:0,query}),
    detail:async target => ({id:target}), cancel:async (...args) => {writes.push(args);return {status:'CANCELLED'}},
  }
  const app = express();app.use(express.json());app.use('/bookings',createBookingRouter(repository,event => audits.push(event)));app.use(errorHandler)
  const server = app.listen(0,'127.0.0.1');await new Promise(resolve => server.once('listening',resolve))
  const base = `http://127.0.0.1:${server.address().port}/bookings`
  const headers = role => ({Authorization:`Bearer ${jwt.sign({role,purpose:'access'},env.jwtSecret,{subject:id,expiresIn:'1m'})}`,'Content-Type':'application/json'})
  try {
    assert.equal((await fetch(base)).status,401)
    assert.equal((await fetch(base,{headers:headers('CUSTOMER')})).status,403)
    assert.equal((await fetch(`${base}/${id}/cancel`,{method:'POST',headers:headers('CUSTOMER'),body:JSON.stringify({reason:'Test cancellation'})})).status,403)
    assert.equal((await fetch(`${base}?month=invalid`,{headers:headers('ADMIN')})).status,422)
    assert.equal((await fetch(`${base}/not-a-uuid`,{headers:headers('ADMIN')})).status,422)
    const list = await fetch(`${base}?status=PENDING`,{headers:headers('ADMIN')})
    assert.equal(list.status,200);assert.equal((await list.json()).data.query.status,'PENDING')
    const detail = await fetch(`${base}/${id}`,{headers:headers('ADMIN')})
    assert.equal(detail.status,200);assert.equal(detail.headers.get('cache-control'),'no-store')
    assert.deepEqual(audits.map(event => event.action),['VIEW_BOOKINGS','VIEW_BOOKING_DETAIL'])
    assert.equal(writes.length,0)
    assert.equal((await fetch(`${base}/${id}/cancel`,{method:'POST',headers:headers('ADMIN'),body:JSON.stringify({reason:'Test cancellation'})})).status,404)
    assert.equal(writes.length,0)
  } finally { server.closeAllConnections();await new Promise(resolve => server.close(resolve)) }
})
