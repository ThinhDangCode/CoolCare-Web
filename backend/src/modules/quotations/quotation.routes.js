import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler, AppError, validateUuid } from '../../utils.js'
import { withTransaction } from '../../config/database.js'

const router = Router()
router.use(authenticate, requireRole('CUSTOMER'))
const fail = (code, message, status = 409) => { throw new AppError(status, code, message) }
const money = (value) => Number(value)

function checkInput(body, type) {
  if (!body || !Array.isArray(body.items) || !body.items.length || body.items.length > 40) {
    fail('INVALID_QUOTATION_ITEMS', 'Báo giá phải có 1–40 hạng mục.', 422)
  }
  if (type === 'ADDITIONAL' && (!body.issueDescription || !String(body.issueDescription).trim())) {
    fail('ADDITIONAL_REASON_REQUIRED', 'Cần nêu lý do báo giá bổ sung.', 422)
  }
  let labor = 0
  let service = 0
  const items = body.items.map((raw) => {
    const description = String(raw.description ?? '').trim()
    const quantity = money(raw.quantity)
    const unitPrice = money(raw.unitPrice)
    const discount = money(raw.discountAmount ?? 0)
    const itemType = raw.itemType
    if (!['LABOR', 'SERVICE'].includes(itemType) || !description || description.length > 500 ||
        !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 ||
        !Number.isFinite(discount) || discount !== 0 ||
        (itemType === 'SERVICE' && !raw.serviceId) || (itemType === 'LABOR' && raw.serviceId)) {
      fail('INVALID_QUOTATION_ITEM', 'Hạng mục báo giá không hợp lệ.', 422)
    }
    if (raw.serviceId) validateUuid(raw.serviceId)
    const total = Math.round(quantity * unitPrice * 100) / 100
    if (itemType === 'LABOR') labor += total - discount
    else service += total - discount
    return { itemType, description, quantity, unitPrice, discount, total, serviceId: raw.serviceId ?? null, unit: String(raw.unit || 'lần').slice(0, 20) }
  })
  const subtotal = Math.round((labor + service) * 100) / 100
  // Existing SQL supports SERVICE and LABOR only. Do not invent a PART item type.
  const partsAmount = money(body.partsAmount ?? 0)
  if (!Number.isFinite(partsAmount) || partsAmount !== 0) {
    fail('INVALID_PARTS_AMOUNT', 'Bản này chưa hỗ trợ chi tiết vật tư; không thể lưu tiền vật tư không có hạng mục.', 422)
  }
  return { items, subtotal, partsAmount, laborAmount: subtotal - partsAmount, note: String(body.note ?? '').slice(0, 2000), issueDescription: type === 'ADDITIONAL' ? String(body.issueDescription).trim() : null }
}

async function technicianBooking(db, userId, bookingId) {
  const result = await db.query(`SELECT b.id,b.status,bt.technician_id,cp.user_id AS customer_user_id
    FROM bookings b JOIN booking_technicians bt ON bt.booking_id=b.id AND bt.status='ACCEPTED'
    JOIN technician_profiles tp ON tp.id=bt.technician_id
    JOIN customer_profiles cp ON cp.id=b.customer_id
    WHERE b.id=$1 AND tp.user_id=$2 FOR UPDATE OF b`, [bookingId, userId])
  if (!result.rows[0]) fail('TECHNICIAN_NOT_ASSIGNED', 'Bạn không phải KTV đang nhận booking này.', 403)
  return result.rows[0]
}

router.get('/bookings/:bookingId', asyncHandler(async (req, res) => {
  const bookingId = validateUuid(req.params.bookingId)
  const data = await withTransaction(async (db) => {
    const access = await db.query(`SELECT b.id FROM bookings b JOIN customer_profiles cp ON cp.id=b.customer_id
      WHERE b.id=$1 AND cp.user_id=$2
      UNION SELECT b.id FROM bookings b JOIN booking_technicians bt ON bt.booking_id=b.id AND bt.status='ACCEPTED'
      JOIN technician_profiles tp ON tp.id=bt.technician_id WHERE b.id=$1 AND tp.user_id=$2`, [bookingId, req.auth.userId])
    if (!access.rowCount) fail('BOOKING_NOT_FOUND', 'Không tìm thấy booking được phép xem.', 404)
    const quotes = (await db.query(`SELECT * FROM quotations WHERE booking_id=$1 ORDER BY quotation_number`, [bookingId])).rows
    for (const quote of quotes) {
      quote.items = (await db.query(`SELECT * FROM quotation_items WHERE quotation_id=$1 ORDER BY id`, [quote.id])).rows
    }
    return quotes
  })
  res.set('Cache-Control', 'no-store').json({ data })
}))

