/** Dispatch and Billing pop-up, arranged like monday's Dispatch & Billing Creation Form and built like the
 *  Lead, Deal and Sales Confirmation pop-ups (Pharama ERP conventions): titled group cards, three fields
 *  per row, system values read-only, `--None--` for dropdowns, an error under each wrong field.
 *
 *  monday's groups: Buyer & Supplier Details (Bags Weight, Final Rate), Product Configurations (UOM,
 *  Quantity), Cost Details (Add, Deduct, Insurance Tax, Round off), Transporter Type Details, Documents.
 *  Two cards are added because this app needs them: "Sales Confirmation Details" (an item is made from a
 *  complete Sales Confirmation, one item per count, so the party, counts, rate and commission are copied
 *  and read-only here) and "Billing" / "Transport and Delivery" (invoice, CGST and the transport details
 *  the item has always carried).
 *
 *  Create ("+ New item"): pick the Sales Confirmation, set what you like, and the items are made.
 *  Update (row Actions > Edit): monday's "Select Item to Update" card first. Closed and cancelled items
 *  cannot be changed. Starting dispatch and cancelling an item are in the row's Actions menu. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CountRow, JobProcess, Order, Transporter } from '../api/types'
import { TRANSPORT_TYPES, dispatchStatus, inr, rateText, totalAmount, uomLabel } from '../lib/deals'
import { errMessage, numOrNull } from '../lib/party'
import { formatDateTime } from '../lib/format'
import { Modal } from './Modal'
import { Field, FieldErrorsProvider } from './PartyForms'
import { ErrorBanner, FormSection, FullWidth } from './FormKit'
import { OrderDocuments, uploadOrderFiles } from './OrderDocuments'
import { ComboInput } from './ComboInput'
import { PendingFilesCard } from './DocumentsCard'
import { OrderExecution } from './OrderExecution'

type Named = { id: string; name: string }
type Sc = { id: string; sc_no: string; confirmed_at: string; buyer_id: string | null; supplier_id: string | null }
type Line = { id: string; sc_id: string; line_no: number; count_id: string; quantity: number; uom: string; bag_weight: number | null; rate: number | null }

type Form = {
  sr_no: string
  invoice_no: string
  invoice_date: string
  cgst_pct: string
  insurance_pct: string
  add_amount: string
  deduct_amount: string
  round_off: string
  transport_type: string
  transporter_id: string
  vehicle_no: string
  driver_phone: string
  person_id: string
  tentative_dispatch_date: string
  delivery_schedule: string
  special_instructions: string
  job_process_id: string
  alt_delivery_address: string
}

const s = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

function toForm(o: Order | null): Form {
  return {
    sr_no: o?.sr_no ?? '',
    invoice_no: o?.invoice_no ?? '',
    invoice_date: o?.invoice_date ?? '',
    cgst_pct: s(o?.cgst_pct),
    insurance_pct: s(o?.insurance_pct),
    add_amount: s(o?.add_amount),
    deduct_amount: s(o?.deduct_amount),
    round_off: s(o?.round_off),
    transport_type: o?.transport_type ?? '',
    transporter_id: o?.transporter_id ?? '',
    vehicle_no: o?.vehicle_no ?? '',
    driver_phone: o?.driver_phone ?? '',
    person_id: o?.person_id ?? '',
    tentative_dispatch_date: o?.tentative_dispatch_date ?? '',
    delivery_schedule: o?.delivery_schedule ?? '',
    special_instructions: o?.special_instructions ?? '',
    job_process_id: o?.job_process_id ?? '',
    alt_delivery_address: o?.alt_delivery_address ?? '',
  }
}

/** Errors that are worth showing while the person types. */
const LIVE = new Set(['o-cgst', 'o-ins', 'o-add', 'o-ded', 'o-round', 'o-drv'])

