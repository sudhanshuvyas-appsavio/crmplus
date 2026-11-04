/** Pending transporter invoices.
 *
 *  One row per dispatch carried by a third-party transporter. A dispatch is
 *  "pending" until the transporter's invoice number is recorded, so Transport
 *  Admin can see which freight bills are still to arrive before paying.
 *  Dispatches on our own vehicles, or with no transport yet, have no
 *  transporter invoice to wait for and are left out.
 *  Filters: party (buyer), mill (supplier) and dispatch date range. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Order, OrderDispatch, OrderTransport } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

type Named = { id: string; name: string }

const CSV_COLUMNS = ['dispatch_no', 'order_no', 'buyer', 'supplier', 'transporter', 'vehicle_no', 'lr_no', 'dispatch_date', 'freight_amount', 'invoice_status', 'invoice_no', 'invoice_date', 'invoice_amount', 'days_pending'] as const
const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
function daysSince(date: string): number {
  const now = new Date()
  const t = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((t - Date.parse(date + 'T00:00:00Z')) / 86400000))
}

export default function PendingTransporterInvoices() {
  const { can } = useAuth()
  const canManage = can('order.manage')
  const [dispatches, setDispatches] = useState<OrderDispatch[] | null>(null)
  const [transports, setTransports] = useState<OrderTransport[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [buyers, setBuyers] = useState<Named[]>([])
  const [suppliers, setSuppliers] = useState<Named[]>([])
  const [transporters, setTransporters] = useState<Named[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fBuyer, setFBuyer] = useState('')
  const [fSupplier, setFSupplier] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<OrderDispatch | null>(null)

  async function load() {
    const [d, t, o, b, s, tr] = await Promise.all([
      supabase.from('order_dispatches').select('*').order('dispatch_date'),
      supabase.from('order_transports').select('*'),
      supabase.from('orders').select('*'),
      supabase.from('buyer_master').select('id,name').order('name'),
      supabase.from('supplier_master').select('id,name').order('name'),
      supabase.from('transporters').select('id,name').order('name'),
    ])
    if (d.error) setError(errMessage(d.error, 'Could not load the report'))
    setDispatches((d.data ?? []) as OrderDispatch[])
    setTransports((t.data ?? []) as OrderTransport[])
    setOrders((o.data ?? []) as Order[])
    setBuyers((b.data ?? []) as Named[])
    setSuppliers((s.data ?? []) as Named[])
    setTransporters((tr.data ?? []) as Named[])
  }
  useEffect(() => {
    void load()
  }, [])

  const nm = (list: Named[], id: string | null | undefined) => (id ? list.find((x) => x.id === id)?.name ?? '—' : '—')
  const orderOf = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const transportOf = useMemo(() => new Map(transports.map((t) => [t.id, t])), [transports])

  const rows = useMemo(() => {
    return (dispatches ?? [])
      .map((x) => {
        const o = orderOf.get(x.order_id)
        const t = x.transport_id ? transportOf.get(x.transport_id) : undefined
        const received = !!x.transporter_invoice_no
        return { x, o, t, received, days: received ? 0 : daysSince(x.dispatch_date) }
      })
      .filter(({ x, o, t, received }) => {
        if (!o || !t || t.kind !== 'third_party') return false
        if (!showDone && received) return false
        if (fBuyer && o.buyer_id !== fBuyer) return false
        if (fSupplier && o.supplier_id !== fSupplier) return false
        if (from && x.dispatch_date < from) return false
        if (to && x.dispatch_date > to) return false
        return true
      })
      .sort((a, b) => b.days - a.days)
  }, [dispatches, orderOf, transportOf, fBuyer, fSupplier, from, to, showDone])

  const pendingFreight = rows.filter((r) => !r.received).reduce((a, r) => a + Number(r.t?.freight_amount ?? 0), 0)

  function exportCSV() {
    const list = rows.map(({ x, o, t, received, days }) => ({
      dispatch_no: x.dispatch_no, order_no: o?.order_no ?? '', buyer: o ? nm(buyers, o.buyer_id) : '', supplier: o ? nm(suppliers, o.supplier_id) : '',
      transporter: nm(transporters, t?.transporter_id), vehicle_no: x.vehicle_no ?? t?.vehicle_no ?? '', lr_no: x.lr_no ?? '', dispatch_date: x.dispatch_date,
      freight_amount: t?.freight_amount ?? '', invoice_status: received ? 'Received' : 'Pending', invoice_no: x.transporter_invoice_no ?? '',
      invoice_date: x.transporter_invoice_date ?? '', invoice_amount: x.transporter_invoice_amount ?? '', days_pending: days,
    }))
    downloadCSV(`pending-transporter-invoices-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  function clear() {
    setFBuyer(''); setFSupplier(''); setFrom(''); setTo(''); setShowDone(false)
  }

  if (!dispatches) return <Loading label="Loading transporter invoices" />
  const filtered = fBuyer || fSupplier || from || to || showDone
  const pendingCount = rows.filter((r) => !r.received).length

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Transporter invoices</h1>
          <p className="page-sub">Third-party dispatches still waiting for the transporter's invoice, longest waiting first.{pendingCount > 0 ? ` ${pendingCount} pending, freight ₹${money(pendingFreight)}.` : ''}</p>
        </div>
        <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
      </header>
      {error && <div className="alert">{error}</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><select aria-label="Party (buyer)" value={fBuyer} onChange={(e) => setFBuyer(e.target.value)}><option value="">All parties</option>{buyers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Mill (supplier)" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}><option value="">All mills</option>{suppliers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><input aria-label="Dispatched from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Dispatched from" /></div>
        <div className="field"><input aria-label="Dispatched to" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Dispatched to" /></div>
        <div className="field"><label className="small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Include received</label></div>
        {filtered && <div className="field"><button className="btn ghost" type="button" onClick={clear}>Clear filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{dispatches.length === 0 ? 'No dispatches yet.' : 'No transporter invoice is pending for these filters.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Dispatch no.</th><th>Order</th><th>Buyer</th><th>Supplier</th><th>Transporter</th><th>Vehicle / LR</th>
                <th>Dispatched</th><th className="right">Freight</th><th>Invoice</th><th className="right">Days pending</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ x, o, t, received, days }) => (
                <tr key={x.id}>
                  <td className="mono">{x.dispatch_no}</td>
                  <td className="mono small">{o?.order_no}</td>
                  <td>{o ? nm(buyers, o.buyer_id) : '—'}</td>
                  <td>{o ? nm(suppliers, o.supplier_id) : '—'}</td>
                  <td>{nm(transporters, t?.transporter_id)}</td>
                  <td className="small">{x.vehicle_no ?? t?.vehicle_no ?? '—'}{x.lr_no && <span className="muted"> · LR {x.lr_no}</span>}</td>
                  <td className="mono small">{x.dispatch_date}</td>
                  <td className="right mono">{money(t?.freight_amount)}</td>
                  <td>{received ? <span className="chip good">Received</span> : <span className="chip warn">Pending</span>}{x.transporter_invoice_no && <span className="muted small"> {x.transporter_invoice_no}{x.transporter_invoice_amount !== null ? ` · ₹${money(x.transporter_invoice_amount)}` : ''}</span>}</td>
                  <td className="right mono">{days > 0 ? <strong>{days}</strong> : '0'}</td>
                  {canManage && <td><button className="btn ghost sm" type="button" onClick={() => setEditing(x)}>Update</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <InvoiceDrawer
          key={editing.id}
          row={editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
    </>
  )
}

function InvoiceDrawer({ row, onClose, onDone }: { row: OrderDispatch; onClose: () => void; onDone: () => Promise<void> }) {
  const [no, setNo] = useState(row.transporter_invoice_no ?? '')
  const [date, setDate] = useState(row.transporter_invoice_date ?? '')
  const [amount, setAmount] = useState(row.transporter_invoice_amount === null ? '' : String(row.transporter_invoice_amount))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    const amt = amount.trim() === '' ? null : Number(amount)
    if (amt !== null && (!Number.isFinite(amt) || amt < 0)) return setErr('Enter a valid invoice amount.')
    setBusy(true)
    const { data, error } = await supabase
      .from('order_dispatches')
      .update({ transporter_invoice_no: no.trim() || null, transporter_invoice_date: date || null, transporter_invoice_amount: amt })
      .eq('id', row.id)
      .select('id')
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save the transporter invoice.'))
    if (!data || data.length === 0) return setErr('Your account cannot change this dispatch.')
    await onDone()
  }

  return (
    <Drawer title={`${row.dispatch_no} · transporter invoice`} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <p className="muted small">Dispatched {row.dispatch_date}. Leave the invoice number empty while the bill is still awaited.</p>
      <div className="form-grid">
        <Field id="ti-no" label="Transporter invoice no."><input id="ti-no" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
        <Field id="ti-date" label="Invoice date"><input id="ti-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field id="ti-amt" label="Invoice amount"><input id="ti-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </Drawer>
  )
}