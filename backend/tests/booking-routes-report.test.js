import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { createBookingRouter } from '../src/modules/bookings/booking.routes.js'
import { errorHandler,notFoundHandler } from '../src/middleware/error-handler.js'

const actorId = '12345678-1234-1234-1234-123456789012'
const bookingId = '23456789-2345-2345-2345-234567890123'

test('F191 booking detail route', async t => {
  const calls=[]
  const audits=[]
  const booking = {id:bookingId,status:'COMPLETED'}
  const app = express()
  app.use('/bookings',createBookingRouter({detail: async id => {calls.push(id); return booking}},entry => audits.push(entry)))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0,'127.0.0.1')
  await new Promise(resolve => server.once('listening',resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const token = jwt.sign({sub:actorId,role:'ADMIN',purpose:'access'},env.jwtSecret,{expiresIn:'5m'})
  try {
    await t.test('F191 UTCID01 returns the booking and audits the read', async () => {
      const valid = await fetch(`${base}/bookings/${bookingId}`,{headers:{Authorization:`Bearer ${token}`}})
      assert.equal(valid.status,200)
      assert.deepEqual((await valid.json()).data,booking)
      assert.deepEqual(calls,[bookingId])
      assert.equal(audits[0].actorId,actorId)
      assert.equal(audits[0].entityId,bookingId)
    })
    await t.test('F191 UTCID02 rejects invalid IDs before querying', async () => {
      const invalid = await fetch(`${base}/bookings/bad`,{headers:{Authorization:`Bearer ${token}`}})
      assert.equal(invalid.status,422)
      assert.deepEqual(calls,[bookingId])
    })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
