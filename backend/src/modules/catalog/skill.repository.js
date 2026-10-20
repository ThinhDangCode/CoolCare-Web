import { withTransaction } from '../../config/database.js'

const codeExpression = "'SK-' || upper(left(r.id::text, 8))"

export async function listSkills(filters, mobile = false, transaction = withTransaction) {
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const values = []
    const clauses = [`r.deleted_at IS ${!mobile && filters.trash ? 'NOT ' : ''}NULL`]
    const bind = (value) => {
      values.push(value)
      return `$${values.length}`
    }
    if (filters.search) {
      const keyword = bind(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`)
      clauses.push(
        `(r.name ILIKE ${keyword} OR s.name ILIKE ${keyword} OR ${codeExpression} ILIKE ${keyword})`
      )
    }
    if (filters.serviceId) clauses.push(`r.service_id = ${bind(filters.serviceId)}`)
    if (mobile) clauses.push('r.is_active AND s.is_active AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM service_categories c WHERE c.id=s.category_id AND c.is_active AND c.deleted_at IS NULL)')
    const source = 'FROM skills r JOIN services s ON s.id=r.service_id'
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    const statistics = (
      await client.query(
        `SELECT count(*)::int AS all, count(*) FILTER (WHERE r.is_active)::int AS active, count(*) FILTER (WHERE NOT r.is_active)::int AS inactive ${source}${where}`,
        values
      )
    ).rows[0]
    const total = statistics[filters.status]
    const status =
      filters.status === 'all'
        ? ''
        : `${where ? ' AND' : ' WHERE'} r.is_active=${bind(filters.status === 'active')}`
    const order =
      filters.sort === 'name'
        ? 'lower(r.name) ASC'
        : filters.sort === 'oldest'
          ? 'r.created_at ASC'
          : 'r.created_at DESC'
    const limit = bind(filters.limit)
    const offset = bind((filters.page - 1) * filters.limit)
    const rows = await client.query(
      `SELECT r.*, ${codeExpression} AS code, s.name AS service_name, s.is_active AS service_is_active, (SELECT count(DISTINCT ts.technician_id)::int FROM technician_skills ts WHERE ts.skill_id=r.id) AS technician_count ${source}${where}${status} ORDER BY ${order}, r.id LIMIT ${limit} OFFSET ${offset}`,
      values
    )
    return { items: rows.rows, total, counts: statistics, page: filters.page, limit: filters.limit }
  })
}
