import cors from 'cors'
import express from 'express'
import { pool } from './config/database.js'
import { env } from './config/env.js'
import { asyncHandler } from './utils.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { AuthController } from './modules/auth/auth.controller.js'
import { createEmailSender } from './modules/auth/email.service.js'
import { AuthRepository } from './modules/auth/auth.repository.js'
import { createAuthRouter } from './modules/auth/auth.routes.js'
import { AuthService } from './modules/auth/auth.service.js'
import { GoogleTokenVerifier } from './modules/auth/google-token-verifier.js'
import { createCatalogRouter } from './modules/catalog/catalog.routes.js'

const authRepository = new AuthRepository()
const authService = new AuthService({
  repository: authRepository,
  emailSender: createEmailSender(),
  googleTokenVerifier: new GoogleTokenVerifier(),
})
const authController = new AuthController(authService)

export const app = express()

app.disable('x-powered-by')
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.corsOrigins.length === 0 || env.corsOrigins.includes(origin)) {
      return callback(null, true)
    }
    return callback(null, false)
  },
}))
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', asyncHandler(async (_request, response) => {
  await pool.query('SELECT 1')
  response.json({ data: { status: 'OK', database: 'CONNECTED' } })
}))

app.use('/api/auth', createAuthRouter(authController))
app.use('/api/admin/catalog', createCatalogRouter())
app.use('/api/catalog', createCatalogRouter(undefined, false))
app.use(notFoundHandler)
app.use(errorHandler)
