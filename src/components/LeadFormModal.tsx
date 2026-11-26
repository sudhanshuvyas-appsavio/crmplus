/** Lead pop-up, arranged like monday's Lead Creation Form.
 *
 *  Create New Record ("+ New lead"): the group cards in monday's order, each with its fields in
 *  monday's order (Leads Information: Name, Status, Created Date, Follow Up Date, Lead Source,
 *  Timeline, Phone, Type; Product Details; Entry Filter Questions), then the two groups the lead's
 *  document adds (Party Details, Notes).
 *  Update Existing Record (row Actions > Edit): monday's "Select Item to Update" card on top,
 *  naming the lead, then the same cards filled in.
 *
 *  Behaviour follows the Pharma ERP forms: a pop-up with a pinned header and footer, a red * on
 *  required fields, system-owned values read-only ("Assigned on save"), nothing pre-chosen for
 *  required dropdowns ("--None--"), and an error under each wrong field (shown when the button is
 *  pressed; formats are also checked while typing). */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LEAD_SOURCES, LEAD_UOMS } from '../api/types'
import type { CountRow, Lead, Station } from '../api/types'
import { uomLabel } from '../lib/deals'
import { errMessage, isGst, numOrNull } from '../lib/party'
import { joinPhone, splitPhone } from '../lib/phone'
import { formatDateTime } from '../lib/format'
import { leadPayload, leadToForm, phoneOk, type LeadForm } from '../lib/leadForm'
import { Link } from 'react-router-dom'
import { Modal } from './Modal'
import { Field, FieldErrorsProvider } from './PartyForms'
import { ErrorBanner, FormSection, FullWidth } from './FormKit'
import { PhoneField } from './PhoneField'
import { ComboInput } from './ComboInput'
import { StationPicker } from './StationPicker'
import { LeadDocuments } from './LeadDocuments'
import { DiscussionPanel } from './LeadDiscussion'
import { ActivityPanel } from './PartyExtras'
import { StatusPill } from './board/Board'
import { LEAD_STATUSES } from '../api/types'

const STATUS_TONE: Record<string, 'blue' | 'orange' | 'green' | 'red'> = { new: 'blue', contacted: 'orange', qualified: 'green', lost: 'red' }

/** View mode: every field of the form, locked. Edit mode: the fields render as they are. */
function Lock({ on, children }: { on: boolean; children: React.ReactNode }) {
  return on ? <fieldset className="ro-fieldset" disabled>{children}</fieldset> : <>{children}</>
}

type MasterParty = { id: string; name: string; contact_person: string | null; mobile: string | null; gst: string | null; address: string | null; is_active: boolean }
type FormStatus = '' | 'new' | 'contacted' | 'qualified' | 'lost'

const STATUS_CHOICES: { value: Exclude<FormStatus, '' | 'qualified'>; label: string }[] = [
  { value: 'new', label: 'New Lead' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'lost', label: 'Disqualified' },
]

/** Errors that are worth showing while the person types, not only after the button is pressed. */
const LIVE = new Set(['l-mobile', 'l-gst', 'l-qty', 'l-tto'])

function blankForm(staffId: string | null): LeadForm {
  return {
    lead_type: 'new', lead_source: '', party_role: 'buyer', party_name: '', contact_person: '', mobile_cc: '+91', mobile: '', station: '',
    office_address: '', gst: '', buyer_id: '', supplier_id: '', count_id: '', quantity: '', uom: '', expected_rate: '',
    timeline: '', timeline_from: '', timeline_to: '', remarks: '', notes: '', sales_staff_id: staffId ?? '', follow_up_at: '',
    entry_weaves_yarn: '', entry_payment_cycle: '', entry_current_supplier: '', entry_price_range: '', entry_next_purchase: '',
  }
}

