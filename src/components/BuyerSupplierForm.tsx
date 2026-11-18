/** The "Buyer & Supplier Creation Form" of the monday Buyers & Suppliers board.
 *
 *  Same fields, same order, same required marks: Select Action (create or
 *  update), Name, Date, Type, Email, Office Phone, Office Address,
 *  Mill/Factory/Delivery Address, State, GST No., Business Unit, Location MDM,
 *  Default Commission, Category, Messenger, IT Pan, three contact persons
 *  (name, phone, email), Counts, the buyer and supplier commission type and
 *  value, two remarks and up to ten documents.
 *
 *  A monday item is one buyer or one supplier, so Type picks the master the
 *  record is written to. Update lists every existing record and loads it. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIES } from '../api/types'
import type { BuyerMaster, SupplierMaster } from '../api/types'
import { Drawer } from './Drawer'
import { Field } from './PartyForms'
import { PhoneField } from './PhoneField'
import { ActionChoice, FormSection, FullWidth } from './FormKit'
import { PendingDocuments } from './documents/PendingDocuments'
import { DocumentsPanel, useProfileNames } from './PartyExtras'
import { LinkPicker, useCountOptions, useLocationOptions } from './LinkPicker'
import { loadLinkIds, syncLinks } from '../lib/links'
import { errMessage, GST_STATES, isGst, numOrNull } from '../lib/party'
import { joinPhone, phoneProblem, splitPhone } from '../lib/phone'

type Side = 'buyer' | 'supplier'

export const DEFAULT_COMMISSIONS: { value: string; label: string }[] = [
  { value: 'pct', label: 'Percentage of Ex Mill Value' },
  { value: 'per_bag', label: 'Bagwise Rate' },
  { value: 'per_kg', label: 'Rs per kg' },
]

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
const toLocal = (iso: string | null | undefined): string => {
  if (!iso) return nowLocal()
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return nowLocal()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

const blank = (type: Side): FormState => ({
  name: '', record_at: nowLocal(), type, email: '', office_phone: '', address: '', mill_address: '', state: '', gst: '',
  company_id: '', default_commission: 'pct', category: '', messenger_id: '', pan: '',
  c1_name: '', c1_phone: '', c1_email: '', c2_name: '', c2_phone: '', c2_email: '', c3_name: '', c3_phone: '', c3_email: '',
  commission_type: 'pct', commission_value: '', remark_1: '', remark_2: '',
  fabric_producing: '', no_of_looms: '', reed_pick: '', width: '', machine_type: '', counts_supplying: '',
  spindles: '', monthly_production: '', qty_bags: '', qty_kgs: '',
})

/** A stored 10-digit mobile shown with its country code. */
const withCode = (v: string | null | undefined): string => (v ? joinPhone({ code: '+91', number: v }) : '')

function fromRow(side: Side, r: BuyerMaster | SupplierMaster): FormState {
  return {
    name: r.name,
    record_at: toLocal(r.record_at ?? r.created_at),
    type: side,
    email: r.email ?? '',
    office_phone: r.office_phone ? joinPhone({ code: '+91', number: r.office_phone }) : '',
    address: r.address ?? '',
    mill_address: r.mill_address ?? '',
    state: r.state ?? '',
    gst: r.gst ?? '',
    company_id: r.company_id ?? '',
    default_commission: r.default_commission ?? '',
    category: r.category ?? '',
    messenger_id: r.messenger_id ?? '',
    pan: r.pan ?? '',
    c1_name: r.contact_person ?? '',
    c1_phone: withCode(r.mobile),
    c1_email: r.contact_1_email ?? '',
    c2_name: r.contact_2_name ?? '',
    c2_phone: withCode(r.contact_2_mobile),
    c2_email: r.contact_2_email ?? '',
    c3_name: r.contact_3_name ?? '',
    c3_phone: withCode(r.contact_3_mobile),
    c3_email: r.contact_3_email ?? '',
    commission_type: r.commission_basis ?? 'pct',
    commission_value: r.commission_value === null ? '' : String(r.commission_value),
    remark_1: r.notes ?? '',
    remark_2: r.remarks_2 ?? '',
    fabric_producing: 'fabric_producing' in r ? r.fabric_producing ?? '' : '',
    no_of_looms: 'no_of_looms' in r && r.no_of_looms !== null ? String(r.no_of_looms) : '',
    reed_pick: 'reed_pick' in r ? r.reed_pick ?? '' : '',
    width: 'width' in r ? r.width ?? '' : '',
    machine_type: 'machine_type' in r ? r.machine_type ?? '' : '',
    counts_supplying: 'counts_supplying' in r && r.counts_supplying !== null ? String(r.counts_supplying) : '',
    spindles: 'spindles' in r && r.spindles !== null ? String(r.spindles) : '',
    monthly_production: 'monthly_production' in r && r.monthly_production !== null ? String(r.monthly_production) : '',
    qty_bags: r.qty_bags_month === null || r.qty_bags_month === undefined ? '' : String(r.qty_bags_month),
    qty_kgs: r.qty_kgs_month === null || r.qty_kgs_month === undefined ? '' : String(r.qty_kgs_month),
  }
}

