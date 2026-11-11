import assert from 'node:assert/strict'
import test from 'node:test'

import { startDeparture } from '../src/modules/booking-travel/booking-travel.routes.js'

const bookingId = '12345678-1234-1234-1234-123456789012'
const userId = '22345678-1234-1234-1234-123456789012'
const position = { latitude: 10.03, longitude: 105.78 }

function fixture({ latitude = '10.08', longitude = '105.82', estimate = null } = {}) {
  const queries = []
  const saved = []
  const database = {
    async query(sql, params) {
      queries.push({ sql, params })
      if (sql.includes('JOIN booking_technicians bt')) {
        return { rows: [{ id: bookingId, latitude, longitude,
          scheduled_at: new Date(Date.now() + 60 * 60000) }] }
      }
      return { rows: [] }
    },
  }
  const dependencies = {
    database,
    transaction: async operation => operation(database),
    estimateRoute: async () => estimate,
    persist: async (id, data) => saved.push({ id, data }),
    readStatus: async () => ({ status: 'TRAVELLING' }),
  }
  return { dependencies, queries, saved }
}

test('departure is recorded even when the route provider has no ETA', async () => {
  const { dependencies, queries, saved } = fixture()
  const result = await startDeparture(userId, bookingId, position, dependencies)

  assert.equal(result.status, 'TRAVELLING')
  assert.equal(result.routing_available, false)
  assert.ok(queries.some(({ sql, params }) =>
    sql.includes('INSERT INTO booking_status_history') && params[2].includes('DEPARTED')))
  assert.ok(!queries.some(({ sql }) => sql.includes('INSERT INTO notifications')))
  assert.equal(saved[0].data.eta_at, null)
  assert.equal(saved[0].data.routing_available, false)
})

test('older bookings without destination GPS can still start travelling', async () => {
  const { dependencies, queries } = fixture({ latitude: null, longitude: null })
  dependencies.estimateRoute = async () => { throw new Error('Route provider should not be called') }

  const result = await startDeparture(userId, bookingId, position, dependencies)
  assert.equal(result.status, 'TRAVELLING')
  assert.equal(result.routing_available, false)
  assert.ok(queries.some(({ sql }) => sql.includes('INSERT INTO booking_status_history')))
})

test('a valid ETA is saved and a late arrival estimate still notifies the customer', async () => {
  const { dependencies, queries, saved } = fixture({ estimate: { seconds: 90 * 60, meters: 25000 } })

  const result = await startDeparture(userId, bookingId, position, dependencies)
  assert.equal(result.routing_available, true)
  assert.ok(saved[0].data.eta_at)
  assert.equal(saved[0].data.duration_seconds, 90 * 60)
  assert.ok(queries.some(({ sql }) => sql.includes('INSERT INTO notifications')))
})
