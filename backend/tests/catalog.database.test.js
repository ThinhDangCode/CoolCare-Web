import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { pool } from '../src/config/database.js'
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js'

test(
  'catalog uses existing tables and timestamps, protects references and rolls back failures',
  { skip: process.env.RUN_CATALOG_DB_TESTS !== '1' },
  async () => {
    const client = await pool.connect()
    await client.query('BEGIN')
    const repository = new CatalogRepository({
      transaction: async (work) => {
        await client.query('SAVEPOINT catalog_test')
        try {
          const result = await work(client)
          await client.query('RELEASE SAVEPOINT catalog_test')
          return result
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT catalog_test')
          throw error
        }
      },
    })
    try {
      const name = `Catalog-test-${randomUUID()}`
      const category = await repository.mutate(
        'categories',
        null,
        { name, is_active: true },
        'CREATE'
      )
      assert.ok(category.created_at)
      assert.ok(category.updated_at)
      await assert.rejects(
        repository.mutate('categories', null, { name: name.toUpperCase() }, 'CREATE'),
        { code: 'DUPLICATE_NAME' }
      )
      const service = await repository.mutate(
        'services',
        null,
        {
          name,
          category_id: category.id,
          base_price: 150000,
          estimated_duration: 60,
          maintenance_interval_days: 180,
        },
        'CREATE'
      )
      await assert.rejects(repository.mutate('categories', category.id, {}, 'DELETE'), {
        code: 'RESOURCE_IN_USE',
      })
      assert.equal(
        (await client.query('SELECT id FROM service_categories WHERE id=$1', [category.id]))
          .rowCount,
        1
      )
      await client.query("UPDATE services SET updated_at='2000-01-01' WHERE id=$1", [service.id])
      const updated = await repository.mutate(
        'services',
        service.id,
        { base_price: 200000 },
        'UPDATE'
      )
      assert.equal(Number(updated.base_price), 200000)
      assert.ok(updated.updated_at > new Date('2000-01-01'))
      assert.equal(updated.created_at.getTime(), service.created_at.getTime())
      const toggled = await repository.mutate(
        'services',
        service.id,
        { is_active: false },
        'TOGGLE'
      )
      assert.equal(toggled.is_active, false)
      const before = (await client.query('SELECT count(*)::int AS total FROM services')).rows[0]
        .total
      await assert.rejects(
        repository.mutate(
          'services',
          null,
          { name, category_id: randomUUID(), base_price: 100 },
          'CREATE'
        ),
        { status: 422 }
      )
      assert.equal(
        (await client.query('SELECT count(*)::int AS total FROM services')).rows[0].total,
        before
      )
      const brand = await repository.mutate('brands', null, { name }, 'CREATE')
      const updatedBrand = await repository.mutate(
        'brands',
        brand.id,
        { description: 'Updated', is_active: false },
        'UPDATE'
      )
      assert.equal(updatedBrand.description, 'Updated')
      assert.equal(updatedBrand.is_active, false)
      const emptyCategory = await repository.mutate(
        'categories',
        null,
        { name: `${name}-empty` },
        'CREATE'
      )
      await repository.mutate('categories', emptyCategory.id, {}, 'DELETE')
      assert.equal(
        (await client.query('SELECT id FROM service_categories WHERE id=$1', [emptyCategory.id]))
          .rowCount,
        0
      )
      const modelData = {
        model_name: `${name}-model`,
        brand_id: brand.id,
        ac_type: 'WALL_MOUNTED',
        capacity_btu: 12000,
        inverter: false,
      }
      const model = await repository.mutate('models', null, modelData, 'CREATE')
      await assert.rejects(
        repository.mutate(
          'models',
          null,
          { ...modelData, model_name: modelData.model_name.toUpperCase() },
          'CREATE'
        ),
        { code: 'DUPLICATE_NAME' }
      )
      await assert.rejects(
        repository.mutate('models', null, { ...modelData, brand_id: randomUUID() }, 'CREATE'),
        { status: 422 }
      )
      const otherBrand = await repository.mutate(
        'brands',
        null,
        { name: `${name}-other-brand` },
        'CREATE'
      )
      const sameNameOtherBrand = await repository.mutate(
        'models',
        null,
        { ...modelData, brand_id: otherBrand.id },
        'CREATE'
      )
      await assert.rejects(
        repository.mutate('models', sameNameOtherBrand.id, { brand_id: brand.id }, 'UPDATE'),
        { code: 'DUPLICATE_NAME' }
      )
      const changedModel = await repository.mutate(
        'models',
        model.id,
        { capacity_btu: 18000, inverter: true },
        'UPDATE'
      )
      assert.equal(changedModel.capacity_btu, 18000)
      assert.equal(changedModel.inverter, true)
      await assert.rejects(repository.mutate('models', model.id, {}, 'DELETE'), {
        code: 'SOFT_DISABLE_ONLY',
      })
      const disabled = await repository.mutate('models', model.id, { is_active: false }, 'TOGGLE')
      assert.equal(disabled.is_active, false)
      assert.equal(
        (await client.query('SELECT id FROM ac_models WHERE id=$1', [model.id])).rowCount,
        1
      )
      const referenced = (
        await client.query(
          'SELECT ac_model_id FROM booking_units WHERE ac_model_id IS NOT NULL LIMIT 1'
        )
      ).rows[0]
      assert.ok(referenced, 'The local integration fixture needs a booking with an AC model')
      const bookingsBefore = (
        await client.query('SELECT * FROM booking_units WHERE ac_model_id=$1 ORDER BY id', [
          referenced.ac_model_id,
        ])
      ).rows
      await repository.mutate('models', referenced.ac_model_id, { is_active: false }, 'TOGGLE')
      const bookingsAfter = (
        await client.query('SELECT * FROM booking_units WHERE ac_model_id=$1 ORDER BY id', [
          referenced.ac_model_id,
        ])
      ).rows
      assert.deepEqual(bookingsAfter, bookingsBefore)
      // Verify read endpoints against committed local fixtures independently of rolled-back test records.
      const reader = new CatalogRepository()
      const mobile = await reader.list(
        'services',
        { page: 1, limit: 100, search: '', status: 'inactive' },
        true
      )
      assert.ok(mobile.items.every((item) => item.is_active))
      const categories = await reader.list('categories', {
        page: 1,
        limit: 10,
        search: '',
        status: 'all',
      })
      assert.ok(categories.total >= categories.items.length)
      assert.ok(categories.items.every((item) => Number.isInteger(item.service_count)))
      const models = await reader.list('models', {
        page: 1,
        limit: 100,
        search: '',
        status: 'all',
        acType: 'WALL_MOUNTED',
        capacityBtu: 9000,
        inverter: false,
      })
      assert.ok(models.items.length > 0)
      assert.ok(
        models.items.every(
          (item) =>
            item.ac_type === 'WALL_MOUNTED' &&
            item.capacity_btu === 9000 &&
            item.inverter === false &&
            item.brand_name
        )
      )
      const firstBrand = models.items[0].brand_id
      const brandModels = await reader.list('models', {
        page: 1,
        limit: 100,
        search: '',
        status: 'active',
        brandId: firstBrand,
      })
      assert.ok(brandModels.items.every((item) => item.brand_id === firstBrand && item.is_active))
      const mobileModels = await reader.list(
        'models',
        { page: 1, limit: 100, search: '', status: 'inactive' },
        true
      )
      assert.ok(mobileModels.items.every((item) => item.is_active))
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pool.end()
    }
  }
)
