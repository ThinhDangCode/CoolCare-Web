import { AppError } from '../../utils.js'
import { pool } from '../../config/database.js'

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
    // Penalties suspend the technician capability only. Never change users.status.
    const suspended = await client.query("UPDATE technician_profiles SET is_active=false,availability_status='OFFLINE',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND (is_active OR availability_status<>1)", [profile.id])
    await client.query('UPDATE technician_accounts SET is_receiving_jobs_allowed=false,updated_at=CURRENT_TIMESTAMP WHERE technician_id=$1', [profile.id])
    // Notify on the transition, not each time another penalty is recorded.
    if (suspended.rowCount) {
      await client.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
        VALUES($1,'SYSTEM','Quyền kỹ thuật viên đã bị khóa',$2,'TECHNICIAN',$3)`,
        [profile.user_id,'Bạn đã hết 12 điểm. Bạn vẫn có thể đăng nhập và sử dụng các chức năng khách hàng.',profile.id])
    }
  }
  return remaining_points
}

// This guard is for technician-only actions, never customer endpoints.
export async function assertTechnicianNotPenaltyLocked(userId, db = pool) {
  const { rows } = await db.query(`SELECT ${remainingPointsSql('tp.id')} AS remaining_points
    FROM technician_profiles tp WHERE tp.user_id=$1`, [userId])
  if (rows[0]?.remaining_points === 0) {
    throw new AppError(403, 'TECHNICIAN_POINTS_EXHAUSTED',
      'Quyền kỹ thuật viên đã bị khóa do hết điểm. Bạn vẫn có thể sử dụng chức năng khách hàng.')
  }
}

export async function requireTechnicianNotPenaltyLocked(req, _res, next) {
  try { await assertTechnicianNotPenaltyLocked(req.auth.userId); next() }
  catch (error) { next(error) }
}
