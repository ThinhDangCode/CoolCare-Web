import { randomUUID } from 'node:crypto'
import { pool, withTransaction } from '../../config/database.js'
import { AppError } from '../../utils.js'

const userSelect = `
  SELECT u.id,
         u.email,
         u.phone,
         u.password_hash,
         u.google_sub,
         u.email_verified_at,
         u.full_name,
         u.avatar_url,
         u.status,
         TO_CHAR(cp.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
         cp.gender,
         r.code AS role,
         EXISTS (
           SELECT 1
           FROM technician_profiles tp
           WHERE tp.user_id = u.id
         ) AS has_technician_profile
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN customer_profiles cp ON cp.user_id = u.id
`

export class AuthRepository {
  async findUserByEmail(email, queryable = pool) {
    const result = await queryable.query(`${userSelect} WHERE LOWER(u.email) = $1 LIMIT 1`, [email])
    return result.rows[0] ?? null
  }

  async findUserById(id, queryable = pool) {
    const result = await queryable.query(`${userSelect} WHERE u.id = $1 LIMIT 1`, [id])
    return result.rows[0] ?? null
  }

  async updateLastLogin(userId) {
    await pool.query(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [userId],
    )
  }

  async updateProfile(userId, { fullName, phone, dateOfBirth, gender }) {
    await withTransaction(async (client) => {
      await client.query('UPDATE users SET full_name = $1, phone = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [fullName, phone, userId])
      await client.query('UPDATE customer_profiles SET date_of_birth = $1, gender = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3', [dateOfBirth, gender, userId])
    })
    return this.findUserById(userId)
  }

  async updateAvatar(userId, avatarUrl) {
    await pool.query(
      'UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [avatarUrl, userId],
    )
    return this.findUserById(userId)
  }

  async updatePassword(userId, passwordHash) {
    await pool.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [passwordHash, userId])
  }

  async createCustomer({ email, phone, passwordHash, fullName }) {
    return withTransaction(async (client) => {
      const roleResult = await client.query(
        "SELECT id FROM roles WHERE code = 'CUSTOMER' LIMIT 1",
      )
      if (!roleResult.rows[0]) throw new Error('CUSTOMER role is missing from master data')

      const userId = randomUUID()
      const profileId = randomUUID()
      const userResult = await client.query(
        `INSERT INTO users (id, role_id, email, email_verified_at, phone, password_hash, full_name, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, email, phone, full_name`,
        [userId, roleResult.rows[0].id, email, phone, passwordHash, fullName],
      )
      await client.query(
        `INSERT INTO customer_profiles (id, user_id, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [profileId, userId],
      )

      return {
        ...userResult.rows[0],
        role: 'CUSTOMER',
        has_technician_profile: false,
      }
    })
  }

  async findOrCreateGoogleCustomer({ googleSub, email, fullName }) {
    return withTransaction(async (client) => {
      const matchedGoogleAccount = await client.query(
        `${userSelect} WHERE u.google_sub = $1 LIMIT 1`,
        [googleSub],
      )
      if (matchedGoogleAccount.rows[0]) return matchedGoogleAccount.rows[0]

      const emailResult = await client.query(
        `SELECT id, google_sub
         FROM users
         WHERE LOWER(email) = $1
         LIMIT 1
         FOR UPDATE`,
        [email],
      )
      const existingUser = emailResult.rows[0]
      if (existingUser) {
        if (existingUser.google_sub && existingUser.google_sub !== googleSub) {
          throw new AppError(
            409,
            'GOOGLE_ACCOUNT_LINKED',
            'Email này đã được liên kết với một tài khoản Google khác.',
          )
        }
        await client.query(
          `UPDATE users
           SET google_sub = $1,
               email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [googleSub, existingUser.id],
        )
        return this.findUserById(existingUser.id, client)
      }

      const roleResult = await client.query(
        "SELECT id FROM roles WHERE code = 'CUSTOMER' LIMIT 1",
      )
      if (!roleResult.rows[0]) throw new Error('CUSTOMER role is missing from master data')

      const userId = randomUUID()
      const profileId = randomUUID()
      await client.query(
        `INSERT INTO users
           (id, role_id, google_sub, email, email_verified_at, password_hash, full_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, NULL, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, roleResult.rows[0].id, googleSub, email, fullName],
      )
      await client.query(
        `INSERT INTO customer_profiles (id, user_id, created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [profileId, userId],
      )
      return this.findUserById(userId, client)
    })
  }

