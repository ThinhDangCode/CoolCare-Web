import { withTransaction } from '../../config/database.js'

// BR-96: warning at 15 minutes, no automatic penalty for a warning. At 30
// minutes offer the existing customer actions. No contact-response signal is
// currently recorded, so this worker MUST NOT infer a no-show from time alone.
// One durable marker per assignment/stage prevents duplicate notifications.
export async function warnLateArrivals(transaction = withTransaction) {
  return transaction(async db => {
    const { rows } = await db.query(`SELECT b.id AS booking_id,b.booking_code,
      bt.id AS assignment_id,cp.user_id AS customer_user_id,tp.user_id AS technician_user_id,
      CASE WHEN b.scheduled_at<=clock_timestamp()-INTERVAL '30 minutes' THEN '30' ELSE '15' END AS warning_stage
      FROM bookings b JOIN booking_technicians bt ON bt.booking_id=b.id AND bt.status=2
      JOIN customer_profiles cp ON cp.id=b.customer_id
      JOIN technician_profiles tp ON tp.id=bt.technician_id
      WHERE b.status=2 AND b.technician_completed_at IS NULL
        AND b.scheduled_at<=clock_timestamp()-INTERVAL '15 minutes'
        AND NOT EXISTS (SELECT 1 FROM booking_status_history h WHERE h.booking_id=b.id
          AND h.created_at>=bt.responded_at AND h.note=$$COOLCARE_TRAVEL_V1:{"event":"ARRIVED"}$$)
        AND NOT EXISTS (SELECT 1 FROM booking_status_history h WHERE h.booking_id=b.id
          AND h.note='COOLCARE_LATE_V1:'||bt.id::text||':'||
            CASE WHEN b.scheduled_at<=clock_timestamp()-INTERVAL '30 minutes' THEN '30' ELSE '15' END)
      ORDER BY b.scheduled_at,b.id LIMIT 100 FOR UPDATE OF b SKIP LOCKED`)
    for (const row of rows) {
      const late30 = row.warning_stage === '30'
      const marker = `COOLCARE_LATE_V1:${row.assignment_id}:${row.warning_stage}`
      // Recheck under the same booking lock, including arrival and marker.
      const recorded = await db.query(`INSERT INTO booking_status_history(booking_id,status,note,created_at)
        SELECT b.id,2,$3,clock_timestamp() FROM bookings b
        JOIN booking_technicians bt ON bt.booking_id=b.id AND bt.id=$2 AND bt.status=2
        WHERE b.id=$1 AND b.status=2 AND b.technician_completed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM booking_status_history h WHERE h.booking_id=b.id
            AND h.created_at>=bt.responded_at AND h.note=$$COOLCARE_TRAVEL_V1:{"event":"ARRIVED"}$$)
          AND NOT EXISTS (SELECT 1 FROM booking_status_history h WHERE h.booking_id=b.id AND h.note=$3)
        RETURNING id`, [row.booking_id,row.assignment_id,marker])
      if (!recorded.rowCount) continue
      await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
        VALUES($1,'BOOKING',$2,$3,'BOOKING',$4),($5,'BOOKING',$6,$7,'BOOKING',$4)`,
        [row.customer_user_id, late30 ? 'Thợ chưa xác nhận đến sau 30 phút' : 'Thợ chưa xác nhận đến sau 15 phút',
          late30 ? `Booking ${row.booking_code}: bạn có thể liên hệ thợ, đổi thợ và giờ hẹn, hoặc hủy nếu chưa bắt đầu.`
            : `Booking ${row.booking_code}: bạn có thể liên hệ thợ để xác nhận thời gian đến.`, row.booking_id,
          row.technician_user_id, 'Nhắc lịch đến nơi',
          `Booking ${row.booking_code}: đã quá giờ hẹn ít nhất ${row.warning_stage} phút. Vui lòng liên hệ khách và cập nhật trạng thái.`])
    }
    return rows.length
  })
}
