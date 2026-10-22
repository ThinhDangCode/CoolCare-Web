import { Router } from 'express'
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler, AppError, validateUuid } from '../../utils.js'
import { withTransaction } from '../../config/database.js'

const router = Router()

const error = (code, message, status = 409) => {
  throw new AppError(status, code, message)
}

const env = (key) => {
  if (!process.env[key]) {
    error('GATEWAY_NOT_CONFIGURED', `${key} is not configured`, 503)
  }
  return process.env[key]
}

const mac = (key, data, alg = 'sha256') =>
  createHmac(alg, key).update(data).digest('hex')

const same = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b))

// =====================================================
// VNPAY SIGNATURE
// =====================================================

const vnpSign = (data) =>
  Object.keys(data)
    .sort()
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(
          String(data[k])
        ).replace(/%20/g, '+')}`
    )
    .join('&')

const utc7 = (date) => {
  const d = new Date(date.getTime() + 7 * 3600000)
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

const safeUrl = (url) => {
  const u = new URL(url)

  if (u.protocol !== 'https:') {
    error(
      'INVALID_GATEWAY_URL',
      'Gateway URL must use HTTPS',
      503
    )
  }

  return u.toString()
}

// VNPay requires IPv4; do not trust arbitrary X-Forwarded-For headers.
const vnpClientIp = (req) => {
  const raw = String(req.ip || req.socket?.remoteAddress || '127.0.0.1')
  const ip = raw.startsWith('::ffff:') ? raw.slice(7) : raw
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
      ip.split('.').every(part => Number(part) <= 255)) return ip
  return '127.0.0.1'
}

// =====================================================
// DATABASE HELPERS
// =====================================================

async function owned(db, userId, bookingId) {
  const r = await db.query(
    `SELECT b.*
     FROM bookings b
     JOIN customer_profiles cp ON cp.id = b.customer_id
     WHERE b.id = $1 AND cp.user_id = $2
     FOR UPDATE OF b`,
    [bookingId, userId]
  )

  if (!r.rowCount) {
    error('BOOKING_NOT_FOUND', 'Booking not found', 404)
  }

  return r.rows[0]
}

async function assigned(db, userId, bookingId) {
  const r = await db.query(`SELECT b.* FROM bookings b
    JOIN booking_technicians bt ON bt.booking_id=b.id
    JOIN technician_profiles tp ON tp.id=bt.technician_id
    WHERE b.id=$1 AND tp.user_id=$2 AND bt.status IN ('ACCEPTED','COMPLETED')
    FOR UPDATE OF b`, [bookingId,userId])
  if (!r.rowCount) error('BOOKING_NOT_FOUND','Assigned booking not found',404)
  return r.rows[0]
}

async function method(db, code) {
  const r = await db.query(
    `SELECT *
     FROM payment_methods
     WHERE code = $1 AND is_active = true`,
    [code]
  )

  if (!r.rowCount) {
    error(
      'PAYMENT_METHOD_UNAVAILABLE',
      'Payment method is unavailable',
      409
    )
  }

  return r.rows[0]
}

async function attempt(db, id) {
  const r = await db.query(
    'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
    [id]
  )

  if (!r.rowCount) {
    error('PAYMENT_NOT_FOUND', 'Payment not found', 404)
  }

  return r.rows[0]
}

async function close(db, payment, status, reference) {
  if (
    ['SUCCESS', 'FAILED', 'CANCELLED'].includes(
      payment.payment_status
    )
  ) {
    return payment
  }

  return (
    await db.query(
      `UPDATE payments
       SET payment_status = $2,
           closure_verified_at = CURRENT_TIMESTAMP,
           closure_reference = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [payment.id, status, reference]
    )
  ).rows[0]
}

