import { pool } from '../../config/database.js'
import { AppError } from '../../utils.js'

const profileColumns = `t.id, t.user_id, u.full_name, u.email, u.phone, u.avatar_url,
  u.status AS account_status, t.is_active, t.qualification_level, t.years_experience,
  t.rating_average, t.total_reviews, t.verification_status, t.availability_status, t.submitted_at,
  CASE WHEN u.status = 'LOCKED' THEN 'LOCKED'
       WHEN NOT t.is_active OR u.status <> 'ACTIVE' THEN 'INACTIVE' ELSE 'ACTIVE' END AS status`
const areasColumn = `(SELECT COALESCE(json_agg(json_build_object('city',a.city,'ward',a.ward) ORDER BY a.city,a.ward), '[]'::json)
  FROM technician_areas a WHERE a.technician_id=t.id) AS areas`
const jobsColumn = `(SELECT count(DISTINCT bt.booking_id)::int FROM booking_technicians bt
  WHERE bt.technician_id=t.id AND bt.status='COMPLETED') AS completed_jobs`
const certificateColumns = `c.id,c.technician_id,c.certificate_name,c.certificate_number,c.issued_by,
  to_char(c.issued_date,'YYYY-MM-DD') AS issued_date,
  to_char(c.expiry_date,'YYYY-MM-DD') AS expiry_date,c.document_url,c.verification_status,
  c.reviewed_at,c.rejection_reason,c.updated_at,
  CASE WHEN c.verification_status <> 'VERIFIED' THEN c.verification_status
       WHEN c.expiry_date < CURRENT_DATE THEN 'EXPIRED'
       WHEN c.expiry_date <= CURRENT_DATE + 30 THEN 'EXPIRING'
       ELSE 'VERIFIED' END AS status`
