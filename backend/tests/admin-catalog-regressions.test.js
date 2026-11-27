import assert from 'node:assert/strict'
import test from 'node:test'
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js'
import { validateInput } from '../src/modules/catalog/catalog.validation.js'
import { TechnicianMutations } from '../src/modules/technicians/technician.mutations.js'
import { validateTechnicianUpdate } from '../src/modules/technicians/technician.validation.js'

const id = '12345678-1234-1234-1234-123456789012'
const timestamp = '2026-11-23T01:00:00.000Z'

for (const kind of ['categories', 'brands', 'services', 'models', 'skills']) {
  test(`restore ${kind} rejects a reused name before writing or auditing`, async () => {
    const queries = []
    const audits = []
    const existing = { id, name: 'Same name', model_name: 'Model A', brand_id: id, deleted_at: timestamp }
    const repository = new CatalogRepository({
      audit: event => audits.push(event),
      transaction: work => work({ query: async (sql, values) => {
        queries.push({ sql, values })
        if (sql.includes('FOR UPDATE')) return { rows: [existing] }
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
        if (sql.includes('lower(trim(')) return { rows: [{ id: 'duplicate' }], rowCount: 1 }
        throw new Error(`Unexpected query: ${sql}`)
      } }),
    })
    await assert.rejects(repository.mutate(kind, id, {}, 'RESTORE', 'admin'), {
      status: 409, code: 'DUPLICATE_NAME',
    })
    assert.equal(audits.length, 0)
    assert.equal(queries.some(({ sql }) => sql.includes('SET deleted_at')), false)
    if (kind === 'models') {
      const duplicate = queries.find(({ sql }) => sql.includes('lower(trim('))
      assert.match(duplicate.sql, /brand_id = \$3/)
      assert.equal(duplicate.values[2], existing.brand_id)
    }
  })
}

test('catalog edits reject stale versions and never write the version token as a column', async () => {
  const writes = []
  const repository = new CatalogRepository({
    audit: () => {},
    transaction: work => work({ query: async (sql, values) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ id, updated_at: timestamp, deleted_at: null }] }
      if (sql.includes('UPDATE')) {
        writes.push({ sql, values })
        return { rows: [{ id, is_active: false }] }
      }
      throw new Error(`Unexpected query: ${sql}`)
    } }),
  })
  await assert.rejects(repository.mutate('brands', id, {
    is_active: false, expected_updated_at: '2026-11-22T01:00:00Z',
  }, 'UPDATE'), { status: 409, code: 'STALE_CATALOG' })
  assert.equal(writes.length, 0)
  await repository.mutate('brands', id, { is_active: false, expected_updated_at: timestamp }, 'UPDATE')
  assert.equal(writes.length, 1)
  assert.doesNotMatch(writes[0].sql, /expected_updated_at/)
  assert.deepEqual(writes[0].values, [false, id])
  assert.throws(() => validateInput('brands', { expected_updated_at: timestamp }, true), { status: 422 })
  assert.throws(() => validateInput('brands', { is_active: false, expected_updated_at: 'bad' }, true), { status: 422 })
})

test('soft delete audit includes before and after for every catalog kind', async () => {
  for (const kind of ['categories', 'brands', 'services', 'models', 'skills']) {
    const existing = { id, name: 'Before', deleted_at: null }
    const after = { ...existing, deleted_at: timestamp }
    const audits = []
    const repository = new CatalogRepository({
      audit: event => audits.push(event),
      transaction: work => work({ query: async sql => {
        if (sql.includes('FOR UPDATE')) return { rows: [existing] }
        if (sql.includes('SET deleted_at')) return { rows: [after] }
        return { rows: [] }
      } }),
    })
    await repository.mutate(kind, id, {}, 'TRASH', 'admin')
    assert.deepEqual(audits[0].before, existing)
    assert.deepEqual(audits[0].after, after)
    assert.ok(audits[0].entityType)
  }
})

function skillMutations(previous, available) {
  const queries = []
  const audits = []
  const mutations = new TechnicianMutations({
    audit: event => audits.push(event),
    transaction: work => work({ query: async (sql, values) => {
      queries.push({ sql, values })
      if (sql.startsWith('SELECT * FROM technician_profiles')) return { rows: [{ verification_status: 'VERIFIED' }] }
      if (sql.startsWith('SELECT skill_id')) return { rows: previous }
      if (sql.includes('FROM skills s')) return { rows: available ? [{ id }] : [] }
      return { rows: [] }
    } }),
  })
  return { mutations, queries, audits }
}

test('unchanged historical inactive assignments can be retained while updating other skills', async () => {
  const historical = { skill_id: id, ac_brand_id: id, skill_level: 'BEGINNER' }
  const added = { skill_id: 'new-skill', ac_brand_id: null, skill_level: 'ADVANCED' }
  const { mutations, queries, audits } = skillMutations([historical], true)
  await mutations.skills(id, { skills: [historical, added] }, 'admin')
  const checks = queries.filter(({ sql }) => sql.includes('FROM skills s'))
  assert.equal(checks.length, 1)
  assert.deepEqual(checks[0].values, [added.skill_id])
  assert.match(checks[0].sql, /v.is_active AND v.deleted_at IS NULL/)
  assert.match(checks[0].sql, /c.is_active AND c.deleted_at IS NULL/)
  assert.equal(queries.filter(({ sql }) => sql.startsWith('INSERT INTO technician_skills')).length, 2)
  assert.equal(audits.length, 1)
})

test('new or modified unavailable assignments fail before deleting existing skills', async () => {
  const previous = { skill_id: id, ac_brand_id: null, skill_level: 'BEGINNER' }
  const { mutations, queries, audits } = skillMutations([previous], false)
  await assert.rejects(mutations.skills(id, { skills: [{ ...previous, skill_level: 'EXPERT' }] }, 'admin'), {
    status: 422, code: 'INVALID_SKILL',
  })
  assert.equal(queries.some(({ sql }) => sql.startsWith('DELETE')), false)
  assert.equal(audits.length, 0)
})

test('technician profile edits reject stale versions before writing', async () => {
  const queries = []
  const mutations = new TechnicianMutations({
    audit: () => assert.fail('Stale edits must not audit success'),
    transaction: work => work({ query: async sql => {
      queries.push(sql)
      return { rows: sql.startsWith('SELECT * FROM technician_profiles') ? [{ updated_at: timestamp }] : [] }
    } }),
  })
  await assert.rejects(mutations.update(id, { expected_updated_at: '2026-11-22T01:00:00Z' }, 'admin'), {
    status: 409, code: 'STALE_TECHNICIAN',
  })
  assert.equal(queries.some(sql => sql.startsWith('UPDATE')), false)
  assert.throws(() => validateTechnicianUpdate({ expected_updated_at: 'invalid' }), { status: 422 })
})
