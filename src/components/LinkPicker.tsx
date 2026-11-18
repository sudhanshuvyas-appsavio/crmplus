/** A small multi-select for the links between masters: chips for what is
 *  chosen, and a drop-down to add another. It is controlled -- the form keeps
 *  the list of ids and saves it with `syncLinks` (src/lib/links.ts) once the
 *  record exists. */

import { useContext, useEffect, useState } from 'react'
import { FieldErrorsContext } from './fieldErrors'
import { supabase } from '../lib/supabase'

export interface LinkOption {
  id: string
  label: string
  /** An inactive option can stay chosen but is not offered for adding. */
  inactive?: boolean
}

export function LinkPicker({
  id,
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
  placeholder = 'Add…',
  error,
}: {
  id: string
  label: string
  hint?: string
  options: LinkOption[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  placeholder?: string
  /** A message for this field (e.g. "Counts is required"); also read from the form's error map by id. */
  error?: string | null
}) {
  const fromForm = useContext(FieldErrorsContext)
  const message = error ?? fromForm?.[id]
  const byId = new Map(options.map((o) => [o.id, o]))
  const offered = options.filter((o) => !value.includes(o.id) && !o.inactive)

  return (
    <div className={`field${message ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {value.length > 0 && (
        <div className="link-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {value.map((v) => (
            <span key={v} className="chip">
              {byId.get(v)?.label ?? 'Unknown'}
              {!disabled && (
                <button
                  type="button"
                  className="btn ghost sm"
                  aria-label={`Remove ${byId.get(v)?.label ?? 'link'}`}
                  onClick={() => onChange(value.filter((x) => x !== v))}
                  style={{ marginLeft: 4, padding: '0 4px' }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <select
          id={id}
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value])
          }}
        >
          <option value="">{offered.length === 0 ? 'Nothing more to add' : placeholder}</option>
          {offered.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {value.length === 0 && disabled && <p className="muted small">None.</p>}
      {message ? (
        <p className="field-warn" role="alert">
          {message}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  )
}

/** Locations a record can be linked to (name plus zone when it has one). */
export function useLocationOptions(): LinkOption[] {
  const [options, setOptions] = useState<LinkOption[]>([])
  useEffect(() => {
    let live = true
    void supabase
      .from('station_master')
      .select('id,name,zone,is_active')
      .order('name')
      .then(({ data }) => {
        if (!live || !data) return
        setOptions(
          (data as { id: string; name: string; zone: string | null; is_active: boolean }[]).map((r) => ({
            id: r.id,
            label: r.zone ? `${r.name} (${r.zone.charAt(0)}${r.zone.slice(1).toLowerCase()})` : r.name,
            inactive: !r.is_active,
          })),
        )
      })
    return () => {
      live = false
    }
  }, [])
  return options
}

/** Counts a party can be linked to. */
export function useCountOptions(): LinkOption[] {
  const [options, setOptions] = useState<LinkOption[]>([])
  useEffect(() => {
    let live = true
    void supabase
      .from('count_master')
      .select('id,display_name,is_active')
      .order('count_no')
      .order('display_name')
      .then(({ data }) => {
        if (!live || !data) return
        setOptions(
          (data as { id: string; display_name: string; is_active: boolean }[]).map((r) => ({
            id: r.id,
            label: r.display_name,
            inactive: !r.is_active,
          })),
        )
      })
    return () => {
      live = false
    }
  }, [])
  return options
}
