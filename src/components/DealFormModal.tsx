/** Deal pop-up, arranged like monday's Deal Creation Form and built like the Lead pop-up
 *  (Pharma ERP form conventions): titled group cards, three fields per row, system values
 *  read-only ("Assigned on save"), `--None--` for dropdowns, an error under each wrong field.
 *
 *  Create ("+ New deal"): the cards only. Update (row Actions > Edit): monday's "Select Item
 *  to Update" card on top, then the same cards filled in. The owner is the signed-in user and
 *  is not a field; the status is changed from the row's Actions menu, not here. A deal that is
 *  Approved is locked (the database refuses changes), so it is not offered for update. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CountRow, Deal, PaymentTerm } from '../api/types'
import { COMM_BASES, dealStatus } from '../lib/deals'
import { errMessage, numOrNull } from '../lib/party'
import { Modal } from './Modal'
import { Field, FieldErrorsProvider } from './PartyForms'
import { ErrorBanner, FormSection, FullWidth } from './FormKit'
import { CountLinesEditor, emptyLine, linesPayload, lineProblems, toLineForm, type LineForm } from './CountLines'
import type { MirrorParty } from './board/mirrors'
import { PartyLookup } from './PartyLookup'
import { ComboInput } from './ComboInput'
import { getPosition } from './GeoCapture'
import { Link } from 'react-router-dom'
import { StatusPill } from './board/Board'
import { DealDocuments } from './DealDocuments'
import { DealHistory } from './DealHistory'
import { useProfileNames } from './PartyExtras'
import { formatDateTime } from '../lib/format'

export type DealCompany = { id: string; name: string; is_home: boolean; is_active: boolean }
export type DealPerson = { id: string; name: string }

type Form = {
  buyer_id: string
  supplier_id: string
  company_id: string
  payment_term_id: string
  price_basis: 'ex_mill' | 'net'
  freight: 'included' | 'excluded'
  buyer_comm_basis: string
  buyer_comm_value: string
  supplier_comm_basis: string
  supplier_comm_value: string
  manager_id: string
  notes: string
  location_text: string
  location_lat: number | null
  location_lng: number | null
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))
export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`

function toForm(d: Deal | null, companies: DealCompany[]): Form {
  const home = companies.find((c) => c.is_home && c.is_active)
  return {
    buyer_id: d?.buyer_id ?? '',
    supplier_id: d?.supplier_id ?? '',
    company_id: d?.company_id ?? home?.id ?? '',
    payment_term_id: d?.payment_term_id ?? '',
    price_basis: d?.price_basis ?? 'ex_mill',
    freight: d?.freight ?? 'excluded',
    buyer_comm_basis: d?.buyer_comm_basis ?? '',
    buyer_comm_value: str(d?.buyer_comm_value),
    supplier_comm_basis: d?.supplier_comm_basis ?? '',
    supplier_comm_value: str(d?.supplier_comm_value),
    manager_id: d?.manager_id ?? '',
    notes: d?.notes ?? '',
    location_text: d?.location_text ?? '',
    location_lat: d?.location_lat ?? null,
    location_lng: d?.location_lng ?? null,
  }
}

/** The count rows of a deal; if there are none yet, the deal's own (first) count stands in. */
async function loadLines(d: Deal): Promise<LineForm[]> {
  const { data } = await supabase.from('crm_deal_lines').select('count_id,quantity,uom,bag_weight,final_rate').eq('deal_id', d.id).order('line_no')
  const rows = (data ?? []) as { count_id: string; quantity: number; uom: string; bag_weight: number | null; final_rate: number | null }[]
  if (rows.length > 0) return rows.map((r) => toLineForm({ ...r, rate: r.final_rate }))
  return [toLineForm({ count_id: d.count_id, quantity: d.quantity, uom: d.uom, bag_weight: d.bag_weight, rate: d.final_rate })]
}

