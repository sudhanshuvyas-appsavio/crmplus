/** Shared validation and error-message helpers for the Count, Supplier,
 *  Buyer and Lead screens.
 *
 *  The database is the real guard (CHECK constraints, unique indexes and the
 *  qualification trigger in supabase/migrations/0005); these helpers just let
 *  the forms say what is wrong before a round trip, and turn the database's
 *  error into a sentence a person can act on. */

export const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
export const MOBILE_RE = /^[0-9]{10}$/

/** GST state codes, so typing a GSTIN can fill the state in. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
}

export function isGst(value: string): boolean {
  return GST_RE.test(value.trim().toUpperCase())
}

export function isMobile(value: string): boolean {
  return MOBILE_RE.test(value.trim())
}

/** Postgres errors from supabase-js are plain objects, not Error instances,
 *  so `caught instanceof Error` (used elsewhere in the app) misses them. */
export function errMessage(caught: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (!caught || typeof caught !== 'object') return typeof caught === 'string' ? caught : fallback
  const e = caught as { message?: string; code?: string; details?: string }
  const text = `${e.message ?? ''} ${e.details ?? ''}`

  if (e.code === '23505' || /duplicate key/i.test(text)) {
    if (/count_master_display_uq/.test(text)) return 'A count with this exact specification already exists.'
    if (/_gst_uq/.test(text)) return 'A record with this GST number already exists.'
    if (/_name_uq/.test(text)) return 'A record with this name already exists.'
    return 'That record already exists.'
  }
  if (e.code === '23514' || /violates check constraint/i.test(text)) {
    if (/_gst_state/.test(text)) return 'The first two digits of the GST number must match the state code.'
    if (/gst_check/.test(text)) return 'That GST number is not in the right format (15 characters, e.g. 33AHFPK5121I1Z5).'
    if (/mobile_check/.test(text)) return 'Mobile must be exactly 10 digits.'
    if (/pan_check/.test(text)) return 'PAN must be 10 upper-case characters.'
    if (/count_no_check/.test(text)) return 'Count must be between 6 and 120.'
    if (/blended_rule/.test(text)) return 'Choose the blend only when the composition is BLENDED (and then it is required).'
    if (/ratio_check/.test(text)) return 'Ratio looks like 100% or 60/40.'
    if (/quantity_check/.test(text)) return 'Quantity must be more than zero.'
    if (/bags_need_weight/.test(text)) return 'Bag weight is required when the unit is BAGS.'
  }
  if (e.code === '23503' || /foreign key/i.test(text)) {
    return 'This record is in use by a lead or another record, so it cannot be deleted. Mark it inactive instead.'
  }
  if (e.code === '42501' || /row-level security/i.test(text)) {
    return 'Your account does not have permission to do that.'
  }
  return e.message || fallback
}

export function numOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}