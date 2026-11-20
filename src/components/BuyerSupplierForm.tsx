/** The "Buyer & Supplier Creation Form" of the monday Buyers & Suppliers board.
 *
 *  Same fields, same order, same required marks: Select Action (create or
 *  update), Name, Date, Type, Email, Office Phone, Office Address,
 *  Mill/Factory/Delivery Address, State, GST No., Business Unit, Location MDM,
 *  Default Commission, Category, Messenger, PAN, three contact persons
 *  (name, phone, email), Counts, the buyer and supplier commission type and
 *  value, two remarks and up to ten documents.
 *
 *  A monday item is one buyer or one supplier, so Type picks the master the
 *  record is written to. Changing a saved record is Actions > Edit on the list. */

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { BuyerMaster, SupplierMaster } from '../api/types'
import { Drawer } from './Drawer'
import { DEFAULT_COMMISSIONS, Field, FieldErrorsProvider } from './PartyForms'
import { PhoneField } from './PhoneField'
import { ErrorBanner, FormSection, FullWidth } from './FormKit'
import { findDuplicate, focusFirstError, isEmail, isPan, nameKey, panMatchesGst, nameProblem, personProblem, placeProblem, requireText, type FieldErrors } from '../lib/validate'
import { PendingDocuments } from './documents/PendingDocuments'
import { LinkPicker, useCountOptions } from './LinkPicker'
import { syncLinks } from '../lib/links'
import { errMessage, GST_STATES, isGst, numOrNull } from '../lib/party'
import { phoneProblem, splitPhone } from '../lib/phone'

type Side = 'buyer' | 'supplier'

/** monday's Buyer / Supplier Commission Type labels and the master's codes. */
const COMMISSION_TYPES: { value: string; label: string }[] = [
  { value: 'pct', label: 'Percentage' },
  { value: 'per_kg', label: 'KG' },
  { value: 'per_bag', label: 'BAG' },
]

const BUCKET = 'party-documents'

interface CompanyOption {
  id: string
  name: string
  is_active: boolean
}

type FormState = {
  name: string
  record_at: string // datetime-local
  type: Side
  email: string
  office_phone: string
  address: string
  mill_address: string
  state: string
  gst: string
  company_id: string
  default_commission: string
  category: string
  messenger_id: string
  pan: string
  bank_1: string
  bank_2: string
  c1_name: string
  c1_phone: string
  c1_email: string
  c2_name: string
  c2_phone: string
  c2_email: string
  c3_name: string
  c3_phone: string
  c3_email: string
  commission_type: string
  commission_value: string
  remark_1: string
  remark_2: string
  // "Incase of Buyer / Supplier" questions
  fabric_producing: string
  no_of_looms: string
  reed_pick: string
  width: string
  quantity: string
  type_text: string
  current_machines: string
  machine_type: string
  counts_supplying: string
  spindles: string
  monthly_production: string
  qty_bags: string
  qty_kgs: string
}

const nowLocal = (): string => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

const blank = (type: Side): FormState => ({
  name: '', record_at: nowLocal(), type, email: '', office_phone: '', address: '', mill_address: '', state: '', gst: '',
  company_id: '', default_commission: '', category: '', messenger_id: '', pan: '', bank_1: '', bank_2: '',
  c1_name: '', c1_phone: '', c1_email: '', c2_name: '', c2_phone: '', c2_email: '', c3_name: '', c3_phone: '', c3_email: '',
  commission_type: '', commission_value: '', remark_1: '', remark_2: '',
  fabric_producing: '', no_of_looms: '', reed_pick: '', width: '', quantity: '', type_text: '', current_machines: '', machine_type: '', counts_supplying: '',
  spindles: '', monthly_production: '', qty_bags: '', qty_kgs: '',
})

const orNull = (v: string) => v.trim() || null

/** Digits the database stores: an Indian number as its 10 digits, another
 *  country's as code plus number (the office phone column takes 6 to 15). */
function storedPhone(value: string): string | null {
  const { code, number } = splitPhone(value)
  if (!number) return null
  return code === '+91' ? number : `${code.slice(1)}${number}`
}

