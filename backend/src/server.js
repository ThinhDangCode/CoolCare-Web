import { app } from './app.js'
import { pool, verifyDatabaseConnection } from './config/database.js'
import { env, validateRuntimeEnv } from './config/env.js'
import { reconcileExpiredRequests } from './modules/customer-bookings/reconcile-technician-request.js'

async function start() {
  validateRuntimeEnv()
  await verifyDatabaseConnection()

  const expiryTimer = setInterval(() => {
    reconcileExpiredRequests().catch(error =>
      console.error('Technician request expiry reconciliation failed', error))
  }, 60_000)
  expiryTimer.unref()
  const server = app.listen(env.port, '0.0.0.0', () => {
    console.info(`CoolCare API is running at http://localhost:${env.port}`)
  })

  const shutdown = (signal) => {
    clearInterval(expiryTimer)
    console.info(`${signal} received. Closing CoolCare API...`)
    server.close(async () => {
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
