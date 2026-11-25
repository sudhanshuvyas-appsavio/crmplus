/** Building blocks for the "SaaS-style" create / edit forms: a page of titled
 *  cards, each holding a two-column grid of fields (the layout of monday's
 *  creation forms). */

import { useEffect, useRef, useState, type ReactNode } from 'react'

export function FormSection({
  title,
  description,
  count,
  collapsible = false,
  columns = 2,
  children,
}: {
  title: string
  description?: string
  /** Shown on the right of the header, e.g. "11 fields". */
  count?: number
  /** An arrow on the header folds the card away, as on monday's creation forms. */
  collapsible?: boolean
  /** Fields per row. 3 also tightens the spacing (the Pharma ERP form density). */
  columns?: 2 | 3
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <section className={`fs-card${columns === 3 ? ' cols-3' : ''}`} aria-label={title}>
      <header className="fs-head">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {count !== undefined && <span className="fs-count">{count} fields</span>}
        {collapsible && (
          <button type="button" className="fs-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`} onClick={() => setOpen(!open)}>
            <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true" style={{ transform: open ? undefined : 'rotate(180deg)' }}><path d="M10 6 4 14h12L10 6Z" /></svg>
          </button>
        )}
      </header>
      <div className="fs-body" hidden={!open}>
        <div className="fs-grid">{children}</div>
      </div>
    </section>
  )
}

/** Wrap a field so it spans both columns of the grid. */
export function FullWidth({ children }: { children: ReactNode }) {
  return <div className="fs-full">{children}</div>
}

/** A save error at the top of a form. The Save button is pinned at the bottom, so the
 *  banner scrolls itself into view whenever its text changes. */
export function ErrorBanner({ message }: { message: string | null | undefined }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (message) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [message])
  if (!message) return null
  return (
    <div ref={ref} className="alert" role="alert">
      {message}
    </div>
  )
}
