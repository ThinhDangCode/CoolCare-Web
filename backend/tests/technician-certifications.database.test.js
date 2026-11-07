import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { TechnicianRepository } from '../src/modules/technicians/technician.repository.js'

test('certification list and detail read revised database statuses', {
  skip: process.env.RUN_TECHNICIAN_DB_TESTS !== '1',
}, async () => {
  const repository = new TechnicianRepository()
  const query = { page: 1, limit: 100, search: '', status: 'ALL', issuer: '', type: 'ALL' }

  try {
    const all = await repository.certifications(query)
    assert.ok(Array.isArray(all.items))
    assert.ok(Number.isInteger(all.total))
    assert.ok(all.total >= all.items.length)

    const statuses = ['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'EXPIRING']
    for (const status of statuses) {
      const result = await repository.certifications({ ...query, status })
      assert.ok(result.items.every((item) => item.status === status))
    }

    for (const type of ['PDF', 'IMAGE', 'OTHER']) {
      const result = await repository.certifications({ ...query, type })
      assert.ok(Array.isArray(result.items))
    }

    if (all.items.length > 0) {
      const detail = await repository.detail(all.items[0].technician_id)
      assert.ok(detail.certifications.some((item) => item.id === all.items[0].id))
    }
  } finally {
    await pool.end()
  }
})
