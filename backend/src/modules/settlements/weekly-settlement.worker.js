import { closeWeeklySettlements } from './weekly-settlement.repository.js'

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const CLOSING_DELAY_MINUTES = 5
const RETRY_DELAY_MS = 60_000

export function nextWeeklySettlementRun(now) {
  const localTime = new Date(now.getTime() + VIETNAM_UTC_OFFSET_MS)
  const daysSinceMonday = (localTime.getUTCDay() + 6) % 7
  localTime.setUTCDate(localTime.getUTCDate() - daysSinceMonday)
  localTime.setUTCHours(0, CLOSING_DELAY_MINUTES, 0, 0)
  const mondayRun = localTime.getTime() - VIETNAM_UTC_OFFSET_MS
  return new Date(mondayRun > now.getTime() ? mondayRun : mondayRun + WEEK_MS)
}

export function startWeeklySettlementWorker({
  run = closeWeeklySettlements,
  now = () => new Date(),
  schedule = setTimeout,
  cancel = clearTimeout,
  logger = console,
} = {}) {
  let timer
  let inFlight
  let stopped = false

  function scheduleRun(at) {
    if (stopped) return
    timer = schedule(() => {
      timer = undefined
      if (stopped) return
      if (now().getTime() < at) {
        scheduleRun(at)
        return
      }
      inFlight = runOnce()
    }, Math.max(0, at - now().getTime()))
    timer?.unref?.()
  }

  async function runOnce() {
    const nextRun = nextWeeklySettlementRun(now()).getTime()
    // Startup catch-up closes only weeks whose Monday 00:05 slot has passed.
    const scheduledCutoff = new Date(nextRun - WEEK_MS - CLOSING_DELAY_MINUTES * 60_000)
    try {
      const { finalizedPeriods } = await run({ scheduledCutoff })
      if (finalizedPeriods > 0) logger.info('Weekly settlements finalized', { finalizedPeriods })
    } catch (error) {
      logger.error('Weekly settlement run failed. Retrying in one minute.', {
        code: error?.code ?? error?.name ?? 'UNKNOWN_ERROR',
      })
      scheduleRun(now().getTime() + RETRY_DELAY_MS)
      return
    }
    scheduleRun(nextRun)
  }

  inFlight = runOnce()
  return async function stopWeeklySettlementWorker() {
    stopped = true
    if (timer !== undefined) {
      cancel(timer)
      timer = undefined
    }
    await inFlight
  }
}
