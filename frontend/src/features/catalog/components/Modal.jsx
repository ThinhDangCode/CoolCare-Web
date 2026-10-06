import { useEffect, useRef } from 'react'

export function Modal({ title, children, onClose, busy = false, danger = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const element = ref.current
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.focus()
    function keyboard(event) {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key !== 'Tab') return
      const targets = [...element.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')]
      const first = targets[0]
      const last = targets.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus() }
    }
    element.addEventListener('keydown', keyboard)
    return () => { document.body.style.overflow = oldOverflow; element.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [onClose, busy])
  return <div className="dialog-backdrop catalog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section ref={ref} tabIndex={-1} className={`catalog-modal ${danger ? 'catalog-delete-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="catalog-dialog-title">
      <header><div><span className="catalog-heading-icon">{danger ? '!' : '✎'}</span><h2 id="catalog-dialog-title">{title}</h2></div><button type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button></header>
      {children}
    </section>
  </div>
}
