import test from 'node:test'
import assert from 'node:assert/strict'
import { debtTier } from '../src/modules/technician-wallet/debt-policy.js'
test('debt thresholds in VND', () => {
  assert.equal(debtTier(-299999), 'NORMAL')
  assert.equal(debtTier(-300000), 'WARNING')
  assert.equal(debtTier(-499999), 'WARNING')
  assert.equal(debtTier(-500000), 'DEMOTED')
  assert.equal(debtTier(-999999), 'DEMOTED')
  assert.equal(debtTier(-1000000), 'BLOCKED')
})
