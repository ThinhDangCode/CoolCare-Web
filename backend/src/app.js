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
import { createTechnicianRouter } from './modules/technicians/technician.routes.js'
import { createBookingRouter } from './modules/bookings/booking.routes.js'
import { BlogController } from './modules/blogs/blog.controller.js'
import { BlogRepository } from './modules/blogs/blog.repository.js'
import { createAdminBlogRouter, createBlogRouter } from './modules/blogs/blog.routes.js'
import { BlogService } from './modules/blogs/blog.service.js'
import { ReviewController } from './modules/reviews/review.controller.js'
import { ReviewRepository } from './modules/reviews/review.repository.js'
import { createReviewRouter } from './modules/reviews/review.routes.js'
import { ReviewService } from './modules/reviews/review.service.js'
import { VoucherController } from './modules/vouchers/voucher.controller.js'
import { VoucherRepository } from './modules/vouchers/voucher.repository.js'
import { createAdminVoucherRouter, createVoucherRouter } from './modules/vouchers/voucher.routes.js'
import { VoucherService } from './modules/vouchers/voucher.service.js'
import { UserController } from './modules/users/user.controller.js'
import { UserRepository } from './modules/users/user.repository.js'
import { createUserRouter } from './modules/users/user.routes.js'
import { UserService } from './modules/users/user.service.js'
import { ComplaintController } from './modules/complaints/complaint.controller.js'
import { ComplaintRepository } from './modules/complaints/complaint.repository.js'
import { createComplaintRouter } from './modules/complaints/complaint.routes.js'
import { ComplaintService } from './modules/complaints/complaint.service.js'
import { createQuotationRouter } from './modules/quotations/quotation.routes.js'
import { createPaymentsRouter } from './modules/payments/payments.routes.js'
import { createCustomerPaymentRouter } from './modules/payments/customer-payment.routes.js'
import { createRevenueRouter } from './modules/revenue/revenue.routes.js'
import { createWithdrawalsRouter } from './modules/withdrawals/withdrawals.routes.js'
import { createTopupsRouter } from './modules/topups/topups.routes.js'
import { createTechnicianApplicationRouter } from './modules/technician-applications/technician-application.routes.js'
import { createTechnicianPortalRouter } from './modules/technician-portal/technician-portal.routes.js'
import { createServiceCategoryRouter } from './modules/services/service-category.routes.js'

import { AddressRepository } from './modules/address/address.repository.js'
import { AddressService } from './modules/address/address.service.js'
import { AddressController } from './modules/address/address.controller.js'
import { createAddressRouter } from './modules/address/address.routes.js'
// CUSTOMER BOOKING
import { CustomerBookingRepository } from './modules/customer-bookings/customer-booking.repository.js'
import { CustomerBookingService } from './modules/customer-bookings/customer-booking.service.js'
import { CustomerBookingController } from './modules/customer-bookings/customer-booking.controller.js'
import { createCustomerBookingRouter } from './modules/customer-bookings/customer-booking.routes.js'
import { TechnicianMatchingRepository } from './modules/customer-bookings/technician-matching.repository.js'
import { TechnicianMatchingService } from './modules/customer-bookings/technician-matching.service.js'
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

// BLOG
const blogController = new BlogController(new BlogService(new BlogRepository()))

// REVIEW
const reviewController = new ReviewController(new ReviewService(new ReviewRepository()))

// VOUCHER
const voucherController = new VoucherController(new VoucherService(new VoucherRepository()))

// USER MANAGEMENT
const userController = new UserController(new UserService(new UserRepository()))
const complaintController = new ComplaintController(new ComplaintService(new ComplaintRepository()))
// Customer Booking - #34
const customerBookingRepository = new CustomerBookingRepository()
const customerBookingService = new CustomerBookingService(customerBookingRepository)
// Technician Recommendation and Selection
const technicianMatchingRepository = new TechnicianMatchingRepository()
const technicianMatchingService = new TechnicianMatchingService(technicianMatchingRepository)
// Shared Customer Booking Controller
const customerBookingController = new CustomerBookingController(customerBookingService, technicianMatchingService)

// APP
export const app = express()

app.disable('x-powered-by')

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.length === 0 || env.corsOrigins.includes(origin)) {
        return callback(null, true)
      }

      return callback(null, false)
    },
  })
)

app.use(express.json({ limit: '1mb' }))

// HEALTH
app.get(
  '/api/health',
  asyncHandler(async (_request, response) => {
    await pool.query('SELECT 1')

    response.json({
      data: {
        status: 'OK',
        database: 'CONNECTED',
      },
    })
  })
)

// AUTH
app.use('/api/auth', createAuthRouter(authController))
app.use('/api/admin/catalog', createCatalogRouter())
app.use('/api/admin/users', createUserRouter(userController))
app.use('/api/admin/blogs', createAdminBlogRouter(blogController))
app.use('/api/admin/complaints', createComplaintRouter(complaintController))
app.use('/api/admin', createAdminVoucherRouter(voucherController))
app.use('/api/admin/payments', createPaymentsRouter())
app.use('/api/payments', createCustomerPaymentRouter())
app.use('/api/admin/revenue', createRevenueRouter())
app.use('/api/admin/withdrawals', createWithdrawalsRouter())
app.use('/api/admin/topups', createTopupsRouter())
app.use('/api/admin/technicians', createTechnicianRouter())
app.use('/api/admin/bookings', createBookingRouter())
app.use('/api/catalog', createCatalogRouter(undefined, false))
app.use('/api/customer/blogs', createBlogRouter(blogController))
app.use('/api/customer', createReviewRouter(reviewController))
app.use('/api/customer', createVoucherRouter(voucherController))
app.use('/api/technician-applications', createTechnicianApplicationRouter())
app.use('/api/technician-portal', createTechnicianPortalRouter())
app.use('/api/quotations', createQuotationRouter())

// ADDRESS
app.use('/api/addresses', createAddressRouter(addressController))
// CUSTOMER BOOKING
app.use('/api/bookings', createCustomerBookingRouter(customerBookingController))
// SERVICES
app.use('/api/service-categories', createServiceCategoryRouter())

app.get(
  '/api/services',
  asyncHandler(async (_request, response) => {
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
  })
)

//SERVICE DETAIL
app.get(
  '/api/services/:id',
  asyncHandler(async (request, response) => {
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
      [request.params.id]
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
  })
)
app.use(notFoundHandler)
app.use(errorHandler)
