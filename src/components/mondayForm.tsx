/** Pieces for app forms that create items on a monday.com board: finding a
 *  board column by title, one input per monday column type, and turning a
 *  form value into the value monday's create_item expects. */

import { useEffect, useRef, useState } from 'react'
import type { Column } from './MondayBoard'

/** A link (board_relation) picker like monday's: the choice shows as a chip;
 *  clicking opens a panel with "Search by name…", a Close button and the
 *  matching items. */
function SearchPicker({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string
  label: string
  options: { id: string; name: string }[]
  value: string | undefined
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const chosen = options.find((o) => o.id === value)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc, true)
    }
  }, [open])

  const term = q.trim().toLowerCase()
  const shown = term ? options.filter((o) => o.name.toLowerCase().includes(term)) : options

  if (options.length === 0) {
    return (
      <button id={id} type="button" className="ss-btn" disabled>
        <span className="ss-placeholder">No values</span>
      </button>
    )
  }

  return (
    <div className="ss" ref={ref}>
      <div
        id={id}
        role="combobox"
        tabIndex={0}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={open ? 'ss-btn open' : 'ss-btn'}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {chosen ? (
          <span className="ss-chip">
            {chosen.name}
            <button
              type="button"
              aria-label={`Remove ${chosen.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
            >
              ×
            </button>
          </span>
        ) : (
          <span className="ss-placeholder">-- Select {label} --</span>
        )}
        <svg viewBox="0 0 24 24" aria-hidden="true" className={open ? 'ss-caret up' : 'ss-caret'}><path d="M6 9l6 6 6-6" /></svg>
      </div>
      {open && (
        <div className="ss-panel">
          <input className="ss-search" autoFocus placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${label}`} />
          <button type="button" className="ss-close" onClick={() => setOpen(false)}>Close</button>
          <div className="ss-head">
            <span>{label}</span>
            <span className="ss-count">{shown.length}</span>
          </div>
          <ul className="ss-list" role="listbox">
            {shown.length === 0 ? (
              <li className="ss-empty">Nothing matches “{q.trim()}”</li>
            ) : (
              shown.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.id === value}
                    className={o.id === value ? 'ss-item on' : 'ss-item'}
                    onClick={() => {
                      onChange(o.id)
                      setOpen(false)
                      setQ('')
                    }}
                  >
                    {o.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

export interface Value { text?: string; time?: string; checked?: boolean; id?: string }

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The board column with one of these titles; when several match, the first
 *  of the preferred types wins. */
export function findColumn(columns: Column[], titles: string[], prefer: string[] = []): Column | undefined {
  const wanted = titles.map(norm)
  const hits = columns.filter((c) => wanted.includes(norm(c.title)))
  if (hits.length <= 1) return hits[0]
  for (const type of prefer) {
    const hit = hits.find((c) => c.type === type)
    if (hit) return hit
  }
  return hits[0]
}

/** A form value as monday's create_item column value, or undefined to leave it empty. */
export function columnValue(col: Column, v: Value | undefined): unknown {
  if (!v) return undefined
  switch (col.type) {
    case 'text': return v.text?.trim() || undefined
    case 'numbers': return v.text && Number.isFinite(parseFloat(v.text)) ? String(parseFloat(v.text)) : undefined
    case 'date': return v.text ? { date: v.text, ...(v.time ? { time: `${v.time}:00` } : {}) } : undefined
    case 'status': return v.text ? { label: v.text } : undefined
    case 'checkbox': return v.checked ? { checked: 'true' } : undefined
    case 'board_relation': return v.id ? { item_ids: [v.id] } : undefined
    case 'long_text': return v.text?.trim() ? { text: v.text } : undefined
    case 'phone': {
      let phone = (v.text ?? '').replace(/[^\d+]/g, '')
      if (phone && !phone.startsWith('+') && phone.length > 10) phone = `+${phone}`
      return phone ? { phone, countryShortName: 'IN' } : undefined
    }
    case 'email': {
      const email = (v.text ?? '').trim()
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email, text: email } : undefined
    }
    default: return undefined
  }
}

/** One input, shaped by the monday column type. */
export function FieldInput({
  id,
  fieldKey,
  col,
  value,
  options,
  onChange,
  readOnly = false,
  withTime = false,
}: {
  id: string
  fieldKey: string
  col: Column | undefined
  value: Value
  options: { id: string; name: string }[]
  onChange: (v: Value) => void
  readOnly?: boolean
  /** date columns: a time box beside the date */
  withTime?: boolean
}) {
  if (readOnly && col?.type !== 'checkbox') return <input id={id} value={value.text ?? ''} readOnly />
  switch (col?.type) {
    case 'checkbox':
      return (
        <label className="ttd-check">
          <input id={id} type="checkbox" checked={!!value.checked} disabled={readOnly} onChange={(e) => onChange({ checked: e.target.checked })} />
          Yes
        </label>
      )
    case 'date':
      return withTime ? (
        <div className="ttd-datetime">
          <input id={id} type="date" value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
          <input type="time" aria-label={`${fieldKey} time`} value={value.time ?? ''} onChange={(e) => onChange({ time: e.target.value })} />
        </div>
      ) : (
        <input id={id} type="date" value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
      )
    case 'status':
      return (
        <select id={id} className={value.text ? 'ttd-status on' : 'ttd-status'} value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })}>
          <option value="">-- Select {fieldKey} --</option>
          {(col.labels ?? []).map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      )
    case 'board_relation':
      return <SearchPicker id={id} label={fieldKey} options={options} value={value.id} onChange={(next) => onChange({ id: next })} />

    case 'long_text':
      return <textarea id={id} rows={4} placeholder={`Enter ${fieldKey}`} value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
    case 'numbers':
      return <input id={id} type="number" step="any" placeholder={`Enter ${fieldKey}`} value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
    default:
      return <input id={id} placeholder={`Enter ${fieldKey}`} value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
  }
}
