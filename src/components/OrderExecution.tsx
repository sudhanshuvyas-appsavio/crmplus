/** Execution panel for an order that is Open for Execution: transportation
 *  (our own or third party), job processes, dispatch entries and payment
 *  tracking. Each block lists what exists and offers a small add form. The
 *  database refuses all of it until the order is open, and refuses a dispatch
 *  that would take the total above the order quantity. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { CloseStatus, CommissionInvoice, JobProcess, Order, OrderAdjustment, OrderDispatch, OrderJobProcess, OrderPayment, OrderTransport, Transporter } from '../api/types'
import { Field } from './PartyForms'
import { errMessage, numOrNull } from '../lib/party'
import { formatDateTime } from '../lib/format'
import { transportTypeLabel, uomLabel } from '../lib/deals'
import { useProfileNames } from './PartyExtras'
import { SubitemDialog, type SubKind } from './SubitemDialog'

const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }))

export function OrderExecution({ order, canManage, jobs, onChanged }: { order: Order; canManage: boolean; jobs: JobProcess[]; onChanged?: () => Promise<void> }) {
  const [transporters, setTransporters] = useState<Transporter[]>([])
  const people = useProfileNames()
  const [trs, setTrs] = useState<OrderTransport[]>([])
  const [ojs, setOjs] = useState<OrderJobProcess[]>([])
  const [dsp, setDsp] = useState<OrderDispatch[]>([])
  const [pays, setPays] = useState<OrderPayment[]>([])
  const [adj, setAdj] = useState<OrderAdjustment[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [inv, setInv] = useState<CommissionInvoice | null>(null)
  const [cs, setCs] = useState<CloseStatus | null>(null)
  const isClosed = order.status === 'closed'
  const manage = canManage && !isClosed

  const load = useCallback(async () => {
    const [a, b, c, d, e, f, g, h] = await Promise.all([
      supabase.from('transporters').select('*').order('name'),
      supabase.from('order_transports').select('*').eq('order_id', order.id).order('created_at'),
      supabase.from('order_job_processes').select('*').eq('order_id', order.id).order('created_at'),
      supabase.from('order_dispatches').select('*').eq('order_id', order.id).order('created_at'),
      supabase.from('order_payments').select('*').eq('order_id', order.id).order('paid_on'),
      supabase.from('commission_invoices').select('*').eq('order_id', order.id).maybeSingle(),
      supabase.rpc('order_close_status', { p_order: order.id }),
      supabase.from('order_dispatch_adjustments').select('*').eq('order_id', order.id).order('created_at'),
    ])
    setAdj((h.data ?? []) as OrderAdjustment[])
    setInv((f.data ?? null) as CommissionInvoice | null)
    setCs((g.data ?? null) as CloseStatus | null)
    setTransporters((a.data ?? []) as Transporter[])
    setTrs((b.data ?? []) as OrderTransport[])
    setOjs((c.data ?? []) as OrderJobProcess[])
    setDsp((d.data ?? []) as OrderDispatch[])
    setPays((e.data ?? []) as OrderPayment[])
  }, [order.id])
  useEffect(() => {
    void load()
  }, [load])

  async function add(table: string, row: Record<string, unknown>) {
    setErr(null)
    const { error } = await supabase.from(table).insert({ order_id: order.id, ...row })
    if (error) {
      setErr(errMessage(error, 'Could not save'))
      return false
    }
    await load()
    if (onChanged) await onChanged()
    return true
  }
  async function remove(table: string, id: string) {
    setErr(null)
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) setErr(errMessage(error, 'Could not delete'))
    else {
      await load()
      if (onChanged) await onChanged()
    }
  }

  async function generateInvoice() {
    setErr(null)
    const { error } = await supabase.rpc('generate_commission_invoice', { p_order: order.id })
    if (error) return setErr(errMessage(error, 'Could not generate the commission invoice'))
    await load()
    if (onChanged) await onChanged()
  }

  async function printInvoice() {
    if (!inv) return
    setErr(null)
    const [b, m, c] = await Promise.all([
      supabase.from('buyer_master').select('name,address,gst').eq('id', order.buyer_id).maybeSingle(),
      supabase.from('supplier_master').select('name').eq('id', order.supplier_id).maybeSingle(),
      supabase.from('companies').select('name').eq('id', order.company_id).maybeSingle(),
    ])
    const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
    const w = window.open('', '_blank', 'width=720,height=900')
    if (!w) return setErr('The print window was blocked by the browser. Allow pop-ups and try again.')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.invoice_no)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:40px;color:#111}h1{font-size:20px;margin:0 0 4px}table{border-collapse:collapse;margin-top:20px;width:100%}td{padding:6px 0;border-bottom:1px solid #ddd}td:first-child{color:#555;width:40%}</style></head><body>
<h1>${esc(c.data?.name ?? 'Commission invoice')}</h1><div>Commission invoice ${esc(inv.invoice_no)}</div>
<table>
<tr><td>Invoice date</td><td>${esc(inv.invoice_date)}</td></tr>
<tr><td>Order</td><td>${esc(order.order_no)}</td></tr>
<tr><td>Bill to (buyer)</td><td>${esc(b.data?.name)}${b.data?.gst ? ' · GST ' + esc(b.data.gst) : ''}</td></tr>
<tr><td>Mill (supplier)</td><td>${esc(m.data?.name)}</td></tr>
<tr><td>Quantity</td><td>${esc(order.quantity)} ${esc(order.uom)}</td></tr>
<tr><td>Commission amount</td><td><strong>${esc(money(inv.amount))}</strong></td></tr>
</table></body></html>`)
    w.document.close()
    w.focus()
    w.print()
    const { error } = await supabase.rpc('log_commission_invoice_print', { p_invoice: inv.id })
    if (error) setErr(errMessage(error, 'The bill printed but the print could not be logged'))
  }

  const trName = (id: string | null) => (id ? transporters.find((t) => t.id === id)?.name ?? '—' : '—')
  const returned = adj.filter((a) => a.kind === 'return').reduce((n, x) => n + x.quantity, 0)
  const cancelled = adj.filter((a) => a.kind === 'cancel').reduce((n, x) => n + x.quantity, 0)
  const dispatched = dsp.reduce((n, x) => n + x.quantity, 0)
  const received = pays.filter((p) => p.kind === 'buyer_receipt').reduce((n, x) => n + x.amount, 0)
  const paidOut = pays.filter((p) => p.kind === 'supplier_payment').reduce((n, x) => n + x.amount, 0)
  const buyerValue = order.buyer_rate * order.quantity
  const supplierValue = order.supplier_rate * order.quantity

  const del = (table: string, id: string) =>
    manage ? <button className="btn ghost sm" type="button" onClick={() => void remove(table, id)}>Remove</button> : null

  // a Return makes the item Fully Dispatch, so nothing is left to send after one
  const left = returned > 0 ? 0 : Math.max(order.quantity - dispatched - cancelled, 0)
  const pct = order.quantity > 0 ? Math.min(100, Math.round((dispatched / order.quantity) * 100)) : 0
  const cancelPct = order.quantity > 0 ? Math.min(100 - pct, Math.round((cancelled / order.quantity) * 100)) : 0
  const [adding, setAdding] = useState<SubKind | null>(null)
  // every entry (dispatch, cancel, return) in the order it was made, as the sub-items of a monday item
  const entries = [
    ...dsp.map((x, i) => ({ at: x.created_at, kind: 'partial' as const, d: x, full: dsp.slice(0, i + 1).reduce((n, y) => n + y.quantity, 0) >= order.quantity })),
    ...adj.map((x) => ({ at: x.created_at, kind: x.kind, a: x })),
  ].sort((p, q) => p.at.localeCompare(q.at))
  const entryFacts = (x: OrderDispatch, tr: OrderTransport | undefined): [string, string | null][] => [
    ['Owner', x.person_id ? people[x.person_id] ?? null : null],
    ['Invoice', x.invoice_no ? `${x.invoice_no}${x.invoice_date ? ` · ${x.invoice_date}` : ''}` : null],
    ['Del Date', x.delivery_date ?? null],
    ['DC No.', x.dc_no ?? null],
    ['Vehicle', x.vehicle_no ?? null],
    ['Transport company', tr ? (tr.kind === 'our' ? 'Our vehicle' : tr.transporter_id ? trName(tr.transporter_id) : 'Third party') : null],
    ['Transport type', x.transport_type ? transportTypeLabel(x.transport_type) : null],
    ['LR No.', x.lr_no ?? null],
    ['Bags weight', order.bag_weight ? money(order.bag_weight) : null],
    ['Total weight', money(x.total_weight)],
    ['Value', money(x.entry_value)],
    ['Buyer commission', x.buyer_commission ? money(x.buyer_commission) : null],
    ['Supplier commission', x.supplier_commission ? money(x.supplier_commission) : null],
    ['CGST %', x.cgst_pct ? money(x.cgst_pct) : null],
    ['Insurance %', x.insurance_pct ? money(x.insurance_pct) : null],
    ['Add', x.add_amount ? money(x.add_amount) : null],
    ['Deduct', x.deduct_amount ? money(x.deduct_amount) : null],
    ['Round off', x.round_off ? money(x.round_off) : null],
    ['Total amount', money(x.total_amount)],
  ]

  return (
    <div className="exec">
      {err && <div className="alert">{err}</div>}
      {adding && <SubitemDialog order={order} kind={adding} onClose={() => setAdding(null)} onDone={async () => { setAdding(null); await load(); if (onChanged) await onChanged() }} />}

      <ExecCard title="Entries" count={entries.length} hint="One row for each partial dispatch, cancel and return of this item.">
        <div className="exec-sum">
          <div><span>Quantity</span><strong className="mono">{money(order.quantity)} {uomLabel(order.uom)}</strong></div>
          <div><span>Dispatched</span><strong className="mono">{money(dispatched)}</strong></div>
          <div><span>Cancelled</span><strong className="mono">{money(cancelled)}</strong></div>
          <div><span>Returned</span><strong className="mono">{money(returned)}</strong></div>
          <div><span>Left</span><strong className="mono">{money(left)}</strong></div>
        </div>
        <div className="exec-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /><b style={{ width: `${cancelPct}%` }} /></div>
        {entries.length === 0 && <p className="muted small">No entries yet.</p>}
        <div className="entry-list">
          {entries.map((e) => {
            if (e.kind === 'partial') {
              const x = e.d
              const tr = x.transport_id ? trs.find((t) => t.id === x.transport_id) : undefined
              const facts = entryFacts(x, tr).filter(([k, v]) => v !== null && v !== '—' && !['Invoice', 'Owner'].includes(k))
              return (
                <details className="entry-row" key={x.id}>
                  <summary>
                    <span className="mono">{x.dispatch_no}</span>
                    <span className={`entry-status ${e.full ? 'full' : 'partial'}`}>{e.full ? 'Fully Dispatch' : 'Partially Dispatch'}</span>
                    <span className="mono">{money(x.quantity)} {uomLabel(order.uom)}</span>
                    <span className="muted small">{x.dispatch_date}{x.invoice_no ? ` · Inv ${x.invoice_no}` : ''}</span>
                  </summary>
                  <div className="exec-facts">
                    {facts.map(([k, v]) => (<div key={k}><span>{k}</span><strong>{v}</strong></div>))}
                  </div>
                  {del('order_dispatches', x.id)}
                </details>
              )
            }
            const x = e.a
            return (
              <details className="entry-row" key={x.id}>
                <summary>
                  <span className="mono">{x.entry_no ?? '—'}</span>
                  <span className={`entry-status ${x.kind}`}>{x.kind === 'cancel' ? 'Cancel' : 'Return'}</span>
                  <span className="mono">{money(x.quantity)} {uomLabel(order.uom)}</span>
                  <span className="muted small">{x.entry_date}{x.invoice_no ? ` · Inv ${x.invoice_no}` : ''}</span>
                </summary>
                <div className="exec-facts">
                  {x.invoice_no && <div><span>Invoice No.</span><strong>{x.invoice_no}</strong></div>}
                  {x.invoice_date && <div><span>Invoice Date</span><strong>{x.invoice_date}</strong></div>}
                  {x.reason && <div><span>Reason</span><strong>{x.reason}</strong></div>}
                </div>
                {del('order_dispatch_adjustments', x.id)}
              </details>
            )
          })}
        </div>
        {manage && (
          <div className="status-pick" role="group" aria-label="Add an entry">
            <button type="button" className="status-opt partial" disabled={left <= 0} title={left <= 0 ? 'Nothing is left to dispatch.' : undefined} onClick={() => setAdding('partial')}>Partially Dispatch</button>
            <button type="button" className="status-opt full" disabled={left <= 0} title={left <= 0 ? 'Nothing is left to dispatch.' : undefined} onClick={() => setAdding('full')}>Fully Dispatch</button>
            <button type="button" className="status-opt cancel" disabled={left <= 0} title={left <= 0 ? 'Nothing is left to cancel.' : undefined} onClick={() => setAdding('cancel')}>Cancel</button>
            <button type="button" className="status-opt return" disabled={dispatched - returned <= 0} title={dispatched - returned <= 0 ? 'Nothing has been dispatched, so there is nothing to return.' : undefined} onClick={() => setAdding('return')}>Return</button>
          </div>
        )}
      </ExecCard>

      <ExecCard title="Closing checklist" hint={`Opened ${order.execution_opened_at ? formatDateTime(order.execution_opened_at) : ''}.${isClosed && order.closed_at ? ` Closed automatically ${formatDateTime(order.closed_at)}.` : ' It closes by itself once all four are done.'}`}>
        {cs && (
          <ul className="exec-check">
            <li className={cs.quantity_done ? 'done' : ''}><i aria-hidden="true">{cs.quantity_done ? '✓' : ''}</i>All quantity dispatched or cancelled <span>{money(cs.dispatched)}{cs.cancelled ? ` + ${money(cs.cancelled)} cancelled` : ''} of {money(cs.quantity)} {order.uom}</span></li>
            <li className={cs.buyer_done ? 'done' : ''}><i aria-hidden="true">{cs.buyer_done ? '✓' : ''}</i>Buyer payment completed <span>{money(cs.buyer_received)} of {money(cs.buyer_value)}</span></li>
            <li className={cs.supplier_done ? 'done' : ''}><i aria-hidden="true">{cs.supplier_done ? '✓' : ''}</i>Supplier payment completed <span>{money(cs.supplier_paid)} of {money(cs.supplier_value)}</span></li>
            <li className={cs.invoice_done ? 'done' : ''}><i aria-hidden="true">{cs.invoice_done ? '✓' : ''}</i>Commission invoice generated <span>{inv ? `${inv.invoice_no}, ${money(inv.amount)}` : ''}</span></li>
          </ul>
        )}
        {inv && <div><button className="btn" type="button" onClick={() => void printInvoice()}>Print commission bill</button></div>}
        {manage && !inv && <div><button className="btn" type="button" onClick={() => void generateInvoice()}>Generate commission invoice</button></div>}
      </ExecCard>

      <ExecCard fold title="Transportation" count={trs.length}>
        {trs.length === 0 ? <p className="muted small">None yet.</p> : (
          <ul className="exec-list">
            {trs.map((t) => (
              <li key={t.id}>
                <span>
                  {[t.kind === 'our' ? 'Our vehicle' : 'Third party', t.transporter_id ? trName(t.transporter_id) : null, t.vehicle_no, t.driver_name, t.freight_amount !== null ? `freight ${money(t.freight_amount)}` : null].filter(Boolean).join(' · ')}
                </span>
                {del('order_transports', t.id)}
              </li>
            ))}
          </ul>
        )}
        {manage && <div className="exec-add"><h4>Add transportation</h4><TransportForm transporters={transporters} onAdd={(r) => add('order_transports', r)} /></div>}
      </ExecCard>

      <ExecCard fold title="Job process" count={ojs.length}>
        {ojs.length === 0 ? <p className="muted small">None yet.</p> : (
          <ul className="exec-list">
            {ojs.map((j) => (
              <li key={j.id}>
                <span>{[jobs.find((x) => x.id === j.job_process_id)?.name ?? '—', j.quantity !== null ? `${money(j.quantity)} ${order.uom}` : null, j.instructions].filter(Boolean).join(' · ')}</span>
                {del('order_job_processes', j.id)}
              </li>
            ))}
          </ul>
        )}
        {manage && <div className="exec-add"><h4>Add job process</h4><JobForm jobs={jobs.filter((j) => j.is_active)} onAdd={(r) => add('order_job_processes', r)} /></div>}
      </ExecCard>

      <ExecCard fold title="Payment tracking">
        {!order.payment_tracking_enabled ? <p className="muted small">Not enabled.</p> : (
          <>
            <div className="exec-facts">
              <div><span>Buyer receipts</span><strong className="mono">{money(received)} of {money(buyerValue)}</strong><em>balance {money(buyerValue - received)}</em></div>
              <div><span>Supplier payments</span><strong className="mono">{money(paidOut)} of {money(supplierValue)}</strong><em>balance {money(supplierValue - paidOut)}</em></div>
            </div>
            <p className="muted small">Values are rate × quantity from the order.</p>
            {pays.length > 0 && (
              <ul className="exec-list">
                {pays.map((p) => (
                  <li key={p.id}>
                    <span>{[p.paid_on, p.kind === 'buyer_receipt' ? 'Received from buyer' : 'Paid to supplier', money(p.amount), p.mode, p.reference].filter(Boolean).join(' · ')}</span>
                    {del('order_payments', p.id)}
                  </li>
                ))}
              </ul>
            )}
            {manage && <div className="exec-add"><h4>Add payment entry</h4><PaymentForm onAdd={(r) => add('order_payments', r)} /></div>}
          </>
        )}
      </ExecCard>
    </div>
  )
}

function ExecCard({ title, hint, count, fold, children }: { title: string; hint?: string; count?: number; fold?: boolean; children: ReactNode }) {
  if (fold) {
    return (
      <details className="fs-card exec-card exec-fold">
        <summary className="fs-head">
          <div><h3>{title}</h3>{hint && <p>{hint}</p>}</div>
          {count !== undefined && <span className="fs-count">{count}</span>}
        </summary>
        <div className="exec-body">{children}</div>
      </details>
    )
  }
  return (
    <section className="fs-card exec-card">
      <div className="fs-head">
        <div><h3>{title}</h3>{hint && <p>{hint}</p>}</div>
        {count !== undefined && <span className="fs-count">{count}</span>}
      </div>
      <div className="exec-body">{children}</div>
    </section>
  )
}

function TransportForm({ transporters, onAdd }: { transporters: Transporter[]; onAdd: (r: Record<string, unknown>) => Promise<boolean> }) {
  const [kind, setKind] = useState<'our' | 'third_party'>('our')
  const [tid, setTid] = useState('')
  const [veh, setVeh] = useState('')
  const [drv, setDrv] = useState('')
  const [fr, setFr] = useState('')
  const list = transporters.filter((t) => (kind === 'our' ? t.transporter_type === 'internal' : t.transporter_type === 'third_party'))
  const ok = kind === 'our' || !!tid
  return (
    <div className="form-grid">
      <Field id="x-tk" label="Transport type">
        <select id="x-tk" value={kind} onChange={(e) => { setKind(e.target.value as 'our' | 'third_party'); setTid('') }}>
          <option value="our">Our transport</option>
          <option value="third_party">Third party</option>
        </select>
      </Field>
      <Field id="x-tt" label={kind === 'our' ? 'Transporter (optional)' : 'Transporter'} required={kind === 'third_party'}>
        <select id="x-tt" value={tid} onChange={(e) => setTid(e.target.value)}>
          <option value="">—</option>
          {list.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
        </select>
      </Field>
      <Field id="x-tv" label="Vehicle no."><input id="x-tv" value={veh} onChange={(e) => setVeh(e.target.value)} /></Field>
      <Field id="x-td" label="Driver"><input id="x-td" value={drv} onChange={(e) => setDrv(e.target.value)} /></Field>
      <Field id="x-tf" label="Freight amount"><input id="x-tf" className="mono" inputMode="decimal" value={fr} onChange={(e) => setFr(e.target.value)} /></Field>
      <button className="btn" type="button" style={{ alignSelf: 'end', justifySelf: 'start' }} disabled={!ok} onClick={() => void onAdd({ kind, transporter_id: tid || null, vehicle_no: veh.trim() || null, driver_name: drv.trim() || null, freight_amount: numOrNull(fr) }).then((d) => { if (d) { setVeh(''); setDrv(''); setFr(''); setTid('') } })}>Add transportation</button>
    </div>
  )
}

function JobForm({ jobs, onAdd }: { jobs: JobProcess[]; onAdd: (r: Record<string, unknown>) => Promise<boolean> }) {
  const [jid, setJid] = useState('')
  const [qty, setQty] = useState('')
  const [ins, setIns] = useState('')
  if (jobs.length === 0) return <p className="muted small">No job processes exist yet. Create one on the Job process screen first.</p>
  return (
    <div className="form-grid">
      <Field id="x-jp" label="Job process" required>
        <select id="x-jp" value={jid} onChange={(e) => setJid(e.target.value)}>
          <option value="">—</option>
          {jobs.map((j) => (<option key={j.id} value={j.id}>{j.name}</option>))}
        </select>
      </Field>
      <Field id="x-jq" label="Quantity"><input id="x-jq" className="mono" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      <Field id="x-ji" label="Instructions"><input id="x-ji" value={ins} onChange={(e) => setIns(e.target.value)} /></Field>
      <button className="btn" type="button" style={{ alignSelf: 'end', justifySelf: 'start' }} disabled={!jid} onClick={() => void onAdd({ job_process_id: jid, quantity: numOrNull(qty), instructions: ins.trim() || null }).then((d) => { if (d) { setJid(''); setQty(''); setIns('') } })}>Add job process</button>
    </div>
  )
}

/** One dispatch entry (a monday subitem). Weight, value, commissions and total
 *  are worked out by the database from the item's rate and commission terms. */
