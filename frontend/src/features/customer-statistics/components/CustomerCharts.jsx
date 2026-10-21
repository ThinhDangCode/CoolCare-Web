import { useId, useState } from 'react'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import {
  reportBucketLabel,
  reportCount,
  reportDate,
  reportPercent,
} from '../../reports/reportPresentation.js'
import { customerAreaRows, customerChartScale } from '../customerPresentation.js'
import { CustomerHeading } from './CustomerUi.jsx'

const palette = [
  '#ff7816',
  '#40506b',
  '#008bc0',
  '#f0a200',
  '#8059c9',
  '#159675',
  '#bc4779',
  '#7291a4',
]

function bucketDate(row, period) {
  return period.granularity === 'month'
    ? reportBucketLabel(row.date, 'month')
    : reportDate(row.date)
}

export function CustomerTrend({ rows, period, cancellation = false }) {
  const id = useId()
  const { t, locale } = useUiPreferences()
  const [activeDate, setActiveDate] = useState(null)
  const series = cancellation
    ? [
        { key: 'cancelledBookings', label: 'Customer cancellations', color: '#ef4444' },
        { key: 'rejectedBookings', label: 'Quote rejections', color: '#e99b00' },
      ]
    : [{ key: 'count', label: 'New Customers', color: 'var(--orange)' }]
  const maximum = customerChartScale(
    rows,
    series.map((item) => item.key)
  )
  const left = 68,
    right = 944,
    top = 22,
    bottom = 260
  const point = (row, index, key) => ({
    x:
      rows.length === 1
        ? (left + right) / 2
        : left + (index * (right - left)) / Math.max(1, rows.length - 1),
    y: bottom - (Number(row[key]) / maximum) * (bottom - top),
  })
  const describe = (row) =>
    cancellation
      ? t(
          '{date}: {cancelled} customer cancellations; {rejected} quote rejections; {total} bookings created.',
          {
            date: bucketDate(row, period),
            cancelled: reportCount(row.cancelledBookings, locale),
            rejected: reportCount(row.rejectedBookings, locale),
            total: reportCount(row.totalBookings, locale),
          }
        )
      : t('{date}: {count} new customers.', {
          date: bucketDate(row, period),
          count: reportCount(row.count, locale),
        })
  const active = rows.find((row) => row.date === activeDate)
  const labelStep = Math.max(1, Math.ceil(rows.length / 7))
  const title = cancellation ? 'Cancellation & Rejection Trend' : 'Customer Growth Trend'
  const description = cancellation
    ? 'Counts by booking creation date. One booking can appear in both series.'
    : 'New customer profiles by registration date, within the selected period.'
  const hasActivity = rows.some((row) => series.some((item) => row[item.key] > 0))
  return (
    <section className="customer-card customer-trend" aria-labelledby={`${id}-title`}>
      <div className="customer-card-heading">
        <div>
          <h2 id={`${id}-title`}>{t(title)}</h2>
          <p>{t(description)}</p>
        </div>
        <div className="customer-chart-legend">
          {series.map((item) => (
            <span key={item.key}>
              <i style={{ backgroundColor: item.color }} />
              {t(item.label)}
            </span>
          ))}
        </div>
      </div>
      <div className="customer-chart-scroll" onPointerLeave={() => setActiveDate(null)}>
        <svg className="customer-line-chart" viewBox="0 0 980 306" aria-labelledby={`${id}-title`}>
          <desc>
            {t('Hover or focus a point to view exact values. All chart values are counts.')}
          </desc>
          <defs>
            {series.map((item) => (
              <linearGradient
                key={item.key}
                id={`${id}-${item.key}-fill`}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="0%" stopColor={item.color} stopOpacity=".18" />
                <stop offset="100%" stopColor={item.color} stopOpacity=".01" />
              </linearGradient>
            ))}
          </defs>
          {[0, 1, 2, 3, 4].map((tick) => {
            const y = bottom - (tick * (bottom - top)) / 4
            return (
              <g key={tick}>
                <line x1={left} x2={right} y1={y} y2={y} className="customer-gridline" />
                <text x={left - 12} y={y + 4} textAnchor="end" className="customer-axis-label">
                  {reportCount((maximum * tick) / 4, locale)}
                </text>
              </g>
            )
          })}
          {series.map((item) => {
            const points = rows.map((row, index) => point(row, index, item.key))
            const path = points
              .map((p, index) => `${index ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
              .join(' ')
            return (
              points.length > 0 && (
                <g key={item.key}>
                  <path
                    d={`${path} L${points.at(-1).x},${bottom} L${points[0].x},${bottom} Z`}
                    fill={`url(#${id}-${item.key}-fill)`}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              )
            )
          })}
          {rows.map((row, index) => {
            const x = point(row, index, series[0].key).x
            const width = rows.length === 1 ? 32 : Math.max(8, (right - left) / (rows.length - 1))
            return (
              <g
                key={row.date}
                className="customer-chart-point"
                role="img"
                tabIndex={0}
                aria-label={describe(row)}
                onFocus={() => setActiveDate(row.date)}
                onBlur={() => setActiveDate(null)}
                onPointerEnter={() => setActiveDate(row.date)}
                onClick={() => setActiveDate(row.date)}
              >
                <title>{describe(row)}</title>
                <rect
                  className="customer-point-target"
                  x={Math.max(left, x - width / 2)}
                  y={top}
                  width={Math.min(right, x + width / 2) - Math.max(left, x - width / 2)}
                  height={bottom - top}
                />
                {series.map((item) => (
                  <circle
                    key={item.key}
                    cx={x}
                    cy={point(row, index, item.key).y}
                    r={activeDate === row.date ? 4.5 : 2.5}
                    fill="var(--app-surface)"
                    stroke={item.color}
                    strokeWidth="2"
                  />
                ))}
                {(index % labelStep === 0 || index === rows.length - 1) && (
                  <text x={x} y={bottom + 27} textAnchor="middle" className="customer-axis-label">
                    {reportBucketLabel(row.date, period.granularity)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <p className="customer-chart-value" aria-live="polite">
        {active ? describe(active) : t('Hover or focus a point to view exact values.')}
      </p>
      {!hasActivity && (
        <p className="customer-empty-note">
          {t(
            cancellation
              ? 'No customer cancellations or quote rejections were recorded for these bookings.'
              : 'No customer profiles were registered in this period.'
          )}
        </p>
      )}
      <details className="customer-data-table">
        <summary>{t('View chart data')}</summary>
        <div>
          <table>
            <caption>
              {t('{frequency} · {from} – {to} · Vietnam time (UTC+7)', {
                frequency: t(period.granularity === 'month' ? 'Monthly totals' : 'Daily totals'),
                from: reportDate(period.from),
                to: reportDate(period.to),
              })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t(period.granularity === 'month' ? 'Month' : 'Date')}</th>
                {series.map((item) => (
                  <th key={item.key} scope="col">
                    {t(item.label)}
                  </th>
                ))}
                {cancellation && <th scope="col">{t('Total Bookings')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date}>
                  <th scope="row">{bucketDate(row, period)}</th>
                  {series.map((item) => (
                    <td key={item.key}>{reportCount(row[item.key], locale)}</td>
                  ))}
                  {cancellation && <td>{reportCount(row.totalBookings, locale)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

export function CustomerAreasChart({ areas }) {
  const { t, locale } = useUiPreferences()
  const id = useId()
  const rows = customerAreaRows(areas)
  const maximum = customerChartScale(rows, ['count'])
  const left = 64,
    right = 944,
    top = 35,
    bottom = 250
  const gap = (right - left) / Math.max(1, rows.length)
  const width = Math.min(54, gap * 0.58)
  const areaLabel = (row) =>
    row.missing ? t('Unknown address') : row.other ? t('Other areas') : row.label
  return (
    <section className="customer-card customer-areas-chart" aria-labelledby={`${id}-title`}>
      <div className="customer-card-heading">
        <div>
          <h2 id={`${id}-title`}>{t('Customer Distribution by Area')}</h2>
          <p>
            {t('Current default address · Top 8 areas, with remaining areas grouped together.')}
          </p>
        </div>
        <span className="customer-tag">{t('Unit: Customers')}</span>
      </div>
      {rows.length ? (
        <>
          <div className="customer-chart-scroll">
            <svg
              className="customer-bar-chart"
              viewBox="0 0 980 330"
              aria-labelledby={`${id}-title`}
            >
              <desc>
                {t(
                  'Each customer profile is counted once. Missing default addresses are included as Unknown address.'
                )}
              </desc>
              {[0, 1, 2, 3, 4].map((tick) => {
                const y = bottom - (tick * (bottom - top)) / 4
                return (
                  <g key={tick}>
                    <line x1={left} x2={right} y1={y} y2={y} className="customer-gridline" />
                    <text x={left - 12} y={y + 4} textAnchor="end" className="customer-axis-label">
                      {reportCount((maximum * tick) / 4, locale)}
                    </text>
                  </g>
                )
              })}
              {rows.map((row, index) => {
                const x = left + gap * (index + 0.5)
                const height = (row.count / maximum) * (bottom - top)
                const label = areaLabel(row)
                const description = t('{area}: {count} customers ({percentage}).', {
                  area: label,
                  count: reportCount(row.count, locale),
                  percentage: reportPercent(row.percentage, locale),
                })
                return (
                  <g
                    key={row.key}
                    className="customer-bar-point"
                    tabIndex={0}
                    role="img"
                    aria-label={description}
                  >
                    <title>{description}</title>
                    <rect
                      x={x - width / 2}
                      y={bottom - height}
                      width={width}
                      height={Math.max(height, row.count ? 2 : 0)}
                      rx="6"
                      fill={
                        index < 2 && !row.missing && !row.other
                          ? 'var(--orange)'
                          : palette[1 + (index % (palette.length - 1))]
                      }
                    />
                    <text
                      x={x}
                      y={bottom - height - 11}
                      textAnchor="middle"
                      className="customer-axis-label customer-bar-value"
                    >
                      {reportCount(row.count, locale)}
                    </text>
                    <text x={x} y={bottom + 25} textAnchor="middle" className="customer-axis-label">
                      {label.length > 19 ? `${label.slice(0, 18)}…` : label}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
          <p className="customer-chart-caption">
            {t('{total} customer profiles · {unknown} with no complete default address', {
              total: reportCount(areas.totalCustomers, locale),
              unknown: reportCount(areas.unknownCustomers, locale),
            })}
          </p>
          <details className="customer-data-table">
            <summary>{t('View all areas')}</summary>
            <div>
              <table>
                <caption>
                  {t(
                    'Current address distribution. New registrations and growth use the selected period and current address.'
                  )}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Area')}</th>
                    <th scope="col">{t('Customers')}</th>
                    <th scope="col">{t('Share')}</th>
                    <th scope="col">{t('New Customers')}</th>
                    <th scope="col">{t('Growth rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {areas.items.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{areaLabel(row)}</th>
                      <td>{reportCount(row.count, locale)}</td>
                      <td>{reportPercent(row.percentage, locale)}</td>
                      <td>{reportCount(row.newCount, locale)}</td>
                      <td>{reportPercent(row.growthPercent, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="customer-empty-note">{t('No customer profiles are available.')}</p>
      )}
    </section>
  )
}

export function CustomerServiceSplit({ usage }) {
  const { t, locale } = useUiPreferences()
  const categories = usage.categories
  const stops = categories.reduce(
    (result, row, index) => {
      const end = result.percentage + (usage.totalUses ? (row.count * 100) / usage.totalUses : 0)
      return {
        percentage: end,
        stops: [
          ...result.stops,
          `${palette[index % palette.length]} ${result.percentage}% ${end}%`,
        ],
      }
    },
    { percentage: 0, stops: [] }
  ).stops
  const categoryName = (row) =>
    row.id === null || row.id === 'UNCLASSIFIED' ? t('Unclassified category') : row.name
  return (
    <section className="customer-card customer-category-card">
      <CustomerHeading
        title="Service Category Split"
        description="Share of service uses on completed bookings created in the selected period."
      />
      {usage.totalUses > 0 ? (
        <>
          <div
            className="customer-donut"
            role="img"
            aria-label={t('{count} service uses across {categories} categories.', {
              count: reportCount(usage.totalUses, locale),
              categories: reportCount(categories.length, locale),
            })}
            style={{ background: `conic-gradient(${stops.join(', ')})` }}
          >
            <div>
              <span>{t('Total service uses')}</span>
              <strong>{reportCount(usage.totalUses, locale)}</strong>
            </div>
          </div>
          <ul className="customer-category-legend">
            {categories.map((row, index) => (
              <li key={row.id ?? 'unclassified'}>
                <i style={{ backgroundColor: palette[index % palette.length] }} />
                <div>
                  <strong>{reportPercent(row.percentage, locale)}</strong>
                  <span>{categoryName(row)}</span>
                  <small>{t('{count} uses', { count: reportCount(row.count, locale) })}</small>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="customer-empty-note">
          {t('No service usage was recorded for these completed bookings.')}
        </p>
      )}
      <p className="customer-method-note">
        {t(
          'Each service selected for one AC unit counts as one use. Category percentages use all service uses as the denominator.'
        )}
      </p>
    </section>
  )
}
