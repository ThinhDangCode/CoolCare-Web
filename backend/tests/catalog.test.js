import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { createCatalogRouter } from '../src/modules/catalog/catalog.routes.js'
import {
  validateId,
  validateInput,
  validateQuery,
} from '../src/modules/catalog/catalog.validation.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'

const id = '12345678-1234-1234-1234-123456789012'
test('AC models require valid brand, name, AC type, positive BTU and explicit inverter', () => {
  const model = {
    model_name: '  Model 12  ',
    brand_id: id,
    ac_type: 'WALL_MOUNTED',
    capacity_btu: 12000,
    inverter: false,
  }
  assert.equal(validateInput('models', model).model_name, 'Model 12')
  assert.equal(validateInput('models', model).inverter, false)
  for (const key of ['model_name', 'brand_id', 'ac_type', 'capacity_btu', 'inverter']) {
    const missing = { ...model }
    delete missing[key]
    assert.throws(() => validateInput('models', missing), { status: 422 })
  }
  for (const patch of [
    { model_name: ' ' },
    { model_name: 'x'.repeat(101) },
    { brand_id: 'bad' },
    { ac_type: 'UNKNOWN' },
    { ac_type: null },
    { capacity_btu: null },
    { capacity_btu: 0 },
    { capacity_btu: -1 },
    { capacity_btu: 1.5 },
    { capacity_btu: '12000' },
    { inverter: 'false' },
    { inverter: null },
  ])
    assert.throws(() => validateInput('models', { ...model, ...patch }), { status: 422 })
  assert.deepEqual(validateInput('models', { is_active: false }, true), { is_active: false })
})
test('AC model filters preserve false inverter and validate all specifications', () => {
  const filters = validateQuery(
    { brand_id: id, ac_type: 'WALL_MOUNTED', capacity_btu: '9000', inverter: 'false' },
    'models'
  )
  assert.equal(filters.brandId, id)
  assert.equal(filters.acType, 'WALL_MOUNTED')
  assert.equal(filters.capacityBtu, 9000)
  assert.equal(filters.inverter, false)
  for (const query of [
    { brand_id: 'bad' },
    { ac_type: 'bad' },
    { capacity_btu: '0' },
    { capacity_btu: '1.5' },
    { capacity_btu: ['9000'] },
    { inverter: '1' },
    { inverter: ['false'] },
  ])
    assert.throws(() => validateQuery(query, 'models'), { status: 422 })
})
test('catalog validates names, writable fields, prices and optional intervals', () => {
  assert.deepEqual(validateInput('categories', { name: '  Cleaning  ', description: '' }), {
    name: 'Cleaning',
    description: null,
  })
  for (const body of [{ name: '' }, { name: 12 }, { name: 'x'.repeat(101) }, { name: 'Valid', id }])
    assert.throws(() => validateInput('categories', body), { status: 422 })
  const service = { name: 'Cleaning', category_id: id, base_price: 0, estimated_duration: null }
  assert.equal(validateInput('services', service).base_price, 0)
  for (const base_price of [-1, NaN, Infinity, '100', 0.001, 10000000000])
    assert.throws(() => validateInput('services', { ...service, base_price }), { status: 422 })
  for (const estimated_duration of [0, -1, 1.5, '30', 2147483648])
    assert.throws(() => validateInput('services', { ...service, estimated_duration }), {
      status: 422,
    })
  assert.throws(() => validateInput('brands', { is_active: 'true' }, true), { status: 422 })
  assert.throws(() => validateInput('brands', {}, true), { status: 422 })
  assert.throws(
    () => validateInput('categories', { name: 'Valid', image_url: 'javascript:alert(1)' }),
    { status: 422 }
  )
  assert.throws(() => validateId('invalid'), { status: 422 })
})
test('catalog bounds pagination and validates filters', () => {
  assert.deepEqual(validateQuery({}), {
    page: 1,
    limit: 10,
    search: '',
    status: 'all',
    categoryId: undefined,
  })
  for (const query of [
    { page: '0' },
    { page: '1.5' },
    { limit: '101' },
    { status: 'unknown' },
    { search: ['one', 'two'] },
    { category_id: 'bad' },
  ])
    assert.throws(() => validateQuery(query), { status: 422 })
})

test('catalog routes enforce Admin access and mobile read-only requests', async () => {
  const calls = []
  const repository = {
    async list(...args) {
      calls.push(['list', ...args])
      return { items: [], total: 0, page: 1, limit: 10 }
    },
    async mutate(...args) {
      calls.push(['mutate', ...args])
      return { id, ...args[2] }
    },
  }
  const app = express()
  app.use(express.json())
  app.use('/admin', createCatalogRouter(repository))
  app.use('/mobile', createCatalogRouter(repository, false))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const sign = (role) =>
    jwt.sign({ sub: id, role, purpose: 'access' }, env.jwtSecret, { expiresIn: '5m' })
  const admin = sign('ADMIN')
  const customer = sign('CUSTOMER')
  async function request(path, token, method = 'GET', body) {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  }
  try {
    assert.equal((await request('/admin/categories')).status, 401)
    assert.equal((await request('/admin/categories', 'bad-token')).status, 401)
    assert.equal((await request('/admin/categories', customer)).status, 403)
    assert.equal(calls.length, 0)
    assert.equal(
      (await request('/admin/categories', admin, 'POST', { name: 'Cleaning' })).status,
      201
    )
    assert.equal(calls.at(-1)[4], 'CREATE')
    assert.equal(
      (await request(`/admin/categories/${id}`, admin, 'PATCH', { name: 'Updated' })).status,
      200
    )
    assert.equal((await request(`/admin/categories/${id}`, admin, 'DELETE')).status, 204)
    assert.equal((await request('/admin/services', admin, 'POST', { name: 'Invalid' })).status, 422)
    assert.equal(
      (await request(`/admin/services/${id}/status`, admin, 'PATCH', { is_active: false })).status,
      200
    )
    assert.equal(calls.at(-1)[4], 'TOGGLE')
    assert.equal(
      (
        await request(`/admin/services/${id}/status`, admin, 'PATCH', {
          is_active: false,
          name: 'Injected',
        })
      ).status,
      422
    )
    assert.equal((await request('/mobile/services?status=inactive', customer)).status, 200)
    assert.equal(calls.at(-1)[3], true)
    assert.equal(
      (await request('/mobile/services', customer, 'POST', { name: 'Denied' })).status,
      404
    )
    assert.equal((await request(`/admin/brands/${id}`, admin, 'DELETE')).status, 404)
    assert.equal((await request(`/admin/categories/${id}/audit`, admin)).status, 404)
    assert.equal((await request('/admin/models', customer)).status, 403)
    assert.equal(
      (
        await request('/admin/models', admin, 'POST', {
          model_name: 'Model A',
          brand_id: id,
          ac_type: 'WALL_MOUNTED',
          capacity_btu: 9000,
          inverter: false,
        })
      ).status,
      201
    )
    assert.equal(
      (await request('/admin/models?inverter=false&capacity_btu=9000', admin)).status,
      200
    )
    assert.equal(calls.at(-1)[2].inverter, false)
    assert.equal(
      (await request(`/admin/models/${id}/status`, admin, 'PATCH', { is_active: false })).status,
      200
    )
    assert.equal(calls.at(-1)[4], 'TOGGLE')
    assert.equal((await request(`/admin/models/${id}`, admin, 'DELETE')).status, 404)
    assert.equal(
      (await request('/mobile/models', customer, 'POST', { model_name: 'Denied' })).status,
      404
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
