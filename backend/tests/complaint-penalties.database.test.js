import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { pool } from '../src/config/database.js'
import { ComplaintRepository } from '../src/modules/complaints/complaint.repository.js'
import { remainingPointsSql, activePointsSql } from '../src/modules/technicians/technician.points.js'
import { TechnicianMutations } from '../src/modules/technicians/technician.mutations.js'

test('acceptance creates one linked technician penalty; rejection and drafts do not',
  { skip: process.env.RUN_COMPLAINT_DB_TESTS !== '1' }, async () => {
    const client = await pool.connect()
    await client.query('BEGIN')
    const audits = []
    let failPenalty = false
    const repository = new ComplaintRepository({
      audit: (event) => audits.push(event),
      transaction: async (work) => {
        await client.query('SAVEPOINT complaint_test')
        try {
          const result = await work({ query: (sql, values) => {
            if (failPenalty && sql.includes('INSERT INTO technician_penalties'))
              throw new Error('Simulated penalty insert failure')
            return client.query(sql, values)
          } })
          await client.query('RELEASE SAVEPOINT complaint_test')
          return result
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT complaint_test')
          throw error
        }
      },
    })
    try {
      const actor = (await client.query("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='ADMIN' LIMIT 1")).rows[0]
      const booking = (await client.query(`SELECT b.id,b.customer_id,bt.technician_id
        FROM bookings b JOIN booking_technicians bt ON bt.booking_id=b.id LIMIT 1`)).rows[0]
      assert.ok(actor && booking, 'Integration fixtures require an admin and a booking with a technician')
      async function complaint(type = 'TECHNICIAN', technicianId = booking.technician_id, status = 'IN_PROGRESS') {
        return (await client.query(`INSERT INTO complaints
          (complaint_code,booking_id,customer_id,technician_id,type,subject,description,status)
          VALUES ($1,$2,$3,$4,$5,'Integration complaint','Customer reported technician misconduct.',$6) RETURNING *`,
          [`TEST-${randomUUID().slice(0, 12)}`, booking.id, booking.customer_id, technicianId, type, status])).rows[0]
      }
      const decision = { status: 'RESOLVED', resolution: 'Verified misconduct after reviewing customer evidence.', penalty_points: 5, penalty_expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }
      const accepted = await complaint()
      const result = await repository.resolve(accepted.id, decision, actor.id)
      assert.equal(result.status, 'RESOLVED')
      assert.ok(result.penalty_id)
      const penalty = (await client.query(`SELECT p.*,u.full_name FROM technician_penalties p
        JOIN technician_profiles t ON t.id=p.technician_id JOIN users u ON u.id=t.user_id WHERE split_part(p.reason, ' ', 1) = '[COMPLAINT:' || $1::text || ']'`, [accepted.id])).rows[0]
      assert.equal(penalty.technician_id, booking.technician_id)
      assert.equal(penalty.booking_id, booking.id)
      assert.equal(penalty.penalty_points, 5)
      assert.equal(penalty.penalty_type, 'RULE_VIOLATION')
      assert.equal(penalty.status, 'ACTIVE')
      assert.equal(new Date(penalty.expires_at).toISOString(), decision.penalty_expires_at)
      assert.ok(penalty.full_name)
      assert.ok(penalty.reason.includes(accepted.complaint_code))
      assert.equal(audits.at(-1).after.penalty_id, penalty.id)
      const detail = await repository.get(accepted.id)
      assert.equal(detail.penalty_id, penalty.id)
      assert.equal(detail.penalty_points, 5)
      await repository.resolve(accepted.id, decision, actor.id)
      assert.equal((await client.query(`SELECT count(*)::int AS total FROM technician_penalties WHERE split_part(reason, ' ', 1) = '[COMPLAINT:' || $1::text || ']'`, [accepted.id])).rows[0].total, 1)
      await repository.resolve(accepted.id, { status: 'CLOSED', resolution: decision.resolution }, actor.id)
      assert.equal((await client.query('SELECT status FROM technician_penalties WHERE id=$1', [penalty.id])).rows[0].status, 'ACTIVE')

      const rejected = await complaint()
      await repository.resolve(rejected.id, { status: 'REJECTED', resolution: 'Evidence does not substantiate the complaint.' }, actor.id)
      assert.equal((await client.query(`SELECT count(*)::int AS total FROM technician_penalties WHERE split_part(reason, ' ', 1) = '[COMPLAINT:' || $1::text || ']'`, [rejected.id])).rows[0].total, 0)

      const draft = await complaint('TECHNICIAN', booking.technician_id, 'OPEN')
      await repository.resolve(draft.id, { status: 'OPEN', resolution: 'Investigation draft', is_draft: true }, actor.id)
      assert.equal((await client.query(`SELECT count(*)::int AS total FROM technician_penalties WHERE split_part(reason, ' ', 1) = '[COMPLAINT:' || $1::text || ']'`, [draft.id])).rows[0].total, 0)
      await assert.rejects(repository.resolve(draft.id, { status: 'RESOLVED', resolution: decision.resolution }, actor.id), { status: 409 })
      const unassigned = await complaint('TECHNICIAN', null)
      await assert.rejects(repository.resolve(unassigned.id, decision, actor.id), { status: 422 })

      const linkedService = await complaint('SERVICE')
      const servicePenalty = await repository.resolve(linkedService.id, decision, actor.id)
      assert.ok(servicePenalty.penalty_id, 'Service complaints with a technician must apply a penalty')
      const legacy = await complaint('PAYMENT')
      await client.query("UPDATE complaints SET status='RESOLVED' WHERE id=$1", [legacy.id])
      const recovered = await repository.resolve(legacy.id, decision, actor.id)
      assert.ok(recovered.penalty_id, 'An already resolved complaint without a penalty can be repaired by the admin')
      await client.query('UPDATE technician_penalties SET expires_at=NULL WHERE id=$1', [recovered.penalty_id])
      const ended = await repository.resolve(legacy.id, { status: 'RESOLVED', resolution: decision.resolution, penalty_expires_at: decision.penalty_expires_at }, actor.id)
      assert.equal(new Date(ended.penalty_expires_at).toISOString(), decision.penalty_expires_at)
      await repository.resolve(legacy.id, decision, actor.id)
      assert.equal((await client.query(`SELECT count(*)::int AS total FROM technician_penalties WHERE split_part(reason, ' ', 1) = '[COMPLAINT:' || $1::text || ']'`, [legacy.id])).rows[0].total, 1)
      const service = await complaint('SERVICE', null)
      await repository.resolve(service.id, { status: 'RESOLVED', resolution: 'Service complaint resolved without technician misconduct.' }, actor.id)
      assert.equal((await client.query(`SELECT count(*)::int AS total FROM technician_penalties WHERE split_part(reason, ' ', 1) = '[COMPLAINT:' || $1::text || ']'`, [service.id])).rows[0].total, 0)

      const rollback = await complaint()
      failPenalty = true
      await assert.rejects(repository.resolve(rollback.id, decision, actor.id), /Simulated penalty insert failure/)
      assert.equal((await client.query('SELECT status FROM complaints WHERE id=$1', [rollback.id])).rows[0].status, 'IN_PROGRESS')
      failPenalty = false
      const exhausted = await complaint()
      const exhaustedResult = await repository.resolve(exhausted.id, { ...decision, penalty_points: 12 }, actor.id)
      assert.equal(exhaustedResult.remaining_points, 0)
      const account = (await client.query(`SELECT u.status,t.is_active,t.availability_status FROM technician_profiles t JOIN users u ON u.id=t.user_id WHERE t.id=$1`, [booking.technician_id])).rows[0]
      assert.equal(account.status, 'LOCKED')
      assert.equal(account.is_active, false)
      assert.equal(account.availability_status, 'OFFLINE')
      const activeBefore = (await client.query(`SELECT ${activePointsSql('$1')} AS points`, [booking.technician_id])).rows[0].points
      await client.query(`UPDATE technician_penalties SET applied_at=CURRENT_TIMESTAMP-interval '2 days',expires_at=CURRENT_TIMESTAMP-interval '1 day' WHERE id=$1`, [exhaustedResult.penalty_id])
      const activeAfter = (await client.query(`SELECT ${activePointsSql('$1')} AS points`, [booking.technician_id])).rows[0].points
      assert.equal(activeBefore - activeAfter, 12, 'Expired penalties automatically stop reducing priority without needing a scheduled status update')
      assert.equal((await client.query(`SELECT ${remainingPointsSql('$1')} AS remaining_points`, [booking.technician_id])).rows[0].remaining_points, 0, 'Expiry never returns deducted points')
      const technicians = new TechnicianMutations({ transaction: repository.transaction, audit: () => {} })
      await assert.rejects(technicians.activate(booking.technician_id, actor.id), { code: 'POINTS_EXHAUSTED' })
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pool.end()
    }
  })
