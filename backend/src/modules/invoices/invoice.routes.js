import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler, validateUuid } from '../../utils.js'
import { createEmailSender } from '../auth/email.service.js'
import { InvoiceService } from './invoice.service.js'

const customerOnly = [authenticate, requireRole('CUSTOMER')]

// Paths that can complete a payment (cash confirmation, gateway callbacks/returns,
// free bookings). After they answer we look for invoices that still need emailing.
const COMPLETING_PATHS = /^\/(?:vnpay-return|callbacks\/|[^/]+\/(?:confirm-cash|reconcile-zalopay)|bookings\/[^/]+\/attempts)/

export function createInvoiceEmailTrigger(service) {
  return function invoiceEmailTrigger(request, response, next) {
    if (request.method === 'GET' && !request.path.startsWith('/vnpay-return') && !request.path.startsWith('/callbacks/')) {
      return next()
    }
    if (COMPLETING_PATHS.test(request.path)) {
      response.once('finish', () => {
        if (response.statusCode >= 400) return
        // Gateways may commit slightly after answering; give the transaction a moment.
        const timer = setTimeout(() => {
          service.dispatchPendingEmails().catch((error) => console.error('Invoice email dispatch failed', error))
        }, 1500)
        timer.unref?.()
      })
    }
    next()
  }
}

// Mounted at /api/payments BEFORE the existing customer payment router.
export function createInvoiceRouter(service = getInvoiceService()) {
  const router = Router()
  router.use(createInvoiceEmailTrigger(service))

  router.get('/:paymentId/invoice', ...customerOnly, asyncHandler(async (request, response) => {
    const data = await service.getInvoice(request.auth.userId, validateUuid(request.params.paymentId))
    response.set('Cache-Control', 'private, no-store').json({ data })
  }))

  router.get('/:paymentId/invoice/pdf', ...customerOnly, asyncHandler(async (request, response) => {
    const { buffer, filename } = await service.getPdf(request.auth.userId, validateUuid(request.params.paymentId))
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    }).send(buffer)
  }))

  router.post('/:paymentId/invoice/email', ...customerOnly, asyncHandler(async (request, response) => {
    try {
      const data = await service.emailInvoice(request.auth.userId, validateUuid(request.params.paymentId))
      response.set('Cache-Control', 'no-store').json({ data })
    } catch (error) {
      if (error?.code === 'INVOICE_EMAIL_RATE_LIMITED' && error.details?.retryAfter) {
        response.set('Retry-After', String(error.details.retryAfter))
      }
      throw error
    }
  }))

  return router
}

let sharedService
export function getInvoiceService() {
  sharedService ??= new InvoiceService({ emailSender: createEmailSender() })
  return sharedService
}

// Safety net for callbacks that never reach this process (restarts, missed hooks).
export function startInvoiceEmailWorker({ intervalMs = 60_000, service = getInvoiceService() } = {}) {
  const timer = setInterval(() => {
    service.dispatchPendingEmails().catch((error) => console.error('Invoice email worker failed', error))
  }, intervalMs)
  timer.unref?.()
  return timer
}
