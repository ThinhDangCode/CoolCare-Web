import { useEffect, useState } from 'react'
import { Pagination, TableState } from '../../../shared/components/AdminUi.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import {
  reportCount,
  reportDate,
  reportPercent,
  reportTimestamp,
} from '../../reports/reportPresentation.js'
import {
  customerDecimal,
  customerInitials,
  customerPageSizes,
  customerShare,
} from '../customerPresentation.js'
import { CustomerAreasChart, CustomerServiceSplit, CustomerTrend } from './CustomerCharts.jsx'
import { CustomerHeading, CustomerIcon, CustomerKpi } from './CustomerUi.jsx'

function CustomerOverview({ data }) {
  const { t, locale } = useUiPreferences()
  const { summary } = data
  const segments = [
    {
      key: 'with-bookings',
      title: 'Customers with bookings',
      count: summary.customersWithBookings,
      description: 'Has at least one booking, including pending or cancelled bookings.',
      marker: 'Segment 01',
    },
    {
      key: 'without-bookings',
      title: 'Customers without bookings',
      count: summary.customersWithoutBookings,
      description: 'No booking has been recorded for this customer profile.',
      marker: 'Segment 02',
    },
  ]
  return (
    <>
      <div className="customer-kpis">
        <CustomerKpi
          title="Total Customers"
          value={reportCount(summary.totalCustomers, locale)}
          note="Current total · All registered customer profiles"
          icon="overview-total"
        />
        <CustomerKpi
          title="New Customers"
          value={reportCount(summary.newCustomers, locale)}
          note="Registered in the selected period"
          icon="overview-new"
          tone="green"
        />
        <CustomerKpi
          title="Active Customers"
          value={reportCount(summary.activeCustomers, locale)}
          note="Current accounts with ACTIVE status"
          icon="overview-active"
          tone="amber"
        />
        <CustomerKpi
          title="Locked Customers"
          value={reportCount(summary.lockedCustomers, locale)}
          note="Current accounts with LOCKED status"
          icon="overview-locked"
          tone="red"
        />
      </div>
      <section className="customer-card customer-segments">
        <CustomerHeading
          title="Customer Segment Analysis"
          description="Current customer profiles grouped by their complete booking history."
        />
        <div className="customer-segment-grid">
          {segments.map((segment) => {
            const percentage = customerShare(segment.count, summary.totalCustomers)
            return (
              <section
                key={segment.key}
                className={`customer-segment ${segment.key}`}
                aria-label={t(segment.title)}
              >
                <div className="customer-segment-heading">
                  <div>
                    <span className="customer-segment-marker">
                      <i />
                      {t(segment.marker)}
                    </span>
                    <h3>{t(segment.title)}</h3>
                  </div>
                  <strong>{reportCount(segment.count, locale)}</strong>
                </div>
                <div className="customer-segment-stat">
                  <span>{t('Share of all customer profiles')}</span>
                  <strong>{reportPercent(percentage, locale)}</strong>
                </div>
                <p>{t(segment.description)}</p>
                <div className="customer-segment-track" aria-hidden="true">
                  <span style={{ width: `${percentage}%` }} />
                </div>
              </section>
            )
          })}
        </div>
        <p className="customer-method-note">
          {t(
            'Booking-history segments include every booking status and all dates. Current account totals and segments do not change with the report period. A technician can also have a customer profile.'
          )}
        </p>
      </section>
    </>
  )
}

function NewCustomers({ data }) {
  const { t, locale } = useUiPreferences()
  const { acquisition, period } = data
  return (
    <>
      <div className="customer-kpis">
        <CustomerKpi
          title="Total New Customers"
          value={reportCount(acquisition.currentCount, locale)}
          note="Registered in the selected period"
          icon="new-total"
        />
        <CustomerKpi
          title="Growth rate"
          value={reportPercent(acquisition.growthPercent, locale)}
          icon="new-growth"
          tone="green"
        >
          <p>
            {t('Previous equal-length period: {count}', {
              count: reportCount(acquisition.previousCount, locale),
            })}
          </p>
        </CustomerKpi>
        <CustomerKpi
          title="Selected month to date"
          value={reportCount(acquisition.monthCount, locale)}
          icon="new-month"
          tone="orange"
        >
          <p>
            {t('From {from} through {to}', {
              from: reportDate(`${period.to.slice(0, 7)}-01`),
              to: reportDate(period.to),
            })}
          </p>
        </CustomerKpi>
        <CustomerKpi
          title="Selected year to date"
          value={reportCount(acquisition.yearCount, locale)}
          icon="new-year"
          tone="slate"
        >
          <p>
            {t('From {from} through {to}', {
              from: `01/01/${period.to.slice(0, 4)}`,
              to: reportDate(period.to),
            })}
          </p>
        </CustomerKpi>
      </div>
      {acquisition.growthPercent === null && (
        <p className="customer-inline-note">
          {t('Growth is unavailable when the previous equal-length period has no registrations.')}
        </p>
      )}
      <CustomerTrend key={`${period.from}:${period.to}`} rows={acquisition.trend} period={period} />
    </>
  )
}

