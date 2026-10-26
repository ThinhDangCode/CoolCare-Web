import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'
import { validateAcHistoryQuery } from '../src/modules/customer-ac-units/ac-unit.validation.js'
import { CustomerAcUnitService } from '../src/modules/customer-ac-units/ac-unit.service.js'
import { createCustomerAcUnitRouter } from '../src/modules/customer-ac-units/ac-unit.routes.js'

const userId = '11111111-1111-1111-1111-111111111111'
const otherUser = '22222222-2222-2222-2222-222222222222'
const brandId = '33333333-3333-3333-3333-333333333333'
const modelId = '44444444-4444-4444-4444-444444444444'

const row = {
  bookingId: 'b1', bookingCode: 'BK-1', bookingStatus: 'COMPLETED', scheduledAt: '2026-10-01T01:00:00Z',
  completedAt: '2026-10-01T03:00:00Z', totalAmount: '350000.00', unitNumber: 1, description: ' Phòng ngủ ',
  diagnosis: 'Dàn lạnh bẩn', serviceNotes: '', technicianName: 'Trần Minh Khang',
  services: [{ id: 's1', name: 'Vệ sinh máy lạnh', unitPrice: 150000 }],
  additionalWork: [{ description: 'Nạp gas', totalPrice: 200000 }],
}

function repo(overrides = {}) {
  const calls = []
  return {
    calls,
    async listGroups(user) {
      calls.push(['list', user])
      return overrides.groups ?? [{ brandId, modelId, brandName: 'Daikin', modelName: 'FTKB', capacityBtu: '9000', serviceCount: 3, completedCount: 2, lastServiceAt: '2026-10-01T03:00:00Z' }]
    },
    async findGroup(user, b, m) {
      calls.push(['group', user, b, m])
      return user === userId ? { total: overrides.total ?? 3, brandName: 'Daikin', modelName: 'FTKB', capacityBtu: '9000' } : { total: 0 }
    },
    async findHistory(user, filter) { calls.push(['history', user, filter]); return overrides.rows ?? [row] },
  }
}

test('query validation accepts uuids or "none" and bounds paging', () => {
  assert.deepEqual(validateAcHistoryQuery({ brandId, modelId: 'none' }), { brandId, modelId: null, page: 1, limit: 20, offset: 0 })
  assert.equal(validateAcHistoryQuery({ brandId, modelId, page: '3', limit: '10' }).offset, 20)
  for (const query of [
    {}, { brandId }, { brandId, modelId: 'x' }, { brandId: ['a'], modelId }, { brandId, modelId, page: '0' },
    { brandId, modelId, page: '1.5' }, { brandId, modelId, limit: '51' }, { brandId, modelId, limit: ['5'] },
    { brandId, modelId, extra: '1' }, { brandId: "' OR 1=1 --", modelId },
  ]) {
    assert.throws(() => validateAcHistoryQuery(query), { status: 422, code: 'VALIDATION_ERROR' }, JSON.stringify(query))
  }
})

test('service lists devices and maps history for the signed-in customer only', async () => {
  const repository = repo()
  const service = new CustomerAcUnitService(repository)
  const list = await service.listUnits(userId)
  assert.equal(list.items[0].capacityBtu, 9000)
  assert.equal(list.items[0].serviceCount, 3)
  const history = await service.getHistory(userId, { brandId, modelId, limit: '2' })
  assert.deepEqual(repository.calls.at(-1)[2], { brandId, modelId, page: 1, limit: 2, offset: 0 })
  assert.equal(history.pagination.totalPages, 2)
  assert.equal(history.unit.brandName, 'Daikin')
  const [item] = history.items
  assert.equal(item.status, 'COMPLETED')
  assert.equal(item.technicianName, 'Trần Minh Khang')
  assert.equal(item.description, 'Phòng ngủ')
  assert.equal(item.serviceNotes, null)
  assert.equal(item.totalAmount, 350000)
  assert.equal(item.services[0].name, 'Vệ sinh máy lạnh')
  assert.equal(item.additionalWork[0].totalPrice, 200000)
})

test('unknown or foreign devices are 404 and out-of-range pages are empty', async () => {
  const service = new CustomerAcUnitService(repo())
  await assert.rejects(service.getHistory(otherUser, { brandId, modelId }), { status: 404, code: 'AC_UNIT_NOT_FOUND' })
  const far = repo({ total: 3 })
  const empty = await new CustomerAcUnitService(far).getHistory(userId, { brandId, modelId, page: '5', limit: '10' })
  assert.deepEqual(empty.items, [])
  assert.equal(far.calls.some(([name]) => name === 'history'), false)
  await assert.rejects(service.listUnits('not-a-uuid'), { status: 422 })
})

test('HTTP: customers only, JSON payloads, validation errors', async () => {
  const app = express()
  app.use('/api/customer/ac-units', createCustomerAcUnitRouter(new CustomerAcUnitService(repo())))
  app.use(notFoundHandler)
  app.use(errorHandler)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/customer/ac-units`
  const token = (role, sub = userId) => jwt.sign({ sub, role, purpose: 'access' }, env.jwtSecret, { expiresIn: '5m' })
  const get = (path, t) => fetch(`${base}${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} })
  try {
    assert.equal((await get('/')).status, 401)
    assert.equal((await get('/', token('ADMIN'))).status, 403)
    const list = await get('/', token('CUSTOMER'))
    assert.equal(list.status, 200)
    assert.equal(list.headers.get('cache-control'), 'private, no-store')
    assert.equal((await list.json()).data.items.length, 1)
    assert.equal((await get('/service-history', token('CUSTOMER'))).status, 422)
    assert.equal((await get(`/service-history?brandId=${brandId}&modelId=${modelId}`, token('CUSTOMER', otherUser))).status, 404)
    const ok = await get(`/service-history?brandId=${brandId}&modelId=none`, token('CUSTOMER'))
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).data.items[0].bookingCode, 'BK-1')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