async function succeed(
  db,
  payment,
  reference,
  kind = 'ONLINE',
  userId = null
) {
  if (payment.payment_status === 'SUCCESS') {
    return payment
  }

  if (
    ['FAILED', 'CANCELLED'].includes(
      payment.payment_status
    )
  ) {
    return payment
  }

  if (kind === 'CASH') {
    return (
      await db.query(
        `UPDATE payments
         SET payment_status = 'SUCCESS',
             cash_received_by_id = $2,
             cash_received_at = CURRENT_TIMESTAMP,
             paid_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [payment.id, userId]
      )
    ).rows[0]
  }

  return (
    await db.query(
      `UPDATE payments
       SET payment_status = 'SUCCESS',
           transaction_reference = COALESCE(transaction_reference, $2),
           paid_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [payment.id, reference]
    )
  ).rows[0]
}

// =====================================================
// GET PAYMENT METHODS
// =====================================================

router.get(
  '/methods',
  authenticate,
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const data = await withTransaction(
      async (db) =>
        (
          await db.query(
            `SELECT code, name, is_online
             FROM payment_methods
             WHERE is_active = true
               AND code IN ('CASH', 'VNPAY', 'ZALOPAY', 'FREE')
             ORDER BY code`
          )
        ).rows
    )

    res.json({ data })
  })
)

// Customer payment history across all owned bookings (read-only).
router.get('/history', authenticate, requireRole('CUSTOMER'), asyncHandler(async (req, res) => {
  const limitRaw = req.query.limit === undefined ? 20 : Number(req.query.limit)
  const pageRaw = req.query.page === undefined ? 1 : Number(req.query.page)
  if (!Number.isSafeInteger(limitRaw) || limitRaw < 1 || limitRaw > 100 ||
      !Number.isSafeInteger(pageRaw) || pageRaw < 1 || pageRaw > 100000) {
    error('INVALID_PAGINATION', 'Page must be positive and limit between 1 and 100.', 422)
  }
  const offset = (pageRaw - 1) * limitRaw
  const data = await withTransaction(async db => {
    const args = [req.auth.userId]
    const filter = `FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      JOIN customer_profiles cp ON cp.id = b.customer_id
      LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
      WHERE cp.user_id = $1`
    const count = await db.query(`SELECT COUNT(*)::integer AS total ${filter}`, args)
    const rows = await db.query(`SELECT p.id, p.booking_id, p.payment_code, p.amount,
      p.payment_status, p.payment_kind, p.created_at, p.paid_at,
      pm.code AS method_code ${filter}
      ORDER BY p.created_at DESC, p.id DESC LIMIT $2 OFFSET $3`,
      [...args, limitRaw, offset])
    return { payments: rows.rows, total: count.rows[0].total, page: pageRaw, limit: limitRaw }
  })
  res.json({ data })
}))

// =====================================================
// GET BOOKING PAYMENTS
// =====================================================

router.get(
  '/bookings/:bookingId',
  authenticate,
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const bookingId = validateUuid(req.params.bookingId)

    const data = await withTransaction(async (db) => {
      const b = await owned(
        db,
        req.auth.userId,
        bookingId
      )

      const payments = (
        await db.query(
          `SELECT
             p.id,
             p.payment_code,
             p.amount,
             p.payment_status,
             p.payment_kind,
             p.created_at,
             p.paid_at,
             pm.code AS method_code
           FROM payments p
           JOIN payment_methods pm
             ON pm.id = p.payment_method_id
           WHERE p.booking_id = $1
           ORDER BY p.created_at DESC`,
          [bookingId]
        )
      ).rows

      return {
        booking: {
          id: b.id,
          status: b.status,
          subtotal: b.subtotal,
          discount_amount: b.discount_amount,
          total_amount: b.total_amount,
          voucher_id: b.voucher_id,
          charges_confirmed_at: b.charges_confirmed_at
        },
        payments
      }
    })

    res.json({ data })
  })
)

// =====================================================
// CONFIRM FINAL CHARGES
// =====================================================