function errorsOf(f: LeadForm, status: FormStatus): Record<string, string> {
  const e: Record<string, string> = {}
  if (!status) e['l-status'] = 'Choose a status.'
  if (!f.party_name.trim()) e['l-name'] = f.lead_type === 'existing' ? 'Pick the party in Party Details; its name is filled in from there.' : 'Enter the lead name.'
  if (f.lead_type === 'existing' && !f.buyer_id) e['l-buyer'] = 'Pick the buyer from Buyers & Suppliers.'
  if (f.mobile.trim() && !phoneOk(f.mobile_cc, f.mobile)) e['l-mobile'] = f.mobile_cc === '+91' ? 'An Indian mobile number has exactly 10 digits.' : 'A phone number has 6 to 14 digits.'
  if (f.gst.trim() && !isGst(f.gst)) e['l-gst'] = 'Not a valid 15-character GST number yet.'
  if (f.quantity.trim()) {
    const q = numOrNull(f.quantity)
    if (q === null || q <= 0) e['l-qty'] = 'Quantity must be more than zero.'
    else if (!f.uom) e['l-uom'] = 'Choose the unit for this quantity.'
  }
  if (f.expected_rate.trim() && (numOrNull(f.expected_rate) ?? -1) < 0) e['l-rate'] = 'Rate must be a number, zero or more.'
  if (f.timeline_from && f.timeline_to && f.timeline_to < f.timeline_from) e['l-tto'] = 'The end date cannot be before the start date.'
  return e
}