const orNull = (v: string) => v.trim() || null
const isEmail = (v: string) => v.trim().indexOf('@') > 0

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

export function problemsOf(f: FormState, countIds: string[]): string[] {
  const out: string[] = []
  if (!f.name.trim()) out.push('Name')
  if (!f.office_phone.trim() || splitPhone(f.office_phone).number === '' || phoneProblem(f.office_phone)) out.push('Office Phone')
  if (!f.address.trim()) out.push('Office Address')
  if (!isGst(f.gst)) out.push('GST No. (15 characters, e.g. 33AHFPK5121I1Z5)')
  if (!f.company_id) out.push('Business Unit')
  if (!f.default_commission) out.push('Default Commision Percentage')
  if (countIds.length === 0) out.push('Counts')
  if (f.pan.trim() && f.pan.trim().length !== 10) out.push('IT Pan (10 characters, or leave blank)')
  if (f.email.trim() && !isEmail(f.email)) out.push('Email (needs an @, or leave blank)')
  for (const [label, phone, email] of [
    ['Contact Person 1', f.c1_phone, f.c1_email],
    ['Contact Person 2', f.c2_phone, f.c2_email],
    ['Contact Person 3', f.c3_phone, f.c3_email],
  ] as const) {
    if (mobileProblem(phone)) out.push(`${label} Phone (10 digits, or leave blank)`)
    if (email.trim() && !isEmail(email)) out.push(`${label} Email (needs an @, or leave blank)`)
  }
  if (f.commission_value.trim() && numOrNull(f.commission_value) === null) out.push('Commission Value (a number)')
  for (const [label, v] of [
    ['No. of Looms', f.no_of_looms], ['Counts Supplying', f.counts_supplying], ['Supplier No. of Roters & Spindles', f.spindles],
    ['Monthly Production Quantity', f.monthly_production], ['Qty(Bags/month)', f.qty_bags], ['Qty(Kgs/month)', f.qty_kgs],
  ] as const) {
    if (v.trim() && numOrNull(v) === null) out.push(`${label} (a number, or leave blank)`)
  }
  return out
}

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
        }
      : {
          machine_type: orNull(f.machine_type),
          counts_supplying: numOrNull(f.counts_supplying),
          spindles: numOrNull(f.spindles),
          monthly_production: numOrNull(f.monthly_production),
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
  const [action, setAction] = useState<'create' | 'update'>('create')
  const [target, setTarget] = useState('') // "buyer:<id>" | "supplier:<id>"
  const [form, setForm] = useState<FormState>(() => blank(firstSide))
  const [locationIds, setLocationIds] = useState<string[]>([])
  const [countIds, setCountIds] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linksReady, setLinksReady] = useState(true)

  const people = useProfileNames()
  const locationOptions = useLocationOptions()
  const countOptions = useCountOptions()

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }))
  const allowed = (s: Side) => (s === 'buyer' ? canBuyer : canSupplier)

  const records = useMemo(
    () =>
      [
        ...buyers.map((b) => ({ key: `buyer:${b.id}`, side: 'buyer' as Side, row: b as BuyerMaster | SupplierMaster })),
        ...suppliers.map((s) => ({ key: `supplier:${s.id}`, side: 'supplier' as Side, row: s as BuyerMaster | SupplierMaster })),
      ]
        .filter((r) => allowed(r.side))
        .sort((a, z) => a.row.name.localeCompare(z.row.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buyers, suppliers, canBuyer, canSupplier],
  )

  const [side, id] = target.split(':') as [Side | undefined, string | undefined]
  const current = action === 'update' && side && id ? records.find((r) => r.key === target) ?? null : null

  // Choosing a record to update loads it, with its linked locations and counts.
  useEffect(() => {
    if (action !== 'update') return undefined
    if (!current) {
      setForm(blank(firstSide))
      setLocationIds([])
      setCountIds([])
      return undefined
    }
    setForm(fromRow(current.side, current.row))
    setLinksReady(false)
    let live = true
    Promise.all([loadLinkIds('location', current.side, current.row.id), loadLinkIds('count', current.side, current.row.id)])
      .then(([l, c]) => {
        if (!live) return
        setLocationIds(l)
        setCountIds(c)
        setLinksReady(true)
      })
      .catch((caught) => {
        if (live) setError(`Locations and counts could not be loaded (${errMessage(caught)}). Saving is turned off until they can be.`)
      })
    return () => {
      live = false
    }
  }, [action, current, firstSide])

  function chooseAction(next: 'create' | 'update') {
    setAction(next)
    setError(null)
    setTarget('')
    setFiles([])
    setForm(blank(firstSide))
    setLocationIds([])
    setCountIds([])
    setLinksReady(true)
  }

  function clearForm() {
    setError(null)
    setFiles([])
    if (action === 'update') setTarget('')
    else {
      setForm(blank(form.type))
      setLocationIds([])
      setCountIds([])
    }
  }

  const problems = problemsOf(form, countIds)
  const updatingNothing = action === 'update' && !current
  const canSave = problems.length === 0 && !updatingNothing && linksReady && allowed(form.type)

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
    setBusy(true)
    setError(null)
    const table = form.type === 'buyer' ? 'buyer_master' : 'supplier_master'
    const payload: Record<string, unknown> = payloadOf(form)
    let ownerId: string
    if (action === 'create') {
      const { data, error: e } = await supabase.from(table).insert(payload).select('id').single()
      if (e) {
        setBusy(false)
        setError(errMessage(e, 'Could not save this record'))
        return
      }
      ownerId = (data as { id: string }).id
    } else {
      if (!current) return
      // the type of an existing record cannot change here: it lives in the master it was created in
      const { data, error: e } = await supabase.from(table).update(payload).eq('id', current.row.id).select('id')
      if (e || !data || data.length === 0) {
        setBusy(false)
        setError(e ? errMessage(e, 'Could not save this record') : 'Your account cannot change this record.')
        return
      }
      ownerId = current.row.id
    }

    const problemsAfter: string[] = []
    for (const [kind, ids] of [['location', locationIds], ['count', countIds]] as const) {
      try {
        await syncLinks(kind, form.type, ownerId, ids)
      } catch (caught) {
        problemsAfter.push(`${kind === 'location' ? 'locations' : 'counts'}: ${errMessage(caught)}`)
      }
    }
    if (files.length > 0) {
      const failed = await uploadFiles(form.type, ownerId)
      if (failed.length > 0) problemsAfter.push(`documents not uploaded: ${failed.join(', ')}`)
    }
    setBusy(false)
    const saved = `${form.name.trim()} ${action === 'create' ? 'added' : 'updated'}.`
    if (problemsAfter.length > 0) {
      await onDone(`${saved} The record is saved, but ${problemsAfter.join('; ')}. Open it with Update Existing Record to retry.`, 'bad')
      return
    }
    await onDone(saved)
  }

  const typeLocked = action === 'update' && current !== null

  return (
    <Drawer title="Buyers & Suppliers creation form" onClose={onClose}>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      <ActionChoice
        label="Select Action"
        value={action}
        onChange={chooseAction}
        options={[
          { value: 'create', label: 'Create New Record', hint: 'Add a new buyer or supplier.' },
          { value: 'update', label: 'Update Existing Record', hint: 'Pick a record and change its details.' },
        ]}
      />
      {action === 'update' && (
        <FormSection title="Record to update">
          <FullWidth>
            <Field id="bs-target" label="Record" required hint="Its details are loaded below for you to change.">
              <select id="bs-target" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">— Select a record —</option>
                {records.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.row.name} ({r.side === 'buyer' ? 'Buyer' : 'Supplier'})
                  </option>
                ))}
              </select>
            </Field>
          </FullWidth>
        </FormSection>
      )}

      <fieldset disabled={updatingNothing} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <FormSection title="Buyer & Supplier Details" count={14}>
          <Field id="bs-name" label="Name" required>
            <input id="bs-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Enter Name" autoFocus />
          </Field>
          <Field id="bs-date" label="Date">
            <input id="bs-date" type="datetime-local" value={form.record_at} onChange={(e) => set('record_at', e.target.value)} />
          </Field>
          <Field id="bs-type" label="Type" required hint={typeLocked ? 'A record stays a buyer or a supplier once created.' : undefined}>
            <select id="bs-type" value={form.type} onChange={(e) => set('type', e.target.value as Side)} disabled={typeLocked}>
              <option value="buyer" disabled={!canBuyer}>
                Buyer
              </option>
              <option value="supplier" disabled={!canSupplier}>
                Supplier
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
          <LinkPicker
            id="bs-locs"
            label="Location MDM"
            options={locationOptions}
            value={locationIds}
            onChange={setLocationIds}
            disabled={!linksReady}
            placeholder="-- Select Location MDM --"
          />
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
          <Field id="bs-cat" label="Category">
            <select id="bs-cat" value={form.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">-- Select Category --</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field id="bs-msg" label="Messenger">
            <select id="bs-msg" value={form.messenger_id} onChange={(e) => set('messenger_id', e.target.value)}>
              <option value="">-- Select Messenger --</option>
              {form.messenger_id && !people[form.messenger_id] && <option value={form.messenger_id}>Unknown user</option>}
              {Object.entries(people).map(([pid, name]) => (
                <option key={pid} value={pid}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>

        <FormSection title="Account Details" count={1}>
          <Field id="bs-pan" label="IT Pan" hint="10 characters, upper case.">
            <input id="bs-pan" className="mono" maxLength={10} value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} placeholder="Enter IT Pan" />
          </Field>
        </FormSection>

        {([
          [1, 'MD Information'],
          [2, 'Account Information'],
          [3, 'Dispatch Information'],
        ] as const).map(([n, title]) => {
          const k = `c${n}` as 'c1' | 'c2' | 'c3'
          return (
            <FormSection key={n} title={title} count={3}>
              <Field id={`bs-${k}n`} label={`Contact Person ${n}`}>
                <input id={`bs-${k}n`} value={form[`${k}_name`]} onChange={(e) => set(`${k}_name`, e.target.value)} placeholder={`Enter Contact Person ${n}`} />
              </Field>
              <PhoneField id={`bs-${k}p`} label={`Contact Person ${n} Phone`} value={form[`${k}_phone`]} onChange={(v) => set(`${k}_phone`, v)} />
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
            disabled={!linksReady}
            placeholder="-- Select Counts --"
          />
          <Field id="bs-ctype" label={`${form.type === 'buyer' ? 'Buyer' : 'Supplier'} Commission Type`}>
            <select id="bs-ctype" value={form.commission_type} onChange={(e) => set('commission_type', e.target.value)}>
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
          <FormSection title="Incase of Buyer / Supplier" description="Shown for a Buyer." count={6}>
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
          </FormSection>
        ) : (
          <FormSection title="Incase of Buyer / Supplier" description="Shown for a Supplier." count={6}>
            <Field id="bs-mtype" label="Supplier Machine Type">
              <input id="bs-mtype" value={form.machine_type} onChange={(e) => set('machine_type', e.target.value)} placeholder="Enter Supplier Machine Type" />
            </Field>
            <Field id="bs-csup" label="Counts Supplying">
              <input id="bs-csup" inputMode="numeric" value={form.counts_supplying} onChange={(e) => set('counts_supplying', e.target.value)} placeholder="Enter Counts Supplying" />
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
            {action === 'update' && current ? (
              <DocumentsPanel partyType={current.side} partyId={current.row.id} canEdit />
            ) : (
              <PendingDocuments files={files} onChange={setFiles} disabled={busy} />
            )}
          </FullWidth>
        </FormSection>
      </fieldset>

      {problems.length > 0 && !updatingNothing && <p className="field-hint">Still needed: {problems.join(', ')}.</p>}
      <div className="drawer-actions">
        <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || !canSave}>
          {busy ? 'Saving…' : action === 'create' ? '✓ Create Item' : '✓ Update Item'}
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
