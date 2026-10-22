import { AppError } from '../../utils.js'

export const INITIAL_POINTS = 12
// Expiry restores dispatch priority, never the lifetime point balance.
export const remainingPointsSql = (id) => `GREATEST(0,12-COALESCE((SELECT sum(penalty_points) FROM technician_penalties WHERE technician_id=${id} AND status <> 2),0))::int`
export const activePointsSql = (id) => `COALESCE((SELECT sum(penalty_points) FROM technician_penalties WHERE technician_id=${id} AND status=0 AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)),0)::int`

export async function lockPenaltyTechnician(client, id) {
  await client.query('SELECT id FROM technician_accounts WHERE technician_id=$1 FOR UPDATE', [id])
  const profile = (await client.query('SELECT id,user_id FROM technician_profiles WHERE id=$1 FOR UPDATE', [id])).rows[0]
  if (!profile) throw new AppError(404, 'TECHNICIAN_NOT_FOUND', 'Technician not found.')
  await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [profile.user_id])
  return profile
}

export async function enforcePenaltyBalance(client, profile) {
  const { remaining_points } = (await client.query(`SELECT ${remainingPointsSql('$1')} AS remaining_points`, [profile.id])).rows[0]
  if (remaining_points === 0) {
    await client.query("UPDATE users SET status='LOCKED',updated_at=CURRENT_TIMESTAMP WHERE id=$1", [profile.user_id])
    await client.query("UPDATE technician_profiles SET is_active=false,availability_status='OFFLINE',updated_at=CURRENT_TIMESTAMP WHERE id=$1", [profile.id])
    await client.query('UPDATE technician_accounts SET is_receiving_jobs_allowed=false,updated_at=CURRENT_TIMESTAMP WHERE technician_id=$1', [profile.id])
  }
  return remaining_points
}
