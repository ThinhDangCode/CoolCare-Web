import { withTransaction } from '../../config/database.js'
import { storageCode } from '../../config/database-codebooks.js'

const openStatus = storageCode('settlements', 'status', 'OPEN')
const calculatedStatus = storageCode('settlements', 'status', 'CALCULATED')

const accountPeriods = `
  FROM technician_accounts a
  JOIN LATERAL (
    SELECT created_at FROM settlement_transactions
    WHERE technician_account_id = a.id
    ORDER BY created_at LIMIT 1
  ) first_entry ON true
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      (SELECT max(s.period_end) FROM settlements s
       WHERE s.technician_id = a.technician_id AND s.technician_account_id = a.id
         AND s.finalized_at IS NOT NULL),
      date_trunc('week', first_entry.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AT TIME ZONE 'Asia/Ho_Chi_Minh'
    ) AS period_start
  ) next_period`

const accountsToClose = `
  SELECT a.id
  ${accountPeriods}
  WHERE next_period.period_start < $1::timestamptz
  ORDER BY a.id`

const nextAccountPeriod = `
  SELECT a.technician_id AS "technicianId", next_period.period_start AS "periodStart",
    ((next_period.period_start AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '7 days')
      AT TIME ZONE 'Asia/Ho_Chi_Minh' AS "periodEnd"
  ${accountPeriods}
  WHERE a.id = $1 AND next_period.period_start < $2::timestamptz`

async function closeNextPeriod(client, id, cutoff) {
  await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
  // Ledger and settlement triggers also lock the wallet. Resolve the next period
  // in a separate statement so a waiting worker sees the latest committed state.
  const locked = await client.query('SELECT id FROM technician_accounts WHERE id = $1 FOR UPDATE', [id])
  if (!locked.rowCount) return false

  const { rows: [period] } = await client.query(nextAccountPeriod, [id, cutoff])
  if (!period) return false
  const params = [id, period.technicianId, period.periodStart, period.periodEnd]

  await client.query(`
    INSERT INTO settlements (
      technician_account_id, technician_id, period_start, period_end, settlement_code, closing_balance
    ) VALUES ($1, $2, $3, $4, left('SET-' || replace(gen_random_uuid()::text, '-', ''), 30), 0)
    ON CONFLICT (technician_id, period_start, period_end) DO NOTHING`, params)

  const finalized = await client.query(`
    UPDATE settlements SET status = ${calculatedStatus}
    WHERE technician_account_id = $1 AND technician_id = $2
      AND period_start = $3 AND period_end = $4
      AND status = ${openStatus} AND finalized_at IS NULL
    RETURNING id`, params)
  if (!finalized.rowCount) throw new Error('Expected an open settlement for the next week')
  return true
}

export async function closeWeeklySettlements({ transaction = withTransaction, scheduledCutoff } = {}) {
  const { accounts, cutoff } = await transaction(async (client) => {
    const { rows: [{ databaseCutoff, statusType }] } = await client.query(`
      SELECT date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AT TIME ZONE 'Asia/Ho_Chi_Minh' AS "databaseCutoff",
        pg_typeof((NULL::settlements).status)::text AS "statusType"`)
    if (statusType !== 'smallint') throw new Error('Weekly settlement requires smallint status columns')
    if (scheduledCutoff && scheduledCutoff > databaseCutoff) {
      throw new Error('PostgreSQL has not reached the scheduled settlement week')
    }
    const cutoff = scheduledCutoff ?? databaseCutoff
    const { rows: accounts } = await client.query(accountsToClose, [cutoff])
    return { accounts, cutoff }
  })
  let finalizedPeriods = 0
  const failures = []
  for (const { id } of accounts) {
    try {
      // Commit each week before moving to the next one and release the wallet lock.
      while (await transaction((client) => closeNextPeriod(client, id, cutoff))) {
        finalizedPeriods += 1
      }
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, `Weekly settlement failed for ${failures.length} wallet(s)`)
  }
  return { finalizedPeriods }
}