router.post('/bookings/:bookingId', asyncHandler(async (req, res) => {
  const bookingId = validateUuid(req.params.bookingId)
  const type = req.body?.type === 'ADDITIONAL' ? 'ADDITIONAL' : req.body?.type === 'INITIAL' ? 'INITIAL' : null
  if (!type) fail('INVALID_QUOTATION_TYPE', 'Loại báo giá không hợp lệ.', 422)
  const input = checkInput(req.body, type)
  const quote = await withTransaction(async (db) => {
    const job = await technicianBooking(db, req.auth.userId, bookingId)
    if (!['ACCEPTED', 'IN_PROGRESS', 'QUOTATION_ACCEPTED', 'QUOTATION_REJECTED'].includes(job.status)) {
      fail('QUOTATION_NOT_ALLOWED', 'Không thể lập báo giá ở trạng thái hiện tại.')
    }
    const existing = (await db.query('SELECT * FROM quotations WHERE booking_id=$1 ORDER BY quotation_number FOR UPDATE', [bookingId])).rows
    if (existing.some(q => ['DRAFT', 'PENDING'].includes(q.status))) fail('QUOTATION_ALREADY_OPEN', 'Cần xử lý báo giá hiện tại trước.')
    if (type === 'INITIAL' && existing.length) fail('INITIAL_QUOTATION_EXISTS', 'Booking đã có báo giá ban đầu.')
    if (type === 'ADDITIONAL' && !existing.some(q => q.quotation_type === 'INITIAL' && q.status === 'ACCEPTED')) {
      fail('INITIAL_APPROVAL_REQUIRED', 'Cần duyệt báo giá ban đầu trước khi báo giá bổ sung.')
    }
    const number = type === 'INITIAL' ? 1 : Math.max(1, ...existing.map(q => Number(q.quotation_number))) + 1
    const row = (await db.query(`INSERT INTO quotations
      (booking_id,technician_id,quotation_number,quotation_type,issue_description,labor_amount,parts_amount,subtotal,discount_amount,total_amount,status,note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8,'DRAFT',$9) RETURNING *`,
    [bookingId, job.technician_id, number, type, input.issueDescription, input.laborAmount, input.partsAmount, input.subtotal, input.note])).rows[0]
    for (const item of input.items) {
      await db.query(`INSERT INTO quotation_items
        (quotation_id,item_type,service_id,description,quantity,unit,unit_price,total_price,discount_amount)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.id,item.itemType,item.serviceId,item.description,item.quantity,item.unit,item.unitPrice,item.total,item.discount])
    }
    return row
  })
  res.status(201).json({ data: quote })
}))

router.post('/:quotationId/send', asyncHandler(async (req, res) => {
  const id = validateUuid(req.params.quotationId)
  const result = await withTransaction(async (db) => {
    const quote = (await db.query('SELECT booking_id FROM quotations WHERE id=$1', [id])).rows[0]
    if (!quote) fail('QUOTATION_NOT_FOUND', 'Không tìm thấy báo giá.', 404)
    const job = await technicianBooking(db, req.auth.userId, quote.booking_id)
    const updated = (await db.query(`UPDATE quotations SET status='PENDING',sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status='DRAFT' RETURNING *`, [id])).rows[0]
    if (!updated) fail('QUOTATION_NOT_DRAFT', 'Chỉ gửi được báo giá nháp.')
    await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
      VALUES($1,'QUOTATION','Báo giá mới','Bạn có báo giá cần phản hồi.','BOOKING',$2)`, [job.customer_user_id, quote.booking_id])
    return updated
  })
  res.json({ data: result })
}))

router.post('/:quotationId/respond', asyncHandler(async (req, res) => {
  const id = validateUuid(req.params.quotationId)
  const decision = req.body?.decision
  if (!['ACCEPTED', 'REJECTED'].includes(decision)) fail('INVALID_DECISION', 'Chọn chấp nhận hoặc từ chối.', 422)
  const result = await withTransaction(async (db) => {
    const quote = (await db.query(`SELECT q.*,b.status AS booking_status,tp.user_id AS technician_user_id
      FROM quotations q JOIN bookings b ON b.id=q.booking_id
      JOIN customer_profiles cp ON cp.id=b.customer_id
      JOIN technician_profiles tp ON tp.id=q.technician_id
      WHERE q.id=$1 AND cp.user_id=$2 FOR UPDATE OF q,b`, [id, req.auth.userId])).rows[0]
    if (!quote) fail('QUOTATION_NOT_FOUND', 'Không tìm thấy báo giá của bạn.', 404)
    if (quote.status !== 'PENDING') fail('QUOTATION_NOT_PENDING', 'Báo giá không chờ phản hồi.')
    const updated = (await db.query(`UPDATE quotations SET status=$2,responded_at=CURRENT_TIMESTAMP,
      rejection_reason=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
      [id,decision,decision === 'REJECTED' ? String(req.body?.reason || 'Customer declined').slice(0, 1000) : null])).rows[0]
    if (decision === 'ACCEPTED') {
      // DB function recalculates booking price from all accepted quotations.
      await db.query('SELECT (refresh_booking_pricing($1,NULL)).id', [quote.booking_id])
    }
    await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
      VALUES($1,'QUOTATION','Phản hồi báo giá',$2,'BOOKING',$3)`,
      [quote.technician_user_id, decision === 'ACCEPTED' ? 'Khách hàng đã chấp nhận báo giá.' : 'Khách hàng đã từ chối báo giá.', quote.booking_id])
    return updated
  })
  res.json({ data: result })
}))

export function createQuotationRouter() { return router }
