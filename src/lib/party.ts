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

  const constraint = /constraint "([^"]+)"/.exec(text)?.[1] ?? /unique index "([^"]+)"/.exec(text)?.[1] ?? ''

  if (e.code === '23505' || /duplicate key/i.test(text)) {
    if (/_gst_uq/.test(constraint)) return 'A record with this GST number already exists.'
    if (/_pan_uq/.test(constraint)) return 'A record with this PAN already exists.'
    if (/_name_uq/.test(constraint)) return 'A record with this name already exists.'
    if (/ref_prefix/.test(constraint)) return 'That reference prefix is already used by another business unit.'
    if (/customer_code/.test(constraint)) return 'That customer code is already used by another record.'
    if (/one_home/.test(constraint)) return 'Only one company can be the Home company. Clear the flag on the other one first.'
    if (/storage_path/.test(constraint)) return 'That file was already uploaded.'
    return 'That record already exists.'
  }
  if (e.code === '23514' || /violates check constraint/i.test(text)) {
    if (/companies_pan_gst/.test(constraint)) return 'The PAN does not match the GST number (it is characters 3 to 12 of the GST).'
    if (/companies_required/.test(constraint)) return 'Name, Email, Address and Bank Account Details 1 are required.'
    if (/companies_fmt/.test(constraint)) return 'Check the GST, PAN, email and phone formats (phones as +91 and 10 digits).'
    if (/currency/.test(constraint)) return 'Enter a 3-letter currency code, for example INR.'
    if (/_gst_state/.test(constraint)) return 'The first two digits of the GST number must match the state code.'
    if (/gst_check/.test(constraint)) return 'That GST number is not in the right format (15 characters, e.g. 33AHFPK5121I1Z5).'
    if (/pan_check|pan_number_format|_pan_/.test(constraint)) return 'PAN must be 10 upper-case characters.'
    if (/email/.test(constraint)) return 'Enter a valid email address.'
    if (/mobile/.test(constraint)) return 'Mobile numbers must be exactly 10 digits.'
    if (/phone/.test(constraint)) return 'Phone numbers must be digits only (6 to 15, or 10 for an Indian mobile).'
    if (/state_code/.test(constraint)) return 'State code must be 2 digits.'
    if (/_state_check/.test(constraint)) return 'State cannot be blank.'
    if (/zone/.test(constraint)) return 'Choose a zone from the list.'
    if (/vehicle_type/.test(constraint)) return 'Choose a vehicle type from the list.'
    if (/payment_terms_days/.test(constraint)) return 'Days must be a whole number between 0 and 365.'
    if (/advance_pct/.test(constraint)) return 'Advance % must be between 0 and 100.'
    if (/commission_value/.test(constraint)) return 'Commission value cannot be negative.'
    if (/looms|spindles/.test(constraint)) return 'Looms and spindles must be 0 or more.'
    if (/category/.test(constraint)) return 'Category must be 1, 2, 3 or 4.'
    if (/default_commission|commission_basis/.test(constraint)) return 'Choose a commission option from the list.'
    if (/count_no_check/.test(constraint)) return 'Count must be between 6 and 120.'
    if (/count_master_pct_total/.test(constraint)) return 'Yarn 1 and Yarn 2 percentages must add up to 100.'
    if (/count_master_pct_range/.test(constraint)) return 'A yarn percentage must be more than 0 and at most 100.'
    if (/count_master_yarn_pair_check/.test(constraint)) return 'Yarn 2 must be a different yarn from Yarn 1.'
    if (/count_master_yarn_2_rule/.test(constraint)) return 'Yarn 2 and its percentage go together: set both or neither.'
    if (/count_master_yarn_[12]_check/.test(constraint)) return 'Choose a yarn from the list.'
    if (/quantity_check/.test(constraint)) return 'Quantity must be more than zero.'
    if (/bags_need_weight/.test(constraint)) return 'Bag weight is required when the unit is BAGS.'
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