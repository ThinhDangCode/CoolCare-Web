import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createTechnicianNotificationsRouter } from '../src/modules/notifications/technician-notifications.routes.js'
import { TechnicianNotificationsRepository } from '../src/modules/notifications/technician-notifications.repository.js'

const userId = '12345678-1234-1234-1234-123456789012'

test('listing technician notifications backfills older reviews without duplicates', async () => {
  const queries = []
  const repository = new TechnicianNotificationsRepository({
    query: async (sql, params) => {
      queries.push({ sql, params })
      if (sql.includes('count(*)::int AS total')) {
        return { rows: [{ total: 0, unread_count: 0 }] }
      }
      return { rows: [], rowCount: 0 }
    },
  })

  await repository.list(userId, { unreadOnly: false, limit: 20, offset: 0 })

  assert.match(queries[0].sql, /INSERT INTO notifications/)
  assert.match(queries[0].sql, /FROM reviews r/)
  assert.match(queries[0].sql, /NOT EXISTS/)
  assert.match(queries[0].sql, /n\.title='Bạn nhận được đánh giá mới'/)
  assert.deepEqual(queries[0].params, [userId])
})

test('technician notifications use the customer session shared by technician mode', async () => {
  const calls = []
  const service = {
    async list(id) {
      calls.push(id)
      return { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0, unreadCount: 0 } }
    },
    async markRead() { return {} },
    async markAllRead() { return { updatedCount: 0 } },
  }
  const app = express()
  app.use(express.json())
  app.use('/notifications', createTechnicianNotificationsRouter(service))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/notifications`
  const token = role => jwt.sign(
    { role, purpose: 'access' },
    env.jwtSecret,
    { subject: userId, expiresIn: '1m' },
  )
  try {
    const customerResponse = await fetch(base, {
      headers: { Authorization: `Bearer ${token('CUSTOMER')}` },
    })
    assert.equal(customerResponse.status, 200)
    assert.deepEqual(calls, [userId])

    const adminResponse = await fetch(base, {
      headers: { Authorization: `Bearer ${token('ADMIN')}` },
    })
    assert.equal(adminResponse.status, 403)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
