import { useEffect, useRef, type ReactNode } from 'react'

/** A centred dialog with a pinned header and footer, in the Master Data modal's
 *  style. Used by the Tasks module for task detail, forms and confirmations.
 *  Esc and a click on the dimmed backdrop close it; Tab stays inside. */
export function Modal({
  title,
  description,
  size = 'md',
  onClose,
  footer,
  children,
}: {
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  onClose: () => void
  /** Rendered in the pinned footer: Close on the left by convention, actions on the right. */
  footer?: ReactNode
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [onClose])

  return (
    <div className="modal-root">
      <button type="button" className="modal-scrim" aria-label="Close" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className={`modal-panel modal-${size}`}>
        <header className="modal-head">
          <div className="modal-titles">
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button ref={closeRef} type="button" className="modal-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}
