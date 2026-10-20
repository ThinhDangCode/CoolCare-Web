import assert from 'node:assert/strict'
import test from 'node:test'
import { CatalogRepository } from '../src/modules/catalog/catalog.repository.js'
import { validateQuery } from '../src/modules/catalog/catalog.validation.js'

test('catalog preserves sorting and model filters after integration', async () => {
  const statements = []
  const repository = new CatalogRepository({
    transaction: async (work) => work({
      query: async (sql, values) => {
        statements.push({ sql, values })
        return sql.startsWith('SELECT count')
          ? { rows: [{ total: 0 }] }
          : { rows: [] }
      },
    }),
  })

  const filters = validateQuery(
    { sort: 'CAPACITY_DESC', capacity_btu: '12000', inverter: 'true', limit: '25' },
    'models'
  )
  await repository.list('models', filters)
  const rows = statements.find(({ sql }) => sql.startsWith('SELECT r.*'))
  assert.match(rows.sql, /ORDER BY r\.capacity_btu DESC/)
  assert.match(rows.sql, /r\.capacity_btu = \$1/)
  assert.match(rows.sql, /r\.inverter = \$2/)
  assert.deepEqual(rows.values, [12000, true, 25, 0])
  assert.throws(() => validateQuery({ sort: 'DROP TABLE services' }, 'models'), { status: 422 })
})
