/** Pending mill invoices, PODs and GRNs.
 *
 *  One row per dispatch entry. A dispatch is "pending" while its mill invoice,
 *  POD (proof of delivery) or GRN (goods received note) has not been recorded.
 *  Days pending = days since the dispatch date while anything is missing.
 *  Filters: party (buyer), mill (supplier), dispatch date range, company and
 *  payment terms (Cash = 0 credit days, Credit = more than 0). Billing staff
 *  record the documents with "Update". */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Order, OrderDispatch, PaymentTerm } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

type Named = { id: string; name: string }

const CSV_COLUMNS = ['dispatch_no', 'order_no', 'buyer', 'supplier', 'dispatch_date', 'mill_invoice_status', 'mill_invoice_no', 'pod_status', 'grn_status', 'grn_no', 'payment_type', 'days_pending'] as const
const termType = (t: PaymentTerm | undefined) => (!t ? 'Not set' : t.days > 0 ? 'Credit' : 'Cash')
function daysSince(date: string): number {
  const now = new Date()
  const t = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((t - Date.parse(date + 'T00:00:00Z')) / 86400000))
}
const status = (done: boolean) => (done ? <span className="chip good">Received</span> : <span className="chip warn">Pending</span>)

export default function PendingDocuments() {
  const { can } = useAuth()
  const canManage = can('order.manage')
  const [dispatches, setDispatches] = useState<OrderDispatch[] | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [buyers, setBuyers] = useState<Named[]>([])
  const [suppliers, setSuppliers] = useState<Named[]>([])
  const [companies, setCompanies] = useState<Named[]>([])
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fBuyer, setFBuyer] = useState('')
  const [fSupplier, setFSupplier] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fTerms, setFTerms] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<OrderDispatch | null>(null)

  async function load() {
    const [d, o, b, s, c, t] = await Promise.all([
      supabase.from('order_dispatches').select('*').order('dispatch_date'),
      supabase.from('orders').select('*'),
      supabase.from('buyer_master').select('id,name').order('name'),
      supabase.from('supplier_master').select('id,name').order('name'),
      supabase.from('companies').select('id,name').order('name'),
      supabase.from('payment_terms').select('*'),
    ])
    if (d.error) setError(errMessage(d.error, 'Could not load the report'))
    setDispatches((d.data ?? []) as OrderDispatch[])
    setOrders((o.data ?? []) as Order[])
    setBuyers((b.data ?? []) as Named[])
    setSuppliers((s.data ?? []) as Named[])
    setCompanies((c.data ?? []) as Named[])
    setTerms((t.data ?? []) as PaymentTerm[])
  }
  useEffect(() => {
    void load()
  }, [])

  const nm = (list: Named[], id: string) => list.find((x) => x.id === id)?.name ?? '—'
  const orderOf = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])

  const rows = useMemo(() => {
    return (dispatches ?? [])
      .map((x) => {
        const o = orderOf.get(x.order_id)
        const invoice = !!(x.mill_invoice_no || x.mill_invoice_date)
        const pod = !!x.pod_received_on
        const grn = !!x.grn_received_on
        const pending = !(invoice && pod && grn)
        return { x, o, invoice, pod, grn, pending, days: pending ? daysSince(x.dispatch_date) : 0 }
      })
      .filter(({ x, o, pending }) => {
        if (!o) return false
        if (!showDone && !pending) return false
        if (fBuyer && o.buyer_id !== fBuyer) return false
        if (fSupplier && o.supplier_id !== fSupplier) return false
        if (fCompany && o.company_id !== fCompany) return false
        if (fTerms && termType(terms.find((t) => t.id === o.payment_term_id)) !== fTerms) return false
        if (from && x.dispatch_date < from) return false
        if (to && x.dispatch_date > to) return false
        return true
      })
      .sort((a, b) => b.days - a.days)
  }, [dispatches, orderOf, terms, fBuyer, fSupplier, fCompany, fTerms, from, to, showDone])

  function exportCSV() {
    const list = rows.map(({ x, o, invoice, pod, grn, days }) => ({
      dispatch_no: x.dispatch_no, order_no: o?.order_no ?? '', buyer: o ? nm(buyers, o.buyer_id) : '', supplier: o ? nm(suppliers, o.supplier_id) : '',
      dispatch_date: x.dispatch_date, mill_invoice_status: invoice ? 'Received' : 'Pending', mill_invoice_no: x.mill_invoice_no ?? '',
      pod_status: pod ? 'Received' : 'Pending', grn_status: grn ? 'Received' : 'Pending', grn_no: x.grn_no ?? '',
      payment_type: termType(terms.find((t) => t.id === o?.payment_term_id)), days_pending: days,
    }))
    downloadCSV(`pending-mill-invoices-and-receipts-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  function clear() {
    setFBuyer(''); setFSupplier(''); setFCompany(''); setFTerms(''); setFrom(''); setTo(''); setShowDone(false)
  }

  if (!dispatches) return <Loading label="Loading dispatch documents" />
  const filtered = fBuyer || fSupplier || fCompany || fTerms || from || to || showDone

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Mill invoices and receipts</h1>
          <p className="page-sub">Dispatches still waiting for the mill invoice, POD or GRN, longest waiting first.</p>
        </div>
        <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
      </header>
      {error && <div className="alert">{error}</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><select aria-label="Party (buyer)" value={fBuyer} onChange={(e) => setFBuyer(e.target.value)}><option value="">All parties</option>{buyers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Mill (supplier)" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}><option value="">All mills</option>{suppliers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Company" value={fCompany} onChange={(e) => setFCompany(e.target.value)}><option value="">All companies</option>{companies.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Payment terms" value={fTerms} onChange={(e) => setFTerms(e.target.value)}><option value="">Cash and credit</option><option value="Cash">Cash</option><option value="Credit">Credit</option></select></div>
        <div className="field"><input aria-label="Dispatched from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Dispatched from" /></div>
        <div className="field"><input aria-label="Dispatched to" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Dispatched to" /></div>
        <div className="field"><label className="small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Include completed</label></div>
        {filtered && <div className="field"><button className="btn ghost" type="button" onClick={clear}>Clear filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{dispatches.length === 0 ? 'No dispatches yet.' : 'Nothing is pending for these filters.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Dispatch no.</th><th>Order</th><th>Buyer</th><th>Supplier</th><th>Dispatched</th>
                <th>Mill invoice</th><th>POD</th><th>GRN</th><th>Terms</th><th className="right">Days pending</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ x, o, invoice, pod, grn, days }) => (
                <tr key={x.id}>
                  <td className="mono">{x.dispatch_no}</td>
                  <td className="mono small">{o?.order_no}</td>
                  <td>{o ? nm(buyers, o.buyer_id) : '—'}</td>
                  <td>{o ? nm(suppliers, o.supplier_id) : '—'}</td>
                  <td className="mono small">{x.dispatch_date}</td>
                  <td>{status(invoice)}{x.mill_invoice_no && <span className="muted small"> {x.mill_invoice_no}</span>}</td>
                  <td>{status(pod)}</td>
                  <td>{status(grn)}{x.grn_no && <span className="muted small"> {x.grn_no}</span>}</td>
                  <td className="small">{termType(terms.find((t) => t.id === o?.payment_term_id))}</td>
                  <td className="right mono">{days > 0 ? <strong>{days}</strong> : '0'}</td>
                  {canManage && <td><button className="btn ghost sm" type="button" onClick={() => setEditing(x)}>Update</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DocDrawer
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

function DocDrawer({ row, onClose, onDone }: { row: OrderDispatch; onClose: () => void; onDone: () => Promise<void> }) {
  const [mNo, setMNo] = useState(row.mill_invoice_no ?? '')
  const [mDate, setMDate] = useState(row.mill_invoice_date ?? '')
  const [pod, setPod] = useState(row.pod_received_on ?? '')
  const [gNo, setGNo] = useState(row.grn_no ?? '')
  const [gDate, setGDate] = useState(row.grn_received_on ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setErr(null)
    const t = (v: string) => v.trim() || null
    const { data, error } = await supabase
      .from('order_dispatches')
      .update({ mill_invoice_no: t(mNo), mill_invoice_date: mDate || null, pod_received_on: pod || null, grn_no: t(gNo), grn_received_on: gDate || null })
      .eq('id', row.id)
      .select('id')
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save. POD and GRN dates cannot be before the dispatch date.'))
    if (!data || data.length === 0) return setErr('Your account cannot change this dispatch.')
    await onDone()
  }

  return (
    <Drawer title={`${row.dispatch_no} · documents`} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <p className="muted small">Dispatched {row.dispatch_date}. Leave a field empty while it is still awaited.</p>
      <div className="form-grid">
        <Field id="dc-mi" label="Mill invoice no."><input id="dc-mi" value={mNo} onChange={(e) => setMNo(e.target.value)} /></Field>
        <Field id="dc-md" label="Mill invoice date"><input id="dc-md" type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} /></Field>
        <Field id="dc-pod" label="POD received on"><input id="dc-pod" type="date" min={row.dispatch_date} value={pod} onChange={(e) => setPod(e.target.value)} /></Field>
        <Field id="dc-gn" label="GRN no."><input id="dc-gn" value={gNo} onChange={(e) => setGNo(e.target.value)} /></Field>
        <Field id="dc-gd" label="GRN received on"><input id="dc-gd" type="date" min={row.dispatch_date} value={gDate} onChange={(e) => setGDate(e.target.value)} /></Field>
      </div>
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </Drawer>
  )
}