/** A contact person's phone must be a 10-digit Indian mobile (the column's rule). */
function mobileProblem(value: string): string | null {
  const { code, number } = splitPhone(value)
  if (!number) return null
  if (code !== '+91') return 'Contact phones take an Indian (+91) mobile number.'
  return phoneProblem(value)
}

interface RuleCtx {
  buyers: readonly BuyerMaster[]
  suppliers: readonly SupplierMaster[]
  /** Type = Both: a buyer and a supplier record are created together, so both lists are checked. */
  both?: boolean
  /** The record being updated, so it does not count as its own duplicate. */
  selfId?: string | null
}

const upText = (v: string | null | undefined) => (v ?? '').trim().toUpperCase()

/** Field id -> message, in the order the fields appear. */
export function errorsOf(f: FormState, countIds: string[], ctx: RuleCtx): FieldErrors {
  const er: FieldErrors = {}
  const list: readonly (BuyerMaster | SupplierMaster)[] = f.type === 'buyer' ? ctx.buyers : ctx.suppliers
  const kind = f.type === 'buyer' ? 'buyer' : 'supplier'
  const otherList: readonly (BuyerMaster | SupplierMaster)[] = f.type === 'buyer' ? ctx.suppliers : ctx.buyers
  const codeOf = (r: BuyerMaster | SupplierMaster) => ('buyer_code' in r ? r.buyer_code : r.supplier_code)

  requireText(er, 'bs-name', f.name, 'Name is required.')
  if (!er['bs-name']) { const m = nameProblem('Name', f.name); if (m) er['bs-name'] = m }
  if (!er['bs-name']) {
    const dup = findDuplicate(list, ctx.selfId, (r) => r.name, f.name, nameKey)
    if (dup) er['bs-name'] = `A ${kind} called "${dup.name}" already exists (${codeOf(dup)}).`
    else if (ctx.both) {
      const other = findDuplicate(otherList, null, (r) => r.name, f.name, nameKey)
      if (other) er['bs-name'] = `A ${f.type === 'buyer' ? 'supplier' : 'buyer'} called "${other.name}" already exists (${codeOf(other)}).`
    }
  }
  if (f.email.trim() && !isEmail(f.email)) er['bs-email'] = 'Enter a valid email, like name@company.com.'
  if (!f.office_phone.trim() || splitPhone(f.office_phone).number === '') er['bs-ophone'] = 'Office Phone is required.'
  else {
    const problem = phoneProblem(f.office_phone)
    if (problem) er['bs-ophone'] = problem
    else if (storedPhone(f.office_phone)!.length > 15 || storedPhone(f.office_phone)!.length < 6) er['bs-ophone'] = 'The number with its country code must be 6 to 15 digits.'
  }
  requireText(er, 'bs-address', f.address, 'Office Address is required.')
  { const m = placeProblem('State', f.state); if (m) er['bs-state'] = m }
  ;([['bs-c1n', 'Contact Person 1', f.c1_name], ['bs-c2n', 'Contact Person 2', f.c2_name], ['bs-c3n', 'Contact Person 3', f.c3_name]] as const).forEach(([id, label, v]) => {
    const m = personProblem(label, v)
    if (m) er[id] = m
  })
  const gst = upText(f.gst)
  if (!gst) er['bs-gst'] = 'GST No. is required.'
  else if (!isGst(gst)) er['bs-gst'] = 'Enter a complete GST number (15 characters, like 33AHFPK5121I1Z5).'
  else {
    const dup = findDuplicate(list, ctx.selfId, (r) => r.gst, gst, upText)
    if (dup) er['bs-gst'] = `This GST number is already used by ${kind} "${dup.name}" (${codeOf(dup)}).`
    else if (ctx.both) {
      const other = findDuplicate(otherList, null, (r) => r.gst, gst, upText)
      if (other) er['bs-gst'] = `This GST number is already used by ${f.type === 'buyer' ? 'supplier' : 'buyer'} "${other.name}" (${codeOf(other)}).`
    }
  }
  if (!f.company_id) er['bs-company'] = 'Business Unit is required.'
  if (!f.default_commission) er['bs-defcomm'] = 'Default Commision Percentage is required.'
  if (ctx.both && !f.pan.trim()) er['bs-pan'] = 'PAN is required for Both: it ties the buyer and the supplier record together.'
  if (f.pan.trim()) {
    if (!isPan(f.pan)) er['bs-pan'] = 'Enter a valid PAN: 5 letters, 4 digits, 1 letter (like AHFPK5121I).'
    else if (gst && isGst(gst) && !panMatchesGst(gst, f.pan)) er['bs-pan'] = 'PAN must match the GST number (characters 3 to 12 of the GST).'
  }
  ;([
    [1, f.c1_phone, f.c1_email], [2, f.c2_phone, f.c2_email], [3, f.c3_phone, f.c3_email],
  ] as const).forEach(([n, phone, email]) => {
    const problem = mobileProblem(phone)
    if (problem) er[`bs-c${n}p`] = problem
    if (email.trim() && !isEmail(email)) er[`bs-c${n}e`] = 'Enter a valid email, like name@company.com.'
  })
  if (countIds.length === 0) er['bs-counts'] = 'Counts is required: choose at least one.'
  if (f.commission_value.trim()) {
    const n = numOrNull(f.commission_value)
    if (n === null || n < 0) er['bs-cval'] = 'Commission value must be a number, 0 or more.'
  }
  const whole = (id: string, label: string, v: string) => {
    if (v.trim() && !/^[0-9]+$/.test(v.trim())) er[id] = `${label} must be a whole number, 0 or more.`
  }
  const amount = (id: string, label: string, v: string) => {
    const n = numOrNull(v)
    if (v.trim() && (n === null || n < 0)) er[id] = `${label} must be a number, 0 or more.`
  }
  if (f.type === 'buyer') {
    whole('bs-looms', 'No. of Looms', f.no_of_looms)
    amount('bs-quantity', 'Quantity', f.quantity)
  } else {
    whole('bs-csup', 'Counts Supplying', f.counts_supplying)
    whole('bs-spindles', 'Supplier No. of Roters & Spindles', f.spindles)
    amount('bs-mprod', 'Monthly Production Quantity', f.monthly_production)
  }
  amount('bs-qbags', 'Qty(Bags/month)', f.qty_bags)
  amount('bs-qkgs', 'Qty(Kgs/month)', f.qty_kgs)
  return er
}

