import { useEffect, useState } from 'react'
import { Pagination, TableState } from '../../../shared/components/AdminUi.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { CustomerIcon } from '../../customer-statistics/components/CustomerUi.jsx'
import {
  reportCount,
  reportMoney,
  reportPercent,
  reportTimestamp,
} from '../../reports/reportPresentation.js'
import {
  technicianDecimal,
  technicianInitials,
  technicianPageSizes,
} from '../technicianPresentation.js'
import { TechnicianAreasChart, TechnicianTrend } from './TechnicianCharts.jsx'
import { TechnicianHeading, TechnicianKpi } from './TechnicianUi.jsx'

function TechnicianOverview({ data }) {
  const { t, locale } = useUiPreferences()
  const s = data.summary
  const states = [
    { label: 'Active Technicians', count: s.activeTechnicians, color: 'var(--orange)' },
    { label: 'Inactive Technicians', count: s.inactiveTechnicians, color: '#64748b' },
    { label: 'Locked Technicians', count: s.lockedTechnicians, color: '#ef4444' },
  ]
  return (
    <>
      <div className="tech-kpis">
        <TechnicianKpi
          title="Total Technicians"
          value={reportCount(s.totalTechnicians, locale)}
          note="All current technician profiles, including applications"
          icon="total"
        />
        <TechnicianKpi
          title="Active Technicians"
          value={reportCount(s.activeTechnicians, locale)}
          note="Active account and enabled technician profile"
          icon="active"
          tone="green"
        />
        <TechnicianKpi
          title="Verified Technicians"
          value={reportCount(s.verifiedTechnicians, locale)}
          note="Profiles with VERIFIED verification status"
          icon="verified"
          tone="amber"
        />
        <TechnicianKpi
          title="Locked Technicians"
          value={reportCount(s.lockedTechnicians, locale)}
          note="Current accounts with LOCKED status"
          icon="locked"
          tone="red"
        />
      </div>
      <section className="tech-card tech-status-card">
        <TechnicianHeading
          title="Technician Status Overview"
          description="Current account and profile states. This is a snapshot, not a history of online availability."
        />
        <div className="tech-status-list">
          {states.map((row) => (
            <div className="tech-status-row" key={row.label}>
              <div>
                <span>
                  <i style={{ backgroundColor: row.color }} />
                  {t(row.label)}
                </span>
                <strong>
                  {reportCount(row.count, locale)}{' '}
                  <small>
                    {reportPercent(
                      s.totalTechnicians ? (row.count * 100) / s.totalTechnicians : null,
                      locale
                    )}
                  </small>
                </strong>
              </div>
              <div className="tech-status-track">
                <span
                  style={{
                    width: `${s.totalTechnicians ? (row.count * 100) / s.totalTechnicians : 0}%`,
                    backgroundColor: row.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="tech-summary-strip">
          <span>
            {t('Pending verification')}
            <strong>{reportCount(s.pendingVerification, locale)}</strong>
          </span>
          <span>
            {t('Rejected applications')}
            <strong>{reportCount(s.rejectedVerification, locale)}</strong>
          </span>
        </div>
        <p className="tech-note">
          {t(
            'Verified is a separate qualification and can overlap with account states. Technicians can also be customers. Current profile totals are not filtered by the report period.'
          )}
        </p>
      </section>
    </>
  )
}

function TechnicianIncome({ data }) {
  const { t, locale } = useUiPreferences()
  const income = data.income
  return (
    <>
      <div className="tech-kpis">
        <TechnicianKpi
          title="Total Technician Earnings"
          value={reportMoney(income.amount, locale)}
          note="Successful payments settled in the selected period"
          icon="income-total"
        >
          {income.missingPayments > 0 && (
            <small className="tech-money-partial">
              {t('Known portion: {amount}', { amount: reportMoney(income.knownAmount, locale) })}
            </small>
          )}
        </TechnicianKpi>
        <TechnicianKpi
          title="Average Earnings per Technician"
          value={reportMoney(income.averageAmount, locale)}
          note="Average over technicians with settled payments"
          icon="income-average"
          tone="purple"
        />
        <TechnicianKpi
          title="Top Technician Earnings"
          value={reportMoney(income.topTechnician?.amount, locale)}
          icon="income-top"
          tone="orange"
        >
          <p>{income.topTechnician?.name || '—'}</p>
        </TechnicianKpi>
        <TechnicianKpi
          title="Completed Settled Bookings"
          value={reportCount(income.completedJobs, locale)}
          note="Distinct completed bookings represented by settled payments"
          icon="income-jobs"
        />
      </div>
      <p className="tech-inline-note">
        {t(
          'Technician entitlement includes parts reimbursement where applicable. It is not profit, platform commission, a wallet top-up, or a withdrawal.'
        )}
      </p>
      <TechnicianTrend mode="income" rows={income.trend} period={data.period} />
      <p className="tech-inline-note">
        {t('{payments} settled payments across {technicians} technicians.', {
          payments: reportCount(income.settledPayments, locale),
          technicians: reportCount(income.earningTechnicians, locale),
        })}{' '}
        {income.missingPayments > 0 &&
          t(
            '{count} payment snapshots have unavailable earnings. Totals and rankings remain unavailable until the snapshots are complete.',
            { count: reportCount(income.missingPayments, locale) }
          )}
      </p>
    </>
  )
}

function TechnicianAreas({ data }) {
  const { locale } = useUiPreferences()
  const areas = data.areas
  return (
    <>
      <div className="tech-kpis">
        <TechnicianKpi
          title="Total Service Areas"
          value={reportCount(areas.areaCount, locale)}
          note="Distinct registered city and ward combinations"
          icon="areas-total"
        />
        <TechnicianKpi
          title="Total Technicians"
          value={reportCount(areas.totalTechnicians, locale)}
          note="Current technician profile snapshot"
          icon="areas-technicians"
        />
        <TechnicianKpi
          title="Highest Coverage Area"
          value={areas.topArea?.ward || '—'}
          icon="areas-top"
          tone="orange"
        >
          <p>{areas.topArea?.city || '—'}</p>
        </TechnicianKpi>
        <TechnicianKpi
          title="Average Technicians per Area"
          value={technicianDecimal(areas.averageTechniciansPerArea, locale)}
          note="Coverage assignments divided by valid areas"
          icon="areas-average"
          tone="purple"
        />
      </div>
      <TechnicianAreasChart areas={areas} />
    </>
  )
}

function TechnicianPerformance({ data }) {
  const { t, locale } = useUiPreferences()
  const a = data.activity
  const counts = [
    ['Accepted Requests', a.acceptedRequests],
    ['Declined Requests', a.declinedRequests],
    ['Cancelled by Technician', a.technicianCancelledRequests],
    ['Other Assignment Cancellations', a.otherCancelledRequests],
    ['Pending Requests', a.pendingRequests],
    ['Expired Requests', a.expiredRequests],
  ]
  return (
    <>
      <div className="tech-kpis">
        <TechnicianKpi
          title="Total Assignment Requests"
          value={reportCount(a.totalRequests, locale)}
          note="Actual requests sent in the selected period"
          icon="service-requests"
        />
        <TechnicianKpi
          title="Completed Assignments"
          value={reportCount(a.completedRequests, locale)}
          note="Completed outcomes of the selected request cohort"
          icon="service-completed"
          tone="green"
        />
        <TechnicianKpi
          title="Request Completion Rate"
          value={reportPercent(a.completionPercent, locale)}
          note="Completed assignments divided by actual requests"
          icon="service-rate"
          tone="orange"
        />
        <TechnicianKpi
          title="Average Customer Rating"
          value={
            a.averageRating === null ? '—' : `${technicianDecimal(a.averageRating, locale)} / 5`
          }
          note="Published reviews created in the selected period"
          icon="service-rating"
          tone="amber"
        />
      </div>
      <section className="tech-card">
        <div className="tech-summary-strip tech-activity-counts">
          {counts.map(([label, count]) => (
            <span key={label}>
              {t(label)}
              <strong>{reportCount(count, locale)}</strong>
            </span>
          ))}
        </div>
        <p className="tech-note">
          {t(
            'Requests are counted once per booking and technician, using the latest assignment. Recommendations are excluded. Accepted requests include completed assignments and evidenced prior acceptances, so these figures overlap.'
          )}
        </p>
        <p className="tech-note">
          {t(
            'Customer or administrator cancellations are not counted as cancellations by a technician. Published reviews are counted individually, not averaged from profile averages.'
          )}{' '}
          {t('{count} published reviews.', { count: reportCount(a.reviewCount, locale) })}
        </p>
      </section>
      <TechnicianTrend mode="services" rows={a.trend} period={data.period} />
    </>
  )
}

function TechnicianIssues({ data }) {
  const { t, locale } = useUiPreferences()
  const i = data.issues
  return (
    <>
      <div className="tech-kpis">
        <TechnicianKpi
          title="Total Issue Records"
          value={reportCount(i.totalIssues, locale)}
          note="Complaint records plus penalty records"
          icon="issues-total"
          tone="red"
        />
        <TechnicianKpi
          title="Technician Complaints"
          value={reportCount(i.complaints, locale)}
          note="Complaints explicitly linked to a technician"
          icon="issues-complaints"
          tone="orange"
        />
        <TechnicianKpi
          title="Penalties Applied"
          value={reportCount(i.penalties, locale)}
          note="Penalty records applied in the selected period"
          icon="issues-penalties"
          tone="red"
        />
        <TechnicianKpi
          title="Pending Complaints"
          value={reportCount(i.openComplaints, locale)}
          note="Current OPEN or IN_PROGRESS complaint status"
          icon="issues-open"
          tone="amber"
        />
      </div>
      <TechnicianTrend mode="issues" rows={i.trend} period={data.period} />
      <section className="tech-card">
        <div className="tech-summary-strip">
          <span>
            {t('Resolved complaints')}
            <strong>{reportCount(i.resolvedComplaints, locale)}</strong>
          </span>
          <span>
            {t('Closed complaints')}
            <strong>{reportCount(i.closedComplaints, locale)}</strong>
          </span>
          <span>
            {t('Rejected complaints')}
            <strong>{reportCount(i.rejectedComplaints, locale)}</strong>
          </span>
          <span>
            {t('Technicians with issue records')}
            <strong>{reportCount(i.affectedTechnicians, locale)}</strong>
          </span>
        </div>
        <p className="tech-note">
          {t(
            'A complaint and its resulting penalty are separate records and may describe the same incident. These counts do not establish technician fault or unique incident totals.'
          )}
        </p>
      </section>
    </>
  )
}

function LockedTechnicians({ data, filters, onSearch, onPage, onLimit, loading, error, retry }) {
  const { t, locale } = useUiPreferences()
  const [input, setInput] = useState({ source: filters.search, draft: filters.search })
  const search = input.source === filters.search ? input.draft : filters.search
  const summary = data?.summary
  const locked = data?.locked ?? { items: [], total: 0, page: filters.page, limit: filters.limit }
  useEffect(() => {
    const normalized = search.trim()
    if (normalized === filters.search) return
    const timer = setTimeout(() => onSearch(normalized), 300)
    return () => clearTimeout(timer)
  }, [search, filters.search, onSearch])
  const verification = { VERIFIED: 'Verified', PENDING: 'Pending', REJECTED: 'Rejected' }
  return (
    <>
      <div className="tech-kpis">
        <TechnicianKpi
          title="Locked Technicians"
          value={reportCount(summary?.lockedTechnicians, locale)}
          note="Current accounts with LOCKED status"
          icon="locked-account"
          tone="red"
        />
        <TechnicianKpi
          title="Active Technicians"
          value={reportCount(summary?.activeTechnicians, locale)}
          note="Active account and enabled technician profile"
          icon="active"
          tone="green"
        />
        <TechnicianKpi
          title="Inactive Technicians"
          value={reportCount(summary?.inactiveTechnicians, locale)}
          note="Non-locked accounts or profiles not enabled for work"
          icon="total"
        />
        <TechnicianKpi
          title="Verified Technicians"
          value={reportCount(summary?.verifiedTechnicians, locale)}
          note="Profiles with VERIFIED verification status"
          icon="verified"
          tone="amber"
        />
      </div>
      <section
        className="tech-card tech-locked-card"
        aria-label={t('Locked technician accounts')}
        aria-busy={loading}
      >
        <TechnicianHeading
          title="Locked Technician Accounts"
          description="Current locked accounts. The selected report period does not filter this list."
        />
        <div className="tech-locked-toolbar">
          <label className="tech-search">
            <CustomerIcon name="search" />
            <input
              type="search"
              value={search}
              maxLength={150}
              aria-label={t('Search locked technicians')}
              placeholder={t('Search by name, email, phone...')}
              onChange={(event) =>
                setInput({ source: filters.search, draft: event.currentTarget.value })
              }
            />
          </label>
          <span aria-live="polite">
            {loading
              ? t('Loading data…')
              : data
                ? t('{count} matching accounts', { count: reportCount(locked.total, locale) })
                : '—'}
          </span>
        </div>
        <div className="tech-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('Technician')}</th>
                <th scope="col">{t('Email')}</th>
                <th scope="col">{t('Phone')}</th>
                <th scope="col">{t('Account status')}</th>
                <th scope="col">{t('Verification')}</th>
                <th scope="col">{t('Profile registration date')}</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !error && locked.items.length ? (
                locked.items.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <span className="tech-person">
                        <span
                          className="tech-person-avatar"
                          style={
                            row.avatarUrl ? { backgroundImage: `url(${row.avatarUrl})` } : undefined
                          }
                        >
                          {!row.avatarUrl && technicianInitials(row.name)}
                        </span>
                        <span>{row.name || t('Unnamed technician')}</span>
                      </span>
                    </th>
                    <td>{row.email || '—'}</td>
                    <td>{row.phone || '—'}</td>
                    <td>
                      <span className="tech-lock-badge">
                        <i />
                        {t('Locked')}
                      </span>
                    </td>
                    <td>
                      {verification[row.verificationStatus]
                        ? t(verification[row.verificationStatus])
                        : '—'}
                    </td>
                    <td>{reportTimestamp(row.registeredAt, locale)}</td>
                  </tr>
                ))
              ) : (
                <TableState
                  loading={loading}
                  error={error ? t(error) : ''}
                  retry={retry}
                  empty
                  colSpan={6}
                />
              )}
            </tbody>
          </table>
        </div>
        {data && locked.items.length === 0 && locked.total > 0 && (
          <button type="button" className="tech-reset-page" onClick={() => onPage(1)}>
            {t('Go to first page')}
          </button>
        )}
        {data && (
          <Pagination
            page={locked.page}
            total={locked.total}
            limit={locked.limit}
            loading={loading}
            onPage={onPage}
            pageSizeOptions={technicianPageSizes}
            onLimit={onLimit}
          />
        )}
        <p className="tech-note">
          {t(
            'Profile registration date is not the date an account was locked. Account status is read-only here; account management remains on the Users page.'
          )}
        </p>
      </section>
    </>
  )
}

export default function TechnicianPanels(props) {
  const { data, filters } = props
  switch (filters.tab) {
    case 'income':
      return <TechnicianIncome data={data} />
    case 'areas':
      return <TechnicianAreas data={data} />
    case 'services':
      return <TechnicianPerformance data={data} />
    case 'issues':
      return <TechnicianIssues data={data} />
    case 'locked':
      return <LockedTechnicians {...props} />
    default:
      return <TechnicianOverview data={data} />
  }
}
