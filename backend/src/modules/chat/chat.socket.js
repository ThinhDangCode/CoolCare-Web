import { verifyAccessToken } from '../../middleware/authenticate.js'
import { pool } from '../../config/database.js'
import { ChatService } from './chat.service.js'

export function configureChatSocket(io, { db = pool } = {}) {
  const service = new ChatService({ db, ioProvider: () => io })

  // Same rules as the REST `authenticate` middleware (incl. expired-customer leniency
  // and locked technician accounts) so REST and realtime never disagree.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (!token) return next(new Error('UNAUTHENTICATED'))
      const payload = verifyAccessToken(token)
      if (payload.purpose !== 'access' || !payload.sub || !payload.role) {
        return next(new Error('INVALID_TOKEN'))
      }
      if (payload.role === 'TECHNICIAN') {
        const { rows } = await db.query('SELECT status FROM users WHERE id=$1', [payload.sub])
        if (!rows[0] || rows[0].status !== 'ACTIVE') return next(new Error('ACCOUNT_UNAVAILABLE'))
      }
      socket.data.auth = { userId: payload.sub, role: payload.role }
      next()
    } catch {
      next(new Error('INVALID_TOKEN'))
    }
  })

  io.on('connection', socket => {
    // Personal channel for inbox/badge pings (see ChatService.sendMessage).
    socket.join(`user:${socket.data.auth.userId}`)

    socket.on('chat:join', async ({ roomId } = {}, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {}
      try {
        if (!roomId) throw new Error('ROOM_REQUIRED')
        // Membership is re-checked on every join; clients cannot subscribe to arbitrary rooms.
        await service.assertRoomAccess(roomId, socket.data.auth.userId, socket.data.auth.role)
        for (const room of socket.rooms) {
          if (room.startsWith('chat:')) socket.leave(room)
        }
        socket.join(`chat:${roomId}`)
        ack({ ok: true })
      } catch {
        ack({ ok: false, error: 'CHAT_FORBIDDEN' })
      }
    })

    socket.on('chat:leave', ({ roomId } = {}) => {
      if (roomId) socket.leave(`chat:${roomId}`)
    })

    // Typing indicator: ephemeral, never stored. Only forwarded to members already in the room.
    socket.on('chat:typing', ({ roomId, typing } = {}) => {
      if (!roomId || !socket.rooms.has(`chat:${roomId}`)) return
      socket.to(`chat:${roomId}`).emit('chat:typing', {
        roomId, userId: socket.data.auth.userId, typing: typing === true,
      })
    })
  })
}
