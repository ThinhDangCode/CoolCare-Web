import assert from 'node:assert/strict'
import test from 'node:test'

import { pool } from '../src/config/database.js'
import { AcceptDeclineJobRequestRepository } from '../src/modules/technician-portal/accept-decline-job-request.repository.js'

test('Accept / Decline Job Request is compatible with database guards and rolls back atomically', {
  skip: process.env.RUN_JOB_REQUEST_DB_TESTS !== '1',
}, async (context) => {
  const selected = (await pool.query(
    `SELECT bt.id,u.id AS user_id
     FROM booking_technicians bt
     JOIN technician_profiles tp ON tp.id=bt.technician_id
     JOIN users u ON u.id=tp.user_id
     JOIN bookings b ON b.id=bt.booking_id
     WHERE bt.status='SELECTED'
       AND (bt.expires_at IS NULL OR bt.expires_at>CURRENT_TIMESTAMP)
       AND b.status='TECHNICIAN_SELECTED'
       AND can_recommend_technician(tp.id)
     ORDER BY bt.requested_at DESC LIMIT 1`,
  )).rows[0]
  if (!selected) {
    context.skip('An active eligible SELECTED request is required')
    await pool.end()
    return
  }

  for (const input of [
    { action: 'ACCEPT', reason: null, assignment: 'ACCEPTED', booking: 'ACCEPTED' },
    { action: 'DECLINE', reason: 'Database rollback test', assignment: 'DECLINED', booking: 'CANCELLED' },
  ]) {
    const client = await pool.connect()
    await client.query('BEGIN')
    try {
      const repository = new AcceptDeclineJobRequestRepository({
        transaction: (operation) => operation(client),
      })
      const result = await repository.respond(selected.user_id, selected.id, input)
      assert.equal(result.status, input.assignment)
      assert.equal(result.booking.status, input.booking)
      assert.equal((await client.query(
        'SELECT count(*)::int AS count FROM notifications WHERE reference_id=$1',
        [result.booking_id],
      )).rows[0].count > 0, true)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  }

  const unchanged = (await pool.query(
    'SELECT status,responded_at FROM booking_technicians WHERE id=$1',
    [selected.id],
  )).rows[0]
  assert.equal(unchanged.status, 'SELECTED')
  assert.equal(unchanged.responded_at, null)
  await pool.end()
})
