import { useId, useState } from 'react'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import {
  reportAxisLabel,
  reportBucketLabel,
  reportCount,
  reportDate,
  reportMoney,
  reportMoneyUnits,
  reportPercent,
} from '../../reports/reportPresentation.js'
import {
  technicianLineSegments,
  technicianMoneyScale,
  technicianRate,
  technicianScale,
} from '../technicianPresentation.js'
import { TechnicianHeading } from './TechnicianUi.jsx'

const configs = {
  income: {
    title: 'Technician Earnings Trend',
    description:
      'Successful payments by settlement date. Amounts are the recorded technician entitlement.',
    series: [{ key: 'amount', label: 'Settled technician earnings', color: 'var(--orange)' }],
  },
  services: {
    title: 'Service Performance Trend',
    description:
      'Completion uses requests sent in each bucket. Ratings use published reviews created in each bucket.',
    series: [
      { key: 'completionRate', label: 'Request completion rate', color: 'var(--orange)' },
      { key: 'ratingPercent', label: 'Customer rating (×20%)', color: '#159675' },
    ],
  },
  issues: {
    title: 'Technician Issues Trend',
    description:
      'Complaints by creation date and penalties by application date. Resolved complaints use their current status.',
    series: [
      { key: 'complaints', label: 'Complaints linked to technicians', color: '#ef4444' },
      { key: 'penalties', label: 'Penalty records', color: 'var(--orange)' },
      { key: 'resolvedComplaints', label: 'Resolved complaints', color: '#159675' },
    ],
  },
}

