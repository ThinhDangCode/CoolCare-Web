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
import { createComplaintRouter, createCustomerComplaintRouter } from './modules/complaints/complaint.routes.js'
import { ComplaintService } from './modules/complaints/complaint.service.js'
import { createQuotationRouter } from './modules/quotations/quotation.routes.js'
import { createPaymentsRouter } from './modules/payments/payments.routes.js'
import { createCustomerPaymentRouter } from './modules/payments/customer-payment.routes.js'
import { createInvoiceRouter } from './modules/invoices/invoice.routes.js'
import { createRevenueRouter } from './modules/revenue/revenue.routes.js'
import { createReportsRouter } from './modules/reports/reports.routes.js'
import { createCustomerStatisticsRouter } from './modules/customer-statistics/customer-statistics.routes.js'
import { createTechnicianStatisticsRouter } from './modules/technician-statistics/technician-statistics.routes.js'
import { createWithdrawalsRouter } from './modules/withdrawals/withdrawals.routes.js'
import { createTopupsRouter } from './modules/topups/topups.routes.js'
import { createTechnicianApplicationRouter } from './modules/technician-applications/technician-application.routes.js'
import { createTechnicianPortalRouter } from './modules/technician-portal/technician-portal.routes.js'
import { createTechnicianWalletRouter, createTechnicianWalletCallbackRouter } from './modules/technician-wallet/wallet.routes.js'
import { createServiceCategoryRouter } from './modules/services/service-category.routes.js'
import { createCustomerNotificationsRouter } from './modules/notifications/customer-notifications.routes.js'
import { createTechnicianNotificationsRouter } from './modules/notifications/technician-notifications.routes.js'
import { createServiceRouter } from './modules/services/service.routes.js'
import { createChatRouter } from './modules/chat/chat.routes.js'
import { createCustomerAcUnitRouter } from './modules/customer-ac-units/ac-unit.routes.js'

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

// Public, aggregate-only figures for the sign-in screen. No booking or user details.
app.get('/api/public/overview', asyncHandler(async (_request, response) => {
  const [bookings, technicians] = await Promise.all([
    pool.query(`SELECT
      count(*) FILTER (WHERE (scheduled_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::int AS today_appointments,
      count(*) FILTER (WHERE (completed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::int AS completed_today
      FROM bookings`),
    pool.query(`SELECT count(*)::int AS online_technicians FROM technician_profiles
      WHERE is_active = true AND verification_status = 'VERIFIED' AND availability_status = 'ONLINE'`),
  ])
  response.set('Cache-Control', 'public, max-age=60').json({ data: {
    ...bookings.rows[0], ...technicians.rows[0], updated_at: new Date().toISOString(),
  } })
}))

// AUTH
app.use('/api/auth', createAuthRouter(authController))
app.use('/api/admin/catalog', createCatalogRouter())
app.use('/api/admin/users', createUserRouter(userController))
app.use('/api/admin/blogs', createAdminBlogRouter(blogController))
app.use('/api/admin/complaints', createComplaintRouter(complaintController))
app.use('/api/customer/complaints', createCustomerComplaintRouter(complaintController))
app.use('/api/customer/notifications', createCustomerNotificationsRouter())
app.use('/api/customer/ac-units', createCustomerAcUnitRouter())
app.use('/api/technician/notifications', createTechnicianNotificationsRouter())
app.use('/api/admin', createAdminVoucherRouter(voucherController))
app.use('/api/admin/payments', createPaymentsRouter())
// Invoice routes first: they only claim /:paymentId/invoice* and fall through otherwise.
app.use('/api/payments', createInvoiceRouter())
app.use('/api/payments', createCustomerPaymentRouter())
app.use('/api/admin/revenue', createRevenueRouter())
app.use('/api/admin/reports', createReportsRouter())
app.use('/api/admin/customer-statistics', createCustomerStatisticsRouter())
app.use('/api/admin/technician-statistics', createTechnicianStatisticsRouter())
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
// Gateway callbacks are public endpoints authenticated by provider signatures. Register before the authenticated wallet router.
app.use('/api/technician-wallet/callbacks', createTechnicianWalletCallbackRouter())
app.use('/api/technician-wallet', createTechnicianWalletRouter())
app.use('/api/quotations', createQuotationRouter())

// ADDRESS
app.use('/api/addresses', createAddressRouter(addressController))
// CUSTOMER BOOKING
app.use('/api/bookings', createCustomerBookingRouter(customerBookingController))
// SERVICES
app.use('/api/service-categories', createServiceCategoryRouter())

app.use('/api/services', createServiceRouter())
// CHAT (REST + Socket.IO realtime, same PostgreSQL tables)
app.use('/api/chat', createChatRouter())

app.use(notFoundHandler)
app.use(errorHandler)
