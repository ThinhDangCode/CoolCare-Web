import pg from 'pg'
import { env } from './env.js'
import { adaptDatabaseQuery, adaptDatabaseResult } from './database-codebook-adapter.js'

const { Pool } = pg

export const pool = new Pool({
  host: env.database.host,
  port: env.database.port,
  database: env.database.name,
  user: env.database.user,
  password: env.database.password,
  ssl: env.database.ssl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

async function compatibleQuery(rawQuery, query, params) {
  const adapted = adaptDatabaseQuery(query, params)
  const result = await rawQuery(adapted.query, adapted.params)
  return adaptDatabaseResult(result, adapted.query, rawQuery)
}

// Translate the revised database's numeric codebooks at one boundary. Existing
// services and clients continue to use their documented string API values.
const connectRaw = pool.connect.bind(pool)
pool.connect = async () => {
  const client = await connectRaw()
  const originalQuery = client.query
  const originalRelease = client.release
  const rawQuery = originalQuery.bind(client)
  client.query = (query, params) => compatibleQuery(rawQuery, query, params)
  client.release = (...args) => {
    client.query = originalQuery
    client.release = originalRelease
    return originalRelease.apply(client, args)
  }
  return client
}

pool.query = async (query, params) => {
  const client = await pool.connect()
  try {
    return await client.query(query, params)
  } finally {
    client.release()
  }
}

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error)
})

export async function verifyDatabaseConnection() {
  await pool.query('SELECT 1')
}

// A saved address is disposable, but a booking needs an immutable location key.
// Both generated columns use the same customer-scoped normalized address so
// deleting and later recreating a saved address can still find prior visits.
export async function ensureServiceLocationKeys(transaction = withTransaction) {
  const normalized = (column) =>
    `lower(regexp_replace(btrim(${column}), '[[:space:]]+', ' ', 'g'))`
  const expression = (street) =>
    `md5(customer_id::text || '|' || ${normalized('city')} || '|' ||
      ${normalized('ward')} || '|' || ${normalized(street)})::uuid`

  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
      ['coolcare:service_location_keys'])
    await db.query(`ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS
      service_location_id uuid GENERATED ALWAYS AS (${expression('address_line')}) STORED`)
    await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS
      service_location_id uuid GENERATED ALWAYS AS (${expression('service_address')}) STORED`)
    await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_addresses_location
      ON customer_addresses(customer_id,service_location_id)`)
    await db.query(`CREATE INDEX IF NOT EXISTS idx_bookings_service_location
      ON bookings(customer_id,service_location_id)`)
  })
}

// Install the voucher payment guard when a fresh database starts without the
// former standalone migration. Existing payment history remains untouched.
export async function ensureVoucherMarginGuard(transaction = withTransaction) {
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',
      ['coolcare:payments_voucher_margin_guard'])
    const installed = await db.query(`SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'payments'::regclass
        AND conname = 'payments_voucher_margin_guard'
    ) AS installed`)
    if (!installed.rows[0]?.installed) {
      await db.query(`ALTER TABLE payments
        ADD CONSTRAINT payments_voucher_margin_guard
        CHECK (
          platform_discount_amount IS NULL
          OR platform_discount_amount = 0
          OR (
            commission_base_amount IS NOT NULL
            AND commission_amount IS NOT NULL
            AND platform_discount_amount >= 0
            AND platform_discount_amount <= 50000
            AND platform_discount_amount <= round(commission_base_amount * 0.20, 2)
            AND platform_discount_amount <= commission_amount
          )
        ) NOT VALID`)
    }

    // Preserve reserved vouchers and audit history while deactivating offers
    // that exceed the current policy.
    await db.query(`UPDATE vouchers v
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE v.is_active = true
        AND (
          (v.discount_type = 0 AND v.discount_value > 20)
          OR (v.discount_type = 1 AND (
            v.discount_value > 50000
            OR v.minimum_order_amount < v.discount_value * 5
          ))
          OR v.maximum_discount > 50000
        )
        AND NOT EXISTS (
          SELECT 1 FROM voucher_usages vu
          WHERE vu.voucher_id = v.id AND vu.status = 'RESERVED'
        )`)
  })
}

export async function withTransaction(work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
