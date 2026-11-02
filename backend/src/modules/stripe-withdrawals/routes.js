import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { pool, withTransaction } from '../../config/database.js'
import { authenticate, requireRole } from '../../middleware/authenticate.js'
import { TechnicianWalletRepository } from '../technician-wallet/wallet.repository.js'
import { AppError } from '../../utils.js'
import { stripe, verifyStripeWebhook } from './stripe.js'
import { ensureAccount, accountState } from './account-registry.js'

const router = Router()
const wallet = new TechnicianWalletRepository()
const error = (res, code, message, status = 400) => res.status(status).json({ error: { code, message } })
// database.js translates smallint withdrawal statuses to enum names on reads.
const WITHDRAWAL_STATUS = { PENDING: 0, PROCESSING: 1, SUCCESS: 2, FAILED: 3, CANCELLED: 4 }
const withdrawalStatusCode = value => {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase()
    if (Object.hasOwn(WITHDRAWAL_STATUS, normalized)) return WITHDRAWAL_STATUS[normalized]
    if (/^[0-4]$/.test(normalized)) return Number(normalized)
  }
  throw new Error(`Unexpected withdrawal status: ${JSON.stringify(value)}`)
}
const fx = () => {
  const rate = Number(process.env.STRIPE_FX_VND_PER_USD || 25000)
  if (!Number.isSafeInteger(rate) || rate < 1000) throw new Error('Invalid STRIPE_FX_VND_PER_USD')
  return rate
}
// withdrawals.account_number must match ^[0-9]{6,20}$; the real destination is Stripe.
const PLACEHOLDER_ACCOUNT_NUMBER = '000000000000'
const TRANSFER_NOTE = /Stripe transfer (tr_[A-Za-z0-9]+)/
const isDefinitiveStripeFailure = e =>
  e?.stripeStatus >= 400 && e.stripeStatus < 500 &&
  e.stripeStatus !== 429 && e.stripeStatus !== 409 &&
  e.stripeCode !== 'idempotency_key_in_use'

async function saveNote(withdrawalId, text) {
  await pool.query('UPDATE withdrawals SET note=$2 WHERE id=$1 AND status IN (0, 1)', [withdrawalId, text.slice(0, 500)])
}

// A rejected transfer moved no funds. The existing DB trigger releases the reservation.
async function failWithdrawal(withdrawalId, message) {
  await withTransaction(async db => {
    const q = await db.query('SELECT status FROM withdrawals WHERE id=$1 FOR UPDATE', [withdrawalId])
    if (withdrawalStatusCode(q.rows[0]?.status) !== 1) return
    await db.query(`UPDATE withdrawals
      SET status=3, failure_reason=$2, note=$3,
          processed_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status=1`,
      [withdrawalId, String(message).slice(0, 500), 'Stripe Sandbox transfer rejected; reservation released'])
  })
}

// Transfer is the final step: the technician receives test funds in their connected Stripe account.
// The existing SUCCESS trigger posts the wallet debit once.
async function completeWithdrawal(withdrawalId, transferId) {
  return withTransaction(async db => {
    const q = await db.query('SELECT status FROM withdrawals WHERE id=$1 FOR UPDATE', [withdrawalId])
    const status = withdrawalStatusCode(q.rows[0]?.status)
    if (status === 2) return
    if (status !== 1) throw new Error(`Cannot complete withdrawal ${withdrawalId} in status ${status}`)
    await db.query(`UPDATE withdrawals
      SET status=2, fee_amount=0, payout_reference=$2,
          paid_at=CURRENT_TIMESTAMP,
          processed_at=COALESCE(processed_at,CURRENT_TIMESTAMP),
          note=$3
      WHERE id=$1 AND status=1`,
      [withdrawalId, transferId, `Stripe transfer ${transferId}; completed in test connected account`])
  })
}

