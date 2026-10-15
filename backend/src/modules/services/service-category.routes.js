import { Router } from 'express'
import { pool } from '../../config/database.js'
import { asyncHandler } from '../../utils.js'

export function createServiceCategoryRouter({ query = pool.query.bind(pool) } = {}) {
  const router = Router()

  router.get(
    '/',
    asyncHandler(async (_request, response) => {
      const result = await query(`
        SELECT
          id,
          name,
          description,
          image_url,
          is_active
        FROM service_categories
        WHERE is_active = true
        ORDER BY name ASC
      `)

      response.json({ data: result.rows })
    })
  )

  return router
}
