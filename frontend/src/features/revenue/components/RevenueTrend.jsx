import { useId, useState } from 'react'
import {
  compactRevenueAmount,
  displayRevenueDate,
  formatRevenueAmount,
  revenueAreaPath,
  revenueLinePath,
  revenueNumber,
} from '../revenuePresentation.js'

export default function RevenueTrend({ rows, period }) {
  const id = useId()
  const [activeKey, setActiveKey] = useState(null)
  const active = rows.find((row) => row.key === activeKey)
  const values = rows.flatMap((row) => [
    revenueNumber(row.amount),
    revenueNumber(row.previousAmount),
  ])
  const largest = Math.max(0, ...values.filter((value) => value !== null))
  const magnitude = 10 ** Math.floor(Math.log10(largest || 1))
  const maximum = largest ? Math.ceil(largest / magnitude) * magnitude : 10000
  const left = 78
  const right = 940
  const top = 24
  const bottom = 248
  const point = (value, index) => ({
    x: rows.length > 1 ? left + ((right - left) * index) / (rows.length - 1) : left,
    y: bottom - ((bottom - top) * value) / maximum,
  })
  const labelStep = Math.max(1, Math.ceil(rows.length / 8))
  const currentPath = revenueLinePath(rows, 'amount', point)
  const currentArea = revenueAreaPath(rows, 'amount', point, bottom)
  const previousPath = revenueLinePath(rows, 'previousAmount', point)
  const pointLabel = (row) =>
    `${row.label}: current period ${formatRevenueAmount(row.amount)}, previous period ${formatRevenueAmount(row.previousAmount)}`

  return (
    <section className="revenue-card revenue-trend" aria-labelledby={`${id}-title`}>
      <div className="revenue-card-heading">
        <div>
          <h2 id={`${id}-title`}>Revenue Trend</h2>
          <p>
            {displayRevenueDate(period.from)} – {displayRevenueDate(period.to)} · Same filters for
            both periods
          </p>
        </div>
        <div className="revenue-chart-legend" aria-label="Chart legend">
          <span>
            <i className="current" /> Current period
          </span>
          <span>
            <i className="previous" /> Previous period
          </span>
        </div>
      </div>
      <div className="revenue-chart-scroll" onPointerLeave={() => setActiveKey(null)}>
        <svg className="revenue-chart" viewBox="0 0 960 288" aria-labelledby={`${id}-title`}>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--orange)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--orange)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <desc>
            Recorded platform commission in Vietnamese dong. Missing amounts and days outside a
            calendar month leave a gap. Focus a point to read both values, or open the data table.
          </desc>
          {[0, 1, 2, 3, 4].map((tick) => {
            const value = (maximum * tick) / 4
            const y = point(value, 0).y
            return (
              <g key={tick}>
                <line x1={left} x2={right} y1={y} y2={y} className="revenue-gridline" />
                <text x={left - 12} y={y + 4} textAnchor="end" className="revenue-axis-label">
                  {compactRevenueAmount(value)}
                </text>
              </g>
            )
          })}
          <path d={currentArea} fill={`url(#${id}-fill)`} className="revenue-area" />
          <path d={previousPath} className="revenue-line previous" />
          <path d={currentPath} className="revenue-line current" />
          {rows.map((row, index) => {
            const { x } = point(0, index)
            const current = revenueNumber(row.amount)
            const previous = revenueNumber(row.previousAmount)
            return (
              <g
                key={row.key}
                tabIndex={0}
                role="img"
                aria-label={pointLabel(row)}
                className="revenue-chart-point"
                onFocus={() => setActiveKey(row.key)}
                onBlur={() => setActiveKey(null)}
                onPointerEnter={() => setActiveKey(row.key)}
                onClick={() => setActiveKey(row.key)}
              >
                <title>{pointLabel(row)}</title>
                <rect
                  x={x - Math.max(8, (right - left) / Math.max(1, rows.length - 1) / 2)}
                  y={top}
                  width={Math.max(16, (right - left) / Math.max(1, rows.length - 1))}
                  height={bottom - top}
                  className="revenue-point-target"
                />
                {current !== null && (
                  <circle
                    cx={x}
                    cy={point(current, index).y}
                    r={row.key === activeKey ? 5 : 3}
                    className="revenue-dot current"
                  />
                )}
                {previous !== null && row.key === activeKey && (
                  <circle
                    cx={x}
                    cy={point(previous, index).y}
                    r={4}
                    className="revenue-dot previous"
                  />
                )}
                {(index % labelStep === 0 || index === rows.length - 1) && (
                  <text x={x} y={bottom + 24} textAnchor="middle" className="revenue-axis-label">
                    {row.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <p className="revenue-chart-value" aria-live="polite">
        {active ? (
          <>
            <strong>{active.label}</strong> · Current: {formatRevenueAmount(active.amount)} ·
            Previous: {formatRevenueAmount(active.previousAmount)}
            {active.amount === null && active.knownAmount !== null && (
              <> · Known partial amount: {formatRevenueAmount(active.knownAmount)}</>
            )}
          </>
        ) : (
          'Hover or focus a point to see its values. — means missing data or a day outside the month.'
        )}
      </p>
      <details className="revenue-trend-table">
        <summary>View chart data</summary>
        <div>
          <table>
            <caption>
              Current: {displayRevenueDate(period.from)} – {displayRevenueDate(period.to)}.
              Previous: {displayRevenueDate(period.previousFrom)} –{' '}
              {displayRevenueDate(period.previousTo)}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Day / month</th>
                <th scope="col">Current revenue</th>
                <th scope="col">Known partial amount</th>
                <th scope="col">Previous revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{formatRevenueAmount(row.amount)}</td>
                  <td>{row.amount === null ? formatRevenueAmount(row.knownAmount) : '—'}</td>
                  <td>{formatRevenueAmount(row.previousAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