router.post(
  '/bookings/:bookingId/confirm-charges',
  authenticate,
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const id = validateUuid(req.params.bookingId)

    const data = await withTransaction(async (db) => {
      const b = await owned(db, req.auth.userId, id)

      if (
        b.status !== 'COMPLETED' ||
        !b.completion_confirmed_at
      ) {
        error(
          'BOOKING_NOT_COMPLETED',
          'Confirm booking completion first'
        )
      }

      if (
        (
          await db.query(
            `SELECT 1
             FROM quotations
             WHERE booking_id = $1
               AND status IN ('DRAFT', 'PENDING')
             LIMIT 1`,
            [id]
          )
        ).rowCount
      ) {
        error(
          'OPEN_QUOTATION',
          'Resolve quotations first'
        )
      }

      if (
        (
          await db.query(
            `SELECT 1
             FROM payments
             WHERE booking_id = $1
               AND payment_status IN (
                 'PENDING', 'PROCESSING', 'SUCCESS'
               )
             LIMIT 1`,
            [id]
          )
        ).rowCount
      ) {
        error(
          'PAYMENT_ALREADY_STARTED',
          'Payment already started'
        )
      }

      const totals = (
        await db.query(
          `SELECT SUM(subtotal) AS subtotal
           FROM quotations
           WHERE booking_id = $1
             AND status = 'ACCEPTED'`,
          [id]
        )
      ).rows[0]

      if (
        totals.subtotal === null ||
        Number(totals.subtotal) !== Number(b.subtotal)
      ) {
        error(
          'PRICE_MISMATCH',
          'Quotation total does not match booking'
        )
      }

      return (
        await db.query(
          `UPDATE bookings
           SET charges_confirmed_by_id = $2,
               charges_confirmed_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, total_amount, charges_confirmed_at`,
          [id, req.auth.userId]
        )
      ).rows[0]
    })

    res.json({ data })
  })
)

// =====================================================
// CREATE PAYMENT ATTEMPT
// =====================================================

router.post(
  '/bookings/:bookingId/attempts',
  authenticate,
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const bookingId = validateUuid(req.params.bookingId)

    const code = String(
      req.body?.method || ''
    ).toUpperCase()

    if (
      !['CASH', 'VNPAY', 'ZALOPAY', 'FREE'].includes(code)
    ) {
      error(
        'INVALID_PAYMENT_METHOD',
        'Invalid payment method',
        422
      )
    }

    if (code === 'VNPAY') {
      [
        'VNPAY_TMN_CODE',
        'VNPAY_HASH_SECRET',
        'VNPAY_PAY_URL',
        'VNPAY_RETURN_URL'
      ].forEach(env)
    }

    if (code === 'ZALOPAY') {
      [
        'ZALOPAY_APP_ID',
        'ZALOPAY_KEY1',
        'ZALOPAY_KEY2',
        'ZALOPAY_CREATE_URL',
        'ZALOPAY_CALLBACK_URL'
      ].forEach(env)
    }

    const key = String(
      req.body?.idempotencyKey || ''
    )

    if (!/^[a-zA-Z0-9:_-]{16,120}$/.test(key)) {
      error(
        'INVALID_IDEMPOTENCY_KEY',
        'Idempotency key must be 16–120 safe characters',
        422
      )
    }

    const data = await withTransaction(async (db) => {
      const b = await assigned(
        db,
        req.auth.userId,
        bookingId
      )

      const old = (
        await db.query(
          'SELECT * FROM payments WHERE idempotency_key = $1',
          [key]
        )
      ).rows[0]

      if (old) {
        if (
          old.booking_id !== bookingId ||
          old.customer_id !== b.customer_id
        ) {
          error(
            'IDEMPOTENCY_CONFLICT',
            'Key belongs to another payment'
          )
        }

        const previousMethod = await db.query(
          'SELECT code FROM payment_methods WHERE id = $1',
          [old.payment_method_id]
        )

        if (previousMethod.rows[0]?.code !== code) {
          error(
            'IDEMPOTENCY_CONFLICT',
            'Key belongs to another payment method',
            409
          )
        }

        return old
      }

      if (
        b.status !== 'COMPLETED' ||
        !b.charges_confirmed_at
      ) {
        error(
          'CHARGES_NOT_CONFIRMED',
          'Confirm final charges before payment'
        )
      }

      if (
        (
          await db.query(
            `SELECT 1
             FROM payments
             WHERE booking_id = $1
               AND payment_status IN (
                 'PENDING', 'PROCESSING', 'SUCCESS'
               )
             LIMIT 1`,
            [bookingId]
          )
        ).rowCount
      ) {
        error(
          'PAYMENT_ALREADY_ACTIVE',
          'Existing payment must finish first'
        )
      }

      if (
        (Number(b.total_amount) === 0 &&
          code !== 'FREE') ||
        (Number(b.total_amount) > 0 &&
          code === 'FREE')
      ) {
        error(
          'PAYMENT_METHOD_AMOUNT_MISMATCH',
          'Invalid method for amount'
        )
      }

      const m = await method(db, code)

      const tech = (
        await db.query(
          `SELECT technician_id
           FROM booking_technicians
           WHERE booking_id = $1
             AND status IN ('ACCEPTED', 'COMPLETED')
           ORDER BY responded_at DESC NULLS LAST
           LIMIT 1`,
          [bookingId]
        )
      ).rows[0]

      if (!tech || !(await db.query('SELECT 1 FROM technician_profiles WHERE id=$1 AND user_id=$2', [tech.technician_id,req.auth.userId])).rowCount) {
        error(
          'ASSIGNED_TECHNICIAN_REQUIRED',
          'No assigned technician'
        )
      }

      const row = (
        await db.query(
          `INSERT INTO payments (
             payment_code,
             idempotency_key,
             booking_id,
             customer_id,
             technician_id,
             amount,
             payment_method_id,
             payment_status,
             payment_kind
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, 'PENDING', $8
           )
           RETURNING *`,
          [
            `PAY${Date.now()
              .toString(36)
              .toUpperCase()}${randomUUID()
              .slice(0, 5)
              .toUpperCase()}`.slice(0, 20),
            key,
            bookingId,
            b.customer_id,
            tech.technician_id,
            b.total_amount,
            m.id,
            code === 'CASH'
              ? 'CASH'
              : code === 'FREE'
                ? 'FREE'
                : 'ONLINE'
          ]
        )
      ).rows[0]

      if (code === 'FREE') {
        return await succeed(
          db,
          row,
          `free:${row.id}`
        )
      }

      return row
    })

    res.status(201).json({
      data: {
        id: data.id,
        payment_code: data.payment_code,
        amount: data.amount,
        payment_status: data.payment_status,
        method: code
      }
    })
  })
)

