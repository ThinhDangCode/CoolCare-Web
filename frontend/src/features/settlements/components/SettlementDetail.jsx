import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { Pagination, TableState } from '../../../shared/components/AdminUi.jsx'
import { getSettlement } from '../api/settlementsApi.js'
import {
  formatSettlementAmount,
  formatSettlementTime,
  settlementAmountTone,
  settlementErrorMessage,
  settlementSourceUrl,
  settlementTransactionTypes,
} from '../settlementPresentation.js'

export default function SettlementDetail({ id, code, token, onUnauthorized }) {
  const { t, locale } = useUiPreferences()
  const [pagination, setPagination] = useState({ page: 1, limit: 10 })
  const [refresh, setRefresh] = useState(0)
  const [response, setResponse] = useState({ key: '', data: null, error: '' })
  const requestKey = `${id}:${pagination.page}:${pagination.limit}:${refresh}:${token}`
  const loading = response.key !== requestKey
  const error = response.key === requestKey ? t(response.error) : ''
  const data = !loading && !error ? response.data : null
  const items = data?.transactions.items ?? []
  const hasWideAmounts = items.some((row) =>
    [row.amount, row.balanceBefore, row.balanceAfter].some(
      (value) => formatSettlementAmount(value, locale, true, false).length > 11
    )
  )
  const total = data?.transactions.pagination.total ?? 0
  const reload = () => setRefresh((value) => value + 1)
  useEffect(() => {
    const controller = new AbortController()
    getSettlement(id, pagination.page, pagination.limit, token, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        const lastPage = Math.max(1, result.transactions.pagination.totalPages)
        if (result.transactions.pagination.page > lastPage) {
          setPagination((current) => ({ ...current, page: lastPage }))
          return
        }
        setResponse({ key: requestKey, data: result, error: '' })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setResponse({ key: requestKey, data: null, error: settlementErrorMessage(err, true) })
        if (err.status === 401) onUnauthorized()
      })
    return () => controller.abort()
  }, [id, pagination.page, pagination.limit, requestKey, token, onUnauthorized])
  const number = (value) => value?.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US') ?? '—'
  const start = total ? (pagination.page - 1) * pagination.limit + 1 : 0
  const end = Math.min(pagination.page * pagination.limit, total)
  return (
    <section
      className="settlements-detail"
      id={`settlement-detail-${id}`}
      aria-label={`${t('Settlement details')}: ${code}`}
      aria-busy={loading}
    >
      <div className="settlements-detail-heading">
        <h2>
          {t('Settlement details')} · {code}
        </h2>
        <span>{t('Vietnam time (UTC+7)')}</span>
      </div>
      {data && (
        <>
          <div className="settlements-detail-metrics">
            <div>
              <span>{t('Technician income')}</span>
              <strong>{formatSettlementAmount(data.income.technicianEarning, locale)}</strong>
            </div>
            <div>
              <span>{t('Platform commission')}</span>
              <strong>{formatSettlementAmount(data.income.commissionAmount, locale)}</strong>
            </div>
            <div>
              <span>{t('Finalized at')}</span>
              <strong>{formatSettlementTime(data.finalizedAt)}</strong>
            </div>
            <div>
              <span>{t('Payment due')}</span>
              <strong>{formatSettlementTime(data.dueAt)}</strong>
            </div>
          </div>
          {data.status === 'OPEN' ? (
            <p className="settlements-detail-note">
              {t(
                'This period has not been finalized. Final balances and income are not yet available.'
              )}
            </p>
          ) : (
            <>
              <p className="settlements-detail-note">
                {t(
                  'Income and commission explain this period’s payments; do not add or subtract them again from the closing balance.'
                )}
              </p>
              <p className="settlements-detail-note">
                {t('Technician income includes recorded parts reimbursement; it is not profit.')}
              </p>
              {data.income.unavailablePaymentCount > 0 && (
                <p className="settlements-detail-note">
                  {t('Income is unavailable for {count} linked payments.', {
                    count: number(data.income.unavailablePaymentCount),
                  })}
                </p>
              )}
            </>
          )}
          <p className="settlements-detail-note">
            {t('Cleared means this period has no remaining technician debt.')}
          </p>
          <p className="settlements-detail-note">
            {t(
              'Closing balance is fixed when the period is finalized. Remaining debt reflects repayments recorded up to the latest refresh.'
            )}
          </p>
          <div className="settlements-detail-balance settlements-detail-adjustment">
            <span>{t('Adjustment')}</span>
            <strong className={`settlements-money ${settlementAmountTone(data.totals.adjustment)}`}>
              {formatSettlementAmount(data.totals.adjustment, locale, true)}
            </strong>
          </div>
          <div className="settlements-detail-balance">
            <span>
              {t('Opening balance')} + {t('Cash settlement')} + {t('Online earnings')} +{' '}
              {t('Top-up')} − {t('Withdrawal')} + {t('Adjustment')} = {t('Closing balance')}
            </span>
            <strong>{formatSettlementAmount(data.totals.closingBalance, locale)}</strong>
          </div>
        </>
      )}
      <div className="settlements-ledger-caption">
        <h3>{t('Settlement transactions')}</h3>
        <span>{t('Unit: VND')}</span>
      </div>
      <div className="settlements-ledger-scroll" data-wide-amounts={hasWideAmounts}>
        <table
          className="settlements-ledger"
          aria-label={t('Settlement transactions')}
          role="table"
        >
          <thead role="rowgroup">
            <tr role="row">
              {[
                'Date and time',
                'Transaction type',
                'Description',
                'Reference',
                'Amount',
                'Balance before',
                'Balance after',
              ].map((label) => (
                <th scope="col" key={label} role="columnheader">
                  {t(label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            <TableState
              loading={loading}
              error={error}
              empty={!items.length}
              colSpan={7}
              retry={reload}
            />
            {data &&
              items.map((row) => {
                const source = settlementSourceUrl(row.source)
                return (
                  <tr key={row.id} className="settlements-ledger-row" role="row">
                    <td data-label={t('Date and time')} role="cell">
                      <time dateTime={row.createdAt}>{formatSettlementTime(row.createdAt)}</time>
                    </td>
                    <td data-label={t('Transaction type')} role="cell">
                      {t(settlementTransactionTypes[row.type] ?? 'Other transaction')}
                    </td>
                    <td
                      className="settlements-transaction-description"
                      data-label={t('Description')}
                      role="cell"
                    >
                      {row.description || '—'}
                    </td>
                    <td
                      className="settlements-transaction-reference"
                      data-label={t('Reference')}
                      role="cell"
                    >
                      {source ? (
                        <Link to={source}>{row.source.code || row.source.id}</Link>
                      ) : (
                        row.source?.code || '—'
                      )}
                    </td>
                    <td
                      className={`settlements-money ${settlementAmountTone(row.amount)}`}
                      data-label={t('Amount')}
                      role="cell"
                    >
                      {formatSettlementAmount(row.amount, locale, true, false)}
                    </td>
                    <td className="settlements-money" data-label={t('Balance before')} role="cell">
                      {formatSettlementAmount(row.balanceBefore, locale, false, false)}
                    </td>
                    <td className="settlements-money" data-label={t('Balance after')} role="cell">
                      {formatSettlementAmount(row.balanceAfter, locale, false, false)}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
      <div className="settlements-detail-footer">
        <div className="settlements-page-summary">
          <span aria-live="polite">
            {loading
              ? t('Loading…')
              : error
                ? t('Unable to load settlement details')
                : t('Showing {start}–{end} of {total} transactions', {
                    start: number(start),
                    end: number(end),
                    total: number(total),
                  })}
          </span>
          <label className="settlements-select settlements-page-size">
            <select
              aria-label={t('Transactions per page')}
              value={pagination.limit}
              onChange={(event) => setPagination({ page: 1, limit: Number(event.target.value) })}
            >
              {[10, 25, 50].map((limit) => (
                <option key={limit} value={limit}>
                  {t('{count} / page', { count: limit })}
                </option>
              ))}
            </select>
            <img src="/settlements/chevron-down.svg" width="21" height="21" alt="" />
          </label>
        </div>
        <Pagination
          page={pagination.page}
          total={total}
          limit={pagination.limit}
          loading={loading || Boolean(error)}
          onPage={(page) => setPagination((current) => ({ ...current, page }))}
        />
      </div>
      {data && (
        <p className="settlements-read-at">
          {t('Last checked')}: {formatSettlementTime(data.readAt)}
        </p>
      )}
    </section>
  )
}
