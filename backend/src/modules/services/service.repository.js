import { pool } from '../../config/database.js'

export async function listActiveServices({ query = pool.query.bind(pool) } = {}) {
  const result = await query(`
    SELECT s.id, s.category_id, s.name, s.description,
           s.base_price, s.estimated_duration,
           s.maintenance_interval_days, s.is_active
    FROM services s
    JOIN service_categories c ON c.id = s.category_id
    WHERE s.is_active = true AND s.deleted_at IS NULL
      AND c.is_active = true AND c.deleted_at IS NULL
    ORDER BY s.name ASC
  `)
  return result.rows
}

export async function findActiveServiceById(id, { query = pool.query.bind(pool) } = {}) {
  const result = await query(`
    SELECT s.id, s.category_id, s.name, s.description,
           s.base_price, s.estimated_duration,
           s.maintenance_interval_days, s.is_active
    FROM services s
    JOIN service_categories c ON c.id = s.category_id
    WHERE s.id = $1 AND s.is_active = true AND s.deleted_at IS NULL
      AND c.is_active = true AND c.deleted_at IS NULL
    LIMIT 1
  `, [id])
  return result.rows[0] ?? null
}
