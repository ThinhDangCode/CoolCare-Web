import assert from 'node:assert/strict'
import test from 'node:test'

import { CancelAcceptedJobRepository } from '../src/modules/technician-portal/cancel-accepted-job.repository.js'
import { CancelAcceptedJobService } from '../src/modules/technician-portal/cancel-accepted-job.service.js'
import { validateCancelAcceptedJob } from '../src/modules/technician-portal/cancel-accepted-job.validation.js'

const userId = '12345678-1234-1234-1234-123456789012'
const requestId = '22345678-1234-1234-1234-123456789012'

test('Cancel Accepted Job requires a trimmed reason of 5-500 characters', () => {
  assert.deepEqual(validateCancelAcceptedJob({ reason: '  Emergency  ' }), { reason: 'Emergency' })
  for (const body of [null, {}, { reason: 'busy' }, { reason: 1 }, { reason: 'valid reason', extra: true }, { reason: 'x'.repeat(501) }]) {
    assert.throws(() => validateCancelAcceptedJob(body), { status: 422 })
  }
})

function fixture({ requestStatus = 'ACCEPTED', bookingStatus = 'ACCEPTED', completedAt = null, scheduledAt = '2026-11-15T10:00:00.000Z' } = {}) {
  const calls = []
  const repository = new CancelAcceptedJobRepository({
    transaction: async (operation) => operation({
      async query(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('FROM technician_profiles')) return { rows: [{
          id: 'technician-id', user_id: userId, verification_status: 'VERIFIED',
          is_active: true, account_status: 'ACTIVE',
        }] }
        if (sql.includes('FROM booking_technicians bt')) return { rows: [{
          id: requestId, booking_id: 'booking-id', status: requestStatus,
          booking_status: bookingStatus, booking_code: 'BK-001',
          technician_completed_at: completedAt, customer_user_id: 'customer-id',
          scheduled_at: scheduledAt,
        }] }
        if (sql.includes('UPDATE booking_technicians')) return { rows: [{
          id: requestId, booking_id: 'booking-id', status: 'CANCELLED',
          cancelled_at: '2026-10-15T10:00:00.000Z', cancellation_reason: params[2],
        }] }
        if (sql.includes('UPDATE bookings')) return { rows: [{
          id: 'booking-id', booking_code: 'BK-001', status: 'PENDING',
          cancelled_at: '2026-10-15T10:00:00.000Z', cancellation_reason: params[2],
          updated_at: '2026-10-15T10:00:00.000Z',
        }] }
        if (sql.includes('INSERT INTO technician_penalties')) return { rows: [{
          id: 'penalty-id', penalty_type: 'CANCELLATION', penalty_points: params[2],
          status: 'ACTIVE', applied_at: '2026-10-15T10:00:00.000Z',
          expires_at: null,
        }] }
        return { rows: [] }
      },
    }),
  })
  return { repository, calls }
}

test('accepted job cancellation returns booking to pending and records two points without expiry', async () => {
  const { repository, calls } = fixture()
  const result = await repository.cancel(userId, requestId, 'Family emergency')
  assert.equal(result.status, 'CANCELLED')
  assert.equal(result.booking.status, 'PENDING')
  assert.equal(result.penalty.penalty_points, 2)
  assert.equal(result.penalty.expires_at, null)
  assert.ok(calls.some(({ sql }) => sql.includes('booking_status_history') && sql.includes("'PENDING'")))
  assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO notifications') && params[0] === 'customer-id'))
  assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO technician_penalties') && params[2] === 2 && sql.includes('CURRENT_TIMESTAMP,NULL')))
})

test('cancellation applies the same penalty before or after the appointment', async () => {
  for (const scheduledAt of ['2026-11-15T10:00:00.000Z', '2026-10-14T10:00:00.000Z']) {
    const { repository, calls } = fixture({ scheduledAt })
    assert.equal((await repository.cancel(userId, requestId, 'Family emergency')).penalty.penalty_points, 2)
    assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO technician_penalties')).length, 1)
  }
})

test('non-accepted and completion-submitted jobs cannot be cancelled', async () => {
  await assert.rejects(fixture({ requestStatus: 'SELECTED' }).repository.cancel(userId, requestId, 'Emergency'), {
    status: 409, code: 'ACCEPTED_JOB_CANNOT_BE_CANCELLED',
  })
  await assert.rejects(fixture({ bookingStatus: 'WAITING_CONFIRMATION', completedAt: new Date() }).repository.cancel(userId, requestId, 'Emergency'), {
    status: 409, code: 'JOB_COMPLETION_ALREADY_SUBMITTED',
  })
})

test('Cancel Accepted Job service formats cancellation and penalty', async () => {
  const service = new CancelAcceptedJobService({
    async cancel() {
      return {
        id: requestId, booking_id: 'booking-id', status: 'CANCELLED',
        cancelled_at: '2026-10-15T10:00:00.000Z', cancellation_reason: 'Emergency',
        booking: {
          id: 'booking-id', booking_code: 'BK-001', status: 'PENDING',
          cancelled_at: '2026-10-15T10:00:00.000Z', cancellation_reason: 'Emergency',
          updated_at: '2026-10-15T10:00:00.000Z',
        },
        penalty: { id: 'penalty-id', penalty_type: 'CANCELLATION', penalty_points: 2, status: 'ACTIVE' },
      }
    },
  })
  const result = await service.cancel(userId, requestId, { reason: 'Emergency' })
  assert.equal(result.booking.status, 'PENDING')
  assert.equal(result.penalty.points, 2)
})
