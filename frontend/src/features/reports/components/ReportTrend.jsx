import { useId, useState } from 'react'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import {
  reportAxisLabel,
  reportBucketLabel,
  reportChartSeries,
  reportCount,
  reportDate,
  reportMoney,
} from '../reportPresentation.js'

function chartPaths(values, point, baseline) {
  const lines = []
  const areas = []
  let segment = []
  const finish = () => {
    if (!segment.length) return
    const line = segment
      .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ')
    lines.push(line)
    areas.push(
      `${line} L${segment.at(-1).x.toFixed(2)},${baseline} L${segment[0].x.toFixed(2)},${baseline} Z`
    )
    segment = []
  }
  values.forEach((value, index) => {
    if (value === null) finish()
    else segment.push(point(value, index))
  })
  finish()
  return { line: lines.join(' '), area: areas.join(' ') }
}

export function ReportSparkline({ rows }) {
  const id = useId()
  const series = reportChartSeries(rows, 'commission')
  const point = (value, index) => ({
    x: 4 + (index * 272) / Math.max(1, rows.length - 1),
    y: 76 - series.ratio(value) * 62,
  })
  const paths = chartPaths(series.values, point, 80)
  return (
    <svg className="reports-sparkline" viewBox="0 0 280 84" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--orange)" stopOpacity=".22" />
          <stop offset="100%" stopColor="var(--orange)" stopOpacity=".01" />
        </linearGradient>
      </defs>
      <path d={paths.area} fill={`url(#${id}-fill)`} />
      <path d={paths.line} className="reports-chart-line" />
    </svg>
  )
}

export default function ReportTrend({ rows, period }) {
  const id = useId()
  const { t, locale } = useUiPreferences()
  const [metric, setMetric] = useState('bookings')
  const [activeDate, setActiveDate] = useState(null)
  const active = rows.find((row) => row.date === activeDate)
  const series = reportChartSeries(rows, metric)
  const left = 86
  const right = 946
  const bottom = 264
  const top = 24
  const point = (value, index) => ({
    x:
      rows.length === 1
        ? (left + right) / 2
        : left + (index * (right - left)) / Math.max(1, rows.length - 1),
    y: bottom - series.ratio(value) * (bottom - top),
  })
  const paths = chartPaths(series.values, point, bottom)
  const labelStep = Math.max(1, Math.ceil(rows.length / 7))
  const label = (row) =>
    t(
      row.commissionAmount === null
        ? '{date}: {count} bookings; commission unavailable; known partial amount {amount}'
        : '{date}: {count} bookings; commission {amount}',
      {
        date:
          period.granularity === 'month'
            ? reportBucketLabel(row.date, 'month')
            : reportDate(row.date),
        count: reportCount(row.bookings, locale),
        amount: reportMoney(
          row.commissionAmount === null ? row.knownCommissionAmount : row.commissionAmount,
          locale
        ),
      }
    )

  return (
    <section className="reports-card reports-trend" aria-labelledby={`${id}-title`}>
      <div className="reports-card-heading">
        <div>
          <h2 id={`${id}-title`}>{t('Platform Performance Trend')}</h2>
          <p>
            {t('{frequency} · {basis}', {
              frequency: t(period.granularity === 'month' ? 'Monthly totals' : 'Daily totals'),
              basis: t(
                metric === 'commission'
                  ? 'Commission in VND, by settlement date'
                  : 'Bookings by creation date'
              ),
            })}
          </p>
        </div>
        <div className="reports-metric-picker" role="group" aria-label={t('Chart metric')}>
          <button
            type="button"
            aria-pressed={metric === 'bookings'}
            onClick={() => setMetric('bookings')}
          >
            {t('Bookings')}
          </button>
          <button
            type="button"
            aria-pressed={metric === 'commission'}
            onClick={() => setMetric('commission')}
          >
            {t('Commission')}
          </button>
        </div>
      </div>
      <div className="reports-chart-scroll" onPointerLeave={() => setActiveDate(null)}>
        <svg className="reports-chart" viewBox="0 0 980 310" aria-labelledby={`${id}-title`}>
          <desc>
            {t(
              'Choose a metric to view bookings or commission on its own axis. Focus a point for exact values, or open the chart data table. Unavailable commission leaves a gap.'
            )}
          </desc>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--orange)" stopOpacity=".20" />
              <stop offset="100%" stopColor="var(--orange)" stopOpacity=".01" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((tick) => {
            const y = bottom - (tick * (bottom - top)) / 4
            return (
              <g key={tick}>
                <line x1={left} x2={right} y1={y} y2={y} className="reports-gridline" />
                <text x={left - 12} y={y + 4} textAnchor="end" className="reports-axis-label">
                  {reportAxisLabel((series.maximum * BigInt(tick)) / 4n, metric, locale)}
                </text>
              </g>
            )
          })}
          <path d={paths.area} fill={`url(#${id}-fill)`} />
          <path d={paths.line} className="reports-chart-line" />
          {rows.map((row, index) => {
            const value = series.values[index]
            const x = point(0n, index).x
            const targetWidth =
              rows.length === 1 ? 30 : Math.max(14, (right - left) / (rows.length - 1))
            const targetLeft = Math.max(left, x - targetWidth / 2)
            return (
              <g
                key={row.date}
                tabIndex={0}
                role="img"
                aria-label={label(row)}
                className="reports-chart-point"
                onFocus={() => setActiveDate(row.date)}
                onBlur={() => setActiveDate(null)}
                onPointerEnter={() => setActiveDate(row.date)}
                onClick={() => setActiveDate(row.date)}
              >
                <title>{label(row)}</title>
                <rect
                  x={targetLeft}
                  y={top}
                  width={Math.min(right, x + targetWidth / 2) - targetLeft}
                  height={bottom - top}
                  className="reports-point-target"
                />
                {value !== null && (
                  <circle
                    cx={x}
                    cy={point(value, index).y}
                    r={activeDate === row.date ? 5 : 3}
                    className="reports-chart-dot"
                  />
                )}
                {(index % labelStep === 0 || index === rows.length - 1) && (
                  <text x={x} y={bottom + 26} textAnchor="middle" className="reports-axis-label">
                    {reportBucketLabel(row.date, period.granularity)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <p className="reports-chart-value" aria-live="polite">
        {active ? label(active) : t('Hover or focus a point to view exact values.')}
        {metric === 'commission' && (
          <> {t('Axis labels are rounded; amounts below remain exact.')}</>
        )}
      </p>
      <details className="reports-data-table">
        <summary>{t('View chart data')}</summary>
        <div>
          <table>
            <caption>
              {t(
                '{from} – {to} · Vietnam time (UTC+7). Bookings use creation date; commission uses settlement date.',
                { from: reportDate(period.from), to: reportDate(period.to) }
              )}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t(period.granularity === 'month' ? 'Month' : 'Date')}</th>
                <th scope="col">{t('Bookings')}</th>
                <th scope="col">{t('Commission')}</th>
                <th scope="col">{t('Known partial commission')}</th>
                <th scope="col">{t('Settled payments')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date}>
                  <th scope="row">
                    {period.granularity === 'month'
                      ? reportBucketLabel(row.date, 'month')
                      : reportDate(row.date)}
                  </th>
                  <td>{reportCount(row.bookings, locale)}</td>
                  <td>{reportMoney(row.commissionAmount, locale)}</td>
                  <td>
                    {row.commissionAmount === null
                      ? reportMoney(row.knownCommissionAmount, locale)
                      : '—'}
                  </td>
                  <td>{reportCount(row.settledPayments, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
