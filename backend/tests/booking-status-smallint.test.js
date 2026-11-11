import assert from 'node:assert/strict'
import test from 'node:test'
import { storageCode } from '../src/config/database-codebooks.js'

test('booking and assignment statuses normalize both database smallint and API labels', () => {
  for (const [table, status, expected] of [
    ['bookings', 'ACCEPTED', 2],
    ['bookings', 'WAITING_CONFIRMATION', 8],
    ['bookings', 'COMPLETED', 9],
    ['booking_technicians', 'ACCEPTED', 2],
    ['booking_technicians', 'COMPLETED', 6],
  ]) {
    assert.equal(storageCode(table, 'status', status), expected)
    assert.equal(storageCode(table, 'status', expected), expected)
  }
})
