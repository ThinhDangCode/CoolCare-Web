export function Brand() {
  return (
    <div className="brand-lockup" aria-label="CoolCare Admin">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M16 3v26M5.7 9.5l20.6 13M26.3 9.5l-20.6 13M9.5 5.7l13 20.6M22.5 5.7l-13 20.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="16" cy="16" r="3" fill="currentColor" />
        </svg>
      </span>
      <span>
        <span className="brand-name">CoolCare</span>
        <span className="brand-subtitle">Admin</span>
      </span>
    </div>
  )
}
