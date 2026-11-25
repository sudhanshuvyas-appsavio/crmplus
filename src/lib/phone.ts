/** Phone values kept as "<country code> <number>", e.g. "+91 9876543210".
 *
 *  monday's Phone column holds a country code and a number separately; here
 *  they are one text value that splits back into the two parts for the form. */

export const COUNTRY_CODES: { code: string; label: string }[] = [
  { code: '+91', label: 'India (+91)' },
  { code: '+1', label: 'US / Canada (+1)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+971', label: 'UAE (+971)' },
  { code: '+880', label: 'Bangladesh (+880)' },
  { code: '+92', label: 'Pakistan (+92)' },
  { code: '+94', label: 'Sri Lanka (+94)' },
  { code: '+977', label: 'Nepal (+977)' },
  { code: '+86', label: 'China (+86)' },
  { code: '+65', label: 'Singapore (+65)' },
]

export const DEFAULT_COUNTRY_CODE = '+91'

export interface PhoneParts {
  code: string
  number: string
}

/** Splits a stored value. A bare number (older records) is read as +91. */
export function splitPhone(value: string | null | undefined): PhoneParts {
  const text = (value ?? '').trim()
  if (!text) return { code: DEFAULT_COUNTRY_CODE, number: '' }
  if (text.startsWith('+')) {
    // longest known code first, so +971 is not read as +9
    const known = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length).find((c) => text.startsWith(c.code))
    if (known) return { code: known.code, number: text.slice(known.code.length).replace(/\D/g, '') }
    const m = /^(\+\d{1,3})\s*(.*)$/.exec(text)
    if (m) return { code: m[1]!, number: (m[2] ?? '').replace(/\D/g, '') }
  }
  return { code: DEFAULT_COUNTRY_CODE, number: text.replace(/\D/g, '') }
}

/** The stored value, or '' when there is no number. */
export function joinPhone(parts: PhoneParts): string {
  const digits = parts.number.replace(/\D/g, '')
  return digits ? `${parts.code} ${digits}` : ''
}

/** For lists: always shown with its country code. */
export function formatPhone(value: string | null | undefined): string {
  const { code, number } = splitPhone(value)
  return number ? `${code} ${number}` : ''
}

/** An Indian number is exactly 10 digits; any other country is 4 to 14. */
export function phoneProblem(value: string): string | null {
  const { code, number } = splitPhone(value)
  if (!number) return null
  if (code === '+91') return /^[0-9]{10}$/.test(number) ? null : 'Indian numbers are 10 digits, without 0 or +91.'
  return number.length >= 4 && number.length <= 14 ? null : 'Enter 4 to 14 digits.'
}

/** The stored form the database's phone checks accept for `companies`: "+919876543210",
 *  a plus, the code and the digits with no space. Empty when there is no number. */
export function compactPhone(value: string | null | undefined): string {
  const { code, number } = splitPhone(value)
  return number ? `${code}${number}` : ''
}

/** Reads a value saved as bare digits (the buyer, supplier and office-phone columns):
 *  up to 10 digits is an Indian number; longer is a known country code followed by the
 *  number. Anything else is read as +91, as before. */
export function splitStored(value: string | null | undefined): PhoneParts {
  const digits = (value ?? '').replace(/\D/g, '')
  if (!digits) return { code: DEFAULT_COUNTRY_CODE, number: '' }
  if (digits.length > 10) {
    const known = [...COUNTRY_CODES]
      .sort((a, b) => b.code.length - a.code.length)
      .find((c) => digits.startsWith(c.code.slice(1)) && digits.length - (c.code.length - 1) >= 6)
    if (known) return { code: known.code, number: digits.slice(known.code.length - 1) }
  }
  return { code: DEFAULT_COUNTRY_CODE, number: digits }
}

/** Digits after the country code that the `companies` phone check allows. */
export function companyPhoneProblem(value: string): string | null {
  const { code, number } = splitPhone(value)
  if (!number) return null
  if (code === '+91') return /^[0-9]{10}$/.test(number) ? null : 'Indian numbers are 10 digits, without 0 or +91.'
  return number.length >= 6 && number.length <= 12 ? null : 'Enter 6 to 12 digits.'
}
