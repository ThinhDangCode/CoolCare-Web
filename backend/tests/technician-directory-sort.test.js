import assert from 'node:assert/strict'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { adaptDatabaseQuery } from '../src/config/database-codebook-adapter.js'
import { TechnicianRepository } from '../src/modules/technicians/technician.repository.js'
import { validateTechnicianQuery } from '../src/modules/technicians/technician.validation.js'

test('directory sorting preserves codebook translation of technician filters', async () => {
  const original = pool.query
  const queries = []
  pool.query = async (sql, params) => {
    const adapted = adaptDatabaseQuery(sql, params)
    queries.push(adapted)
    assert.ok(!adapted.params.includes('VERIFIED'), 'verification must be translated to its database code')
    assert.ok(!adapted.params.includes('ONLINE'), 'availability must be translated to its database code')
    return { rows: sql.includes('count(*)::int AS total') ? [{ total: 0 }] : [] }
  }
  try {
    for (const [sort, order] of [
      ['NAME', 'u.full_name,t.id'],
      ['NAME_DESC', 'u.full_name DESC,t.id'],
      ['ID_ASC', 'numbering.display_id ASC'],
      ['ID_DESC', 'numbering.display_id DESC'],
    ]) {
      await new TechnicianRepository().list(validateTechnicianQuery({ sort, verification: 'VERIFIED', availability: 'ONLINE' }))
      assert.ok(queries.at(-1).query.includes(`ORDER BY ${order} LIMIT`))
    }
  } finally {
    pool.query = original
  }
})
