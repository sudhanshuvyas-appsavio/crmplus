/** Pending dispatches report.
 *
 *  Orders that are Confirmed or Open for Execution and still have quantity left
 *  to dispatch. Filters: party (buyer), mill (supplier), tentative dispatch date
 *  range, our company and count. Days overdue = days past the tentative dispatch
 *  date while a balance remains (0 when not yet due). */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CountRow, Order } from '../api/types'
import { Loading } from '../components/Loading'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

type Named = { id: string; name: string }

const CSV_COLUMNS = ['order_no', 'status', 'buyer', 'supplier', 'count', 'uom', 'total_qty', 'dispatched_qty', 'balance_qty', 'tentative_dispatch_date', 'days_overdue'] as const
const STATUS: Record<string, string> = { confirmed: 'Confirmed', open_for_execution: 'Open for Execution' }

const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 })
function overdue(date: string | null): number {
  if (!date) return 0
  const today = new Date()
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const d = Date.parse(date + 'T00:00:00Z')
  return Math.max(0, Math.round((t - d) / 86400000))
}

export default function PendingDispatches() {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [sums, setSums] = useState<Map<string, number>>(new Map())
  const [buyers, setBuyers] = useState<Named[]>([])
  const [suppliers, setSuppliers] = useState<Named[]>([])
  const [companies, setCompanies] = useState<Named[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fBuyer, setFBuyer] = useState('')
  const [fSupplier, setFSupplier] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fCount, setFCount] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [onlyOverdue, setOnlyOverdue] = useState(false)

  useEffect(() => {
    void (async () => {
      const [o, d, b, s, c, k] = await Promise.all([
        supabase.from('orders').select('*').in('status', ['confirmed', 'open_for_execution']).order('tentative_dispatch_date', { ascending: true, nullsFirst: false }),
        supabase.from('order_dispatches').select('order_id,quantity'),
        supabase.from('buyer_master').select('id,name').order('name'),
        supabase.from('supplier_master').select('id,name').order('name'),
        supabase.from('companies').select('id,name').order('name'),
        supabase.from('count_master').select('*'),
      ])
      if (o.error) setError(errMessage(o.error, 'Could not load the report'))
      const m = new Map<string, number>()
      for (const x of (d.data ?? []) as { order_id: string; quantity: number }[]) m.set(x.order_id, (m.get(x.order_id) ?? 0) + Number(x.quantity))
      setSums(m)
      setOrders((o.data ?? []) as Order[])
      setBuyers((b.data ?? []) as Named[])
      setSuppliers((s.data ?? []) as Named[])
      setCompanies((c.data ?? []) as Named[])
      setCounts((k.data ?? []) as CountRow[])
    })()
  }, [])

  const nm = (list: Named[], id: string) => list.find((x) => x.id === id)?.name ?? '—'
  const countName = useMemo(() => new Map(counts.map((x) => [x.id, x.display_name])), [counts])

  const rows = useMemo(() => {
    return (orders ?? [])
      .map((x) => {
        const done = sums.get(x.id) ?? 0
        return { order: x, done, balance: Number(x.quantity) - done, late: x.status === 'closed' ? 0 : overdue(x.tentative_dispatch_date) }
      })
      .filter(({ order: x, balance, late }) => {
        if (balance <= 0) return false
        if (fBuyer && x.buyer_id !== fBuyer) return false
        if (fSupplier && x.supplier_id !== fSupplier) return false
        if (fCompany && x.company_id !== fCompany) return false
        if (fCount && x.count_id !== fCount) return false
        if (from && (!x.tentative_dispatch_date || x.tentative_dispatch_date < from)) return false
        if (to && (!x.tentative_dispatch_date || x.tentative_dispatch_date > to)) return false
        if (onlyOverdue && late === 0) return false
        return true
      })
      .sort((a, b) => b.late - a.late || (a.order.tentative_dispatch_date ?? '9999').localeCompare(b.order.tentative_dispatch_date ?? '9999'))
  }, [orders, sums, fBuyer, fSupplier, fCompany, fCount, from, to, onlyOverdue])

  function exportCSV() {
    const list = rows.map(({ order: x, done, balance, late }) => ({
      order_no: x.order_no, status: STATUS[x.status] ?? x.status, buyer: nm(buyers, x.buyer_id), supplier: nm(suppliers, x.supplier_id),
      count: countName.get(x.count_id) ?? '', uom: x.uom, total_qty: x.quantity, dispatched_qty: done, balance_qty: balance,
      tentative_dispatch_date: x.tentative_dispatch_date ?? '', days_overdue: late,
    }))
    downloadCSV(`pending-dispatches-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  function clear() {
    setFBuyer(''); setFSupplier(''); setFCompany(''); setFCount(''); setFrom(''); setTo(''); setOnlyOverdue(false)
  }

  if (!orders) return <Loading label="Loading pending dispatches" />
  const filtered = fBuyer || fSupplier || fCompany || fCount || from || to || onlyOverdue
  const lateCount = rows.filter((r) => r.late > 0).length

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Pending dispatches</h1>
          <p className="page-sub">Confirmed orders with quantity still to dispatch, most overdue first.{rows.length > 0 ? ` ${lateCount} of ${rows.length} overdue.` : ''}</p>
        </div>
        <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
      </header>
      {error && <div className="alert">{error}</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><select aria-label="Party (buyer)" value={fBuyer} onChange={(e) => setFBuyer(e.target.value)}><option value="">All parties</option>{buyers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Mill (supplier)" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}><option value="">All mills</option>{suppliers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Company" value={fCompany} onChange={(e) => setFCompany(e.target.value)}><option value="">All companies</option>{companies.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Count" value={fCount} onChange={(e) => setFCount(e.target.value)}><option value="">All counts</option>{counts.map((x) => (<option key={x.id} value={x.id}>{x.display_name}</option>))}</select></div>
        <div className="field"><input aria-label="Dispatch date from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Tentative dispatch from" /></div>
        <div className="field"><input aria-label="Dispatch date to" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Tentative dispatch to" /></div>
        <div className="field"><label className="small"><input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> Overdue only</label></div>
        {filtered && <div className="field"><button className="btn ghost" type="button" onClick={clear}>Clear filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{orders.length === 0 ? 'No confirmed orders yet.' : 'No pending dispatch matches these filters.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order no.</th><th>Status</th><th>Buyer</th><th>Supplier</th><th>Count</th>
                <th className="right">Total qty</th><th className="right">Dispatched</th><th className="right">Balance</th>
                <th>Tentative dispatch</th><th className="right">Days overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ order: x, done, balance, late }) => (
                <tr key={x.id}>
                  <td className="mono">{x.order_no}</td>
                  <td><span className="chip">{STATUS[x.status] ?? x.status}</span></td>
                  <td>{nm(buyers, x.buyer_id)}</td>
                  <td>{nm(suppliers, x.supplier_id)}</td>
                  <td className="small">{countName.get(x.count_id) ?? '—'}</td>
                  <td className="right mono">{qty(Number(x.quantity))} {x.uom}</td>
                  <td className="right mono">{qty(done)}</td>
                  <td className="right mono"><strong>{qty(balance)}</strong></td>
                  <td className="mono small">{x.tentative_dispatch_date ?? '—'}</td>
                  <td className="right mono">{late > 0 ? <span className="chip bad">{late}</span> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}