/** The same rules as plain sentences. */
export const problemsOf = (f: FormState, countIds: string[], ctx: RuleCtx): string[] => Object.values(errorsOf(f, countIds, ctx))

function payloadOf(f: FormState) {
  const state = isGst(f.gst) ? f.gst.slice(0, 2) : null
  const contact = orNull(f.c1_name)
  const mobile = storedPhone(f.c1_phone)
  const pan = f.pan.trim().toUpperCase()
  return {
    name: f.name.trim(),
    record_at: new Date(f.record_at || Date.now()).toISOString(),
    email: orNull(f.email),
    office_phone: storedPhone(f.office_phone),
    address: orNull(f.address),
    mill_address: orNull(f.mill_address),
    state: orNull(f.state),
    state_code: state,
    gst: f.gst.trim().toUpperCase(),
    default_commission: f.default_commission || null,
    category: f.category || null,
    messenger_id: f.messenger_id || null,
    pan: pan || null,
    bank_account_1: orNull(f.bank_1),
    bank_account_2: orNull(f.bank_2),
    contact_person: contact,
    mobile,
    contact_1_email: orNull(f.c1_email),
    contact_2_name: orNull(f.c2_name),
    contact_2_mobile: storedPhone(f.c2_phone),
    contact_2_email: orNull(f.c2_email),
    contact_3_name: orNull(f.c3_name),
    contact_3_mobile: storedPhone(f.c3_phone),
    contact_3_email: orNull(f.c3_email),
    commission_basis: f.commission_type || null,
    commission_value: numOrNull(f.commission_value),
    notes: orNull(f.remark_1),
    remarks_2: orNull(f.remark_2),
    company_id: f.company_id || null,
    qty_bags_month: numOrNull(f.qty_bags),
    qty_kgs_month: numOrNull(f.qty_kgs),
    ...(f.type === 'buyer'
      ? {
          fabric_producing: orNull(f.fabric_producing),
          no_of_looms: numOrNull(f.no_of_looms),
          reed_pick: orNull(f.reed_pick),
          width: orNull(f.width),
          quantity: numOrNull(f.quantity),
          type_text: orNull(f.type_text),
        }
      : {
          machine_type: orNull(f.machine_type),
          counts_supplying: numOrNull(f.counts_supplying),
          spindles: numOrNull(f.spindles),
          monthly_production: numOrNull(f.monthly_production),
          current_machines: orNull(f.current_machines),
        }),
    // the masters' own required details; the Contacts list marks what is still missing
    incomplete: !(pan.length === 10 && contact && mobile),
  }
}

