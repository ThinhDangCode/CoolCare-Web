import assert from 'node:assert/strict'
import test from 'node:test'
import {
  nextWeeklySettlementRun,
  startWeeklySettlementWorker,
} from '../src/modules/settlements/weekly-settlement.worker.js'

const mondayRun = '2026-11-16T00:05:00.000+07:00'
const emptyRun = { finalizedPeriods: 0 }
const flush = () => new Promise((resolve) => setImmediate(resolve))

function fakeClock(start) {
  let time = Date.parse(start)
  const timers = new Set()
  return {
    timers,
    advance(ms) { time += ms },
    getTimer() {
      assert.equal(timers.size, 1)
      return [...timers][0]
    },
    fire(timer) {
      assert(timers.delete(timer))
      timer.callback()
    },
    options: {
      now: () => new Date(time),
      schedule(callback, delay) {
        const timer = { callback, delay, unref() { this.unreferenced = true } }
        timers.add(timer)
        return timer
      },
      cancel(timer) { timers.delete(timer) },
    },
  }
}

test('weekly settlement runs Monday at 00:05 Vietnam time, including across years', () => {
  const cases = [
    ['2026-11-16T00:04:59.999+07:00', '2026-11-15T17:05:00.000Z'],
    [mondayRun, '2026-11-22T17:05:00.000Z'],
    ['2026-12-31T23:59:00.000+07:00', '2027-01-03T17:05:00.000Z'],
  ]
  for (const [now, next] of cases) {
    assert.equal(nextWeeklySettlementRun(new Date(now)).toISOString(), next)
  }
})

test('startup catches up through the latest due week and a scheduled run waits for it', async () => {
  const clock = fakeClock('2026-11-16T00:04:00.000+07:00')
  const cutoffs = []
  let finishStartup
  const stop = startWeeklySettlementWorker({
    ...clock.options,
    run({ scheduledCutoff }) {
      cutoffs.push(scheduledCutoff.toISOString())
      if (cutoffs.length === 1) return new Promise((resolve) => { finishStartup = resolve })
      return emptyRun
    },
  })

  assert.deepEqual(cutoffs, ['2026-11-08T17:00:00.000Z'])
  clock.advance(120_000)
  assert.equal(clock.timers.size, 0)
  finishStartup(emptyRun)
  await flush()

  const due = clock.getTimer()
  assert.equal(due.delay, 0)
  assert.equal(due.unreferenced, true)
  clock.fire(due)
  await flush()
  assert.deepEqual(cutoffs, ['2026-11-08T17:00:00.000Z', '2026-11-15T17:00:00.000Z'])
  assert.equal(clock.getTimer().delay, 7 * 24 * 60 * 60 * 1000 - 60_000)
  await stop()
})

test('a failed run retries after one minute and avoids logging error details', async () => {
  const clock = fakeClock(mondayRun)
  const errors = []
  let runs = 0
  const stop = startWeeklySettlementWorker({
    ...clock.options,
    logger: { error: (...args) => errors.push(args) },
    async run() {
      runs += 1
      if (runs === 1) throw Object.assign(new Error('private details'), { code: '40001' })
      return emptyRun
    },
  })
  await flush()

  assert.deepEqual(errors.map(([, details]) => details), [{ code: '40001' }])
  assert.doesNotMatch(JSON.stringify(errors), /private details/)
  const retry = clock.getTimer()
  assert.equal(retry.delay, 60_000)
  clock.advance(59_999)
  clock.fire(retry)
  assert.equal(runs, 1)
  assert.equal(clock.getTimer().delay, 1)

  clock.advance(1)
  clock.fire(clock.getTimer())
  await flush()
  assert.equal(runs, 2)
  assert.equal(clock.getTimer().delay, 7 * 24 * 60 * 60 * 1000 - 60_000)
  await stop()
})

test('shutdown drains the active run and cancels a scheduled timer', async () => {
  const clock = fakeClock(mondayRun)
  let finishActiveRun
  const stopActive = startWeeklySettlementWorker({
    ...clock.options,
    run: () => new Promise((resolve) => { finishActiveRun = resolve }),
  })
  let drained = false
  const stopping = stopActive().then(() => { drained = true })
  await flush()
  assert.equal(drained, false)
  finishActiveRun(emptyRun)
  await stopping
  assert.equal(drained, true)
  assert.equal(clock.timers.size, 0)

  const stopScheduled = startWeeklySettlementWorker({ ...clock.options, run: () => emptyRun })
  await flush()
  clock.getTimer()
  await stopScheduled()
  assert.equal(clock.timers.size, 0)
})
