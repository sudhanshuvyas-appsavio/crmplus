/** Field checks shared by the Master data forms. They mirror the database's own
 *  rules (the database stays the real guard) so a form can say what is wrong
 *  next to the field instead of failing on save with a generic message. */

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
export const CURRENCY_RE = /^[A-Z]{3}$/
export const STATE_CODE_RE = /^[0-9]{2}$/

export const isEmail = (v: string): boolean => EMAIL_RE.test(v.trim())
export const isPan = (v: string): boolean => PAN_RE.test(v.trim().toUpperCase())
export const isCurrency = (v: string): boolean => CURRENCY_RE.test(v.trim())
export const isStateCode = (v: string): boolean => STATE_CODE_RE.test(v.trim())

/** The PAN is characters 3 to 12 of a GSTIN. True when either is missing. */
export function panMatchesGst(gst: string, pan: string): boolean {
  const g = gst.trim().toUpperCase()
  const p = pan.trim().toUpperCase()
  if (g.length < 12 || !p) return true
  return g.slice(2, 12) === p
}

/** Case-, spacing- and edge-insensitive form of a name, for duplicate checks. */
export const nameKey = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The first row (other than `selfId`) whose key equals the typed value, if any. */
export function findDuplicate<T extends { id: string }>(
  rows: readonly T[],
  selfId: string | null | undefined,
  key: (row: T) => string | null | undefined,
  value: string,
  normalise: (v: string | null | undefined) => string = nameKey,
): T | null {
  const wanted = normalise(value)
  if (!wanted) return null
  return rows.find((r) => r.id !== selfId && normalise(key(r)) === wanted) ?? null
}

/** Field id -> message. Insertion order is the order the fields appear on the form. */
export type FieldErrors = Record<string, string>

/** Scrolls to and focuses the first field that has an error. */
export function focusFirstError(errors: FieldErrors): void {
  const id = Object.keys(errors)[0]
  if (!id) return
  window.setTimeout(() => {
    const el = document.getElementById(id)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.focus({ preventScroll: true })
  }, 0)
}

/** Adds `message` for `id` when `value` is blank. */
export function requireText(errors: FieldErrors, id: string, value: string, message: string): void {
  if (!value.trim()) errors[id] = message
}

/** Lower-cased with runs of whitespace collapsed, so a search for "qa   dual" finds "QA Dual". */
export function searchKey(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const HAS_LETTER = /\p{L}/u

/** A name must contain a letter: "12345" or "#-/" is not a name. Digits inside a name are fine ("Shree 5 Mills"). */
export function nameProblem(label: string, value: string | null | undefined): string | null {
  const t = (value ?? '').trim()
  if (!t) return null
  return HAS_LETTER.test(t) ? null : `${label} must contain letters, not only numbers or symbols.`
}

/** A person's name: letters, spaces and . ' - only. No digits. */
export function personProblem(label: string, value: string | null | undefined): string | null {
  const t = (value ?? '').trim()
  if (!t) return null
  if (!HAS_LETTER.test(t)) return `${label} must contain letters, not only numbers or symbols.`
  if (/\d/.test(t)) return `${label} cannot contain digits.`
  return null
}

/** A state or place name: letters (any script), spaces and . & ' - only. */
export function placeProblem(label: string, value: string | null | undefined): string | null {
  const t = (value ?? '').trim()
  if (!t) return null
  return /^\p{L}[\p{L}\s.&'-]*$/u.test(t) ? null : `${label} must be a name made of letters, not numbers.`
}
