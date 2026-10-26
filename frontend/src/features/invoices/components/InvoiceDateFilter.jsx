import { useEffect, useRef, useState } from 'react'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import MonthYearPicker from '../../payments/components/MonthYearPicker.jsx'
import { defaultRevenuePeriod } from '../../payments/revenueReport.js'
import { invoiceMonthRange, invoicePeriodLabel } from '../invoiceFilters.js'

export default function InvoiceDateFilter({ filters, onChange }) {
  const { t } = useUiPreferences()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const triggerRef = useRef(null)
  const monthTriggerRef = useRef(null)
  const selected = filters.from
    ? { year: filters.from.slice(0, 4), month: filters.from.slice(5, 7) }
    : defaultRevenuePeriod()
  const label = t(invoicePeriodLabel(filters))

  useEffect(() => {
    if (!open) return undefined
    monthTriggerRef.current?.focus()
    const dismiss = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div
      className="invoices-date-filter"
      ref={wrapperRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="invoices-date-button"
        aria-label={`${t('Filter invoices by issued month')}: ${label}`}
        aria-expanded={open}
        aria-controls={open ? 'invoices-date-options' : undefined}
        title={t('Invoice issue date · Vietnam time (UTC+7)')}
        onClick={() => setOpen((current) => !current)}
      >
        <img src="/invoices/calendar.svg" width="10.5" height="12" alt="" />
        <span>{label}</span>
        <img src="/invoices/chevron.svg" width="8.75" height="5" alt="" />
      </button>
      {open && (
        <div
          id="invoices-date-options"
          className="invoices-date-options"
          role="group"
          aria-label={t('Invoice issue date')}
        >
          <MonthYearPicker
            year={selected.year}
            month={selected.month}
            triggerRef={monthTriggerRef}
            onChange={({ year, month }) => {
              const range = invoiceMonthRange(year, month)
              if (!range) return
              onChange(range)
              close()
            }}
          />
          <p>{t('Calendar dates in Vietnam time (UTC+7).')}</p>
          <div className="invoices-date-actions">
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
        </div>
      )}
    </div>
  )
}
