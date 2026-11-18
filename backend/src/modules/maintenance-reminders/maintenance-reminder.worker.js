import { pool, withTransaction } from '../../config/database.js'
import { createEmailSender } from '../auth/email.service.js'

// Remind from the BOOKING COMPLETION timestamp, not the scheduled visit time
// or an assumed warranty period. Each booked service has its own interval.
export const maintenanceDueAt = (completedAt, intervalDays) =>
  new Date(new Date(completedAt).getTime() + Number(intervalDays) * 86_400_000)

export const formatMaintenanceDate = value => new Date(value).toLocaleDateString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
})

export function maintenanceRecommendation(serviceName) {
  const name = String(serviceName ?? '').toLocaleLowerCase('vi-VN')
  if (/vệ sinh|làm sạch/.test(name)) {
    return 'Bạn nên đặt lịch vệ sinh máy lạnh định kỳ để duy trì hiệu quả làm mát và hạn chế bụi bẩn.'
  }
  if (/bảo dưỡng|bảo trì/.test(name)) {
    return 'Bạn nên đặt lịch bảo dưỡng để kỹ thuật viên kiểm tra và chăm sóc máy lạnh theo định kỳ.'
  }
  if (/kiểm tra|chẩn đoán/.test(name)) {
    return 'Bạn nên đặt lịch kiểm tra lại tình trạng hoạt động của máy lạnh.'
  }
  if (/sửa chữa|sửa|thay thế|khắc phục/.test(name)) {
    return 'Bạn nên đặt lịch kiểm tra lại tình trạng máy lạnh sau lần sửa chữa trước.'
  }
  return `Bạn nên kiểm tra lại tình trạng máy lạnh và cân nhắc đặt dịch vụ ${serviceName} theo chu kỳ của hệ thống.`
}

export function maintenanceNotification(row) {
  const dueDate = formatMaintenanceDate(row.due_at)
  const serviceName = String(row.service_name).trim()
  const unitNumber = row.unit_number
  return {
    title: `Đã đến kỳ: ${serviceName} (máy số ${unitNumber})`,
    message: `Theo lịch chăm sóc định kỳ của CoolCare, máy lạnh số ${unitNumber} đã đến kỳ ${serviceName.toLocaleLowerCase('vi-VN')} vào ngày ${dueDate}. ${maintenanceRecommendation(serviceName)} Bạn có thể mở CoolCare để xem lịch sử và đặt lịch phù hợp.`,
    dueDate,
    recommendation: maintenanceRecommendation(serviceName),
  }
}

const DUE_SERVICE_SQL = `
  SELECT bus.id AS unit_service_id, bu.id AS unit_id, bu.unit_number,
    b.id AS booking_id, b.booking_code, cp.user_id,
    s.name AS service_name,
    b.completed_at + s.maintenance_interval_days * INTERVAL '1 day' AS due_at
  FROM booking_unit_services bus
  JOIN booking_units bu ON bu.id=bus.booking_unit_id
  JOIN bookings b ON b.id=bu.booking_id
  JOIN customer_profiles cp ON cp.id=b.customer_id
  JOIN services s ON s.id=bus.service_id
  WHERE b.status='COMPLETED' AND b.completed_at IS NOT NULL
    AND s.maintenance_interval_days > 0
    AND b.completed_at + s.maintenance_interval_days * INTERVAL '1 day' <= NOW()
    AND NOT EXISTS (SELECT 1 FROM notifications n
      WHERE n.user_id=cp.user_id AND n.type=6
        AND n.reference_type='BOOKING' AND n.reference_id=b.id::text
        AND n.title=CONCAT('Đã đến kỳ: ', s.name, ' (máy số ', bu.unit_number, ')'))
  ORDER BY due_at ASC, bus.id ASC LIMIT $1
`

export async function dispatchMaintenanceNotifications({ limit = 200 } = {}) {
  const rows = (await pool.query(DUE_SERVICE_SQL, [limit])).rows
  let inserted = 0
  for (const row of rows) {
    const content = maintenanceNotification(row)
    const changed = await withTransaction(async db => {
      // Serialize duplicate attempts even when two API instances run workers.
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [row.unit_service_id])
      const result = await db.query(`INSERT INTO notifications
        (user_id,type,title,message,reference_type,reference_id)
        SELECT $1,6,$2,$3,'BOOKING',$4
        WHERE NOT EXISTS (SELECT 1 FROM notifications n
          WHERE n.user_id=$1 AND n.type=6 AND n.reference_type='BOOKING'
            AND n.reference_id=$4 AND n.title=$2)`,
      [row.user_id, content.title, content.message, row.booking_id])
      return result.rowCount
    })
    inserted += changed
  }
  return inserted
}

