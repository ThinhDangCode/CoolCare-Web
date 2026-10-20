import { AppError } from '../../utils.js'

// Called inside the caller's existing transaction; no schema changes.
export async function ensureDefaultQuotation(db, bookingId, technicianId) {
  const existing = await db.query(
    'SELECT id, status FROM quotations WHERE booking_id=$1 ORDER BY quotation_number FOR UPDATE',
    [bookingId],
  )
  if (existing.rows.length) {
    if (existing.rows.some((quote) => quote.status === 'ACCEPTED')) return existing.rows.find((quote) => quote.status === 'ACCEPTED')
    throw new AppError(409, 'QUOTATION_APPROVAL_REQUIRED', 'Cần khách hàng chấp nhận báo giá trước khi hoàn thành.')
  }

  // Reuse the prices accepted when the booking was originally placed.
  const services = await db.query(
    `SELECT bus.id AS booking_unit_service_id, bus.service_id, s.name, bus.unit_price
     FROM booking_unit_services bus
     JOIN booking_units bu ON bu.id=bus.booking_unit_id
     JOIN services s ON s.id=bus.service_id
     WHERE bu.booking_id=$1 ORDER BY bu.unit_number, bus.id`,
    [bookingId],
  )
  if (!services.rows.length) {
    throw new AppError(409, 'QUOTATION_ITEMS_REQUIRED', 'Booking chưa có dịch vụ để lập báo giá mặc định.')
  }
  const subtotal = services.rows.reduce((sum, row) => sum + Number(row.unit_price), 0)
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    throw new AppError(409, 'INVALID_QUOTATION_TOTAL', 'Giá dịch vụ không hợp lệ.')
  }
  const created = await db.query(
    `INSERT INTO quotations
       (booking_id, technician_id, quotation_number, quotation_type,
        labor_amount, parts_amount, subtotal, discount_amount, total_amount,
        status, note, sent_at, responded_at)
     VALUES ($1,$2,1,'INITIAL',0,0,$3,0,$3,'ACCEPTED',
       'Dịch vụ theo đơn đặt ban đầu',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     RETURNING *`,
    [bookingId, technicianId, subtotal],
  )
  const quote = created.rows[0]
  for (const item of services.rows) {
    await db.query(
      `INSERT INTO quotation_items
         (quotation_id, booking_unit_service_id, item_type, service_id,
          description, quantity, unit, unit_price, total_price, discount_amount)
       VALUES ($1,$2,'SERVICE',$3,$4,1,'lần',$5,$5,0)`,
      [quote.id, item.booking_unit_service_id, item.service_id, item.name, item.unit_price],
    )
  }
  await db.query('SELECT (refresh_booking_pricing($1,NULL)).id', [bookingId])
  return quote
}
