import { randomUUID } from 'node:crypto'
import { pool, withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { serviceCity, serviceWards } from '../technicians/technician.areas.js'

const profileSelect = `
  SELECT tp.id, tp.identity_number, tp.identity_front_url, tp.identity_back_url,
         tp.qualification_level, tp.years_experience, tp.bio,
         tp.verification_status, tp.submitted_at, tp.reviewed_at, tp.rejection_reason,
         reviewer.full_name AS reviewed_by
  FROM technician_profiles tp
  LEFT JOIN users reviewer ON reviewer.id = tp.reviewed_by_id
  WHERE tp.user_id = $1`

const conflict = (code, message) => new AppError(409, code, message)

export class TechnicianApplicationRepository {
  async options() {
    const [skills, brands] = await Promise.all([
      pool.query(`SELECT s.id, s.name, s.service_id, sv.name AS service_name
                  FROM skills s JOIN services sv ON sv.id = s.service_id
                  WHERE s.is_active AND sv.is_active ORDER BY sv.name, s.name`),
      pool.query('SELECT id, name FROM ac_brands WHERE is_active ORDER BY name'),
    ])
    return {
      qualification_levels: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'],
      service_area: { city: serviceCity, wards: serviceWards },
      skills: skills.rows,
      brands: brands.rows,
    }
  }

  async status(userId) {
    const result = await pool.query(profileSelect, [userId])
    if (!result.rows.length) return null
    const technician = result.rows[0]
    const [areas, skills, certifications] = await Promise.all([
      pool.query('SELECT city, ward FROM technician_areas WHERE technician_id=$1 ORDER BY city, ward', [technician.id]),
      pool.query(`SELECT ts.skill_id, s.name, ts.ac_brand_id, b.name AS brand_name, ts.skill_level
                  FROM technician_skills ts JOIN skills s ON s.id=ts.skill_id
                  LEFT JOIN ac_brands b ON b.id=ts.ac_brand_id
                  WHERE ts.technician_id=$1 ORDER BY s.name, b.name NULLS FIRST`, [technician.id]),
      pool.query(`SELECT c.id, c.certificate_name, c.certificate_number, c.issued_by,
                         to_char(c.issued_date,'YYYY-MM-DD') AS issued_date,
                         to_char(c.expiry_date,'YYYY-MM-DD') AS expiry_date,
                         c.document_url, c.verification_status, c.rejection_reason,
                         COALESCE(
                           (SELECT MAX(s.submitted_at)
                            FROM technician_certification_submissions s
                            WHERE s.certification_id=c.id),
                           c.created_at
                         ) AS submitted_at,
                         c.reviewed_at, c.updated_at
                  FROM technician_certifications c
                  WHERE c.technician_id=$1 ORDER BY c.created_at, c.id`, [technician.id]),
    ])
    return { ...technician, areas: areas.rows, skills: skills.rows, certifications: certifications.rows }
  }

  async submit(userId, input) {
    try {
      return await withTransaction(async (client) => {
        const userResult = await client.query(
          `SELECT u.id, u.status, r.code AS role
           FROM users u JOIN roles r ON r.id=u.role_id
           JOIN customer_profiles cp ON cp.user_id=u.id
           WHERE u.id=$1 FOR UPDATE OF u`,
          [userId]
        )
        const user = userResult.rows[0]
        if (!user) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Không tìm thấy hồ sơ khách hàng.')
        if (user.role !== 'CUSTOMER') throw new AppError(403, 'CUSTOMER_REQUIRED', 'Chỉ tài khoản khách hàng mới có thể đăng ký đối tác kỹ thuật viên.')
        if (user.status !== 'ACTIVE') throw conflict('ACCOUNT_NOT_ACTIVE', 'Tài khoản phải đang hoạt động để đăng ký đối tác kỹ thuật viên.')

        const identityOwner = await client.query(
          'SELECT user_id FROM technician_profiles WHERE identity_number=$1 AND user_id<>$2 LIMIT 1',
          [input.identity_number, userId]
        )
        if (identityOwner.rows.length) throw conflict('IDENTITY_ALREADY_USED', 'Số CCCD đã được sử dụng cho một hồ sơ kỹ thuật viên khác.')

        const existingResult = await client.query('SELECT * FROM technician_profiles WHERE user_id=$1 FOR UPDATE', [userId])
        const existing = existingResult.rows[0]
        if (existing?.verification_status === 'PENDING') throw conflict('APPLICATION_PENDING', 'Hồ sơ kỹ thuật viên đang chờ quản trị viên xét duyệt.')
        if (existing?.verification_status === 'VERIFIED') throw conflict('TECHNICIAN_ALREADY_VERIFIED', 'Tài khoản đã được xác minh là kỹ thuật viên.')

        const technicianId = existing?.id ?? randomUUID()
        if (existing) {
          await client.query(
            `UPDATE technician_profiles SET identity_number=$2, identity_front_url=$3,
               identity_back_url=$4, qualification_level=$5, years_experience=$6, bio=$7,
               verification_status='PENDING', reviewed_by_id=NULL, reviewed_at=NULL,
               rejection_reason=NULL, submitted_at=CURRENT_TIMESTAMP,
               availability_status='OFFLINE', is_active=false, updated_at=CURRENT_TIMESTAMP
             WHERE id=$1`,
            [technicianId, input.identity_number, input.identity_front_url, input.identity_back_url,
              input.qualification_level, input.years_experience, input.bio]
          )
          await client.query('DELETE FROM technician_areas WHERE technician_id=$1', [technicianId])
          await client.query('DELETE FROM technician_skills WHERE technician_id=$1', [technicianId])
        } else {
          await client.query(
            `INSERT INTO technician_profiles
               (id,user_id,identity_number,identity_front_url,identity_back_url,qualification_level,
                years_experience,bio,verification_status,submitted_at,availability_status,is_active,
                created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',CURRENT_TIMESTAMP,'OFFLINE',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
            [technicianId, userId, input.identity_number, input.identity_front_url, input.identity_back_url,
              input.qualification_level, input.years_experience, input.bio]
          )
          await client.query(
            `INSERT INTO technician_accounts(id,technician_id,settlement_balance,is_receiving_jobs_allowed,created_at,updated_at)
             VALUES($1,$2,0,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
            [randomUUID(), technicianId]
          )
        }

        for (const area of input.areas) {
          await client.query(
            'INSERT INTO technician_areas(id,technician_id,city,ward) VALUES($1,$2,$3,$4)',
            [randomUUID(), technicianId, area.city, area.ward]
          )
        }
        for (const skill of input.skills) {
          const option = await client.query(
            `SELECT s.id, b.id AS brand_id FROM skills s
             LEFT JOIN ac_brands b ON b.id=$2 AND b.is_active
             WHERE s.id=$1 AND s.is_active`,
            [skill.skill_id, skill.ac_brand_id]
          )
          if (!option.rows.length || (skill.ac_brand_id && !option.rows[0].brand_id)) {
            throw new AppError(422, 'INVALID_SKILL_OPTION', 'Kỹ năng hoặc thương hiệu máy lạnh không còn hoạt động.')
          }
          await client.query(
            `INSERT INTO technician_skills(id,technician_id,skill_id,ac_brand_id,skill_level)
             VALUES($1,$2,$3,$4,$5)`,
            [randomUUID(), technicianId, skill.skill_id, skill.ac_brand_id, skill.skill_level]
          )
        }
        for (const certificate of input.certifications) {
          const certificateId = randomUUID()
          await client.query(
            `INSERT INTO technician_certifications
               (id,technician_id,certificate_name,certificate_number,issued_by,issued_date,expiry_date,
                document_url,verification_status,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
            [certificateId, technicianId, certificate.certificate_name, certificate.certificate_number,
              certificate.issued_by, certificate.issued_date, certificate.expiry_date, certificate.document_url]
          )
          await client.query(
            `INSERT INTO technician_certification_submissions
               (id,certification_id,submission_number,certificate_name,certificate_number,issued_by,
                issued_date,expiry_date,document_url,verification_status,submitted_at)
             VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,'PENDING',CURRENT_TIMESTAMP)`,
            [randomUUID(), certificateId, certificate.certificate_name, certificate.certificate_number,
              certificate.issued_by, certificate.issued_date, certificate.expiry_date, certificate.document_url]
          )
        }
        return { id: technicianId, verification_status: 'PENDING', submitted_at: new Date().toISOString() }
      })
    } catch (error) {
      if (error?.code === '23505') throw conflict('DUPLICATE_APPLICATION_DATA', 'CCCD, kỹ năng hoặc khu vực đã bị trùng trong hồ sơ.')
      throw error
    }
  }
}
