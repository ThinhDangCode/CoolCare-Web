import assert from 'node:assert/strict'
import test from 'node:test'
import { BookingDetailService } from '../src/modules/customer-bookings/booking-detail.service.js'

const customerUserId = '12345678-1234-1234-1234-123456789012'
const bookingId = '22345678-1234-1234-1234-123456789012'

function fixture({ status = 'WAITING_CONFIRMATION', technicianCompletedAt = '2026-10-15T09:00:00Z', completionConfirmedAt = null, resultStatus = 'COMPLETED' } = {}) {
  const calls = []
  const repository = {
    async findOwnedBooking() {
      return { id: bookingId, status, technician_completed_at: technicianCompletedAt, completion_confirmed_at: completionConfirmedAt }
    },
    async findAcceptedAssignment() {
      calls.push('assignment')
      return { id: 'assignment-id', technician_user_id: 'technician-user-id' }
    },
    async confirmCompletion(userId, id, db) {
      calls.push({ userId, id, db })
      return { id, booking_code: 'BK-001', status: resultStatus, completed_at: '2026-10-15T10:00:00Z', updated_at: '2026-10-15T10:00:00Z' }
    },
    async insertCompletionHistory() { calls.push('history') },
    async notifyTechnician() { calls.push('notification') },
  }
  const service = new BookingDetailService(repository, async (operation) => operation({ query: async () => ({ rows: [] }) }))
  return { service, calls }
}

test('customer confirms after technician completes and receives COMPLETED status', async () => {
  const { service, calls } = fixture()
  assert.equal((await service.confirmCompletion(customerUserId, bookingId)).status, 'COMPLETED')
  assert.ok(calls.some(call => call?.userId === customerUserId && call?.id === bookingId))
  assert.ok(calls.includes('history'))
  assert.ok(calls.includes('notification'))
})

test('customer cannot confirm before technician completes, even if booking is waiting', async () => {
  const { service, calls } = fixture({ technicianCompletedAt: null })
  await assert.rejects(service.confirmCompletion(customerUserId, bookingId), { status: 409, code: 'TECHNICIAN_NOT_COMPLETED' })
  assert.deepEqual(calls, [])
})

test('customer cannot complete an ACCEPTED booking', async () => {
  const { service, calls } = fixture({ status: 'ACCEPTED', technicianCompletedAt: null })
  await assert.rejects(service.confirmCompletion(customerUserId, bookingId), { status: 409, code: 'TECHNICIAN_NOT_COMPLETED' })
  assert.deepEqual(calls, [])
})

test('customer cannot confirm invalid or already completed booking', async () => {
  await assert.rejects(fixture({ status: 'PENDING' }).service.confirmCompletion(customerUserId, bookingId), { status: 409, code: 'COMPLETION_NOT_ALLOWED' })
  await assert.rejects(fixture({ status: 'COMPLETED' }).service.confirmCompletion(customerUserId, bookingId), { status: 409, code: 'COMPLETION_ALREADY_CONFIRMED' })
  await assert.rejects(fixture({ completionConfirmedAt: '2026-10-15T10:00:00Z' }).service.confirmCompletion(customerUserId, bookingId), { status: 409, code: 'COMPLETION_ALREADY_CONFIRMED' })
})

test('no history or notification if database does not transition to COMPLETED', async () => {
  const { service, calls } = fixture({ resultStatus: 'WAITING_CONFIRMATION' })
  await assert.rejects(service.confirmCompletion(customerUserId, bookingId), { status: 409, code: 'BOOKING_COMPLETION_FAILED' })
  assert.ok(!calls.includes('history'))
  assert.ok(!calls.includes('notification'))
})
