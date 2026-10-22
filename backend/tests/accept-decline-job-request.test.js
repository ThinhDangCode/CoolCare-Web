import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'

import { env } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { AcceptDeclineJobRequestRepository } from '../src/modules/technician-portal/accept-decline-job-request.repository.js'
import { AcceptDeclineJobRequestService } from '../src/modules/technician-portal/accept-decline-job-request.service.js'
import { validateAcceptDeclineJobRequest } from '../src/modules/technician-portal/accept-decline-job-request.validation.js'
import { createTechnicianPortalRouter } from '../src/modules/technician-portal/technician-portal.routes.js'

const userId = '12345678-1234-1234-1234-123456789012'
const requestId = '22345678-1234-1234-1234-123456789012'

test('Accept / Decline Job Request validation accepts strict actions and an optional decline reason', () => {
  assert.deepEqual(validateAcceptDeclineJobRequest({ action: 'ACCEPT' }), {
    action: 'ACCEPT', reason: null,
  })
  assert.deepEqual(validateAcceptDeclineJobRequest({ action: 'DECLINE', reason: '  Busy  ' }), {
    action: 'DECLINE', reason: 'Busy',
  })
  for (const body of [
    null,
    {},
    { action: 'accept' },
    { action: 'ACCEPT', reason: 'Not now' },
    { action: 'DECLINE', reason: 1 },
    { action: 'DECLINE', extra: true },
    { action: 'DECLINE', reason: 'x'.repeat(501) },
  ]) assert.throws(() => validateAcceptDeclineJobRequest(body), { status: 422 })
})

function repositoryFixture({ status = 'SELECTED', expiresAt = null, bookingStatus = 'TECHNICIAN_SELECTED', hasOverlappingJob = false } = {}) {
  const calls = []
  const repository = new AcceptDeclineJobRequestRepository({
    transaction: async (operation) => operation({
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM technician_profiles')) {
          return { rows: [{
            id: 'technician-id', user_id: userId, verification_status: 'VERIFIED',
            is_active: true, availability_status: 'ONLINE', account_status: 'ACTIVE',
          }] }
        }
        if (sql.includes('WITH windows AS')) {
          return { rows: [{ conflict: hasOverlappingJob }] }
        }
        if (sql.includes('FROM booking_technicians bt')) {
          return { rows: [{
            id: requestId, booking_id: 'booking-id', status, expires_at: expiresAt,
            expired: expiresAt !== null,
            booking_status: bookingStatus, booking_code: 'BK-001', customer_user_id: 'customer-id',
          }] }
        }
        if (sql.includes('can_recommend_technician')) return { rows: [{ allowed: true }] }
        if (sql.includes('UPDATE booking_technicians')) {
          return { rows: [{
            id: requestId, booking_id: 'booking-id',
            status: sql.includes("status='ACCEPTED'") ? 'ACCEPTED' : 'DECLINED',
            responded_at: '2026-10-15T08:00:00.000Z',
            decline_reason: params[2] ?? null,
          }] }
        }
        if (sql.includes('UPDATE bookings')) {
          return { rows: [{
            id: 'booking-id', booking_code: 'BK-001',
            status: sql.includes("status='ACCEPTED'") ? 'ACCEPTED' : 'PENDING',
            updated_at: '2026-10-15T08:00:00.000Z',
          }] }
        }
        return { rows: [] }
      },
    }),
  })
  return { repository, calls }
}

test('Accept atomically assigns the booking, records history, and notifies the customer', async () => {
  const { repository, calls } = repositoryFixture()
  const result = await repository.respond(userId, requestId, { action: 'ACCEPT', reason: null })
  assert.equal(result.status, 'ACCEPTED')
  assert.equal(result.booking.status, 'ACCEPTED')
  assert.ok(calls.some(({ sql }) => sql.includes('FOR UPDATE OF bt,b')))
  assert.ok(calls.some(({ sql }) => sql.includes('booking_status_history') && sql.includes("'ACCEPTED'")))
  assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO notifications') && params[0] === 'customer-id'))
})