function CustomersByArea({ data }) {
  const { t, locale } = useUiPreferences()
  const { areas } = data
  return (
    <>
      <div className="customer-kpis">
        <CustomerKpi
          title="Total known areas"
          value={reportCount(areas.areaCount, locale)}
          note="Distinct current default-address areas"
          icon="areas-total"
        />
        <CustomerKpi
          title="Top area by customer count"
          value={areas.topArea?.label ?? '—'}
          icon="areas-top"
          tone="orange"
        >
          <p>
            {areas.topArea
              ? t('{count} customers · {percentage} of all profiles', {
                  count: reportCount(areas.topArea.count, locale),
                  percentage: reportPercent(areas.topArea.percentage, locale),
                })
              : t('No known default-address areas')}
          </p>
        </CustomerKpi>
        <CustomerKpi
          title="Average customers / area"
          value={customerDecimal(areas.averageCustomersPerArea, locale)}
          note="Known-address customers / known areas"
          icon="areas-average"
          tone="green"
        />
        <CustomerKpi
          title="Fastest-growing area"
          value={areas.fastestGrowingArea?.label ?? '—'}
          icon="areas-growth"
          tone="purple"
        >
          <p>
            {areas.fastestGrowingArea
              ? t('{percentage} registration growth versus the previous period', {
                  percentage: reportPercent(areas.fastestGrowingArea.growthPercent, locale),
                })
              : t('No positive registration growth with a comparable previous period')}
          </p>
        </CustomerKpi>
      </div>
      <CustomerAreasChart areas={areas} />
      <p className="customer-inline-note">
        {t(
          'Area totals use current default addresses, not booking locations. Each profile appears once, including profiles with unknown addresses. Growth uses new registrations and their current address.'
        )}
      </p>
    </>
  )
}

