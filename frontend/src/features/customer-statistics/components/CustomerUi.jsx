import { useState } from 'react'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { reportRangeError } from '../../reports/reportPresentation.js'
import { customerAssets } from '../customerAssets.js'

export function CustomerIcon({ name }) {
  const dimensions = customerAssets[name]
  if (!dimensions) return null
  return (
    <img
      src={`/customer-statistics/${name}.svg`}
      alt=""
      width={dimensions.width}
      height={dimensions.height}
      aria-hidden="true"
    />
  )
}

export function CustomerKpi({ title, value, note, icon, tone = 'blue', children }) {
  const { t } = useUiPreferences()
  return (
    <section className="customer-card customer-kpi" aria-label={t(title)}>
      <div>
        <h2>{t(title)}</h2>
        <span className={`customer-kpi-icon ${tone}`}>
          <CustomerIcon name={icon} />
        </span>
      </div>
      <strong>{value}</strong>
      {note && <p>{t(note)}</p>}
      {children}
    </section>
  )
}

export function CustomerHeading({ title, description, children }) {
  const { t } = useUiPreferences()
  return (
    <div className="customer-card-heading">
      <div>
        <h2>{t(title)}</h2>
        {description && <p>{t(description)}</p>}
      </div>
      {children}
    </div>
  )
}

export function CustomerDateForm({ range, onApply, onCancel }) {
  const { t } = useUiPreferences()
  const [draft, setDraft] = useState(range)
  const error = reportRangeError(draft)
  return (
    <form
      className="customer-date-form"
      aria-label={t('Custom report period')}
      onSubmit={(event) => {
        event.preventDefault()
        if (!error) onApply(draft)
      }}
    >
      <label>
        {t('From')}
        <input
          type="date"
          min="1900-01-01"
          max="9999-12-31"
          required
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.currentTarget.value })}
        />
      </label>
      <label>
        {t('To')}
        <input
          type="date"
          min="1900-01-01"
          max="9999-12-31"
          required
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: event.currentTarget.value })}
        />
      </label>
      <div className="customer-date-actions">
        <button type="button" onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button type="submit" className="customer-primary" disabled={Boolean(error)}>
          {t('Apply')}
        </button>
      </div>
      <p className={error ? 'customer-field-error' : ''} aria-live="polite">
        {t(error || 'Inclusive dates · Maximum 366 days · Vietnam time (UTC+7)')}
      </p>
    </form>
  )
}
