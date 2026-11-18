import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { app, setAuthSocketServer } from './app.js'
import { pool, verifyDatabaseConnection } from './config/database.js'
import { env, validateRuntimeEnv } from './config/env.js'
import { configureChatSocket } from './modules/chat/chat.socket.js'
import { setChatIo } from './modules/chat/chat.routes.js'
import { reconcileExpiredRequests } from './modules/customer-bookings/reconcile-technician-request.js'
import { startInvoiceEmailWorker } from './modules/invoices/invoice.routes.js'
import { startWeeklySettlementWorker } from './modules/settlements/weekly-settlement.worker.js'
import { startBookingPaymentExpiryWorker } from './modules/payments/payment-expiry.worker.js'
import { startTopupExpiryWorker } from './modules/technician-wallet/topup-expiry.worker.js'
import { startStripeWithdrawalRecoveryWorker } from './modules/stripe-withdrawals/routes.js'
import { startMaintenanceReminderWorker } from './modules/maintenance-reminders/maintenance-reminder.worker.js'

async function start() {
  validateRuntimeEnv()
  await verifyDatabaseConnection()

  const expiryTimer = setInterval(() => {
    reconcileExpiredRequests().catch(error =>
      console.error('Technician request expiry reconciliation failed', error))
  }, 60_000)
  expiryTimer.unref()
  const invoiceEmailTimer = startInvoiceEmailWorker()
  const stopBookingExpiry = startBookingPaymentExpiryWorker()
  const stopTopupExpiry = startTopupExpiryWorker()
  const stopWithdrawalRecovery = startStripeWithdrawalRecoveryWorker()
  const stopMaintenanceReminders = startMaintenanceReminderWorker()
  const stopWeeklySettlements = env.weeklySettlementsEnabled ? startWeeklySettlementWorker() : null
  const httpServer = createServer(app)
  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin || env.corsOrigins.length === 0 || env.corsOrigins.includes(origin)) {
          return callback(null, true)
        }
        return callback(new Error('Origin not allowed'))
      },
    },
  })
  setChatIo(io)
  setAuthSocketServer(io)
  configureChatSocket(io)
  const server = httpServer.listen(env.port, '0.0.0.0', () => {
    console.info(`CoolCare API is running at http://localhost:${env.port}`)
  })

  const shutdown = (signal) => {
    clearInterval(expiryTimer)
    clearInterval(invoiceEmailTimer)
    stopBookingExpiry()
    stopTopupExpiry()
    stopWithdrawalRecovery()
    stopMaintenanceReminders()
    const settlementsStopped = stopWeeklySettlements?.()
    console.info(`${signal} received. Closing CoolCare API...`)
    server.close(async () => {
      await settlementsStopped
      await pool.end()
      process.exit(0)
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

start().catch(async (error) => {
  console.error('CoolCare API failed to start', error)
  await pool.end()
  process.exit(1)
})
