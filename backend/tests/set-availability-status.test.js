import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'

import { env } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createTechnicianPortalRouter } from '../src/modules/technician-portal/technician-portal.routes.js'
import { TechnicianPortalRepository } from '../src/modules/technician-portal/technician-portal.repository.js'
import { validateSetAvailabilityStatus } from '../src/modules/technician-portal/technician-portal.validation.js'

test('Set Availability Status validation accepts only an exact ONLINE or OFFLINE payload', () => {
  assert.deepEqual(validateSetAvailabilityStatus({ status: 'ONLINE' }), { status: 'ONLINE' })
  assert.deepEqual(validateSetAvailabilityStatus({ status: 'OFFLINE' }), { status: 'OFFLINE' })
  for (const body of [null, {}, { status: 'BUSY' }, { status: 'online' }, { status: 'ONLINE', extra: true }]) {
    assert.throws(() => validateSetAvailabilityStatus(body), { status: 422 })
  }
})

test('Set Availability Status freely toggles an active technician ONLINE or OFFLINE', async () => {
  const calls = []
  const repository = new TechnicianPortalRepository({
    transaction: async (operation) => operation({
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM technician_profiles')) {
          return { rows: [{
            id: 'technician-id',
            availability_status: 'OFFLINE',
            is_active: true,
            account_status: 'ACTIVE',
          }] }
        }
        if (sql.includes('UPDATE technician_profiles')) {
          return { rows: [{ availability_status: params[1], updated_at: '2026-10-14T00:00:00.000Z' }] }
        }
        return { rows: [] }
      },
    }),
  })
  assert.deepEqual(await repository.setAvailability('user-id', 'ONLINE'), {
    availability_status: 'ONLINE',
    updated_at: '2026-10-14T00:00:00.000Z',
    can_receive_jobs: true,
  })
  assert.deepEqual(await repository.setAvailability('user-id', 'OFFLINE'), {
    availability_status: 'OFFLINE',
    updated_at: '2026-10-14T00:00:00.000Z',
    can_receive_jobs: false,
  })
  assert.ok(calls.some(({ sql }) => sql.includes('FOR UPDATE OF tp, u')))
  assert.equal(calls.some(({ sql }) => sql.includes('technician_areas')), false)
  assert.equal(calls.some(({ sql }) => sql.includes('technician_skills')), false)
})

test('Set Availability Status routes require a customer token and pass only validated states', async () => {
  const calls = []
  const repository = {
    async availability(userId) {
      calls.push({ action: 'read', userId })
      return { availability_status: 'OFFLINE', can_receive_jobs: false }
    },
    async setAvailability(userId, status) {
      calls.push({ action: 'update', userId, status })
      return { availability_status: status, can_receive_jobs: status === 'ONLINE' }
    },
  }
  const app = express()
  app.use(express.json())
  app.use('/portal', createTechnicianPortalRouter(repository))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/portal/availability`
  const userId = '12345678-1234-1234-1234-123456789012'
  const token = (role) => jwt.sign(
    { role, purpose: 'access' },
    env.jwtSecret,
    { subject: userId, expiresIn: '1m' },
  )
  const request = (method, role, body) => fetch(base, {
    method,
    headers: {
      Authorization: `Bearer ${token(role)}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  try {
    assert.equal((await fetch(base)).status, 401)
    assert.equal((await request('GET', 'ADMIN')).status, 403)
    const current = await request('GET', 'CUSTOMER')
    assert.equal(current.status, 200)
    assert.equal(current.headers.get('cache-control'), 'no-store')
    assert.equal((await request('PATCH', 'CUSTOMER', { status: 'BUSY' })).status, 422)
    const updated = await request('PATCH', 'CUSTOMER', { status: 'ONLINE' })
    assert.equal(updated.status, 200)
    assert.equal((await updated.json()).data.can_receive_jobs, true)
    assert.deepEqual(calls.at(-1), { action: 'update', userId, status: 'ONLINE' })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('OFFLINE technicians receive no matching booking proposals on the dashboard', async () => {
  const calls = []
  const repository = new TechnicianPortalRepository({
    queryable: {
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM technician_profiles tp')) {
          return { rows: [{
            id: 'technician-id',
            availability_status: 'OFFLINE',
            full_name: 'Kỹ thuật viên',
          }] }
        }
        if (sql.includes('AS jobs_today')) {
          return { rows: [{ jobs_today: 0, earnings_today: 0 }] }
        }
        if (sql.includes('count(DISTINCT b.id)')) {
          return { rows: [{ count: 0 }] }
        }
        return { rows: [] }
      },
    },
  })

  const dashboard = await repository.dashboard('user-id')
  const proposalQuery = calls.find(({ sql }) => sql.includes('count(DISTINCT b.id)'))
  assert.deepEqual(proposalQuery.params, ['technician-id', 'OFFLINE'])
  assert.match(proposalQuery.sql, /\$2='ONLINE'/)
  assert.equal(dashboard.stats.pending_requests, 0)
})
