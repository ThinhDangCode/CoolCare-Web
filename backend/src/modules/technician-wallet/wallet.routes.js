
import { Router } from 'express'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { asyncHandler, validateUuid } from '../../utils.js'
import { TechnicianWalletRepository } from './wallet.repository.js'
import {
  hmac,
  secureSame,
  vnpSign,
  vnClock,
  zaloOrderId,
  zaloCallbackId,
  validatedTopup,
  requireGateway,
  safeHttps,
  walletError,
} from './wallet.domain.js'

// Wallet callbacks use their own endpoints, not customer payment endpoints.
// Prefer explicit wallet URLs; otherwise reuse the configured public origin.
const walletCallbackUrl = (walletKey, existingKey, path) => {
  const explicit = process.env[walletKey]?.trim()
  if (explicit) return safeHttps(explicit)

  const existing = requireGateway(existingKey)
  const url = new URL(safeHttps(existing))
  url.pathname = path
  url.search = ''
  url.hash = ''

  return url.toString()
}

const vnpayReturnUrl = () =>
  walletCallbackUrl(
    'TOPUP_VNPAY_RETURN_URL',
    'VNPAY_RETURN_URL',
    '/api/technician-wallet/callbacks/vnpay',
  )

const zalopayCallbackUrl = () =>
  walletCallbackUrl(
    'TOPUP_ZALOPAY_CALLBACK_URL',
    'ZALOPAY_CALLBACK_URL',
    '/api/technician-wallet/callbacks/zalopay',
  )

const gatewayLog = (stage, details) => {
  console.error(`[TechnicianWallet ${stage}]`, details)
}

const zaloCheckoutUrl = value => {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  try {
    const url = new URL(value.trim())

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password
    ) {
      return null
    }

    // Additional gateway checkout hosts can be configured
    // through ZALOPAY_CHECKOUT_HOSTS.
    const allowed = (
      process.env.ZALOPAY_CHECKOUT_HOSTS ||
      'zalopay.vn;zalopay.com.vn'
    )
      .split(/[;,]/)
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)

    const hostname = url.hostname.toLowerCase()

    const trusted = allowed.some(
      host =>
        hostname === host ||
        hostname.endsWith(`.${host}`),
    )

    if (!trusted) {
      gatewayLog('ZALOPAY_URL_REJECTED', {
        hostname,
      })
      return null
    }

    return url.toString()
  } catch {
    return null
  }
}

const getPage = query => {
  const page = Number(query.page ?? 1)
  const limit = Number(query.limit ?? 20)

  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    walletError(
      'INVALID_PAGINATION',
      'Page and limit are invalid.',
      422,
    )
  }

  return { page, limit }
}

const checkoutResponse = (topup, checkout = null) => ({
  topupId: topup.id,
  topupCode: topup.topup_code,
  amount: topup.amount,
  method: topup.method,
  status: topup.payment_status,
  ...(checkout ? { checkout } : {}),
})

// Verify an existing ZaloPay order without creating a duplicate charge.
async function queryZaloPayTopup(topup, repository) {
  if (topup.method !== 'ZALOPAY' || !['PENDING', 'PROCESSING'].includes(topup.payment_status)) return topup
  const appId = requireGateway('ZALOPAY_APP_ID')
  const key1 = requireGateway('ZALOPAY_KEY1')
  const orderId = zaloOrderId(topup)
  const payload = {
    app_id: appId,
    app_trans_id: orderId,
    mac: hmac(key1, `${appId}|${orderId}|${key1}`),
  }
  try {
    const response = await fetch(safeHttps(requireGateway('ZALOPAY_QUERY_URL')), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`ZaloPay query HTTP ${response.status}`)
    const result = await response.json()
    console.info('[TechnicianWallet ZALOPAY_QUERY]', {
      topupId: topup.id,
      returnCode: result.return_code,
      returnMessage: result.return_message,
      hasTransactionId: Boolean(result.zp_trans_id),
    })
    if (Number(result.return_code) === 1 && result.zp_trans_id) {
      await repository.settle(topup.id, 'ZALOPAY', String(result.zp_trans_id))
    }
  } catch (error) {
    console.error('[TechnicianWallet ZALOPAY_QUERY_ERROR]', {
      topupId: topup.id, message: error.message,
    })
  }
  return repository.getById(topup.id)
}

