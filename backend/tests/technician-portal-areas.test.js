import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'

import { env } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createTechnicianPortalRouter } from '../src/modules/technician-portal/technician-portal.routes.js'
import { TechnicianPortalRepository } from '../src/modules/technician-portal/technician-portal.repository.js'
import { serviceCity, serviceWards } from '../src/modules/technicians/technician.areas.js'

test('area options expose the current two-tier Can Tho administrative areas', () => {
  const repository = new TechnicianPortalRepository()
  assert.deepEqual(repository.areaOptions(), {
    city: serviceCity,
    districts: [],
    wards: serviceWards,
  })
})

test('replacing areas is atomic, scoped to the authenticated technician, and returns saved rows', async () => {
  const calls = []
  const saved = [{ id: 'area-id', city: serviceCity, ward: serviceWards[0] }]
  const client = {
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM technician_profiles') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 'technician-id' }] }
      }
      if (sql.includes('SELECT id, city, ward')) return { rows: saved }
      return { rows: [] }
    },
  }
  const repository = new TechnicianPortalRepository({
    transaction: async (operation) => operation(client),
  })
  const result = await repository.replaceAreas('user-id', {
    areas: [{ city: serviceCity, ward: serviceWards[0] }],
  })
  assert.deepEqual(result, saved)
  assert.ok(calls.some(({ sql, params }) => sql.includes('DELETE FROM technician_areas') && params[0] === 'technician-id'))
  assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO technician_areas') && params.slice(1).join('|') === `technician-id|${serviceCity}|${serviceWards[0]}`))
})

test('technician area routes require auth and validate the full replacement payload', async () => {
  const updates = []
  const repository = {
    areaOptions: () => ({ city: serviceCity, districts: [], wards: serviceWards }),
    areas: async () => [],
    replaceAreas: async (userId, input) => { updates.push({ userId, input }); return input.areas },
  }
  const app = express()
  app.use(express.json())
  app.use('/portal', createTechnicianPortalRouter(repository))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/portal/areas`
  const userId = '12345678-1234-1234-1234-123456789012'
  const token = jwt.sign({ role: 'CUSTOMER', purpose: 'access' }, env.jwtSecret, { subject: userId, expiresIn: '1m' })
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  try {
    assert.equal((await fetch(base)).status, 401)
    const options = await fetch(`${base}/options`, { headers })
    assert.equal(options.status, 200)
    assert.equal((await options.json()).data.city, serviceCity)
    assert.equal((await fetch(base, { method: 'PUT', headers, body: JSON.stringify({ areas: [] }) })).status, 422)
    assert.equal((await fetch(base, { method: 'PUT', headers, body: JSON.stringify({
      areas: [{ city: serviceCity, ward: serviceWards[0] }],
    }) })).status, 200)
    assert.equal(updates[0].userId, userId)
    assert.equal(updates[0].input.areas[0].ward, serviceWards[0])
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