  async replacePasswordResetToken({ userId, tokenHash, expiresAt }) {
    return withTransaction(async (client) => {
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      )
      const result = await client.query(
        `INSERT INTO password_reset_tokens
           (id, user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id, user_id, expires_at`,
        [randomUUID(), userId, tokenHash, expiresAt],
      )
      return result.rows[0]
    })
  }

  async replaceEmailVerificationToken({ userId, tokenHash, expiresAt }) {
    return withTransaction(async (client) => {
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
      )
      const result = await client.query(
        `INSERT INTO password_reset_tokens
           (id, user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id, user_id, expires_at`,
        [randomUUID(), userId, tokenHash, expiresAt],
      )
      return result.rows[0]
    })
  }

  async findLatestEmailVerificationToken(email) {
    const result = await pool.query(
      `SELECT pr.id, pr.user_id, pr.token_hash, pr.expires_at, pr.used_at
       FROM password_reset_tokens pr
       JOIN users u ON u.id = pr.user_id
       WHERE LOWER(u.email) = $1
         AND u.email_verified_at IS NULL
       ORDER BY pr.created_at DESC
       LIMIT 1`,
      [email],
    )
    return result.rows[0] ?? null
  }

  async consumeEmailVerification({ requestId, userId }) {
    return withTransaction(async (client) => {
      const requestResult = await client.query(
        `SELECT id, user_id, used_at, expires_at
         FROM password_reset_tokens
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [requestId, userId],
      )
      const request = requestResult.rows[0]
      if (!request) return { status: 'missing' }
      if (request.used_at) return { status: 'used' }
      if (new Date(request.expires_at) <= new Date()) return { status: 'expired' }

      const userResult = await client.query(
        `UPDATE users
         SET email_verified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND email_verified_at IS NULL
         RETURNING id`,
        [userId],
      )
      if (!userResult.rows[0]) return { status: 'used' }
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [requestId],
      )
      return { status: 'verified', user: await this.findUserById(userId, client) }
    })
  }

  async findLatestPasswordResetToken(email) {
    const result = await pool.query(
      `SELECT pr.id, pr.user_id, pr.token_hash, pr.expires_at, pr.used_at
       FROM password_reset_tokens pr
       JOIN users u ON u.id = pr.user_id
       WHERE LOWER(u.email) = $1
         AND u.password_hash IS NOT NULL
         AND u.email_verified_at IS NOT NULL
       ORDER BY pr.created_at DESC
       LIMIT 1`,
      [email],
    )
    return result.rows[0] ?? null
  }

  async consumeResetAndUpdatePassword({ requestId, userId, passwordHash }) {
    return withTransaction(async (client) => {
      const requestResult = await client.query(
        `SELECT id, user_id, used_at, expires_at
         FROM password_reset_tokens
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [requestId, userId],
      )
      const resetRequest = requestResult.rows[0]
      if (!resetRequest) return { status: 'missing' }
      if (resetRequest.used_at) return { status: 'used' }
      if (new Date(resetRequest.expires_at) <= new Date()) return { status: 'expired' }

      const passwordResult = await client.query(
        `UPDATE users
         SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
           AND password_hash IS NOT NULL
         RETURNING id`,
        [passwordHash, userId],
      )
      if (!passwordResult.rows[0]) return { status: 'missing' }
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [requestId],
      )
      return { status: 'updated' }
    })
  }
}
