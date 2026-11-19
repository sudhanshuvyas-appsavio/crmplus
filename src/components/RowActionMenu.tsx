import { useEffect, useRef, useState } from 'react'

export interface RowAction {
  label: string
  onSelect: () => void
  /** When set the item is greyed out and this is shown as the reason. */
  disabledReason?: string | null
  tone?: 'default' | 'danger'
}

/** The "Actions" button at the end of a row. The menu is positioned from the
 *  button's own rectangle (fixed), so a scrolling table cannot clip it. */
export function RowActionMenu({
  label,
  actions,
  busy = false,
}: {
  /** What the row is, for the screen reader: "Actions for TASK-2026-0007". */
  label: string
  actions: readonly RowAction[]
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const width = 184
  const height = 12 + actions.reduce((sum, a) => sum + 34 + (a.disabledReason ? Math.ceil(a.disabledReason.length / 34) * 13 : 0), 0)

  function toggle() {
    if (open) return setOpen(false)
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const opensLeft = rect.left >= width + 16
    setAnchor({
      top: Math.max(8, Math.min(opensLeft ? rect.top : rect.bottom + 4, window.innerHeight - height - 8)),
      right: opensLeft ? window.innerWidth - rect.left + 6 : Math.max(8, window.innerWidth - rect.right),
    })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return undefined
    const close = () => setOpen(false)
    function onDown(e: PointerEvent) {
      const target = e.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      close()
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="row-actions-btn"
        onClick={toggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${label}`}
      >
        {busy ? 'Working…' : 'Actions'}
        <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }}>
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
      </button>
      {open && anchor && (
        <div ref={menuRef} role="menu" className="row-menu" style={{ top: anchor.top, right: anchor.right }}>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className={`row-menu-item${a.tone === 'danger' ? ' danger' : ''}`}
              disabled={Boolean(a.disabledReason)}
              title={a.disabledReason ?? undefined}
              onClick={() => {
                setOpen(false)
                a.onSelect()
              }}
            >
              {a.label}
              {a.disabledReason && <small>{a.disabledReason}</small>}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
