/** The Supplier Master and Buyer Master forms, as reusable pieces.
 *
 *  They are used twice: by the Suppliers / Buyers screens, and inline by the
 *  Qualify Lead panel, where a lead whose party is not yet in a master can
 *  have that master record created on the spot (T-011: "If not: user can
 *  create Master with required fields"). The required fields below are the
 *  ones the story lists; the database enforces the same rules. */

import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIES, COMMISSION_BASES } from '../api/types'
import type { BuyerMaster, SupplierMaster } from '../api/types'
import { GST_STATES, isGst, isMobile, numOrNull } from '../lib/party'

/* ---- shared bits ---------------------------------------------------------- */

export function Field({
  id,
  label,
  required,
  hint,
  children,
}: {
  id: string
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
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
}: {
  idPrefix: string
  form: T
  set: <K extends keyof T>(key: K, value: T[K]) => void
}) {
  return (
    <>
      <Field id={`${idPrefix}-cat`} label="Category" hint="1 = highest volume … 4 = lowest.">
        <select id={`${idPrefix}-cat`} value={form.category} onChange={(e) => set('category', e.target.value as T['category'])}>
          <option value="">—</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
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
}

export function blankSupplier(seed: Partial<SupplierForm> = {}): SupplierForm {
  return {
    name: '', contact_person: '', mobile: '', email: '', address: '', gst: '', pan: '',
    bank_account_1: '', bank_account_2: '', state_code: '', state: '', category: '',
    commission_basis: '', commission_value: '', product_range: '', notes: '', is_active: true,
    ...seed,
  }
}

export function supplierFromRow(row: SupplierMaster): SupplierForm {
  return {
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
  if (!f.contact_person.trim()) out.push('Contact person')
  if (!isMobile(f.mobile)) out.push('Mobile (10 digits)')
  if (!isGst(f.gst)) out.push('GST (15-character format)')
  if (f.pan.trim().length !== 10) out.push('PAN (10 characters)')
  if (!f.bank_account_1.trim()) out.push('Bank A/c')
  if (!/^[0-9]{2}$/.test(f.state_code.trim())) out.push('State code (2 digits)')
  if (!f.state.trim()) out.push('State')
  if (isGst(f.gst) && /^[0-9]{2}$/.test(f.state_code.trim()) && f.gst.trim().slice(0, 2) !== f.state_code.trim()) {
    out.push('State code matching the GST number')
  }
  return out
}

export function supplierPayload(f: SupplierForm) {
  return {
    name: f.name.trim(),
    contact_person: f.contact_person.trim(),
    mobile: f.mobile.trim(),
    email: f.email.trim() || null,
    address: f.address.trim() || null,
    gst: f.gst.trim().toUpperCase(),
    pan: f.pan.trim().toUpperCase(),
    bank_account_1: f.bank_account_1.trim(),
    bank_account_2: f.bank_account_2.trim() || null,
    state_code: f.state_code.trim(),
    state: f.state.trim(),
    category: f.category || null,
    commission_basis: f.commission_basis || null,
    commission_value: numOrNull(f.commission_value),
    product_range: f.product_range.trim() || null,
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
        <Field id={`${p}-range`} label="Product range" hint="Counts and yarn types this supplier makes -- used by the supplier search.">
          <input id={`${p}-range`} value={form.product_range} onChange={(e) => set('product_range', e.target.value)} />
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
}

export function blankBuyer(seed: Partial<BuyerForm> = {}): BuyerForm {
  return {
    name: '', contact_person: '', mobile: '', email: '', address: '', gst: '', pan: '',
    spindlage_capacity: '', product_range: '', state_code: '', state: '', category: '',
    commission_basis: '', commission_value: '', notes: '', is_active: true,
    ...seed,
  }
}

export function buyerFromRow(row: BuyerMaster): BuyerForm {
  return {
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
  if (!f.contact_person.trim()) out.push('Contact person')
  if (!isGst(f.gst)) out.push('GST (15-character format)')
  if (f.pan.trim().length !== 10) out.push('PAN (10 characters)')
  if (!f.spindlage_capacity.trim()) out.push('Capacity / spindlage')
  if (!f.product_range.trim()) out.push('Product range')
  if (f.mobile.trim() && !isMobile(f.mobile)) out.push('Mobile (10 digits, or leave blank)')
  if (f.state_code.trim()) {
    if (!/^[0-9]{2}$/.test(f.state_code.trim())) out.push('State code (2 digits, or leave blank)')
    else if (isGst(f.gst) && f.gst.trim().slice(0, 2) !== f.state_code.trim()) {
      out.push('State code matching the GST number')
    }
  }
  return out
}

export function buyerPayload(f: BuyerForm) {
  return {
    name: f.name.trim(),
    contact_person: f.contact_person.trim(),
    mobile: f.mobile.trim() || null,
    email: f.email.trim() || null,
    address: f.address.trim() || null,
    gst: f.gst.trim().toUpperCase(),
    pan: f.pan.trim().toUpperCase(),
    spindlage_capacity: f.spindlage_capacity.trim(),
    product_range: f.product_range.trim(),
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
        <Field id={`${p}-spin`} label="Capacity / spindlage" required>
          <input id={`${p}-spin`} value={form.spindlage_capacity} onChange={(e) => set('spindlage_capacity', e.target.value)} />
        </Field>
        <Field id={`${p}-range`} label="Product range" required hint="The counts and types this buyer uses.">
          <input id={`${p}-range`} value={form.product_range} onChange={(e) => set('product_range', e.target.value)} />
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