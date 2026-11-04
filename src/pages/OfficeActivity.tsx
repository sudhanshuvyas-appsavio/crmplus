/** Office entry activity report.
 *
 *  What each office person entered, per day or per month:
 *   - Receipt entries (buyer receipts recorded on an order, with amount)
 *   - Confirmations sent (sales confirmations sent to a party)
 *   - Dispatch entries
 *   - Billing entries (mill invoice details recorded on a dispatch)
 *   - Commission bills printed (Print on the order's commission invoice)
 *   - Transport invoices raised (transporter invoice recorded on a dispatch)
 *   - Payment entries made (supplier payments recorded on an order, with amount)
 *  Counted on the day of entry (India time). Filters: date range and staff. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Loading } from '../components/Loading'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

interface Row {
  activity_date: string
  user_id: string
  name: string
  receipt_entries: number
  receipt_amount: number
  confirmations_sent: number
  dispatch_entries: number
  billing_entries: number
  bills_printed: number
  transport_invoices: number
  payment_entries: number
  payment_amount: number
}
type Named = { id: string; name: string }
type Grain = 'daily' | 'monthly'

const NUM = ['receipt_entries', 'receipt_amount', 'confirmations_sent', 'dispatch_entries', 'billing_entries', 'bills_printed', 'transport_invoices', 'payment_entries', 'payment_amount'] as const
const CSV_COLUMNS = ['period', 'staff', 'receipt_entries', 'receipt_amount', 'confirmations_sent', 'dispatch_entries', 'billing_entries', 'commission_bills_printed', 'transport_invoices_raised', 'payment_entries', 'payment_amount'] as const
const money = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)) }

function Cell({ n, amt }: { n: number; amt?: number }) {
  return (
    <td className="right mono">
      {n}
      {amt !== undefined && n > 0 && <div className="small muted">₹{money(amt)}</div>}
    </td>
  )
}

export default function OfficeActivity() {
  const today = iso(new Date())
  const [data, setData] = useState<Row[] | null>(null)
  const [staff, setStaff] = useState<Named[]>([])
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today)
  const [fStaff, setFStaff] = useState('')
  const [grain, setGrain] = useState<Grain>('daily')

  useEffect(() => {
    void (async () => {
      const p = await supabase.from('profiles').select('id,name').eq('is_active', true).order('name')
      setStaff((p.data ?? []) as Named[])
    })()
  }, [])
  useEffect(() => {
    if (!from || !to || from > to) return
    void (async () => {
      const { data: d, error: e } = await supabase.rpc('office_activity', { p_from: from, p_to: to })
      if (e) {
        setError(errMessage(e, 'Could not load the activity report'))
        setData([])
        return
      }
      setError(null)
      setData(((d ?? []) as Record<string, unknown>[]).map((r) => {
        const o = { ...r } as unknown as Row
        for (const k of NUM) (o as unknown as Record<string, number>)[k] = Number(r[k])
        return o
      }))
    })()
  }, [from, to])

  const rows = useMemo(() => {
    const m = new Map<string, Row>()
    for (const r of data ?? []) {
      if (fStaff && r.user_id !== fStaff) continue
      const period = grain === 'daily' ? r.activity_date : r.activity_date.slice(0, 7)
      const key = `${period}|${r.user_id}`
      const cur = m.get(key) ?? ({ ...r, activity_date: period, ...Object.fromEntries(NUM.map((k) => [k, 0])) } as Row)
      for (const k of NUM) cur[k] += r[k]
      m.set(key, cur)
    }
    return [...m.values()].sort((a, b) => b.activity_date.localeCompare(a.activity_date) || a.name.localeCompare(b.name))
  }, [data, fStaff, grain])

  const totals = useMemo(() => {
    const t = Object.fromEntries(NUM.map((k) => [k, 0])) as Record<(typeof NUM)[number], number>
    for (const r of rows) for (const k of NUM) t[k] += r[k]
    return t
  }, [rows])

  function exportCSV() {
    const list = rows.map((r) => ({
      period: r.activity_date, staff: r.name, receipt_entries: r.receipt_entries, receipt_amount: r.receipt_amount, confirmations_sent: r.confirmations_sent,
      dispatch_entries: r.dispatch_entries, billing_entries: r.billing_entries, commission_bills_printed: r.bills_printed, transport_invoices_raised: r.transport_invoices,
      payment_entries: r.payment_entries, payment_amount: r.payment_amount,
    }))
    downloadCSV(`office-activity-${grain}-${from}-to-${to}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!data) return <Loading label="Loading office activity" />
  const changed = from !== monthStart() || to !== today || fStaff || grain !== 'daily'

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Office activity</h1>
          <p className="page-sub">Entries made by each office person, by {grain === 'daily' ? 'day' : 'month'}.</p>
        </div>
        <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
      </header>
      {error && <div className="alert">{error}</div>}
      {from && to && from > to && <div className="alert">The start date must be on or before the end date.</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><input aria-label="From date" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} title="From date" /></div>
        <div className="field"><input aria-label="To date" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} title="To date" /></div>
        <div className="field"><select aria-label="Staff" value={fStaff} onChange={(e) => setFStaff(e.target.value)}><option value="">All staff</option>{staff.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Group by" value={grain} onChange={(e) => setGrain(e.target.value as Grain)}><option value="daily">Daily</option><option value="monthly">Monthly</option></select></div>
        {changed && <div className="field"><button className="btn ghost" type="button" onClick={() => { setFrom(monthStart()); setTo(today); setFStaff(''); setGrain('daily') }}>Reset filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{data.length === 0 ? 'No office entries in these dates.' : 'No entries for this staff member in these dates.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{grain === 'daily' ? 'Date' : 'Month'}</th><th>Staff</th><th className="right">Receipt entries</th><th className="right">Confirmations sent</th><th className="right">Dispatch entries</th>
                <th className="right">Billing entries</th><th className="right">Commission bills printed</th><th className="right">Transport invoices raised</th><th className="right">Payment entries made</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.activity_date}|${r.user_id}`}>
                  <td className="mono small">{r.activity_date}</td>
                  <td>{r.name}</td>
                  <Cell n={r.receipt_entries} amt={r.receipt_amount} />
                  <Cell n={r.confirmations_sent} />
                  <Cell n={r.dispatch_entries} />
                  <Cell n={r.billing_entries} />
                  <Cell n={r.bills_printed} />
                  <Cell n={r.transport_invoices} />
                  <Cell n={r.payment_entries} amt={r.payment_amount} />
                </tr>
              ))}
              <tr>
                <td colSpan={2}><strong>Total</strong></td>
                <Cell n={totals.receipt_entries} amt={totals.receipt_amount} />
                <Cell n={totals.confirmations_sent} />
                <Cell n={totals.dispatch_entries} />
                <Cell n={totals.billing_entries} />
                <Cell n={totals.bills_printed} />
                <Cell n={totals.transport_invoices} />
                <Cell n={totals.payment_entries} amt={totals.payment_amount} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}