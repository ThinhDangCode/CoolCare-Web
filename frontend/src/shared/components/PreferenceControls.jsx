import { useEffect, useRef, useState } from 'react'
import { useUiPreferences } from '../context/UiPreferencesContext.jsx'

const languages = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
]

function FlagIcon({ code }) {
  if (code === 'vi') {
    return (
      <span className="language-flag vietnam-flag" aria-hidden="true">
        ★
      </span>
    )
  }
  return (
    <svg className="language-flag british-flag" viewBox="0 0 28 18" aria-hidden="true">
      <rect width="28" height="18" rx="3" fill="#24468e" />
      <path d="M0 0 28 18M28 0 0 18" stroke="#fff" strokeWidth="4" />
      <path d="M0 0 28 18M28 0 0 18" stroke="#d52b35" strokeWidth="2" />
      <path d="M14 0v18M0 9h28" stroke="#fff" strokeWidth="6" />
      <path d="M14 0v18M0 9h28" stroke="#d52b35" strokeWidth="3" />
    </svg>
  )
}

export function LanguageControl({ compact = false }) {
  const { locale, setLocale, t } = useUiPreferences()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const current = languages.find((language) => language.code === locale) ?? languages[0]

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  return (
    <div className="language-control" ref={rootRef}>
      <button
        className="language-trigger"
        type="button"
        aria-label={t('language')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <FlagIcon code={current.code} />
        <span className={compact ? 'language-name compact-label' : 'language-name'}>
          {current.label}
        </span>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="language-menu" role="menu">
          {languages.map((language) => (
            <button
              className={locale === language.code ? 'active' : ''}
              type="button"
              role="menuitemradio"
              aria-checked={locale === language.code}
              key={language.code}
              onClick={() => {
                setLocale(language.code)
                setOpen(false)
              }}
            >
              <FlagIcon code={language.code} />
              <span>{language.label}</span>
              {locale === language.code && <span className="language-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ThemeControl() {
  const { theme, toggleTheme, t } = useUiPreferences()
  return (
    <button
      className="theme-control"
      type="button"
      onClick={toggleTheme}
      aria-label={`${t('theme')}: ${t(theme)}`}
      title={`${t('theme')}: ${t(theme)}`}
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.5 14.2A8 8 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />
        </svg>
      )}
    </button>
  )
}

export function PreferenceControls({ compact = false }) {
  return (
    <div className={`preference-controls${compact ? ' compact' : ''}`}>
      <LanguageControl compact={compact} />
      <ThemeControl />
    </div>
  )
}
