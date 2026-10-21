import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import { technicianAssets } from '../technicianAssets.js'

export function TechnicianIcon({ name }) {
  const dimensions = technicianAssets[name]
  if (!dimensions) return null
  return (
    <img
      src={`/technician-statistics/${name}.svg`}
      alt=""
      width={dimensions.width}
      height={dimensions.height}
      aria-hidden="true"
    />
  )
}

export function TechnicianKpi({ title, value, note, icon, tone = 'blue', children }) {
  const { t } = useUiPreferences()
  return (
    <section className="tech-card tech-kpi" aria-label={t(title)}>
      <div>
        <h2>{t(title)}</h2>
        <span className={`tech-kpi-icon ${tone}`}>
          <TechnicianIcon name={icon} />
        </span>
      </div>
      <strong>{value}</strong>
      {note && <p>{t(note)}</p>}
      {children}
    </section>
  )
}

export function TechnicianHeading({ title, description, children }) {
  const { t } = useUiPreferences()
  return (
    <div className="tech-chart-heading">
      <div>
        <h2>{t(title)}</h2>
        {description && <p>{t(description)}</p>}
      </div>
      {children}
    </div>
  )
}
