/** Board view in the style of a monday.com board: rows grouped by status, each
 *  group with its colour, item count and column totals, collapsible, plus a
 *  Kanban view of the same groups. Used by every CRM screen (Deals, Sales
 *  Confirmations, Dispatch and Billing) so they look and behave the same. */

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'

export interface BoardGroup {
  value: string
  label: string
  /** Colour token name: blue, orange, green, purple, red, grey, teal, yellow. */
  tone: string
  /** Shown only when it has items (groups monday does not have). monday's own groups always show, even empty. */
  optional?: boolean
}

export interface BoardColumn<T> {
  key: string
  label: string
  render: (row: T) => ReactNode
  align?: 'right' | 'center'
  width?: number
  /** Group footer value, e.g. a sum. */
  total?: (rows: T[]) => ReactNode
  /** Keep clicks in this cell from opening the item (for inline controls). */
  interactive?: boolean
  /** Pin the column to the right edge of the table while the rest scrolls sideways (the Actions column). */
  pinRight?: boolean
}

export type BoardView = 'table' | 'kanban'

const cellClass = (c: { align?: 'right' | 'center'; pinRight?: boolean }) => [c.align, c.pinRight ? 'pin-right' : ''].filter(Boolean).join(' ') || undefined

export function Board<T>({
  rows,
  groups,
  groupOf,
  columns,
  rowKey,
  onOpen,
  view,
  card,
  emptyText,
  selection,
  rowOpens = true,
  expandable,
}: {
  rows: T[]
  groups: BoardGroup[]
  groupOf: (row: T) => string
  columns: BoardColumn<T>[]
  rowKey: (row: T) => string
  onOpen: (row: T) => void
  view: BoardView
  /** Body of a Kanban card. */
  card: (row: T) => ReactNode
  emptyText: string
  selection?: { isSelected: (id: string) => boolean; toggle: (id: string) => void }
  /** false: a click on a table row or a Kanban card does nothing (the Actions menu is the way in; a card's body then holds its own menu). */
  rowOpens?: boolean
  /** Child rows under an item, like monday's subitems: a chevron opens them below the row. */
  expandable?: { count: (row: T) => number; render: (row: T) => ReactNode }
}) {
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readCollapsed())
  useEffect(() => {
    try {
      localStorage.setItem('board.collapsed', JSON.stringify(collapsed))
    } catch {
      /* storage unavailable: collapsing still works for this visit */
    }
  }, [collapsed])

  const byGroup = new Map<string, T[]>(groups.map((g) => [g.value, []]))
  for (const row of rows) {
    const g = groupOf(row)
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(row)
  }

  const empty = rows.length === 0 ? <p className="muted small">{emptyText}</p> : null

  if (view === 'kanban') {
    return (
      <div className="kanban">
        {groups.map((g) => {
          const list = byGroup.get(g.value) ?? []
          if (list.length === 0 && g.optional) return null
          return (
            <section key={g.value} className={`kanban-col tone-${g.tone}`} aria-label={g.label}>
              <header className="kanban-head">
                <span className="kanban-title">{g.label}</span>
                <span className="kanban-count">{list.length}</span>
              </header>
              <div className="kanban-body">
                {list.length === 0 ? (
                  <p className="muted small kanban-empty">Nothing here</p>
                ) : (
                  list.map((row) => (
                    rowOpens ? (
                      <button key={rowKey(row)} type="button" className="kanban-card" onClick={() => onOpen(row)}>
                        {card(row)}
                      </button>
                    ) : (
                      <div key={rowKey(row)} className="kanban-card">{card(row)}</div>
                    )
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>
    )
  }

  return (
    <div className="board-groups">
      {empty}
      {groups.map((g) => {
        const list = byGroup.get(g.value) ?? []
        if (list.length === 0 && g.optional) return null
        const closed = !!collapsed[g.value]
        const hasTotals = columns.some((c) => c.total)
        return (
          <section key={g.value} className={`bgroup tone-${g.tone}`} aria-label={g.label}>
            <button
              type="button"
              className="bgroup-head"
              aria-expanded={!closed}
              onClick={() => setCollapsed((p) => ({ ...p, [g.value]: !closed }))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className={closed ? 'chev closed' : 'chev'}>
                <path d="M6 9l6 6 6-6" />
              </svg>
              <span className="bgroup-title">{g.label}</span>
              <span className="bgroup-count">
                {list.length} {list.length === 1 ? 'item' : 'items'}
              </span>
            </button>
            {!closed && (
              <div className="bgroup-table">
                <table>
                  <thead>
                    <tr>
                      {selection && <th className="bcell-check" aria-label="Select" />}
                      {expandable && <th className="bcell-exp" aria-label="Subitems" />}
                      {columns.map((c) => (
                        <th key={c.key} className={cellClass(c)} style={c.width ? { width: c.width } : undefined}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.length === 0 && (
                      <tr>
                        <td colSpan={columns.length + (selection ? 1 : 0) + (expandable ? 1 : 0)} className="muted small bgroup-empty">No items in this group</td>
                      </tr>
                    )}
                    {list.map((row) => {
                      const id = rowKey(row)
                      const subs = expandable ? expandable.count(row) : 0
                      const isOpen = !!openRows[id]
                      return (
                        <Fragment key={id}>
                        <tr className={rowOpens ? 'clickable' : undefined} onClick={rowOpens ? () => onOpen(row) : undefined}>
                          {selection && (
                            <td className="bcell-check" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={selection.isSelected(id)} onChange={() => selection.toggle(id)} aria-label="Select row" />
                            </td>
                          )}
                          {expandable && (
                            <td className="bcell-exp" onClick={(e) => e.stopPropagation()}>
                              <button type="button" className="exp-btn" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} subitems (${subs})`} onClick={() => setOpenRows((p) => ({ ...p, [id]: !isOpen }))}>
                                <svg viewBox="0 0 24 24" aria-hidden="true" className={isOpen ? 'chev' : 'chev closed'}><path d="M6 9l6 6 6-6" /></svg>
                                <span className="exp-n">{subs}</span>
                              </button>
                            </td>
                          )}
                          {columns.map((c) => (
                            <td
                              key={c.key}
                              className={cellClass(c)}
                              onClick={c.interactive ? (e) => e.stopPropagation() : undefined}
                            >
                              {c.render(row)}
                            </td>
                          ))}
                        </tr>
                        {expandable && isOpen && (
                          <tr className="subrow">
                            <td colSpan={columns.length + (selection ? 1 : 0) + 1}>
                              <div className="subrow-wrap">{expandable.render(row)}</div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                  {hasTotals && (
                    <tfoot>
                      <tr>
                        {selection && <td />}
                        {expandable && <td />}
                        {columns.map((c) => (
                          <td key={c.key} className={cellClass(c)}>
                            {c.total ? c.total(list) : null}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('board.collapsed') ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

/** Initials bubble for a person column (owner, person). */
export function Avatar({ name }: { name?: string }) {
  if (!name) return <span className="avatar-sm empty" aria-label="Nobody">—</span>
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase()
  return <span className="avatar-sm" title={name}>{initials}</span>
}

/** Coloured status label, as in monday's Status column. */
export function StatusPill({ label, tone }: { label: string; tone: string }) {
  return <span className={`status-pill tone-${tone}`}>{label}</span>
}

/** A status label that opens a menu of the statuses it can move to. */
export function StatusPicker({
  current,
  options,
  onPick,
  disabled,
}: {
  current: BoardGroup
  /** Statuses that can be chosen from here; the current one is excluded. */
  options: BoardGroup[]
  onPick: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function away(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function esc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (disabled || options.length === 0) return <StatusPill label={current.label} tone={current.tone} />
  return (
    <div className="status-picker" ref={ref}>
      <button
        type="button"
        className={`status-pill tone-${current.tone} as-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {current.label}
      </button>
      {open && (
        <div className="status-menu" role="menu">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitem"
              className={`status-pill tone-${o.tone} as-button`}
              onClick={() => {
                setOpen(false)
                onPick(o.value)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Table / Kanban switch for the board toolbar. */
/** Small download arrow for Export buttons. */
export function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
    </svg>
  )
}

export function ViewSwitch({ view, onChange }: { view: BoardView; onChange: (v: BoardView) => void }) {
  return (
    <div className="seg" role="group" aria-label="View">
      <button type="button" className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} onClick={() => onChange('table')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        Table
      </button>
      <button type="button" className={view === 'kanban' ? 'on' : ''} aria-pressed={view === 'kanban'} onClick={() => onChange('kanban')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z" /></svg>
        Kanban
      </button>
    </div>
  )
}

/** Remembers a per-screen choice (view, filters) in this browser only. */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const set = (v: T) => {
    setValue(v)
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* ignore */
    }
  }
  return [value, set]
}