function errorsOf(f: Form): Record<string, string> {
  const e: Record<string, string> = {}
  const num = (v: string) => numOrNull(v)
  if (f.cgst_pct.trim()) { const n = num(f.cgst_pct); if (n === null || n < 0 || n > 100) e['o-cgst'] = 'CGST is a percentage from 0 to 100.' }
  if (f.insurance_pct.trim()) { const n = num(f.insurance_pct); if (n === null || n < 0 || n > 100) e['o-ins'] = 'Insurance Tax is a percentage from 0 to 100.' }
  if (f.add_amount.trim()) { const n = num(f.add_amount); if (n === null || n < 0) e['o-add'] = 'Add is a number, zero or more.' }
  if (f.deduct_amount.trim()) { const n = num(f.deduct_amount); if (n === null || n < 0) e['o-ded'] = 'Deduct is a number, zero or more.' }
  if (f.round_off.trim() && num(f.round_off) === null) e['o-round'] = 'Round off is a number.'
  if (f.driver_phone.trim() && !/^[0-9+ -]{6,20}$/.test(f.driver_phone.trim())) e['o-drv'] = 'Digits only (6 to 20 characters).'
  return e
}

export function OrderFormModal({
  orders, lockedIds, scNos, buyerName, supplierName, countName, counts, jobs, transporters, people, initialOrder, onClose, onDone, onRefresh, readOnly = false, onEdit,
}: {
  orders: Order[]
  /** Items that can no longer be changed (closed or cancelled): not offered for update. */
  lockedIds: Set<string>
  scNos: Map<string, string>
  buyerName: Map<string, string>
  supplierName: Map<string, string>
  countName: Map<string, string>
  counts: CountRow[]
  jobs: JobProcess[]
  transporters: Transporter[]
  people: Named[]
  /** Opened from a row's Actions > Edit. Absent for a new item. */
  initialOrder?: Order | null
  /** Reloads the board after an entry, payment or transport record is added here. */
  onRefresh?: () => Promise<void>
  /** View details: the same form, locked. */
  readOnly?: boolean
  /** From the locked view: open the item for editing. */
  onEdit?: (order: Order) => void
  onClose: () => void
  onDone: (message: string, openId?: string) => void | Promise<void>
}) {
  const updating = Boolean(initialOrder)
  const [recordId, setRecordId] = useState(initialOrder?.id ?? '')
  const [recordText, setRecordText] = useState(initialOrder?.order_no ?? '')
  const [f, setF] = useState<Form>(() => toForm(initialOrder ?? null))
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // create: the Sales Confirmations that still have counts without a live item
  const [scs, setScs] = useState<Sc[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [withItem, setWithItem] = useState<Set<string>>(new Set())
  const [pick, setPick] = useState('')
  useEffect(() => {
    if (updating) return
    let alive = true
    void (async () => {
      const [a, b, c] = await Promise.all([
        supabase.from('sales_confirmations').select('id,sc_no,confirmed_at,buyer_id,supplier_id').eq('status', 'confirmed').eq('stage', 'send_delivery').order('confirmed_at', { ascending: false }),
        supabase.from('sc_lines').select('id,sc_id,line_no,count_id,quantity,uom,bag_weight,rate').order('line_no'),
        supabase.from('orders').select('sc_line_id').neq('status', 'cancelled').not('sc_line_id', 'is', null),
      ])
      if (!alive) return
      setScs((a.data ?? []) as Sc[])
      setLines((b.data ?? []) as Line[])
      setWithItem(new Set(((c.data ?? []) as { sc_line_id: string }[]).map((x) => x.sc_line_id)))
    })()
    return () => { alive = false }
  }, [updating])

  const open = scs.filter((x) => lines.some((l) => l.sc_id === x.id && !withItem.has(l.id)))
  const chosenSc = open.find((x) => x.id === pick) ?? null
  const todo = chosenSc ? lines.filter((l) => l.sc_id === chosenSc.id && !withItem.has(l.id)) : []
  const single = todo.length === 1 ? todo[0]! : null
  const missingRate = todo.some((l) => l.rate === null)

  const editable = useMemo(() => orders.filter((o) => !lockedIds.has(o.id)), [orders, lockedIds])
  const current = orders.find((o) => o.id === recordId) ?? initialOrder ?? null

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  function chooseRecord(text: string) {
    setRecordText(text)
    const hit = editable.find((o) => o.order_no === text)
    if (!hit) { setRecordId(''); return }
    setRecordId(hit.id)
    setF(toForm(hit))
    setSubmitted(false)
    setError(null)
  }
  function pickJob(id: string) {
    const j = jobs.find((x) => x.id === id)
    setF((p) => ({ ...p, job_process_id: id, alt_delivery_address: j ? j.delivery_address || j.office_address || '' : '' }))
  }

  const errors = useMemo(() => ({
    ...errorsOf(f),
    ...(updating && !recordId ? { 'o-record': 'Choose the item to update.' } : {}),
    ...(!updating && !pick ? { 'o-sc': 'Choose the Sales Confirmation the item is made from.' } : {}),
    ...(!updating && pick && missingRate ? { 'o-sc': 'Every count needs a rate on the Sales Confirmation before its item can be created.' } : {}),
  }), [f, updating, recordId, pick, missingRate])
  const visible = useMemo(() => Object.fromEntries(Object.entries(errors).filter(([id]) => submitted || LIVE.has(id))), [errors, submitted])

  const cgst = numOrNull(f.cgst_pct)
  const ins = numOrNull(f.insurance_pct)
  const add = numOrNull(f.add_amount)
  const ded = numOrNull(f.deduct_amount)
  const round = numOrNull(f.round_off)
  const value = current?.order_value ?? null
  const total = totalAmount(value, cgst, ins, add, ded)

  const payload = () => ({
    sr_no: f.sr_no.trim() || null,
    invoice_no: f.invoice_no.trim() || null,
    invoice_date: f.invoice_date || null,
    cgst_pct: cgst,
    insurance_pct: ins,
    add_amount: add,
    deduct_amount: ded,
    round_off: round,
    transport_type: f.transport_type || null,
    transporter_id: f.transporter_id || null,
    vehicle_no: f.vehicle_no.trim() || null,
    driver_phone: f.driver_phone.trim() || null,
    person_id: f.person_id || null,
    tentative_dispatch_date: f.tentative_dispatch_date || null,
    delivery_schedule: f.delivery_schedule.trim() || null,
    special_instructions: f.special_instructions.trim() || null,
    job_process_id: f.job_process_id || null,
    alt_delivery_address: f.alt_delivery_address.trim() || null,
  })

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
    if (updating) {
      const o = current!
      const { data, error: saveError } = await supabase.from('orders').update(payload()).eq('id', o.id).select('id')
      setBusy(false)
      if (saveError) return setError(errMessage(saveError, 'Could not save this item'))
      if (!data || data.length === 0) return setError('Your account cannot change this item.')
      await onDone(`${o.order_no} updated.`, o.id)
      return
    }
    // create: the database makes one item per count that has none yet; then what was filled in is applied
    const before = await supabase.from('orders').select('id').eq('sales_confirmation_id', chosenSc!.id)
    const known = new Set(((before.data ?? []) as { id: string }[]).map((x) => x.id))
    const made = await supabase.rpc('create_dispatch_bill', { p_sc: chosenSc!.id })
    if (made.error) {
      setBusy(false)
      return setError(errMessage(made.error, 'Could not create the Dispatch and Billing items'))
    }
    const after = await supabase.from('orders').select('id,order_no').eq('sales_confirmation_id', chosenSc!.id).order('created_at')
    const fresh = ((after.data ?? []) as { id: string; order_no: string }[]).filter((x) => !known.has(x.id))
    // cost details belong to one item; with several counts they are added per item from Edit
    const common = { transport_type: f.transport_type || null }
    const costs = fresh.length === 1
      ? { cgst_pct: cgst, insurance_pct: ins, add_amount: add, deduct_amount: ded, round_off: round }
      : {}
    const patch = { ...common, ...costs }
    const problems: string[] = []
    if (Object.values(patch).some((v) => v !== null)) {
      for (const x of fresh) {
        const up = await supabase.from('orders').update(patch).eq('id', x.id).select('id')
        if (up.error) problems.push(`${x.order_no}: ${errMessage(up.error, 'details not saved')}`)
      }
    }
    if (pendingFiles.length > 0 && fresh[0]) problems.push(...await uploadOrderFiles(fresh[0].id, pendingFiles))
    setBusy(false)
    const openId = (made.data as string) || fresh[0]?.id
    await onDone(
      `${chosenSc!.sc_no}: ${fresh.length} Dispatch and Billing item${fresh.length === 1 ? '' : 's'} created${fresh.length > 0 ? ` (${fresh.map((x) => x.order_no).join(', ')})` : ''}.${problems.length > 0 ? ` Not saved: ${problems.join('; ')}.` : ''}`,
      openId,
    )
  }

  const show = updating ? Boolean(recordId) : true
  const costsLocked = !updating && todo.length > 1
  const line1 = single
  const cr = current
  const bagText = updating ? s(cr?.bag_weight) : s(line1?.bag_weight)
  const rateTextVal = updating ? (cr?.final_rate == null ? '' : rateText(cr.final_rate)) : line1?.rate == null ? '' : rateText(line1.rate)
  const uomVal = updating ? (cr ? uomLabel(cr.uom) : '') : line1 ? uomLabel(line1.uom) : ''
  const qtyVal = updating ? s(cr?.quantity) : s(line1?.quantity)
  const buyerVal = updating ? buyerName.get(cr?.buyer_id ?? '') ?? '' : chosenSc ? buyerName.get(chosenSc.buyer_id ?? '') ?? '' : ''
  const supplierVal = updating ? supplierName.get(cr?.supplier_id ?? '') ?? '' : chosenSc ? supplierName.get(chosenSc.supplier_id ?? '') ?? '' : ''
  const perCount = !updating && todo.length > 1 ? 'Per count (see the list above)' : ''
  const canEditIt = !cr || (cr.status !== 'closed' && cr.status !== 'cancelled')
  /** Fully Dispatch is the end of an item: it is locked, and only a Return entry can be added or removed. */
  const fdLocked = updating && !!cr && cr.status !== 'cancelled' && (cr.dispatch_status === 'fully_dispatched' || cr.dispatch_status === 'returned')

  async function startDispatch() {
    if (!current) return
    setBusy(true)
    setError(null)
    const { data, error: e } = await supabase.from('orders').update({ status: 'open_for_execution' }).eq('id', current.id).select('id')
    setBusy(false)
    if (e || !data || data.length === 0) return setError(e ? errMessage(e, 'Could not start dispatch') : 'Your account cannot change this item.')
    if (onRefresh) await onRefresh()
  }

  return (
    <Modal
      title={readOnly ? 'View Dispatch and Billing' : updating ? 'Update Dispatch and Billing' : 'New Dispatch and Billing'}
      description={readOnly ? undefined : updating ? 'Choose the item, then change what you need. It keeps its number and creation date.' : 'Required fields are marked.'}
      size="lg"
      onClose={onClose}
      footer={readOnly ? (
        <>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
          <button className="btn primary" type="button" disabled={!cr || !canEditIt} title={!canEditIt ? 'This item can no longer be changed.' : undefined} onClick={() => cr && onEdit?.(cr)}>Edit</button>
        </>
      ) : (
        <>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
          <span style={{ display: 'flex', gap: 10 }}>
            {!updating && (
              <button className="btn ghost" type="button" disabled={busy} onClick={() => { setF(toForm(null)); setPick(''); setPendingFiles([]); setSubmitted(false); setError(null) }}>Clear Form</button>
            )}
            <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || fdLocked} title={fdLocked ? 'Fully Dispatch: the item is locked. Only a Return entry can be added.' : undefined}>
              {busy ? 'Saving…' : updating ? 'Update Item' : `Create ${todo.length > 1 ? `${todo.length} Items` : 'Item'}`}
            </button>
          </span>
        </>
      )
      }
    >
      <ErrorBanner message={error} />
      {fdLocked && !readOnly && (
        <div className="notice small" role="status" style={{ marginBottom: 12 }}>
          This item is Fully Dispatch, so it is locked. Only a Return entry can be added (or removed) under Dispatch entries below.
        </div>
      )}

      {updating && !readOnly && (
        <FieldErrorsProvider value={visible}>
          <section className="fs-card" aria-label="Select Item to Update">
            <header className="fs-head"><div><h3>Select Item to Update:</h3></div></header>
            <div className="fs-body">
              <Field id="o-record" label="Search for a record">
                <ComboInput id="o-record" placeholder="-- Search for a record --" value={recordText} onChange={chooseRecord} options={editable.map((o) => o.order_no)} style={{ maxWidth: 520 }} />
              </Field>
            </div>
          </section>
        </FieldErrorsProvider>
      )}

      {show && (
        <FieldErrorsProvider value={visible}>
          <fieldset className="ro-fieldset" disabled={readOnly || fdLocked}>
          {!updating && (
            <FormSection title="Sales Confirmation Details" collapsible columns={3}>
              <div className="fs-span-2">
                <Field id="o-sc" label="Sales Confirmation" required>
                  <select id="o-sc" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">--None--</option>
                    {open.map((x) => (
                      <option key={x.id} value={x.id}>{x.sc_no} · {buyerName.get(x.buyer_id ?? '') ?? '—'} · {formatDateTime(x.confirmed_at)}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <FullWidth>
                <p className="muted small" style={{ marginTop: 0 }}>
                  {open.length === 0
                    ? 'No Sales Confirmation is waiting: one in Send with Delivery Info gets its items automatically, and every other one has them already.'
                    : 'Only Sales Confirmations in Send with Delivery Info are listed: a confirmation goes to Dispatch and Billing only from that stage.'}
                </p>
              </FullWidth>
              {chosenSc && (
                <FullWidth>
                  <div className="table-wrap lines-wrap">
                    <table className="lines-table">
                      <thead><tr><th>#</th><th>Count</th><th className="right">Quantity</th><th className="right">Final Rate (₹/kg)</th><th>Dispatch and Billing</th></tr></thead>
                      <tbody>
                        {lines.filter((l) => l.sc_id === chosenSc.id).map((l) => (
                          <tr key={l.id}>
                            <td className="muted small">{l.line_no}</td>
                            <td className="small">{countName.get(l.count_id) ?? '—'}</td>
                            <td className="right mono small">{inr(l.quantity)} {uomLabel(l.uom)}</td>
                            <td className="right mono small">{rateText(l.rate)}</td>
                            <td className="small">{withItem.has(l.id) ? <span className="muted">has an item</span> : <strong>will be created</strong>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </FullWidth>
              )}
            </FormSection>
          )}

          <FormSection title="Dispatch & Billing Details" collapsible columns={3}>
            {updating && (
              <>
              <Field id="o-no" label="Name" required><input id="o-no" readOnly value={cr?.order_no ?? ''} placeholder="Assigned on save" /></Field>
              <Field id="o-created" label="Created Date"><input id="o-created" readOnly value={cr ? formatDateTime(cr.created_at) : ''} /></Field>
              <Field id="o-status" label="Status"><input id="o-status" readOnly value={cr ? dispatchStatus(cr.dispatch_status).label : ''} title="Starting dispatch and cancelling are in the row's Actions menu." /></Field>
              <Field id="o-cgst" label="CGST"><input id="o-cgst" className="mono" inputMode="decimal" placeholder="Enter CGST" value={f.cgst_pct} onChange={(e) => set('cgst_pct', e.target.value)} /></Field>
              <Field id="o-date" label="Dispatch Date"><input id="o-date" type="date" value={f.tentative_dispatch_date} onChange={(e) => set('tentative_dispatch_date', e.target.value)} /></Field>
              </>
            )}
            <Field id="o-tt" label="Transport Type">
              <select id="o-tt" value={f.transport_type} onChange={(e) => set('transport_type', e.target.value)}>
                <option value="">--None--</option>
                {TRANSPORT_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </Field>
            {updating && (
              <>
              <Field id="o-inv" label="Invoice No."><input id="o-inv" className="mono" placeholder="Enter Invoice No." value={f.invoice_no} onChange={(e) => set('invoice_no', e.target.value)} /></Field>
              <Field id="o-invd" label="Invoice Date"><input id="o-invd" type="date" value={f.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} /></Field>
              </>
            )}
          </FormSection>

          <FormSection title="Buyer & Supplier Details" collapsible columns={3}>
            <Field id="o-bag" label="Bags Weight"><input id="o-bag" readOnly value={perCount || bagText} placeholder="From the Sales Confirmation" /></Field>
            <Field id="o-rate" label="Final Rate"><input id="o-rate" readOnly value={perCount || rateTextVal} placeholder="From the Sales Confirmation" /></Field>
            <Field id="o-buyer" label="Buyer"><input id="o-buyer" readOnly value={buyerVal} placeholder="From the Sales Confirmation" /></Field>
            <Field id="o-supplier" label="Supplier"><input id="o-supplier" readOnly value={supplierVal} placeholder="From the Sales Confirmation" /></Field>
          </FormSection>

          <FormSection title="Product Configurations" collapsible columns={3}>
            <Field id="o-uom" label="UOM"><input id="o-uom" readOnly value={perCount || uomVal} placeholder="From the Sales Confirmation" /></Field>
            <Field id="o-qty" label="Quantity"><input id="o-qty" readOnly value={perCount || qtyVal} placeholder="From the Sales Confirmation" /></Field>
            {updating && (
              <Field id="o-count" label="Counts"><input id="o-count" readOnly value={countName.get(cr?.count_id ?? '') ?? counts.find((c) => c.id === cr?.count_id)?.display_name ?? ''} /></Field>
            )}
          </FormSection>

          <FormSection title="Cost Details" collapsible columns={3}>
            <Field id="o-add" label="Add">
              <input id="o-add" className="mono" inputMode="decimal" placeholder="Enter Add" disabled={costsLocked} title={costsLocked ? 'With several counts, add these per item from Actions > Edit.' : undefined} value={f.add_amount} onChange={(e) => set('add_amount', e.target.value)} />
            </Field>
            <Field id="o-ded" label="Deduct">
              <input id="o-ded" className="mono" inputMode="decimal" placeholder="Enter Deduct" disabled={costsLocked} title={costsLocked ? 'With several counts, add these per item from Actions > Edit.' : undefined} value={f.deduct_amount} onChange={(e) => set('deduct_amount', e.target.value)} />
            </Field>
            <Field id="o-ins" label="Insurance Tax">
              <input id="o-ins" className="mono" inputMode="decimal" placeholder="Enter Insurance Tax" disabled={costsLocked} title={costsLocked ? 'With several counts, add these per item from Actions > Edit.' : undefined} value={f.insurance_pct} onChange={(e) => set('insurance_pct', e.target.value)} />
            </Field>
            <Field id="o-round" label="Round off">
              <input id="o-round" className="mono" inputMode="decimal" placeholder="Enter Round off" disabled={costsLocked} title={costsLocked ? 'With several counts, add these per item from Actions > Edit.' : undefined} value={f.round_off} onChange={(e) => set('round_off', e.target.value)} />
            </Field>
            {updating && (
              <Field id="o-total" label="Total Amount">
                <input id="o-total" readOnly className="mono" value={total === null ? '' : `₹${inr(total, 2)}`} title="Value plus CGST and Insurance Tax, plus Add, less Deduct." />
              </Field>
            )}
          </FormSection>

          {updating && (
            <FormSection title="Transport Company Details" collapsible columns={3}>
              <Field id="o-tr" label="Transporter Name">
                <select id="o-tr" value={f.transporter_id} onChange={(e) => set('transporter_id', e.target.value)}>
                  <option value="">--None--</option>
                  {transporters.filter((t) => t.is_active || t.id === f.transporter_id).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                </select>
              </Field>
              <Field id="o-veh" label="Vehicle Number"><input id="o-veh" className="mono" placeholder="Enter Vehicle Number" value={f.vehicle_no} onChange={(e) => set('vehicle_no', e.target.value.toUpperCase())} /></Field>
              <Field id="o-drv" label="Driver Contact Phone"><input id="o-drv" inputMode="tel" placeholder="Driver Contact Phone number" value={f.driver_phone} onChange={(e) => set('driver_phone', e.target.value)} /></Field>
            </FormSection>
          )}

          {updating && (
            <FormSection title="Orders Details" collapsible columns={3}>
              <Field id="o-scno" label="Sales Confirmation"><input id="o-scno" readOnly value={cr ? scNos.get(cr.sales_confirmation_id) ?? '' : ''} /></Field>
              <Field id="o-person" label="Person">
                <select id="o-person" value={f.person_id} onChange={(e) => set('person_id', e.target.value)}>
                  <option value="">--None--</option>
                  {people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </select>
              </Field>
              <Field id="o-sr" label="Sr. No"><input id="o-sr" value={f.sr_no} placeholder="Enter Sr. No" onChange={(e) => set('sr_no', e.target.value)} /></Field>
              <Field id="o-job" label="Sizing/Delivery Address">
                <select id="o-job" value={f.job_process_id} title="--None-- means the buyer's own address." onChange={(e) => pickJob(e.target.value)}>
                  <option value="">--None--</option>
                  {jobs.filter((j) => j.is_active || j.id === f.job_process_id).map((j) => (<option key={j.id} value={j.id}>{j.name}</option>))}
                </select>
              </Field>
              <div className="fs-span-2">
                <Field id="o-sched" label="Delivery Schedule"><textarea id="o-sched" rows={2} placeholder="Enter Delivery Schedule" value={f.delivery_schedule} onChange={(e) => set('delivery_schedule', e.target.value)} /></Field>
              </div>
            </FormSection>
          )}

          {updating && (
            <FormSection title="Remarks" collapsible columns={3}>
              <div className="fs-span-2">
                <Field id="o-instr" label="Remark 1"><textarea id="o-instr" rows={2} placeholder="Enter Remark 1" value={f.special_instructions} onChange={(e) => set('special_instructions', e.target.value)} /></Field>
              </div>
            </FormSection>
          )}

          </fieldset>

          {updating && !readOnly && current && (current.status === 'draft' || current.status === 'confirmed') && (
            <FormSection title="Dispatch" collapsible columns={3}>
              <FullWidth>
                <p className="muted small">Start dispatch to move the item to In Progress. Then its entries (partial dispatch, fully dispatch, cancel, return) and the commission invoice can be added here.</p>
                <button className="btn" type="button" disabled={busy} onClick={() => void startDispatch()}>Start dispatch</button>
              </FullWidth>
            </FormSection>
          )}

          {updating && current && (current.status === 'open_for_execution' || current.status === 'closed') && (
            <FormSection title="Dispatch entries and commission invoice" collapsible columns={3}>
              <FullWidth>
                <OrderExecution order={current} canManage={!readOnly} onChanged={async () => { if (onRefresh) await onRefresh() }} />
              </FullWidth>
            </FormSection>
          )}

          <FormSection title="Documents" collapsible columns={3}>
            <FullWidth>
              <Field id="o-docs" label="Documents" hideLabel>
                {updating ? (
                  recordId ? <div><OrderDocuments orderId={recordId} canEdit={!readOnly} hideTitle /></div> : null
                ) : (
                  <PendingFilesCard files={pendingFiles} onChange={setPendingFiles} id="o-docs" note="The files are attached when the item is created (to the first item if there are several)." />
                )}
              </Field>
            </FullWidth>
          </FormSection>
        </FieldErrorsProvider>
      )}
    </Modal>
  )
}
