/** Daily / monthly collection activity report.
 *
 *  What each person did, per day or per month:
 *   - Cheques collected (cheque register, by collection date, with amount)
 *   - Cash collected (Done "Cash collection" tasks, with amount)
 *   - Invoices delivered and Delivery notes taken (Done tasks)
 *   - Mill payments deposited (Done "Mill payment deposit" tasks, with amount)
 *   - Cheques deposited in bank (cheque register, by deposit date, credited to the
 *     person who recorded the deposit, with amount)
 *  Tasks count on the day they were marked Done (India time). Filters: date range
 *  and staff. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Loading } from '../components/Loading'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

interface Row {
  activity_date: string
  user_id: string
  name: string
  cheques_collected: number
  cheques_amount: number
  cash_collections: number
  cash_amount: number
  invoices_delivered: number
  delivery_notes: number
  mill_deposits: number
  mill_deposit_amount: number
  cheques_deposited: number
  cheques_deposited_amount: number
}
type Named = { id: string; name: string }
type Grain = 'daily' | 'monthly'

const NUM = ['cheques_collected', 'cheques_amount', 'cash_collections', 'cash_amount', 'invoices_delivered', 'delivery_notes', 'mill_deposits', 'mill_deposit_amount', 'cheques_deposited', 'cheques_deposited_amount'] as const
const CSV_COLUMNS = ['period', 'staff', 'cheques_collected', 'cheques_amount', 'cash_collections', 'cash_amount', 'invoices_delivered', 'delivery_notes', 'mill_payments_deposited', 'mill_deposit_amount', 'cheques_deposited', 'cheques_deposited_amount'] as const
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

export default function CollectionActivity() {
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
      const { data: d, error: e } = await supabase.rpc('collection_activity', { p_from: from, p_to: to })
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
      period: r.activity_date, staff: r.name, cheques_collected: r.cheques_collected, cheques_amount: r.cheques_amount, cash_collections: r.cash_collections, cash_amount: r.cash_amount,
      invoices_delivered: r.invoices_delivered, delivery_notes: r.delivery_notes, mill_payments_deposited: r.mill_deposits, mill_deposit_amount: r.mill_deposit_amount,
      cheques_deposited: r.cheques_deposited, cheques_deposited_amount: r.cheques_deposited_amount,
    }))
    downloadCSV(`collection-activity-${grain}-${from}-to-${to}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!data) return <Loading label="Loading collection activity" />
  const changed = from !== monthStart() || to !== today || fStaff || grain !== 'daily'

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Collection activity</h1>
          <p className="page-sub">What each person collected, delivered and deposited, by {grain === 'daily' ? 'day' : 'month'}.</p>
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
        <div className="card pad empty">{data.length === 0 ? 'No collection activity in these dates.' : 'No activity for this staff member in these dates.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{grain === 'daily' ? 'Date' : 'Month'}</th><th>Staff</th><th className="right">Cheques collected</th><th className="right">Cash collected</th>
                <th className="right">Invoices delivered</th><th className="right">Delivery notes taken</th><th className="right">Mill payments deposited</th><th className="right">Cheques deposited in bank</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.activity_date}|${r.user_id}`}>
                  <td className="mono small">{r.activity_date}</td>
                  <td>{r.name}</td>
                  <Cell n={r.cheques_collected} amt={r.cheques_amount} />
                  <Cell n={r.cash_collections} amt={r.cash_amount} />
                  <Cell n={r.invoices_delivered} />
                  <Cell n={r.delivery_notes} />
                  <Cell n={r.mill_deposits} amt={r.mill_deposit_amount} />
                  <Cell n={r.cheques_deposited} amt={r.cheques_deposited_amount} />
                </tr>
              ))}
              <tr>
                <td colSpan={2}><strong>Total</strong></td>
                <Cell n={totals.cheques_collected} amt={totals.cheques_amount} />
                <Cell n={totals.cash_collections} amt={totals.cash_amount} />
                <Cell n={totals.invoices_delivered} />
                <Cell n={totals.delivery_notes} />
                <Cell n={totals.mill_deposits} amt={totals.mill_deposit_amount} />
                <Cell n={totals.cheques_deposited} amt={totals.cheques_deposited_amount} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}