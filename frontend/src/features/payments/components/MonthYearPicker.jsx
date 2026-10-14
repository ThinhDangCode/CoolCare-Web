import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { CalendarIcon } from '../../../shared/components/AdminUi.jsx'
import { defaultRevenuePeriod } from '../revenueReport.js'
import './monthYearPicker.css'

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const isValidYear = (value) => /^\d{4}$/.test(String(value)) && Number(value) >= 1900

export default function MonthYearPicker({ year, month, onChange, triggerRef }) {
  const id = useId()
  const wrapperRef = useRef(null)
  const yearRef = useRef(null)
  const popupRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [browseYear, setBrowseYear] = useState(() =>
    isValidYear(year) ? String(year) : defaultRevenuePeriod().year
  )
  const validBrowseYear = isValidYear(browseYear)
  const validSelection =
    isValidYear(year) &&
    /^\d{1,2}$/.test(String(month)) &&
    Number(month) >= 1 &&
    Number(month) <= 12
  const value = validSelection ? `${String(month).padStart(2, '0')}/${year}` : 'Choose month / year'

  useEffect(() => {
    if (!open) return
    yearRef.current?.focus()
    const dismissOutside = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const wrapper = wrapperRef.current
    const trigger = wrapper.querySelector('.payment-month-picker-trigger')
    const popup = popupRef.current
    const dialog = wrapper.closest('[role="dialog"]')
    const positionPopup = () => {
      const triggerRect = trigger.getBoundingClientRect()
      const dialogRect = dialog?.getBoundingClientRect()
      const footerRect = dialog?.querySelector('form > footer')?.getBoundingClientRect()
      const topEdge = Math.max(8, (dialogRect?.top ?? 0) + 8)
      const bottomEdge = Math.min(
        window.innerHeight - 8,
        (footerRect?.top ?? dialogRect?.bottom ?? window.innerHeight) - 8
      )
      const below = Math.max(0, bottomEdge - triggerRect.bottom - 7)
      const above = Math.max(0, triggerRect.top - topEdge - 7)
      const naturalHeight = popup.scrollHeight + 2
      const showAbove = below < naturalHeight && above > below
      popup.style.maxHeight = `${showAbove ? above : below}px`
      popup.style.top = showAbove
        ? `${trigger.offsetTop - popup.getBoundingClientRect().height - 7}px`
        : `${trigger.offsetTop + trigger.offsetHeight + 7}px`
    }
    positionPopup()
    window.addEventListener('resize', positionPopup)
    dialog?.addEventListener('scroll', positionPopup)
    return () => {
      window.removeEventListener('resize', positionPopup)
      dialog?.removeEventListener('scroll', positionPopup)
    }
  }, [open, validBrowseYear])

  const closeAndFocus = () => {
    setOpen(false)
    wrapperRef.current?.querySelector('.payment-month-picker-trigger')?.focus()
  }

  return (
    <div
      ref={wrapperRef}
      className="payment-month-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeAndFocus()
        }
      }}
    >
      <span id={`${id}-label`} className="payment-month-picker-label">
        Month / Year
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="payment-month-picker-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-controls={open ? `${id}-popup` : undefined}
        onClick={(event) => {
          if (event.currentTarget.matches(':disabled')) return
          if (open) {
            setOpen(false)
            return
          }
          setBrowseYear(isValidYear(year) ? String(year) : defaultRevenuePeriod().year)
          setOpen(true)
        }}
      >
        <span id={`${id}-value`}>{value}</span>
        <CalendarIcon />
      </button>
      {open && (
        <div
          ref={popupRef}
          id={`${id}-popup`}
          className="payment-month-picker-popup"
          role="group"
          aria-label="Choose month and year"
        >
          <div className="payment-month-picker-year">
            <button
              type="button"
              aria-label="Previous year"
              disabled={!validBrowseYear || Number(browseYear) <= 1900}
              onClick={() => setBrowseYear(String(Number(browseYear) - 1))}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m10 4-4 4 4 4" />
              </svg>
            </button>
            <input
              ref={yearRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              aria-label="Choose report year"
              aria-invalid={!validBrowseYear}
              aria-describedby={!validBrowseYear ? `${id}-error` : undefined}
              value={browseYear}
              onChange={(event) =>
                setBrowseYear(event.currentTarget.value.replace(/\D/g, '').slice(0, 4))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault()
              }}
            />
            <button
              type="button"
              aria-label="Next year"
              disabled={!validBrowseYear || Number(browseYear) >= 9999}
              onClick={() => setBrowseYear(String(Number(browseYear) + 1))}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m6 4 4 4-4 4" />
              </svg>
            </button>
          </div>
          {!validBrowseYear && (
            <p id={`${id}-error`} className="payment-month-picker-error" role="status">
              Enter a year from 1900 to 9999.
            </p>
          )}
          <div className="payment-month-picker-months">
            {months.map((label, index) => {
              const monthValue = String(index + 1).padStart(2, '0')
              const selected = String(year) === browseYear && Number(month) === index + 1
              return (
                <button
                  key={monthValue}
                  type="button"
                  aria-label={`${monthNames[index]} ${browseYear || 'year not selected'}`}
                  aria-pressed={selected}
                  disabled={!validBrowseYear}
                  onClick={() => {
                    onChange({ year: browseYear, month: monthValue })
                    closeAndFocus()
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
