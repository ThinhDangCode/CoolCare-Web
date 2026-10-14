import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { writeAdminAudit } from '../audit/admin-audit.js'

const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&')

export class BlogRepository {
  constructor({ transaction = withTransaction, audit = writeAdminAudit } = {}) {
    this.transaction = transaction
    this.audit = audit
  }

  async listPublished({ page, limit, search }) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = []
      let searchClause = ''
      if (search) {
        values.push(`%${escapeLike(search)}%`)
        searchClause = ' AND (b.title ILIKE $1 OR b.content ILIKE $1 OR u.full_name ILIKE $1)'
      }
      const from = ` FROM blogs b JOIN users u ON u.id=b.author_id
                     WHERE b.status='PUBLISHED' AND b.published_at IS NOT NULL${searchClause}`
      const count = await client.query(`SELECT count(*)::int total${from}`, values)
      const rows = await client.query(
        `SELECT b.id,b.title,b.slug,b.thumbnail_url,b.content,b.published_at,b.updated_at,
                u.full_name author_name${from}
         ORDER BY b.published_at DESC,b.id DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, (page - 1) * limit]
      )
      return { items: rows.rows, total: count.rows[0].total, page, limit }
    })
  }

  async getPublished(id) {
    const row = await this.transaction(
      async (client) =>
        (
          await client.query(
            `SELECT b.id,b.title,b.slug,b.thumbnail_url,b.content,b.published_at,b.updated_at,
                  u.full_name author_name
             FROM blogs b JOIN users u ON u.id=b.author_id
            WHERE b.id=$1 AND b.status='PUBLISHED' AND b.published_at IS NOT NULL`,
            [id]
          )
        ).rows[0]
    )
    if (!row) throw new AppError(404, 'BLOG_NOT_FOUND', 'Không tìm thấy bài viết đã đăng.')
    return row
  }

  async listAdmin(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = []
      const clauses = []
      if (filters.search) {
        values.push(`%${escapeLike(filters.search)}%`)
        clauses.push(`(b.title ILIKE $1 OR b.slug ILIKE $1 OR u.full_name ILIKE $1)`)
      }
      if (filters.status !== 'ALL') {
        values.push(filters.status)
        clauses.push(`b.status=$${values.length}`)
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const from =
        ' FROM (SELECT blogs.*,ROW_NUMBER() OVER(ORDER BY created_at ASC,id ASC)::int blog_number FROM blogs) b JOIN users u ON u.id=b.author_id'
      const count = await client.query(`SELECT count(*)::int total${from}${where}`, values)
      const order =
        filters.sort === 'OLDEST' ? 'b.created_at ASC,b.id ASC' : 'b.created_at DESC,b.id DESC'
      const rows = await client.query(
        `SELECT b.*,u.full_name author_name${from}${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, filters.limit, (filters.page - 1) * filters.limit]
      )
      return {
        items: rows.rows,
        total: count.rows[0].total,
        page: filters.page,
        limit: filters.limit,
      }
    })
  }

  async getAdmin(id) {
    const row = await this.transaction(
      async (client) =>
        (
          await client.query(
            'SELECT b.*,u.full_name author_name FROM blogs b JOIN users u ON u.id=b.author_id WHERE b.id=$1',
            [id]
          )
        ).rows[0]
    )
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy bài viết.')
    return row
  }

  async save(id, data, actorId, action) {
    let auditEvent
    try {
      const row = await this.transaction(async (client) => {
        let before = null
        if (id) {
          before = (await client.query('SELECT * FROM blogs WHERE id=$1 FOR UPDATE', [id])).rows[0]
          if (!before) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy bài viết.')
        }
        if (data.slug) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['admin:blog-slug'])
          const duplicate = await client.query(
            'SELECT id FROM blogs WHERE lower(slug)=lower($1) AND ($2::uuid IS NULL OR id<>$2)',
            [data.slug, id]
          )
          if (duplicate.rowCount)
            throw new AppError(409, 'DUPLICATE_SLUG', 'Slug bài viết đã tồn tại.', {
              slug: 'Vui lòng dùng slug khác.',
            })
        }
        if (data.status !== undefined)
          data.published_at =
            data.status === 'PUBLISHED' ? (before?.published_at ?? new Date()) : null
        const fields = Object.keys(data)
        const values = Object.values(data)
        const after = id
          ? (
              await client.query(
                `UPDATE blogs SET ${fields.map((field, index) => `${field}=$${index + 1}`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=$${values.length + 1} RETURNING *`,
                [...values, id]
              )
            ).rows[0]
          : (
              await client.query(
                `INSERT INTO blogs(author_id,${fields.join(',')}) VALUES($1,${fields.map((_, index) => `$${index + 2}`).join(',')}) RETURNING *`,
                [actorId, ...values]
              )
            ).rows[0]
        auditEvent = { actorId, action, entityType: 'BLOG', entityId: after.id, before, after }
        return after
      })
      this.audit(auditEvent)
      return row
    } catch (error) {
      if (error.code === '23505')
        throw new AppError(409, 'DUPLICATE_SLUG', 'Slug bài viết đã tồn tại.', {
          slug: 'Vui lòng dùng slug khác.',
        })
      throw error
    }
  }
}
