import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { penaltySummarySql } from '../src/modules/technicians/technician.repository.js'

// Read-only fixtures shadow the real table: no application records are required
// or inserted, and no notifications or emails can be triggered.
test('penalty history counts expiry and revocation without treating them as active', {
  skip: process.env.RUN_PENALTY_HISTORY_DB_TESTS !== '1',
}, async () => {
  async function summary(rows) {
    return (await pool.query(`WITH technician_penalties(technician_id,status,penalty_points,expires_at) AS (${rows}) ${penaltySummarySql}`)).rows[0]
  }
  try {
    const empty = await summary('SELECT NULL::int, NULL::int, NULL::int, NULL::timestamptz WHERE false')
    assert.deepEqual(empty, { total_penalties: 0, historical_technicians: 0, active_penalties: 0, penalized_technicians: 0, active_points: 0 })
    const expired = await summary("VALUES (1,0,7,CURRENT_TIMESTAMP - INTERVAL '1 day')")
    assert.deepEqual(expired, { total_penalties: 1, historical_technicians: 1, active_penalties: 0, penalized_technicians: 0, active_points: 0 })
    const mixed = await summary(`VALUES
      (1,0,2,CURRENT_TIMESTAMP + INTERVAL '1 day'),
      (1,0,3,NULL::timestamptz),
      (1,0,7,CURRENT_TIMESTAMP - INTERVAL '1 day'),
      (2,1,4,CURRENT_TIMESTAMP + INTERVAL '1 day'),
      (3,2,6,CURRENT_TIMESTAMP + INTERVAL '1 day'),
      (4,0,1,CURRENT_TIMESTAMP)`)
    assert.deepEqual(mixed, { total_penalties: 6, historical_technicians: 4, active_penalties: 2, penalized_technicians: 1, active_points: 5 })
  } finally {
    await pool.end()
  }
})
