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
