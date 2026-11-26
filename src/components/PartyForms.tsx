/** The Supplier Master and Buyer Master forms, as reusable pieces.
 *
 *  They are used twice: by the Suppliers / Buyers screens, and inline by the
 *  Qualify Lead panel, where a lead whose party is not yet in a master can
 *  have that master record created on the spot (T-011: "If not: user can
 *  create Master with required fields"). The required fields below are the
 *  ones the story lists; the database enforces the same rules. */

import { useContext, useEffect, useState, type ReactNode } from 'react'
import { FieldErrorsContext, FieldErrorsProvider } from './fieldErrors'
import { supabase } from '../lib/supabase'
import { CATEGORIES, COMMISSION_BASES } from '../api/types'
import type { BuyerMaster, PartyProfile, SupplierMaster } from '../api/types'
import { GST_STATES, isGst, isMobile, numOrNull } from '../lib/party'
import { LinkPicker, useCountOptions } from './LinkPicker'
import { FormSection, FullWidth } from './FormKit'

/* ---- shared bits ---------------------------------------------------------- */

export { FieldErrorsContext, FieldErrorsProvider }

const SR_ONLY = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 } as const

export function Field({
  id,
  label,
  required,
  hint,
  error,
  hideLabel,
  children,
}: {
  id: string
  label: string
  /** The section title already says it: keep the label for screen readers only. */
  hideLabel?: boolean
  required?: boolean
  hint?: string
  /** A message shown under the field in place of the hint (a missing or invalid value). */
  error?: string | null
  children: ReactNode
}) {
  const fromForm = useContext(FieldErrorsContext)
  error = error !== undefined ? error : fromForm?.[id]
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id} style={hideLabel ? SR_ONLY : undefined}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="field-warn" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  )
}

type CommonForm = {
  gst: string
  state_code: string
  state: string
}

/** Typing a GSTIN fills in the state code and state: the first two digits of a
 *  GSTIN are the state code, which is also what the database checks. */
export function gstPatch<T extends CommonForm>(prev: T, value: string): Partial<T> {
  const gst = value.toUpperCase().replace(/\s+/g, '')
  const patch: Partial<CommonForm> = { gst }
  const prefix = gst.slice(0, 2)
  if (/^[0-9]{2}$/.test(prefix)) {
    const previousName = GST_STATES[prev.gst.slice(0, 2)]
    patch.state_code = prefix
    const name = GST_STATES[prefix]
    if (name && (prev.state.trim() === '' || prev.state === previousName)) patch.state = name
  }
  return patch as Partial<T>
}

