/** Building blocks for the "SaaS-style" create / edit forms: a page of titled
 *  cards, each holding a two-column grid of fields (the layout of monday's
 *  creation forms). */

import { useEffect, useRef, type ReactNode } from 'react'

export function FormSection({
  title,
  description,
  count,
  children,
}: {
  title: string
  description?: string
  /** Shown on the right of the header, e.g. "11 fields". */
  count?: number
  children: ReactNode
}) {
  return (
    <section className="fs-card" aria-label={title}>
      <header className="fs-head">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {count !== undefined && <span className="fs-count">{count} fields</span>}
      </header>
      <div className="fs-body">
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
