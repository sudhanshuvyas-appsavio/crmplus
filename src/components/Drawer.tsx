import { useEffect, useState, type ReactNode } from 'react'

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
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <button className="scrim" type="button" aria-label="Close" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" type="button" onClick={onClose}>
            Close
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