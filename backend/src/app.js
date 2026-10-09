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

import { AddressRepository } from './modules/address/address.repository.js'
import { AddressService } from './modules/address/address.service.js'
import { AddressController } from './modules/address/address.controller.js'
import { createAddressRouter } from './modules/address/address.routes.js'

//  AUTH 

const authRepository = new AuthRepository()

const authService = new AuthService({
  repository: authRepository,
  emailSender: createEmailSender(),
  googleTokenVerifier: new GoogleTokenVerifier(),
})
const authController = new AuthController(authService)

// ADDRESS
const addressRepository = new AddressRepository()
const addressService = new AddressService(addressRepository)
const addressController = new AddressController(addressService)

// APP
export const app = express()

app.disable('x-powered-by')

app.use(cors({
  origin(origin, callback) {
    if (
      !origin ||
      env.corsOrigins.length === 0 ||
      env.corsOrigins.includes(origin)
    ) {
      return callback(null, true)
    }

    return callback(null, false)
  },
}))

app.use(express.json({ limit: '1mb' }))

// HEALTH
app.get('/api/health', asyncHandler(async (_request, response) => {
  await pool.query('SELECT 1')

  response.json({
    data: {
      status: 'OK',
      database: 'CONNECTED',
    },
  })
}))

// AUTH
app.use('/api/auth', createAuthRouter(authController))
app.use('/api/admin/catalog', createCatalogRouter())
app.use('/api/catalog', createCatalogRouter(undefined, false))

// ADDRESS
app.use(
  '/api/addresses',
  createAddressRouter(addressController),
)

// SERVICES
app.get('/api/services', asyncHandler(async (_request, response) => {
  const result = await pool.query(`
    SELECT
      id,
      category_id,
      name,
      description,
      base_price,
      estimated_duration,
      maintenance_interval_days,
      is_active
    FROM services
    WHERE is_active = true
    ORDER BY name ASC
  `)

  response.json({
    data: result.rows,
  })
}))

//SERVICE DETAIL
app.get('/api/services/:id', asyncHandler(async (request, response) => {
  const result = await pool.query(
    `
      SELECT
        id,
        category_id,
        name,
        description,
        base_price,
        estimated_duration,
        maintenance_interval_days,
        is_active
      FROM services
      WHERE id = $1
        AND is_active = true
      LIMIT 1
    `,
    [request.params.id],
  )

  if (result.rows.length === 0) {
    return response.status(404).json({
      error: {
        message: 'Service not found',
      },
    })
  }

  response.json({
    data: result.rows[0],
  })
}))
app.use(notFoundHandler)
app.use(errorHandler)