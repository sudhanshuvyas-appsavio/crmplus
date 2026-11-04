/** Monthly cheque collection report.
 *
 *  A register of cheques collected from parties against orders. Status is
 *  Deposited once a deposit date is recorded, otherwise Pending. Defaults to the
 *  current month. Filters: collection date range, collection staff, mill
 *  (supplier of the order), party (buyer) and status. Collection managers
 *  (order.manage) record cheques and mark them deposited. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ChequeCollection, Order } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

type Named = { id: string; name: string }

const CSV_COLUMNS = ['cheque_no', 'bank', 'amount', 'collection_date', 'collected_by', 'status', 'deposited_on', 'party', 'mill', 'order_no'] as const
const money = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)) }

export default function ChequeCollections() {
  const { can } = useAuth()
  const canManage = can('order.manage')
  const today = iso(new Date())
  const [cheques, setCheques] = useState<ChequeCollection[] | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [buyers, setBuyers] = useState<Named[]>([])
  const [suppliers, setSuppliers] = useState<Named[]>([])
  const [staff, setStaff] = useState<Named[]>([])
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today)
  const [fStaff, setFStaff] = useState('')
  const [fSupplier, setFSupplier] = useState('')
  const [fBuyer, setFBuyer] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [editing, setEditing] = useState<ChequeCollection | 'new' | null>(null)
  const [depositNow, setDepositNow] = useState(false)

  async function load() {
    const [c, o, b, s, p] = await Promise.all([
      supabase.from('cheque_collections').select('*').order('collection_date', { ascending: false }),
      supabase.from('orders').select('*'),
      supabase.from('buyer_master').select('id,name').order('name'),
      supabase.from('supplier_master').select('id,name').order('name'),
      supabase.from('profiles').select('id,name').eq('is_active', true).order('name'),
    ])
    if (c.error) setError(errMessage(c.error, 'Could not load the cheques'))
    setCheques((c.data ?? []) as ChequeCollection[])
    setOrders((o.data ?? []) as Order[])
    setBuyers((b.data ?? []) as Named[])
    setSuppliers((s.data ?? []) as Named[])
    setStaff((p.data ?? []) as Named[])
  }
  useEffect(() => {
    void load()
  }, [])

  const orderOf = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const nm = (list: Named[], id: string | null | undefined, empty = '—') => (id ? list.find((x) => x.id === id)?.name ?? empty : empty)

  const rows = useMemo(
    () =>
      (cheques ?? []).filter((x) => {
        const o = orderOf.get(x.order_id)
        if (!o) return false
        if (from && x.collection_date < from) return false
        if (to && x.collection_date > to) return false
        if (fStaff && (fStaff === '__none' ? x.collected_by : x.collected_by !== fStaff)) return false
        if (fSupplier && o.supplier_id !== fSupplier) return false
        if (fBuyer && o.buyer_id !== fBuyer) return false
        if (fStatus === 'deposited' && !x.deposited_on) return false
        if (fStatus === 'pending' && x.deposited_on) return false
        return true
      }),
    [cheques, orderOf, from, to, fStaff, fSupplier, fBuyer, fStatus],
  )
  const total = rows.reduce((a, x) => a + Number(x.amount), 0)
  const pending = rows.filter((x) => !x.deposited_on)
  const pendingTotal = pending.reduce((a, x) => a + Number(x.amount), 0)

  function exportCSV() {
    const list = rows.map((x) => {
      const o = orderOf.get(x.order_id)
      return {
        cheque_no: x.cheque_no, bank: x.bank_name ?? '', amount: x.amount, collection_date: x.collection_date, collected_by: nm(staff, x.collected_by, ''),
        status: x.deposited_on ? 'Deposited' : 'Pending', deposited_on: x.deposited_on ?? '', party: o ? nm(buyers, o.buyer_id, '') : '', mill: o ? nm(suppliers, o.supplier_id, '') : '', order_no: o?.order_no ?? '',
      }
    })
    downloadCSV(`cheque-collection-${from}-to-${to}.csv`, toCSV(CSV_COLUMNS, list))
  }

  function clear() {
    setFrom(monthStart()); setTo(today); setFStaff(''); setFSupplier(''); setFBuyer(''); setFStatus('')
  }

  if (!cheques) return <Loading label="Loading cheque collection" />
  const changed = from !== monthStart() || to !== today || fStaff || fSupplier || fBuyer || fStatus

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Cheque collection</h1>
          <p className="page-sub">
            Cheques collected in the chosen dates (this month by default).{rows.length > 0 ? ` ${rows.length} cheque${rows.length === 1 ? '' : 's'}, ₹${money(total)}; ${pending.length} pending deposit (₹${money(pendingTotal)}).` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canManage && <button className="btn primary" type="button" onClick={() => { setDepositNow(false); setEditing('new') }}>Record cheque</button>}
          <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      {from && to && from > to && <div className="alert">The start date must be on or before the end date.</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><input aria-label="Collected from" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} title="Collected from" /></div>
        <div className="field"><input aria-label="Collected to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} title="Collected to" /></div>
        <div className="field"><select aria-label="Collection staff" value={fStaff} onChange={(e) => setFStaff(e.target.value)}><option value="">All staff</option>{staff.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}<option value="__none">Not recorded</option></select></div>
        <div className="field"><select aria-label="Mill (supplier)" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}><option value="">All mills</option>{suppliers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Party (buyer)" value={fBuyer} onChange={(e) => setFBuyer(e.target.value)}><option value="">All parties</option>{buyers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">Deposited and pending</option><option value="deposited">Deposited</option><option value="pending">Pending</option></select></div>
        {changed && <div className="field"><button className="btn ghost" type="button" onClick={clear}>Reset filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{cheques.length === 0 ? 'No cheques recorded yet.' : 'No cheque matches these filters.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cheque no.</th><th className="right">Amount</th><th>Collection date</th><th>Collected by</th><th>Status</th><th>Party</th><th>Mill</th><th>Order</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const o = orderOf.get(x.order_id)
                return (
                  <tr key={x.id}>
                    <td className="mono">{x.cheque_no}{x.bank_name && <div className="small muted">{x.bank_name}</div>}</td>
                    <td className="right mono"><strong>{money(Number(x.amount))}</strong></td>
                    <td className="mono small">{x.collection_date}</td>
                    <td>{nm(staff, x.collected_by, 'Not recorded')}</td>
                    <td>{x.deposited_on ? <span className="chip good">Deposited</span> : <span className="chip warn">Pending</span>}{x.deposited_on && <span className="muted small"> {x.deposited_on}</span>}</td>
                    <td>{o ? nm(buyers, o.buyer_id) : '—'}</td>
                    <td>{o ? nm(suppliers, o.supplier_id) : '—'}</td>
                    <td className="mono small">{o?.order_no}</td>
                    {canManage && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {!x.deposited_on && <button className="btn ghost sm" type="button" onClick={() => { setDepositNow(true); setEditing(x) }}>Mark deposited</button>}
                        <button className="btn ghost sm" type="button" onClick={() => { setDepositNow(false); setEditing(x) }}>Edit</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ChequeDrawer
          key={editing === 'new' ? 'new' : editing.id}
          cheque={editing === 'new' ? null : editing}
          depositNow={depositNow}
          orders={orders.filter((o) => o.status !== 'draft')}
          label={(o) => `${o.order_no} · ${nm(buyers, o.buyer_id)} / ${nm(suppliers, o.supplier_id)}`}
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

function ChequeDrawer({ cheque, depositNow, orders, label, staff, onClose, onDone }: {
  cheque: ChequeCollection | null
  depositNow: boolean
  orders: Order[]
  label: (o: Order) => string
  staff: Named[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { me } = useAuth()
  const [orderId, setOrderId] = useState(cheque?.order_id ?? '')
  const [no, setNo] = useState(cheque?.cheque_no ?? '')
  const [bank, setBank] = useState(cheque?.bank_name ?? '')
  const [amount, setAmount] = useState(cheque ? String(cheque.amount) : '')
  const [date, setDate] = useState(cheque?.collection_date ?? iso(new Date()))
  const [by, setBy] = useState(cheque?.collected_by ?? me?.id ?? '')
  const [dep, setDep] = useState(cheque?.deposited_on ?? (depositNow ? iso(new Date()) : ''))
  const [depBank, setDepBank] = useState(cheque?.deposit_bank ?? '')
  const [slip, setSlip] = useState(cheque?.slip_no ?? '')
  const [notes, setNotes] = useState(cheque?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    if (!orderId) return setErr('Choose the order.')
    if (!no.trim()) return setErr('Enter the cheque number.')
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) return setErr('Enter an amount greater than zero.')
    if (!date) return setErr('Enter the collection date.')
    if (dep && (!depBank.trim() || !slip.trim())) return setErr('Enter the deposit bank and the slip number.')
    setBusy(true)
    const body = { order_id: orderId, cheque_no: no.trim(), bank_name: bank.trim() || null, amount: amt, collection_date: date, collected_by: by || null, deposited_on: dep || null, deposit_bank: dep ? depBank.trim() : null, slip_no: dep ? slip.trim() : null, notes: notes.trim() || null }
    const res = cheque
      ? await supabase.from('cheque_collections').update(body).eq('id', cheque.id).select('id')
      : await supabase.from('cheque_collections').insert(body).select('id')
    setBusy(false)
    if (res.error) {
      const msg = res.error.message ?? ''
      if (msg.includes('cheque_collections_no_bank')) return setErr('This cheque number is already recorded for this bank.')
      if (msg.includes('cheque_collections_check')) return setErr('The deposit date cannot be before the collection date.')
      return setErr(errMessage(res.error, 'Could not save the cheque.'))
    }
    if (!res.data || res.data.length === 0) return setErr('Your account cannot change cheques.')
    await onDone()
  }

  return (
    <Drawer title={cheque ? 'Edit cheque' : 'Record cheque'} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <div className="form-grid">
        <Field id="cq-order" label="Order">
          <select id="cq-order" value={orderId} disabled={!!cheque} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">Choose an order</option>
            {orders.map((o) => (<option key={o.id} value={o.id}>{label(o)}</option>))}
          </select>
        </Field>
        <Field id="cq-no" label="Cheque no."><input id="cq-no" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
        <Field id="cq-bank" label="Bank"><input id="cq-bank" value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
        <Field id="cq-amt" label="Amount"><input id="cq-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field id="cq-date" label="Collection date"><input id="cq-date" type="date" max={iso(new Date())} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field id="cq-by" label="Collected by">
          <select id="cq-by" value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="">Not recorded</option>
            {staff.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
          </select>
        </Field>
        <Field id="cq-dep" label="Deposited on"><input id="cq-dep" type="date" min={date} max={iso(new Date())} value={dep} onChange={(e) => setDep(e.target.value)} /></Field>
        <Field id="cq-dbank" label="Deposit bank"><input id="cq-dbank" value={depBank} disabled={!dep} onChange={(e) => setDepBank(e.target.value)} placeholder="Bank we deposited into" /></Field>
        <Field id="cq-slip" label="Slip no."><input id="cq-slip" value={slip} disabled={!dep} onChange={(e) => setSlip(e.target.value)} /></Field>
        <Field id="cq-notes" label="Notes"><input id="cq-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <p className="muted small">Leave "Deposited on" empty while the cheque is still with us. Once you set it, the deposit bank and slip number are needed; they appear on the Cheque deposited report.</p>
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </Drawer>
  )
}