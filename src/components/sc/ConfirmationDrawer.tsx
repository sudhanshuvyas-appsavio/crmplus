import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { CountRow, JobProcess, PaymentTerm, Transporter } from '../../api/types'
import { Drawer, DeleteControl } from '../Drawer'
import { Field } from '../PartyForms'
import { StatusPicker } from '../board/Board'
import { errMessage, numOrNull } from '../../lib/party'
import { formatDateTime } from '../../lib/format'
import {
  COMM_BASES, SALE_TYPES, SC_STAGES, UOMS, commTerms, commission, dispatchStatus, inr, scGroup, scStage, totalWeight,
} from '../../lib/deals'
import { CancelControl, NotificationLog } from './NotificationLog'
import { SendPanel } from './SendPanel'
import { ScDocuments } from './ScDocuments'
import type { Company, Names, Party, ScRow } from './scShared'

type Form = {
  supplier_id: string
  supplier_company_id: string
  buyer_id: string
  buyer_company_id: string
  count_id: string
  uom: string
  quantity: string
  net_quantity: string
  freight: 'included' | 'excluded'
  bag_weight: string
  rate: string
  payment_term_id: string
  remarks: string
  price_basis: '' | 'ex_mill' | 'net'
  delivery_schedule: string
  special_instructions: string
  sale_type: 'local' | 'export'
  job_process_id: string
  delivery_address: string
  transporter_id: string
  vehicle_no: string
  driver_phone: string
  buyer_comm_basis: string
  buyer_comm_value: string
  supplier_comm_basis: string
  supplier_comm_value: string
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

function toForm(sc: ScRow | null): Form {
  return {
    supplier_id: sc?.supplier_id ?? '',
    supplier_company_id: sc?.supplier_company_id ?? '',
    buyer_id: sc?.buyer_id ?? '',
    buyer_company_id: sc?.buyer_company_id ?? '',
    count_id: sc?.count_id ?? '',
    uom: sc?.uom ?? 'KG',
    quantity: str(sc?.quantity),
    net_quantity: str(sc?.net_quantity),
    freight: sc?.freight ?? 'excluded',
    bag_weight: str(sc?.bag_weight),
    rate: str(sc?.rate),
    payment_term_id: sc?.payment_term_id ?? '',
    remarks: sc?.remarks ?? '',
    price_basis: sc?.price_basis ?? '',
    delivery_schedule: sc?.delivery_schedule ?? '',
    special_instructions: sc?.special_instructions ?? '',
    sale_type: sc?.sale_type ?? 'local',
    job_process_id: sc?.job_process_id ?? '',
    delivery_address: sc?.delivery_address ?? '',
    transporter_id: sc?.transporter_id ?? '',
    vehicle_no: sc?.vehicle_no ?? '',
    driver_phone: sc?.driver_phone ?? '',
    buyer_comm_basis: sc?.buyer_comm_basis ?? '',
    buyer_comm_value: str(sc?.buyer_comm_value),
    supplier_comm_basis: sc?.supplier_comm_basis ?? '',
    supplier_comm_value: str(sc?.supplier_comm_value),
  }
}

export function ConfirmationDrawer({
  sc, canManage, canOrder, item, suppliers, buyers, companies, counts, terms, transporters, jobs, onClose, onDone,
}: {
  sc: ScRow | null
  canManage: boolean
  canOrder: boolean
  /** Its Dispatch and Billing item, if one exists. */
  item: { id: string; order_no: string; dispatch_status: string } | null
  suppliers: Party[]
  buyers: Party[]
  companies: Company[]
  counts: CountRow[]
  terms: PaymentTerm[]
  transporters: Transporter[]
  jobs: JobProcess[]
  onClose: () => void
  onDone: (message: string, keepOpenId?: string) => void | Promise<void>
}) {
  const navigate = useNavigate()
  const [f, setF] = useState<Form>(toForm(sc))
  const [editMode, setEditMode] = useState(!sc)
  const [dealNo, setDealNo] = useState<string | null>(null)
  useEffect(() => {
    if (!sc?.deal_id) return
    void supabase.from('crm_deals').select('deal_no').eq('id', sc.deal_id).maybeSingle().then(({ data }) => setDealNo((data as { deal_no: string } | null)?.deal_no ?? null))
  }, [sc?.deal_id])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  const qty = numOrNull(f.quantity)
  const net = numOrNull(f.net_quantity)
  const bag = numOrNull(f.bag_weight)
  const rate = numOrNull(f.rate)
  const bVal = numOrNull(f.buyer_comm_value)
  const sVal = numOrNull(f.supplier_comm_value)
  const weight = totalWeight(f.uom, qty, bag)
  const value = weight !== null && rate !== null ? weight * rate : null
  const bComm = commission(f.buyer_comm_basis || null, bVal, value, f.uom, qty, weight, bag)
  const sComm = commission(f.supplier_comm_basis || null, sVal, value, f.uom, qty, weight, bag)

  const problems: string[] = []
  if (!f.supplier_id) problems.push('Supplier')
  if (!f.supplier_company_id) problems.push('Supplier company')
  if (!f.buyer_id) problems.push('Buyer')
  if (!f.buyer_company_id) problems.push('Buyer company')
  if (!f.count_id) problems.push('Count')
  if (qty === null || qty <= 0) problems.push('Ex-mill quantity (above zero)')
  if (f.net_quantity && (net === null || net <= 0)) problems.push('Net quantity (above zero)')
  if (f.uom === 'BAGS' && (bag === null || bag <= 0)) problems.push('Bag weight (needed for BAGS)')
  if (f.bag_weight && (bag === null || bag <= 0)) problems.push('Bag weight (a number above zero)')
  if (f.rate && (rate === null || rate < 0)) problems.push('Rate (a number)')
  if (f.driver_phone && !/^[0-9+ -]{6,20}$/.test(f.driver_phone.trim())) problems.push('Driver phone (digits only)')
  const locked = !!sc?.deal_id
  if (locked && !f.price_basis) problems.push('Ex-mill / Net')

  /** Picking a contact fills in its company and commission terms; both can still be changed. */
  function pickParty(side: 'supplier' | 'buyer', id: string) {
    const list = side === 'supplier' ? suppliers : buyers
    const company = list.find((x) => x.id === id)?.company_id ?? ''
    setF((p) => ({ ...p, [`${side}_id`]: id, [`${side}_company_id`]: company || p[`${side}_company_id` as const] }) as Form)
  }
  function pickJob(id: string) {
    const j = jobs.find((x) => x.id === id)
    setF((p) => ({ ...p, job_process_id: id, delivery_address: j ? j.delivery_address || j.office_address || '' : p.delivery_address }))
  }

  async function save() {
    setBusy(true)
    setErr(null)
    const editable: Record<string, unknown> = {
      net_quantity: net ?? qty,
      freight: f.freight,
      price_basis: f.price_basis || null,
      bag_weight: bag,
      delivery_schedule: f.delivery_schedule.trim() || null,
      special_instructions: f.special_instructions.trim() || null,
      remarks: f.remarks.trim() || null,
      sale_type: f.sale_type,
      job_process_id: f.job_process_id || null,
      delivery_address: f.delivery_address.trim() || null,
      transporter_id: f.transporter_id || null,
      vehicle_no: f.vehicle_no.trim() || null,
      driver_phone: f.driver_phone.trim() || null,
    }
    const payload = locked ? editable : {
      ...editable,
      supplier_id: f.supplier_id || null,
      supplier_company_id: f.supplier_company_id || null,
      buyer_id: f.buyer_id || null,
      buyer_company_id: f.buyer_company_id || null,
      count_id: f.count_id || null,
      uom: f.uom,
      quantity: qty,
      rate,
      payment_term_id: f.payment_term_id || null,
      // blank on a new manual confirmation: the database takes each party's master terms
      ...(sc || f.buyer_comm_basis ? { buyer_comm_basis: f.buyer_comm_basis || null, buyer_comm_value: f.buyer_comm_basis ? bVal : null } : {}),
      ...(sc || f.supplier_comm_basis ? { supplier_comm_basis: f.supplier_comm_basis || null, supplier_comm_value: f.supplier_comm_basis ? sVal : null } : {}),
    }
    const { data, error } = sc
      ? await supabase.from('sales_confirmations').update(payload).eq('id', sc.id).select('id, sc_no, status')
      : await supabase.from('sales_confirmations').insert(payload).select('id, sc_no, status')
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this confirmation'))
    const row = data?.[0] as { id: string; sc_no: string; status: string } | undefined
    if (!row) return setErr('Your account cannot change this confirmation.')
    const ready = row.status === 'confirmed'
    setEditMode(false)
    await onDone(
      `${row.sc_no} ${sc ? 'saved' : 'created'}.${ready ? ' Use “Send to supplier” and “Send to buyer” to send it.' : ' It is still incomplete: fill in every required field to send it.'}`,
      row.id,
    )
  }

  async function setStage(stage: string) {
    if (!sc) return
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.from('sales_confirmations').update({ stage }).eq('id', sc.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error, 'Could not change the status') : 'Your account cannot change this confirmation.')
    await onDone(`${sc.sc_no} is now ${scStage(stage).label}.`, sc.id)
  }

  async function cancelSc() {
    if (!sc) return
    setBusy(true)
    const { error } = await supabase.rpc('cancel_sales_confirmation', { p_sc: sc.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not cancel this confirmation'))
    await onDone(`${sc.sc_no} cancelled.`)
  }

  async function remove() {
    if (!sc) return
    setBusy(true)
    const { data, error } = await supabase.from('sales_confirmations').delete().eq('id', sc.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Only incomplete drafts can be deleted.')
    await onDone(`${sc.sc_no} deleted.`)
  }

  async function createItem() {
    if (!sc) return
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.rpc('create_dispatch_bill', { p_sc: sc.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not create the Dispatch and Billing item'))
    navigate(`/orders?open=${data as string}`)
  }

  const transporter = transporters.find((t) => t.id === f.transporter_id)
  const buyerRow = buyers.find((x) => x.id === f.buyer_id)
  const buyerUnit = companies.find((c) => c.id === (f.buyer_company_id || buyerRow?.company_id))
  const names: Names = {
    supplier: suppliers.find((x) => x.id === f.supplier_id)?.name ?? '',
    buyer: buyers.find((x) => x.id === f.buyer_id)?.name ?? '',
    supplierCompany: companies.find((x) => x.id === f.supplier_company_id)?.name ?? '',
    buyerCompany: companies.find((x) => x.id === f.buyer_company_id)?.name ?? '',
    count: counts.find((x) => x.id === f.count_id)?.display_name ?? '',
    term: terms.find((x) => x.id === f.payment_term_id)?.name ?? '',
    transporter: transporter?.name ?? '',
    deliveryTo: [jobs.find((j) => j.id === f.job_process_id)?.name, f.delivery_address.trim()].filter(Boolean).join(', '),
  }
  const dirty = sc ? JSON.stringify(f) !== JSON.stringify(toForm(sc)) : true
  const complete = sc !== null && sc.status === 'confirmed' && problems.length === 0
  const hasDelivery = !!(sc?.transporter_id || sc?.vehicle_no)
  const cancelled = sc?.status === 'cancelled'
  // Editable until it is converted into a Dispatch and Billing item.
  const canChange = canManage && !cancelled && !item
  const editable = canChange && editMode

  const stageOptions = !sc || !canManage || cancelled ? [] : SC_STAGES
    .filter((s) => s.value !== sc.stage && s.value !== 'cancelled')
    .filter((s) => s.value === 'draft' || sc.status === 'confirmed')
    .filter((s) => s.value !== 'send_delivery' || hasDelivery)

  const partyOptions = (list: Party[], current: string) =>
    list.filter((x) => x.is_active || x.id === current).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))
  const companyOptions = (current: string) =>
    companies.filter((c) => c.is_active || c.id === current).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)

  return (
    <Drawer title={sc ? sc.sc_no : 'New sales confirmation'} onClose={onClose}>
      <div className="panel-status">
        {sc ? (
          <StatusPicker current={scStage(scGroup(sc))} options={stageOptions} onPick={(s) => void setStage(s)} disabled={busy || dirty} />
        ) : (
          <StatusPicker current={scStage('draft')} options={[]} onPick={() => undefined} disabled />
        )}
        <span className="small muted">
          {sc ? <>Created {formatDateTime(sc.confirmed_at)}{dealNo ? <> · from deal <span className="mono">{dealNo}</span></> : null}</> : 'Number, date and time are set automatically when you save.'}
        </span>
      </div>

      {err && <div className="alert">{err}</div>}
      {!canManage && <div className="notice small">You can view this confirmation; changing or sending it needs the “Create, edit and send sales confirmations” permission.</div>}
      {sc && sc.status === 'draft' && !cancelled && <div className="notice small">Incomplete: fill in the required fields before it can be sent.</div>}
      {item && (
        <div className="notice small">Converted to Dispatch and Billing item <span className="mono">{item.order_no}</span>; this confirmation can no longer be edited.</div>
      )}
      {locked && !item && (
        <div className="notice small">
          Created from a deal: parties, count, quantity, rate, payment terms and commission are locked. Freight, ex-mill / net, bag weight,
          type, delivery and transport details, schedule and instructions can change.
        </div>
      )}

      {!sc && canManage && <LinkToDeal onLinked={(id, no) => onDone(`${no} created from the deal.`, id)} />}

      <fieldset disabled={!editable || locked} className="plain-fieldset">
        <h3 className="section-title">Parties</h3>
        <div className="form-grid">
          <Field id="sc-supplier" label="Supplier" required>
            <select id="sc-supplier" value={f.supplier_id} onChange={(e) => pickParty('supplier', e.target.value)}>
              <option value="">Choose…</option>
              {partyOptions(suppliers, f.supplier_id)}
            </select>
          </Field>
          <Field id="sc-supplier-co" label="Supplier company" required>
            <select id="sc-supplier-co" value={f.supplier_company_id} onChange={(e) => set('supplier_company_id', e.target.value)}>
              <option value="">Choose…</option>
              {companyOptions(f.supplier_company_id)}
            </select>
          </Field>
          <Field id="sc-buyer" label="Buyer" required>
            <select id="sc-buyer" value={f.buyer_id} onChange={(e) => pickParty('buyer', e.target.value)}>
              <option value="">Choose…</option>
              {partyOptions(buyers, f.buyer_id)}
            </select>
          </Field>
          <Field id="sc-buyer-co" label="Buyer company" required>
            <select id="sc-buyer-co" value={f.buyer_company_id} onChange={(e) => set('buyer_company_id', e.target.value)}>
              <option value="">Choose…</option>
              {companyOptions(f.buyer_company_id)}
            </select>
          </Field>
        </div>

        {buyerRow && (
          <div className="lookup" style={{ marginBottom: 14 }}>
            <h4>Buyer: {buyerRow.name}</h4>
            <dl className="kv">
              <dt>Office address</dt><dd>{buyerRow.address || '—'}</dd>
              <dt>Office phone</dt><dd>{buyerRow.office_phone ? `+91 ${buyerRow.office_phone}` : '—'}</dd>
              <dt>GST</dt><dd className="mono">{buyerRow.gst || '—'}</dd>
              <dt>Business unit phone</dt><dd>{buyerUnit?.phone_1 || buyerUnit?.mobile ? `+91 ${buyerUnit?.phone_1 || buyerUnit?.mobile}` : '—'}</dd>
            </dl>
          </div>
        )}

        <h3 className="section-title">Goods, rate and terms</h3>
        <div className="form-grid">
          <Field id="sc-count" label="Count" required>
            <select id="sc-count" value={f.count_id} onChange={(e) => set('count_id', e.target.value)}>
              <option value="">Choose…</option>
              {counts.filter((c) => c.is_active || c.id === f.count_id).map((c) => (<option key={c.id} value={c.id}>{c.display_name}</option>))}
            </select>
          </Field>
          <Field id="sc-qty" label="Quantity" required>
            <input id="sc-qty" inputMode="decimal" className="mono" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </Field>
          <Field id="sc-uom" label="UOM" required>
            <select id="sc-uom" value={f.uom} onChange={(e) => set('uom', e.target.value)}>
              {UOMS.map((u) => (<option key={u.value} value={u.value}>{u.label}</option>))}
            </select>
          </Field>
          <Field id="sc-rate" label="Final rate (₹ per kg)">
            <input id="sc-rate" inputMode="decimal" className="mono" value={f.rate} onChange={(e) => set('rate', e.target.value)} />
          </Field>
          <Field id="sc-term" label="Payment terms">
            <select id="sc-term" value={f.payment_term_id} onChange={(e) => set('payment_term_id', e.target.value)}>
              <option value="">—</option>
              {terms.filter((t) => t.is_active || t.id === f.payment_term_id).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
          </Field>
        </div>
        <div className="comm-grid">
          <CommBox label="Buyer commission" basis={f.buyer_comm_basis} value={f.buyer_comm_value} amount={bComm} isNew={!sc}
            onBasis={(v) => set('buyer_comm_basis', v)} onValue={(v) => set('buyer_comm_value', v)} />
          <CommBox label="Supplier commission" basis={f.supplier_comm_basis} value={f.supplier_comm_value} amount={sComm} isNew={!sc}
            onBasis={(v) => set('supplier_comm_basis', v)} onValue={(v) => set('supplier_comm_value', v)} />
        </div>
      </fieldset>

      <fieldset disabled={!editable} className="plain-fieldset">
        <div className="form-grid">
          <Field id="sc-freight" label="Freight" required>
            <select id="sc-freight" value={f.freight} onChange={(e) => set('freight', e.target.value as Form['freight'])}>
              <option value="excluded">Excluded</option>
              <option value="included">Included</option>
            </select>
          </Field>
          <Field id="sc-basis" label="Ex-mill / Net" required={locked}>
            <select id="sc-basis" value={f.price_basis} onChange={(e) => set('price_basis', e.target.value as Form['price_basis'])}>
              <option value="">Choose…</option>
              <option value="ex_mill">Ex-mill</option>
              <option value="net">Net</option>
            </select>
          </Field>
          <Field id="sc-bag" label="Bag weight (kg)" required={f.uom === 'BAGS'}>
            <input id="sc-bag" inputMode="decimal" className="mono" value={f.bag_weight} onChange={(e) => set('bag_weight', e.target.value)} />
          </Field>
          <Field id="sc-net" label="Net quantity" hint="Blank = same as the quantity.">
            <input id="sc-net" inputMode="decimal" className="mono" value={f.net_quantity} onChange={(e) => set('net_quantity', e.target.value)} />
          </Field>
        </div>
        <div className="figures">
          <div><span>Total weight</span><strong className="mono">{weight === null ? '—' : `${inr(weight)} kg`}</strong></div>
          <div><span>Value</span><strong className="mono">₹{inr(value, 0)}</strong></div>
          <div><span>Total commission</span><strong className="mono">₹{inr(bComm === null && sComm === null ? null : (bComm ?? 0) + (sComm ?? 0), 0)}</strong></div>
        </div>

        <h3 className="section-title">Delivery</h3>
        <div className="form-grid">
          <Field id="sc-type" label="Type">
            <select id="sc-type" value={f.sale_type} onChange={(e) => set('sale_type', e.target.value as Form['sale_type'])}>
              {SALE_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </select>
          </Field>
          <Field id="sc-job" label="Sizing / delivery address" hint="Blank = the buyer’s own address.">
            <select id="sc-job" value={f.job_process_id} onChange={(e) => pickJob(e.target.value)}>
              <option value="">Buyer’s address</option>
              {jobs.filter((j) => j.is_active || j.id === f.job_process_id).map((j) => (<option key={j.id} value={j.id}>{j.name}</option>))}
            </select>
          </Field>
          <Field id="sc-sched" label="Delivery schedule">
            <input id="sc-sched" value={f.delivery_schedule} onChange={(e) => set('delivery_schedule', e.target.value)} />
          </Field>
        </div>
        {(f.job_process_id || f.delivery_address) && (
          <Field id="sc-addr" label="Delivery address">
            <textarea id="sc-addr" rows={2} value={f.delivery_address} onChange={(e) => set('delivery_address', e.target.value)} />
          </Field>
        )}
        <div className="form-grid">
          <Field id="sc-tr" label="Transport company">
            <select id="sc-tr" value={f.transporter_id} onChange={(e) => set('transporter_id', e.target.value)}>
              <option value="">—</option>
              {transporters.filter((t) => t.is_active || t.id === f.transporter_id).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
          </Field>
          <Field id="sc-veh" label="Vehicle number">
            <input id="sc-veh" value={f.vehicle_no} onChange={(e) => set('vehicle_no', e.target.value.toUpperCase())} />
          </Field>
          <Field id="sc-drv" label="Driver phone">
            <input id="sc-drv" inputMode="tel" value={f.driver_phone} onChange={(e) => set('driver_phone', e.target.value)} />
          </Field>
        </div>
        <p className="field-hint">Once the transport company or vehicle is in, sending again moves this confirmation to “Send with Delivery Info”.</p>
        <Field id="sc-instr" label="Special instructions">
          <textarea id="sc-instr" rows={2} value={f.special_instructions} onChange={(e) => set('special_instructions', e.target.value)} />
        </Field>
        <Field id="sc-remarks" label="Remarks">
          <textarea id="sc-remarks" rows={2} value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </Field>
      </fieldset>

      {problems.length > 0 && !cancelled && <p className="field-hint">Still needed to send: {problems.join(', ')}.</p>}

      {canManage && !cancelled && (
        <div className="drawer-actions">
          {sc && canChange && !editMode && (
            <button className="btn" type="button" disabled={busy} onClick={() => setEditMode(true)}>Edit</button>
          )}
          {editable && (!sc || dirty) && (
            <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : sc ? 'Save changes' : 'Create confirmation'}
            </button>
          )}
          {sc && editable && (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => { setF(toForm(sc)); setErr(null); setEditMode(false) }}>Cancel editing</button>
          )}
          {sc && sc.status === 'draft' && <DeleteControl label="Delete" name={sc.sc_no} busy={busy} onConfirm={() => void remove()} />}
          {sc && sc.status === 'confirmed' && !item && <CancelControl busy={busy} onConfirm={() => void cancelSc()} />}
        </div>
      )}
      {sc && dirty && complete && <p className="field-hint">Save your changes before sending.</p>}

      {sc && !cancelled && (
        <div className="notice">
          <h3 className="section-title" style={{ marginTop: 0 }}>Dispatch and Billing</h3>
          {item ? (
            <p className="small">
              <Link to={`/orders?open=${item.id}`}><span className="mono">{item.order_no}</span></Link> · {dispatchStatus(item.dispatch_status).label}
            </p>
          ) : sc.status !== 'confirmed' ? (
            <p className="small muted">Available once the confirmation is complete.</p>
          ) : canOrder ? (
            <p>
              <button className="btn primary" type="button" disabled={busy || dirty} onClick={() => void createItem()}>Create Dispatch and Billing</button>{' '}
              <span className="small muted">Copies the parties, goods, rate, commission and delivery details.</span>
            </p>
          ) : (
            <p className="small muted">Creating it needs the “Create and manage orders” permission.</p>
          )}
        </div>
      )}

      {complete && !dirty && canManage && sc && !cancelled && (
        <SendPanel sc={sc} names={names} supplier={suppliers.find((x) => x.id === sc.supplier_id) ?? null} buyer={buyers.find((x) => x.id === sc.buyer_id) ?? null} onSent={(text) => onDone(text, sc.id)} />
      )}
      {sc && <ScDocuments scId={sc.id} canEdit={canChange} />}
      {sc && <NotificationLog sc={sc} canManage={canManage} />}
    </Drawer>
  )
}

/** Manual confirmation with "Link to Deal": picking an Approved deal that has
 *  no confirmation yet creates it from the deal (same as approving would). */
function LinkToDeal({ onLinked }: { onLinked: (scId: string, scNo: string) => void | Promise<void> }) {
  const [deals, setDeals] = useState<{ id: string; deal_no: string }[] | null>(null)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    void supabase.from('crm_deals').select('id,deal_no').eq('status', 'approved').is('sales_confirmation_id', null).order('deal_no')
      .then(({ data }) => setDeals((data ?? []) as { id: string; deal_no: string }[]))
  }, [])
  if (!deals || deals.length === 0) return null
  async function link() {
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.rpc('confirm_deal', { p_deal: pick })
    if (error) {
      setBusy(false)
      return setErr(errMessage(error, 'Could not create it from the deal'))
    }
    const { data: row } = await supabase.from('sales_confirmations').select('sc_no').eq('id', data as string).maybeSingle()
    setBusy(false)
    await onLinked(data as string, (row as { sc_no: string } | null)?.sc_no ?? 'Sales Confirmation')
  }
  return (
    <div className="notice">
      <Field id="sc-link" label="Link to Deal (optional)" hint="Fills everything from an Approved deal that has no confirmation yet.">
        <div className="phone-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
          <select id="sc-link" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Not linked: fill in by hand below</option>
            {deals.map((d) => (<option key={d.id} value={d.id}>{d.deal_no}</option>))}
          </select>
          <button className="btn primary" type="button" disabled={!pick || busy} onClick={() => void link()}>{busy ? 'Creating…' : 'Create from deal'}</button>
        </div>
      </Field>
      {err && <p className="field-warn">{err}</p>}
    </div>
  )
}

function CommBox({ label, basis, value, amount, isNew, onBasis, onValue }: {
  label: string
  basis: string
  value: string
  amount: number | null
  isNew: boolean
  onBasis: (v: string) => void
  onValue: (v: string) => void
}) {
  return (
    <div className="comm-box">
      <span className="comm-label">{label}</span>
      <div className="comm-row">
        <select aria-label={`${label} type`} value={basis} onChange={(e) => onBasis(e.target.value)}>
          <option value="">{isNew ? 'From master' : 'None'}</option>
          {COMM_BASES.map((b) => (<option key={b.value} value={b.value}>{b.label}</option>))}
        </select>
        <input aria-label={`${label} value`} className="mono" inputMode="decimal" placeholder={basis === 'pct' ? '%' : '₹'} disabled={!basis} value={value} onChange={(e) => onValue(e.target.value)} />
      </div>
      <span className="comm-amount mono">{basis ? `${commTerms(basis, Number(value) || 0)} = ₹${inr(amount, 0)}` : isNew ? 'Taken from the party master on save' : '—'}</span>
    </div>
  )
}