export function LeadFormModal({
  counts, stations, ensureStation, defaultStaffId, leads, lockedIds, initialLead, readOnly = false, onEdit, onRefresh, onClose, onDone,
}: {
  counts: CountRow[]
  stations: Station[]
  ensureStation: (name: string) => Promise<string>
  /** The signed-in user: a new lead is owned by them. An updated lead keeps its owner. */
  defaultStaffId: string | null
  /** Every lead, for the Select Item to Update search. */
  leads: Lead[]
  /** Leads that can no longer be changed (already converted to a deal): not offered for update. */
  lockedIds: Set<string>
  /** Opened from a row's Actions > Edit: the lead to start with. Absent for a new lead. */
  initialLead?: Lead | null
  /** View details: the same form, locked. */
  readOnly?: boolean
  /** View details: the Edit button. */
  onEdit?: (lead: Lead) => void
  /** Reload the board after a discussion is logged. */
  onRefresh?: () => Promise<void>
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
}) {
  const updating = Boolean(initialLead)
  const [recordId, setRecordId] = useState(initialLead?.id ?? '')
  const [recordText, setRecordText] = useState(initialLead ? `${initialLead.lead_no} · ${initialLead.party_name}` : '')
  const [form, setForm] = useState<LeadForm>(() => (initialLead ? leadToForm(initialLead) : blankForm(defaultStaffId)))
  const [status, setStatus] = useState<FormStatus>(initialLead ? initialLead.status : '')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [dealNo, setDealNo] = useState<string | null>(null)
  const [masters, setMasters] = useState<{ buyers: MasterParty[]; suppliers: MasterParty[] }>({ buyers: [], suppliers: [] })

  useEffect(() => {
    const cols = 'id,name,contact_person,mobile,gst,address,is_active'
    void Promise.all([supabase.from('buyer_master').select(cols).order('name'), supabase.from('supplier_master').select(cols).order('name')])
      .then(([b, s]) => setMasters({ buyers: (b.data ?? []) as MasterParty[], suppliers: (s.data ?? []) as MasterParty[] }))
  }, [])

  const dealId = initialLead?.converted_deal_id ?? null
  useEffect(() => {
    if (!dealId) return
    void supabase.from('crm_deals').select('deal_no').eq('id', dealId).maybeSingle()
      .then(({ data }) => setDealNo((data as { deal_no: string } | null)?.deal_no ?? null))
  }, [dealId])

  const set = <K extends keyof LeadForm>(key: K, value: LeadForm[K]) => setForm((p) => ({ ...p, [key]: value }))

  /** Existing lead: picking the party copies its details from the master (no retyping). */
  function pickMaster(side: 'buyer' | 'supplier', id: string) {
    const p = (side === 'buyer' ? masters.buyers : masters.suppliers).find((x) => x.id === id)
    setForm((prev) => ({
      ...prev,
      [`${side}_id`]: id,
      ...(p ? {
        party_name: p.name,
        contact_person: p.contact_person ?? prev.contact_person,
        mobile_cc: p.mobile ? '+91' : prev.mobile_cc,
        mobile: p.mobile ?? prev.mobile,
        gst: p.gst ?? prev.gst,
        office_address: p.address ?? prev.office_address,
      } : {}),
    }))
  }

  const editable = useMemo(() => leads.filter((l) => !lockedIds.has(l.id)), [leads, lockedIds])
  const current = leads.find((l) => l.id === recordId) ?? initialLead ?? null

  function chooseRecord(text: string) {
    setRecordText(text)
    const hit = editable.find((l) => `${l.lead_no} · ${l.party_name}` === text)
    if (!hit) { setRecordId(''); return }
    setRecordId(hit.id)
    setForm(leadToForm(hit))
    setStatus(hit.status)
    setSubmitted(false)
    setError(null)
  }

  const errors = useMemo(() => ({ ...errorsOf(form, status), ...(updating && !recordId ? { 'l-record': 'Choose the lead to update.' } : {}) }), [form, status, updating, recordId])
  const visible = useMemo(() => Object.fromEntries(Object.entries(errors).filter(([id]) => submitted || LIVE.has(id))), [errors, submitted])
  const existing = form.lead_type === 'existing'
  const weaves = form.entry_weaves_yarn === 'yes'

  function clearForm() {
    setForm(blankForm(defaultStaffId))
    setStatus('')
    setSubmitted(false)
    setError(null)
  }

  async function save() {
    setSubmitted(true)
    setError(null)
    const ids = Object.keys(errors)
    if (ids.length > 0) {
      setError(`${ids.length === 1 ? 'One field needs' : `${ids.length} fields need`} attention. Check the fields marked in red.`)
      window.setTimeout(() => document.getElementById(ids[0]!)?.focus(), 0)
      return
    }
    setBusy(true)
    let stationName = ''
    try {
      stationName = await ensureStation(form.station)
    } catch (caught) {
      setBusy(false)
      setError(errMessage(caught, 'Could not add the station'))
      return
    }
    // a lead is always a buyer
    const payload = { ...leadPayload(form), party_role: 'buyer', supplier_id: null, station: stationName || null, status }
    const { error: saveError } = updating
      ? await supabase.from('leads').update(payload).eq('id', recordId)
      : await supabase.from('leads').insert(payload)
    setBusy(false)
    if (saveError) {
      setError(errMessage(saveError, updating ? 'Could not update this lead' : 'Could not save this lead'))
      return
    }
    await onDone(updating ? `${current?.lead_no ?? 'Lead'} updated.` : `Lead "${form.party_name.trim()}" created.`)
  }

  const locked = Boolean(initialLead && lockedIds.has(initialLead.id))
  const canWrite = !readOnly && !locked
  const lockedReason = 'This lead has been converted to a deal, so it is read-only.'

  return (
    <Modal
      title={readOnly ? 'View Lead' : updating ? 'Update Lead' : 'New Lead'}
      description={readOnly ? undefined : updating ? 'Choose the lead, then change what you need. It keeps its number and creation date.' : 'Required fields are marked.'}
      size="lg"
      onClose={onClose}
      footer={readOnly ? (
        <>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
          <button className="btn primary" type="button" disabled={locked} title={locked ? lockedReason : undefined} onClick={() => initialLead && onEdit?.(initialLead)}>Edit</button>
        </>
      ) : (
        <>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
          <span style={{ display: 'flex', gap: 10 }}>
            {!updating && <button className="btn ghost" type="button" onClick={clearForm} disabled={busy}>Clear Form</button>}
            <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : updating ? 'Update Lead' : 'Create Lead'}</button>
          </span>
        </>
      )}
    >
      <ErrorBanner message={error} />

      {readOnly && initialLead && (
        <p className="small" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 10px' }}>
          <StatusPill label={LEAD_STATUSES.find((x) => x.value === initialLead.status)?.label ?? initialLead.status} tone={STATUS_TONE[initialLead.status] ?? 'grey'} />
          <span className="muted">Created {formatDateTime(initialLead.created_at)}</span>
          {initialLead.status === 'qualified' && initialLead.qualified_at && <span className="muted">Qualified {formatDateTime(initialLead.qualified_at)}</span>}
          {initialLead.converted_deal_id && <span>Converted to <Link to={`/deals?open=${initialLead.converted_deal_id}`}>{dealNo ?? 'a deal'}</Link></span>}
        </p>
      )}

      {updating && !readOnly && (
        <FieldErrorsProvider value={visible}>
          <section className="fs-card" aria-label="Select Item to Update">
            <header className="fs-head"><div><h3>Select Item to Update:</h3></div></header>
            <div className="fs-body">
              <Field id="l-record" label="Search for a record">
                <ComboInput id="l-record" placeholder="-- Search for a record --" value={recordText} onChange={chooseRecord} options={editable.map((l) => `${l.lead_no} · ${l.party_name}`)} style={{ maxWidth: 520 }} />
              </Field>
            </div>
          </section>
        </FieldErrorsProvider>
      )}

      {(!updating || recordId) && (
      <FieldErrorsProvider value={visible}>
        <Lock on={readOnly}>
        <FormSection title="Leads Information" collapsible columns={3}>
          <Field id="l-name" label="Name" required>
            <input id="l-name" autoFocus={!existing && !updating} value={form.party_name} readOnly={existing} placeholder={existing ? 'Filled in from the party you pick' : 'Enter Name'} onChange={(e) => set('party_name', e.target.value)} />
          </Field>
          <Field id="l-status" label="Status" required>
            <select id="l-status" value={status} title={current?.status === 'qualified' ? 'Moving a Qualified lead to another status clears its qualification.' : 'A lead becomes Qualified from its Qualify action, once its count and party are in place.'} onChange={(e) => setStatus(e.target.value as FormStatus)}>
              <option value="">--None--</option>
              {STATUS_CHOICES.slice(0, 2).map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
              {current?.status === 'qualified' && <option value="qualified">Qualified</option>}
              {STATUS_CHOICES.slice(2).map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
            </select>
          </Field>
          <Field id="l-created" label="Created Date">
            <input id="l-created" readOnly value={current ? formatDateTime(current.created_at) : ''} placeholder="Assigned on save" />
          </Field>
          <Field id="l-follow" label="Follow Up Date">
            <input id="l-follow" type="datetime-local" value={form.follow_up_at} onChange={(e) => set('follow_up_at', e.target.value)} />
          </Field>
          <Field id="l-source" label="Lead Source">
            <ComboInput id="l-source" placeholder="Enter Lead Source" value={form.lead_source} onChange={(t) => set('lead_source', t)} options={[...LEAD_SOURCES]} />
          </Field>
          <Field id="l-tfrom" label="Timeline">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input id="l-tfrom" aria-label="Timeline from" type="date" style={{ minWidth: 0, flex: 1 }} value={form.timeline_from} onChange={(e) => set('timeline_from', e.target.value)} />
              <span aria-hidden="true">→</span>
              <input id="l-tto" aria-label="Timeline to" type="date" style={{ minWidth: 0, flex: 1 }} min={form.timeline_from || undefined} value={form.timeline_to} onChange={(e) => set('timeline_to', e.target.value)} />
            </div>
          </Field>
          <PhoneField
            id="l-mobile"
            label="Phone"
            value={joinPhone({ code: form.mobile_cc, number: form.mobile })}
            onChange={(v) => { const p = splitPhone(v); setForm((prev) => ({ ...prev, mobile_cc: p.code, mobile: p.number })) }}
          />
          <Field id="l-type" label="Type">
            <select id="l-type" value={form.lead_type} title={existing ? 'Pick the party from Buyers & Suppliers in Leads Information.' : 'A party not yet in Buyers & Suppliers.'} onChange={(e) => set('lead_type', e.target.value as LeadForm['lead_type'])}>
              <option value="new">New</option>
              <option value="existing">Existing</option>
            </select>
          </Field>
          {existing && (
            <Field id="l-buyer" label="Buyer" required>
              <select id="l-buyer" value={form.buyer_id} onChange={(e) => pickMaster('buyer', e.target.value)}>
                <option value="">--None--</option>
                {masters.buyers.filter((x) => x.is_active || x.id === form.buyer_id).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
              </select>
            </Field>
          )}
        </FormSection>

        <FormSection title="Product Details" collapsible columns={3}>
          <div className="fs-span-2">
            <Field id="l-count" label="Counts">
              <select id="l-count" value={form.count_id} onChange={(e) => set('count_id', e.target.value)}>
                <option value="">--None--</option>
                {counts.filter((c) => c.is_active || c.id === form.count_id).map((c) => (<option key={c.id} value={c.id}>{c.display_name}</option>))}
              </select>
            </Field>
          </div>
          <Field id="l-uom" label="UOM">
            <select id="l-uom" value={form.uom} onChange={(e) => set('uom', e.target.value)}>
              <option value="">--None--</option>
              {LEAD_UOMS.map((u) => (<option key={u} value={u}>{uomLabel(u)}</option>))}
            </select>
          </Field>
          <Field id="l-qty" label="Quantity">
            <input id="l-qty" inputMode="decimal" className="mono" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </Field>
          <Field id="l-rate" label="Buyer Rate">
            <input id="l-rate" inputMode="decimal" className="mono" value={form.expected_rate} onChange={(e) => set('expected_rate', e.target.value)} />
          </Field>
        </FormSection>

        <FormSection title="Entry Filter Questions" collapsible columns={3}>
          <Field id="l-weaves" label="Do you buy weaving yarn?">
            <select id="l-weaves" value={form.entry_weaves_yarn} onChange={(e) => set('entry_weaves_yarn', e.target.value as LeadForm['entry_weaves_yarn'])}>
              <option value="">--None--</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          {weaves && (
            <>
              <Field id="l-cycle" label="What is your payment cycle?">
                <select id="l-cycle" value={form.entry_payment_cycle} onChange={(e) => set('entry_payment_cycle', e.target.value)}>
                  <option value="">--None--</option>
                  <option value="7_days">7 days</option>
                  <option value="30_days">30 days</option>
                  <option value="60_days">60 days</option>
                  <option value="advance">Advance</option>
                </select>
              </Field>
              <Field id="l-cursup" label="From whom are you currently buying?">
                <input id="l-cursup" value={form.entry_current_supplier} onChange={(e) => set('entry_current_supplier', e.target.value)} />
              </Field>
              <Field id="l-range" label="What is your current purchase price range?">
                <input id="l-range" value={form.entry_price_range} onChange={(e) => set('entry_price_range', e.target.value)} />
              </Field>
              <Field id="l-next" label="When is your next purchase planned?">
                <input id="l-next" type="date" value={form.entry_next_purchase} onChange={(e) => set('entry_next_purchase', e.target.value)} />
              </Field>
            </>
          )}
        </FormSection>

        <FormSection title="Party Details" collapsible columns={3}>
          <Field id="l-role" label="Party role">
            <input id="l-role" readOnly value="Buyer" title="A lead is always a buyer." />
          </Field>
          <Field id="l-contact" label="Contact person">
            <input id="l-contact" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
          </Field>
          <Field id="l-station" label="Station">
            <StationPicker value={form.station} stations={stations} onChange={(v) => set('station', v)} />
          </Field>
          <Field id="l-gst" label="GST">
            <input id="l-gst" className="mono" maxLength={15} value={form.gst} onChange={(e) => set('gst', e.target.value.toUpperCase().replace(/\s+/g, ''))} />
          </Field>
          <FullWidth>
            <Field id="l-address" label="Office address">
              <textarea id="l-address" rows={2} value={form.office_address} onChange={(e) => set('office_address', e.target.value)} />
            </Field>
          </FullWidth>
        </FormSection>

        <FormSection title="Remarks" collapsible columns={3}>
          <FullWidth>
          <Field id="l-remarks" label="Remarks">
            <textarea id="l-remarks" rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </Field>
          </FullWidth>
          <FullWidth>
          <Field id="l-notes" label="Notes">
            <textarea id="l-notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          </FullWidth>
        </FormSection>
        </Lock>

        {updating && initialLead && (
          <>
            <FormSection title="Documents" collapsible columns={3}>
              <FullWidth><LeadDocuments leadId={initialLead.id} canEdit={canWrite} /></FullWidth>
            </FormSection>
            {canWrite && (
              <FormSection title="Log a discussion" collapsible columns={3}>
                <FullWidth>
                  <DiscussionPanel lead={initialLead} onLogged={async () => { setHistoryKey((k) => k + 1); await onRefresh?.() }} />
                </FullWidth>
              </FormSection>
            )}
            <ActivityPanel entityType="lead" entityId={initialLead.id} canWrite={canWrite} showEntryForm={false} title="Discussion history and follow-ups" refreshKey={historyKey} />
          </>
        )}
      </FieldErrorsProvider>
      )}
    </Modal>
  )
}
