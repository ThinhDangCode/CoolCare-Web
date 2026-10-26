import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import { io as connect } from 'socket.io-client'

process.env.JWT_SECRET = 'x'.repeat(40)
const { configureChatSocket } = await import('../src/modules/chat/chat.socket.js')
const { ChatService } = await import('../src/modules/chat/chat.service.js')

const token = (sub, role) => jwt.sign({ sub, role, purpose: 'access' }, process.env.JWT_SECRET, { expiresIn: '5m' })
const members = { 'room-1': { CUSTOMER: 'u-customer', TECHNICIAN: 'u-tech' } }

const db = {
  async query(sql, params) {
    if (sql.includes('FROM chat_rooms cr')) {
      const [roomId, userId] = params
      return { rows: Object.values(members[roomId] ?? {}).includes(userId) ? [{ id: roomId, booking_id: 'b1', customer_user_id: members[roomId].CUSTOMER, technician_user_id: members[roomId].TECHNICIAN }] : [] }
    }
    if (sql.includes('INSERT INTO chat_messages')) {
      return { rows: [{ id: 'm1', room_id: params[0], sender_id: params[1], message_type: 0, content: params[2], created_at: new Date().toISOString() }] }
    }
    if (sql.includes('FROM users')) return { rows: [{ full_name: 'A', status: 'ACTIVE' }] }
    return { rows: [] }
  },
}

async function setup() {
  const httpServer = createServer()
  const io = new Server(httpServer)
  configureChatSocket(io, { db })
  await new Promise(r => httpServer.listen(0, r))
  const url = `http://localhost:${httpServer.address().port}`
  return { io, httpServer, url, service: new ChatService({ db, ioProvider: () => io }) }
}
const client = (url, t) => connect(url, { auth: { token: t }, transports: ['websocket'], reconnection: false })
const join = (c, roomId) => new Promise(r => c.emit('chat:join', { roomId }, r))

test('realtime delivery only reaches room members; outsiders are refused', async () => {
  const { io, httpServer, url, service } = await setup()
  const tech = client(url, token('u-tech', 'TECHNICIAN'))
  const outsider = client(url, token('u-other', 'CUSTOMER'))
  try {
    assert.deepEqual(await join(tech, 'room-1'), { ok: true })
    assert.deepEqual(await join(outsider, 'room-1'), { ok: false, error: 'CHAT_FORBIDDEN' })
    const got = new Promise(r => tech.once('chat:message', r))
    let leaked = false
    outsider.on('chat:message', () => { leaked = true })
    await service.sendMessage('room-1', 'u-customer', 'CUSTOMER', ' xin chào ')
    assert.equal((await got).content, 'xin chào')
    await new Promise(r => setTimeout(r, 100))
    assert.equal(leaked, false)
  } finally { tech.close(); outsider.close(); io.close(); httpServer.close() }
})

test('other party gets a personal chat:notify even without joining the room', async () => {
  const { io, httpServer, url, service } = await setup()
  const tech = client(url, token('u-tech', 'TECHNICIAN'))
  try {
    await new Promise(r => tech.once('connect', r))
    const ping = new Promise(r => tech.once('chat:notify', r))
    await service.sendMessage('room-1', 'u-customer', 'CUSTOMER', 'hi')
    const got = await ping
    assert.equal(got.roomId, 'room-1')
    assert.equal(got.message.content, 'hi')
  } finally { tech.close(); io.close(); httpServer.close() }
})

test('socket without a valid token is rejected', async () => {
  const { io, httpServer, url } = await setup()
  const c = client(url, 'bad')
  try {
    const err = await new Promise(r => c.once('connect_error', r))
    assert.match(err.message, /INVALID_TOKEN/)
  } finally { c.close(); io.close(); httpServer.close() }
})
