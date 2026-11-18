import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** Inside <InlineForm> a Drawer renders as a card on the page (a board's creation-form tab)
 *  instead of sliding in over it. */
const InlineFormContext = createContext(false)
export function InlineForm({ children }: { children: ReactNode }) {
  return <InlineFormContext.Provider value={true}>{children}</InlineFormContext.Provider>
}

/** The slide-in panel used for create/edit forms (same markup the Companies
 *  screen uses, shared so the new screens do not each carry a copy). */
export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const inline = useContext(InlineFormContext)
  useEffect(() => {
    if (inline) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, inline])

  if (inline) {
    return (
      <section className="inline-form" aria-label={title}>
        <header className="inline-form-head"><h2>{title}</h2></header>
        <div className="inline-form-body">{children}</div>
      </section>
    )
  }
  return (
    <>
      <button className="scrim" type="button" aria-label="Close" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" type="button" onClick={onClose} aria-label="Close">
            <span className="drawer-close-text">Close</span>
            <svg className="drawer-close-x" aria-hidden="true" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  )
}

/** Two-step delete: the first click asks, the second does it. */
export function DeleteControl({
  label,
  name,
  busy,
  onConfirm,
}: {
  label: string
  name: string
  busy: boolean
  onConfirm: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <button className="btn danger push" type="button" onClick={() => setConfirming(true)} disabled={busy}>
        {label}
      </button>
    )
  }
  return (
    <span className="push" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span className="field-warn">Delete {name}?</span>
      <button className="btn danger" type="button" onClick={onConfirm} disabled={busy}>
        {busy ? 'Deleting…' : 'Yes, delete it'}
      </button>
      <button className="btn ghost" type="button" onClick={() => setConfirming(false)} disabled={busy}>
        Cancel
      </button>
    </span>
  )
}