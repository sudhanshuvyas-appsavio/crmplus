/** Execution panel for an order that is Open for Execution: transportation
 *  (our own or third party), job processes, dispatch entries and payment
 *  tracking. Each block lists what exists and offers a small add form. The
 *  database refuses all of it until the order is open, and refuses a dispatch
 *  that would take the total above the order quantity. */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CloseStatus, CommissionInvoice, JobProcess, Order, OrderDispatch, OrderJobProcess, OrderPayment, OrderTransport, Transporter } from '../api/types'
import { Field } from './PartyForms'
import { errMessage, numOrNull } from '../lib/party'
import { formatDateTime } from '../lib/format'

const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }))

export function OrderExecution({ order, canManage, jobs, onChanged }: { order: Order; canManage: boolean; jobs: JobProcess[]; onChanged?: () => Promise<void> }) {
  const [transporters, setTransporters] = useState<Transporter[]>([])
  const [trs, setTrs] = useState<OrderTransport[]>([])
  const [ojs, setOjs] = useState<OrderJobProcess[]>([])
  const [dsp, setDsp] = useState<OrderDispatch[]>([])
  const [pays, setPays] = useState<OrderPayment[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [inv, setInv] = useState<CommissionInvoice | null>(null)
  const [cs, setCs] = useState<CloseStatus | null>(null)
  const isClosed = order.status === 'closed'
  const manage = canManage && !isClosed

  const load = useCallback(async () => {
    const [a, b, c, d, e, f, g] = await Promise.all([
      supabase.from('transporters').select('*').order('name'),
      supabase.from('order_transports').select('*').eq('order_id', order.id).order('created_at'),
      supabase.from('order_job_processes').select('*').eq('order_id', order.id).order('created_at'),
      supabase.from('order_dispatches').select('*').eq('order_id', order.id).order('created_at'),
      supabase.from('order_payments').select('*').eq('order_id', order.id).order('paid_on'),
      supabase.from('commission_invoices').select('*').eq('order_id', order.id).maybeSingle(),
      supabase.rpc('order_close_status', { p_order: order.id }),
    ])
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
  const dispatched = dsp.reduce((n, x) => n + x.quantity, 0)
  const received = pays.filter((p) => p.kind === 'buyer_receipt').reduce((n, x) => n + x.amount, 0)
  const paidOut = pays.filter((p) => p.kind === 'supplier_payment').reduce((n, x) => n + x.amount, 0)
  const buyerValue = order.buyer_rate * order.quantity
  const supplierValue = order.supplier_rate * order.quantity

  const del = (table: string, id: string) =>
    manage ? <button className="btn ghost sm" type="button" onClick={() => void remove(table, id)}>Remove</button> : null

  return (
    <div className="notice">
      <h3 className="section-title">Execution</h3>
      <p className="small">Opened {order.execution_opened_at ? formatDateTime(order.execution_opened_at) : ''}.{isClosed && order.closed_at ? ` Closed automatically ${formatDateTime(order.closed_at)}.` : ''}</p>
      {err && <div className="alert">{err}</div>}

      <h4>Closing checklist</h4>
      {cs && (
        <ul className="small" style={{ margin: 0, listStyle: 'none', padding: 0 }}>
          <li>{cs.quantity_done ? '✓' : '○'} 100% quantity dispatched ({money(cs.dispatched)} of {money(cs.quantity)} {order.uom})</li>
          <li>{cs.buyer_done ? '✓' : '○'} Buyer payment completed ({money(cs.buyer_received)} of {money(cs.buyer_value)})</li>
          <li>{cs.supplier_done ? '✓' : '○'} Supplier payment completed ({money(cs.supplier_paid)} of {money(cs.supplier_value)})</li>
          <li>{cs.invoice_done ? '✓' : '○'} Commission invoice generated{inv ? ` (${inv.invoice_no}, ${money(inv.amount)})` : ''}</li>
        </ul>
      )}
      {!isClosed && <p className="muted small">The order closes by itself as soon as all four are done.</p>}
      {inv && <p><button className="btn" type="button" onClick={() => void printInvoice()}>Print commission bill</button></p>}
      {manage && !inv && (
        <p><button className="btn" type="button" onClick={() => void generateInvoice()}>Generate commission invoice</button></p>
      )}

      <h4>Transportation</h4>
      {trs.length === 0 ? <p className="muted small">None yet.</p> : (
        <ul className="small" style={{ margin: 0 }}>
          {trs.map((t) => (
            <li key={t.id}>
              {t.kind === 'our' ? 'Our vehicle' : 'Third party'}{t.transporter_id ? ` · ${trName(t.transporter_id)}` : ''}{t.vehicle_no ? ` · ${t.vehicle_no}` : ''}
              {t.driver_name ? ` · ${t.driver_name}` : ''}{t.freight_amount !== null ? ` · freight ${money(t.freight_amount)}` : ''} {del('order_transports', t.id)}
            </li>
          ))}
        </ul>
      )}
      {manage && <TransportForm transporters={transporters} onAdd={(r) => add('order_transports', r)} />}

      <h4>Job process</h4>
      {ojs.length === 0 ? <p className="muted small">None yet.</p> : (
        <ul className="small" style={{ margin: 0 }}>
          {ojs.map((j) => (
            <li key={j.id}>{jobs.find((x) => x.id === j.job_process_id)?.name ?? '—'}{j.quantity !== null ? ` · ${money(j.quantity)} ${order.uom}` : ''}{j.instructions ? ` · ${j.instructions}` : ''} {del('order_job_processes', j.id)}</li>
          ))}
        </ul>
      )}
      {manage && <JobForm jobs={jobs.filter((j) => j.is_active)} onAdd={(r) => add('order_job_processes', r)} />}

      <h4>Dispatch entries</h4>
      <p className="small">Dispatched {money(dispatched)} of {money(order.quantity)} {order.uom}.</p>
      {dsp.length > 0 && (
        <ul className="small" style={{ margin: 0 }}>
          {dsp.map((x) => (
            <li key={x.id}>
              <span className="mono">{x.dispatch_no}</span> · {x.dispatch_date} · {money(x.quantity)} {order.uom}{x.vehicle_no ? ` · ${x.vehicle_no}` : ''}
              {x.lr_no ? ` · LR ${x.lr_no}` : ''}{x.invoice_no ? ` · Inv ${x.invoice_no}` : ''} {del('order_dispatches', x.id)}
            </li>
          ))}
        </ul>
      )}
      {manage && <DispatchForm trs={trs} trName={trName} onAdd={(r) => add('order_dispatches', r)} />}

      <h4>Payment tracking</h4>
      {!order.payment_tracking_enabled ? <p className="muted small">Not enabled.</p> : (
        <>
          <dl className="kv">
            <dt>Buyer receipts</dt><dd className="mono">{money(received)} of {money(buyerValue)} (balance {money(buyerValue - received)})</dd>
            <dt>Supplier payments</dt><dd className="mono">{money(paidOut)} of {money(supplierValue)} (balance {money(supplierValue - paidOut)})</dd>
          </dl>
          <p className="muted small">Values are rate × quantity from the order.</p>
          {pays.length > 0 && (
            <ul className="small" style={{ margin: 0 }}>
              {pays.map((p) => (
                <li key={p.id}>{p.paid_on} · {p.kind === 'buyer_receipt' ? 'Received from buyer' : 'Paid to supplier'} · {money(p.amount)}{p.mode ? ` · ${p.mode}` : ''}{p.reference ? ` · ${p.reference}` : ''} {del('order_payments', p.id)}</li>
              ))}
            </ul>
          )}
          {manage && <PaymentForm onAdd={(r) => add('order_payments', r)} />}
        </>
      )}
    </div>
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
      <Field id="x-tt" label={kind === 'our' ? 'Transporter record (optional)' : 'Transporter'} required={kind === 'third_party'}>
        <select id="x-tt" value={tid} onChange={(e) => setTid(e.target.value)}>
          <option value="">—</option>
          {list.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
        </select>
      </Field>
      <Field id="x-tv" label="Vehicle no."><input id="x-tv" value={veh} onChange={(e) => setVeh(e.target.value)} /></Field>
      <Field id="x-td" label="Driver"><input id="x-td" value={drv} onChange={(e) => setDrv(e.target.value)} /></Field>
      <Field id="x-tf" label="Freight amount"><input id="x-tf" className="mono" inputMode="decimal" value={fr} onChange={(e) => setFr(e.target.value)} /></Field>
      <button className="btn" type="button" disabled={!ok} onClick={() => void onAdd({ kind, transporter_id: tid || null, vehicle_no: veh.trim() || null, driver_name: drv.trim() || null, freight_amount: numOrNull(fr) }).then((d) => { if (d) { setVeh(''); setDrv(''); setFr(''); setTid('') } })}>Add transportation</button>
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
      <button className="btn" type="button" disabled={!jid} onClick={() => void onAdd({ job_process_id: jid, quantity: numOrNull(qty), instructions: ins.trim() || null }).then((d) => { if (d) { setJid(''); setQty(''); setIns('') } })}>Add job process</button>
    </div>
  )
}

function DispatchForm({ trs, trName, onAdd }: { trs: OrderTransport[]; trName: (id: string | null) => string; onAdd: (r: Record<string, unknown>) => Promise<boolean> }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [qty, setQty] = useState('')
  const [tid, setTid] = useState('')
  const [veh, setVeh] = useState('')
  const [lr, setLr] = useState('')
  const [inv, setInv] = useState('')
  const q = numOrNull(qty)
  return (
    <div className="form-grid">
      <Field id="x-dd" label="Dispatch date" required><input id="x-dd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field id="x-dq" label="Quantity" required><input id="x-dq" className="mono" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      <Field id="x-dt" label="Transportation">
        <select id="x-dt" value={tid} onChange={(e) => setTid(e.target.value)}>
          <option value="">—</option>
          {trs.map((t) => (<option key={t.id} value={t.id}>{t.kind === 'our' ? 'Our' : trName(t.transporter_id)}{t.vehicle_no ? ` · ${t.vehicle_no}` : ''}</option>))}
        </select>
      </Field>
      <Field id="x-dv" label="Vehicle no."><input id="x-dv" value={veh} onChange={(e) => setVeh(e.target.value)} /></Field>
      <Field id="x-dl" label="LR no."><input id="x-dl" value={lr} onChange={(e) => setLr(e.target.value)} /></Field>
      <Field id="x-di" label="Invoice no."><input id="x-di" value={inv} onChange={(e) => setInv(e.target.value)} /></Field>
      <button className="btn" type="button" disabled={!date || q === null || q <= 0} onClick={() => void onAdd({ dispatch_date: date, quantity: q, transport_id: tid || null, vehicle_no: veh.trim() || null, lr_no: lr.trim() || null, invoice_no: inv.trim() || null }).then((d) => { if (d) { setQty(''); setVeh(''); setLr(''); setInv(''); setTid('') } })}>Add dispatch entry</button>
    </div>
  )
}

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
      <button className="btn" type="button" disabled={!date || a === null || a <= 0} onClick={() => void onAdd({ kind, amount: a, paid_on: date, mode: mode.trim() || null, reference: ref.trim() || null }).then((d) => { if (d) { setAmt(''); setMode(''); setRef('') } })}>Add payment entry</button>
    </div>
  )
}