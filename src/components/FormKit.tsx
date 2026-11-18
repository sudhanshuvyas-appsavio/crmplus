/** Building blocks for the "SaaS-style" create / edit forms: a page of titled
 *  cards, each holding a two-column grid of fields (the layout of monday's
 *  creation forms), and a segmented choice for the form's action. */

import type { ReactNode } from 'react'

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

export function ActionChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string; hint?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <section className="fs-card" aria-label={label}>
      <header className="fs-head">
        <div>
          <h3>{label}</h3>
        </div>
      </header>
      <div className="fs-body">
        <div className="fs-seg" role="radiogroup" aria-label={label}>
          {options.map((o) => (
            <label key={o.value} className={`fs-seg-item${value === o.value ? ' on' : ''}`}>
              <input type="radio" name={`fs-${label}`} checked={value === o.value} onChange={() => onChange(o.value)} />
              <span className="fs-seg-title">{o.label}</span>
              {o.hint && <span className="fs-seg-hint">{o.hint}</span>}
            </label>
          ))}
        </div>
      </div>
    </section>
  )
}

/** monday's "Select Action" for a register: create a new record, or pick an existing one to update. */
export function RecordAction({
  action,
  onAction,
  pickedId,
  onPick,
  records,
  noun,
}: {
  action: 'create' | 'update'
  onAction: (a: 'create' | 'update') => void
  pickedId: string
  onPick: (id: string) => void
  records: { id: string; label: string }[]
  noun: string
}) {
  return (
    <>
      <ActionChoice
        label="Select Action"
        value={action}
        onChange={onAction}
        options={[
          { value: 'create', label: 'Create New Record', hint: `Add a new ${noun}.` },
          { value: 'update', label: 'Update Existing Record', hint: `Pick a ${noun} and change its details.` },
        ]}
      />
      {action === 'update' && (
        <FormSection title={`${noun[0]!.toUpperCase()}${noun.slice(1)} to update`}>
          <FullWidth>
            <div className="field">
              <label htmlFor="fs-pick">
                Record<span aria-hidden="true"> *</span>
              </label>
              <select id="fs-pick" value={pickedId} onChange={(e) => onPick(e.target.value)}>
                <option value="">— Select a record —</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p className="field-hint">Its details are loaded below for you to change.</p>
            </div>
          </FullWidth>
        </FormSection>
      )}
    </>
  )
}