const likeValue = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`

export class TechnicianRepository {
  async penalties(query) {
    const values = []
    const clauses = []
    const source = `SELECT p.id,p.technician_id,p.penalty_type,p.penalty_points,p.reason,
      p.applied_at,p.expires_at,p.status AS recorded_status,u.full_name,u.phone,u.email,u.avatar_url,
      b.booking_code,CASE WHEN p.status='ACTIVE' AND p.expires_at <= CURRENT_TIMESTAMP
      THEN 'EXPIRED' ELSE p.status END AS status
      FROM technician_penalties p JOIN technician_profiles t ON t.id=p.technician_id
      JOIN users u ON u.id=t.user_id LEFT JOIN bookings b ON b.id=p.booking_id`
    if (query.search) { values.push(likeValue(query.search)); clauses.push(`(full_name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1 OR booking_code ILIKE $1 OR reason ILIKE $1)`) }
    if (query.status !== 'ALL') { values.push(query.status); clauses.push(`status=$${values.length}`) }
    if (query.type !== 'ALL') { values.push(query.type); clauses.push(`penalty_type=$${values.length}`) }
    const from = `FROM (${source}) penalties ${clauses.length ? 'WHERE '+clauses.join(' AND ') : ''}`
    const [count, rows, summary] = await Promise.all([
      pool.query(`SELECT count(*)::int AS total ${from}`,values),
      pool.query(`SELECT * ${from} ORDER BY applied_at DESC,id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,query.limit,(query.page-1)*query.limit]),
      pool.query(`SELECT count(*) FILTER (WHERE status='ACTIVE')::int AS active_penalties,
        count(DISTINCT technician_id) FILTER (WHERE status='ACTIVE')::int AS penalized_technicians,
        COALESCE(sum(penalty_points) FILTER (WHERE status='ACTIVE'),0)::int AS active_points
        FROM (${source}) penalties`),
    ])
    return { items: rows.rows, total: count.rows[0].total, summary: summary.rows[0] }
  }
  async options() {
    const [areas, skills] = await Promise.all([
      pool.query('SELECT DISTINCT ward FROM technician_areas ORDER BY ward'),
      pool.query('SELECT DISTINCT s.name FROM skills s JOIN technician_skills ts ON ts.skill_id=s.id ORDER BY s.name'),
    ])
    return { areas: areas.rows.map((r) => r.ward), skills: skills.rows.map((r) => r.name) }
  }

  async list(query) {
    const values = []
    const clauses = []
    const add = (sql, value) => { values.push(value); clauses.push(sql.replaceAll('?', `$${values.length}`)) }
    if (query.search) add('(u.full_name ILIKE ? OR u.email ILIKE ? OR u.phone ILIKE ? OR t.identity_number ILIKE ?)', likeValue(query.search))
    if (query.status === 'LOCKED') clauses.push("u.status='LOCKED'")
    if (query.status === 'ACTIVE') clauses.push("u.status='ACTIVE' AND t.is_active")
    if (query.status === 'INACTIVE') clauses.push("u.status <> 'LOCKED' AND (u.status <> 'ACTIVE' OR NOT t.is_active)")
    for (const [key, column] of [['verification','verification_status'],['qualification','qualification_level'],['availability','availability_status']]) {
      if (query[key] !== 'ALL') add(`t.${column}=?`, query[key])
    }
    if (query.area) add('EXISTS (SELECT 1 FROM technician_areas a WHERE a.technician_id=t.id AND a.ward=?)', query.area)
    if (query.skill) add('EXISTS (SELECT 1 FROM technician_skills ts JOIN skills s ON s.id=ts.skill_id WHERE ts.technician_id=t.id AND s.name=?)', query.skill)
    const from = `FROM technician_profiles t JOIN users u ON u.id=t.user_id ${clauses.length ? 'WHERE '+clauses.join(' AND ') : ''}`
    const count = await pool.query(`SELECT count(*)::int AS total ${from}`, values)
    const order = query.sort === 'LATEST' ? 't.submitted_at DESC NULLS LAST,t.id' : query.sort === 'OLDEST' ? 't.submitted_at ASC NULLS LAST,t.id' : 'u.full_name,t.id'
    const rows = await pool.query(`SELECT ${profileColumns},${areasColumn},${jobsColumn} ${from}
      ORDER BY ${order} LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values,query.limit,(query.page-1)*query.limit])
    return { items: rows.rows, total: count.rows[0].total, page: query.page, limit: query.limit }
  }

  async detail(id) {
    const result = await pool.query(`SELECT ${profileColumns},${areasColumn},${jobsColumn},
      t.identity_number,t.identity_front_url,t.identity_back_url,t.bio,t.submitted_at,
      t.reviewed_at,t.rejection_reason,u.email_verified_at,u.phone_verified_at,t.created_at,
      reviewer.full_name AS reviewed_by
      FROM technician_profiles t JOIN users u ON u.id=t.user_id
      LEFT JOIN users reviewer ON reviewer.id=t.reviewed_by_id WHERE t.id=$1`, [id])
    if (!result.rows.length) throw new AppError(404,'TECHNICIAN_NOT_FOUND','Technician not found.')
    const [skills, certificates] = await Promise.all([
      pool.query(`SELECT ts.id,ts.skill_id,ts.ac_brand_id,s.name,ts.skill_level,b.name AS brand FROM technician_skills ts
        JOIN skills s ON s.id=ts.skill_id LEFT JOIN ac_brands b ON b.id=ts.ac_brand_id
        WHERE ts.technician_id=$1 ORDER BY s.name,ts.id`,[id]),
      pool.query(`SELECT ${certificateColumns} FROM technician_certifications c WHERE c.technician_id=$1 ORDER BY c.created_at DESC,c.id`,[id]),
    ])
    return { ...result.rows[0], skills: skills.rows, certifications: certificates.rows }
  }

  async certifications(query) {
    const values = []
    const clauses = []
    if (query.search) { values.push(likeValue(query.search)); clauses.push('(certificate_name ILIKE $1 OR certificate_number ILIKE $1 OR full_name ILIKE $1)') }
    if (query.status !== 'ALL') { values.push(query.status); clauses.push(`status=$${values.length}`) }
    if (query.issuer) { values.push(query.issuer); clauses.push(`issued_by=$${values.length}`) }
    const fileType = "CASE WHEN document_url ~* '\\.pdf([?#].*)?$' THEN 'PDF' WHEN document_url ~* '\\.(png|jpe?g|webp|gif)([?#].*)?$' THEN 'IMAGE' ELSE 'OTHER' END"
    if (query.type && query.type !== 'ALL') { values.push(query.type); clauses.push(`(${fileType})=$${values.length}`) }
    const from = `FROM (SELECT ${certificateColumns},u.full_name FROM technician_certifications c
      JOIN technician_profiles t ON t.id=c.technician_id JOIN users u ON u.id=t.user_id) records
      ${clauses.length ? 'WHERE '+clauses.join(' AND ') : ''}`
    const count = await pool.query(`SELECT count(*)::int AS total ${from}`,values)
    const rows = await pool.query(`SELECT * ${from} ORDER BY certificate_name,id
      LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,query.limit,(query.page-1)*query.limit])
    const issuers = await pool.query("SELECT DISTINCT issued_by FROM technician_certifications WHERE issued_by IS NOT NULL AND issued_by <> '' ORDER BY issued_by")
    return { items: rows.rows, total: count.rows[0].total, page: query.page, limit: query.limit, issuers: issuers.rows.map(row => row.issued_by) }
  }
}
