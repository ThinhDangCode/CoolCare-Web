import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'

import { env } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createTechnicianPortalRouter } from '../src/modules/technician-portal/technician-portal.routes.js'
import { ViewJobRequestsRepository } from '../src/modules/technician-portal/view-job-requests.repository.js'
import { ViewJobRequestsService } from '../src/modules/technician-portal/view-job-requests.service.js'
import { validateViewJobRequestsQuery } from '../src/modules/technician-portal/view-job-requests.validation.js'

const userId = '12345678-1234-1234-1234-123456789012'

test('View Job Requests validation defaults to pending SELECTED requests and validates filters', () => {
  assert.deepEqual(validateViewJobRequestsQuery({}), {
    status: 'SELECTED', page: 1, limit: 20, offset: 0,
  })
  assert.deepEqual(validateViewJobRequestsQuery({ status: 'ALL', page: '2', limit: '10' }), {
    status: null, page: 2, limit: 10, offset: 10,
  })
  assert.deepEqual(validateViewJobRequestsQuery({ status: 'HISTORY' }), {
    status: 'HISTORY', page: 1, limit: 20, offset: 0,
  })
  assert.throws(() => validateViewJobRequestsQuery({ status: 'PENDING' }), { status: 422 })
  assert.throws(() => validateViewJobRequestsQuery({ status: 'SELECTED', extra: 'x' }), { status: 422 })
  assert.throws(() => validateViewJobRequestsQuery({ limit: '51' }), { status: 422 })
})

test('View Job Requests enforces a verified and active technician profile', async () => {
  for (const [profile, code] of [
    [null, 'TECHNICIAN_PROFILE_REQUIRED'],
    [{ id: 'tech', verification_status: 'PENDING', is_active: true, account_status: 'ACTIVE' }, 'TECHNICIAN_NOT_VERIFIED'],
    [{ id: 'tech', verification_status: 'VERIFIED', is_active: false, account_status: 'ACTIVE' }, 'TECHNICIAN_INACTIVE'],
  ]) {
    const service = new ViewJobRequestsService({ findTechnicianByUserId: async () => profile })
    await assert.rejects(service.getViewJobRequests(userId), (error) => error.code === code)
  }
})

test('View Job Requests is scoped to the authenticated technician and formats states', async () => {
  const calls = []
  const repository = {
    findTechnicianByUserId: async (id) => {
      calls.push(['profile', id])
      return { id: 'technician-id', verification_status: 'VERIFIED', is_active: true, account_status: 'ACTIVE' }
    },
    countJobRequests: async (...args) => { calls.push(['count', ...args]); return 1 },
    findJobRequests: async (...args) => {
      calls.push(['find', ...args])
      return [{
        request_id: 'request-id', stored_request_status: 'SELECTED', request_status: 'SELECTED',
        match_score: '95.50', match_reason: 'Phù hợp khu vực', requested_at: '2026-10-15T01:00:00Z',
        booking_id: 'booking-id', booking_code: 'BK-001', booking_status: 'TECHNICIAN_SELECTED',
        description: 'Máy không lạnh', scheduled_at: '2026-10-16T01:00:00Z',
        service_address: '1 Nguyễn Văn Cừ', ward: 'Phường Ninh Kiều', city: 'Cần Thơ',
        latitude: '10.1', longitude: '105.7', recipient_name: 'Khách hàng', recipient_phone: '0900000000',
        subtotal: '200000', discount_amount: '0', total_amount: '200000', units: [],
        customer_id: 'customer-id', customer_name: 'Khách hàng',
        booking_created_at: '2026-10-15T00:00:00Z', booking_updated_at: '2026-10-15T01:00:00Z',
      }]
    },
  }
  const result = await new ViewJobRequestsService(repository).getViewJobRequests(userId)
  assert.deepEqual(calls[1], ['count', 'technician-id', 'SELECTED'])
  assert.equal(calls[2][1], 'technician-id')
  assert.equal(result.items[0].canRespond, true)
  assert.equal(result.items[0].booking.address.city, 'Cần Thơ')
  assert.equal(result.items[0].matchScore, 95.5)
})

test('View Job History is scoped and ordered by newest terminal activity', async () => {
  const queries = []
  const repository = new ViewJobRequestsRepository({
    queryable: {
      async query(sql, params) { queries.push({ sql, params }); return { rows: [] } },
    },
  })
  await repository.countJobRequests('technician-id', 'HISTORY')
  await repository.findJobRequests('technician-id', {
    status: 'HISTORY', limit: 20, offset: 0,
  })
  assert.match(queries[0].sql, /\$2='HISTORY'/)
  assert.match(queries[0].sql, /'DECLINED','EXPIRED','COMPLETED','CANCELLED'/)
  assert.match(queries[1].sql, /CASE WHEN \$2='HISTORY'/)
  assert.match(queries[1].sql, /END DESC NULLS LAST/)
  assert.deepEqual(queries[1].params, ['technician-id', 'HISTORY', 20, 0])
})

test('View Job Requests repository derives expired requests and never returns recommendations', async () => {
  const queries = []
  const repository = new ViewJobRequestsRepository({
    queryable: {
      async query(sql, params) { queries.push({ sql, params }); return { rows: [] } },
    },
  })
  await repository.findJobRequests('technician-id', { status: 'EXPIRED', limit: 10, offset: 0 })
  assert.match(queries[0].sql, /bt\.expires_at<=CURRENT_TIMESTAMP/)
  assert.match(queries[0].sql, /bt\.status IN \('SELECTED','ACCEPTED','DECLINED','EXPIRED','COMPLETED','CANCELLED'\)/)
  assert.doesNotMatch(queries[0].sql, /IN \('RECOMMENDED'/)
  assert.deepEqual(queries[0].params, ['technician-id', 'EXPIRED', 10, 0])
})

test('GET View Job Requests requires CUSTOMER auth and returns no-store data', async () => {
  const calls = []
  const service = {
    async getViewJobRequests(id, query) {
      calls.push({ id, query })
      return { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }
    },
  }
  const app = express()
  app.use(express.json())
  app.use('/portal', createTechnicianPortalRouter({}, service))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/portal/job-requests?status=SELECTED`
  const token = (role) => jwt.sign({ role, purpose: 'access' }, env.jwtSecret, { subject: userId, expiresIn: '1m' })
  try {
    assert.equal((await fetch(base)).status, 401)
    assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${token('ADMIN')}` } })).status, 403)
    const response = await fetch(base, { headers: { Authorization: `Bearer ${token('CUSTOMER')}` } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(calls[0].id, userId)
    assert.equal(calls[0].query.status, 'SELECTED')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
