import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateWorkEstimate } from '../src/modules/booking-travel/booking-work-estimate.js'

const arrivedAt = '2026-11-10T07:10:00.000Z'
test('arrival plus initial duration, separate 15-minute late threshold', () => {
  const result = calculateWorkEstimate({ arrivedAt, baseMinutes: 60, now: '2026-11-10T08:20:00.000Z' })
  assert.equal(result.work_expected_completion_at, '2026-11-10T08:10:00.000Z')
  assert.equal(result.work_late, false)
  assert.equal(calculateWorkEstimate({ arrivedAt, baseMinutes: 60, now: '2026-11-10T08:26:00.000Z' }).work_late, true)
})
test('approved extra service extends duration and waits for quotation approval', () => {
  const result = calculateWorkEstimate({ arrivedAt, baseMinutes: 60, now: '2026-11-10T08:45:00.000Z', quotations: [{
    status:'ACCEPTED', sent_at:'2026-11-10T07:35:00.000Z', responded_at:'2026-11-10T07:40:00.000Z', minutes:30,
  }] })
  assert.equal(result.work_estimated_minutes, 90)
  assert.equal(result.quotation_wait_minutes, 5)
  assert.equal(result.work_expected_completion_at, '2026-11-10T08:45:00.000Z')
  assert.equal(result.work_late, false)
})
test('rejected extra service does not add minutes, pending quote pauses work clock', () => {
  const rejected = calculateWorkEstimate({ arrivedAt, baseMinutes:60, now:'2026-11-10T08:30:00.000Z', quotations:[{
    status:'REJECTED', sent_at:'2026-11-10T07:30:00.000Z', responded_at:'2026-11-10T07:40:00.000Z', minutes:40,
  }] })
  assert.equal(rejected.work_estimated_minutes,60)
  assert.equal(rejected.work_expected_completion_at,'2026-11-10T08:20:00.000Z')
  const pending = calculateWorkEstimate({ arrivedAt, baseMinutes:60, now:'2026-11-10T09:30:00.000Z', quotations:[{
    status:'PENDING', sent_at:'2026-11-10T07:30:00.000Z', minutes:50,
  }] })
  assert.equal(pending.work_waiting_for_quotation,true)
  assert.equal(pending.work_late,false)
})
test('technician completion stops the clock, even before customer confirmation', () => {
  const result = calculateWorkEstimate({ arrivedAt, baseMinutes:60, completedAt:'2026-11-10T08:05:00.000Z', now:'2026-11-12T00:00:00.000Z' })
  assert.equal(result.work_late,false)
})
