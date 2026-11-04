/** Staff performance (management).
 *
 *  Separate views for Collection staff and Office staff, for a date range.
 *   - Tasks completed %: of the non-cancelled tasks assigned to the person and due in
 *     the range, how many are Done.
 *   - Entries posted: records the person created in the range.
 *   - Cheques collected / Invoices delivered / Payments deposited: Done tasks of that
 *     type (Collection tasks screen) completed in the range, with amounts for cheques
 *     and deposits.
 *  Who is collection or office staff is set per user here by an administrator. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

interface Row {
  user_id: string
  name: string
  email: string
  role: string
  department: string | null
  staff_type: 'collection' | 'office' | null
  entries: number
  tasks_total: number
  tasks_done: number
  completed_pct: number | null
  cheques_collected: number
  cheque_amount: number
  invoices_delivered: number
  payments_deposited: number
  deposit_amount: number
}

type View = 'collection' | 'office' | 'unset'
const VIEW_LABEL: Record<View, string> = { collection: 'Collection staff', office: 'Office staff', unset: 'Not classified' }
const CSV_COLUMNS = ['name', 'staff_type', 'department', 'tasks_completed_pct', 'tasks_done', 'tasks_total', 'entries_posted', 'cheques_collected', 'cheque_amount', 'invoices_delivered', 'payments_deposited', 'deposit_amount'] as const
const money = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)

export default function StaffPerformance() {
  const { can } = useAuth()
  const canClassify = can('user.manage')
  const today = iso(new Date())
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)))
  const [to, setTo] = useState(today)
  const [data, setData] = useState<Row[] | null>(null)
  const [view, setView] = useState<View>('collection')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    const { data: d, error: e } = await supabase.rpc('staff_performance', { p_from: from, p_to: to })
    if (e) {
      setError(errMessage(e, 'Could not load staff performance'))
      setData([])
      return
    }
    setData(((d ?? []) as Row[]).map((r) => ({
      ...r, entries: Number(r.entries), tasks_total: Number(r.tasks_total), tasks_done: Number(r.tasks_done),
      completed_pct: r.completed_pct === null ? null : Number(r.completed_pct), cheques_collected: Number(r.cheques_collected), cheque_amount: Number(r.cheque_amount),
      invoices_delivered: Number(r.invoices_delivered), payments_deposited: Number(r.payments_deposited), deposit_amount: Number(r.deposit_amount),
    })))
  }
  useEffect(() => {
    if (from && to && from <= to) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  const viewOf = (r: Row): View => r.staff_type ?? 'unset'
  const unsetCount = (data ?? []).filter((r) => !r.staff_type).length
  const rows = useMemo(() => (data ?? []).filter((r) => viewOf(r) === view).sort((a, b) => (b.completed_pct ?? -1) - (a.completed_pct ?? -1) || b.entries - a.entries), [data, view])

  async function classify(r: Row, value: string) {
    const v = value === 'collection' || value === 'office' ? value : null
    if (v === r.staff_type) return
    const { data: upd, error: e } = await supabase.from('profiles').update({ staff_type: v }).eq('id', r.user_id).select('id')
    if (e || !upd || upd.length === 0) return setError(e ? errMessage(e, 'Could not save the staff type') : 'Only an administrator can set the staff type.')
    setData((cur) => (cur ?? []).map((x) => (x.user_id === r.user_id ? { ...x, staff_type: v } : x)))
  }

  function exportCSV() {
    const list = rows.map((r) => ({
      name: r.name, staff_type: VIEW_LABEL[viewOf(r)], department: r.department ?? '', tasks_completed_pct: r.completed_pct ?? '', tasks_done: r.tasks_done, tasks_total: r.tasks_total,
      entries_posted: r.entries, cheques_collected: r.cheques_collected, cheque_amount: r.cheque_amount, invoices_delivered: r.invoices_delivered,
      payments_deposited: r.payments_deposited, deposit_amount: r.deposit_amount,
    }))
    downloadCSV(`staff-performance-${view}-${from}-to-${to}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!data) return <Loading label="Loading staff performance" />
  const views: View[] = unsetCount > 0 || view === 'unset' ? ['collection', 'office', 'unset'] : ['collection', 'office']
  const badRange = !from || !to || from > to

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Staff performance</h1>
          <p className="page-sub">Tasks completed, entries and collection work per person for the chosen dates, best completion first.</p>
        </div>
        <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
      </header>
      {error && <div className="alert">{error}</div>}
      {badRange && <div className="alert">The start date must be on or before the end date.</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><input aria-label="From date" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} title="From date" /></div>
        <div className="field"><input aria-label="To date" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} title="To date" /></div>
        <div className="field" style={{ display: 'flex', gap: 6 }} role="tablist" aria-label="Staff view">
          {views.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={`btn ${view === v ? 'primary' : 'ghost'}`} onClick={() => setView(v)}>
              {VIEW_LABEL[v]} ({(data ?? []).filter((r) => viewOf(r) === v).length})
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">
          {view === 'unset' ? 'Everyone is classified.' : `No one is marked as ${VIEW_LABEL[view].toLowerCase()} yet.${canClassify && unsetCount > 0 ? ' Open "Not classified" to choose who belongs here.' : ''}`}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th><th>Staff type</th><th className="right">Tasks completed</th><th className="right">Entries posted</th>
                <th className="right">Cheques collected</th><th className="right">Invoices delivered</th><th className="right">Payments deposited</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td>{r.name}<div className="small muted">{r.department || r.email}</div></td>
                  <td>
                    {canClassify ? (
                      <select aria-label={`Staff type for ${r.name}`} value={r.staff_type ?? ''} onChange={(e) => void classify(r, e.target.value)}>
                        <option value="">Not classified</option><option value="collection">Collection staff</option><option value="office">Office staff</option>
                      </select>
                    ) : (<span className="chip">{VIEW_LABEL[viewOf(r)]}</span>)}
                  </td>
                  <td className="right mono">{r.completed_pct === null ? '—' : <strong>{r.completed_pct}%</strong>}<div className="small muted">{r.tasks_done} of {r.tasks_total}</div></td>
                  <td className="right mono"><strong>{r.entries}</strong></td>
                  <td className="right mono">{r.cheques_collected}{r.cheques_collected > 0 && <div className="small muted">₹{money(r.cheque_amount)}</div>}</td>
                  <td className="right mono">{r.invoices_delivered}</td>
                  <td className="right mono">{r.payments_deposited}{r.payments_deposited > 0 && <div className="small muted">₹{money(r.deposit_amount)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}