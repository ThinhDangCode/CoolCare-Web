import assert from 'node:assert/strict'
import test from 'node:test'

import { BookingDetailService } from '../src/modules/customer-bookings/booking-detail.service.js'

const customerUserId = '12345678-1234-1234-1234-123456789012'
const bookingId = '22345678-1234-1234-1234-123456789012'

function fixture(status = 'ACCEPTED') {
  const calls = []
  const repository = {
    async findOwnedBooking() {
      return { id: bookingId, status }
    },
    async findAcceptedAssignment() {
      calls.push('assignment')
      return { id: 'assignment-id', technician_user_id: 'technician-user-id' }
    },
    async confirmCompletion(userId, id, technicianUserId) {
      calls.push({ userId, id, technicianUserId })
      return {
        id, booking_code: 'BK-001', status: 'COMPLETED',
        completed_at: '2026-10-15T10:00:00.000Z', updated_at: '2026-10-15T10:00:00.000Z',
      }
    },
    async insertCompletionHistory() { calls.push('history') },
    async notifyTechnician() { calls.push('notification') },
  }
  const service = new BookingDetailService(
    repository,
    async (operation) => operation({ query: async () => ({ rows: [] }) }),
  )
  return { service, calls }
}

test('customer can complete an ACCEPTED booking before the technician confirms', async () => {
  const { service, calls } = fixture('ACCEPTED')
  const result = await service.confirmCompletion(customerUserId, bookingId)
  assert.equal(result.status, 'COMPLETED')
  assert.ok(calls.some((call) => call?.technicianUserId === 'technician-user-id'))
  assert.ok(calls.includes('history'))
  assert.ok(calls.includes('notification'))
})

test('customer confirmation completes a booking waiting for confirmation', async () => {
  const { service } = fixture('WAITING_CONFIRMATION')
  assert.equal((await service.confirmCompletion(customerUserId, bookingId)).status, 'COMPLETED')
})

test('customer cannot confirm an invalid or already completed booking', async () => {
  await assert.rejects(fixture('PENDING').service.confirmCompletion(customerUserId, bookingId), {
    status: 409, code: 'BOOKING_CANNOT_BE_COMPLETED',
  })
  await assert.rejects(fixture('COMPLETED').service.confirmCompletion(customerUserId, bookingId), {
    status: 409, code: 'BOOKING_ALREADY_COMPLETED',
  })
})
