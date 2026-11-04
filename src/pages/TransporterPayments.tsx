/** Third-party transport payment report.
 *
 *  One row per dispatch carried by a third-party transporter: transporter,
 *  transporter invoice no., dispatch reference, amount and payment status.
 *  Amount is the transporter's invoice amount, or the freight on the order's
 *  transport record while the invoice amount is not entered.
 *  Status: Invoice awaited (no invoice no.), Pending (invoice, nothing paid),
 *  Part paid, Paid. Filters: transporter, status, dispatch date range.
 *  Transport admins (order.manage) record payments with "Pay". */

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
type Status = 'awaiting' | 'pending' | 'part' | 'paid'

const STATUS_LABEL: Record<Status, string> = { awaiting: 'Invoice awaited', pending: 'Pending', part: 'Part paid', paid: 'Paid' }
const CSV_COLUMNS = ['transporter', 'invoice_no', 'dispatch_ref', 'order_no', 'dispatch_date', 'amount', 'paid_amount', 'balance', 'payment_status', 'paid_on', 'payment_ref'] as const
const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

function statusOf(x: OrderDispatch, amount: number): Status {
  if (!x.transporter_invoice_no) return 'awaiting'
  const paid = Number(x.transporter_paid_amount ?? 0)
  if (paid <= 0) return 'pending'
  return paid >= amount ? 'paid' : 'part'
}
const chip: Record<Status, string> = { awaiting: '', pending: 'warn', part: 'warn', paid: 'good' }

