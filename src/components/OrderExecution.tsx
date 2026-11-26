/** The dispatch part of a Dispatch and Billing item that has started: its entries (partial dispatch, fully dispatch, cancel,
 *  return) and the commission invoice. The item is Fully Dispatch once dispatched and cancelled quantity add up to its
 *  quantity (or a return is recorded); there is no separate closing step. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { CommissionInvoice, Order, OrderAdjustment, OrderDispatch } from '../api/types'
import { errMessage } from '../lib/party'
import { transportTypeLabel, uomLabel } from '../lib/deals'
import { useProfileNames } from './PartyExtras'
import { SubitemDialog, type SubKind } from './SubitemDialog'

const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }))

export function OrderExecution({ order, canManage, onChanged }: { order: Order; canManage: boolean; onChanged?: () => Promise<void> }) {
  const people = useProfileNames()
  const [dsp, setDsp] = useState<OrderDispatch[]>([])
  const [adj, setAdj] = useState<OrderAdjustment[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [inv, setInv] = useState<CommissionInvoice | null>(null)
  const [billed, setBilled] = useState<{ party_type: string; invoice_no: string | null }[]>([])
  const isClosed = order.status === 'closed'
  const manage = canManage && !isClosed

  const load = useCallback(async () => {
    const [d, f, h, i] = await Promise.all([
      supabase.from('order_dispatches').select('*, merge:dispatch_merges(merge_no)').eq('order_id', order.id).order('created_at'),
      supabase.from('commission_invoices').select('*').eq('order_id', order.id).eq('is_legacy', true).maybeSingle(),
      supabase.from('order_dispatch_adjustments').select('*').eq('order_id', order.id).order('created_at'),
      supabase.from('commission_invoice_lines').select('party_type, invoice:commission_invoices(invoice_no)').eq('order_id', order.id).eq('active', true),
    ])
    const seen = new Map<string, { party_type: string; invoice_no: string | null }>()
    for (const l of (i.data ?? []) as unknown as { party_type: string; invoice: { invoice_no: string | null } | null }[]) {
      seen.set(`${l.party_type}|${l.invoice?.invoice_no ?? ''}`, { party_type: l.party_type, invoice_no: l.invoice?.invoice_no ?? null })
    }
    setBilled([...seen.values()])
    setAdj((h.data ?? []) as OrderAdjustment[])
    setInv((f.data ?? null) as CommissionInvoice | null)
    setDsp((d.data ?? []) as OrderDispatch[])
  }, [order.id])
  useEffect(() => {
    void load()
  }, [load])

  async function remove(table: string, id: string) {
    setErr(null)
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) setErr(errMessage(error, 'Could not delete'))
    else {
      await load()
      if (onChanged) await onChanged()
    }
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

  const returned = adj.filter((a) => a.kind === 'return').reduce((n, x) => n + x.quantity, 0)
  const cancelled = adj.filter((a) => a.kind === 'cancel').reduce((n, x) => n + x.quantity, 0)
  const dispatched = dsp.reduce((n, x) => n + x.quantity, 0)

  // Fully Dispatch is the end of an item: only Return entries can be added or removed after it
  const fully = dispatched > 0 && (dispatched + cancelled >= order.quantity || returned > 0)
  const del = (table: string, id: string, isReturn = false) =>
    manage && (!fully || isReturn) ? <button className="btn ghost sm" type="button" onClick={() => void remove(table, id)}>Remove</button> : null

  // a Return makes the item Fully Dispatch, so nothing is left to send after one
  const left = returned > 0 ? 0 : Math.max(order.quantity - dispatched - cancelled, 0)
  const pct = order.quantity > 0 ? Math.min(100, Math.round((dispatched / order.quantity) * 100)) : 0
  const cancelPct = order.quantity > 0 ? Math.min(100 - pct, Math.round((cancelled / order.quantity) * 100)) : 0
  const [adding, setAdding] = useState<SubKind | null>(null)
  // cancelled quantity recorded up to a moment: dispatched + cancelled reaching the quantity makes that entry the Fully Dispatch one
  const cancelledBy = (at: string) => adj.filter((a) => a.kind === 'cancel' && a.created_at <= at).reduce((n, a) => n + a.quantity, 0)
  // every entry (dispatch, cancel, return) in the order it was made, as the sub-items of a monday item
  const entries = [
    ...dsp.map((x, i) => ({ at: x.created_at, kind: 'partial' as const, d: x, full: dsp.slice(0, i + 1).reduce((n, y) => n + y.quantity, 0) + cancelledBy(x.created_at) >= order.quantity })),
    ...adj.map((x) => ({ at: x.created_at, kind: x.kind, a: x })),
  ].sort((p, q) => p.at.localeCompare(q.at))
  const entryFacts = (x: OrderDispatch): [string, string | null][] => [
    ['Owner', x.person_id ? people[x.person_id] ?? null : null],
    ['Invoice', x.invoice_no ? `${x.invoice_no}${x.invoice_date ? ` · ${x.invoice_date}` : ''}` : null],
    ['Del Date', x.delivery_date ?? null],
    ['DC No.', x.dc_no ?? null],
    ['Vehicle', x.vehicle_no ?? null],
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
              const facts = entryFacts(x).filter(([k, v]) => v !== null && v !== '—' && !['Invoice', 'Owner'].includes(k))
              return (
                <details className="entry-row" key={x.id}>
                  <summary>
                    <span className="mono">{x.dispatch_no}</span>
                    <span className={`entry-status ${e.full ? 'full' : 'partial'}`}>{e.full ? 'Fully Dispatch' : 'Partially Dispatch'}</span>
                    <span className="mono">{money(x.quantity)} {uomLabel(order.uom)}</span>
                    <span className="muted small">{x.dispatch_date}{x.invoice_no ? ` · Inv ${x.invoice_no}` : ''}</span>
                    {x.merge?.merge_no && <span className="chip merge-tag" title="Sent in one merged dispatch with other confirmations">Merged · {x.merge.merge_no}</span>}
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
                {del('order_dispatch_adjustments', x.id, x.kind === 'return')}
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

      <ExecCard title="Commission invoice" hint={[inv ? `old invoice ${inv.invoice_no}, ${money(inv.amount)}` : '', ...billed.map((b) => `${b.party_type === 'supplier' ? 'supplier' : 'buyer'}: invoice ${b.invoice_no}`)].filter(Boolean).join(' · ') || 'Not invoiced yet.'}>
        {inv && <div><button className="btn" type="button" onClick={() => void printInvoice()}>Print old commission bill</button></div>}
        <p className="small">Commission invoices are made for a Business Unit and party over a date range: <Link to="/commission-invoices">open Commission Invoices</Link>.</p>
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

