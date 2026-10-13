import { withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { writeAdminAudit } from '../audit/admin-audit.js'

const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&')
const add = (values, value) => {
  values.push(value)
  return `$${values.length}`
}

export class UserRepository {
  constructor({ transaction = withTransaction, audit = writeAdminAudit } = {}) {
    this.transaction = transaction
    this.audit = audit
  }

  async list(filters) {
    return this.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const values = []
      const clauses = []
      const roleExpression =
        "CASE WHEN r.code='ADMIN' THEN 'ADMIN' WHEN tp.id IS NOT NULL THEN 'TECHNICIAN' ELSE r.code END"
      const joins =
        ' JOIN roles r ON r.id=u.role_id LEFT JOIN technician_profiles tp ON tp.user_id=u.id'
      const rankedUsers = `WITH ranked_users AS (
        SELECT u.id,u.full_name,u.email,u.phone,u.avatar_url,u.status,u.email_verified_at,
          u.phone_verified_at,u.last_login_at,u.created_at,u.updated_at,
          ${roleExpression} role,
          ROW_NUMBER() OVER (ORDER BY u.created_at ASC,u.id ASC)::int user_number
        FROM users u${joins}
      )`
      if (filters.search) {
        const term = add(values, `%${escapeLike(filters.search)}%`)
        const searchConditions = [
          `u.full_name ILIKE ${term}`,
          `u.email ILIKE ${term}`,
          `COALESCE(u.phone,'') ILIKE ${term}`,
        ]
        clauses.push(`(${searchConditions.join(' OR ')})`)
      }
      if (filters.status !== 'ALL') clauses.push(`u.status=${add(values, filters.status)}`)
      if (filters.role !== 'ALL') clauses.push(`u.role=${add(values, filters.role)}`)
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const count = await client.query(
        `${rankedUsers} SELECT count(*)::int total FROM ranked_users u${where}`,
        values
      )
      const sortColumn = filters.sortBy === 'full_name' ? 'u.full_name' : 'u.user_number'
      const sortOrder = filters.sortOrder === 'desc' ? 'DESC' : 'ASC'
      const tieBreaker = filters.sortBy === 'full_name' ? ',u.user_number ASC' : ''
      const rows = await client.query(
        `${rankedUsers} SELECT * FROM ranked_users u${where} ORDER BY ${sortColumn} ${sortOrder}${tieBreaker} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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

  async changeStatus(id, status, actorId) {
    if (id === actorId)
      throw new AppError(409, 'SELF_LOCK_FORBIDDEN', 'Bạn không thể khóa tài khoản đang đăng nhập.')
    const result = await this.transaction(async (client) => {
      const before = (
        await client.query('SELECT id,status FROM users WHERE id=$1 FOR UPDATE', [id])
      ).rows[0]
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy người dùng.')
      if (before.status === status) return { row: before, beforeStatus: status }
      const row = (
        await client.query(
          'UPDATE users SET status=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id,status,updated_at',
          [status, id]
        )
      ).rows[0]
      return { row, beforeStatus: before.status }
    })
    if (result.beforeStatus !== result.row.status)
      this.audit({
        actorId,
        action: status === 'LOCKED' ? 'LOCK_USER' : 'UNLOCK_USER',
        entityType: 'USER',
        entityId: id,
        before: { status: result.beforeStatus },
        after: { status },
      })
    return result.row
  }
}
