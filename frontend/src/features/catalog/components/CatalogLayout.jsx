import { AdminHeaderControls } from '../../../shared/components/AdminUi.jsx'
import { useUiPreferences } from '../../../shared/context/UiPreferencesContext.jsx'
import '../../../shared/styles/admin.css'
import './catalogTables.css'

export function CatalogLayout({
  children,
  heading,
  actions,
  onRefresh,
  refreshing = false,
  className = '',
}) {
  const { t } = useUiPreferences()
  return (
    <main className={`dashboard-main ${className}`}>
      <header className="figma-utility-header figma-title-header">
        <div className="figma-header-title catalog-topbar-heading">
          {heading || <h1>{t('Catalog')}</h1>}
        </div>
        <AdminHeaderControls
          onRefresh={onRefresh}
          refreshing={refreshing}
          actions={actions}
        />
      </header>
      {children}
    </main>
  )
}