export function BuyerSupplierForm({
  companies,
  suppliers,
  buyers,
  canBuyer,
  canSupplier,
  onClose,
  onDone,
}: {
  companies: CompanyOption[]
  suppliers: SupplierMaster[]
  buyers: BuyerMaster[]
  canBuyer: boolean
  canSupplier: boolean
  onClose: () => void
  onDone: (message: string, kind?: 'ok' | 'bad') => void | Promise<void>
}) {
  const firstSide: Side = canBuyer ? 'buyer' : 'supplier'
  const [form, setForm] = useState<FormState>(() => blank(firstSide))
  const [locationIds, setLocationIds] = useState<string[]>([])
  const [countIds, setCountIds] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  /** Type = Both: the buyer and the supplier record are created together, sharing the PAN. */
  const [both, setBoth] = useState(false)

  const countOptions = useCountOptions()

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }))

  function clearForm() {
    setError(null)
    setFiles([])
    setForm(blank(form.type))
    setBoth(false)
    setLocationIds([])
    setCountIds([])
  }

  const errors = errorsOf(form, countIds, { buyers, suppliers, both })
  const typed: Record<string, string> = {
    'bs-name': form.name, 'bs-state': form.state, 'bs-c1n': form.c1_name, 'bs-c2n': form.c2_name, 'bs-c3n': form.c3_name, 'bs-email': form.email, 'bs-ophone': form.office_phone, 'bs-address': form.address, 'bs-gst': form.gst,
    'bs-company': form.company_id, 'bs-defcomm': form.default_commission, 'bs-pan': form.pan, 'bs-c1p': form.c1_phone,
    'bs-c1e': form.c1_email, 'bs-c2p': form.c2_phone, 'bs-c2e': form.c2_email, 'bs-c3p': form.c3_phone, 'bs-c3e': form.c3_email,
    'bs-counts': countIds.join(','), 'bs-cval': form.commission_value, 'bs-looms': form.no_of_looms, 'bs-quantity': form.quantity, 'bs-csup': form.counts_supplying,
    'bs-spindles': form.spindles, 'bs-mprod': form.monthly_production, 'bs-qbags': form.qty_bags, 'bs-qkgs': form.qty_kgs,
  }
  // A missing required value is reported after the first Save click; a wrong or duplicate one shows as it is typed.
  const visibleErrors: Record<string, string> = Object.fromEntries(
    Object.entries(errors).filter(([id]) => submitted || (typed[id] ?? '').trim() !== ''),
  )
  const allowed = (s: Side) => (s === 'buyer' ? canBuyer : canSupplier)
  const canSave = both ? canBuyer && canSupplier : allowed(form.type)

  async function uploadFiles(owner: Side, ownerId: string): Promise<string[]> {
    const failed: string[] = []
    for (const file of files) {
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_')
      const path = `${owner}/${ownerId}/${crypto.randomUUID()}-${safe}`
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
      if (up.error) {
        failed.push(file.name)
        continue
      }
      const { error: dbError } = await supabase.from('party_documents').insert({
        party_type: owner,
        party_id: ownerId,
        doc_type: 'other',
        file_name: file.name,
        storage_path: path,
        size_bytes: file.size,
        mime_type: file.type || null,
      })
      if (dbError) {
        await supabase.storage.from(BUCKET).remove([path])
        failed.push(file.name)
      }
    }
    return failed
  }

  async function save() {
    setSubmitted(true)
    setError(null)
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors)
      return
    }
    setBusy(true)
    const sides: Side[] = both ? ['buyer', 'supplier'] : [form.type]
    const created: { side: Side; id: string }[] = []
    for (const side of sides) {
      const table = side === 'buyer' ? 'buyer_master' : 'supplier_master'
      const payload: Record<string, unknown> = payloadOf({ ...form, type: side })
      const { data, error: e } = await supabase.from(table).insert(payload).select('id').single()
      if (e) {
        // Both is all or nothing: take back the record already made.
        for (const done of created) await supabase.from(done.side === 'buyer' ? 'buyer_master' : 'supplier_master').delete().eq('id', done.id)
        setBusy(false)
        setError(errMessage(e, `Could not save the ${side} record`))
        return
      }
      created.push({ side, id: (data as { id: string }).id })
    }

    const problemsAfter: string[] = []
    for (const { side, id: ownerId } of created) {
      for (const [kind, ids] of [['location', locationIds], ['count', countIds]] as const) {
        try {
          await syncLinks(kind, side, ownerId, ids)
        } catch (caught) {
          problemsAfter.push(`${kind === 'location' ? 'locations' : 'counts'}: ${errMessage(caught)}`)
        }
      }
      if (files.length > 0) {
        const failed = await uploadFiles(side, ownerId)
        if (failed.length > 0) problemsAfter.push(`documents not uploaded: ${failed.join(', ')}`)
      }
    }
    setBusy(false)
    const saved = `${form.name.trim()} added.`
    if (problemsAfter.length > 0) {
      await onDone(`${saved} The record is saved, but ${problemsAfter.join('; ')}. Open it with Actions > Edit to retry.`, 'bad')
      return
    }
    await onDone(saved)
  }

  return (
    <Drawer title="Buyers & Suppliers Creation Form" onClose={onClose}>
      <ErrorBanner message={error} />

      <FieldErrorsProvider value={visibleErrors}>
      <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <FormSection title="Buyer & Supplier Details" count={11}>
          <Field id="bs-name" label="Name" required>
            <input id="bs-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Enter Name" autoFocus />
          </Field>
          <Field id="bs-date" label="Date">
            <input id="bs-date" type="datetime-local" value={form.record_at} onChange={(e) => set('record_at', e.target.value)} />
          </Field>
          <Field id="bs-type" label="Type" required>
            <select
              id="bs-type"
              value={both ? 'both' : form.type}
              onChange={(e) => {
                const v = e.target.value
                setBoth(v === 'both')
                set('type', v === 'supplier' ? 'supplier' : 'buyer')
              }}
            >
              <option value="buyer" disabled={!canBuyer}>
                Buyer
              </option>
              <option value="supplier" disabled={!canSupplier}>
                Supplier
              </option>
              <option value="both" disabled={!(canBuyer && canSupplier)}>
                Both
              </option>
            </select>
          </Field>
          <Field id="bs-email" label="Email">
            <input id="bs-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="Enter Email" />
          </Field>
          <PhoneField id="bs-ophone" label="Office Phone" required value={form.office_phone} onChange={(v) => set('office_phone', v)} />
          <Field id="bs-address" label="Office Address" required>
            <textarea id="bs-address" rows={3} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Enter Office Address" />
          </Field>
          <Field id="bs-mill" label="Mill/Factory/Delivery Address">
            <textarea id="bs-mill" rows={3} value={form.mill_address} onChange={(e) => set('mill_address', e.target.value)} placeholder="Enter Mill/Factory/Delivery Address" />
          </Field>
          <Field id="bs-state" label="State">
            <input id="bs-state" value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="Enter State" />
          </Field>
          <Field id="bs-gst" label="GST No." required hint={form.gst.trim() && !isGst(form.gst) ? undefined : 'Filling this in sets the state.'}>
            <input
              id="bs-gst"
              className="mono"
              maxLength={15}
              value={form.gst}
              placeholder="Enter GST No."
              onChange={(e) => {
                const gst = e.target.value.replace(/^\s*gstin\s*:?\s*/i, '').replace(/\s+/g, '').toUpperCase()
                setForm((p) => {
                  const named = GST_STATES[gst.slice(0, 2)]
                  const prevNamed = GST_STATES[p.gst.slice(0, 2)]
                  return { ...p, gst, state: isGst(gst) && named && (p.state.trim() === '' || p.state === prevNamed) ? named : p.state }
                })
              }}
            />
            {form.gst.trim() !== '' && !isGst(form.gst) && <p className="field-warn">Not a complete GST number yet (15 characters).</p>}
          </Field>
          <Field id="bs-company" label="Business Unit" required>
            <select id="bs-company" value={form.company_id} onChange={(e) => set('company_id', e.target.value)}>
              <option value="">-- Select Business Unit --</option>
              {companies
                .filter((c) => c.is_active || c.id === form.company_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field id="bs-defcomm" label="Default Commision Percentage" required>
            <select id="bs-defcomm" value={form.default_commission} onChange={(e) => set('default_commission', e.target.value)}>
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
          <Field id="bs-bank1" label="Bank Account Details 1">
            <input id="bs-bank1" value={form.bank_1} onChange={(e) => set('bank_1', e.target.value)} placeholder="Enter Bank Account Details 1" />
          </Field>
          <Field id="bs-bank2" label="Bank Account Details 2">
            <input id="bs-bank2" value={form.bank_2} onChange={(e) => set('bank_2', e.target.value)} placeholder="Enter Bank Account Details 2" />
          </Field>
          <Field id="bs-pan" label="PAN" hint="10 characters, upper case.">
            <input id="bs-pan" className="mono" maxLength={10} value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} placeholder="Enter PAN" />
          </Field>
        </FormSection>

        {([
          [1, 'MD Information'],
          [2, 'Account Information'],
        ] as const).map(([n, title]) => {
          const k = `c${n}` as 'c1' | 'c2'
          return (
            <FormSection key={n} title={title} count={3}>
              <Field id={`bs-${k}n`} label={`Contact Person ${n}`}>
                <input id={`bs-${k}n`} value={form[`${k}_name`]} onChange={(e) => set(`${k}_name`, e.target.value)} placeholder={`Enter Contact Person ${n}`} />
              </Field>
              <PhoneField id={`bs-${k}p`} indianOnly label={`Contact Person ${n} Phone`} value={form[`${k}_phone`]} onChange={(v) => set(`${k}_phone`, v)} />
              <Field id={`bs-${k}e`} label={`Contact Person ${n} Email`}>
                <input id={`bs-${k}e`} type="email" value={form[`${k}_email`]} onChange={(e) => set(`${k}_email`, e.target.value)} placeholder={`Enter Contact Person ${n} Email`} />
              </Field>
            </FormSection>
          )
        })}

        <FormSection title="Product Configuration" count={3}>
          <LinkPicker
            id="bs-counts"
            label="Counts *"
            options={countOptions}
            value={countIds}
            onChange={setCountIds}
            placeholder="-- Select Counts --"
          />
          <Field id="bs-ctype" label={`${form.type === 'buyer' ? 'Buyer' : 'Supplier'} Commission Type`}>
            <select id="bs-ctype" value={form.commission_type} onChange={(e) => set('commission_type', e.target.value)}>
              <option value="">-- Select {form.type === 'buyer' ? 'Buyer' : 'Supplier'} Commission Type --</option>
              {COMMISSION_TYPES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="bs-cval" label={`${form.type === 'buyer' ? 'Buyer' : 'Supplier'} Commission Value`}>
            <input
              id="bs-cval"
              inputMode="decimal"
              value={form.commission_value}
              onChange={(e) => set('commission_value', e.target.value)}
              placeholder={`Enter ${form.type === 'buyer' ? 'Buyer' : 'Supplier'} Commission Value`}
            />
          </Field>
        </FormSection>

        {form.type === 'buyer' ? (
          <FormSection title="Incase of Buyer / Supplier" description="Shown for a Buyer." count={8}>
            <Field id="bs-quantity" label="Quantity">
              <input id="bs-quantity" inputMode="decimal" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="Enter Quantity" />
            </Field>
            <Field id="bs-fabric" label="Fabric Producing">
              <input id="bs-fabric" value={form.fabric_producing} onChange={(e) => set('fabric_producing', e.target.value)} placeholder="Enter Fabric Producing" />
            </Field>
            <Field id="bs-looms" label="No. of Looms">
              <input id="bs-looms" inputMode="numeric" value={form.no_of_looms} onChange={(e) => set('no_of_looms', e.target.value)} placeholder="Enter No. of Looms" />
            </Field>
            <Field id="bs-qbags" label="Buyer Qty(Bags/month)">
              <input id="bs-qbags" inputMode="decimal" value={form.qty_bags} onChange={(e) => set('qty_bags', e.target.value)} placeholder="Enter Buyer Qty(Bags/month)" />
            </Field>
            <Field id="bs-qkgs" label="Buyer Qty(Kgs/month)">
              <input id="bs-qkgs" inputMode="decimal" value={form.qty_kgs} onChange={(e) => set('qty_kgs', e.target.value)} placeholder="Enter Buyer Qty(Kgs/month)" />
            </Field>
            <Field id="bs-reed" label="Reed * Pick">
              <input id="bs-reed" value={form.reed_pick} onChange={(e) => set('reed_pick', e.target.value)} placeholder="Enter Reed * Pick" />
            </Field>
            <Field id="bs-width" label="Width">
              <input id="bs-width" value={form.width} onChange={(e) => set('width', e.target.value)} placeholder="Enter Width" />
            </Field>
            <Field id="bs-typetext" label="Type">
              <input id="bs-typetext" value={form.type_text} onChange={(e) => set('type_text', e.target.value)} placeholder="Enter Type" />
            </Field>
          </FormSection>
        ) : (
          <FormSection title="Incase of Buyer / Supplier" description="Shown for a Supplier." count={7}>
            <Field id="bs-mtype" label="Supplier Machine Type">
              <input id="bs-mtype" value={form.machine_type} onChange={(e) => set('machine_type', e.target.value)} placeholder="Enter Supplier Machine Type" />
            </Field>
            <Field id="bs-csup" label="Counts Supplying">
              <input id="bs-csup" inputMode="numeric" value={form.counts_supplying} onChange={(e) => set('counts_supplying', e.target.value)} placeholder="Enter Counts Supplying" />
            </Field>
            <Field id="bs-curmach" label="Current Machines">
              <input id="bs-curmach" value={form.current_machines} onChange={(e) => set('current_machines', e.target.value)} placeholder="Enter Current Machines" />
            </Field>
            <Field id="bs-spindles" label="Supplier No. of Roters & Spindles">
              <input id="bs-spindles" inputMode="numeric" value={form.spindles} onChange={(e) => set('spindles', e.target.value)} placeholder="Enter Supplier No. of Roters & Spindles" />
            </Field>
            <Field id="bs-mprod" label="Monthly Production Quantity">
              <input id="bs-mprod" inputMode="decimal" value={form.monthly_production} onChange={(e) => set('monthly_production', e.target.value)} placeholder="Enter Monthly Production Quantity" />
            </Field>
            <Field id="bs-qkgs" label="Supplier Qty(Kgs/month)">
              <input id="bs-qkgs" inputMode="decimal" value={form.qty_kgs} onChange={(e) => set('qty_kgs', e.target.value)} placeholder="Enter Supplier Qty(Kgs/month)" />
            </Field>
            <Field id="bs-qbags" label="Supplier Qty(Bags/month)">
              <input id="bs-qbags" inputMode="decimal" value={form.qty_bags} onChange={(e) => set('qty_bags', e.target.value)} placeholder="Enter Supplier Qty(Bags/month)" />
            </Field>
          </FormSection>
        )}

        <FormSection title="Remarks" count={2}>
          <Field id="bs-r1" label="Remark 1">
            <textarea id="bs-r1" rows={3} value={form.remark_1} onChange={(e) => set('remark_1', e.target.value)} placeholder="Enter Remark 1" />
          </Field>
          <Field id="bs-r2" label="Remark 2">
            <textarea id="bs-r2" rows={3} value={form.remark_2} onChange={(e) => set('remark_2', e.target.value)} placeholder="Enter Remark 2" />
          </Field>
        </FormSection>

        <FormSection title="Documents" count={1}>
          <FullWidth>
            <PendingDocuments files={files} onChange={setFiles} disabled={busy} />
          </FullWidth>
        </FormSection>
      </fieldset>
      </FieldErrorsProvider>

      <div className="drawer-actions">
        <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || !canSave}>
          {busy ? 'Saving…' : '✓ Create Item'}
        </button>
        <button className="btn ghost" type="button" onClick={clearForm} disabled={busy}>
          Clear Form
        </button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Drawer>
  )
}
