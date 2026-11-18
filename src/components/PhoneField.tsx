/** A phone input with its country code beside it (default +91), the way
 *  monday's Phone column is entered. The value is one text, "+91 9876543210". */

import { useContext } from 'react'
import { COUNTRY_CODES, joinPhone, phoneProblem, splitPhone } from '../lib/phone'
import { FieldErrorsContext } from './fieldErrors'

export function PhoneField({
  id,
  label,
  value,
  onChange,
  required,
  hint,
  error,
  indianOnly = false,
  validate = phoneProblem,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  hint?: string
  /** A message from the form (e.g. a missing required phone); shown in place of the format problem. */
  error?: string | null
  /** Only Indian (+91) numbers are accepted: the country code is fixed and not offered as a choice. */
  indianOnly?: boolean
  /** Replaces the default format rule (the Business Units phones take 6 to 12 digits abroad). */
  validate?: (value: string) => string | null
}) {
  const parts = splitPhone(value)
  const fromForm = useContext(FieldErrorsContext)
  const problem = error ?? fromForm?.[id] ?? (indianOnly && parts.code !== '+91' ? 'Only Indian (+91) numbers are accepted here.' : validate(value))
  return (
    <div className={`field${problem ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        {indianOnly ? (
          <span className="phone-fixed-code" aria-hidden="true">
            +91
          </span>
        ) : (
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
        )}
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