function PaymentForm({ onAdd }: { onAdd: (r: Record<string, unknown>) => Promise<boolean> }) {
  const [kind, setKind] = useState<'buyer_receipt' | 'supplier_payment'>('buyer_receipt')
  const [amt, setAmt] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState('')
  const [ref, setRef] = useState('')
  const a = numOrNull(amt)
  return (
    <div className="form-grid">
      <Field id="x-pk" label="Type">
        <select id="x-pk" value={kind} onChange={(e) => setKind(e.target.value as 'buyer_receipt' | 'supplier_payment')}>
          <option value="buyer_receipt">Received from buyer</option>
          <option value="supplier_payment">Paid to supplier</option>
        </select>
      </Field>
      <Field id="x-pa" label="Amount" required><input id="x-pa" className="mono" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
      <Field id="x-pd" label="Date" required><input id="x-pd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field id="x-pm" label="Mode"><input id="x-pm" placeholder="NEFT, cheque, cash…" value={mode} onChange={(e) => setMode(e.target.value)} /></Field>
      <Field id="x-pr" label="Reference"><input id="x-pr" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <button className="btn" type="button" style={{ alignSelf: 'end', justifySelf: 'start' }} disabled={!date || a === null || a <= 0} onClick={() => void onAdd({ kind, amount: a, paid_on: date, mode: mode.trim() || null, reference: ref.trim() || null }).then((d) => { if (d) { setAmt(''); setMode(''); setRef('') } })}>Add payment entry</button>
    </div>
  )
}