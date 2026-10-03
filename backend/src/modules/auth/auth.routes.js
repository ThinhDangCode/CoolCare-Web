import { Router } from 'express'
import { asyncHandler } from '../../utils.js'
import { authenticate } from '../../middleware/authenticate.js'

export function createAuthRouter(controller) {
  const router = Router()
  router.post('/register', asyncHandler(controller.register))
  router.post('/register/resend-verification', asyncHandler(controller.resendRegistrationEmailVerification))
  router.post('/register/verify-email', asyncHandler(controller.verifyRegistrationEmail))
  router.post('/login', asyncHandler(controller.login))
  router.post('/google', asyncHandler(controller.googleLogin))
  router.post('/logout', authenticate, asyncHandler(controller.logout))
  router.post('/forgot-password', asyncHandler(controller.forgotPassword))
  router.post('/forgot-password/verify', asyncHandler(controller.verifyOtp))
  router.post('/forgot-password/reset', asyncHandler(controller.resetPassword))
  return router
}