// =====================================================
router.get('/technician/bookings/:bookingId/summary', authenticate, requireRole('CUSTOMER'), asyncHandler(async (req,res)=>{
 const id=validateUuid(req.params.bookingId)
 const data=await withTransaction(async db=>{
   const b=await assigned(db,req.auth.userId,id)
   const r=await db.query(`SELECT p.id,p.amount,p.payment_status,p.payment_kind,p.checkout_url,p.qr_expires_at,p.paid_at,pm.code AS method_code
    FROM payments p JOIN payment_methods pm ON pm.id=p.payment_method_id WHERE p.booking_id=$1 ORDER BY p.created_at DESC`,[id])
   return {booking:{id:b.id,status:b.status,total_amount:b.total_amount,charges_confirmed_at:b.charges_confirmed_at},payments:r.rows}
 })
 res.json({data})
}))

// TECHNICIAN CASH PAYMENTS
// =====================================================

router.get(
  '/technician/bookings/:bookingId',
  authenticate,
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const id = validateUuid(req.params.bookingId)

    const data = await withTransaction(async (db) => {
      const r = await db.query(
        `SELECT
           p.id,
           p.amount,
           p.payment_status,
           p.payment_kind,
           p.created_at, p.paid_at, p.checkout_url, p.qr_expires_at,
           pm.code AS method_code
         FROM payments p
         JOIN payment_methods pm ON pm.id=p.payment_method_id
         JOIN technician_profiles tp
           ON tp.id = p.technician_id
         WHERE p.booking_id = $1
           AND tp.user_id = $2
         ORDER BY p.created_at DESC`,
        [id, req.auth.userId]
      )

      return r.rows
    })

    res.json({ data })
  })
)

// =====================================================
// CONFIRM CASH
// =====================================================

