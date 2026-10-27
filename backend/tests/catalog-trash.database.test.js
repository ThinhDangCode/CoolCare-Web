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
      await assert.rejects(repository.mutate('brands',brand.id,{},'TRASH'),{status:409,code:'BRAND_IN_USE'})
      await repository.mutate('models',model.id,{is_active:false},'UPDATE')
      await assert.rejects(repository.mutate('brands',brand.id,{},'TRASH'),{status:409,code:'BRAND_IN_USE'})
      await repository.mutate('models',model.id,{is_active:true},'UPDATE')
      assert.equal((await client.query('SELECT deleted_at FROM ac_brands WHERE id=$1',[brand.id])).rows[0].deleted_at,null)
      await assert.rejects(repository.mutate('categories',category.id,{},'TRASH'),{status:409,code:'CATEGORY_IN_USE'})
      await repository.mutate('services',service.id,{is_active:false},'UPDATE')
      await assert.rejects(repository.mutate('categories',category.id,{},'TRASH'),{status:409,code:'CATEGORY_IN_USE'})
      await repository.mutate('services',service.id,{is_active:true},'UPDATE')
      assert.equal((await client.query('SELECT deleted_at FROM service_categories WHERE id=$1',[category.id])).rows[0].deleted_at,null)
      for (const [kind,input] of [
        ['categories',{name: ` ${name.toUpperCase()} `}],
        ['brands',{name: ` ${name.toUpperCase()} `}],
        ['services',{name: ` ${name.toUpperCase()} `,category_id:category.id,base_price:0}],
        ['skills',{name: ` ${name.toUpperCase()} `,service_id:service.id}],
        ['models',{model_name:` ${name.toUpperCase()} `,brand_id:brand.id,ac_type:'WALL_MOUNTED',capacity_btu:9000,inverter:true}],
      ]) {
        await assert.rejects(repository.mutate(kind,null,input,'CREATE'),{code:'DUPLICATE_NAME'})
      }
      for (const [kind,input] of [
        ['services',{name:`Other-${name}`,category_id:randomUUID(),base_price:0}],
        ['skills',{name:`Other-${name}`,service_id:randomUUID()}],
        ['models',{model_name:`Other-${name}`,brand_id:randomUUID(),ac_type:'WALL_MOUNTED',capacity_btu:9000,inverter:true}],
      ]) {
        await assert.rejects(repository.mutate(kind,null,input,'CREATE'),{status:422})
      }
      const parentCount = async (kind, parentId, field) => (await repository.list(kind, validateQuery({search:name},kind))).items.find(row => row.id === parentId)[field]
      assert.equal(await parentCount('categories',category.id,'service_count'),1)
      assert.equal(await parentCount('brands',brand.id,'model_count'),1)
      await repository.mutate('services',service.id,{},'TRASH')
      await repository.mutate('models',model.id,{},'TRASH')
      assert.equal(await parentCount('categories',category.id,'service_count'),0)
      assert.equal(await parentCount('brands',brand.id,'model_count'),0)
      await repository.mutate('services',service.id,{},'RESTORE')
      await repository.mutate('models',model.id,{},'RESTORE')
      assert.equal(await parentCount('categories',category.id,'service_count'),1)
      assert.equal(await parentCount('brands',brand.id,'model_count'),1)
      for (const [kind, item] of [['categories', category], ['brands', brand], ['services', service], ['models', model], ['skills', skill]]) {
        if (kind === 'categories') await repository.mutate('services',service.id,{},'TRASH')
        if (kind === 'brands') await repository.mutate('models',model.id,{},'TRASH')
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
        if (kind === 'categories') await repository.mutate('services',service.id,{},'RESTORE')
        if (kind === 'brands') await repository.mutate('models',model.id,{},'RESTORE')
      }
      await repository.mutate('services', service.id, {}, 'TRASH')
      await repository.mutate('categories', category.id, {}, 'TRASH')
      await assert.rejects(repository.mutate('services', service.id, {}, 'RESTORE'), { code: 'PARENT_IN_TRASH' })
      await repository.mutate('categories', category.id, {}, 'RESTORE')
      await repository.mutate('services', service.id, {}, 'RESTORE')
      assert.equal((await client.query('SELECT service_id FROM skills WHERE id=$1', [skill.id])).rows[0].service_id, service.id)
      await repository.mutate('models',model.id,{},'TRASH')
      await repository.mutate('brands',brand.id,{},'TRASH')
      await assert.rejects(repository.mutate('models',model.id,{},'RESTORE'),{code:'PARENT_IN_TRASH'})
      await repository.mutate('brands',brand.id,{},'RESTORE')
      await repository.mutate('models',model.id,{},'RESTORE')
      assert.equal((await client.query('SELECT brand_id FROM ac_models WHERE id=$1',[model.id])).rows[0].brand_id,brand.id)
    } finally { await client.query('ROLLBACK'); client.release(); await pool.end() }
  })