// A single booking unit may contain several services with DIFFERENT periods.
// The existing maintenance_reminder_sent_at stores the latest emailed due
// window; the email includes every service newly due since that timestamp.
// This uses existing columns only. The DB lock prevents simultaneous sends
// across instances. SMTP delivery is at-least-once if the process crashes
// between sending the email and committing the timestamp.
export async function dispatchMaintenanceEmails({ limit = 15, sender = createEmailSender() } = {}) {
  if (!sender.isConfigured) return 0
  let sent = 0
  for (let i = 0; i < limit; i += 1) {
    let found = false
    try {
      await withTransaction(async db => {
        const row = (await db.query(`SELECT bu.id AS unit_id, bu.unit_number,
          b.id AS booking_id, b.booking_code, b.completed_at,
          u.email, u.full_name
          FROM booking_units bu
          JOIN bookings b ON b.id=bu.booking_id
          JOIN customer_profiles cp ON cp.id=b.customer_id
          JOIN users u ON u.id=cp.user_id
          WHERE b.status='COMPLETED' AND b.completed_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM booking_unit_services bus
              JOIN services s ON s.id=bus.service_id
              WHERE bus.booking_unit_id=bu.id AND s.maintenance_interval_days > 0
                AND b.completed_at+s.maintenance_interval_days*INTERVAL '1 day' <= NOW()
                AND b.completed_at+s.maintenance_interval_days*INTERVAL '1 day' >
                  COALESCE(bu.maintenance_reminder_sent_at,'-infinity'::timestamptz))
          ORDER BY b.completed_at ASC,bu.id ASC LIMIT 1
          FOR UPDATE OF bu SKIP LOCKED`)).rows[0]
        if (!row) return
        found = true
        const items = (await db.query(`SELECT s.name AS service_name,
          b.completed_at+s.maintenance_interval_days*INTERVAL '1 day' AS due_at
          FROM booking_unit_services bus
          JOIN services s ON s.id=bus.service_id
          JOIN booking_units bu ON bu.id=bus.booking_unit_id
          JOIN bookings b ON b.id=bu.booking_id
          WHERE bus.booking_unit_id=$1 AND s.maintenance_interval_days>0
            AND b.completed_at+s.maintenance_interval_days*INTERVAL '1 day' <= NOW()
            AND b.completed_at+s.maintenance_interval_days*INTERVAL '1 day' >
              COALESCE(bu.maintenance_reminder_sent_at,'-infinity'::timestamptz)
          ORDER BY due_at ASC,s.name ASC`, [row.unit_id])).rows
        if (!items.length) return
        if (row.email?.trim()) {
          await sender.sendMaintenanceReminder({
            email: row.email, name: row.full_name, bookingCode: row.booking_code,
            unitNumber: row.unit_number,
            items: items.map(item => ({ serviceName: item.service_name,
              dueDate: formatMaintenanceDate(item.due_at),
              recommendation: maintenanceRecommendation(item.service_name) })),
          })
          sent += 1
        }
        await db.query(`UPDATE booking_units SET maintenance_reminder_sent_at=NOW(),
          next_maintenance_at=(SELECT MIN(b.completed_at+s.maintenance_interval_days*INTERVAL '1 day')
            FROM booking_unit_services bus
            JOIN services s ON s.id=bus.service_id
            JOIN bookings b ON b.id=$2
            WHERE bus.booking_unit_id=$1 AND s.maintenance_interval_days>0
              AND b.completed_at+s.maintenance_interval_days*INTERVAL '1 day'>NOW()),
          updated_at=NOW() WHERE id=$1`, [row.unit_id, row.booking_id])
      })
    } catch (error) {
      console.error('Maintenance reminder email failed; will retry later', { message: error.message })
      break
    }
    if (!found) break
  }
  return sent
}

export async function dispatchMaintenanceReminders({ sender } = {}) {
  const notifications = await dispatchMaintenanceNotifications()
  const emails = await dispatchMaintenanceEmails(sender ? { sender } : {})
  return { notifications, emails }
}

export function startMaintenanceReminderWorker({ intervalMs = 10 * 60_000,
  run = dispatchMaintenanceReminders } = {}) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try { await run() } catch (error) { console.error('Maintenance reminder worker failed', error) }
    finally { running = false }
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  void tick()
  return () => clearInterval(timer)
}
