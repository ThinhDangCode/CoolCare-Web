import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createServiceCategoryRouter } from '../src/modules/services/service-category.routes.js'
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler.js'

test('GET /service-categories returns active categories for the mobile app', async () => {
  const rows = [
    {
      id: '12345678-1234-1234-1234-123456789012',
      name: 'Vệ sinh máy lạnh',
      description: 'Dịch vụ vệ sinh',
      image_url: null,
      is_active: true,
    },
  ]
  let sql = ''
  const app = express()
  app.use(
    '/service-categories',
    createServiceCategoryRouter({
      query: async (statement) => {
        sql = statement
        return { rows }
      },
    })
  )
  app.use(notFoundHandler)
  app.use(errorHandler)

  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/service-categories`
    )
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { data: rows })
    assert.match(sql, /WHERE is_active = true/)
    assert.match(sql, /ORDER BY name ASC/)
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})
