import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDownIcon, CloseIcon } from '../../management/components/ManagementShared.jsx'
import MonthYearPicker from './MonthYearPicker.jsx'
import { exportRevenueReport } from '../api/paymentsApi.js'
import {
  defaultRevenuePeriod,
  deriveRevenueRange,
  downloadRevenueBlob,
  reportMethods,
} from '../revenueReport.js'
import './exportRevenue.css'

const displayDate = (value) => value.split('-').reverse().join('/')
const modes = { month: 'Month', quarter: 'Quarter', year: 'Year', custom: 'Custom range' }

export default function ExportRevenueDialog({
  token,
  initialSearch = '',
  initialMethod = 'ALL',
  onClose,
  onUnauthorized,
  returnFocusRef,
}) {
  const [period, setPeriod] = useState(defaultRevenuePeriod)
  const [method, setMethod] = useState(
    Object.hasOwn(reportMethods, initialMethod) ? initialMethod : 'ALL'
  )
  const [search, setSearch] = useState(initialSearch.trim().slice(0, 150))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const dialogRef = useRef(null)
  const initialFocusRef = useRef(null)
  const requestRef = useRef(null)
  const range = deriveRevenueRange(period)

  useEffect(() => {
    const previousFocus = document.activeElement
    const returnFocusTarget = returnFocusRef?.current ?? previousFocus
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    initialFocusRef.current?.focus()
    return () => {
      requestRef.current?.abort()
      requestRef.current = null
      document.body.style.overflow = previousOverflow
      if (returnFocusTarget instanceof HTMLElement && returnFocusTarget.isConnected)
        returnFocusTarget.focus()
    }
  }, [returnFocusRef])

  const close = () => {
    requestRef.current?.abort()
    requestRef.current = null
    onClose()
  }
  const clearOutcome = () => {
    setError('')
    setNotice('')
  }
  const changePeriod = (values) => {
    setPeriod((current) => ({ ...current, ...values }))
    clearOutcome()
  }

  const trapFocus = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(
      dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]'
      )
    )
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (!controls.includes(document.activeElement)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first)?.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (requestRef.current || range.error) return
    const controller = new AbortController()
    requestRef.current = controller
    dialogRef.current?.focus()
    setBusy(true)
    clearOutcome()
    try {
      const result = await exportRevenueReport(
        { from: range.from, to: range.to, method, search: search.trim() },
        token,
        controller.signal
      )
      if (controller.signal.aborted || requestRef.current !== controller) return
      downloadRevenueBlob(result.blob, result.filename)
      setNotice(
        result.rowCount === 0
          ? `No successful payments matched this period and filters. The workbook was downloaded as ${result.filename}.`
          : `${result.filename} downloaded.${result.rowCount === null ? '' : ` ${result.rowCount.toLocaleString('en-US')} successful ${result.rowCount === 1 ? 'payment' : 'payments'} included.`}`
      )
    } catch (err) {
      if (controller.signal.aborted || requestRef.current !== controller) return
      if (err.status === 401) {
        onUnauthorized()
        return
      }
      setError(
        err.code === 'REPORT_TOO_LARGE'
          ? 'More than 10,000 successful payments matched. Narrow the period or filters and try again.'
          : err.message
      )
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        if (!controller.signal.aborted) setBusy(false)
      }
    }
  }

  return createPortal(
    <div
      className="export-revenue-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        ref={dialogRef}
        className="export-revenue-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-revenue-title"
        aria-describedby="export-revenue-description"
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <header>
          <div>
            <h2 id="export-revenue-title">Export Revenue Report</h2>
            <p id="export-revenue-description">
              Download an Excel workbook with Revenue Summary and Paid Payments sheets.
            </p>
          </div>
          <button
            type="button"
            className="export-revenue-close"
            aria-label="Close revenue export"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="export-revenue-body">
            <div className="export-revenue-basis">
              <strong>Successful payments only</strong>
              <span>Gross customer payment total · Paid date · Vietnam time (UTC+7)</span>
              <p>
                The report period uses paid date. The payment list date filter uses created date.
              </p>
            </div>
            <fieldset disabled={busy}>
              <legend>Report period</legend>
              <div className="export-revenue-modes" role="group" aria-label="Choose report period">
                {Object.entries(modes).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={period.mode === value ? 'active' : ''}
                    aria-pressed={period.mode === value}
                    onClick={() => changePeriod({ mode: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="export-revenue-period-fields">
                {period.mode === 'month' && (
                  <MonthYearPicker
                    year={period.year}
                    month={period.month}
                    triggerRef={initialFocusRef}
                    onChange={({ year, month }) =>
                      changePeriod({ year, month, quarter: String(Math.ceil(Number(month) / 3)) })
                    }
                  />
                )}
                {period.mode === 'quarter' && (
                  <label>
                    Quarter
                    <span className="export-revenue-select">
                      <select
                        aria-label="Report quarter"
                        value={period.quarter}
                        onChange={(event) => changePeriod({ quarter: event.currentTarget.value })}
                        required
                      >
                        <option value="1">Q1 · January – March</option>
                        <option value="2">Q2 · April – June</option>
                        <option value="3">Q3 · July – September</option>
                        <option value="4">Q4 · October – December</option>
                      </select>
                      <ChevronDownIcon />
                    </span>
                  </label>
                )}
                {['quarter', 'year'].includes(period.mode) && (
                  <label>
                    Year
                    <input
                      type="number"
                      required
                      min="1900"
                      max="9999"
                      step="1"
                      value={period.year}
                      onChange={(event) => changePeriod({ year: event.currentTarget.value })}
                    />
                  </label>
                )}
                {period.mode === 'custom' && (
                  <>
                    <label>
                      From date
                      <input
                        type="date"
                        required
                        min="1900-01-01"
                        max="9999-12-31"
                        value={period.from}
                        onChange={(event) => changePeriod({ from: event.currentTarget.value })}
                      />
                    </label>
                    <label>
                      To date
                      <input
                        type="date"
                        required
                        min="1900-01-01"
                        max="9999-12-31"
                        value={period.to}
                        onChange={(event) => changePeriod({ to: event.currentTarget.value })}
                      />
                    </label>
                  </>
                )}
              </div>
              {range.error ? (
                <p className="export-revenue-validation" role="alert">
                  {range.error}
                </p>
              ) : (
                <p className="export-revenue-range">
                  {displayDate(range.from)} – {displayDate(range.to)} · Inclusive paid dates
                </p>
              )}
              <div className="export-revenue-filters">
                <label>
                  Payment method
                  <span className="export-revenue-select">
                    <select
                      value={method}
                      onChange={(event) => {
                        setMethod(event.currentTarget.value)
                        clearOutcome()
                      }}
                    >
                      {Object.entries(reportMethods).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </span>
                </label>
                <label>
                  Search
                  <input
                    type="search"
                    maxLength={150}
                    value={search}
                    placeholder="Payment, booking, customer…"
                    onChange={(event) => {
                      setSearch(event.currentTarget.value)
                      clearOutcome()
                    }}
                  />
                </label>
              </div>
              <p className="export-revenue-filter-help">
                Method and search are copied from the list. Changes here apply to this export.
              </p>
            </fieldset>
            {busy && (
              <p className="export-revenue-progress" role="status">
                Preparing your Excel report…
              </p>
            )}
            {error && (
              <div className="export-revenue-message error" role="alert">
                <strong>Unable to export report</strong>
                <span>{error}</span>
              </div>
            )}
            {notice && (
              <div className="export-revenue-message success" role="status">
                {notice}
              </div>
            )}
          </div>
          <footer>
            <button type="button" className="export-revenue-cancel" onClick={close}>
              {busy ? 'Cancel export' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="export-revenue-submit"
              disabled={busy || Boolean(range.error)}
            >
              {busy ? 'Exporting…' : error ? 'Retry export' : 'Export report'}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}