export function createTechnicianWalletRouter(
  repository = new TechnicianWalletRepository(),
) {
  const router = Router()

  router.use(authenticate, requireRole('CUSTOMER'))

  router.get(
    '/overview',
    asyncHandler(async (req, res) => {
      const data = await repository.overview(req.auth.userId)

      res
        .set('Cache-Control', 'no-store')
        .json({ data })
    }),
  )

  router.get(
    '/transactions',
    asyncHandler(async (req, res) => {
      const { page, limit } = getPage(req.query)

      const data = await repository.transactions(
        req.auth.userId,
        page,
        limit,
      )

      res
        .set('Cache-Control', 'no-store')
        .json({ data })
    }),
  )

  router.get(
    '/topups',
    asyncHandler(async (req, res) => {
      const { page, limit } = getPage(req.query)

      const data = await repository.topups(
        req.auth.userId,
        page,
        limit,
      )

      res
        .set('Cache-Control', 'no-store')
        .json({ data })
    }),
  )

  router.get(
    '/topups/:id',
    asyncHandler(async (req, res) => {
      let topup = await repository.getOwned(
        req.auth.userId,
        req.params.id,
      )

      if (topup.method === 'ZALOPAY' &&
          ['PENDING', 'PROCESSING'].includes(topup.payment_status)) {
        topup = await queryZaloPayTopup(topup, repository)
      }

      res
        .set('Cache-Control', 'no-store')
        .json({
          data: checkoutResponse(topup),
        })
    }),
  )

  router.post(
    '/topups',
    asyncHandler(async (req, res) => {
      const input = validatedTopup(req.body)

      // Validate gateway configuration before creating a top-up.
      if (input.method === 'VNPAY') {
        for (const key of [
          'VNPAY_TMN_CODE',
          'VNPAY_HASH_SECRET',
          'VNPAY_PAY_URL',
        ]) {
          requireGateway(key)
        }

        vnpayReturnUrl()
      } else {
        for (const key of [
          'ZALOPAY_APP_ID',
          'ZALOPAY_KEY1',
          'ZALOPAY_CREATE_URL',
        ]) {
          requireGateway(key)
        }

        zalopayCallbackUrl()
      }

      const row = await repository.create(
        req.auth.userId,
        input,
      )

      if (row.payment_status === 'SUCCESS') {
        return res.json({
          data: checkoutResponse(row),
        })
      }

      if (
        row.payment_status === 'FAILED' ||
        row.payment_status === 'CANCELLED'
      ) {
        walletError(
          'TOPUP_CLOSED',
          'This top-up is closed. Create a new request.',
          409,
        )
      }

      // VNPay checkout
      if (input.method === 'VNPAY') {
        const data = {
          vnp_Version: '2.1.0',
          vnp_Command: 'pay',
          vnp_TmnCode: requireGateway('VNPAY_TMN_CODE'),
          vnp_Amount: String(input.amount * 100),
          vnp_CurrCode: 'VND',
          vnp_TxnRef: row.id,
          vnp_OrderInfo: `CoolCare Topup ${row.topup_code}`,
          vnp_OrderType: 'other',
          vnp_Locale: 'vn',
          vnp_ReturnUrl: vnpayReturnUrl(),
          vnp_IpAddr: req.ip || '127.0.0.1',
          vnp_CreateDate: vnClock(
            new Date(row.created_at),
          ),
          vnp_ExpireDate: vnClock(
            new Date(
              new Date(row.created_at).getTime() +
                15 * 60000,
            ),
          ),
        }

        const qs = vnpSign(data)

        const url =
          `${safeHttps(requireGateway('VNPAY_PAY_URL'))}` +
          `?${qs}` +
          `&vnp_SecureHash=${hmac(
            requireGateway('VNPAY_HASH_SECRET'),
            qs,
            'sha512',
          )}`

        return res.status(201).json({
          data: checkoutResponse(row, {
            url,
            qrData: url,
            expiresInSeconds: 900,
          }),
        })
      }

      // ZaloPay checkout
      // A stable order ID is derived from the top-up UUID.
      // Never generate a second order for an uncertain payment.
      if (row.payment_status !== 'PENDING') {
        walletError(
          'TOPUP_PROCESSING',
          'Payment initiation was already attempted. Check its status or reconcile before retry.',
          409,
        )
      }

      const locked = await repository.markProcessing(
        row.id,
      )

      if (!locked) {
        walletError(
          'TOPUP_PROCESSING',
          'Another request already initiated this payment.',
          409,
        )
      }

      const order = zaloOrderId(row)
      const appId = requireGateway('ZALOPAY_APP_ID')
      const appTime = Date.now()

      const embed = JSON.stringify({
        topup_id: row.id,
        kind: 'TECHNICIAN_TOPUP',
        preferred_payment_method: ['zalopay_wallet'],
      })

      const requestData = {
        app_id: Number(appId),
        app_user: 'coolcare_topup',
        app_time: appTime,
        amount: Number(row.amount),
        app_trans_id: order,
        embed_data: embed,
        bank_code: '',
        item: '[]',
        description: `CoolCare Topup ${row.topup_code}`,
        callback_url: zalopayCallbackUrl(),
      }

      const macData = [
  requestData.app_id,
  requestData.app_trans_id,
  requestData.app_user,
  requestData.amount,
  requestData.app_time,
  requestData.embed_data,
  requestData.item,
].join('|')

requestData.mac = hmac(
  requireGateway('ZALOPAY_KEY1'),
  macData,
)

      let gateway

      try {
        const response = await fetch(
          safeHttps(
            requireGateway('ZALOPAY_CREATE_URL'),
          ),
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(
              Object.entries(requestData).map(
                ([key, value]) => [
                  key,
                  String(value),
                ],
              ),
            ),
            signal: AbortSignal.timeout(15000),
          },
        )

        gateway = await response.json()

        gatewayLog('ZALOPAY_CREATE', {
          httpStatus: response.status,
          returnCode: gateway?.return_code,
          returnMessage: gateway?.return_message,
          subReturnCode: gateway?.sub_return_code,
          subReturnMessage:
            gateway?.sub_return_message,
          hasQrCode: Boolean(gateway?.qr_code),
          hasOrderUrl: Boolean(gateway?.order_url),
        })

        if (
          !response.ok ||
          Number(gateway?.return_code) !== 1
        ) {
          // A rejected or uncertain response is not proof
          // that the order can never be paid.
          // Keep it PROCESSING for safe reconciliation.
          return res.status(202).json({
            data: checkoutResponse({
              ...row,
              payment_status: 'PROCESSING',
            }),
          })
        }
      } catch (error) {
        gatewayLog('ZALOPAY_CREATE_ERROR', {
          message:
            error?.message || 'Unknown error',
        })

        return res.status(202).json({
          data: checkoutResponse({
            ...row,
            payment_status: 'PROCESSING',
          }),
        })
      }

      const qr =
        typeof gateway.qr_code === 'string' &&
        gateway.qr_code.trim()
          ? gateway.qr_code.trim()
          : null

      const url = zaloCheckoutUrl(
        gateway.order_url,
      )

      if (!qr && !url) {
        gatewayLog('ZALOPAY_NO_CHECKOUT', {
          returnCode: gateway?.return_code,
          hasQrCode: Boolean(gateway?.qr_code),
          hasOrderUrl: Boolean(gateway?.order_url),
        })

        return res.status(202).json({
          data: checkoutResponse({
            ...row,
            payment_status: 'PROCESSING',
          }),
        })
      }

      return res.status(201).json({
        data: checkoutResponse(
          {
            ...row,
            payment_status: 'PROCESSING',
          },
          {
            qrData: qr ?? url,
            url,
            expiresInSeconds: 900,
          },
        ),
      })
    }),
  )

  router.post(
    '/topups/:id/reconcile',
    asyncHandler(async (req, res) => {
      const topup = await repository.getOwned(
        req.auth.userId,
        req.params.id,
      )

      if (
        topup.method !== 'ZALOPAY' ||
        !['PENDING', 'PROCESSING'].includes(
          topup.payment_status,
        )
      ) {
        return res.json({
          data: checkoutResponse(topup),
        })
      }

      const appId = requireGateway(
        'ZALOPAY_APP_ID',
      )

      const order = zaloOrderId(topup)

      const payload = {
        app_id: appId,
        app_trans_id: order,
        mac: hmac(
          requireGateway('ZALOPAY_KEY1'),
          `${appId}|${order}|${requireGateway(
            'ZALOPAY_KEY1',
          )}`,
        ),
      }

      let result

      try {
        const response = await fetch(
          safeHttps(
            requireGateway('ZALOPAY_QUERY_URL'),
          ),
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(
              payload,
            ),
            signal: AbortSignal.timeout(12000),
          },
        )

        if (!response.ok) {
          throw new Error(
            'Gateway status query error',
          )
        }

        result = await response.json()
      } catch {
        walletError(
          'GATEWAY_STATUS_UNKNOWN',
          'Cannot verify payment yet. It remains pending.',
          503,
        )
      }

      if (
        Number(result.return_code) === 1 &&
        result.zp_trans_id
      ) {
        await repository.settle(
          topup.id,
          'ZALOPAY',
          String(result.zp_trans_id),
        )
      }

      const current = await repository.getOwned(
        req.auth.userId,
        topup.id,
      )

      return res
        .set('Cache-Control', 'no-store')
        .json({
          data: checkoutResponse(current),
        })
    }),
  )

  return router
}

