import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../../shared/context/AuthContext.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { ArrowLeftIcon, CalendarIcon, PageHeader, UserIcon } from '../../../shared/components/AdminUi.jsx'
import '../../../shared/styles/admin.css'
import { getTopup } from '../api/topupsApi.js'
import { readTopupFilters, writeTopupFilters } from '../topupFilters.js'
import {
  formatTopupAmount,
  formatTopupTime,
  validTopupId,
  topupMethodName,
  topupReference,
  topupStatuses,
  topupText,
} from '../topupPresentation.js'
import './topups.css'
import './topupDetail.css'

function Fact({ label, value, className = '' }) {
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export default function TopupDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const { token, clearSession } = useAuth()
  const { t } = useUiPreferences()
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '', status: null })
  const validId = validTopupId(id)
  const requestKey = `${id}:${refresh}:${token}`
  const loading = validId && response.key !== requestKey
  const topup = validId && response.key === requestKey && !response.error ? response.data : null
  const error = !validId
    ? t('The top-up ID is invalid.')
    : response.key === requestKey
      ? response.error
      : ''
  const errorTitle =
    !validId || [400, 422].includes(response.status)
      ? t('Invalid top-up ID')
      : response.status === 404
        ? t('Top-up not found')
        : t('Unable to load top-up')
  const query = writeTopupFilters(readTopupFilters(new URLSearchParams(location.search))).toString()
  const backUrl = `/admin/topups${query ? `?${query}` : ''}`
  const reload = () => setRefresh((value) => value + 1)

  useEffect(() => {
    if (!validId) return
    const controller = new AbortController()
    getTopup(id, token, controller.signal)
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
    <main className="topups-page topup-detail-page">
      <PageHeader title="Top-up Detail" subtitle="Top-ups" onRefresh={reload} refreshing={loading || !validId} />
      <section className="topup-detail-content" aria-busy={loading}>
        <div className="topup-detail-heading">
          <Link to={backUrl} className="topup-detail-back">
            <ArrowLeftIcon /> {t('Back to Top-up History')}
          </Link>
          <div>
            {topup && (
              <>
                <code>{topupReference(topup)}</code>
                <span className={`topups-status status-${topup.status.toLowerCase()}`}>
                  {t(topupStatuses[topup.status] ?? topup.status)}
                </span>
              </>
            )}
          </div>
        </div>
        {loading && (
          <div className="topup-detail-state" role="status">
            <i className="figma-spinner" />
            {t('Loading top-up…')}
          </div>
        )}
        {!loading && error && (
          <div className="topup-detail-state error" role="alert">
            <h2>{errorTitle}</h2>
            <p>{error}</p>
            {validId && response.status !== 404 && ![400, 422].includes(response.status) && (
              <button type="button" onClick={reload}>
                {t('Try again')}
              </button>
            )}
          </div>
        )}
        {topup && (
          <>
            <div className="topup-detail-grid">
              <div className="topup-detail-column">
                <section className="topup-detail-card">
                  <h2>{t('Top-up Information')}</h2>
                  <div className="topup-detail-amount">
                    <span>{t('TOP-UP AMOUNT')}</span>
                    <strong>{formatTopupAmount(topup.amount)}</strong>
                  </div>
                  <dl className="topup-detail-fields">
                    <Fact label={t('Payment method')} value={topupMethodName(topup.method)} />
                    <Fact label={t('Method code')} value={topupText(topup.method?.code)} />
                    <Fact
                      label={t('Transaction reference')}
                      value={topupText(topup.transactionReference)}
                      className="full-width"
                    />
                    <Fact label={t('Top-up code')} value={topupText(topup.topupCode)} />
                    <Fact
                      label={t('Top-up ID')}
                      value={<code>{topup.id}</code>}
                      className="full-width"
                    />
                    <Fact
                      label={t('Closure reference')}
                      value={topupText(topup.closureReference)}
                      className="full-width"
                    />
                  </dl>
                </section>
              </div>
              <div className="topup-detail-column">
                <section className="topup-detail-card">
                  <h2>
                    <UserIcon /> {t('Technician')}
                  </h2>
                  <dl className="topup-detail-fields single-column">
                    <Fact label={t('Name')} value={topupText(topup.technician.name)} />
                    <Fact label={t('Phone')} value={topupText(topup.technician.phone)} />
                    <Fact
                      label={t('Technician ID')}
                      value={<code>{topupText(topup.technician.id)}</code>}
                    />
                  </dl>
                </section>
                <section className="topup-detail-card">
                  <h2>
                    <CalendarIcon /> {t('Timeline')}
                  </h2>
                  <p className="topup-detail-help">{t('Vietnam time (UTC+7)')}</p>
                  <dl className="topup-detail-fields single-column">
                    <Fact label={t('Created at')} value={formatTopupTime(topup.createdAt)} />
                    <Fact label={t('Paid at')} value={formatTopupTime(topup.paidAt)} />
                    <Fact label={t('Settled at')} value={formatTopupTime(topup.settledAt)} />
                    <Fact
                      label={t('Closure verified at')}
                      value={formatTopupTime(topup.closureVerifiedAt)}
                    />
                  </dl>
                </section>
              </div>
            </div>
            <section className="topup-detail-card topup-detail-ledger">
              <h2>{t('Linked Wallet Transaction')}</h2>
              {topup.ledger ? (
                <dl className="topup-detail-fields ledger-fields">
                  <Fact label={t('Wallet amount')} value={formatTopupAmount(topup.ledger.amount)} />
                  <Fact
                    label={t('Balance before')}
                    value={formatTopupAmount(topup.ledger.balanceBefore)}
                  />
                  <Fact
                    label={t('Balance after')}
                    value={formatTopupAmount(topup.ledger.balanceAfter)}
                  />
                  <Fact label={t('Type')} value={topupText(topup.ledger.type)} />
                  <Fact label={t('Posted at (UTC+7)')} value={formatTopupTime(topup.ledger.createdAt)} />
                  <Fact label={t('Ledger ID')} value={<code>{topup.ledger.id}</code>} />
                  <Fact
                    label={t('Reference ID')}
                    value={<code>{topupText(topup.ledger.referenceId)}</code>}
                    className="full-width"
                  />
                </dl>
              ) : (
                <p className="topup-detail-help">
                  {t('No linked wallet transaction is recorded for this top-up.')}
                </p>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  )
}
