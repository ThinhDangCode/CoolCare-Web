import { randomUUID } from 'node:crypto'
import { pool, withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'
import { validateCertificationId } from './technician-portal.validation.js'
import { serviceCity, serviceWards } from '../technicians/technician.areas.js'

const forbidden = () => new AppError(403, 'TECHNICIAN_NOT_VERIFIED', 'Your technician profile has not been verified.')

export class TechnicianPortalRepository {
  constructor({ transaction = withTransaction, queryable = pool } = {}) {
    this.transaction = transaction
    this.queryable = queryable
  }

  async profile(userId, queryable = this.queryable) {
    const result = await queryable.query(
      `SELECT tp.id, u.full_name, u.avatar_url, tp.qualification_level,
              tp.availability_status, tp.rating_average, tp.total_reviews
       FROM technician_profiles tp
       JOIN users u ON u.id=tp.user_id
       WHERE tp.user_id=$1 AND tp.verification_status='VERIFIED'
       LIMIT 1`,
      [userId],
    )
    if (!result.rows.length) throw forbidden()
    return result.rows[0]
  }

  async dashboard(userId) {
    const technician = await this.profile(userId)
    const [nextJob, stats, pending, wallet, transactions] = await Promise.all([
      this.queryable.query(
        `SELECT b.id, b.booking_code, b.scheduled_at, b.service_address, b.ward, b.city,
                b.status, bt.status AS assignment_status,
                COALESCE((SELECT string_agg(DISTINCT s.name, ', ' ORDER BY s.name)
                  FROM booking_units bu
                  JOIN booking_unit_services bus ON bus.booking_unit_id=bu.id
                  JOIN services s ON s.id=bus.service_id
                  WHERE bu.booking_id=b.id), 'CoolCare Service') AS service_name
         FROM booking_technicians bt
         JOIN bookings b ON b.id=bt.booking_id
         WHERE bt.technician_id=$1
           AND bt.status='SELECTED'
           AND (bt.expires_at IS NULL OR bt.expires_at>CURRENT_TIMESTAMP)
           AND b.status NOT IN ('COMPLETED','CANCELLED')
         ORDER BY b.scheduled_at ASC, b.id
         LIMIT 1`,
        [technician.id],
      ),
      this.queryable.query(
        `SELECT
           (SELECT count(*)::int FROM booking_technicians bt JOIN bookings b ON b.id=bt.booking_id
            WHERE bt.technician_id=$1 AND b.scheduled_at::date=CURRENT_DATE
              AND bt.status IN ('SELECTED','ACCEPTED','COMPLETED')) AS jobs_today,
           (SELECT COALESCE(sum(p.technician_earning),0) FROM payments p
            WHERE p.technician_id=$1 AND p.payment_status='SUCCESS'
              AND p.paid_at::date=CURRENT_DATE) AS earnings_today`,
        [technician.id],
      ),
      this.queryable.query(
        `SELECT count(*)::int AS count
         FROM booking_technicians bt
         JOIN bookings b ON b.id=bt.booking_id
         WHERE bt.technician_id=$1
           AND bt.status='SELECTED'
           AND (bt.expires_at IS NULL OR bt.expires_at>CURRENT_TIMESTAMP)
           AND b.status NOT IN ('COMPLETED','CANCELLED')`,
        [technician.id],
      ),
      this.queryable.query(
        `SELECT settlement_balance, reserved_amount, available_balance
         FROM technician_account_balances WHERE technician_id=$1 LIMIT 1`,
        [technician.id],
      ),
      this.queryable.query(
        `SELECT st.id, st.transaction_type, st.amount, st.balance_after,
                st.description, st.created_at
         FROM settlement_transactions st
         JOIN technician_accounts a ON a.id=st.technician_account_id
         WHERE a.technician_id=$1
         ORDER BY st.created_at DESC, st.id DESC LIMIT 30`,
        [technician.id],
      ),
    ])
    return {
      technician,
      next_job: nextJob.rows[0] ?? null,
      stats: { ...stats.rows[0], pending_requests: pending.rows[0].count },
      wallet: wallet.rows[0] ?? { settlement_balance: 0, reserved_amount: 0, available_balance: 0 },
      wallet_transactions: transactions.rows,
    }
  }

  async availability(userId) {
    const technician = await this.profile(userId)
    return {
      availability_status: technician.availability_status,
      can_receive_jobs: technician.availability_status === 'ONLINE',
    }
  }

  async setAvailability(userId, status) {
    return this.transaction(async (client) => {
      const result = await client.query(
        `SELECT tp.id, tp.availability_status, tp.is_active,
                u.status AS account_status
         FROM technician_profiles tp
         JOIN users u ON u.id=tp.user_id
         WHERE tp.user_id=$1 AND tp.verification_status='VERIFIED'
         FOR UPDATE OF tp, u`,
        [userId],
      )
      if (!result.rows.length) throw forbidden()
      const technician = result.rows[0]
      if (!technician.is_active || technician.account_status !== 'ACTIVE') {
        throw new AppError(409, 'TECHNICIAN_INACTIVE', 'Hồ sơ kỹ thuật viên hiện không hoạt động.')
      }
      // Self-heal legacy verified profiles that have no technician account.
      // Existing account restrictions are never overwritten.
      await client.query(
        `INSERT INTO technician_accounts
           (id,technician_id,settlement_balance,is_receiving_jobs_allowed,created_at,updated_at)
         VALUES($1,$2,0,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
         ON CONFLICT (technician_id) DO NOTHING`,
        [randomUUID(), technician.id],
      )
      const updated = await client.query(
        `UPDATE technician_profiles
         SET availability_status=$2, updated_at=CURRENT_TIMESTAMP
         WHERE id=$1
         RETURNING availability_status, updated_at`,
        [technician.id, status],
      )
      const eligibility = await client.query(
        'SELECT can_recommend_technician($1) AS allowed',
        [technician.id],
      )
      return {
        ...updated.rows[0],
        can_receive_jobs: status === 'ONLINE' && eligibility.rows[0].allowed,
      }
    })
  }

  areaOptions() {
    return {
      city: serviceCity,
      // Vietnam has used a two-tier local-government model since 2025-07-01,
      // so service wards belong directly to the province-level city.
      districts: [],
      wards: serviceWards,
    }
  }

  async areas(userId) {
    const technician = await this.profile(userId)
    const result = await this.queryable.query(
      `SELECT id, city, ward
       FROM technician_areas
       WHERE technician_id=$1
       ORDER BY city, ward, id`,
      [technician.id],
    )
    return result.rows
  }

  async replaceAreas(userId, input) {
    return this.transaction(async (client) => {
      const technician = await this._lockVerifiedTechnician(client, userId)
      await client.query('DELETE FROM technician_areas WHERE technician_id=$1', [technician.id])
      for (const area of input.areas) {
        await client.query(
          'INSERT INTO technician_areas(id,technician_id,city,ward) VALUES($1,$2,$3,$4)',
          [randomUUID(), technician.id, area.city, area.ward],
        )
      }
      await client.query(
        'UPDATE technician_profiles SET updated_at=CURRENT_TIMESTAMP WHERE id=$1',
        [technician.id],
      )
      const result = await client.query(
        `SELECT id, city, ward
         FROM technician_areas
         WHERE technician_id=$1
         ORDER BY city, ward, id`,
        [technician.id],
      )
      return result.rows
    })
  }

  async skills(userId) {
    const technician = await this.profile(userId)
    const result = await this.queryable.query(
      `SELECT ts.id,ts.skill_id,ts.ac_brand_id,ts.skill_level,
              s.name AS skill_name,sv.id AS service_id,sv.name AS service_name,
              b.name AS brand_name,
              (s.is_active AND sv.is_active AND
               (ts.ac_brand_id IS NULL OR COALESCE(b.is_active,false))) AS is_available
       FROM technician_skills ts
       JOIN skills s ON s.id=ts.skill_id
       JOIN services sv ON sv.id=s.service_id
       LEFT JOIN ac_brands b ON b.id=ts.ac_brand_id
       WHERE ts.technician_id=$1
       ORDER BY sv.name,s.name,b.name NULLS FIRST,ts.id`,
      [technician.id],
    )
    return result.rows
  }

  async skillOptions(userId) {
    await this.profile(userId)
    const [skills, brands] = await Promise.all([
      this.queryable.query(
        `SELECT s.id,s.name,sv.id AS service_id,sv.name AS service_name
         FROM skills s
         JOIN services sv ON sv.id=s.service_id
         WHERE s.is_active AND sv.is_active
         ORDER BY sv.name,s.name`,
      ),
      this.queryable.query('SELECT id,name FROM ac_brands WHERE is_active ORDER BY name'),
    ])
    return { skills: skills.rows, brands: brands.rows }
  }

  async addSkill(userId, input) {
    return this.transaction(async (client) => {
      const technician = await this._lockVerifiedTechnician(client, userId)
      const skill = await client.query(
        `SELECT s.id FROM skills s
         JOIN services sv ON sv.id=s.service_id
         WHERE s.id=$1 AND s.is_active AND sv.is_active`,
        [input.skill_id],
      )
      if (!skill.rows.length) {
        throw new AppError(422, 'INVALID_SKILL', 'Vui lòng chọn kỹ năng đang hoạt động.')
      }
      if (input.ac_brand_id) {
        const brand = await client.query('SELECT id FROM ac_brands WHERE id=$1 AND is_active', [input.ac_brand_id])
        if (!brand.rows.length) throw new AppError(422, 'INVALID_BRAND', 'Vui lòng chọn thương hiệu đang hoạt động.')
      }
      const duplicate = await client.query(
        `SELECT id FROM technician_skills
         WHERE technician_id=$1 AND skill_id=$2 AND ac_brand_id IS NOT DISTINCT FROM $3::uuid
         LIMIT 1`,
        [technician.id, input.skill_id, input.ac_brand_id],
      )
      if (duplicate.rows.length) {
        throw new AppError(409, 'DUPLICATE_SKILL', 'Kỹ năng và thương hiệu này đã có trong hồ sơ.', {
          skill_id: 'Kỹ năng và thương hiệu này đã được thêm.',
        })
      }
      const assignmentId = randomUUID()
      await client.query(
        `INSERT INTO technician_skills(id,technician_id,skill_id,ac_brand_id,skill_level)
         VALUES($1,$2,$3,$4,$5)`,
        [assignmentId, technician.id, input.skill_id, input.ac_brand_id, input.skill_level],
      )
      await client.query('UPDATE technician_profiles SET updated_at=CURRENT_TIMESTAMP WHERE id=$1', [technician.id])
      return this._findSkill(client, technician.id, assignmentId)
    })
  }

  async removeSkill(userId, assignmentId) {
    return this.transaction(async (client) => {
      const technician = await this._lockVerifiedTechnician(client, userId)
      const assignment = await client.query(
        'SELECT id FROM technician_skills WHERE id=$1 AND technician_id=$2',
        [assignmentId, technician.id],
      )
      if (!assignment.rows.length) throw new AppError(404, 'TECHNICIAN_SKILL_NOT_FOUND', 'Không tìm thấy kỹ năng trong hồ sơ.')
      const count = await client.query(
        'SELECT count(*)::int AS count FROM technician_skills WHERE technician_id=$1',
        [technician.id],
      )
      if (count.rows[0].count <= 1) {
        throw new AppError(422, 'SKILL_REQUIRED', 'Kỹ thuật viên phải giữ lại ít nhất một kỹ năng.')
      }
      await client.query('DELETE FROM technician_skills WHERE id=$1 AND technician_id=$2', [assignmentId, technician.id])
      await client.query('UPDATE technician_profiles SET updated_at=CURRENT_TIMESTAMP WHERE id=$1', [technician.id])
      return { id: assignmentId, removed: true }
    })
  }

  async _lockVerifiedTechnician(client, userId) {
    const result = await client.query(
      `SELECT id FROM technician_profiles
       WHERE user_id=$1 AND verification_status='VERIFIED'
       FOR UPDATE`,
      [userId],
    )
    if (!result.rows.length) throw forbidden()
    return result.rows[0]
  }

  async _findSkill(client, technicianId, assignmentId) {
    const result = await client.query(
      `SELECT ts.id,ts.skill_id,ts.ac_brand_id,ts.skill_level,
              s.name AS skill_name,sv.id AS service_id,sv.name AS service_name,b.name AS brand_name
       FROM technician_skills ts
       JOIN skills s ON s.id=ts.skill_id
       JOIN services sv ON sv.id=s.service_id
       LEFT JOIN ac_brands b ON b.id=ts.ac_brand_id
       WHERE ts.id=$1 AND ts.technician_id=$2`,
      [assignmentId, technicianId],
    )
    return result.rows[0]
  }

  async addCertification(userId, input) {
    const technician = await this.profile(userId)
    return withTransaction(async (client) => {
      await this._ensureUniqueCertification(client, input)
      const certificateId = randomUUID()
      await client.query(
        `INSERT INTO technician_certifications
           (id,technician_id,certificate_name,certificate_number,issued_by,issued_date,expiry_date,
            document_url,verification_status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        [certificateId, technician.id, input.certificate_name, input.certificate_number,
          input.issued_by, input.issued_date, input.expiry_date, input.document_url],
      )
      await this._insertSubmission(client, certificateId, 1, input)
      return this._findCertification(client, certificateId)
    })
  }

  async assertCertificationAvailable(userId, input) {
    await this.profile(userId)
    await this._ensureUniqueCertification(pool, input)
    return true
  }

  async resubmitCertification(userId, certificateId, input) {
    validateCertificationId(certificateId)
    const technician = await this.profile(userId)
    return withTransaction(async (client) => {
      const current = await client.query(
        `SELECT id, verification_status FROM technician_certifications
         WHERE id=$1 AND technician_id=$2 FOR UPDATE`,
        [certificateId, technician.id],
      )
      if (!current.rows.length) throw new AppError(404, 'CERTIFICATION_NOT_FOUND', 'Không tìm thấy chứng chỉ.')
      if (current.rows[0].verification_status !== 'REJECTED') {
        throw new AppError(409, 'CERTIFICATION_NOT_REJECTED', 'Chỉ chứng chỉ bị từ chối mới có thể gửi lại.')
      }
      await this._ensureUniqueCertification(client, input, certificateId)
      const numberResult = await client.query(
        'SELECT COALESCE(MAX(submission_number),0)::int + 1 AS number FROM technician_certification_submissions WHERE certification_id=$1',
        [certificateId],
      )
      await client.query(
        `UPDATE technician_certifications SET certificate_name=$2,certificate_number=$3,issued_by=$4,
           issued_date=$5,expiry_date=$6,document_url=$7,verification_status='PENDING',
           reviewed_by_id=NULL,reviewed_at=NULL,rejection_reason=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE id=$1`,
        [certificateId, input.certificate_name, input.certificate_number, input.issued_by,
          input.issued_date, input.expiry_date, input.document_url],
      )
      await this._insertSubmission(client, certificateId, numberResult.rows[0].number, input)
      return this._findCertification(client, certificateId)
    })
  }

  async _insertSubmission(client, certificateId, submissionNumber, input) {
    await client.query(
      `INSERT INTO technician_certification_submissions
         (id,certification_id,submission_number,certificate_name,certificate_number,issued_by,
          issued_date,expiry_date,document_url,verification_status,submitted_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',CURRENT_TIMESTAMP)`,
      [randomUUID(), certificateId, submissionNumber, input.certificate_name, input.certificate_number,
        input.issued_by, input.issued_date, input.expiry_date, input.document_url],
    )
  }

  async _ensureUniqueCertification(client, input, excludedId = null) {
    // A certificate number is unique only within the same certificate name and
    // issuer. Serialize identical normalized triples to avoid concurrent inserts.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1)) || chr(31) || lower(btrim($2)) || chr(31) || lower(btrim($3))))',
      [input.certificate_name, input.issued_by, input.certificate_number],
    )
    const duplicate = await client.query(
      `SELECT id FROM technician_certifications
       WHERE lower(btrim(certificate_name))=lower(btrim($1))
         AND lower(btrim(issued_by))=lower(btrim($2))
         AND lower(btrim(certificate_number))=lower(btrim($3))
         AND ($4::uuid IS NULL OR id<>$4::uuid)
       LIMIT 1`,
      [input.certificate_name, input.issued_by, input.certificate_number, excludedId],
    )
    if (duplicate.rows.length) {
      throw new AppError(
        409,
        'CERTIFICATE_NUMBER_ALREADY_EXISTS',
        'Số chứng chỉ đã tồn tại. Vui lòng kiểm tra và nhập số chứng chỉ khác.',
        { certificate_number: 'Số chứng chỉ đã tồn tại. Vui lòng nhập số khác.' },
      )
    }
  }

  async _findCertification(client, certificateId) {
    const result = await client.query(
      `SELECT id,certificate_name,certificate_number,issued_by,
              to_char(issued_date,'YYYY-MM-DD') AS issued_date,
              to_char(expiry_date,'YYYY-MM-DD') AS expiry_date,document_url,
              verification_status,rejection_reason,updated_at AS submitted_at
       FROM technician_certifications WHERE id=$1`,
      [certificateId],
    )
    return result.rows[0]
  }
}