export function createTechnicianWalletCallbackRouter(
  repository = new TechnicianWalletRepository(),
) {
  const router = Router()

  // VNPay callback
  router.get(
    ['/vnpay', '/vnpay-ipn'],
    asyncHandler(async (req, res) => {
      const params = { ...req.query }
      const signature = params.vnp_SecureHash

      delete params.vnp_SecureHash
      delete params.vnp_SecureHashType

      if (
        !secureSame(
          signature,
          hmac(
            requireGateway('VNPAY_HASH_SECRET'),
            vnpSign(params),
            'sha512',
          ),
        )
      ) {
        return res.json({
          RspCode: '97',
          Message: 'Invalid checksum',
        })
      }

      let id

      try {
        id = validateUuid(
          String(params.vnp_TxnRef),
        )
      } catch {
        return res.json({
          RspCode: '01',
          Message: 'Invalid order',
        })
      }

      const row = await repository.getById(id)

      if (!row) {
        return res.json({
          RspCode: '01',
          Message: 'Unknown order',
        })
      }

      if (
        row.method !== 'VNPAY' ||
        String(params.vnp_TmnCode) !==
          requireGateway('VNPAY_TMN_CODE') ||
        (params.vnp_CurrCode != null &&
          String(params.vnp_CurrCode) !== 'VND') ||
        Number(params.vnp_Amount) !==
          Math.round(Number(row.amount) * 100)
      ) {
        return res.json({
          RspCode: '04',
          Message: 'Invalid amount or merchant',
        })
      }

      if (row.payment_status === 'SUCCESS') {
        return res.json({
          RspCode: '02',
          Message: 'Already confirmed',
        })
      }

      if (
        ['FAILED', 'CANCELLED'].includes(
          row.payment_status,
        )
      ) {
        return res.json({
          RspCode: '02',
          Message: 'Already closed',
        })
      }

      const success =
        params.vnp_ResponseCode === '00' &&
        params.vnp_TransactionStatus === '00'

      if (
        success &&
        params.vnp_TransactionNo
      ) {
        await repository.settle(
          id,
          'VNPAY',
          String(params.vnp_TransactionNo),
        )

        return res.json({
          RspCode: '00',
          Message: 'Confirm success',
        })
      }

      // Close only definitively unsuccessful signed results.
      if (
        params.vnp_ResponseCode !== '00' &&
        params.vnp_TransactionStatus !== '00'
      ) {
        await repository.failVerified(
          id,
          'VNPAY',
          `vnpay:${params.vnp_TransactionNo || id}:` +
            `${params.vnp_ResponseCode}`,
        )

        return res.json({
          RspCode: '00',
          Message: 'Verified failed payment',
        })
      }

      return res.json({
        RspCode: '99',
        Message:
          'Ambiguous payment; retry verification',
      })
    }),
  )

  // ZaloPay callback
  router.post(
    '/zalopay',
    asyncHandler(async (req, res) => {
      const {
        data,
        mac: signature,
      } = req.body || {}

      if (
        typeof data !== 'string' ||
        !secureSame(
          signature,
          hmac(
            requireGateway('ZALOPAY_KEY2'),
            data,
          ),
        )
      ) {
        return res.json({
          return_code: -1,
          return_message: 'Invalid MAC',
        })
      }

      let parsed

      try {
        parsed = JSON.parse(data)
      } catch {
        return res.json({
          return_code: 0,
          return_message: 'Invalid payload',
        })
      }

      const id = zaloCallbackId(
        parsed.app_trans_id,
      )

      if (!id) {
        return res.json({
          return_code: 0,
          return_message: 'Invalid order',
        })
      }

      const row = await repository.getById(id)

      if (
        !row ||
        row.method !== 'ZALOPAY' ||
        parsed.app_trans_id !==
          zaloOrderId(row) ||
        Number(parsed.app_id) !==
          Number(
            requireGateway('ZALOPAY_APP_ID'),
          ) ||
        Number(parsed.amount) !==
          Number(row.amount)
      ) {
        return res.json({
          return_code: 0,
          return_message:
            'Invalid order ownership, merchant or amount',
        })
      }

      let embedded

      try {
        embedded = JSON.parse(
          parsed.embed_data,
        )
      } catch {
        embedded = {}
      }

      if (
        embedded.topup_id !== id ||
        embedded.kind !==
          'TECHNICIAN_TOPUP' ||
        !parsed.zp_trans_id
      ) {
        return res.json({
          return_code: 0,
          return_message:
            'Invalid top-up metadata',
        })
      }

      const success = await repository.settle(
        id,
        'ZALOPAY',
        String(parsed.zp_trans_id),
      )

      return res.json({
        return_code: success ? 1 : 0,
        return_message: success
          ? 'success'
          : 'invalid status',
      })
    }),
  )

  return router
}
