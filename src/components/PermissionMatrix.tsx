/** The permission picker.
 *
 * Grouped as the catalogue groups them, with a whole-group toggle, because the
 * pipeline stages alone are fourteen checkboxes and nobody wants to tick them
 * one at a time. Permissions marked dangerous are flagged — granting
 * "Create users and set their permissions" lets that person grant themselves
 * anything else, and an administrator should know that before they click. */

import { useMemo } from 'react'
import type { PermissionDef } from '../api/types'

interface Props {
  catalogue: PermissionDef[]
  groups: string[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /** When the account is an administrator, everything is implied. */
  impliedAll?: boolean
}

export function PermissionMatrix({
  catalogue,
  groups,
  selected,
  onChange,
  disabled = false,
  impliedAll = false,
}: Props) {
  const held = useMemo(() => new Set(selected), [selected])
  const byGroup = useMemo(() => {
    const map = new Map<string, PermissionDef[]>()
    for (const group of groups) map.set(group, [])
    for (const permission of catalogue) {
      const list = map.get(permission.group)
      if (list) list.push(permission)
      else map.set(permission.group, [permission])
    }
    return map
  }, [catalogue, groups])

  function toggle(key: string) {
    const next = new Set(held)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(catalogue.filter((p) => next.has(p.key)).map((p) => p.key))
  }

  function setGroup(group: string, on: boolean) {
    const keys = byGroup.get(group) ?? []
    const next = new Set(held)
    for (const permission of keys) {
      if (on) next.add(permission.key)
      else next.delete(permission.key)
    }
    onChange(catalogue.filter((p) => next.has(p.key)).map((p) => p.key))
  }

  return (
    <div className="matrix">
      {impliedAll && (
        <div className="notice" role="status">
          This account is an administrator, so it holds every permission — including any added in
          a future release. The ticks below are kept, and apply if you remove administrator later.
        </div>
      )}

      <div className="matrix-summary small muted">
        {selected.length} of {catalogue.length} permissions selected
      </div>

      {Array.from(byGroup.entries()).map(([group, permissions]) => {
        if (!permissions.length) return null
        const on = permissions.filter((p) => held.has(p.key)).length
        const all = on === permissions.length
        return (
          <fieldset className="matrix-group" key={group}>
            <legend>
              <span>{group}</span>
              <span className="matrix-count">{on}/{permissions.length}</span>
              <button
                type="button"
                className="btn ghost sm"
                disabled={disabled}
                onClick={() => setGroup(group, !all)}
              >
                {all ? 'Clear group' : 'Select group'}
              </button>
            </legend>
            <div className="matrix-items">
              {permissions.map((permission) => (
                <label
                  className={permission.dangerous ? 'check danger' : 'check'}
                  key={permission.key}
                >
                  <input
                    type="checkbox"
                    checked={held.has(permission.key)}
                    disabled={disabled}
                    onChange={() => toggle(permission.key)}
                  />
                  <span className="check-body">
                    <span className="check-label">
                      {permission.label}
                      {permission.dangerous && <em className="tag warn">sensitive</em>}
                    </span>
                    {permission.hint && <span className="check-hint">{permission.hint}</span>}
                    <code className="check-key">{permission.key}</code>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}