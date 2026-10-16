import { useEffect, useId, useRef, useState } from 'react'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { currentTopupMonth, topupRangeError, topupRangeLabel } from '../topupFilters.js'

export default function TopupDateFilter({ value, onChange }) {
  const { t } = useUiPreferences()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ from: '', to: '' })
  const wrapperRef = useRef(null)
  const buttonRef = useRef(null)
  const fromRef = useRef(null)
  const error = topupRangeError(draft)
  const rangeLabel = (range) =>
    topupRangeLabel(range)
      .split(' – ')
      .map((part) => t(part))
      .join(' – ')

  useEffect(() => {
    if (!open) return
    fromRef.current?.focus()
    const dismiss = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }
  const apply = (range) => {
    onChange(range)
    close()
  }

  return (
    <div
      ref={wrapperRef}
      className="topups-date-filter"
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="topups-date-button"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        aria-label={t('Filter top-up date: {range}', { range: rangeLabel(value) })}
        onClick={() => {
          if (!open) setDraft({ from: value.from, to: value.to })
          setOpen((current) => !current)
        }}
      >
        <img src="/topups/calendar.svg" alt="" />
        <span>{rangeLabel(value)}</span>
        <img src="/topups/date-chevron.svg" alt="" />
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className="topups-calendar"
          role="group"
          aria-label={t('Top-up date range')}
        >
          <h2>{t('Top-up date')}</h2>
          <p>{t('Created date · Vietnam time (UTC+7)')}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!error) apply(draft)
            }}
          >
            <label>
              {t('From date')}
              <input
                ref={fromRef}
                type="date"
                min="0001-01-01"
                max={draft.to || '9999-12-31'}
                value={draft.from}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, from: event.target.value }))
                }
              />
            </label>
            <label>
              {t('To date')}
              <input
                type="date"
                min={draft.from || '0001-01-01'}
                max="9999-12-31"
                value={draft.to}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, to: event.target.value }))
                }
              />
            </label>
            {error && (
              <p className="topups-date-error" role="alert">
                {t(error)}
              </p>
            )}
            <footer>
              <button type="button" onClick={() => apply({ from: '', to: '' })}>
                {t('All time')}
              </button>
              <button type="button" onClick={() => apply(currentTopupMonth())}>
                {t('This month')}
              </button>
              <button type="submit" className="topups-apply" disabled={Boolean(error)}>
                {t('Apply')}
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  )
}