router.post(
  '/:paymentId/confirm-cash',
  authenticate,
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const id = validateUuid(req.params.paymentId)

    const data = await withTransaction(async (db) => {
      const p = await attempt(db, id)

      const tech = (
        await db.query(
          `SELECT user_id
           FROM technician_profiles
           WHERE id = $1`,
          [p.technician_id]
        )
      ).rows[0]

      if (
        !tech ||
        tech.user_id !== req.auth.userId
      ) {
        error(
          'NOT_ASSIGNED_TECHNICIAN',
          'Only assigned technician may confirm cash',
          403
        )
      }

      if (p.payment_kind !== 'CASH') {
        error('NOT_CASH', 'Not a cash payment')
      }

      if (p.payment_status === 'SUCCESS') {
        return p
      }

      if (p.payment_status !== 'PENDING') {
        error(
          'PAYMENT_CLOSED',
          'Payment cannot be confirmed'
        )
      }

      return succeed(
        db,
        p,
        null,
        'CASH',
        req.auth.userId
      )
    })

    res.json({
      data: {
        id: data.id,
        status: data.payment_status
      }
    })
  })
)

// =====================================================
// CHECKOUT: VNPAY / ZALOPAY APP-TO-APP
// =====================================================

router.post(
  '/:paymentId/checkout',
  authenticate,
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const id = validateUuid(req.params.paymentId)

    const payment = await withTransaction(async (db) => {
      const p = await attempt(db, id)

      const b = await assigned(
        db,
        req.auth.userId,
        p.booking_id
      )

      if (b.customer_id !== p.customer_id || !(await db.query('SELECT 1 FROM technician_profiles WHERE id=$1 AND user_id=$2',[p.technician_id,req.auth.userId])).rowCount) {
        error(
          'PAYMENT_NOT_FOUND',
          'Payment not found',
          404
        )
      }

      const m = await db.query(
        'SELECT code FROM payment_methods WHERE id = $1',
        [p.payment_method_id]
      )

      if (
        !['VNPAY', 'ZALOPAY'].includes(
          m.rows[0]?.code
        )
      ) {
        error(
          'NOT_ONLINE',
          'Not an online payment'
        )
      }

      if (p.payment_status !== 'PENDING') {
        error(
          'INVALID_PAYMENT_STATE',
          'Payment is not pending'
        )
      }

      if (
        m.rows[0].code === 'ZALOPAY' &&
        (p.provider_order_id || p.transaction_reference)
      ) {
        error(
          'CHECKOUT_ALREADY_CREATED',
          'ZaloPay checkout already created; reconcile or close before retry'
        )
      }

      // Reserve the gateway order ID while holding the payment row lock.
      // A network timeout is ambiguous, so never automatically clear it.
      if (m.rows[0].code === 'ZALOPAY') {
        const reservedOrderId =
          `${utc7(new Date()).slice(2, 8)}_${p.id.replace(/-/g, '')}`
        await db.query(
          `UPDATE payments SET provider_order_id = $2, updated_at = NOW()
           WHERE id = $1 AND payment_status = 'PENDING'`,
          [p.id, reservedOrderId]
        )
        p.provider_order_id = reservedOrderId
      }

      return {
        ...p,
        provider: m.rows[0].code
      }
    })

    // =================================================
    // VNPAY CHECKOUT
    // =================================================

    if (payment.provider === 'VNPAY') {
      if (payment.checkout_url) {
        return res.json({data: {paymentId: payment.id, url: payment.checkout_url, provider: 'VNPAY'}})
      }
      const now = new Date()

      const data = {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: env('VNPAY_TMN_CODE'),
        vnp_Amount: String(
          Math.round(Number(payment.amount) * 100)
        ),
        vnp_CurrCode: 'VND',
        vnp_TxnRef: payment.id,
        vnp_OrderInfo: `CoolCare ${payment.payment_code}`,
        vnp_OrderType: 'other',
        vnp_Locale: 'vn',
        vnp_ReturnUrl: env('VNPAY_RETURN_URL'),
        vnp_IpAddr: vnpClientIp(req),
        vnp_CreateDate: utc7(now),
        vnp_ExpireDate: utc7(
          new Date(now.getTime() + 15 * 60000)
        )
      }

      const qs = vnpSign(data)

      // FIX: VNPay 2.1.0 dùng HMAC-SHA512.
      // Không dùng SHA256 mặc định của hàm mac().

      const url =
        safeUrl(env('VNPAY_PAY_URL')) +
        '?' +
        qs +
        '&vnp_SecureHash=' +
        mac(env('VNPAY_HASH_SECRET'), qs, 'sha512')

      await withTransaction(async db => {
        await db.query(`UPDATE payments SET provider_order_id=COALESCE(provider_order_id,$2), checkout_url=$3, qr_expires_at=NOW()+INTERVAL '15 minutes', updated_at=NOW() WHERE id=$1 AND payment_status='PENDING'`,[payment.id,payment.payment_code,url])
      })
      return res.json({
        data: {
          paymentId: payment.id,
          url,
          provider: 'VNPAY'
        }
      })
    }

    // =================================================
    // ZALOPAY: only accept gateway-provided scan QR data (not app-to-app URL)
    // =================================================

    const appId = env('ZALOPAY_APP_ID')
    const appUser = 'coolcare'
    const key = env('ZALOPAY_KEY1')

    const orderId = payment.provider_order_id

    const amount = String(
      Math.round(Number(payment.amount))
    )

    const payload = {
      app_id: Number(appId),
      app_user: appUser,
      app_time: Date.now(),
      amount: Number(amount),
      app_trans_id: orderId,
      embed_data: JSON.stringify({
        payment_id: payment.id,
        preferred_payment_method: ['zalopay_wallet']
      }),
      bank_code: '',
      item: '[]',
      description: `CoolCare ${payment.payment_code}`,
      callback_url: env('ZALOPAY_CALLBACK_URL')
    }

    payload.mac = mac(
      key,
      `${appId}|${orderId}|${appUser}|` +
      `${amount}|${payload.app_time}|` +
      `${payload.embed_data}|${payload.item}`
    )

    const response = await fetch(
      env('ZALOPAY_CREATE_URL'),
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(
          Object.entries(payload).map(
            ([k, v]) => [k, String(v)]
          )
        ),
        signal: AbortSignal.timeout(15000)
      }
    )

    const result = await response.json()

    // Clear reservation only for an explicit, unambiguous create rejection.
    // Network errors and unknown responses must retain provider_order_id.
    if (response.ok && Number(result.return_code) !== 1 &&
        Number(result.return_code) !== 2) {
      console.warn('[zalopay:create:rejected]', {
        httpStatus: response.status,
        returnCode: result.return_code,
        returnMessage: result.return_message
      })
      // Do not clear for unrecognized response codes; they may be ambiguous.
    }

    if (
      !response.ok ||
      Number(result.return_code) !== 1 ||
      !(typeof result.qr_code === 'string' && result.qr_code.trim()) &&
      !(typeof result.order_url === 'string' && result.order_url.trim()) &&
      !(typeof result.zp_trans_token === 'string' && result.zp_trans_token.trim())
    ) {
      error(
        'GATEWAY_CREATE_FAILED',
        result.return_message ||
          'ZaloPay did not return a usable payment response',
        502
      )
    }

    // Giữ transaction_reference để callback
    // và reconcile đối chiếu giao dịch.

    const gatewayQr = typeof result.qr_code === 'string' && result.qr_code.trim()
      ? result.qr_code.trim() : null

    const rawOrderUrl = typeof result.order_url === 'string'
      ? result.order_url.trim() : ''
    let hostedCheckout = null
    try {
      const u = new URL(rawOrderUrl)
      if (u.protocol === 'https:' && /(^|\.)zalopay\.vn$/i.test(u.hostname)) {
        hostedCheckout = u.toString()
      }
    } catch (_) { /* Ignore invalid URLs. */ }

    console.info('[zalopay:create]', {
      httpStatus: response.status,
      returnCode: result.return_code,
      returnMessage: result.return_message,
      hasNativeQr: Boolean(gatewayQr),
      hasHostedCheckout: Boolean(hostedCheckout),
      hasOrderUrl: Boolean(rawOrderUrl),
      orderUrlHost: (() => { try { return rawOrderUrl ? new URL(rawOrderUrl).hostname : null } catch { return null } })(),
      orderUrlPath: (() => { try { return rawOrderUrl ? new URL(rawOrderUrl).pathname : null } catch { return null } })(),
      hasAppToken: Boolean(result.zp_trans_token)
    })

    await withTransaction(async (db) => {
      const p = await attempt(db, payment.id)

      if (p.payment_status === 'PENDING') {
        await db.query(
          `UPDATE payments
           SET provider_order_id = $2,
               provider_token = $3,
               checkout_url = $4,
               qr_expires_at = NOW() + INTERVAL '15 minutes',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [p.id, orderId, result.zp_trans_token || null, gatewayQr || hostedCheckout]
        )
      }
    })

    return res.json({
      data: {
        paymentId: payment.id,
        provider: 'ZALOPAY',
        qrData: gatewayQr,
        url: hostedCheckout
      }
    })
  })
)

// =====================================================
// ZALOPAY RECONCILIATION
// =====================================================

router.post(
  '/:paymentId/reconcile-zalopay',
  authenticate,
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const id = validateUuid(req.params.paymentId)

    const p = await withTransaction(async (db) => {
      const row = await attempt(db, id)

      await assigned(
        db,
        req.auth.userId,
        row.booking_id
      )

      const m = (
        await db.query(
          `SELECT code
           FROM payment_methods
           WHERE id = $1`,
          [row.payment_method_id]
        )
      ).rows[0]

      if (
        m?.code !== 'ZALOPAY' ||
        !row.provider_order_id
      ) {
        error(
          'INVALID_ZALOPAY_PAYMENT',
          'No ZaloPay order to reconcile'
        )
      }

      return row
    })

    if (p.payment_status === 'SUCCESS') {
      return res.json({
        data: { status: 'SUCCESS' }
      })
    }

    if (p.payment_status !== 'PENDING') {
      return res.json({
        data: {
          status: p.payment_status
        }
      })
    }

    const appId = env('ZALOPAY_APP_ID')
    const orderId = p.provider_order_id
    const key = env('ZALOPAY_KEY1')

    const response = await fetch(
      env('ZALOPAY_QUERY_URL'),
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          app_id: appId,
          app_trans_id: orderId,
          mac: mac(
            key,
            `${appId}|${orderId}|${key}`
          )
        }),
        signal: AbortSignal.timeout(15000)
      }
    )

    if (!response.ok) {
      error(
        'GATEWAY_QUERY_FAILED',
        'ZaloPay status query failed',
        502
      )
    }

    const result = await response.json()

    const updated = await withTransaction(
      async (db) => {
        const current = await attempt(db, id)

        if (
          current.payment_status !== 'PENDING'
        ) {
          return current
        }

        if (
          Number(result.return_code) === 1 &&
          Number(result.amount) ===
            Number(current.amount)
        ) {
          return succeed(
            db,
            current,
            String(
              result.zp_trans_id || orderId
            )
          )
        }

        // Chỉ đóng giao dịch khi gateway xác nhận thất bại.

        if (Number(result.return_code) === 2) {
          return close(
            db,
            current,
            'FAILED',
            `zalopay:query:${orderId}:2`
          )
        }

        // Trạng thái chưa xác định giữ PENDING
        // để tránh nguy cơ thanh toán trùng.

        return current
      }
    )

    res.json({
      data: {
        status: updated.payment_status,
        providerReturnCode: result.return_code
      }
    })
  })
)

// =====================================================
// VNPAY BROWSER RETURN
// =====================================================

router.get(
  '/vnpay-return',
  asyncHandler(async (req, res) => {
    if (req.query.vnp_SecureHash) {
      try {
        await processVnpayNotification(req)
      } catch (err) {
        console.error(
          'VNPay return verification failed:',
          err
        )
      }
    }

    res.set('Cache-Control', 'no-store')

    const target = 'coolcare://payment-result'

    res.type('html').send(
      `<!doctype html>
       <html>
         <head>
           <meta name="viewport"
                 content="width=device-width,initial-scale=1">
         </head>
         <body>
           <p>Đang quay lại CoolCare...</p>
           <a href="${target}">Mở ứng dụng CoolCare</a>
           <script>
             window.location.replace('${target}')
           </script>
         </body>
       </html>`
    )
  })
)

// =====================================================
// VNPAY IPN / RETURN VERIFICATION
// =====================================================

async function processVnpayNotification(req) {
  const params = { ...req.query }

  const signature = params.vnp_SecureHash

  delete params.vnp_SecureHash
  delete params.vnp_SecureHashType

  // FIX: xác minh bằng cùng thuật toán HMAC-SHA512
  // đã sử dụng khi tạo URL thanh toán.

  if (
    !same(
      mac(
        env('VNPAY_HASH_SECRET'),
        vnpSign(params),
        'sha512'
      ),
      signature
    )
  ) {
    return '97'
  }

  let id

  try {
    id = validateUuid(
      String(params.vnp_TxnRef)
    )
  } catch {
    return '01'
  }

  const result = await withTransaction(
    async (db) => {
      const p = await attempt(db, id)

      const methodRow = (
        await db.query(
          `SELECT code
           FROM payment_methods
           WHERE id = $1`,
          [p.payment_method_id]
        )
      ).rows[0]

      if (
        methodRow?.code !== 'VNPAY' ||
        Number(params.vnp_Amount) !==
          Math.round(Number(p.amount) * 100)
      ) {
        return '04'
      }

      if (
        ['SUCCESS', 'FAILED', 'CANCELLED'].includes(
          p.payment_status
        )
      ) {
        return '02'
      }

      if (
        params.vnp_ResponseCode === '00' &&
        params.vnp_TransactionStatus === '00'
      ) {
        await succeed(
          db,
          p,
          String(
            params.vnp_TransactionNo ||
              params.vnp_TxnRef
          )
        )
      } else {
        await close(
          db,
          p,
          'FAILED',
          `vnpay:${params.vnp_TransactionNo || id}:` +
            params.vnp_ResponseCode
        )
      }

      return '00'
    }
  )

  return result
}

// =====================================================
// VNPAY IPN CALLBACK
// =====================================================

router.get(
  '/callbacks/vnpay',
  asyncHandler(async (req, res) => {
    const result = await processVnpayNotification(req)

    res.json({
      RspCode: result,
      Message:
        result === '00'
          ? 'Confirm Success'
          : result === '02'
            ? 'Order already confirmed'
            : 'Invalid payment'
    })
  })
)

// =====================================================
// ZALOPAY CALLBACK
// =====================================================

router.post(
  '/callbacks/zalopay',
  asyncHandler(async (req, res) => {
    const {
      data,
      mac: signature
    } = req.body || {}

    if (
      typeof data !== 'string' ||
      !same(
        mac(env('ZALOPAY_KEY2'), data),
        signature
      )
    ) {
      return res.json({
        return_code: -1,
        return_message: 'Invalid MAC'
      })
    }

    let parsed

    try {
      parsed = JSON.parse(data)
    } catch {
      return res.json({
        return_code: 0,
        return_message: 'Invalid data'
      })
    }

    let id

    try {
      id = validateUuid(
        JSON.parse(parsed.embed_data).payment_id
      )
    } catch {
      return res.json({
        return_code: 0,
        return_message: 'Invalid payment'
      })
    }

    const result = await withTransaction(
      async (db) => {
        const p = await attempt(db, id)

        const methodRow = (
          await db.query(
            `SELECT code
             FROM payment_methods
             WHERE id = $1`,
            [p.payment_method_id]
          )
        ).rows[0]

        if (
          methodRow?.code !== 'ZALOPAY' ||
          p.provider_order_id !==
            parsed.app_trans_id ||
          Number(p.amount) !==
            Number(parsed.amount) ||
          Number(env('ZALOPAY_APP_ID')) !==
            Number(parsed.app_id)
        ) {
          return false
        }

        if (p.payment_status === 'SUCCESS') {
          return true
        }

        if (
          ['FAILED', 'CANCELLED'].includes(
            p.payment_status
          )
        ) {
          return false
        }

        await succeed(
          db,
          p,
          String(
            parsed.zp_trans_id ||
              parsed.app_trans_id
          )
        )

        return true
      }
    )

    res.json({
      return_code: result ? 1 : 0,
      return_message: result
        ? 'success'
        : 'invalid payment'
    })
  })
)

// =====================================================
// EXPORT ROUTER
// =====================================================

export function createCustomerPaymentRouter() {
  return router
}