export function DealFormModal({
  buyers, suppliers, counts, terms, companies, people, meId, deals, lockedIds, initialDeal, buyerName, leadNos, scNos, canEdit = true, readOnly = false, onEdit, onClose, onDone,
}: {
  buyers: MirrorParty[]
  suppliers: MirrorParty[]
  counts: CountRow[]
  terms: PaymentTerm[]
  companies: DealCompany[]
  people: DealPerson[]
  /** The signed-in user: a new deal is owned by them. */
  meId: string | undefined
  /** Every deal, for the Select Item to Update search. */
  deals: Deal[]
  /** Deals that can no longer be changed (Approved): not offered for update. */
  lockedIds: Set<string>
  /** Opened from a row's Actions > Edit. Absent for a new deal. */
  initialDeal?: Deal | null
  buyerName: Map<string, string>
  /** Lead numbers by lead id, for the read-only Leads field. */
  leadNos: Map<string, string>
  /** Sales Confirmation numbers by id (read-only view). */
  scNos?: Map<string, string>
  /** The signed-in user may edit deals (read-only view: enables the Edit button). */
  canEdit?: boolean
  /** Locked view of the deal: same sections as Edit, nothing can be changed. */
  readOnly?: boolean
  onEdit?: (deal: Deal) => void
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
}) {
  const updating = Boolean(initialDeal)
  const names = useProfileNames()
  const textOf = (d: Deal) => `${d.deal_no} · ${d.buyer_id ? buyerName.get(d.buyer_id) ?? 'no buyer yet' : 'no buyer yet'}`
  const [recordId, setRecordId] = useState(initialDeal?.id ?? '')
  const [recordText, setRecordText] = useState(initialDeal ? textOf(initialDeal) : '')
  const [f, setF] = useState<Form>(() => toForm(initialDeal ?? null, companies))
  const [lines, setLines] = useState<LineForm[]>(() => [emptyLine()])
  const [origLines, setOrigLines] = useState<LineForm[]>(() => [emptyLine()])
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [locBusy, setLocBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editable = useMemo(() => deals.filter((d) => !lockedIds.has(d.id)), [deals, lockedIds])
  const current = deals.find((d) => d.id === recordId) ?? initialDeal ?? null

  // the count rows of the deal being updated
  useEffect(() => {
    if (!current) return
    let alive = true
    void loadLines(current).then((l) => { if (alive) { setLines(l); setOrigLines(l) } })
    return () => { alive = false }
  }, [current])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  function chooseRecord(text: string) {
    setRecordText(text)
    const hit = editable.find((d) => textOf(d) === text)
    if (!hit) { setRecordId(''); return }
    setRecordId(hit.id)
    setF(toForm(hit, companies))
    setSubmitted(false)
    setError(null)
  }

  function clearForm() {
    setF(toForm(null, companies))
    setLines([emptyLine()])
    setSubmitted(false)
    setError(null)
  }

  // picking a party takes that party's commission terms from its master
  function pickBuyer(id: string) {
    const b = buyers.find((x) => x.id === id)
    setF((p) => ({ ...p, buyer_id: id, buyer_comm_basis: b?.commission_basis ?? '', buyer_comm_value: str(b?.commission_value) }))
  }
  function pickSupplier(id: string) {
    const s = suppliers.find((x) => x.id === id)
    setF((p) => ({ ...p, supplier_id: id, supplier_comm_basis: s?.commission_basis ?? '', supplier_comm_value: str(s?.commission_value) }))
  }

  const bVal = numOrNull(f.buyer_comm_value)
  const sVal = numOrNull(f.supplier_comm_value)
  const basisName = (b: string) => COMM_BASES.find((x) => x.value === b)?.label ?? '—'
  const commText = (basis: string, value: string) => (basis ? `${basisName(basis)} · ${value || '—'}` : '')
  // a deal may have no counts yet; once any value is typed the row must be complete
  const blankRows = (l: LineForm[]) => l.every((r) => !r.count_id && !r.quantity.trim() && !r.rate.trim() && !r.bag_weight.trim())
  const noCounts = blankRows(lines)
  const hadCounts = !blankRows(origLines)
  const lineIssues = noCounts ? [] : lineProblems(lines)
  const errors: Record<string, string> = updating && !recordId ? { 'd-record': 'Choose the deal to update.' } : {}
  const visible = submitted ? errors : {}

  async function captureLocation() {
    setLocBusy(true)
    setError(null)
    try {
      const p = await getPosition()
      setF((x) => ({ ...x, location_lat: Number(p.lat.toFixed(6)), location_lng: Number(p.lng.toFixed(6)) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get the location.')
    }
    setLocBusy(false)
  }

  async function save() {
    setSubmitted(true)
    setError(null)
    if (Object.keys(errors).length > 0) {
      setError('Choose the deal to update first.')
      return
    }
    if (lineIssues.length > 0) {
      setError(`Still needed in Counts: ${lineIssues.join(', ')}.`)
      return
    }
    if (noCounts && hadCounts) {
      setError('A deal that has counts needs at least one; change the count instead of clearing it.')
      return
    }
    setBusy(true)
    const deal = current
    const payload: Record<string, unknown> = {
      buyer_id: f.buyer_id || null,
      supplier_id: f.supplier_id || null,
      company_id: f.company_id || null,
      payment_term_id: f.payment_term_id || null,
      price_basis: f.price_basis,
      freight: f.freight,
      buyer_comm_basis: f.buyer_comm_basis || null,
      buyer_comm_value: f.buyer_comm_basis ? bVal : null,
      supplier_comm_basis: f.supplier_comm_basis || null,
      supplier_comm_value: f.supplier_comm_basis ? sVal : null,
      owner_id: deal?.owner_id ?? meId ?? null,
      manager_id: f.manager_id || null,
      notes: f.notes.trim() || null,
      location_text: f.location_text.trim() || null,
      location_lat: f.location_lat,
      location_lng: f.location_lng,
    }
    if (!deal && !noCounts) {
      // a new deal starts from its first row; save_deal_lines then stores every row
      const [first] = linesPayload(lines.slice(0, 1), 'final_rate')
      Object.assign(payload, first)
    }
    const res = deal
      ? await supabase.from('crm_deals').update(payload).eq('id', deal.id).select('id, deal_no')
      : await supabase.from('crm_deals').insert(payload).select('id, deal_no')
    if (res.error || !res.data || res.data.length === 0) {
      setBusy(false)
      setError(res.error ? errMessage(res.error, 'Could not save this deal') : 'Your account cannot change this deal.')
      return
    }
    const saved = res.data[0] as { id: string; deal_no: string }
    if (!noCounts && (!deal || JSON.stringify(lines) !== JSON.stringify(origLines))) {
      const ln = await supabase.rpc('save_deal_lines', { p_deal: saved.id, p_lines: linesPayload(lines, 'final_rate') })
      if (ln.error) {
        setBusy(false)
        setError(errMessage(ln.error, 'The deal was saved, but its counts could not be saved'))
        return
      }
    }
    setBusy(false)
    await onDone(deal ? `${saved.deal_no} updated.` : `${saved.deal_no} created.`)
  }

  const show = !updating || recordId
  const approved = (current ?? initialDeal)?.status === 'approved'
  const dealNow = current ?? initialDeal ?? null
  return (
    <Modal
      title={readOnly ? 'View Deal' : updating ? 'Update Deal' : 'New Deal'}
      description={readOnly ? undefined : updating ? 'Choose the deal, then change what you need. It keeps its number and creation date.' : 'Buyer, supplier, counts and terms are added from Actions > Edit.'}
      size="lg"
      onClose={onClose}
      footer={readOnly ? (
        <>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
          <button className="btn primary" type="button" disabled={!canEdit || approved || !dealNow}
            title={!canEdit ? 'You need the “Edit deals” permission.' : approved ? 'An Approved deal is locked.' : undefined}
            onClick={() => dealNow && onEdit?.(dealNow)}>Edit</button>
        </>
      ) : (
        <>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
          <span style={{ display: 'flex', gap: 10 }}>
            {!updating && <button className="btn ghost" type="button" onClick={clearForm} disabled={busy}>Clear Form</button>}
            <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : updating ? 'Update Deal' : 'Create Deal'}</button>
          </span>
        </>
      )}
    >
      <ErrorBanner message={error} />

      {readOnly && dealNow && (
        <div className="small" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <StatusPill label={dealStatus(dealNow.status).label} tone={dealStatus(dealNow.status).tone} />
          <span className="muted">Created {formatDateTime(dealNow.created_at)}</span>
          {dealNow.approved_at && <span className="muted">Approval Date {formatDateTime(dealNow.approved_at)}</span>}
          {approved && <span className="muted">Approved by {dealNow.approved_by ? names[dealNow.approved_by] ?? 'a manager' : 'a manager'}</span>}
          {dealNow.lead_id && <Link className="mono" to="/leads">Lead {leadNos.get(dealNow.lead_id) ?? ''}</Link>}
          {dealNow.sales_confirmation_id
            ? <span>Sales Confirmation <Link className="mono" to={`/sales-confirmations?open=${dealNow.sales_confirmation_id}`}>{scNos?.get(dealNow.sales_confirmation_id) ?? 'open'}</Link></span>
            : approved && <span className="muted">Approved - create the Sales Confirmation from the row Actions</span>}
        </div>
      )}

      {updating && !readOnly && (
        <FieldErrorsProvider value={visible}>
          <section className="fs-card" aria-label="Select Item to Update">
            <header className="fs-head"><div><h3>Select Item to Update:</h3></div></header>
            <div className="fs-body">
              <Field id="d-record" label="Search for a record">
                <ComboInput id="d-record" placeholder="-- Search for a record --" value={recordText} onChange={chooseRecord} options={editable.map((d) => textOf(d))} style={{ maxWidth: 520 }} />
              </Field>
            </div>
          </section>
        </FieldErrorsProvider>
      )}

      {show && (
        <FieldErrorsProvider value={visible}>
          <fieldset className={readOnly ? 'ro-fieldset' : undefined} disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <FormSection title="Deal Details" collapsible columns={3}>
            <Field id="d-no" label="Name">
              <input id="d-no" readOnly value={current?.deal_no ?? ''} placeholder="Assigned on save" title="The deal number is the deal's name." />
            </Field>
            <Field id="d-status" label="Status">
              <input id="d-status" readOnly value={dealStatus(current?.status ?? 'new_deal').label} title="Change the status from the row's Actions menu." />
            </Field>
            <Field id="d-lead" label="Leads">
              <input id="d-lead" readOnly value={current?.lead_id ? leadNos.get(current.lead_id) ?? '' : ''} placeholder="Linked when a lead is converted" title="A deal is linked to its lead when the lead is converted." />
            </Field>
            <Field id="d-owner" label="Owner">
              <input id="d-owner" readOnly value={people.find((x) => x.id === (current?.owner_id ?? meId))?.name ?? ''} title="The signed-in user owns a new deal." />
            </Field>
            {updating && (
              <Field id="d-manager" label="Manager">
                <select id="d-manager" value={f.manager_id} title="Who approves this deal." onChange={(e) => set('manager_id', e.target.value)}>
                  <option value="">--None--</option>
                  {people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </select>
              </Field>
            )}
          </FormSection>

          {updating && (
            <>
          <FormSection title="Parties" collapsible columns={3}>
            <Field id="d-buyer" label="Buyer">
              <select id="d-buyer" value={f.buyer_id} title="From Buyers & Suppliers. Needed before Manager Approval." onChange={(e) => pickBuyer(e.target.value)}>
                <option value="">--None--</option>
                {buyers.filter((x) => x.is_active || x.id === f.buyer_id).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
              </select>
            </Field>
            <Field id="d-supplier" label="Supplier">
              <select id="d-supplier" value={f.supplier_id} title="From Buyers & Suppliers. Needed before Manager Approval." onChange={(e) => pickSupplier(e.target.value)}>
                <option value="">--None--</option>
                {suppliers.filter((x) => x.is_active || x.id === f.supplier_id).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
              </select>
            </Field>
            {(f.buyer_id || f.supplier_id) && (
              <FullWidth>
                <div className="lookup-grid" style={{ marginBottom: 0 }}>
                  {buyers.find((x) => x.id === f.buyer_id) && <PartyLookup title="Buyer" p={buyers.find((x) => x.id === f.buyer_id)!} unit={companies.find((c) => c.id === buyers.find((x) => x.id === f.buyer_id)!.company_id)?.name} />}
                  {suppliers.find((x) => x.id === f.supplier_id) && <PartyLookup title="Supplier" p={suppliers.find((x) => x.id === f.supplier_id)!} unit={companies.find((c) => c.id === suppliers.find((x) => x.id === f.supplier_id)!.company_id)?.name} />}
                </div>
              </FullWidth>
            )}
          </FormSection>

            </>
          )}

          {updating && (
          <FormSection title="Counts" collapsible columns={3}>
            <FullWidth>
              <CountLinesEditor lines={lines} onChange={setLines} counts={counts} disabled={readOnly}
                buyer={{ basis: f.buyer_comm_basis || null, value: bVal }} supplier={{ basis: f.supplier_comm_basis || null, value: sVal }} />
            </FullWidth>
          </FormSection>
          )}

          {updating && (
            <>
          <FormSection title="Pricing and Commission" collapsible columns={3}>
            <Field id="d-mode" label="Mode">
              <select id="d-mode" value={f.price_basis} onChange={(e) => set('price_basis', e.target.value as Form['price_basis'])}>
                <option value="net">Net</option>
                <option value="ex_mill">Ex-Mill</option>
              </select>
            </Field>
            <Field id="d-freight" label="Freight">
              <select id="d-freight" value={f.freight} onChange={(e) => set('freight', e.target.value as Form['freight'])}>
                <option value="excluded">Excluded</option>
                <option value="included">Included</option>
              </select>
            </Field>
            <Field id="d-bcomm" label="Buyer Commission">
              <input id="d-bcomm" readOnly value={commText(f.buyer_comm_basis, f.buyer_comm_value)} placeholder="From the master" />
            </Field>
            <Field id="d-scomm" label="Supplier Commission">
              <input id="d-scomm" readOnly value={commText(f.supplier_comm_basis, f.supplier_comm_value)} placeholder="From the master" />
            </Field>
          </FormSection>

          <FormSection title="Terms" collapsible columns={3}>
            <Field id="d-term" label="Payment Terms">
              <select id="d-term" value={f.payment_term_id} onChange={(e) => set('payment_term_id', e.target.value)}>
                <option value="">--None--</option>
                {terms.filter((t) => t.is_active || t.id === f.payment_term_id).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            </Field>
          </FormSection>

          <FormSection title="Location" collapsible columns={3}>
            <div className="fs-span-2">
              <Field id="d-loc" label="Location" hideLabel>
                <input id="d-loc" placeholder="Address or place for this deal" value={f.location_text} onChange={(e) => set('location_text', e.target.value)} />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', minHeight: 42, alignSelf: 'start' }}>
              <button className="btn sm" type="button" disabled={locBusy} onClick={() => void captureLocation()}>{locBusy ? 'Locating…' : 'Capture my location'}</button>
              {f.location_lat !== null && f.location_lng !== null && (
                <>
                  <a className="small" href={mapsUrl(f.location_lat, f.location_lng)} target="_blank" rel="noopener noreferrer">{f.location_lat.toFixed(5)}, {f.location_lng.toFixed(5)} · Maps</a>
                  <button className="btn ghost sm" type="button" onClick={() => setF((x) => ({ ...x, location_lat: null, location_lng: null }))}>Clear pin</button>
                </>
              )}
            </div>
          </FormSection>

          <FormSection title="Notes" collapsible columns={3}>
            <FullWidth>
              <Field id="d-notes" label="Remarks">
                <textarea id="d-notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </FullWidth>
          </FormSection>
            </>
          )}
          </fieldset>

          {updating && dealNow && (
            <>
              <FormSection title="Documents" collapsible columns={3}>
                <FullWidth><DealDocuments dealId={dealNow.id} canEdit={!readOnly && canEdit && !approved} /></FullWidth>
              </FormSection>
              <FormSection title="History" collapsible columns={3}>
                <FullWidth><DealHistory dealId={dealNow.id} refreshKey={dealNow.updated_at} /></FullWidth>
              </FormSection>
            </>
          )}
        </FieldErrorsProvider>
      )}
    </Modal>
  )
}
