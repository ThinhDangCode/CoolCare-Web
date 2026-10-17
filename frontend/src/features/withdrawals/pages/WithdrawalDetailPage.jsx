import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { ArrowLeftIcon, CalendarIcon, UserIcon } from '../../../shared/components/AdminUi.jsx'
import { getWithdrawal } from '../api/withdrawalsApi.js'
import { readWithdrawalFilters, writeWithdrawalFilters } from '../withdrawalFilters.js'
import {
  formatWithdrawalAmount,
  formatWithdrawalTime,
  validWithdrawalId,
  withdrawalReference,
  withdrawalStatuses,
  withdrawalText,
} from '../withdrawalPresentation.js'
import './withdrawals.css'
import './withdrawalDetail.css'

function Fact({ label, value, className = '' }) {
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export default function WithdrawalDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const { token, clearSession } = useAuth()
  const { t } = useUiPreferences()
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '', status: null })
  const validId = validWithdrawalId(id)
  const requestKey = `${id}:${refresh}:${token}`
  const loading = validId && response.key !== requestKey
  const withdrawal =
    validId && response.key === requestKey && !response.error ? response.data : null
  const error = !validId
    ? t('The withdrawal ID is invalid.')
    : response.key === requestKey
      ? response.error
      : ''
  const errorTitle =
    !validId || [400, 422].includes(response.status)
      ? t('Invalid withdrawal ID')
      : response.status === 404
        ? t('Withdrawal not found')
        : t('Unable to load withdrawal')
  const query = writeWithdrawalFilters(
    readWithdrawalFilters(new URLSearchParams(location.search))
  ).toString()
  const backUrl = `/admin/withdrawals${query ? `?${query}` : ''}`
  const reload = () => setRefresh((value) => value + 1)

  useEffect(() => {
    if (!validId) return
    const controller = new AbortController()
    getWithdrawal(id, token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setResponse({ key: requestKey, data: result, error: '', status: null })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({ key: requestKey, data: null, error: err.message, status: err.status })
        if (err.status === 401) clearSession()
      })
    return () => controller.abort()
  }, [id, validId, requestKey, token, clearSession])

  return (
    <main className="withdrawals-page withdrawal-detail-page">
      <header className="withdrawal-detail-topbar">
        <nav aria-label={t('Withdrawal breadcrumb')}>
          <span>{t('Finance')}</span>
          <span aria-hidden="true">/</span>
          <span>{t('Wallet')}</span>
          <span aria-hidden="true">/</span>
          <Link to={backUrl}>{t('Withdrawals')}</Link>
          <span aria-hidden="true">/</span>
          <strong>{t('Detail')}</strong>
        </nav>
        <button type="button" disabled={loading || !validId} onClick={reload}>
          ↻ {t('Refresh')}
        </button>
      </header>
      <section className="withdrawal-detail-content" aria-busy={loading}>
        <div className="withdrawal-detail-heading">
          <Link to={backUrl} className="withdrawal-detail-back">
            <ArrowLeftIcon /> {t('Back to Withdrawal History')}
          </Link>
          <div>
            <h1>{t('Withdrawal Detail')}</h1>
            {withdrawal && (
              <>
                <code>{withdrawalReference(withdrawal)}</code>
                <span className={`withdrawals-status status-${withdrawal.status.toLowerCase()}`}>
                  {t(withdrawalStatuses[withdrawal.status] ?? withdrawal.status)}
                </span>
              </>
            )}
          </div>
        </div>
        {loading && (
          <div className="withdrawal-detail-state" role="status">
            <i className="figma-spinner" />
            {t('Loading withdrawal…')}
          </div>
        )}
        {!loading && error && (
          <div className="withdrawal-detail-state error" role="alert">
            <h2>{errorTitle}</h2>
            <p>{error}</p>
            {validId && response.status !== 404 && ![400, 422].includes(response.status) && (
              <button type="button" onClick={reload}>
                {t('Try again')}
              </button>
            )}
          </div>
        )}
        {withdrawal && (
          <>
            <div className="withdrawal-detail-grid">
              <div className="withdrawal-detail-column">
                <section className="withdrawal-detail-card">
                  <h2>{t('Withdrawal Information')}</h2>
                  <div className="withdrawal-detail-amount">
                    <span>{t('REQUESTED AMOUNT')}</span>
                    <strong>{formatWithdrawalAmount(withdrawal.amount)}</strong>
                    <small>{t('Includes the provider fee')}</small>
                  </div>
                  <dl className="withdrawal-detail-fields">
                    <Fact
                      label={t('Provider fee (included)')}
                      value={formatWithdrawalAmount(withdrawal.feeAmount)}
                    />
                    <Fact
                      label={t('Net bank payout')}
                      value={formatWithdrawalAmount(withdrawal.netAmount)}
                    />
                    <Fact
                      label={t('Payout reference')}
                      value={withdrawalText(withdrawal.payoutReference)}
                      className="full-width"
                    />
                    <Fact
                      label={t('Withdrawal ID')}
                      value={<code>{withdrawal.id}</code>}
                      className="full-width"
                    />
                  </dl>
                </section>
                <section className="withdrawal-detail-card">
                  <h2>{t('Bank Destination')}</h2>
                  <dl className="withdrawal-detail-fields">
                    <Fact label={t('Bank')} value={withdrawalText(withdrawal.bank.name)} />
                    <Fact
                      label={t('Account holder')}
                      value={withdrawalText(withdrawal.bank.accountHolder)}
                    />
                    <Fact
                      label={t('Account number')}
                      value={<code>{withdrawalText(withdrawal.bank.accountNumber)}</code>}
                      className="full-width"
                    />
                  </dl>
                </section>
                <section className="withdrawal-detail-card">
                  <h2>{t('Transaction Notes')}</h2>
                  <dl className="withdrawal-detail-fields">
                    <Fact
                      label={t('Failure reason')}
                      value={withdrawalText(withdrawal.failureReason)}
                      className="full-width"
                    />
                    <Fact
                      label={t('Note')}
                      value={withdrawalText(withdrawal.note)}
                      className="full-width"
                    />
                  </dl>
                </section>
              </div>
              <div className="withdrawal-detail-column">
                <section className="withdrawal-detail-card">
                  <h2>
                    <UserIcon /> {t('Technician')}
                  </h2>
                  <dl className="withdrawal-detail-fields single-column">
                    <Fact label={t('Name')} value={withdrawalText(withdrawal.technician.name)} />
                    <Fact label={t('Phone')} value={withdrawalText(withdrawal.technician.phone)} />
                    <Fact
                      label={t('Technician ID')}
                      value={<code>{withdrawalText(withdrawal.technician.id)}</code>}
                    />
                  </dl>
                </section>
                <section className="withdrawal-detail-card">
                  <h2>
                    <CalendarIcon /> {t('Timeline')}
                  </h2>
                  <p className="withdrawal-detail-help">{t('Vietnam time (UTC+7)')}</p>
                  <dl className="withdrawal-detail-fields single-column">
                    <Fact
                      label={t('Initiated at')}
                      value={formatWithdrawalTime(withdrawal.initiatedAt)}
                    />
                    <Fact
                      label={t('Processed at')}
                      value={formatWithdrawalTime(withdrawal.processedAt)}
                    />
                    <Fact label={t('Paid at')} value={formatWithdrawalTime(withdrawal.paidAt)} />
                  </dl>
                </section>
              </div>
            </div>
            <section className="withdrawal-detail-card withdrawal-detail-ledger">
              <h2>{t('Linked Wallet Transaction')}</h2>
              {withdrawal.ledger ? (
                <>
                  <dl className="withdrawal-detail-fields ledger-fields">
                    <Fact
                      label={t('Wallet amount')}
                      value={formatWithdrawalAmount(withdrawal.ledger.amount)}
                    />
                    <Fact
                      label={t('Balance before')}
                      value={formatWithdrawalAmount(withdrawal.ledger.balanceBefore)}
                    />
                    <Fact
                      label={t('Balance after')}
                      value={formatWithdrawalAmount(withdrawal.ledger.balanceAfter)}
                    />
                    <Fact label={t('Type')} value={withdrawalText(withdrawal.ledger.type)} />
                    <Fact
                      label={t('Posted at (UTC+7)')}
                      value={formatWithdrawalTime(withdrawal.ledger.createdAt)}
                    />
                    <Fact label={t('Ledger ID')} value={<code>{withdrawal.ledger.id}</code>} />
                    <Fact
                      label={t('Reference ID')}
                      value={<code>{withdrawalText(withdrawal.ledger.referenceId)}</code>}
                      className="full-width"
                    />
                  </dl>
                </>
              ) : (
                <p className="withdrawal-detail-help">
                  {t('No linked wallet transaction is recorded for this withdrawal.')}
                </p>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  )
}
