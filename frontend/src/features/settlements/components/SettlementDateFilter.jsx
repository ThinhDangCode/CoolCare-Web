import { useEffect, useRef, useState } from 'react'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import MonthYearPicker from '../../payments/components/MonthYearPicker.jsx'
import { defaultRevenuePeriod } from '../../payments/revenueReport.js'
import {
  settlementMonthRange,
  settlementPeriodLabel,
  settlementRangeError,
} from '../settlementFilters.js'

export default function SettlementDateFilter({ filters, onChange }) {
  const { t } = useUiPreferences()
  const [mode, setMode] = useState('')
  const [range, setRange] = useState({ from: filters.from, to: filters.to })
  const wrapperRef = useRef(null)
  const triggerRef = useRef(null)
  const monthRef = useRef(null)
  const fromRef = useRef(null)
  const selected = filters.from
    ? { year: filters.from.slice(0, 4), month: filters.from.slice(5, 7) }
    : defaultRevenuePeriod()
  const label = settlementPeriodLabel(filters, t)
  const error = settlementRangeError(range)
  useEffect(() => {
    if (!mode) return undefined
    if (mode === 'month') monthRef.current?.focus()
    else fromRef.current?.focus()
    const dismiss = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setMode('')
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [mode])
  const close = () => {
    setMode('')
    triggerRef.current?.focus()
  }
  return (
    <div
      className="settlements-date-filter"
      ref={wrapperRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="settlements-date-button"
        aria-label={`${t('Filter by settlement period start')}: ${label}`}
        aria-expanded={Boolean(mode)}
        aria-controls={mode ? 'settlements-date-options' : undefined}
        title={t('Settlement period start · Vietnam time (UTC+7)')}
        onClick={() => setMode((current) => (current ? '' : 'month'))}
      >
        <span>{label}</span>
        <img src="/settlements/calendar.svg" width="13.5" height="15" alt="" />
      </button>
      {mode && (
        <div
          id="settlements-date-options"
          className="settlements-date-options"
          role="group"
          aria-label={t('Settlement period start')}
        >
          {mode === 'month' ? (
            <>
              <MonthYearPicker
                year={selected.year}
                month={selected.month}
                triggerRef={monthRef}
                onChange={({ year, month }) => {
                  const next = settlementMonthRange(year, month)
                  if (!next) return
                  onChange(next)
                  close()
                }}
              />
              <p>{t('Filter by the start date of each weekly period.')}</p>
              <div className="settlements-date-actions">
                <button
                  type="button"
                  onClick={() => {
                    setRange({ from: filters.from, to: filters.to })
                    setMode('custom')
                  }}
                >
                  {t('Custom dates')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ from: '', to: '' })
                    close()
                  }}
                >
                  {t('All time')}
                </button>
                <button type="button" onClick={close}>
                  {t('Close')}
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const values = new FormData(event.currentTarget)
                const submitted = { from: values.get('from') ?? '', to: values.get('to') ?? '' }
                if (settlementRangeError(submitted)) {
                  setRange(submitted)
                  return
                }
                onChange(submitted)
                close()
              }}
            >
              <h2>{t('Settlement period start')}</h2>
              <p>{t('Calendar dates in Vietnam time (UTC+7).')}</p>
              <label>
                {t('From date')}
                <input
                  ref={fromRef}
                  name="from"
                  type="date"
                  min="0001-01-01"
                  max={range.to || '9999-12-31'}
                  value={range.from}
                  onChange={(event) =>
                    setRange((current) => ({ ...current, from: event.target.value }))
                  }
                />
              </label>
              <label>
                {t('To date')}
                <input
                  name="to"
                  type="date"
                  min={range.from || '0001-01-01'}
                  max="9999-12-31"
                  value={range.to}
                  onChange={(event) =>
                    setRange((current) => ({ ...current, to: event.target.value }))
                  }
                />
              </label>
              {error && (
                <p className="settlements-range-error" role="alert">
                  {t(error)}
                </p>
              )}
              <div className="settlements-date-actions">
                <button
                  type="button"
                  onClick={() => {
                    onChange({ from: '', to: '' })
                    close()
                  }}
                >
                  {t('All time')}
                </button>
                <button type="button" onClick={close}>
                  {t('Cancel')}
                </button>
                <button type="submit" className="settlements-apply" disabled={Boolean(error)}>
                  {t('Apply')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
