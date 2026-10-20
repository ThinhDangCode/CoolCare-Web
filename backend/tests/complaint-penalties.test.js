import assert from 'node:assert/strict'
import test from 'node:test'
import { validateComplaintResolution } from '../src/modules/management/management.validation.js'

test('penalty expiry must be a future timestamp with a timezone and an acceptance decision', () => {
  const body = { status: 'RESOLVED', resolution: 'Verified complaint with a timed penalty.', penalty_expires_at: new Date(Date.now() + 86400000).toISOString() }
  assert.equal(validateComplaintResolution(body).penalty_expires_at, body.penalty_expires_at)
  for (const penalty_expires_at of [null, '', 'invalid', '2020-01-01T00:00:00Z', '2030-01-01T10:00'])
    assert.throws(() => validateComplaintResolution({ ...body, penalty_expires_at }), { status: 422 })
  assert.throws(() => validateComplaintResolution({ ...body, status: 'REJECTED' }), { status: 422 })
  assert.throws(() => validateComplaintResolution({ ...body, is_draft: true }), { status: 422 })
})

test('complaint penalty points require positive integers and an acceptance decision', () => {
  const body = { status: 'RESOLVED', resolution: 'Technician misconduct was verified.', penalty_points: 5 }
  assert.equal(validateComplaintResolution(body).penalty_points, 5)
  for (const penalty_points of [0, -1, 1.5, '5', null, true, 13, 2147483648])
    assert.throws(() => validateComplaintResolution({ ...body, penalty_points }), { status: 422 })
  for (const status of ['OPEN', 'IN_PROGRESS', 'REJECTED', 'CLOSED'])
    assert.throws(() => validateComplaintResolution({ ...body, status }), { status: 422 })
  assert.throws(() => validateComplaintResolution({ ...body, is_draft: true }), { status: 422 })
})
