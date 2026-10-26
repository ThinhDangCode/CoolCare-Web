import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../utils.js'
import { ChatService } from './chat.service.js'

let currentIo = null
export function setChatIo(io) { currentIo = io }

export function createChatRouter() {
  const router = Router()
  const service = new ChatService({ ioProvider: () => currentIo })
  router.use(authenticate)

  router.get('/rooms', asyncHandler(async (req, res) => {
    res.json({ data: await service.listRooms(req.auth.userId) })
  }))

  router.post('/bookings/:bookingId/room', asyncHandler(async (req, res) => {
    const room = await service.getOrCreateRoom(req.params.bookingId, req.auth.userId, req.auth.role)
    res.status(200).json({ data: room })
  }))

  router.get('/rooms/:roomId/messages', asyncHandler(async (req, res) => {
    const messages = await service.listMessages(
      req.params.roomId, req.auth.userId, req.auth.role,
      req.query.limit, req.query.before || null
    )
    res.json({ data: messages })
  }))

  router.post('/rooms/:roomId/messages', asyncHandler(async (req, res) => {
    const message = await service.sendMessage(
      req.params.roomId, req.auth.userId, req.auth.role, req.body?.content
    )
    res.status(201).json({ data: message })
  }))

  return router
}
