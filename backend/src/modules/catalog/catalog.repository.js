import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { resources } from './catalog.validation.js'

export class CatalogRepository {
  constructor({ transaction = withTransaction } = {}) {
    this.transaction = transaction
  }
  async list(kind, filters, mobile = false) {
    const { table } = resources[kind]
    const values = []
    const clauses = []
    const bind = (value) => {
      values.push(value)
      return `$${values.length}`
    }
    if (filters.search)
      clauses.push(
        `r.${kind === 'models' ? 'model_name' : 'name'} ILIKE ${bind(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`)}`
      )
    if (mobile || filters.status !== 'all')
      clauses.push(`r.is_active = ${bind(mobile || filters.status === 'active')}`)
    if (kind === 'services' && filters.categoryId)
      clauses.push(`r.category_id = ${bind(filters.categoryId)}`)
    if (mobile && kind === 'services') clauses.push('c.is_active = true')
    if (kind === 'models') {
      if (filters.brandId) clauses.push(`r.brand_id = ${bind(filters.brandId)}`)
      if (filters.acType) clauses.push(`r.ac_type = ${bind(filters.acType)}`)
      if (filters.capacityBtu !== undefined)
        clauses.push(`r.capacity_btu = ${bind(filters.capacityBtu)}`)
      if (filters.inverter !== undefined) clauses.push(`r.inverter = ${bind(filters.inverter)}`)
      if (mobile) clauses.push('b.is_active = true')
    }
    const join =
      kind === 'services'
        ? ' JOIN service_categories c ON c.id = r.category_id'
        : kind === 'models'
          ? ' JOIN ac_brands b ON b.id = r.brand_id'
          : ''
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    const columns =
      kind === 'models'
        ? 'r.*, b.name AS brand_name'
        : kind === 'services'
          ? 'r.*, c.name AS category_name'
          : kind === 'categories'
            ? 'r.*, (SELECT count(*)::int FROM services s WHERE s.category_id=r.id) AS service_count'
            : 'r.*, (SELECT count(*)::int FROM ac_models m WHERE m.brand_id=r.id) AS model_count'
    // Count and rows share a snapshot so pagination remains consistent during edits.
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const count = await client.query(
        `SELECT count(*)::int AS total FROM ${table} r${join}${where}`,
        values
      )
      const pagination = [...values, filters.limit, (filters.page - 1) * filters.limit]
      const rows = await client.query(
        `SELECT ${columns} FROM ${table} r${join}${where} ORDER BY r.created_at DESC, r.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        pagination
      )
      return {
        items: rows.rows,
        total: count.rows[0].total,
        page: filters.page,
        limit: filters.limit,
      }
    })
  }

  async mutate(kind, id, data, action) {
    const { table } = resources[kind]
    try {
      return await this.transaction(async (client) => {
        let existing
        if (id) {
          existing = (await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id]))
            .rows[0]
          if (!existing) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy dữ liệu.')
        }
        if (kind === 'models') {
          if (action === 'DELETE')
            throw new AppError(
              405,
              'SOFT_DISABLE_ONLY',
              'Model chỉ được vô hiệu hóa, không được xóa.'
            )
          if (data.brand_id) {
            const brand = await client.query('SELECT id FROM ac_brands WHERE id=$1 FOR KEY SHARE', [
              data.brand_id,
            ])
            if (!brand.rowCount)
              throw new AppError(422, 'VALIDATION_ERROR', 'Hãng không tồn tại.', {
                brand_id: 'Vui lòng chọn hãng khác.',
              })
          }
          if (data.model_name || data.brand_id) {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
              'catalog:models:names',
            ])
            const duplicate = await client.query(
              'SELECT id FROM ac_models WHERE brand_id=$1 AND lower(trim(model_name))=lower($2) AND ($3::uuid IS NULL OR id<>$3) LIMIT 1',
              [data.brand_id ?? existing?.brand_id, data.model_name ?? existing?.model_name, id]
            )
            if (duplicate.rowCount)
              throw new AppError(409, 'DUPLICATE_NAME', 'Tên model đã tồn tại trong hãng này.', {
                model_name: 'Vui lòng sử dụng tên khác.',
              })
          }
        }
        if (kind === 'services' && data.category_id) {
          const category = await client.query(
            'SELECT id FROM service_categories WHERE id=$1 FOR KEY SHARE',
            [data.category_id]
          )
          if (!category.rowCount)
            throw new AppError(422, 'VALIDATION_ERROR', 'Danh mục không tồn tại.', {
              category_id: 'Vui lòng chọn danh mục khác.',
            })
        }
        if (data.name) {
          // Serialize normalized-name checks without requiring changes to existing unique constraints.
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            `catalog:${kind}:names`,
          ])
          const duplicate = await client.query(
            `SELECT id FROM ${table} WHERE lower(trim(name))=lower($1) AND ($2::uuid IS NULL OR id<>$2) LIMIT 1`,
            [data.name, id]
          )
          if (duplicate.rowCount)
            throw new AppError(409, 'DUPLICATE_NAME', 'Tên đã tồn tại.', {
              name: 'Vui lòng sử dụng tên khác.',
            })
        }
        let after = null
        if (action === 'DELETE') {
          await client.query(`DELETE FROM ${table} WHERE id=$1`, [id])
        } else {
          const fields = Object.keys(data)
          const values = Object.values(data)
          if (!id) {
            after = (
              await client.query(
                `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
                values
              )
            ).rows[0]
          } else {
            const changes = fields.map((field, i) => `${field}=$${i + 1}`)
            after = (
              await client.query(
                `UPDATE ${table} SET ${changes.join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=$${values.length + 1} RETURNING *`,
                [...values, id]
              )
            ).rows[0]
          }
        }
        return after
      })
    } catch (error) {
      if (error.code === '23503' && action === 'DELETE' && kind === 'categories')
        throw new AppError(
          409,
          'RESOURCE_IN_USE',
          'Danh mục đang được dịch vụ sử dụng. Hãy chuyển dịch vụ sang danh mục khác trước khi xóa.'
        )
      if (error.code === '23505')
        throw new AppError(409, 'DUPLICATE_NAME', 'Tên đã tồn tại.', {
          name: 'Vui lòng sử dụng tên khác.',
        })
      throw error
    }
  }
}