function CustomerServiceUsage({ data }) {
  const { t, locale } = useUiPreferences()
  const { usage } = data
  const name = (row) =>
    row.id === null || row.id === 'UNCLASSIFIED' ? t('Unclassified service') : row.name
  return (
    <>
      <div className="customer-kpis">
        <CustomerKpi
          title="Completed bookings"
          value={reportCount(usage.totalBookings, locale)}
          note="Created in the selected period · Currently COMPLETED"
          icon="services-total"
        />
        <CustomerKpi
          title="Average bookings / customer"
          value={customerDecimal(usage.averageBookingsPerCustomer, locale)}
          note="Completed bookings / customers with those bookings"
          icon="services-average"
          tone="green"
        />
        <CustomerKpi
          title="Top service"
          value={usage.topService ? name(usage.topService) : '—'}
          icon="services-top"
          tone="orange"
        >
          <p>
            {usage.topService
              ? t('{count} service uses', { count: reportCount(usage.topService.count, locale) })
              : t('No completed service usage')}
          </p>
        </CustomerKpi>
        <CustomerKpi
          title="Repeat customer ratio"
          value={reportPercent(usage.repeatCustomerPercent, locale)}
          icon="services-repeat"
          tone="purple"
        >
          <p>
            {t('{count} customers with at least 2 completed bookings in this period', {
              count: reportCount(usage.repeatCustomers, locale),
            })}
          </p>
        </CustomerKpi>
      </div>
      <CustomerServiceSplit usage={usage} />
      <section className="customer-card customer-service-table">
        <CustomerHeading
          title="Service Usage Breakdown"
          description="Completed bookings created in the selected period. Customers can use more than one service, so customer counts overlap across rows."
        />
        <div className="customer-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('Service')}</th>
                <th scope="col">{t('Service uses')}</th>
                <th scope="col">{t('Customers')}</th>
                <th scope="col">{t('Completed bookings')}</th>
                <th scope="col">{t('Share of service uses')}</th>
              </tr>
            </thead>
            <tbody>
              {usage.services.length ? (
                usage.services.map((row) => (
                  <tr key={row.id ?? 'unclassified'}>
                    <th scope="row">{name(row)}</th>
                    <td>{reportCount(row.count, locale)}</td>
                    <td>{reportCount(row.customers, locale)}</td>
                    <td>{reportCount(row.bookings, locale)}</td>
                    <td>{reportPercent(row.percentage, locale)}</td>
                  </tr>
                ))
              ) : (
                <TableState empty colSpan={5} />
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function CustomerCancellations({ data }) {
  const { t, locale } = useUiPreferences()
  const { cancellations, period } = data
  return (
    <>
      <div className="customer-kpis">
        <CustomerKpi
          title="Customer cancellation rate"
          value={reportPercent(cancellations.cancellationPercent, locale)}
          note="Customer-cancelled bookings / all bookings in this period"
          icon="cancellations-rate"
          tone="red"
        />
        <CustomerKpi
          title="Quote rejection rate"
          value={reportPercent(cancellations.rejectionPercent, locale)}
          note="Bookings with a rejected quotation / all bookings in this period"
          icon="rejections-rate"
          tone="amber"
        />
        <CustomerKpi
          title="Total customer cancellations"
          value={reportCount(cancellations.cancelledBookings, locale)}
          note="Cancelled by the customer who created the booking"
          icon="cancellations-total"
          tone="slate"
        />
        <CustomerKpi
          title="Total quote rejections"
          value={reportCount(cancellations.rejectedBookings, locale)}
          note="Each booking is counted once, even with multiple rejected quotes"
          icon="rejections-total"
          tone="orange"
        />
      </div>
      <CustomerTrend
        key={`${period.from}:${period.to}`}
        rows={cancellations.trend}
        period={period}
        cancellation
      />
      <p className="customer-method-note customer-standalone-note">
        {t(
          'Of {total} bookings created in this period, {affected} had a customer cancellation or quote rejection. A booking can have both; the two counts must not be added together. Technician assignment declines are excluded.',
          {
            total: reportCount(cancellations.totalBookings, locale),
            affected: reportCount(cancellations.affectedBookings, locale),
          }
        )}
      </p>
    </>
  )
}

function LockedCustomers({ data, filters, onSearch, onPage, onLimit, loading, error, retry }) {
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
  return (
    <>
      <div className="customer-kpis customer-kpis-three">
        <CustomerKpi
          title="Locked Customers"
          value={reportCount(summary?.lockedCustomers, locale)}
          note="Current accounts with LOCKED status"
          icon="locked-total"
          tone="red"
        />
        <CustomerKpi
          title="Active Customers"
          value={reportCount(summary?.activeCustomers, locale)}
          note="Current accounts with ACTIVE status"
          icon="locked-active"
          tone="amber"
        />
        <CustomerKpi
          title="Inactive Customers"
          value={reportCount(summary?.inactiveCustomers, locale)}
          note="Current accounts with INACTIVE status"
          icon="locked-inactive"
          tone="orange"
        />
      </div>
      <p className="customer-inline-note">
        {t(
          'This list is a current account snapshot. The report period does not filter locked accounts. Registration date is not the date an account was locked.'
        )}
      </p>
      <section
        className="customer-card customer-locked-card"
        aria-label={t('Locked customer accounts')}
        aria-busy={loading}
      >
        <div className="customer-locked-toolbar">
          <label className="customer-search">
            <CustomerIcon name="search" />
            <input
              type="search"
              value={search}
              maxLength={150}
              aria-label={t('Search locked customers')}
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
        <div className="customer-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('Customer')}</th>
                <th scope="col">{t('Email')}</th>
                <th scope="col">{t('Phone')}</th>
                <th scope="col">{t('Account status')}</th>
                <th scope="col">{t('Registration date')}</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !error && locked.items.length ? (
                locked.items.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <span className="customer-person">
                        <span
                          className="customer-person-avatar"
                          style={
                            row.avatarUrl ? { backgroundImage: `url(${row.avatarUrl})` } : undefined
                          }
                        >
                          {!row.avatarUrl && customerInitials(row.name)}
                        </span>
                        <span>{row.name || t('Unnamed customer')}</span>
                      </span>
                    </th>
                    <td>{row.email || '—'}</td>
                    <td>{row.phone || '—'}</td>
                    <td>
                      <span className="customer-locked-badge">
                        <i />
                        {t('Locked')}
                      </span>
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
                  colSpan={5}
                />
              )}
            </tbody>
          </table>
        </div>
        {data && locked.items.length === 0 && locked.total > 0 && (
          <button type="button" className="customer-reset-page" onClick={() => onPage(1)}>
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
            pageSizeOptions={customerPageSizes}
            onLimit={onLimit}
          />
        )}
        <p className="customer-table-note">
          {t('Account status is read-only here. Account management remains on the Users page.')}
        </p>
      </section>
    </>
  )
}

export default function CustomerPanels({
  data,
  filters,
  onSearch,
  onPage,
  onLimit,
  loading,
  error,
  retry,
}) {
  switch (filters.tab) {
    case 'new':
      return <NewCustomers data={data} />
    case 'areas':
      return <CustomersByArea data={data} />
    case 'services':
      return <CustomerServiceUsage data={data} />
    case 'cancellations':
      return <CustomerCancellations data={data} />
    case 'locked':
      return (
        <LockedCustomers
          data={data}
          filters={filters}
          onSearch={onSearch}
          onPage={onPage}
          onLimit={onLimit}
          loading={loading}
          error={error}
          retry={retry}
        />
      )
    default:
      return <CustomerOverview data={data} />
  }
}
