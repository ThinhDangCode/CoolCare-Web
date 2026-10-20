import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { pool } from '../src/config/database.js'
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js'
import { validateQuery, validateInput } from '../src/modules/catalog/catalog.validation.js'

test('trash filters reject invalid values and cannot be written through normal updates', () => {
  assert.throws(() => validateQuery({ trash: 'bad' }, 'skills'), { status: 422 })
  assert.throws(() => validateInput('brands', { deleted_at: null }, true), { status: 422 })
})

test('all five catalog resources support durable soft delete and restore without losing references or status',
  { skip: process.env.RUN_TRASH_DB_TESTS !== '1' }, async () => {
    const client = await pool.connect()
    await client.query('BEGIN')
    const repository = new CatalogRepository({ audit: () => {}, transaction: async (work) => {
      await client.query('SAVEPOINT trash_test')
      try {
        const result = await work({ query: (sql, values) => sql.startsWith('SET TRANSACTION') ? Promise.resolve({ rows: [] }) : client.query(sql, values) })
        await client.query('RELEASE SAVEPOINT trash_test')
        return result
      } catch (error) { await client.query('ROLLBACK TO SAVEPOINT trash_test'); throw error }
    } })
    try {
      const name = `Trash-${randomUUID()}`
      const category = await repository.mutate('categories', null, { name }, 'CREATE')
      const brand = await repository.mutate('brands', null, { name }, 'CREATE')
      const service = await repository.mutate('services', null, { name, category_id: category.id, base_price: 0 }, 'CREATE')
      const model = await repository.mutate('models', null, { model_name: name, brand_id: brand.id, ac_type: 'WALL_MOUNTED', capacity_btu: 9000, inverter: true }, 'CREATE')
      const skill = await repository.mutate('skills', null, { name, service_id: service.id, is_active: false }, 'CREATE')
      for (const [kind, item] of [['categories', category], ['brands', brand], ['services', service], ['models', model], ['skills', skill]]) {
        const removed = await repository.mutate(kind, item.id, {}, 'TRASH')
        assert.ok(removed.deleted_at)
        assert.equal(removed.is_active, item.is_active)
        assert.equal((await repository.list(kind, validateQuery({ search: name }, kind))).total, 0)
        assert.equal((await repository.list(kind, validateQuery({ search: name, trash: 'true' }, kind))).items[0].id, item.id)
        assert.equal((await repository.list(kind, validateQuery({ search: name, trash: 'true' }, kind), true)).total, 0)
        await assert.rejects(repository.mutate(kind, item.id, { is_active: true }, 'UPDATE'), { code: 'RESOURCE_IN_TRASH' })
        const restored = await repository.mutate(kind, item.id, {}, 'RESTORE')
        assert.equal(restored.deleted_at, null)
        assert.equal(restored.is_active, item.is_active)
        assert.equal((await repository.list(kind, validateQuery({ search: name }, kind))).total, 1)
      }
      await repository.mutate('services', service.id, {}, 'TRASH')
      await repository.mutate('categories', category.id, {}, 'TRASH')
      await assert.rejects(repository.mutate('services', service.id, {}, 'RESTORE'), { code: 'PARENT_IN_TRASH' })
      await repository.mutate('categories', category.id, {}, 'RESTORE')
      await repository.mutate('services', service.id, {}, 'RESTORE')
      assert.equal((await client.query('SELECT service_id FROM skills WHERE id=$1', [skill.id])).rows[0].service_id, service.id)
    } finally { await client.query('ROLLBACK'); client.release(); await pool.end() }
  })
