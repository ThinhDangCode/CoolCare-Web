import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

// VNPay API 2.1.0 querydr. Never treat a timeout, unsigned reply or an
// ambiguous status as permission to collect the same payment a second time.
const vnClock = value => new Date(new Date(value).getTime() + 7 * 3600000)
  .toISOString().replace(/[-:T]/g, '').slice(0, 14)
const sign = (secret, value) => createHmac('sha512', secret).update(value).digest('hex')
const equal = (left, right) => typeof left === 'string' && /^[a-f0-9]{128}$/i.test(left) &&
  timingSafeEqual(Buffer.from(left.toLowerCase()), Buffer.from(right.toLowerCase()))

export function verifyVnpayQueryResponse(result, { txnRef, amount, orderInfo, tmnCode, secret, expired = false }) {
  if (!result || String(result.vnp_TxnRef) !== String(txnRef) ||
      String(result.vnp_TmnCode) !== tmnCode ||
      Number(result.vnp_Amount) !== Math.round(Number(amount) * 100) ||
      String(result.vnp_OrderInfo) !== orderInfo) return null
  const fields = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message',
    'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate',
    'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus',
    'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount']
  const checksum = sign(secret, fields.map(field => String(result[field] ?? '')).join('|'))
  if (!equal(result.vnp_SecureHash, checksum)) return null
  if (result.vnp_Command !== 'querydr') return { status: 'UNKNOWN' }
  // 91 is VNPay's signed 'transaction not found' response. After the QR
  // expiry this is evidence that no successful gateway charge exists.
  if (result.vnp_ResponseCode === '91' && expired) return {
    status: 'FAILED', reference: `vnpay:query:${txnRef}:91`,
  }
  if (result.vnp_ResponseCode !== '00') return { status: 'UNKNOWN' }
  if (result.vnp_TransactionStatus === '00' && result.vnp_TransactionNo) {
    return { status: 'SUCCESS', reference: String(result.vnp_TransactionNo) }
  }
  // 02 is the documented failed-transaction state. 01/05/etc are not
  // definitive proof of non-payment; keep them open for reconciliation.
  if (result.vnp_TransactionStatus === '02') return {
    status: 'FAILED', reference: `vnpay:query:${txnRef}:02`,
  }
  return { status: 'UNKNOWN' }
}

export async function queryVnpay({ txnRef, amount, orderInfo, createdAt, transactionDate, expired = false }) {
  // The uploaded project uses the official VNPay Sandbox checkout host.
  // Production/custom hosts must explicitly configure VNPAY_QUERY_URL.
  let url = process.env.VNPAY_QUERY_URL?.trim()
  if (!url && process.env.VNPAY_PAY_URL) {
    try {
      if (new URL(process.env.VNPAY_PAY_URL).hostname === 'sandbox.vnpayment.vn') {
        url = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'
      }
    } catch { /* invalid checkout configuration */ }
  }
  const tmnCode = process.env.VNPAY_TMN_CODE
  const secret = process.env.VNPAY_HASH_SECRET
  if (!url || !tmnCode || !secret) return { status: 'UNKNOWN' }
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:') throw new Error('VNPAY_QUERY_URL must use HTTPS')
  const fields = {
    vnp_RequestId: randomUUID().replaceAll('-', ''), vnp_Version: '2.1.0',
    vnp_Command: 'querydr', vnp_TmnCode: tmnCode, vnp_TxnRef: txnRef,
    vnp_OrderInfo: orderInfo, vnp_TransactionDate: transactionDate ?? vnClock(createdAt),
    vnp_CreateDate: vnClock(new Date()), vnp_IpAddr: '127.0.0.1',
  }
  const data = ['vnp_RequestId', 'vnp_Version', 'vnp_Command', 'vnp_TmnCode',
    'vnp_TxnRef', 'vnp_TransactionDate', 'vnp_CreateDate', 'vnp_IpAddr', 'vnp_OrderInfo']
    .map(key => fields[key]).join('|')
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fields, vnp_SecureHash: sign(secret, data) }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`VNPay querydr HTTP ${response.status}`)
  return verifyVnpayQueryResponse(await response.json(), {
    txnRef, amount, orderInfo, tmnCode, secret, expired,
  }) ?? { status: 'UNKNOWN' }
}
