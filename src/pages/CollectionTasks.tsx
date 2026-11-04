/** Pending collection tasks.
 *
 *  A collection task is a piece of follow-up work to bring money in: collect a
 *  buyer's payment, collect a commission invoice, or a general follow-up. Each
 *  belongs to an order, has a due date, an assignee and the amount to collect.
 *  "Pending" means Pending or In progress. Area is the buyer's state (there is no
 *  separate area master). Filters: area, collection staff, buyer, supplier, count.
 *  Collection managers (order.manage) create tasks and move them along. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CollectionTask, CountRow, Order } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

type Named = { id: string; name: string }
type Buyer = Named & { state: string | null }

const TYPE: Record<string, string> = { buyer_payment: 'Buyer payment', commission_invoice: 'Commission invoice', follow_up: 'Follow-up', cheque_collection: 'Cheque collection', invoice_delivery: 'Invoice delivery', payment_deposit: 'Payment deposit', cash_collection: 'Cash collection', delivery_note: 'Delivery note', mill_payment_deposit: 'Mill payment deposit' }
const STATUS: Record<string, string> = { pending: 'Pending', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' }
const CSV_COLUMNS = ['task_type', 'order_no', 'buyer', 'supplier', 'count', 'area', 'due_date', 'assigned_to', 'amount_to_collect', 'status', 'days_overdue'] as const
const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
function overdue(date: string): number {
  const now = new Date()
  const t = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((t - Date.parse(date + 'T00:00:00Z')) / 86400000))
}

export default function CollectionTasks() {
  const { can } = useAuth()
  const canManage = can('order.manage')
  const [tasks, setTasks] = useState<CollectionTask[] | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [suppliers, setSuppliers] = useState<Named[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [staff, setStaff] = useState<Named[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fArea, setFArea] = useState('')
  const [fStaff, setFStaff] = useState('')
  const [fBuyer, setFBuyer] = useState('')
  const [fSupplier, setFSupplier] = useState('')
  const [fCount, setFCount] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<CollectionTask | 'new' | null>(null)

  async function load() {
    const [t, o, b, s, c, p] = await Promise.all([
      supabase.from('collection_tasks').select('*').order('due_date'),
      supabase.from('orders').select('*'),
      supabase.from('buyer_master').select('id,name,state').order('name'),
      supabase.from('supplier_master').select('id,name').order('name'),
      supabase.from('count_master').select('*'),
      supabase.from('profiles').select('id,name').eq('is_active', true).order('name'),
    ])
    if (t.error) setError(errMessage(t.error, 'Could not load the collection tasks'))
    setTasks((t.data ?? []) as CollectionTask[])
    setOrders((o.data ?? []) as Order[])
    setBuyers((b.data ?? []) as Buyer[])
    setSuppliers((s.data ?? []) as Named[])
    setCounts((c.data ?? []) as CountRow[])
    setStaff((p.data ?? []) as Named[])
  }
  useEffect(() => {
    void load()
  }, [])

  const orderOf = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const buyerOf = useMemo(() => new Map(buyers.map((b) => [b.id, b])), [buyers])
  const countName = useMemo(() => new Map(counts.map((x) => [x.id, x.display_name])), [counts])
  const nm = (list: Named[], id: string | null | undefined) => (id ? list.find((x) => x.id === id)?.name ?? '—' : 'Unassigned')
  const areaOf = (o: Order | undefined) => (o ? buyerOf.get(o.buyer_id)?.state ?? '' : '')
  const areas = useMemo(() => [...new Set(orders.map((o) => areaOf(o)).filter(Boolean))].sort(), [orders, buyerOf]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    return (tasks ?? [])
      .map((x) => ({ x, o: orderOf.get(x.order_id), late: x.status === 'pending' || x.status === 'in_progress' ? overdue(x.due_date) : 0 }))
      .filter(({ x, o }) => {
        if (!o) return false
        const open = x.status === 'pending' || x.status === 'in_progress'
        if (!showDone && !open) return false
        if (fArea && areaOf(o) !== fArea) return false
        if (fStaff && (fStaff === '__none' ? x.assigned_to : x.assigned_to !== fStaff)) return false
        if (fBuyer && o.buyer_id !== fBuyer) return false
        if (fSupplier && o.supplier_id !== fSupplier) return false
        if (fCount && o.count_id !== fCount) return false
        return true
      })
      .sort((a, b) => a.x.due_date.localeCompare(b.x.due_date))
  }, [tasks, orderOf, buyerOf, fArea, fStaff, fBuyer, fSupplier, fCount, showDone]) // eslint-disable-line react-hooks/exhaustive-deps

  const openRows = rows.filter(({ x }) => x.status === 'pending' || x.status === 'in_progress')
  const total = openRows.reduce((a, { x }) => a + Number(x.amount_to_collect), 0)
  const lateCount = openRows.filter((r) => r.late > 0).length

  async function setStatus(x: CollectionTask, status: CollectionTask['status']) {
    setError(null)
    const { data, error: e } = await supabase.from('collection_tasks').update({ status }).eq('id', x.id).select('id')
    if (e || !data || data.length === 0) return setError(e ? errMessage(e, 'Could not update the task') : 'Your account cannot change this task.')
    await load()
  }

  function exportCSV() {
    const list = rows.map(({ x, o, late }) => ({
      task_type: TYPE[x.task_type], order_no: o?.order_no ?? '', buyer: o ? buyerOf.get(o.buyer_id)?.name ?? '' : '', supplier: o ? nm(suppliers, o.supplier_id) : '',
      count: o ? countName.get(o.count_id) ?? '' : '', area: areaOf(o), due_date: x.due_date, assigned_to: nm(staff, x.assigned_to), amount_to_collect: x.amount_to_collect,
      status: STATUS[x.status], days_overdue: late,
    }))
    downloadCSV(`collection-tasks-${iso(new Date())}.csv`, toCSV(CSV_COLUMNS, list))
  }

  function clear() {
    setFArea(''); setFStaff(''); setFBuyer(''); setFSupplier(''); setFCount(''); setShowDone(false)
  }

  if (!tasks) return <Loading label="Loading collection tasks" />
  const filtered = fArea || fStaff || fBuyer || fSupplier || fCount || showDone

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Collection tasks</h1>
          <p className="page-sub">
            Open collection work, earliest due first.{openRows.length > 0 ? ` ${openRows.length} open, ₹${money(total)} to collect, ${lateCount} overdue.` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canManage && <button className="btn primary" type="button" onClick={() => setEditing('new')}>New task</button>}
          <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><select aria-label="Area" value={fArea} onChange={(e) => setFArea(e.target.value)}><option value="">All areas</option>{areas.map((a) => (<option key={a} value={a}>{a}</option>))}</select></div>
        <div className="field"><select aria-label="Collection staff" value={fStaff} onChange={(e) => setFStaff(e.target.value)}><option value="">All staff</option>{staff.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}<option value="__none">Unassigned</option></select></div>
        <div className="field"><select aria-label="Buyer" value={fBuyer} onChange={(e) => setFBuyer(e.target.value)}><option value="">All buyers</option>{buyers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Supplier" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}><option value="">All suppliers</option>{suppliers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Count" value={fCount} onChange={(e) => setFCount(e.target.value)}><option value="">All counts</option>{counts.map((x) => (<option key={x.id} value={x.id}>{x.display_name}</option>))}</select></div>
        <div className="field"><label className="small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Include done / cancelled</label></div>
        {filtered && <div className="field"><button className="btn ghost" type="button" onClick={clear}>Clear filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{tasks.length === 0 ? 'No collection tasks yet.' : 'No collection task matches these filters.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Task type</th><th>Order</th><th>Buyer</th><th>Supplier</th><th>Count</th><th>Area</th>
                <th>Due date</th><th>Assigned to</th><th className="right">Amount to collect</th><th>Status</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ x, o, late }) => (
                <tr key={x.id}>
                  <td>{TYPE[x.task_type]}{x.notes && <div className="small muted">{x.notes}</div>}</td>
                  <td className="mono small">{o?.order_no}</td>
                  <td>{o ? buyerOf.get(o.buyer_id)?.name ?? '—' : '—'}</td>
                  <td>{o ? nm(suppliers, o.supplier_id) : '—'}</td>
                  <td className="small">{o ? countName.get(o.count_id) ?? '—' : '—'}</td>
                  <td className="small">{areaOf(o) || '—'}</td>
                  <td className="mono small">{x.due_date}{late > 0 && <span className="chip bad" style={{ marginLeft: 6 }}>{late} d overdue</span>}</td>
                  <td>{nm(staff, x.assigned_to)}</td>
                  <td className="right mono"><strong>{money(x.amount_to_collect)}</strong></td>
                  <td><span className={`chip ${x.status === 'done' ? 'good' : x.status === 'cancelled' ? '' : 'warn'}`}>{STATUS[x.status]}</span></td>
                  {canManage && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {x.status === 'pending' && <button className="btn ghost sm" type="button" onClick={() => void setStatus(x, 'in_progress')}>Start</button>}
                      {(x.status === 'pending' || x.status === 'in_progress') && <button className="btn ghost sm" type="button" onClick={() => void setStatus(x, 'done')}>Done</button>}
                      <button className="btn ghost sm" type="button" onClick={() => setEditing(x)}>Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TaskDrawer
          key={editing === 'new' ? 'new' : editing.id}
          task={editing === 'new' ? null : editing}
          orders={orders.filter((o) => o.status !== 'draft')}
          buyerName={(o) => buyerOf.get(o.buyer_id)?.name ?? '—'}
          staff={staff}
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

function TaskDrawer({ task, orders, buyerName, staff, onClose, onDone }: {
  task: CollectionTask | null
  orders: Order[]
  buyerName: (o: Order) => string
  staff: Named[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [orderId, setOrderId] = useState(task?.order_id ?? '')
  const [type, setType] = useState<CollectionTask['task_type']>(task?.task_type ?? 'buyer_payment')
  const [due, setDue] = useState(task?.due_date ?? iso(new Date(Date.now() + 7 * 86400000)))
  const [assignee, setAssignee] = useState(task?.assigned_to ?? '')
  const [amount, setAmount] = useState(task ? String(task.amount_to_collect) : '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [status, setStatus] = useState<CollectionTask['status']>(task?.status ?? 'pending')
  const [hint, setHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // For a new task, suggest the amount still to collect on the chosen order.
  async function suggest(oid: string, t: CollectionTask['task_type']) {
    setHint(null)
    if (task || !oid || t === 'follow_up' || t === 'invoice_delivery' || t === 'delivery_note') return
    if (t === 'buyer_payment' || t === 'cheque_collection' || t === 'payment_deposit' || t === 'cash_collection' || t === 'mill_payment_deposit') {
      const { data } = await supabase.rpc('order_close_status', { p_order: oid })
      const s = data as { buyer_value?: number; buyer_received?: number } | null
      if (s && s.buyer_value !== undefined) {
        const left = Math.max(0, Number(s.buyer_value) - Number(s.buyer_received ?? 0))
        setAmount(String(left))
        setHint(`Buyer value ₹${money(Number(s.buyer_value))}, received ₹${money(Number(s.buyer_received ?? 0))}.`)
      }
    } else {
      const { data } = await supabase.from('commission_invoices').select('amount,invoice_no').eq('order_id', oid).maybeSingle()
      if (data) {
        setAmount(String(data.amount))
        setHint(`Commission invoice ${data.invoice_no}.`)
      } else setHint('No commission invoice has been raised for this order yet.')
    }
  }

  async function save() {
    setErr(null)
    if (!orderId) return setErr('Choose the order.')
    const amt = amount.trim() === '' ? 0 : Number(amount)
    if (!Number.isFinite(amt) || amt < 0) return setErr('Enter a valid amount.')
    if (!due) return setErr('Enter the due date.')
    setBusy(true)
    const body = { order_id: orderId, task_type: type, due_date: due, assigned_to: assignee || null, amount_to_collect: amt, notes: notes.trim() || null }
    const res = task
      ? await supabase.from('collection_tasks').update({ ...body, status }).eq('id', task.id).select('id')
      : await supabase.from('collection_tasks').insert(body).select('id')
    setBusy(false)
    if (res.error) return setErr(errMessage(res.error, 'Could not save the task.'))
    if (!res.data || res.data.length === 0) return setErr('Your account cannot change collection tasks.')
    await onDone()
  }

  return (
    <Drawer title={task ? 'Edit collection task' : 'New collection task'} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <div className="form-grid">
        <Field id="ct-order" label="Order">
          <select id="ct-order" value={orderId} disabled={!!task} onChange={(e) => { setOrderId(e.target.value); void suggest(e.target.value, type) }}>
            <option value="">Choose an order</option>
            {orders.map((o) => (<option key={o.id} value={o.id}>{o.order_no} · {buyerName(o)}</option>))}
          </select>
        </Field>
        <Field id="ct-type" label="Task type">
          <select id="ct-type" value={type} onChange={(e) => { const t = e.target.value as CollectionTask['task_type']; setType(t); void suggest(orderId, t) }}>
            {Object.entries(TYPE).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
        </Field>
        <Field id="ct-due" label="Due date"><input id="ct-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field id="ct-who" label="Assigned to">
          <select id="ct-who" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {staff.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
          </select>
        </Field>
        <Field id="ct-amt" label="Amount to collect"><input id="ct-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {task && (
          <Field id="ct-status" label="Status">
            <select id="ct-status" value={status} onChange={(e) => setStatus(e.target.value as CollectionTask['status'])}>
              {Object.entries(STATUS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
          </Field>
        )}
        <Field id="ct-notes" label="Notes"><input id="ct-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {hint && <p className="muted small">{hint}</p>}
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </Drawer>
  )
}