export default function TransporterPayments() {
  const { can } = useAuth()
  const canManage = can('order.manage')
  const [dispatches, setDispatches] = useState<OrderDispatch[] | null>(null)
  const [transports, setTransports] = useState<OrderTransport[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [transporters, setTransporters] = useState<Named[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fTr, setFTr] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [editing, setEditing] = useState<OrderDispatch | null>(null)

  async function load() {
    const [d, t, o, tr] = await Promise.all([
      supabase.from('order_dispatches').select('*').order('dispatch_date', { ascending: false }),
      supabase.from('order_transports').select('*'),
      supabase.from('orders').select('*'),
      supabase.from('transporters').select('id,name').order('name'),
    ])
    if (d.error) setError(errMessage(d.error, 'Could not load the report'))
    setDispatches((d.data ?? []) as OrderDispatch[])
    setTransports((t.data ?? []) as OrderTransport[])
    setOrders((o.data ?? []) as Order[])
    setTransporters((tr.data ?? []) as Named[])
  }
  useEffect(() => {
    void load()
  }, [])

  const orderOf = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const transportOf = useMemo(() => new Map(transports.map((t) => [t.id, t])), [transports])
  const trName = (id: string | null | undefined) => (id ? transporters.find((x) => x.id === id)?.name ?? '—' : '—')

  const all = useMemo(
    () =>
      (dispatches ?? [])
        .map((x) => {
          const t = x.transport_id ? transportOf.get(x.transport_id) : undefined
          const amount = Number(x.transporter_invoice_amount ?? t?.freight_amount ?? 0)
          return { x, t, o: orderOf.get(x.order_id), amount, status: statusOf(x, amount) }
        })
        .filter((r) => r.o && r.t && r.t.kind === 'third_party'),
    [dispatches, transportOf, orderOf],
  )
  const rows = useMemo(
    () =>
      all.filter((r) => {
        if (fTr && r.t?.transporter_id !== fTr) return false
        if (fStatus && r.status !== fStatus) return false
        if (from && r.x.dispatch_date < from) return false
        if (to && r.x.dispatch_date > to) return false
        return true
      }),
    [all, fTr, fStatus, from, to],
  )
  const owed = rows.filter((r) => r.status !== 'paid' && r.status !== 'awaiting').reduce((a, r) => a + Math.max(0, r.amount - Number(r.x.transporter_paid_amount ?? 0)), 0)

  function exportCSV() {
    const list = rows.map(({ x, t, o, amount, status }) => ({
      transporter: trName(t?.transporter_id), invoice_no: x.transporter_invoice_no ?? '', dispatch_ref: x.dispatch_no, order_no: o?.order_no ?? '', dispatch_date: x.dispatch_date,
      amount, paid_amount: x.transporter_paid_amount ?? 0, balance: Math.max(0, amount - Number(x.transporter_paid_amount ?? 0)), payment_status: STATUS_LABEL[status],
      paid_on: x.transporter_paid_on ?? '', payment_ref: x.transporter_payment_ref ?? '',
    }))
    downloadCSV(`transporter-payments-${iso(new Date())}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!dispatches) return <Loading label="Loading transporter payments" />
  const filtered = fTr || fStatus || from || to

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Transporter payments</h1>
          <p className="page-sub">Third-party transport bills and whether they have been paid.{owed > 0 ? ` ₹${money(owed)} is still to be paid on invoiced bills.` : ''}</p>
        </div>
        <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
      </header>
      {error && <div className="alert">{error}</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><select aria-label="Transporter" value={fTr} onChange={(e) => setFTr(e.target.value)}><option value="">All transporters</option>{transporters.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Payment status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">All statuses</option>{(Object.keys(STATUS_LABEL) as Status[]).map((k) => (<option key={k} value={k}>{STATUS_LABEL[k]}</option>))}</select></div>
        <div className="field"><input aria-label="Dispatched from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Dispatched from" /></div>
        <div className="field"><input aria-label="Dispatched to" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Dispatched to" /></div>
        {filtered && <div className="field"><button className="btn ghost" type="button" onClick={() => { setFTr(''); setFStatus(''); setFrom(''); setTo('') }}>Clear filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{all.length === 0 ? 'No dispatch has gone with a third-party transporter yet.' : 'No transporter bill matches these filters.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Transporter</th><th>Invoice no.</th><th>Dispatch ref</th><th className="right">Amount</th><th>Payment status</th><th className="right">Paid</th>{canManage && <th />}</tr>
            </thead>
            <tbody>
              {rows.map(({ x, t, o, amount, status }) => (
                <tr key={x.id}>
                  <td>{trName(t?.transporter_id)}</td>
                  <td className="mono">{x.transporter_invoice_no ?? '—'}</td>
                  <td className="mono small">{x.dispatch_no}<div className="muted">{o?.order_no} · {x.dispatch_date}</div></td>
                  <td className="right mono"><strong>{money(amount)}</strong>{x.transporter_invoice_amount === null && amount > 0 && <div className="small muted">freight</div>}</td>
                  <td><span className={`chip ${chip[status]}`}>{STATUS_LABEL[status]}</span></td>
                  <td className="right mono">{x.transporter_paid_amount ? money(x.transporter_paid_amount) : '—'}{x.transporter_paid_on && <div className="small muted">{x.transporter_paid_on}{x.transporter_payment_ref ? ` · ${x.transporter_payment_ref}` : ''}</div>}</td>
                  {canManage && <td><button className="btn ghost sm" type="button" disabled={status === 'awaiting'} title={status === 'awaiting' ? 'Record the transporter invoice first (Transporter invoices screen)' : ''} onClick={() => setEditing(x)}>Pay</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PayDrawer
          key={editing.id}
          row={editing}
          amount={Number(editing.transporter_invoice_amount ?? (editing.transport_id ? transportOf.get(editing.transport_id)?.freight_amount : 0) ?? 0)}
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

function PayDrawer({ row, amount, onClose, onDone }: { row: OrderDispatch; amount: number; onClose: () => void; onDone: () => Promise<void> }) {
  const [paid, setPaid] = useState(row.transporter_paid_amount === null ? '' : String(row.transporter_paid_amount))
  const [on, setOn] = useState(row.transporter_paid_on ?? iso(new Date()))
  const [ref, setRef] = useState(row.transporter_payment_ref ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    const p = paid.trim() === '' ? null : Number(paid)
    if (p !== null && (!Number.isFinite(p) || p < 0)) return setErr('Enter a valid amount paid.')
    if (p !== null && p > 0 && !on) return setErr('Enter the payment date.')
    setBusy(true)
    const clear = p === null || p === 0
    const { data, error } = await supabase
      .from('order_dispatches')
      .update({ transporter_paid_amount: p, transporter_paid_on: clear ? null : on, transporter_payment_ref: clear ? null : ref.trim() || null })
      .eq('id', row.id)
      .select('id')
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save the payment.'))
    if (!data || data.length === 0) return setErr('Your account cannot change this dispatch.')
    await onDone()
  }

  return (
    <Drawer title={`${row.dispatch_no} · transporter payment`} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <p className="muted small">Invoice {row.transporter_invoice_no ?? '—'} · amount {money(amount)}. Enter the total paid so far; set it to 0 or empty to clear.</p>
      <div className="form-grid">
        <Field id="tp-amt" label="Total paid"><input id="tp-amt" type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
        <Field id="tp-on" label="Paid on"><input id="tp-on" type="date" max={iso(new Date())} value={on} onChange={(e) => setOn(e.target.value)} /></Field>
        <Field id="tp-ref" label="Reference (UTR / cheque no.)"><input id="tp-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </Drawer>
  )
}