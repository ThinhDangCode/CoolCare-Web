import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { ManagementRepository } from '../src/modules/management/management.repository.js'

test(
  'Sprint 3 repository works with the existing schema only',
  { skip: process.env.RUN_ADMIN_DB_TESTS !== '1' },
  async () => {
    const client = await pool.connect()
    await client.query('BEGIN')
    const audits = []
    const repository = new ManagementRepository({
      transaction: async (work) => {
        await client.query('SAVEPOINT management_test')
        try {
          const value = await work(client)
          await client.query('RELEASE SAVEPOINT management_test')
          return value
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT management_test')
          throw error
        }
      },
      audit: (event) => audits.push(event),
    })
    try {
      const actor = (
        await client.query(
          "SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='ADMIN' LIMIT 1"
        )
      ).rows[0]
      const customer = (
        await client.query(
          "SELECT u.id,u.status FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='CUSTOMER' LIMIT 1"
        )
      ).rows[0]
      assert.ok(actor && customer)
      const newStatus = customer.status === 'LOCKED' ? 'ACTIVE' : 'LOCKED'
      await repository.changeUserStatus(customer.id, newStatus, actor.id)
      assert.equal(audits.at(-1).after.status, newStatus)
      await assert.rejects(repository.changeUserStatus(actor.id, 'LOCKED', actor.id), {
        code: 'SELF_LOCK_FORBIDDEN',
      })
      const suffix = randomUUID().slice(0, 8).toUpperCase()
      const voucher = await repository.mutateVoucher(
        null,
        {
          code: `TEST${suffix}`,
          name: 'Integration voucher',
          discount_type: 'PERCENTAGE',
          discount_value: 10,
          minimum_order_amount: 0,
          maximum_discount: null,
          usage_limit: 5,
          usage_limit_per_customer: 1,
          start_at: new Date().toISOString(),
          end_at: new Date(Date.now() + 3600000).toISOString(),
        },
        actor.id,
        'CREATE_VOUCHER'
      )
      assert.ok(voucher.id)
      assert.equal(audits.at(-1).action, 'CREATE_VOUCHER')
      assert.equal(
        (
          await repository.mutateVoucher(
            voucher.id,
            { is_active: false },
            actor.id,
            'TOGGLE_VOUCHER_STATUS'
          )
        ).is_active,
        false
      )
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pool.end()
    }
  }
)
