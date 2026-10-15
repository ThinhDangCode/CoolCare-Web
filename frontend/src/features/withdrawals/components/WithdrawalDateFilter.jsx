import { useEffect, useId, useRef, useState } from 'react'
import {
  currentWithdrawalMonth,
  withdrawalRangeError,
  withdrawalRangeLabel,
} from '../withdrawalFilters.js'

export default function WithdrawalDateFilter({ value, onChange }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ from: '', to: '' })
  const wrapperRef = useRef(null)
  const buttonRef = useRef(null)
  const fromRef = useRef(null)
  const error = withdrawalRangeError(draft)

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
      className="withdrawals-date-filter"
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
        className="withdrawals-date-button"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        aria-label={`Filter withdrawal date: ${withdrawalRangeLabel(value)}`}
        onClick={() => {
          if (!open) setDraft({ from: value.from, to: value.to })
          setOpen((current) => !current)
        }}
      >
        <span>{withdrawalRangeLabel(value)}</span>
        <img src="/withdrawals/calendar.svg" alt="" />
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className="withdrawals-calendar"
          role="group"
          aria-label="Withdrawal date range"
        >
          <h2>Withdrawal date</h2>
          <p>Initiated date · Vietnam time (UTC+7)</p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!error) apply(draft)
            }}
          >
            <label>
              From date
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
              To date
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
              <p className="withdrawals-date-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button type="button" onClick={() => apply({ from: '', to: '' })}>
                All time
              </button>
              <button type="button" onClick={() => apply(currentWithdrawalMonth())}>
                This month
              </button>
              <button type="submit" className="withdrawals-apply" disabled={Boolean(error)}>
                Apply
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  )
}