export function TechnicianTrend({ mode, rows, period }) {
  const { t, locale } = useUiPreferences()
  const id = useId()
  const [activeDate, setActiveDate] = useState(null)
  const config = configs[mode]
  const series =
    mode === 'income' && rows.some((row) => row.missingPayments > 0)
      ? [
          ...config.series,
          { key: 'knownAmount', label: 'Known partial earnings', color: '#64748b', dashed: true },
        ]
      : config.series
  const chartRows = rows.map((row) =>
    mode === 'services'
      ? {
          ...row,
          completionRate: technicianRate(row.completedRequests, row.totalRequests),
          ratingPercent: row.averageRating === null ? null : row.averageRating * 20,
        }
      : row
  )
  const moneyScale = mode === 'income' ? technicianMoneyScale(rows) : null
  const maximum =
    mode === 'income'
      ? moneyScale.maximum
      : mode === 'services'
        ? 100
        : technicianScale(
            rows,
            series.map((item) => item.key)
          )
  const left = 64,
    right = 942,
    top = 24,
    bottom = 256
  const ratio = (value) =>
    value === null
      ? null
      : mode === 'income'
        ? moneyScale.ratio(reportMoneyUnits(value))
        : Number(value) / maximum
  const point = (row, index, key) => {
    const value = ratio(row[key])
    return value === null
      ? null
      : {
          x:
            rows.length === 1
              ? (left + right) / 2
              : left + (index * (right - left)) / Math.max(1, rows.length - 1),
          y: bottom - value * (bottom - top),
        }
  }
  const date = (row) =>
    period.granularity === 'month' ? reportBucketLabel(row.date, 'month') : reportDate(row.date)
  const value = (row, key) =>
    mode === 'income'
      ? reportMoney(row[key], locale)
      : mode === 'services'
        ? reportPercent(row[key], locale)
        : reportCount(row[key], locale)
  const description = (row) =>
    `${date(row)} · ${series.map((item) => `${t(item.label)}: ${value(row, item.key)}`).join(' · ')}`
  const active = chartRows.find((row) => row.date === activeDate)
  const labelStep = Math.max(1, Math.ceil(rows.length / 7))
  return (
    <section className="tech-card tech-trend" aria-labelledby={`${id}-title`}>
      <div className="tech-chart-heading">
        <div>
          <h2 id={`${id}-title`}>{t(config.title)}</h2>
          <p>{t(config.description)}</p>
        </div>
        <div className="tech-legend">
          {series.map((item) => (
            <span key={item.key}>
              <i style={{ background: item.color }} />
              {t(item.label)}
            </span>
          ))}
        </div>
      </div>
      <div className="tech-chart-scroll" onPointerLeave={() => setActiveDate(null)}>
        <svg className="tech-chart" viewBox="0 0 980 306" aria-labelledby={`${id}-title`}>
          <desc>{t('Hover or focus a point to view exact values.')}</desc>
          <defs>
            {series.map((item) => (
              <linearGradient key={item.key} id={`${id}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={item.color} stopOpacity=".18" />
                <stop offset="100%" stopColor={item.color} stopOpacity=".01" />
              </linearGradient>
            ))}
          </defs>
          {[0, 1, 2, 3, 4].map((tick) => {
            const y = bottom - (tick * (bottom - top)) / 4
            return (
              <g key={tick}>
                <line x1={left} x2={right} y1={y} y2={y} className="tech-gridline" />
                <text x={left - 12} y={y + 4} textAnchor="end" className="tech-axis-label">
                  {mode === 'income'
                    ? reportAxisLabel((maximum * BigInt(tick)) / 4n, 'commission', locale)
                    : mode === 'services'
                      ? reportPercent(tick * 25, locale)
                      : reportCount((maximum * tick) / 4, locale)}
                </text>
              </g>
            )
          })}
          {series.map((item) => (
            <g key={item.key}>
              {technicianLineSegments(
                chartRows.map((row, index) => point(row, index, item.key))
              ).map((segment, index) => {
                const path = segment.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
                return (
                  <g key={index}>
                    {!item.dashed && (
                      <path
                        d={`${path} L${segment.at(-1).x},${bottom} L${segment[0].x},${bottom} Z`}
                        fill={`url(#${id}-${item.key})`}
                      />
                    )}
                    <path
                      d={path}
                      fill="none"
                      stroke={item.color}
                      strokeWidth="2.5"
                      strokeDasharray={item.dashed ? '5 4' : undefined}
                    />
                  </g>
                )
              })}
            </g>
          ))}
          {chartRows.map((row, index) => (
            <g key={row.date}>
              {(index % labelStep === 0 || index === rows.length - 1) && (
                <text
                  x={
                    rows.length === 1
                      ? (left + right) / 2
                      : left + (index * (right - left)) / (rows.length - 1)
                  }
                  y="286"
                  textAnchor="middle"
                  className="tech-axis-label"
                >
                  {reportBucketLabel(row.date, period.granularity)}
                </text>
              )}
              {series.map((item) => {
                const p = point(row, index, item.key)
                if (!p) return null
                return (
                  <g
                    className="tech-point"
                    key={item.key}
                    tabIndex="0"
                    role="img"
                    aria-label={description(row)}
                    onFocus={() => setActiveDate(row.date)}
                    onPointerEnter={() => setActiveDate(row.date)}
                  >
                    <circle cx={p.x} cy={p.y} r="10" className="tech-hit" />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={row.date === activeDate ? 4.5 : 3}
                      fill="var(--app-surface)"
                      stroke={item.color}
                      strokeWidth="2"
                    />
                    <title>{description(row)}</title>
                  </g>
                )
              })}
            </g>
          ))}
        </svg>
      </div>
      <p className="tech-chart-value" aria-live="polite">
        {active ? description(active) : t('Hover or focus a point to view exact values.')}
      </p>
      {mode === 'services' && (
        <p className="tech-chart-caption">
          {t(
            'Ratings are shown on a 0–100 scale (rating ×20). Missing ratings or empty request buckets appear as gaps.'
          )}
        </p>
      )}
      <details className="tech-detail-table">
        <summary>{t('View chart data')}</summary>
        <div>
          <table>
            <caption>{t(config.description)}</caption>
            <thead>
              <tr>
                <th scope="col">{t('Period')}</th>
                {series.map((item) => (
                  <th scope="col" key={item.key}>
                    {t(item.label)}
                  </th>
                ))}
                {mode === 'services' && <th scope="col">{t('Published reviews')}</th>}
              </tr>
            </thead>
            <tbody>
              {chartRows.map((row) => (
                <tr key={row.date}>
                  <th scope="row">{date(row)}</th>
                  {series.map((item) => (
                    <td key={item.key}>{value(row, item.key)}</td>
                  ))}
                  {mode === 'services' && <td>{reportCount(row.reviewCount, locale)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

export function TechnicianAreasChart({ areas }) {
  const { t, locale } = useUiPreferences()
  const id = useId()
  const [activeKey, setActiveKey] = useState(null)
  const rows = areas.items.slice(0, 12)
  const maximum = technicianScale(rows, ['count'])
  const left = 62,
    right = 942,
    top = 24,
    bottom = 256
  const slot = (right - left) / Math.max(1, rows.length)
  const barWidth = Math.min(52, slot * 0.62)
  const active = rows.find((row) => row.key === activeKey)
  const describe = (row) =>
    `${row.label}: ${reportCount(row.count, locale)} · ${reportPercent(row.percentage, locale)}`
  return (
    <section className="tech-card" aria-labelledby={`${id}-title`}>
      <div id={`${id}-title`}>
        <TechnicianHeading
          title="Technician Distribution by Area"
          description="Unique technicians registered to serve each city and ward. A technician may cover several areas."
        />
      </div>
      {rows.length ? (
        <>
          <div className="tech-chart-scroll" onPointerLeave={() => setActiveKey(null)}>
            <svg className="tech-chart" viewBox="0 0 980 334" aria-labelledby={`${id}-title`}>
              {[0, 1, 2, 3, 4].map((tick) => {
                const y = bottom - (tick * (bottom - top)) / 4
                return (
                  <g key={tick}>
                    <line x1={left} x2={right} y1={y} y2={y} className="tech-gridline" />
                    <text x={left - 12} y={y + 4} textAnchor="end" className="tech-axis-label">
                      {reportCount((maximum * tick) / 4, locale)}
                    </text>
                  </g>
                )
              })}
              {rows.map((row, index) => {
                const x = left + slot * (index + 0.5),
                  y = bottom - (row.count / maximum) * (bottom - top)
                const ward = row.ward.length > 17 ? `${row.ward.slice(0, 16)}…` : row.ward
                const city = row.city.length > 17 ? `${row.city.slice(0, 16)}…` : row.city
                return (
                  <g
                    key={row.key}
                    className="tech-point"
                    tabIndex="0"
                    role="img"
                    aria-label={describe(row)}
                    onFocus={() => setActiveKey(row.key)}
                    onPointerEnter={() => setActiveKey(row.key)}
                  >
                    <rect
                      x={x - barWidth / 2}
                      y={y}
                      width={barWidth}
                      height={Math.max(0, bottom - y)}
                      rx="4"
                      fill="var(--orange)"
                      opacity={activeKey && activeKey !== row.key ? '.55' : '1'}
                    />
                    <text
                      x={x}
                      y={y - 10}
                      textAnchor="middle"
                      className="tech-axis-label tech-bar-value"
                    >
                      {reportCount(row.count, locale)}
                    </text>
                    <text x={x} y="278" textAnchor="middle" className="tech-axis-label">
                      <tspan x={x}>{ward}</tspan>
                      <tspan x={x} dy="17">
                        {city}
                      </tspan>
                    </text>
                    <title>{describe(row)}</title>
                  </g>
                )
              })}
            </svg>
          </div>
          <p className="tech-chart-value" aria-live="polite">
            {active
              ? describe(active)
              : t('Showing the {count} areas with the most technicians.', {
                  count: reportCount(rows.length, locale),
                })}
          </p>
        </>
      ) : (
        <p className="tech-empty">{t('No valid service areas have been registered.')}</p>
      )}
      <p className="tech-chart-caption">
        {t(
          'Area shares divide by all technician profiles and may overlap. They do not have to add up to 100%.'
        )}
      </p>
      <details className="tech-detail-table">
        <summary>{t('View all service areas')}</summary>
        <div>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('Service area')}</th>
                <th scope="col">{t('Technicians')}</th>
                <th scope="col">{t('Share of all technicians')}</th>
              </tr>
            </thead>
            <tbody>
              {areas.items.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{reportCount(row.count, locale)}</td>
                  <td>{reportPercent(row.percentage, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="tech-note">
        {t('{covered} profiles have valid coverage; {unassigned} have no valid service area.', {
          covered: reportCount(areas.coveredTechnicians, locale),
          unassigned: reportCount(areas.unassignedTechnicians, locale),
        })}{' '}
        {t('Average per area counts coverage assignments, not unique people across all areas.')}
      </p>
    </section>
  )
}
