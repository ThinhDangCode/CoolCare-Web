import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { validateInput, validateQuery } from '../src/modules/catalog/catalog.validation.js'
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js'
import { pool } from '../src/config/database.js'

const id = '12345678-1234-1234-1234-123456789012'
test('skills require a name and service, validate status and filters', () => {
  assert.deepEqual(validateInput('skills', { name: ' Cleaning ', service_id: id }), {
    name: 'Cleaning',
    service_id: id,
  })
  for (const body of [
    { name: 'Cleaning' },
    { service_id: id },
    { name: ' ', service_id: id },
    { name: 'Cleaning', service_id: 'bad' },
    { name: 'Cleaning', service_id: id, is_active: 'false' },
    { name: 'Cleaning', service_id: id, skill_level: 'EXPERT' },
  ])
    assert.throws(() => validateInput('skills', body), { status: 422 })
  assert.deepEqual(validateInput('skills', { is_active: false }, true), { is_active: false })
  const filters = validateQuery({ service_id: id, sort: 'name', status: 'inactive' }, 'skills')
  assert.equal(filters.serviceId, id)
  assert.equal(filters.sort, 'name')
  for (const query of [{ service_id: 'bad' }, { service_id: [id] }, { sort: 'invalid' }])
    assert.throws(() => validateQuery(query, 'skills'), { status: 422 })
})

test('skill names reject numbers on create and update while accepting Vietnamese letters', () => {
  for (const name of ['123', 'Repair 123', 'Sửa máy １２', 'Cleaning ٢', 'Repair ²']) {
    for (const partial of [false, true]) {
      assert.throws(() => validateInput('skills', { name, service_id: id }, partial), {
        status: 422,
      })
    }
  }
  for (const name of ['Vệ sinh máy lạnh', 'Inverter PCB Diagnostic & Repair']) {
    assert.equal(validateInput('skills', { name, service_id: id }).name, name)
  }
})

test(
  'skills reject duplicate names and invalid services, audit updates, and preserve technician assignments on soft delete',
  { skip: process.env.RUN_SKILL_DB_TESTS !== '1' },
  async () => {
    const client = await pool.connect()
    await client.query('BEGIN')
    const audits = []
    const repository = new CatalogRepository({
      audit: (event) => audits.push(event),
      transaction: async (work) => {
        await client.query('SAVEPOINT skill_test')
        try {
          const result = await work({
            query: (sql, values) =>
              sql.startsWith('SET TRANSACTION')
                ? Promise.resolve({ rows: [] })
                : client.query(sql, values),
          })
          await client.query('RELEASE SAVEPOINT skill_test')
          return result
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT skill_test')
          throw error
        }
      },
    })
    try {
      const category = await repository.mutate(
        'categories',
        null,
        { name: `Skill-category-${randomUUID()}` },
        'CREATE'
      )
      const service = await repository.mutate(
        'services',
        null,
        { name: `Skill-service-${randomUUID()}`, category_id: category.id, base_price: 0 },
        'CREATE'
      )
      const skill = await repository.mutate(
        'skills',
        null,
        { name: `Skill-${randomUUID()}`, service_id: service.id },
        'CREATE',
        id
      )
      await assert.rejects(
        repository.mutate(
          'skills',
          null,
          { name: skill.name.toUpperCase(), service_id: service.id },
          'CREATE'
        ),
        { code: 'DUPLICATE_NAME' }
      )
      await assert.rejects(
        repository.mutate('skills', skill.id, { service_id: randomUUID() }, 'UPDATE'),
        { status: 422 }
      )
      const technician = (await client.query('SELECT id FROM technician_profiles LIMIT 1')).rows[0]
      if (technician)
        await client.query(
          'INSERT INTO technician_skills(id,technician_id,skill_id,skill_level) VALUES($1,$2,$3,$4)',
          [randomUUID(), technician.id, skill.id, 'INTERMEDIATE']
        )
      const brand = (await client.query('SELECT id FROM ac_brands LIMIT 1')).rows[0]
      if (technician && brand)
        await client.query(
          'INSERT INTO technician_skills(id,technician_id,skill_id,ac_brand_id,skill_level) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), technician.id, skill.id, brand.id, 'ADVANCED']
        )
      const filtered = await repository.list(
        'skills',
        validateQuery({ service_id: service.id }, 'skills')
      )
      assert.deepEqual(filtered.counts, { all: 1, active: 1, inactive: 0 })
      assert.equal(filtered.items[0].technician_count, technician ? 1 : 0)
      assert.equal(filtered.items[0].service_name, service.name)
      for (const search of [service.name, filtered.items[0].code, skill.name]) {
        const found = await repository.list(
          'skills',
          validateQuery({ service_id: service.id, search }, 'skills')
        )
        assert.equal(found.total, 1)
      }
      const escaped = await repository.list(
        'skills',
        validateQuery({ service_id: service.id, search: '%' }, 'skills')
      )
      assert.equal(escaped.total, 0)
      await repository.mutate('services', service.id, { is_active: false }, 'TOGGLE')
      await assert.rejects(
        repository.mutate(
          'skills',
          null,
          { name: 'Inactive-service-skill', service_id: service.id },
          'CREATE'
        ),
        { status: 422 }
      )
      const updated = await repository.mutate(
        'skills',
        skill.id,
        { name: `${skill.name}-edited`, service_id: service.id },
        'UPDATE',
        id
      )
      assert.equal(updated.name, `${skill.name}-edited`)
      const disabled = await repository.mutate('skills', skill.id, { is_active: false }, 'DEACTIVATE', id)
      assert.equal(disabled.is_active, false)
      const inactive = await repository.list(
        'skills',
        validateQuery({ service_id: service.id, status: 'inactive' }, 'skills')
      )
      assert.deepEqual(inactive.counts, { all: 1, active: 0, inactive: 1 })
      assert.equal(inactive.total, 1)
      assert.equal(inactive.items[0].service_is_active, false)
      const mobile = await repository.list(
        'skills',
        validateQuery({ service_id: service.id }, 'skills'),
        true
      )
      assert.equal(mobile.total, 0)
      assert.equal(
        (await client.query('SELECT id FROM skills WHERE id=$1', [skill.id])).rowCount,
        1
      )
      if (technician)
        assert.equal(
          (await client.query('SELECT id FROM technician_skills WHERE skill_id=$1', [skill.id]))
            .rowCount,
          brand ? 2 : 1
        )
      const reactivated = await repository.mutate(
        'skills',
        skill.id,
        { is_active: true },
        'TOGGLE',
        id
      )
      assert.equal(reactivated.is_active, true)
      assert.equal(audits.length, 4)
      assert.equal(audits[1].actorId, id)
      assert.equal(audits[1].before.name, skill.name)
      assert.equal(audits[1].after.name, updated.name)
      assert.equal(audits[2].action, 'DEACTIVATE')
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pool.end()
    }
  }
)
