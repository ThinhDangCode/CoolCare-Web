import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext.jsx'
import {
  ArrowLeftIcon,
  ClockIcon,
  UserIcon,
} from '../../management/components/ManagementShared.jsx'
import { getWithdrawal } from '../api/settlementApi.js'
import './withdrawals.css'
import './withdrawalDetail.css'

const labels = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  SUCCESS: 'Success',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}
const currency = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const money = (value) =>
  value === null || value === undefined ? 'Not determined' : `${currency.format(Number(value))} ₫`
const date = (value) =>
  value
    ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })
    : '—'

function Field({ label, children, emphasis = false }) {
  return (
    <div className={`withdrawal-field ${emphasis ? 'emphasis' : ''}`}>
      <dt>{label}</dt>
      <dd>{children ?? '—'}</dd>
    </div>
  )
}

function DetailCard({ title, icon, children, className = '' }) {
  return (
    <section className={`withdrawal-detail-card ${className}`}>
      <h2>
        {icon}
        {title}
      </h2>
      {children}
    </section>
  )
}

export function WithdrawalDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const { token, logout, user } = useAuth()
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '', status: null })
  const key = `${id}:${token}:${refresh}`
  const loading = response.key !== key
  const { data, error, status } = response
  const backState = { withdrawalListState: location.state?.withdrawalListState }
  const initials = (user?.fullName || 'Admin')
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')

  useEffect(() => {
    const controller = new AbortController()
    getWithdrawal(id, token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setResponse({ key, data: result, error: '', status: null })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({ key, data: null, error: err.message, status: err.status })
        if (err.status === 401) logout()
      })
    return () => controller.abort()
  }, [id, token, key, logout])

  const milestones = data
    ? [
        { label: 'Request created', at: data.initiated_at },
        { label: 'Processing started', at: data.processed_at },
        { label: 'Payout completed', at: data.paid_at },
      ].filter((item) => item.at)
    : []

  return (
    <main className="withdrawals-page withdrawal-detail-page">
      <header className="withdrawals-topbar">
        <p>
          Finance <span>/</span>{' '}
          <Link to="/admin/settlement/withdrawals" state={backState}>
            Technician Wallet
          </Link>{' '}
          <span>/</span> <strong>Detail</strong>
        </p>
        <div>
          <button
            type="button"
            className="withdrawals-refresh"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
            aria-label="Refresh withdrawal detail"
          >
            ↻ Refresh
          </button>
          <Link className="withdrawals-avatar" to="/profile" aria-label="Open profile">
            {initials}
          </Link>
        </div>
      </header>
      <section className="withdrawals-content">
        <Link className="withdrawal-back" to="/admin/settlement/withdrawals" state={backState}>
          <ArrowLeftIcon /> Back to withdrawal requests
        </Link>
        <div className="withdrawal-detail-heading">
          <div>
            <h1>Withdrawal Request Detail</h1>
            <p className="withdrawal-full-id">{id}</p>
          </div>
          {!loading && data && (
            <span className={`withdrawals-status status-${data.status.toLowerCase()}`}>
              {labels[data.status]}
            </span>
          )}
        </div>
        {loading ? (
          <div className="withdrawal-detail-state" role="status">
            <i className="figma-spinner" />
            Loading request details…
          </div>
        ) : error ? (
          <div className="withdrawal-detail-state" role="alert">
            <h2>{status === 404 ? 'Withdrawal request not found' : 'Unable to load request'}</h2>
            <p>{error}</p>
            {status !== 404 && status !== 422 && (
              <button type="button" onClick={() => setRefresh((value) => value + 1)}>
                Try again
              </button>
            )}
          </div>
        ) : (
          data && (
            <div className="withdrawal-detail-grid">
              <DetailCard title="Technician" icon={<UserIcon />}>
                <dl>
                  <Field label="Full name">{data.technician_name}</Field>
                  <Field label="Email">{data.technician_email}</Field>
                  <Field label="Phone">{data.technician_phone}</Field>
                  <Field label="Technician ID">
                    <span className="withdrawal-full-id">{data.technician_id}</span>
                  </Field>
                </dl>
              </DetailCard>
              <DetailCard title="Withdrawal amount">
                <dl>
                  <Field label="Requested amount">{money(data.amount)}</Field>
                  <Field label="Fee">{money(data.fee_amount)}</Field>
                  <Field label="Net payout" emphasis>
                    {money(data.net_amount)}
                  </Field>
                </dl>
                {data.fee_amount === null && (
                  <p className="withdrawal-card-note">
                    The fee and net payout have not been determined.
                  </p>
                )}
              </DetailCard>
              <DetailCard title="Bank details">
                <dl>
                  <Field label="Bank name">{data.bank_name}</Field>
                  <Field label="Account number">{data.account_number}</Field>
                  <Field label="Account holder">{data.account_holder}</Field>
                </dl>
              </DetailCard>
              <DetailCard title="Account balance">
                <dl>
                  <Field label="Current settlement balance">
                    {money(data.current_settlement_balance)}
                  </Field>
                  <Field label="Reserved for active requests">{money(data.reserved_amount)}</Field>
                  <Field label="Available balance" emphasis>
                    {money(data.available_balance)}
                  </Field>
                </dl>
                <p className="withdrawal-card-note">
                  Current balance includes all activity. Pending and processing requests reserve
                  funds until they finish.
                </p>
                {data.read_at && (
                  <p className="withdrawal-balance-time">
                    As of {date(data.read_at)} (Vietnam time)
                  </p>
                )}
              </DetailCard>
              <DetailCard
                title="Processing milestones"
                icon={<ClockIcon />}
                className="withdrawal-wide-card"
              >
                <ol className="withdrawal-timeline">
                  {milestones.map((item) => (
                    <li key={item.label}>
                      <span className="withdrawal-timeline-dot" />
                      <strong>{item.label}</strong>
                      <time dateTime={item.at}>{date(item.at)}</time>
                    </li>
                  ))}
                </ol>
                <dl>
                  <Field label="Payout reference">{data.payout_reference || 'Not recorded'}</Field>
                  {data.failure_reason && (
                    <Field label="Failure reason">{data.failure_reason}</Field>
                  )}
                  <Field label="Notes">{data.note || 'No notes'}</Field>
                </dl>
              </DetailCard>
              <DetailCard title="Payout record" className="withdrawal-wide-card">
                {data.settlement_transactions?.length ? (
                  data.settlement_transactions.map((transaction) => (
                    <dl className="withdrawal-ledger" key={transaction.id}>
                      <Field label="Transaction ID">
                        <span className="withdrawal-full-id">{transaction.id}</span>
                      </Field>
                      <Field label="Recorded at">{date(transaction.created_at)}</Field>
                      <Field label="Balance change">{money(transaction.amount)}</Field>
                      <Field label="Balance before payout">
                        {money(transaction.balance_before)}
                      </Field>
                      <Field label="Balance after payout">{money(transaction.balance_after)}</Field>
                    </dl>
                  ))
                ) : (
                  <p className="withdrawal-card-note">
                    No payout transaction has been recorded for this request.
                  </p>
                )}
              </DetailCard>
            </div>
          )
        )}
      </section>
    </main>
  )
}