async function runStripeSteps(w, account, cents) {
  let transferId = TRANSFER_NOTE.exec(w.note || '')?.[1]
  if (!transferId) {
    let transfer
    try {
      transfer = await stripe('transfers', {
        amount: String(cents), currency: 'usd', destination: account, transfer_group: w.id,
        'metadata[withdrawal_id]': w.id, 'metadata[technician_id]': w.technician_id,
      }, { idempotencyKey: `coolcare-transfer-${w.id}` })
    } catch (e) {
      if (isDefinitiveStripeFailure(e)) {
        // Do not report FAILED unless the database has actually released the reservation.
        await failWithdrawal(w.id, e.message)
        return { failed: true }
      }
      console.error('Stripe transfer outcome uncertain; retry with the same idempotency key', {
        withdrawalId: w.id, stripeCode: e.stripeCode, message: e.message,
      })
      return { reconciliationRequired: true }
    }
    if (!transfer?.id || transfer.destination !== account || Number(transfer.amount) !== cents) {
      console.error('Unexpected Stripe transfer response; manual reconciliation required', { withdrawalId: w.id })
      return { reconciliationRequired: true }
    }
    transferId = transfer.id
  } else {
    // A previous request transferred funds but did not finish updating PostgreSQL.
    // Verify the transfer before marking the withdrawal successful.
    try {
      const existing = await stripe(`transfers/${encodeURIComponent(transferId)}`, null, { method: 'GET' })
      if (existing.destination !== account || Number(existing.amount) !== cents ||
          existing.metadata?.withdrawal_id !== w.id) {
        console.error('Stripe transfer reconciliation mismatch', { withdrawalId: w.id, transferId })
        return { reconciliationRequired: true }
      }
    } catch (e) {
      console.error('Stripe transfer verification failed', { withdrawalId: w.id, transferId, message: e.message })
      return { reconciliationRequired: true }
    }
  }
  // If the DB write fails, retrying with the same key will not send a second transfer.
  try {
    await completeWithdrawal(w.id, transferId)
  } catch (e) {
    console.error('Stripe transfer succeeded but DB completion needs retry', { withdrawalId: w.id, transferId, message: e.message })
    await saveNote(w.id, `Stripe transfer ${transferId}; needs DB reconciliation`).catch(() => {})
    return { reconciliationRequired: true }
  }
  return { success: true, transferId }
}

// Stripe requires a contact email on the recipient account; use the technician's login email.
async function accountFor(owner) {
  const q = await pool.query(
    `SELECT u.email FROM technician_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.id = $1`,
    [owner.technician_id])
  return ensureAccount(owner.technician_id, q.rows[0]?.email)
}

// The shared errorHandler only understands AppError; anything else becomes a generic 500.
function mapError(e) {
  if (e instanceof AppError || e?.stripeStatus === undefined) return e
  if (/losses collector/i.test(e.message))
    return new AppError(503, 'STRIPE_PLATFORM_SETUP_REQUIRED',
      'Stripe platform setup incomplete: accept loss liability in Dashboard > Connect > Platform profile.')
  return new AppError(502, 'STRIPE_ERROR', `Stripe error: ${e.message}`)
}

const validKey = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)

router.use(authenticate, requireRole('CUSTOMER')) // Preserve existing CoolCare technician auth role.

router.get('/account', async (req, res, next) => {
  try {
    const owner = await wallet.owner(req.auth.userId)
    const id = await accountFor(owner)
    const state = await accountState(id)
    res.json({ data: { connected: true, ready: state.ready, payoutsEnabled: state.ready, transfersActive: state.transfersActive } })
  } catch (e) { next(mapError(e)) }
})

