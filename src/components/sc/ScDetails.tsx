/** A Sales Confirmation's details, read-only. Changing it is Actions > Edit (the pop-up form) and moving it
 *  through the pipeline or cancelling it is in the Actions menu too, so this view carries what the form
 *  does not: the send panel, the Dispatch and Billing step, documents and the send history. */

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { CountRow, JobProcess, PaymentTerm, Transporter } from '../../api/types'
import { Drawer } from '../Drawer'
import { StatusPill } from '../board/Board'
import { errMessage, numOrNull } from '../../lib/party'
import { formatDateTime } from '../../lib/format'
import { dispatchStatus, inr, saleTypeLabel, scGroup, scStage } from '../../lib/deals'
import { NotificationLog } from './NotificationLog'
import { SendPanel } from './SendPanel'
import { ScDocuments } from './ScDocuments'
import type { Company, Names, Party, ScRow } from './scShared'
import { CountLinesView, lineFigures, linesText, lineProblems, toLineForm, type LineForm } from '../CountLines'

export function ScDetails({
  sc, canManage, canOrder, items, suppliers, buyers, companies, counts, terms, transporters, jobs, onClose, onEdit, onChanged,
}: {
  sc: ScRow
  canManage: boolean
  canOrder: boolean
  /** Its Dispatch and Billing items (one per count). */
  items: { id: string; order_no: string; dispatch_status: string }[]
  suppliers: Party[]
  buyers: Party[]
  companies: Company[]
  counts: CountRow[]
  terms: PaymentTerm[]
  transporters: Transporter[]
  jobs: JobProcess[]
  onClose: () => void
  onEdit: (sc: ScRow) => void
  onChanged: (message: string, keepOpenId?: string) => void | Promise<void>
}) {
  const navigate = useNavigate()
  const [dealNo, setDealNo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const first: LineForm[] = sc.count_id && sc.quantity !== null
    ? [toLineForm({ count_id: sc.count_id, quantity: sc.quantity, uom: sc.uom, bag_weight: sc.bag_weight, rate: sc.rate })]
    : []
  const [lines, setLines] = useState<LineForm[]>(first)

  useEffect(() => {
    if (!sc.deal_id) return
    void supabase.from('crm_deals').select('deal_no').eq('id', sc.deal_id).maybeSingle().then(({ data }) => setDealNo((data as { deal_no: string } | null)?.deal_no ?? null))
  }, [sc.deal_id])
  useEffect(() => {
    let alive = true
    void supabase.from('sc_lines').select('count_id,quantity,uom,bag_weight,rate').eq('sc_id', sc.id).order('line_no')
      .then(({ data }) => {
        const rows = (data ?? []) as { count_id: string; quantity: number; uom: string; bag_weight: number | null; rate: number | null }[]
        if (alive && rows.length > 0) setLines(rows.map(toLineForm))
      })
    return () => { alive = false }
  }, [sc.id, sc.updated_at])

  const buyerTerms = { basis: sc.buyer_comm_basis, value: sc.buyer_comm_value }
  const supplierTerms = { basis: sc.supplier_comm_basis, value: sc.supplier_comm_value }
  const figs = lines.map((l) => lineFigures(l, buyerTerms, supplierTerms))
  const weight = figs.some((x) => x.weight !== null) ? figs.reduce((a, x) => a + (x.weight ?? 0), 0) : null

  const problems: string[] = []
  if (!sc.supplier_id) problems.push('Supplier')
  if (sc.supplier_id && !sc.supplier_company_id) problems.push('Supplier Business Unit (set it on the supplier in Buyers & Suppliers)')
  if (!sc.buyer_id) problems.push('Buyer')
  if (sc.buyer_id && !sc.buyer_company_id) problems.push('Buyer Business Unit (set it on the buyer in Buyers & Suppliers)')
  problems.push(...lineProblems(lines.length ? lines : [{ count_id: '', quantity: '', uom: 'KG', bag_weight: '', rate: '' }], true))

  const supplier = suppliers.find((x) => x.id === sc.supplier_id)
  const buyer = buyers.find((x) => x.id === sc.buyer_id)
  const transporter = transporters.find((t) => t.id === sc.transporter_id)
  const job = jobs.find((j) => j.id === sc.job_process_id)
  const buyerUnit = companies.find((c) => c.id === (sc.buyer_company_id || buyer?.company_id))
  const supplierUnit = companies.find((c) => c.id === (sc.supplier_company_id || supplier?.company_id))
  const termName = terms.find((t) => t.id === sc.payment_term_id)?.name ?? null
  const cancelled = sc.status === 'cancelled'
  const complete = sc.status === 'confirmed' && problems.length === 0
  const stage = scStage(scGroup(sc))
  const editBlock = !canManage ? 'You need the “Create, edit and send sales confirmations” permission.' : cancelled ? 'A cancelled confirmation cannot be changed.' : items.length > 0 ? 'It is a Dispatch and Billing item now, so it cannot be changed.' : null

  const names: Names = {
    supplier: supplier?.name ?? '',
    buyer: buyer?.name ?? '',
    supplierCompany: companies.find((x) => x.id === sc.supplier_company_id)?.name ?? '',
    buyerCompany: companies.find((x) => x.id === sc.buyer_company_id)?.name ?? '',
    count: counts.find((x) => x.id === lines[0]?.count_id)?.display_name ?? '',
    lines: linesText(lines.filter((l) => l.count_id).map((l) => ({ count_id: l.count_id, quantity: numOrNull(l.quantity) ?? 0, uom: l.uom, bag_weight: numOrNull(l.bag_weight), rate: numOrNull(l.rate) })),
      (id) => counts.find((x) => x.id === id)?.display_name ?? ''),
    term: termName ?? '',
    transporter: transporter?.name ?? '',
    deliveryTo: [job?.name, (sc.delivery_address ?? '').trim()].filter(Boolean).join(', '),
  }

  async function createItem() {
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.rpc('create_dispatch_bill', { p_sc: sc.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not create the Dispatch and Billing item'))
    navigate(`/orders?open=${data as string}`)
  }

  const rows: [string, ReactNode][] = [
    ['Type', saleTypeLabel(sc.sale_type)],
    ['Link to Deals', sc.deal_id ? <Link className="mono" to={`/deals?open=${sc.deal_id}`}>{dealNo ?? 'open'}</Link> : null],
    ['Buyer', buyer?.name ?? null],
    ['Supplier', supplier?.name ?? null],
    ['Payment Terms', termName],
    ['Freight', sc.freight === 'included' ? 'Included' : 'Excluded'],
    ['Delivery Schedule', sc.delivery_schedule],
    ['Sizing/Delivery Address', job?.name ?? sc.delivery_address],
    ['Transporter Name', transporter?.name ?? null],
    ['Vehicle Number', sc.vehicle_no],
    ['Driver Contact Phone', sc.driver_phone],
    ['Total weight', weight === null ? null : `${inr(weight)} kg`],
    ['Remarks', sc.remarks],
    ['Created', formatDateTime(sc.confirmed_at)],
  ]

  return (
    <Drawer title={sc.sc_no} onClose={onClose} footer={
        <div className="drawer-actions">
          <button className="btn" type="button" disabled={!!editBlock} title={editBlock ?? undefined} onClick={() => onEdit(sc)}>Edit</button>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
        </div>
      }>
      <p className="small">
        <StatusPill label={stage.label} tone={stage.tone} />
      </p>
      {err && <div className="alert">{err}</div>}
      {!canManage && <div className="notice small">You can view this confirmation; changing or sending it needs the “Create, edit and send sales confirmations” permission.</div>}
      {sc.status === 'draft' && !cancelled && <div className="notice small">Incomplete: fill in the required fields before it can be sent.</div>}
      {items.length > 0 && (
        <div className="notice small">Converted to Dispatch and Billing ({items.map((i) => i.order_no).join(', ')}); this confirmation can no longer be edited.</div>
      )}

      <dl className="kv">
        {rows.filter(([, v]) => v !== null && v !== '' && v !== undefined).map(([k, v]) => (
          <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
        ))}
      </dl>

      <h3 className="section-title">Counts</h3>
      <CountLinesView lines={lines} counts={counts} buyer={buyerTerms} supplier={supplierTerms} />

      {(buyer || supplier) && (
        <div className="lookup-grid">
          {buyer && <ScParty title="Buyer" p={buyer} unit={buyerUnit} />}
          {supplier && <ScParty title="Supplier" p={supplier} unit={supplierUnit} />}
        </div>
      )}

      {problems.length > 0 && !cancelled && <p className="field-hint">Still needed to send: {problems.join(', ')}.</p>}


      {!cancelled && (
        <div className="notice">
          <h3 className="section-title" style={{ marginTop: 0 }}>Dispatch and Billing</h3>
          {items.length > 0 ? (
            <>
              <ul className="small" style={{ margin: 0 }}>
                {items.map((it) => (
                  <li key={it.id}><Link to={`/orders?open=${it.id}`}><span className="mono">{it.order_no}</span></Link> · {dispatchStatus(it.dispatch_status).label}</li>
                ))}
              </ul>
              {canOrder && sc.status === 'confirmed' && items.length < Math.max(lines.length, 1) && (
                <p>
                  <button className="btn" type="button" disabled={busy} onClick={() => void createItem()}>Create items for the other counts</button>{' '}
                  <span className="small muted">{lines.length - items.length} of {lines.length} counts have no live item.</span>
                </p>
              )}
            </>
          ) : sc.status !== 'confirmed' ? (
            <p className="small muted">Available once the confirmation is complete.</p>
          ) : canOrder ? (
            <p>
              <button className="btn primary" type="button" disabled={busy} onClick={() => void createItem()}>Create Dispatch and Billing</button>{' '}
              <span className="small muted">One item per count, with the parties, rate, commission and delivery details.</span>
            </p>
          ) : (
            <p className="small muted">Creating it needs the “Create and manage orders” permission.</p>
          )}
        </div>
      )}

      {complete && canManage && !cancelled && (
        <SendPanel sc={sc} names={names} supplier={supplier ?? null} buyer={buyer ?? null} onSent={(text) => onChanged(text, sc.id)} />
      )}
      <ScDocuments scId={sc.id} kind="buyer" canEdit={canManage && !cancelled && items.length === 0} />
      <NotificationLog sc={sc} canManage={canManage} />
    </Drawer>
  )
}

/** A party's contact details, as monday's Sales Confirmation board mirrors them from Buyers & Suppliers. */
function ScParty({ title, p, unit }: { title: string; p: Party; unit: { phone_1?: string | null; mobile?: string | null } | undefined }) {
  const unitPhone = unit?.phone_1 || unit?.mobile
  return (
    <div className="lookup">
      <h4>{title}: {p.name}</h4>
      <dl className="kv">
        <dt>Office address</dt><dd>{p.address || '—'}</dd>
        <dt>Office phone</dt><dd>{p.office_phone ? `+91 ${p.office_phone}` : '—'}</dd>
        <dt>GST</dt><dd className="mono">{p.gst || '—'}</dd>
        <dt>Business unit phone</dt><dd>{unitPhone ? (unitPhone.startsWith('+') ? unitPhone : `+91 ${unitPhone}`) : '—'}</dd>
      </dl>
    </div>
  )
}
