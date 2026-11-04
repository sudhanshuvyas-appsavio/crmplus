/** A password input with a show/hide toggle, a caps-lock warning, and — when
 *  asked — a live read-out of the rules the server will apply.
 *
 *  The checks here are a courtesy so nobody submits a password only to be told
 *  no. The server re-runs all of them; this is not where the policy lives. */

import { useMemo, useState } from 'react'
import type { PasswordPolicy } from '../api/types'

const COMMON = new Set([
  'password', 'password1', 'password123', 'qwerty123', '12345678', '123456789',
  'letmein123', 'welcome123', 'admin12345', 'changeme123', 'iloveyou123',
  'commissiondesk', 'administrator',
])

export interface Requirement {
  label: string
  met: boolean
}

export function checkPassword(
  value: string,
  policy: PasswordPolicy | null,
  context: { email?: string; name?: string } = {},
): Requirement[] {
  const min = policy?.min_length ?? 12
  const lowered = value.toLowerCase()
  const local = (context.email ?? '').split('@')[0]?.toLowerCase() ?? ''
  const nameWords = (context.name ?? '').split(/\s+/).filter((w) => w.length > 2)

  return [
    { label: `At least ${min} characters`, met: value.length >= min },
    { label: 'A reasonable mix of characters', met: new Set(value).size >= 5 },
    { label: 'Not a commonly used password', met: value.length > 0 && !COMMON.has(lowered) },
    {
      label: 'Does not contain your name or email',
      met:
        value.length > 0 &&
        !(local.length > 2 && lowered.includes(local)) &&
        !nameWords.some((w) => lowered.includes(w.toLowerCase())),
    },
  ]
}

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  autoFocus?: boolean
  required?: boolean
  disabled?: boolean
  hint?: string
  requirements?: Requirement[]
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  autoFocus = false,
  required = true,
  disabled = false,
  hint,
  requirements,
}: Props) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

  const allMet = useMemo(() => requirements?.every((r) => r.met) ?? true, [requirements])

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-affix">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          value={value}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyUp={(event) => setCapsLock(event.getModifierState?.('CapsLock') ?? false)}
          aria-describedby={requirements ? `${id}-rules` : hint ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          className="affix-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>

      {capsLock && (
        <p className="field-warn" role="status">
          Caps Lock is on.
        </p>
      )}
      {hint && !requirements && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}

      {requirements && (
        <ul className="rules" id={`${id}-rules`} aria-live="polite">
          {requirements.map((rule) => (
            <li key={rule.label} className={rule.met ? 'met' : value ? 'unmet' : ''}>
              <span className="tick" aria-hidden="true">
                {rule.met ? '✓' : '•'}
              </span>
              {rule.label}
            </li>
          ))}
          {value.length > 0 && allMet && <li className="met summary">Looks good.</li>}
        </ul>
      )}
    </div>
  )
}