router.post('/account', async (req, res, next) => {
  try {
    const owner = await wallet.owner(req.auth.userId)
    const id = await accountFor(owner)
    const state = await accountState(id)
    if (state.ready) return res.json({ data: { ready: true } })
    const base = process.env.STRIPE_ONBOARDING_RETURN_URL
    if (!base || !/^https:\/\//.test(base)) return error(res, 'ONBOARDING_URL_REQUIRED', 'Configure STRIPE_ONBOARDING_RETURN_URL', 503)
    const link = await stripe('account_links', { account: id, type: 'account_onboarding', refresh_url: base, return_url: base })
    res.json({ data: { ready: false, url: link.url } })
  } catch (e) { next(mapError(e)) }
})

router.post('/withdraw', async (req, res, next) => {
  try {
    const { amount, idempotencyKey: key } = req.body || {}
    if (!Number.isSafeInteger(amount) || amount < 100000 || amount > 50000000 || !validKey(key))
      return error(res, 'INVALID_INPUT', 'Invalid amount or request key', 422)
    const cents = Math.round(amount / fx() * 100)
    if (cents < 50) return error(res, 'AMOUNT_TOO_SMALL', 'Amount is too small', 422)
    const owner = await wallet.owner(req.auth.userId)
    const account = await accountFor(owner)
    const state = await accountState(account)
    if (!state.ready) return error(res, 'ONBOARDING_REQUIRED', 'Vui lòng hoàn tất thông tin nhận tiền thử nghiệm trước khi rút.', 409)

    const reserved = await withTransaction(async db => {
      const current = await wallet.owner(req.auth.userId, db)
      await db.query('SELECT id FROM technician_accounts WHERE id=$1 FOR UPDATE', [current.account_id])
      const prior = await db.query('SELECT * FROM withdrawals WHERE idempotency_key=$1', [key])
      if (prior.rows.length) {
        const w = prior.rows[0]
        if (w.technician_id !== current.technician_id || Number(w.amount) !== amount)
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Withdrawal request key already used')
        return { w, existing: true }
      }
      const b = await db.query('SELECT available_balance FROM technician_account_balances WHERE technician_account_id=$1', [current.account_id])
      if (Number(b.rows[0]?.available_balance || 0) < amount)
        throw new AppError(409, 'INSUFFICIENT_BALANCE', 'Insufficient wallet balance')
      const id = randomUUID()
      // The lifecycle trigger requires INSERT as PENDING, then PENDING -> PROCESSING.
      await db.query(`INSERT INTO withdrawals
        (id,idempotency_key,technician_id,technician_account_id,amount,bank_name,account_number,account_holder,initiated_at,note)
        VALUES ($1,$2,$3,$4,$5,'Stripe Sandbox',$6,'Stripe Sandbox KTV',CURRENT_TIMESTAMP,$7)`,
        [id, key, current.technician_id, current.account_id, amount, PLACEHOLDER_ACCOUNT_NUMBER,
          `Stripe Sandbox transfer ${cents} USD cents at ${fx()} VND/USD`])
      const q = await db.query('UPDATE withdrawals SET status=1 WHERE id=$1 RETURNING *', [id])
      return { w: q.rows[0], existing: false }
    })
    const w = reserved.w
    const status = withdrawalStatusCode(w.status)
    if (status === 2) return res.json({ data: { id: w.id, amount: Number(w.amount), status: 'SUCCESS' } })
    if (status === 3 || status === 4)
      return error(res, 'WITHDRAWAL_ALREADY_FAILED', 'This withdrawal failed. Start a new withdrawal request.', 409)

    // Also resumes an existing PROCESSING withdrawal that stopped midway (same key).
    const result = await runStripeSteps(w, account, cents)
    if (result.failed) return error(res, 'STRIPE_TRANSFER_FAILED', 'Không thể rút tiền vì số dư thử nghiệm của CoolCare chưa đủ. Số tiền trong ví KTV đã được hoàn lại.', 409)
    if (result.success) return res.json({ data: { id: w.id, amount: Number(w.amount), status: 'SUCCESS', transferId: result.transferId } })
    res.status(202).json({ data: { id: w.id, amount: Number(w.amount), status: 'PROCESSING', reconciliationRequired: true } })
  } catch (e) { next(mapError(e)) }
})

export const stripeWithdrawalRouter = router

// The new sandbox withdrawal flow does not create payouts.
// Keep this endpoint for Stripe's configured webhook; acknowledge legacy payout events
// without changing the wallet, which is now finalized on successful transfer.
export async function stripeWebhook(req, res) {
  try { verifyStripeWebhook(req.body, req.headers['stripe-signature']) }
  catch { return res.status(400).send('Invalid signature') }
  return res.json({ received: true })
}
