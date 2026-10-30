import assert from 'node:assert/strict'
import test from 'node:test'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import express from 'express'

process.env.JWT_SECRET ||= 'x'.repeat(40)
const { env } = await import('../src/config/env.js')
const { pool } = await import('../src/config/database.js')
const { AuthService } = await import('../src/modules/auth/auth.service.js')
const { authenticate } = await import('../src/middleware/authenticate.js')
const { errorHandler } = await import('../src/middleware/error-handler.js')

test('second login rejects the first token and logout revokes the current token', async () => {
  const user = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'customer@example.com',
    password_hash: await bcrypt.hash('test-password', 4),
    email_verified_at: new Date(),
    status: 'ACTIVE',
    role: 'CUSTOMER',
  }
  let activeSessionId = null
  let nextSessionId = 0
  const repository = {
    findUserByEmail: async () => user,
    findUserById: async () => user,
    startSession: async () => { activeSessionId = String(++nextSessionId); return activeSessionId },
    isCurrentSession: async (_userId, sessionId) => activeSessionId === sessionId,
    endSession: async (_userId, sessionId) => {
      if (activeSessionId === sessionId) activeSessionId = String(++nextSessionId)
    },
  }
  const service = new AuthService({ repository })
  const first = await service.login({ email: user.email, password: 'test-password' })
  const second = await service.login({ email: user.email, password: 'test-password' })
  const firstId = jwt.verify(first.token, env.jwtSecret).jti
  const secondId = jwt.verify(second.token, env.jwtSecret).jti
  assert.notEqual(firstId, secondId)
  assert.equal(activeSessionId, secondId)

  const originalQuery = pool.query
  pool.query = async () => ({ rows: [{ session_id: activeSessionId, status: 'ACTIVE' }] })
  const app = express()
  app.get('/protected', authenticate, (_request, response) => response.json({ ok: true }))
  app.use(errorHandler)
  const server = app.listen(0)
  const url = `http://127.0.0.1:${server.address().port}/protected`
  const request = token => fetch(url, { headers: { authorization: `Bearer ${token}` } })
  try {
    const oldResponse = await request(first.token)
    assert.equal(oldResponse.status, 401)
    assert.equal((await oldResponse.json()).error.code, 'SESSION_REPLACED')
    assert.equal((await request(second.token)).status, 200)

    const refreshed = await service.refreshSession(user.id, secondId)
    assert.equal(jwt.verify(refreshed.token, env.jwtSecret).jti, secondId)
    await service.endSession(user.id, firstId)
    assert.equal((await request(second.token)).status, 200)
    await service.endSession(user.id, secondId)
    assert.equal((await request(second.token)).status, 401)
  } finally {
    pool.query = originalQuery
    await new Promise(resolve => server.close(resolve))
  }
})