export function CommissionFields<T extends { commission_basis: string; commission_value: string; category: string }>({
  idPrefix,
  form,
  set,
  withCategory = true,
}: {
  idPrefix: string
  form: T
  set: <K extends keyof T>(key: K, value: T[K]) => void
  /** The category field is part of this block unless the form shows it elsewhere. */
  withCategory?: boolean
}) {
  return (
    <>
      {withCategory && <CategoryField idPrefix={idPrefix} value={form.category} onChange={(v) => set('category', v as T['category'])} />}
      <Field id={`${idPrefix}-cb`} label="Commission basis">
        <select
          id={`${idPrefix}-cb`}
          value={form.commission_basis}
          onChange={(e) => set('commission_basis', e.target.value as T['commission_basis'])}
        >
          <option value="">—</option>
          {COMMISSION_BASES.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${idPrefix}-cv`} label="Commission value">
        <input
          id={`${idPrefix}-cv`}
          inputMode="decimal"
          value={form.commission_value}
          onChange={(e) => set('commission_value', e.target.value as T['commission_value'])}
        />
      </Field>
    </>
  )
}

export function CategoryField({ idPrefix, value, onChange }: { idPrefix: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field id={`${idPrefix}-cat`} label="Category" hint="1 = highest volume … 4 = lowest.">
      <select id={`${idPrefix}-cat`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </Field>
  )
}

/* ---- the profile both masters carry beyond the core ------------------------------ */
/* Everything here is optional: it never blocks saving unless a value is typed
   and is malformed, and it never touches the `incomplete` rules. */

export type ProfileForm = {
  short_name: string
  customer_code: string
  website: string
  map_url: string
  office_phone: string
  res_phone: string
  mill_address: string
  remarks_2: string
  contact_1_email: string
  contact_2_name: string
  contact_2_mobile: string
  contact_2_email: string
  contact_3_name: string
  contact_3_mobile: string
  contact_3_email: string
  sales_person_id: string
  collection_staff_id: string
  messenger_id: string
  qty_bags_month: string
  qty_kgs_month: string
  default_commission: string
}

export type SupplierOnlyForm = {
  machine_type: string
  counts_supplying: string
  spindles: string
  monthly_production: string
  current_machines: string
}

export type BuyerOnlyForm = {
  machine_types: string[]
  no_of_looms: string
  fabric_producing: string
  reed_pick: string
  width: string
  quantity: string
  type_text: string
}

export const blankProfile = (): ProfileForm => ({
  short_name: '', customer_code: '', website: '', map_url: '', office_phone: '', res_phone: '', mill_address: '',
  remarks_2: '', contact_1_email: '', contact_2_name: '', contact_2_mobile: '', contact_2_email: '',
  contact_3_name: '', contact_3_mobile: '', contact_3_email: '', sales_person_id: '', collection_staff_id: '',
  messenger_id: '', qty_bags_month: '', qty_kgs_month: '', default_commission: '',
})
export const blankSupplierOnly = (): SupplierOnlyForm => ({ machine_type: '', counts_supplying: '', spindles: '', monthly_production: '', current_machines: '' })
export const blankBuyerOnly = (): BuyerOnlyForm => ({ machine_types: [], no_of_looms: '', fabric_producing: '', reed_pick: '', width: '', quantity: '', type_text: '' })

const numText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))

/** Reads the shared profile from a supplier row and/or a buyer row; when both
 *  exist the supplier's value wins unless it is blank. */
export function profileFromRows(s: Partial<PartyProfile> | null | undefined, b: Partial<PartyProfile> | null | undefined): ProfileForm {
  const text = (k: keyof PartyProfile) => {
    const a = s?.[k]
    const z = b?.[k]
    return String((typeof a === 'string' && a.trim() ? a : z) ?? a ?? '')
  }
  const num = (k: 'qty_bags_month' | 'qty_kgs_month') => numText(s?.[k] ?? b?.[k])
  return {
    short_name: text('short_name'), customer_code: text('customer_code'), website: text('website'), map_url: text('map_url'),
    office_phone: text('office_phone'), res_phone: text('res_phone'), mill_address: text('mill_address'), remarks_2: text('remarks_2'),
    contact_1_email: text('contact_1_email'), contact_2_name: text('contact_2_name'), contact_2_mobile: text('contact_2_mobile'),
    contact_2_email: text('contact_2_email'), contact_3_name: text('contact_3_name'), contact_3_mobile: text('contact_3_mobile'),
    contact_3_email: text('contact_3_email'), sales_person_id: text('sales_person_id'),
    collection_staff_id: text('collection_staff_id'), messenger_id: text('messenger_id'),
    qty_bags_month: num('qty_bags_month'), qty_kgs_month: num('qty_kgs_month'),
    default_commission: text('default_commission'),
  }
}

export function supplierOnlyFromRow(row: SupplierMaster | null | undefined): SupplierOnlyForm {
  return {
    machine_type: row?.machine_type ?? '',
    counts_supplying: numText(row?.counts_supplying),
    spindles: numText(row?.spindles),
    monthly_production: numText(row?.monthly_production),
    current_machines: row?.current_machines ?? '',
  }
}

export function buyerOnlyFromRow(row: BuyerMaster | null | undefined): BuyerOnlyForm {
  return {
    machine_types: row?.machine_types ?? [],
    no_of_looms: numText(row?.no_of_looms),
    fabric_producing: row?.fabric_producing ?? '',
    reed_pick: row?.reed_pick ?? '',
    width: row?.width ?? '',
    quantity: numText(row?.quantity),
    type_text: row?.type_text ?? '',
  }
}

/** monday's "Default Commision Percentage" options and the master's codes. */
export const DEFAULT_COMMISSIONS: { value: string; label: string }[] = [
  { value: 'pct', label: 'Percentage of Ex Mill Value' },
  { value: 'per_bag', label: 'Bagwise Rate' },
  { value: 'per_kg', label: 'Rs per kg' },
]

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())
const isPhone = (v: string) => /^[0-9]{6,15}$/.test(v.trim())
const isCount = (v: string) => /^[0-9]+$/.test(v.trim())
const badNumber = (v: string) => v.trim() !== '' && numOrNull(v) === null

/** Warnings for the optional profile fields: only a value that is typed and
 *  malformed is reported, a blank one never is. */
export function profileProblems(f: ProfileForm): string[] {
  const out: string[] = []
  const email = (label: string, v: string) => {
    if (v.trim() && !isEmail(v)) out.push(`${label} (needs an @, or leave blank)`)
  }
  const mobile = (label: string, v: string) => {
    if (v.trim() && !isMobile(v)) out.push(`${label} (10 digits, or leave blank)`)
  }
  const phone = (label: string, v: string) => {
    if (v.trim() && !isPhone(v)) out.push(`${label} (6 to 15 digits, or leave blank)`)
  }
  email('Contact 1 email', f.contact_1_email)
  mobile('Contact 2 mobile', f.contact_2_mobile)
  email('Contact 2 email', f.contact_2_email)
  mobile('Contact 3 mobile', f.contact_3_mobile)
  email('Contact 3 email', f.contact_3_email)
  phone('Office phone', f.office_phone)
  phone('Residence phone', f.res_phone)
  if (badNumber(f.qty_bags_month)) out.push('Bags per month (a number, or leave blank)')
  if (badNumber(f.qty_kgs_month)) out.push('Kgs per month (a number, or leave blank)')
  return out
}

function supplierOnlyProblems(f: SupplierOnlyForm): string[] {
  const out: string[] = []
  if (f.counts_supplying.trim() && !isCount(f.counts_supplying)) out.push('Counts supplying (a whole number, or leave blank)')
  if (f.spindles.trim() && !isCount(f.spindles)) out.push('Spindles (a whole number, or leave blank)')
  if (badNumber(f.monthly_production)) out.push('Monthly production (a number, or leave blank)')
  return out
}

function buyerOnlyProblems(f: BuyerOnlyForm): string[] {
  return f.no_of_looms.trim() && !isCount(f.no_of_looms) ? ['No. of looms (a whole number, or leave blank)'] : []
}

const orNull = (v: string) => v.trim() || null

/** The shared profile columns, ready for an insert or update. */
export function profilePayload(f: ProfileForm) {
  return {
    short_name: orNull(f.short_name),
    customer_code: orNull(f.customer_code),
    website: orNull(f.website),
    map_url: orNull(f.map_url),
    office_phone: orNull(f.office_phone),
    res_phone: orNull(f.res_phone),
    mill_address: orNull(f.mill_address),
    remarks_2: orNull(f.remarks_2),
    contact_1_email: orNull(f.contact_1_email),
    contact_2_name: orNull(f.contact_2_name),
    contact_2_mobile: orNull(f.contact_2_mobile),
    contact_2_email: orNull(f.contact_2_email),
    contact_3_name: orNull(f.contact_3_name),
    contact_3_mobile: orNull(f.contact_3_mobile),
    contact_3_email: orNull(f.contact_3_email),
    sales_person_id: f.sales_person_id || null,
    collection_staff_id: f.collection_staff_id || null,
    messenger_id: f.messenger_id || null,
    qty_bags_month: numOrNull(f.qty_bags_month),
    qty_kgs_month: numOrNull(f.qty_kgs_month),
    default_commission: orNull(f.default_commission),
  }
}

/** "This PAN is also in the other master" -- a party that both buys and
 *  supplies is entered once in each master and recognised by PAN, never
 *  twice in the same one. */
export function SamePartyHint({
  kind,
  pan,
  excludeCode,
}: {
  kind: 'supplier' | 'buyer'
  pan: string
  excludeCode?: string
}) {
  const [match, setMatch] = useState<{ name: string; code: string } | null>(null)
  const cleaned = pan.trim().toUpperCase()

  useEffect(() => {
    let cancelled = false
    if (cleaned.length !== 10) {
      setMatch(null)
      return undefined
    }
    const run = async () => {
      // looking at the OTHER master: a supplier form checks buyers, and vice versa
      const query =
        kind === 'supplier'
          ? supabase.from('buyer_master').select('name, buyer_code').eq('pan', cleaned).limit(1)
          : supabase.from('supplier_master').select('name, supplier_code').eq('pan', cleaned).limit(1)
      const { data } = await query
      if (cancelled) return
      const row = (data?.[0] ?? null) as Record<string, string> | null
      if (!row) return setMatch(null)
      const code = row.buyer_code ?? row.supplier_code ?? ''
      setMatch(code === excludeCode ? null : { name: row.name ?? '', code })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [kind, cleaned, excludeCode])

  if (!match) return null
  return (
    <div className="notice small">
      This PAN is already in the {kind === 'supplier' ? 'Buyer' : 'Supplier'} Master as{' '}
      <strong>{match.name}</strong> ({match.code}). That is fine for a party that both buys and
      supplies: it keeps one record in each master, not two in the same one.
    </div>
  )
}

/* ---- supplier ------------------------------------------------------------- */

export type SupplierForm = {
  name: string
  contact_person: string
  mobile: string
  email: string
  address: string
  gst: string
  pan: string
  bank_account_1: string
  bank_account_2: string
  state_code: string
  state: string
  category: string
  commission_basis: string
  commission_value: string
  product_range: string
  notes: string
  is_active: boolean
} & ProfileForm &
  SupplierOnlyForm

export function blankSupplier(seed: Partial<SupplierForm> = {}): SupplierForm {
  return {
    name: '', contact_person: '', mobile: '', email: '', address: '', gst: '', pan: '',
    bank_account_1: '', bank_account_2: '', state_code: '', state: '', category: '',
    commission_basis: '', commission_value: '', product_range: '', notes: '', is_active: true,
    ...blankProfile(),
    ...blankSupplierOnly(),
    ...seed,
  }
}

export function supplierFromRow(row: SupplierMaster): SupplierForm {
  return {
    ...profileFromRows(row, null),
    ...supplierOnlyFromRow(row),
    name: row.name,
    contact_person: row.contact_person ?? '',
    mobile: row.mobile ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    gst: row.gst ?? '',
    pan: row.pan ?? '',
    bank_account_1: row.bank_account_1 ?? '',
    bank_account_2: row.bank_account_2 ?? '',
    state_code: row.state_code ?? '',
    state: row.state ?? '',
    category: row.category ?? '',
    commission_basis: row.commission_basis ?? '',
    commission_value: row.commission_value === null ? '' : String(row.commission_value),
    product_range: row.product_range ?? '',
    notes: row.notes ?? '',
    is_active: row.is_active,
  }
}

/** What is still wrong with the form, in the words of the Supplier Master
 *  required-field list (empty array = ready to save). */
export function supplierProblems(f: SupplierForm): string[] {
  const out: string[] = []
  if (!f.name.trim()) out.push('Supplier name')
  if (!isGst(f.gst)) out.push('GST (15-character format)')
  if (f.mobile.trim() && !isMobile(f.mobile)) out.push('Mobile (10 digits, or leave blank)')
  if (f.pan.trim() && f.pan.trim().length !== 10) out.push('PAN (10 characters, or leave blank)')
  if (f.state_code.trim()) {
    if (!/^[0-9]{2}$/.test(f.state_code.trim())) out.push('State code (2 digits, or leave blank)')
    else if (isGst(f.gst) && f.gst.trim().slice(0, 2) !== f.state_code.trim()) out.push('State code matching the GST number')
  }
  out.push(...profileProblems(f), ...supplierOnlyProblems(f))
  return out
}

export function supplierPayload(f: SupplierForm) {
  return {
    ...profilePayload(f),
    machine_type: orNull(f.machine_type),
    counts_supplying: numOrNull(f.counts_supplying),
    spindles: numOrNull(f.spindles),
    monthly_production: numOrNull(f.monthly_production),
    current_machines: orNull(f.current_machines),
    name: f.name.trim(),
    contact_person: orNull(f.contact_person),
    mobile: orNull(f.mobile),
    email: f.email.trim() || null,
    address: f.address.trim() || null,
    gst: f.gst.trim().toUpperCase(),
    pan: orNull(f.pan.trim().toUpperCase()),
    bank_account_1: orNull(f.bank_account_1),
    bank_account_2: f.bank_account_2.trim() || null,
    state_code: orNull(f.state_code),
    state: orNull(f.state),
    category: f.category || null,
    commission_basis: f.commission_basis || null,
    commission_value: numOrNull(f.commission_value),
    notes: f.notes.trim() || null,
    is_active: f.is_active,
  }
}

export function SupplierFields({
  form,
  set,
  patch,
  excludeCode,
  idPrefix = 's',
}: {
  form: SupplierForm
  set: <K extends keyof SupplierForm>(key: K, value: SupplierForm[K]) => void
  patch: (values: Partial<SupplierForm>) => void
  excludeCode?: string
  idPrefix?: string
}) {
  const p = idPrefix
  return (
    <>
      <p className="muted small">Fields marked * are required.</p>
      <div className="form-grid">
        <Field id={`${p}-name`} label="Supplier name" required hint="Must be unique -- the same supplier is never entered twice.">
          <input id={`${p}-name`} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field id={`${p}-contact`} label="Contact person" required>
          <input id={`${p}-contact`} value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
        </Field>
        <Field
          id={`${p}-mobile`}
          label="Mobile"
          required
          hint={form.mobile && !isMobile(form.mobile) ? 'Mobile must be exactly 10 digits.' : undefined}
        >
          <input
            id={`${p}-mobile`}
            inputMode="numeric"
            maxLength={10}
            className="mono"
            value={form.mobile}
            onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field id={`${p}-email`} label="Email">
          <input id={`${p}-email`} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field
          id={`${p}-gst`}
          label="GST"
          required
          hint={
            form.gst && !isGst(form.gst)
              ? 'Not a valid GST number yet -- 15 characters, e.g. 33AHFPK5121I1Z5.'
              : 'Format-checked. The state is filled in from the first two digits.'
          }
        >
          <input
            id={`${p}-gst`}
            className="mono"
            maxLength={15}
            value={form.gst}
            onChange={(e) => patch(gstPatch(form, e.target.value))}
          />
        </Field>
        <Field id={`${p}-pan`} label="PAN" required hint="10 characters, upper case.">
          <input
            id={`${p}-pan`}
            className="mono"
            maxLength={10}
            value={form.pan}
            onChange={(e) => set('pan', e.target.value.toUpperCase().replace(/\s+/g, ''))}
          />
        </Field>
        <Field id={`${p}-bank1`} label="Bank A/c (1)" required>
          <input id={`${p}-bank1`} className="mono" value={form.bank_account_1} onChange={(e) => set('bank_account_1', e.target.value)} />
        </Field>
        <Field id={`${p}-bank2`} label="Bank A/c (2)">
          <input id={`${p}-bank2`} className="mono" value={form.bank_account_2} onChange={(e) => set('bank_account_2', e.target.value)} />
        </Field>
        <Field id={`${p}-scode`} label="State code" required>
          <input
            id={`${p}-scode`}
            className="mono"
            maxLength={2}
            inputMode="numeric"
            value={form.state_code}
            onChange={(e) => set('state_code', e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field id={`${p}-state`} label="State" required>
          <input id={`${p}-state`} value={form.state} onChange={(e) => set('state', e.target.value)} />
        </Field>
        <CommissionFields idPrefix={p} form={form} set={set} />
      </div>
      <Field id={`${p}-address`} label="Full address">
        <textarea id={`${p}-address`} rows={3} value={form.address} onChange={(e) => set('address', e.target.value)} />
      </Field>
      <Field id={`${p}-notes`} label="Notes">
        <textarea id={`${p}-notes`} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <SamePartyHint kind="supplier" pan={form.pan} excludeCode={excludeCode} />
    </>
  )
}

/* ---- buyer ---------------------------------------------------------------- */

export type BuyerForm = {
  name: string
  contact_person: string
  mobile: string
  email: string
  address: string
  gst: string
  pan: string
  spindlage_capacity: string
  product_range: string
  state_code: string
  state: string
  category: string
  commission_basis: string
  commission_value: string
  notes: string
  is_active: boolean
  bank_account_1: string
  bank_account_2: string
} & ProfileForm &
  BuyerOnlyForm

export function blankBuyer(seed: Partial<BuyerForm> = {}): BuyerForm {
  return {
    name: '', contact_person: '', mobile: '', email: '', address: '', gst: '', pan: '',
    spindlage_capacity: '', product_range: '', state_code: '', state: '', category: '',
    commission_basis: '', commission_value: '', notes: '', is_active: true,
    bank_account_1: '', bank_account_2: '',
    ...blankProfile(),
    ...blankBuyerOnly(),
    ...seed,
  }
}

export function buyerFromRow(row: BuyerMaster): BuyerForm {
  return {
    ...profileFromRows(row, null),
    ...buyerOnlyFromRow(row),
    bank_account_1: row.bank_account_1 ?? '',
    bank_account_2: row.bank_account_2 ?? '',
    name: row.name,
    contact_person: row.contact_person ?? '',
    mobile: row.mobile ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    gst: row.gst ?? '',
    pan: row.pan ?? '',
    spindlage_capacity: row.spindlage_capacity ?? '',
    product_range: row.product_range ?? '',
    state_code: row.state_code ?? '',
    state: row.state ?? '',
    category: row.category ?? '',
    commission_basis: row.commission_basis ?? '',
    commission_value: row.commission_value === null ? '' : String(row.commission_value),
    notes: row.notes ?? '',
    is_active: row.is_active,
  }
}

/** Buyer Master required fields from T-011: name, contact person, GST, PAN,
 *  capacity/spindlage and product range. */
export function buyerProblems(f: BuyerForm): string[] {
  const out: string[] = []
  if (!f.name.trim()) out.push('Buyer name')
  if (!isGst(f.gst)) out.push('GST (15-character format)')
  if (f.pan.trim() && f.pan.trim().length !== 10) out.push('PAN (10 characters, or leave blank)')
  if (f.mobile.trim() && !isMobile(f.mobile)) out.push('Mobile (10 digits, or leave blank)')
  if (f.state_code.trim()) {
    if (!/^[0-9]{2}$/.test(f.state_code.trim())) out.push('State code (2 digits, or leave blank)')
    else if (isGst(f.gst) && f.gst.trim().slice(0, 2) !== f.state_code.trim()) {
      out.push('State code matching the GST number')
    }
  }
  out.push(...profileProblems(f), ...buyerOnlyProblems(f))
  return out
}

export function buyerPayload(f: BuyerForm) {
  return {
    ...profilePayload(f),
    bank_account_1: orNull(f.bank_account_1),
    bank_account_2: orNull(f.bank_account_2),
    machine_types: f.machine_types.length > 0 ? f.machine_types : null,
    no_of_looms: numOrNull(f.no_of_looms),
    fabric_producing: orNull(f.fabric_producing),
    reed_pick: orNull(f.reed_pick),
    width: orNull(f.width),
    quantity: numOrNull(f.quantity),
    type_text: orNull(f.type_text),
    name: f.name.trim(),
    contact_person: orNull(f.contact_person),
    mobile: f.mobile.trim() || null,
    email: f.email.trim() || null,
    address: f.address.trim() || null,
    gst: f.gst.trim().toUpperCase(),
    pan: orNull(f.pan.trim().toUpperCase()),
    state_code: f.state_code.trim() || null,
    state: f.state.trim() || null,
    category: f.category || null,
    commission_basis: f.commission_basis || null,
    commission_value: numOrNull(f.commission_value),
    notes: f.notes.trim() || null,
    is_active: f.is_active,
  }
}

export function BuyerFields({
  form,
  set,
  patch,
  excludeCode,
  idPrefix = 'b',
}: {
  form: BuyerForm
  set: <K extends keyof BuyerForm>(key: K, value: BuyerForm[K]) => void
  patch: (values: Partial<BuyerForm>) => void
  excludeCode?: string
  idPrefix?: string
}) {
  const p = idPrefix
  return (
    <>
      <p className="muted small">Fields marked * are required.</p>
      <div className="form-grid">
        <Field id={`${p}-name`} label="Buyer name" required hint="Must be unique -- the same buyer is never entered twice.">
          <input id={`${p}-name`} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field id={`${p}-contact`} label="Contact person" required>
          <input id={`${p}-contact`} value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
        </Field>
        <Field
          id={`${p}-mobile`}
          label="Mobile"
          hint={form.mobile && !isMobile(form.mobile) ? 'Mobile must be exactly 10 digits.' : undefined}
        >
          <input
            id={`${p}-mobile`}
            inputMode="numeric"
            maxLength={10}
            className="mono"
            value={form.mobile}
            onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field id={`${p}-email`} label="Email">
          <input id={`${p}-email`} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field
          id={`${p}-gst`}
          label="GST"
          required
          hint={
            form.gst && !isGst(form.gst)
              ? 'Not a valid GST number yet -- 15 characters, e.g. 33AHFPK5121I1Z5.'
              : 'Format-checked. The state is filled in from the first two digits.'
          }
        >
          <input
            id={`${p}-gst`}
            className="mono"
            maxLength={15}
            value={form.gst}
            onChange={(e) => patch(gstPatch(form, e.target.value))}
          />
        </Field>
        <Field id={`${p}-pan`} label="PAN" required hint="10 characters, upper case.">
          <input
            id={`${p}-pan`}
            className="mono"
            maxLength={10}
            value={form.pan}
            onChange={(e) => set('pan', e.target.value.toUpperCase().replace(/\s+/g, ''))}
          />
        </Field>
        <Field id={`${p}-scode`} label="State code">
          <input
            id={`${p}-scode`}
            className="mono"
            maxLength={2}
            inputMode="numeric"
            value={form.state_code}
            onChange={(e) => set('state_code', e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field id={`${p}-state`} label="State">
          <input id={`${p}-state`} value={form.state} onChange={(e) => set('state', e.target.value)} />
        </Field>
        <CommissionFields idPrefix={p} form={form} set={set} />
      </div>
      <Field id={`${p}-address`} label="Full address">
        <textarea id={`${p}-address`} rows={3} value={form.address} onChange={(e) => set('address', e.target.value)} />
      </Field>
      <Field id={`${p}-notes`} label="Notes">
        <textarea id={`${p}-notes`} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <SamePartyHint kind="buyer" pan={form.pan} excludeCode={excludeCode} />
    </>
  )
}

/* ---- the combined contact form (used by the Contacts drawer) ---------------------- */

/** Everything the Contacts drawer edits: the supplier fields plus the
 *  buyer-only ones. Which of them show, and which are required, follows the role. */
export type FullPartyForm = SupplierForm & BuyerOnlyForm & { spindlage_capacity: string }

/** Every section of the contact form, in order: Identity, Contacts, Phones and
 *  web, Addresses, Bank, Commission, Team, Business unit, Locations and
 *  Counts, Production profile, Remarks. `businessUnit` is the page's own
 *  company field, rendered in its place. */
export function PartyProfileSections({
  idPrefix: p,
  form,
  set,
  patch,
  showBuyer,
  showSupplier,
  businessUnit,
  typeField,
  countIds,
  onCountIds,
  linksDisabled,
  linksNote,
}: {
  idPrefix: string
  form: FullPartyForm
  set: <K extends keyof FullPartyForm>(key: K, value: FullPartyForm[K]) => void
  patch: (values: Partial<FullPartyForm>) => void
  showBuyer: boolean
  showSupplier: boolean
  businessUnit?: ReactNode
  /** The Type (role) select, placed second in Buyer & Supplier Details. */
  typeField?: ReactNode
  locationIds: string[]
  countIds: string[]
  onLocationIds: (ids: string[]) => void
  onCountIds: (ids: string[]) => void
  linksDisabled: boolean
  linksNote?: string | null
}) {
  const countOptions = useCountOptions()

  const digits = (key: 'mobile' | 'contact_2_mobile' | 'contact_3_mobile' | 'office_phone' | 'res_phone') => (e: { target: { value: string } }) =>
    set(key, e.target.value.replace(/\D/g, ''))
  const mobileHint = (v: string) => (v && !isMobile(v) ? 'Must be exactly 10 digits.' : undefined)
  const phoneHint = (v: string) => (v && !isPhone(v) ? 'Phone numbers are 6 to 15 digits.' : undefined)
  const emailHint = (v: string) => (v && !isEmail(v) ? 'An email address contains an @.' : undefined)

  const sideWord = showBuyer && showSupplier ? '' : showBuyer ? 'Buyer ' : 'Supplier '

  return (
    <>
      <FormSection title="Buyer & Supplier Details" count={11}>
        <Field id={`${p}-name`} label="Name" required>
          <input id={`${p}-name`} value={form.name} placeholder="Enter Name" onChange={(e) => set('name', e.target.value)} />
        </Field>
        {typeField}
        <Field id={`${p}-email`} label="Email">
          <input id={`${p}-email`} type="email" value={form.email} placeholder="Enter Email" onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field id={`${p}-ophone`} label="Office Phone" required hint={phoneHint(form.office_phone)}>
          <input id={`${p}-ophone`} inputMode="numeric" maxLength={15} className="mono" value={form.office_phone} placeholder="Enter Office Phone" onChange={digits('office_phone')} />
        </Field>
        <Field id={`${p}-address`} label="Office Address" required>
          <textarea id={`${p}-address`} rows={3} value={form.address} placeholder="Enter Office Address" onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field id={`${p}-mill`} label="Mill/Factory/Delivery Address">
          <textarea id={`${p}-mill`} rows={3} value={form.mill_address} placeholder="Enter Mill/Factory/Delivery Address" onChange={(e) => set('mill_address', e.target.value)} />
        </Field>
        <Field id={`${p}-state`} label="State">
          <input id={`${p}-state`} value={form.state} placeholder="Enter State" onChange={(e) => set('state', e.target.value)} />
        </Field>
        <Field
          id={`${p}-gst`}
          label="GST No."
          required
          hint={form.gst && !isGst(form.gst) ? 'Not a valid GST number yet: 15 characters, like 33AHFPK5121I1Z5.' : 'Filling this in sets the state.'}
        >
          <input id={`${p}-gst`} className="mono" maxLength={15} value={form.gst} placeholder="Enter GST No." onChange={(e) => patch(gstPatch(form, e.target.value))} />
        </Field>
        {businessUnit}
        <Field id={`${p}-defcomm`} label="Default Commision Percentage" required>
          <select id={`${p}-defcomm`} value={form.default_commission} onChange={(e) => set('default_commission', e.target.value)}>
            <option value="">-- Select Default Commision Percentage --</option>
            {DEFAULT_COMMISSIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title="Account Details" count={3}>
        <Field id={`${p}-bank1`} label="Bank Account Details 1">
          <input id={`${p}-bank1`} value={form.bank_account_1} placeholder="Enter Bank Account Details 1" onChange={(e) => set('bank_account_1', e.target.value)} />
        </Field>
        <Field id={`${p}-bank2`} label="Bank Account Details 2">
          <input id={`${p}-bank2`} value={form.bank_account_2} placeholder="Enter Bank Account Details 2" onChange={(e) => set('bank_account_2', e.target.value)} />
        </Field>
        <Field id={`${p}-pan`} label="PAN" hint="10 characters, upper case.">
          <input id={`${p}-pan`} className="mono" maxLength={10} value={form.pan} placeholder="Enter PAN" onChange={(e) => set('pan', e.target.value.toUpperCase().replace(/\s+/g, ''))} />
        </Field>
      </FormSection>

      <FormSection title="MD Information" count={3}>
        <Field id={`${p}-contact`} label="Contact Person 1">
          <input id={`${p}-contact`} value={form.contact_person} placeholder="Enter Contact Person 1" onChange={(e) => set('contact_person', e.target.value)} />
        </Field>
        <Field id={`${p}-mobile`} label="Contact Person 1 Phone" hint={mobileHint(form.mobile)}>
          <input id={`${p}-mobile`} inputMode="numeric" maxLength={10} className="mono" value={form.mobile} placeholder="Enter Contact Person 1 Phone" onChange={digits('mobile')} />
        </Field>
        <Field id={`${p}-c1email`} label="Contact Person 1 Email" hint={emailHint(form.contact_1_email)}>
          <input id={`${p}-c1email`} type="email" value={form.contact_1_email} placeholder="Enter Contact Person 1 Email" onChange={(e) => set('contact_1_email', e.target.value)} />
        </Field>
      </FormSection>
      <FormSection title="Account Information" count={3}>
        <Field id={`${p}-c2name`} label="Contact Person 2">
          <input id={`${p}-c2name`} value={form.contact_2_name} placeholder="Enter Contact Person 2" onChange={(e) => set('contact_2_name', e.target.value)} />
        </Field>
        <Field id={`${p}-c2mobile`} label="Contact Person 2 Phone" hint={mobileHint(form.contact_2_mobile)}>
          <input id={`${p}-c2mobile`} inputMode="numeric" maxLength={10} className="mono" value={form.contact_2_mobile} placeholder="Enter Contact Person 2 Phone" onChange={digits('contact_2_mobile')} />
        </Field>
        <Field id={`${p}-c2email`} label="Contact Person 2 Email" hint={emailHint(form.contact_2_email)}>
          <input id={`${p}-c2email`} type="email" value={form.contact_2_email} placeholder="Enter Contact Person 2 Email" onChange={(e) => set('contact_2_email', e.target.value)} />
        </Field>
      </FormSection>

      <FormSection title="Product Configuration" count={3}>
        {linksNote && (
          <FullWidth>
            <p className="field-warn">{linksNote}</p>
          </FullWidth>
        )}
        <LinkPicker
          id={`${p}-counts`}
          label="Counts *"
          options={countOptions}
          value={countIds}
          onChange={onCountIds}
          disabled={linksDisabled}
          placeholder="-- Select Counts --"
        />
        <Field id={`${p}-cb`} label={`${sideWord}Commission Type`}>
          <select id={`${p}-cb`} value={form.commission_basis} onChange={(e) => set('commission_basis', e.target.value)}>
            <option value="">-- Select {sideWord}Commission Type --</option>
            {[
              { value: 'pct', label: 'Percentage' },
              { value: 'per_kg', label: 'KG' },
              { value: 'per_bag', label: 'BAG' },
            ].map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${p}-cv`} label={`${sideWord}Commission Value`}>
          <input id={`${p}-cv`} inputMode="decimal" value={form.commission_value} placeholder={`Enter ${sideWord}Commission Value`} onChange={(e) => set('commission_value', e.target.value)} />
        </Field>
      </FormSection>

      {showBuyer && (
        <FormSection title="Incase of Buyer / Supplier" description="Shown for a Buyer." count={9}>
          <Field id={`${p}-quantity`} label="Quantity" hint={badNumber(form.quantity) ? 'A number.' : undefined}>
            <input id={`${p}-quantity`} inputMode="decimal" value={form.quantity} placeholder="Enter Quantity" onChange={(e) => set('quantity', e.target.value)} />
          </Field>
          <Field id={`${p}-fabric`} label="Fabric Producing">
            <input id={`${p}-fabric`} value={form.fabric_producing} placeholder="Enter Fabric Producing" onChange={(e) => set('fabric_producing', e.target.value)} />
          </Field>
          <Field id={`${p}-looms`} label="No. of Looms" hint={form.no_of_looms && !isCount(form.no_of_looms) ? 'A whole number.' : undefined}>
            <input id={`${p}-looms`} inputMode="numeric" value={form.no_of_looms} placeholder="Enter No. of Looms" onChange={(e) => set('no_of_looms', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id={`${p}-qbags`} label="Buyer Qty(Bags/month)" hint={badNumber(form.qty_bags_month) ? 'A number.' : undefined}>
            <input id={`${p}-qbags`} inputMode="decimal" value={form.qty_bags_month} placeholder="Enter Buyer Qty(Bags/month)" onChange={(e) => set('qty_bags_month', e.target.value)} />
          </Field>
          <Field id={`${p}-qkgs`} label="Buyer Qty(Kgs/month)" hint={badNumber(form.qty_kgs_month) ? 'A number.' : undefined}>
            <input id={`${p}-qkgs`} inputMode="decimal" value={form.qty_kgs_month} placeholder="Enter Buyer Qty(Kgs/month)" onChange={(e) => set('qty_kgs_month', e.target.value)} />
          </Field>
          <Field id={`${p}-reed`} label="Reed * Pick">
            <input id={`${p}-reed`} value={form.reed_pick} placeholder="Enter Reed * Pick" onChange={(e) => set('reed_pick', e.target.value)} />
          </Field>
          <Field id={`${p}-width`} label="Width">
            <input id={`${p}-width`} value={form.width} placeholder="Enter Width" onChange={(e) => set('width', e.target.value)} />
          </Field>
          <Field id={`${p}-typetext`} label="Type">
            <input id={`${p}-typetext`} value={form.type_text} placeholder="Enter Type" onChange={(e) => set('type_text', e.target.value)} />
          </Field>
        </FormSection>
      )}
      {showSupplier && (
        <FormSection title="Incase of Buyer / Supplier" description="Shown for a Supplier." count={6}>
          <Field id={`${p}-mtype`} label="Supplier Machine Type">
            <input id={`${p}-mtype`} value={form.machine_type} placeholder="Enter Supplier Machine Type" onChange={(e) => set('machine_type', e.target.value)} />
          </Field>
          <Field id={`${p}-csup`} label="Counts Supplying" hint={form.counts_supplying && !isCount(form.counts_supplying) ? 'A whole number.' : undefined}>
            <input id={`${p}-csup`} inputMode="numeric" value={form.counts_supplying} placeholder="Enter Counts Supplying" onChange={(e) => set('counts_supplying', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id={`${p}-curmach`} label="Current Machines">
            <input id={`${p}-curmach`} value={form.current_machines} placeholder="Enter Current Machines" onChange={(e) => set('current_machines', e.target.value)} />
          </Field>
          <Field id={`${p}-spindles`} label="Supplier No. of Roters & Spindles" hint={form.spindles && !isCount(form.spindles) ? 'A whole number.' : undefined}>
            <input id={`${p}-spindles`} inputMode="numeric" value={form.spindles} placeholder="Enter Supplier No. of Roters & Spindles" onChange={(e) => set('spindles', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id={`${p}-mprod`} label="Monthly Production Quantity" hint={badNumber(form.monthly_production) ? 'A number.' : undefined}>
            <input id={`${p}-mprod`} inputMode="decimal" value={form.monthly_production} placeholder="Enter Monthly Production Quantity" onChange={(e) => set('monthly_production', e.target.value)} />
          </Field>
          {!showBuyer && (
            <>
              <Field id={`${p}-qkgs`} label="Supplier Qty(Kgs/month)" hint={badNumber(form.qty_kgs_month) ? 'A number.' : undefined}>
                <input id={`${p}-qkgs`} inputMode="decimal" value={form.qty_kgs_month} placeholder="Enter Supplier Qty(Kgs/month)" onChange={(e) => set('qty_kgs_month', e.target.value)} />
              </Field>
              <Field id={`${p}-qbags`} label="Supplier Qty(Bags/month)" hint={badNumber(form.qty_bags_month) ? 'A number.' : undefined}>
                <input id={`${p}-qbags`} inputMode="decimal" value={form.qty_bags_month} placeholder="Enter Supplier Qty(Bags/month)" onChange={(e) => set('qty_bags_month', e.target.value)} />
              </Field>
            </>
          )}
        </FormSection>
      )}

      <FormSection title="Remarks" count={2}>
        <Field id={`${p}-notes`} label="Remark 1">
          <textarea id={`${p}-notes`} rows={3} value={form.notes} placeholder="Enter Remark 1" onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <Field id={`${p}-remarks2`} label="Remark 2">
          <textarea id={`${p}-remarks2`} rows={3} value={form.remarks_2} placeholder="Enter Remark 2" onChange={(e) => set('remarks_2', e.target.value)} />
        </Field>
      </FormSection>

    </>
  )
}