test('Decline returns the booking to pending and preserves the reason', async () => {
  const { repository, calls } = repositoryFixture()
  const result = await repository.respond(userId, requestId, { action: 'DECLINE', reason: 'Busy' })
  assert.equal(result.status, 'DECLINED')
  assert.equal(result.decline_reason, 'Busy')
  assert.equal(result.booking.status, 'PENDING')
  assert.ok(calls.some(({ sql }) => sql.includes('booking_status_history') && sql.includes("'PENDING'")))
  assert.equal(calls.some(({ sql }) => sql.includes('cancelled_by_id')), false)
})

test('expired, already handled, and unavailable requests cannot be changed', async () => {
  await assert.rejects(
    repositoryFixture({ expiresAt: '2020-01-01T00:00:00.000Z' }).repository.respond(
      userId, requestId, { action: 'ACCEPT', reason: null },
    ),
    { status: 409, code: 'JOB_REQUEST_EXPIRED' },
  )
  await assert.rejects(
    repositoryFixture({ status: 'DECLINED' }).repository.respond(
      userId, requestId, { action: 'DECLINE', reason: null },
    ),
    { status: 409, code: 'JOB_REQUEST_ALREADY_RESPONDED' },
  )
  await assert.rejects(
    repositoryFixture({ bookingStatus: 'CANCELLED' }).repository.respond(
      userId, requestId, { action: 'ACCEPT', reason: null },
    ),
    { status: 409, code: 'JOB_REQUEST_UNAVAILABLE' },
  )
})

test('technician cannot accept another request in an overlapping service window', async () => {
  const { repository, calls } = repositoryFixture({ hasOverlappingJob: true })
  await assert.rejects(
    repository.respond(userId, requestId, { action: 'ACCEPT', reason: null }),
    { status: 409, code: 'TECHNICIAN_SCHEDULE_CONFLICT' },
  )
  assert.equal(calls.some(({ sql }) => sql.includes('UPDATE booking_technicians')), false)
  assert.equal(calls.some(({ sql }) => sql.includes('UPDATE bookings')), false)
})

test('response API requires CUSTOMER auth, validates IDs, and returns the new state', async () => {
  const calls = []
  const responseService = new AcceptDeclineJobRequestService({
    async respond(authUserId, id, body) {
      calls.push({ authUserId, id, body })
      return {
        id, booking_id: 'booking-id', status: body.action === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED',
        responded_at: '2026-10-15T08:00:00.000Z', decline_reason: body.reason,
        booking: { id: 'booking-id', booking_code: 'BK-001', status: 'ACCEPTED', updated_at: '2026-10-15T08:00:00.000Z' },
      }
    },
  })
  const app = express()
  app.use(express.json())
  app.use('/portal', createTechnicianPortalRouter({}, {}, responseService))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/portal/job-requests`
  const token = (role) => jwt.sign(
    { role, purpose: 'access' }, env.jwtSecret,
    { subject: userId, expiresIn: '1m' },
  )
  const send = (id, role, body) => fetch(`${base}/${id}/response`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token(role)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  try {
    assert.equal((await send(requestId, 'ADMIN', { action: 'ACCEPT' })).status, 403)
    assert.equal((await send('bad-id', 'CUSTOMER', { action: 'ACCEPT' })).status, 422)
    assert.equal((await send(requestId, 'CUSTOMER', { action: 'accept' })).status, 422)
    const response = await send(requestId, 'CUSTOMER', { action: 'ACCEPT' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.status, 'ACCEPTED')
    assert.deepEqual(calls[0], { authUserId: userId, id: requestId, body: { action: 'ACCEPT', reason: null } })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('service formats the response contract', async () => {
  const service = new AcceptDeclineJobRequestService({
    async respond() {
      return {
        id: requestId, booking_id: 'booking-id', status: 'DECLINED',
        responded_at: '2026-10-15T08:00:00.000Z', decline_reason: 'Busy',
        booking: { id: 'booking-id', booking_code: 'BK-001', status: 'CANCELLED', updated_at: '2026-10-15T08:00:00.000Z' },
      }
    },
  })
  const result = await service.respond(userId, requestId, { action: 'DECLINE', reason: 'Busy' })
  assert.equal(result.status, 'DECLINED')
  assert.equal(result.booking.status, 'CANCELLED')
  assert.equal(result.declineReason, 'Busy')
})
