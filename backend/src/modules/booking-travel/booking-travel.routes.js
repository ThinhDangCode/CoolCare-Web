import { Router } from 'express'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pool, withTransaction } from '../../config/database.js'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler, AppError, validateUuid } from '../../utils.js'
import { bookingWorkEstimate } from './booking-work-estimate.js'

// No SQL migration: immutable departure / arrival evidence is saved in the
// existing booking_status_history.note column. Departure-time ETA is a local JSON cache.
// Use a single backend instance and a persistent writable volume for this cache.
const PREFIX = 'COOLCARE_TRAVEL_V1:'
const EARLY_START_GRACE_MINUTES = 15
const earlyStartThreshold = scheduledAt => new Date(scheduledAt).getTime() - EARLY_START_GRACE_MINUTES * 60000
const cacheFile = path.resolve(process.env.TRAVEL_ETA_STORAGE_FILE || './storage/booking-travel-eta.json')
const router = Router()
router.use(authenticate)
let cache = null
let saving = Promise.resolve()

async function loadCache() {
  if (cache) return cache
  try {
    const value = JSON.parse(await readFile(cacheFile, 'utf8'))
    cache = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('ETA cache unavailable:', error.message)
    cache = {}
  }
  return cache
}
async function saveCache(id, update) {
  const state = await loadCache()
  // Keep only estimated travel times, not a location trail.
  const { last_latitude, last_longitude, last_location_at, ...previous } = state[id] || {}
  state[id] = { ...previous, ...update }
  // Serial writes and atomic rename prevent partial JSON from corrupting cache.
  saving = saving.catch(() => {}).then(async () => {
    await mkdir(path.dirname(cacheFile), { recursive: true })
    const temp = `${cacheFile}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 })
    await rename(temp, cacheFile)
  })
  try { await saving } catch (error) { console.error('ETA cache persistence failed:', error) }
  return state[id]
}
const iso = () => new Date().toISOString()
function coordinates(body) {
  if (!body || Object.keys(body).some(k => !['latitude', 'longitude'].includes(k)) ||
      typeof body.latitude !== 'number' || typeof body.longitude !== 'number' ||
      !Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) ||
      Math.abs(body.latitude) > 90 || Math.abs(body.longitude) > 180) {
    throw new AppError(422, 'INVALID_LOCATION', 'Tọa độ GPS không hợp lệ.')
  }
  return [body.latitude, body.longitude]
}
async function getAssignment(db, userId, bookingId, lock = false) {
  validateUuid(bookingId)
  const { rows } = await db.query(`
    SELECT b.id, b.status, b.latitude, b.longitude, b.scheduled_at, tp.user_id AS technician_user_id
    FROM bookings b
    JOIN booking_technicians bt ON bt.booking_id=b.id
    JOIN technician_profiles tp ON tp.id=bt.technician_id
    WHERE b.id=$1 AND tp.user_id=$2 AND bt.status=2 AND b.status=2
    LIMIT 1 ${lock ? 'FOR UPDATE OF b' : ''}`, [bookingId, userId])
  if (!rows.length) throw new AppError(403, 'TRAVEL_NOT_ALLOWED', 'Đơn không thuộc thợ hoặc không còn ở trạng thái đã nhận.')
  if (rows[0].latitude == null || rows[0].longitude == null) {
    throw new AppError(422, 'DESTINATION_GPS_MISSING', 'Địa chỉ khách chưa có tọa độ GPS.')
  }
  return rows[0]
}
async function history(db, bookingId) {
  const { rows } = await db.query(`SELECT note, created_at FROM booking_status_history
    WHERE booking_id=$1 AND note LIKE 'COOLCARE_TRAVEL_V1:%'
    ORDER BY created_at ASC, id ASC`, [bookingId])
  let departedAt = null, arrivedAt = null, earlyApprovedAt = null
  for (const row of rows) {
    try {
      const event = JSON.parse(row.note.slice(PREFIX.length))
      if (event.event === 'DEPARTED' && !departedAt) departedAt = row.created_at
      if (event.event === 'ARRIVED' && !arrivedAt) arrivedAt = row.created_at
      if (event.event === 'EARLY_APPROVED' && !earlyApprovedAt) earlyApprovedAt = row.created_at
    } catch { /* ignore malformed historical notes */ }
  }
  return { departedAt, arrivedAt, earlyApprovedAt }
}
async function notifyCustomer(db, bookingId, title, message) {
  // Use the existing notifications table. No new tables or schema changes.
  await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
    SELECT cp.user_id, 0, $2, $3, 'BOOKING', b.id::text
    FROM bookings b JOIN customer_profiles cp ON cp.id=b.customer_id WHERE b.id=$1`,
  [bookingId, title, message])
}
async function appendEvent(db, bookingId, userId, event) {
  // Status 2 is ACCEPTED in the official schema; this is a journal note,
  // NOT a booking status transition. These notes are hidden from the status timeline.
  await db.query(`INSERT INTO booking_status_history
      (booking_id, status, changed_by_id, note, created_at)
      VALUES ($1, 2, $2, $3, CURRENT_TIMESTAMP)`,
    [bookingId, userId, PREFIX + JSON.stringify({ event })])
}
function haversine(lat1, lng1, lat2, lng2) {
  const rad = x => x * Math.PI / 180
  const deltaLat = rad(lat2 - lat1), deltaLng = rad(lng2 - lng1)
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(deltaLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}
async function routeEstimate(lat, lng, targetLat, targetLng) {
  if (!process.env.OPENROUTESERVICE_API_KEY) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: process.env.OPENROUTESERVICE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[lng, lat], [targetLng, targetLat]] }),
    })
    if (!response.ok) return null
    const json = await response.json()
    const summary = json.routes?.[0]?.summary
    if (!Number.isFinite(summary?.duration) || !Number.isFinite(summary?.distance)) return null
    return { seconds: Math.ceil(summary.duration), meters: Math.round(summary.distance) }
  } catch { return null } finally { clearTimeout(timeout) }
}
async function view(db, bookingId) {
  const markers = await history(db, bookingId)
  const cached = (await loadCache())[bookingId] || {}
  const status = markers.arrivedAt ? 'ARRIVED' : markers.departedAt ? 'TRAVELLING' : 'NOT_STARTED'
  // ETA is a one-time estimate at departure, not ongoing location tracking.
  const stale = status === 'TRAVELLING' && !cached.eta_at
  const { rows: scheduleRows } = await db.query('SELECT scheduled_at FROM bookings WHERE id=$1', [bookingId])
  const scheduledAt = scheduleRows[0]?.scheduled_at || null
  const arrivedAt = markers.arrivedAt ? new Date(markers.arrivedAt) : null
  const deadline = scheduledAt ? new Date(new Date(scheduledAt).getTime() + 15 * 60000) : null
  const lateMinutes = scheduledAt && arrivedAt ? Math.max(0, Math.floor((arrivedAt.getTime() - new Date(scheduledAt).getTime()) / 60000)) : null
  const arrivalLate = lateMinutes !== null ? lateMinutes >= 15 : Boolean(deadline && new Date() > deadline)
  const work = markers.arrivedAt ? await bookingWorkEstimate(db, bookingId, markers.arrivedAt) : null
  return {
    scheduled_at: scheduledAt, arrival_grace_minutes: 15, early_start_grace_minutes: EARLY_START_GRACE_MINUTES, arrival_late: arrivalLate,
    early_arrival: Boolean(arrivedAt && scheduledAt && arrivedAt < new Date(scheduledAt)),
    early_start_approved: Boolean(markers.earlyApprovedAt),
    early_start_allowed: Boolean(arrivedAt && (markers.earlyApprovedAt || (scheduledAt && Date.now() >= earlyStartThreshold(scheduledAt)))),
    arrival_late_minutes: lateMinutes,
    arrival_late_level: lateMinutes === null || lateMinutes < 15 ? null : lateMinutes < 30 ? 'NOTICE' : lateMinutes < 60 ? 'SERIOUS' : 'CRITICAL',
    ...work,
    status, departed_at: markers.departedAt, arrived_at: markers.arrivedAt,
    eta_at: status === 'TRAVELLING' ? cached.eta_at || null : null,
    predeparture_duration_seconds: cached.predeparture_duration_seconds ?? null,
    predeparture_distance_meters: cached.predeparture_distance_meters ?? null,
    predeparture_estimated_at: cached.predeparture_estimated_at || null,
    routing_available: cached.routing_available ?? null,
    duration_seconds: status === 'TRAVELLING' ? cached.duration_seconds ?? null : null,
    distance_meters: status === 'TRAVELLING' ? cached.distance_meters ?? null : null,
    eta_updated_at: cached.eta_updated_at || null, stale,
    estimate_type: 'route_estimate_without_live_traffic',
  }
}
async function startDeparture(userId, id, body) {
  // GPS is sampled once at departure to calculate travel duration; not tracked.
  const [lat, lng] = coordinates(body)
  const booking = await getAssignment(pool, userId, id)
  const estimate = await routeEstimate(lat, lng, Number(booking.latitude), Number(booking.longitude))
  if (!estimate) throw new AppError(503, 'ROUTE_ESTIMATE_UNAVAILABLE', 'Không tính được thời gian di chuyển. Kiểm tra kết nối, cấu hình bản đồ rồi thử lại.')
  await withTransaction(async db => {
    await getAssignment(db, userId, id, true)
    const markers = await history(db, id)
    if (markers.departedAt) throw new AppError(409, 'TRAVEL_STARTED', 'Hành trình đã được bắt đầu.')
    await appendEvent(db, id, userId, 'DEPARTED')
    const arrival = Date.now() + estimate.seconds * 1000
    if (booking.scheduled_at && arrival >= new Date(booking.scheduled_at).getTime() + 15 * 60000) {
      const minutes = Math.ceil((arrival - new Date(booking.scheduled_at).getTime()) / 60000)
      await notifyCustomer(db, id, 'Thợ dự kiến đến trễ', `Thợ đã bắt đầu di chuyển nhưng dự kiến đến trễ khoảng ${minutes} phút. Bạn có thể nhắn tin trao đổi trực tiếp với thợ.`)
    }
  })
  const now = iso()
  await saveCache(id, {
    eta_at: estimate ? new Date(Date.now() + estimate.seconds * 1000).toISOString() : null,
    duration_seconds: estimate?.seconds ?? null,
    distance_meters: estimate?.meters ?? null,
    eta_updated_at: now,
    routing_available: Boolean(estimate),
  })
  return { ...await view(pool, id), routing_available: Boolean(estimate) }
}
// One-time GPS estimate after accepting a job, before departure.
// Does not mark departure and never starts the work timer.
router.post('/:id/estimate', requireRole('CUSTOMER', 'TECHNICIAN'), asyncHandler(async (req, res) => {
  const [lat, lng] = coordinates(req.body)
  const booking = await getAssignment(pool, req.auth.userId, req.params.id)
  const markers = await history(pool, req.params.id)
  // A delayed/retried post-acceptance estimate must not fail if departure
  // was already recorded. Return the current travel state without overwriting it.
  if (markers.departedAt) {
    return res.set('Cache-Control', 'no-store').json({ data: await view(pool, req.params.id) })
  }
  const estimate = await routeEstimate(lat, lng, Number(booking.latitude), Number(booking.longitude))
  await saveCache(req.params.id, {
    predeparture_duration_seconds: estimate?.seconds ?? null,
    predeparture_distance_meters: estimate?.meters ?? null,
    predeparture_estimated_at: iso(),
    routing_available: Boolean(estimate),
  })
  res.set('Cache-Control', 'no-store').json({ data: await view(pool, req.params.id) })
}))
router.post('/:id/start', requireRole('CUSTOMER', 'TECHNICIAN'), asyncHandler(async (req, res) => {
  const result = await startDeparture(req.auth.userId, req.params.id, req.body)
  res.status(201).set('Cache-Control', 'no-store').json({ data: result })
}))
router.post('/:id/location', requireRole('CUSTOMER', 'TECHNICIAN'), asyncHandler(async (req, res) => {
  throw new AppError(410, 'LOCATION_TRACKING_DISABLED', 'Hệ thống không theo dõi vị trí liên tục. Chỉ cần xác nhận Đã đến nơi.')
}))
router.post('/:id/arrive', requireRole('CUSTOMER', 'TECHNICIAN'), asyncHandler(async (req, res) => {
  // Arrival is a manual confirmation; no GPS required (supports emulator testing).
  await withTransaction(async db => {
    const booking = await getAssignment(db, req.auth.userId, req.params.id, true)
    const markers = await history(db, req.params.id)
    if (!markers.departedAt || markers.arrivedAt) throw new AppError(409, 'NOT_TRAVELLING', 'Hành trình chưa bắt đầu hoặc đã đến nơi.')
    await appendEvent(db, req.params.id, req.auth.userId, 'ARRIVED')
    if (booking.scheduled_at && Date.now() < earlyStartThreshold(booking.scheduled_at)) {
      await notifyCustomer(db, req.params.id, 'Thợ đã đến sớm', 'Thợ đã xác nhận đến nơi sớm hơn 15 phút. Nếu muốn bắt đầu ngay, hãy mở chi tiết đơn và xác nhận; nếu không, thợ có thể bắt đầu khi còn 15 phút đến giờ hẹn.')
    }
    if (booking.scheduled_at) {
      const minutes = Math.max(0, Math.floor((Date.now() - new Date(booking.scheduled_at).getTime()) / 60000))
      if (minutes >= 15) {
        const action = minutes >= 60 ? 'Bạn có thể liên hệ hỗ trợ để yêu cầu hủy hoặc đổi thợ theo chính sách.'
          : minutes >= 30 ? 'Bạn có thể trao đổi với thợ hoặc liên hệ hỗ trợ nếu muốn hủy theo chính sách.'
          : 'Bạn có thể nhắn tin trao đổi với thợ.'
        await notifyCustomer(db, req.params.id, 'Thợ đã đến trễ', `Thợ đã xác nhận đến nơi, trễ ${minutes} phút so với giờ hẹn. ${action}`)
      }
    }
  })
  await saveCache(req.params.id, { eta_at: null })
  res.set('Cache-Control', 'no-store').json({ data: await view(pool, req.params.id) })
}))
// The customer's explicit approval is required to begin work before the booked time.
// Arrival itself is the technician's acknowledgement. Approval is a separate
// journal event; no new database tables or columns are needed.
router.post('/:id/approve-early', requireRole('CUSTOMER'), asyncHandler(async (req, res) => {
  validateUuid(req.params.id)
  await withTransaction(async db => {
    const { rows } = await db.query(`SELECT b.scheduled_at, b.status FROM bookings b
      JOIN customer_profiles cp ON cp.id=b.customer_id
      WHERE b.id=$1 AND cp.user_id=$2 FOR UPDATE OF b`, [req.params.id, req.auth.userId])
    if (!rows.length) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn của bạn.')
    // The database adapter exposes enum labels (ACCEPTED), while raw queries may return code 2.
    if (rows[0].status !== 'ACCEPTED' && Number(rows[0].status) !== 2) {
      throw new AppError(409, 'BOOKING_NOT_ACCEPTED', 'Đơn không còn ở trạng thái đã nhận.')
    }
    const markers = await history(db, req.params.id)
    if (!markers.arrivedAt) throw new AppError(409, 'TECHNICIAN_NOT_ARRIVED', 'Thợ chưa xác nhận đến nơi.')
    if (markers.earlyApprovedAt) return
    // A request opened before the appointment can arrive after the appointment time.
    // Treat that as a harmless no-op: approval is no longer required.
    if (!rows[0].scheduled_at || Date.now() >= earlyStartThreshold(rows[0].scheduled_at)) return
    await appendEvent(db, req.params.id, req.auth.userId, 'EARLY_APPROVED')
    await db.query(`INSERT INTO notifications(user_id,type,title,message,reference_type,reference_id)
      SELECT tp.user_id, 0, 'Khách đồng ý bắt đầu sớm',
      'Khách đã xác nhận cho phép bắt đầu sửa chữa trước giờ hẹn.', 'BOOKING', b.id::text
      FROM bookings b JOIN booking_technicians bt ON bt.booking_id=b.id AND bt.status=2
      JOIN technician_profiles tp ON tp.id=bt.technician_id WHERE b.id=$1`, [req.params.id])
  })
  res.set('Cache-Control', 'no-store').json({ data: await view(pool, req.params.id) })
}))
router.get('/:id', requireRole('CUSTOMER', 'TECHNICIAN'), asyncHandler(async (req, res) => {
  validateUuid(req.params.id)
  const allowed = await pool.query(`SELECT 1 FROM bookings b JOIN customer_profiles cp ON cp.id=b.customer_id
    WHERE b.id=$1 AND cp.user_id=$2
    UNION SELECT 1 FROM booking_technicians bt JOIN technician_profiles tp ON tp.id=bt.technician_id
    WHERE bt.booking_id=$1 AND tp.user_id=$2 AND bt.status IN (2,6) LIMIT 1`,
  [req.params.id, req.auth.userId])
  if (!allowed.rows.length) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn.')
  res.set('Cache-Control', 'no-store').json({ data: await view(pool, req.params.id) })
}))
export { router as bookingTravelRouter }
