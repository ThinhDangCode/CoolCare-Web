import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'

import { env } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { UpdateJobStatusRepository } from '../src/modules/technician-portal/update-job-status.repository.js'
import { UpdateJobStatusService } from '../src/modules/technician-portal/update-job-status.service.js'
import { validateUpdateJobStatus } from '../src/modules/technician-portal/update-job-status.validation.js'
import { createTechnicianPortalRouter } from '../src/modules/technician-portal/technician-portal.routes.js'

const userId = '12345678-1234-1234-1234-123456789012'
const requestId = '22345678-1234-1234-1234-123456789012'

test('Update Job Status only accepts COMPLETED', () => {
  assert.deepEqual(validateUpdateJobStatus({ status: 'COMPLETED' }), { status: 'COMPLETED' })
  for (const body of [null, {}, { status: 'completed' }, { status: 'COMPLETED', extra: true }]) {
    assert.throws(() => validateUpdateJobStatus(body), { status: 422 })
  }
})

function fixture({ requestStatus = 'ACCEPTED', bookingStatus = 'ACCEPTED' } = {}) {
  const calls = []
  const repository = new UpdateJobStatusRepository({
    transaction: async (operation) => operation({
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM technician_profiles')) return { rows: [{
          id: 'technician-id', user_id: userId, verification_status: 'VERIFIED',
          is_active: true, account_status: 'ACTIVE',
        }] }
        if (sql.includes('FROM booking_technicians bt')) return { rows: [{
          id: requestId, booking_id: 'booking-id', status: requestStatus,
          booking_status: bookingStatus, booking_code: 'BK-001', customer_user_id: 'customer-id',
        }] }
        if (sql.includes('FROM booking_unit_services')) return { rows: [{
          booking_unit_service_id: 'booking-service-id', service_id: 'service-id',
          name: 'Cleaning', unit_price: 100000,
        }] }
        if (sql.includes('INSERT INTO quotations')) return { rows: [{
          id: 'quotation-id', status: 'ACCEPTED',
        }] }
        if (sql.includes('UPDATE bookings')) return { rows: [{
          id: 'booking-id', booking_code: 'BK-001', status: 'WAITING_CONFIRMATION',
          completed_at: null, updated_at: '2026-10-15T09:00:00.000Z',
        }] }
        return { rows: [] }
      },
    }),
  })
  return { repository, calls }
}

test('technician completion waits for the customer and keeps the assignment active', async () => {
  const { repository, calls } = fixture()
  const result = await repository.complete(userId, requestId)
  assert.equal(result.status, 'ACCEPTED')
  assert.equal(result.booking.status, 'WAITING_CONFIRMATION')
  assert.ok(calls.some(({ sql }) => sql.includes('technician_completed_at=CURRENT_TIMESTAMP')))
  assert.ok(calls.some(({ sql }) => sql.includes('booking_status_history') && sql.includes("'WAITING_CONFIRMATION'")))
  assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO notifications') && params[0] === 'customer-id'))
})

test('only an active accepted job can be completed', async () => {
  await assert.rejects(fixture({ requestStatus: 'SELECTED' }).repository.complete(userId, requestId), {
    status: 409, code: 'JOB_CANNOT_BE_COMPLETED',
  })
  await assert.rejects(
    fixture({ requestStatus: 'COMPLETED', bookingStatus: 'COMPLETED' }).repository.complete(userId, requestId),
    { status: 409, code: 'JOB_ALREADY_COMPLETED' },
  )
})

test('Update Job Status service formats the waiting confirmation response', async () => {
  const service = new UpdateJobStatusService({
    async complete() {
      return {
        id: requestId, booking_id: 'booking-id', status: 'ACCEPTED',
        booking: {
          id: 'booking-id', booking_code: 'BK-001', status: 'WAITING_CONFIRMATION',
          completed_at: null, updated_at: '2026-10-15T09:00:00.000Z',
        },
      }
    },
  })
  const result = await service.update(userId, requestId, { status: 'COMPLETED' })
  assert.equal(result.status, 'ACCEPTED')
  assert.equal(result.booking.status, 'WAITING_CONFIRMATION')
  assert.equal(result.booking.code, 'BK-001')
})

test('Update Job Status API enforces auth and returns WAITING_CONFIRMATION', async () => {
  const service = new UpdateJobStatusService({
    async complete() {
      return {
        id: requestId, booking_id: 'booking-id', status: 'ACCEPTED',
        booking: {
          id: 'booking-id', booking_code: 'BK-001', status: 'WAITING_CONFIRMATION',
          completed_at: null, updated_at: '2026-10-15T09:00:00.000Z',
        },
      }
    },
  })
  const app = express()
  app.use(express.json())
  app.use('/portal', createTechnicianPortalRouter({}, {}, {}, service))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const token = (role) => jwt.sign(
    { role, purpose: 'access' }, env.jwtSecret,
    { subject: userId, expiresIn: '1m' },
  )
  const send = (role, body) => fetch(
    `http://127.0.0.1:${server.address().port}/portal/job-requests/${requestId}/status`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token(role)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  try {
    assert.equal((await send('ADMIN', { status: 'COMPLETED' })).status, 403)
    assert.equal((await send('CUSTOMER', { status: 'ACCEPTED' })).status, 422)
    const response = await send('CUSTOMER', { status: 'COMPLETED' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.booking.status, 'WAITING_CONFIRMATION')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
