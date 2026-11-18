/** A phone input with its country code beside it (default +91), the way
 *  monday's Phone column is entered. The value is one text, "+91 9876543210". */

import { COUNTRY_CODES, joinPhone, phoneProblem, splitPhone } from '../lib/phone'

export function PhoneField({
  id,
  label,
  value,
  onChange,
  required,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  hint?: string
}) {
  const parts = splitPhone(value)
  const problem = phoneProblem(value)
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          aria-label={`${label} country code`}
          value={parts.code}
          onChange={(e) => onChange(joinPhone({ ...parts, code: e.target.value }))}
          style={{ width: 88, flex: '0 0 auto' }}
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </select>
        <input
          id={id}
          inputMode="numeric"
          value={parts.number}
          onChange={(e) => onChange(joinPhone({ code: parts.code, number: e.target.value }))}
          placeholder="Phone number"
        />
      </div>
      {problem ? <p className="field-warn">{problem}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}
