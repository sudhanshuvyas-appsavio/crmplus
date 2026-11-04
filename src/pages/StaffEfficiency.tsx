/** Staff efficiency (admin).
 *
 *  One row per active user for a date range:
 *   - Entries posted: records the user created in the range (leads, deals, contacts,
 *     sales confirmations, orders, dispatches, payments, transport, job process,
 *     commission invoices, follow-ups, transporters, job processors, MD contacts).
 *   - Tasks completed: follow-ups the user marked done in the range.
 *   - Tasks pending: follow-ups the user created that are still open (overdue shown too).
 *   - Idle: no activity (an entry, a task done, an audited action or a login) for
 *     more than X hours up to now; X is set on the screen.
 *  Filters: date range, user role, department. Department is set per user here. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Loading } from '../components/Loading'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

interface Row {
  user_id: string
  name: string
  email: string
  job_title: string | null
  role: string
  department: string | null
  entries: number
  tasks_completed: number
  tasks_pending: number
  tasks_overdue: number
  last_activity: string | null
  idle_hours: number | null
  is_idle: boolean
}

const CSV_COLUMNS = ['name', 'email', 'role', 'department', 'entries_posted', 'tasks_completed', 'tasks_pending', 'tasks_overdue', 'last_activity', 'idle_hours', 'idle'] as const
const ROLE: Record<string, string> = { admin: 'Administrator', sales: 'Sales', management: 'Management', unassigned: 'No role' }
const roleLabel = (r: string) => ROLE[r] ?? r.charAt(0).toUpperCase() + r.slice(1)
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
function idleText(h: number | null) {
  if (h === null) return 'No activity'
  if (h < 1) return 'Under 1 h'
  if (h < 48) return `${h.toLocaleString('en-IN', { maximumFractionDigits: 1 })} h`
  return `${Math.round(h / 24)} days`
}

export default function StaffEfficiency() {
  const today = iso(new Date())
  const [from, setFrom] = useState(iso(new Date(Date.now() - 6 * 86400000)))
  const [to, setTo] = useState(today)
  const [idleH, setIdleH] = useState('4')
  const [data, setData] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fRole, setFRole] = useState('')
  const [fDept, setFDept] = useState('')
  const [busy, setBusy] = useState(false)

  const idleNum = Number(idleH) > 0 ? Number(idleH) : 4

  async function load() {
    setBusy(true)
    setError(null)
    const { data: d, error: e } = await supabase.rpc('staff_efficiency', { p_from: from, p_to: to, p_idle_hours: idleNum })
    setBusy(false)
    if (e) {
      setError(errMessage(e, 'Could not load staff efficiency'))
      setData([])
      return
    }
    setData(((d ?? []) as Row[]).map((r) => ({ ...r, entries: Number(r.entries), tasks_completed: Number(r.tasks_completed), tasks_pending: Number(r.tasks_pending), tasks_overdue: Number(r.tasks_overdue), idle_hours: r.idle_hours === null ? null : Number(r.idle_hours) })))
  }
  useEffect(() => {
    if (from && to && from <= to) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, idleNum])

  const roles = useMemo(() => [...new Set((data ?? []).map((r) => r.role))].sort(), [data])
  const depts = useMemo(() => [...new Set((data ?? []).map((r) => r.department).filter((x): x is string => !!x))].sort(), [data])
  const rows = useMemo(
    () => (data ?? []).filter((r) => (!fRole || r.role === fRole) && (!fDept || (fDept === '__none' ? !r.department : r.department === fDept))),
    [data, fRole, fDept],
  )
  const totals = rows.reduce((a, r) => ({ e: a.e + r.entries, c: a.c + r.tasks_completed, p: a.p + r.tasks_pending }), { e: 0, c: 0, p: 0 })
  const idleCount = rows.filter((r) => r.is_idle).length

  async function setDepartment(r: Row, value: string) {
    const v = value.trim() || null
    if (v === (r.department ?? null)) return
    const { data: upd, error: e } = await supabase.from('profiles').update({ department: v }).eq('id', r.user_id).select('id')
    if (e || !upd || upd.length === 0) return setError(e ? errMessage(e, 'Could not save the department') : 'Only an administrator can set a department.')
    setData((cur) => (cur ?? []).map((x) => (x.user_id === r.user_id ? { ...x, department: v } : x)))
  }

  function exportCSV() {
    const list = rows.map((r) => ({
      name: r.name, email: r.email, role: roleLabel(r.role), department: r.department ?? '', entries_posted: r.entries, tasks_completed: r.tasks_completed,
      tasks_pending: r.tasks_pending, tasks_overdue: r.tasks_overdue, last_activity: r.last_activity ?? '', idle_hours: r.idle_hours ?? '', idle: r.is_idle ? 'Yes' : 'No',
    }))
    downloadCSV(`staff-efficiency-${from}-to-${to}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!data) return <Loading label="Loading staff efficiency" />
  const badRange = !from || !to || from > to

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Staff efficiency</h1>
          <p className="page-sub">
            Entries and tasks for the chosen dates; idle means no activity for more than {idleNum} h up to now.
            {rows.length > 0 ? ` ${totals.e} entries, ${totals.c} tasks completed, ${totals.p} pending; ${idleCount} of ${rows.length} idle.` : ''}
          </p>
        </div>
        <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
      </header>
      {error && <div className="alert">{error}</div>}
      {badRange && <div className="alert">The start date must be on or before the end date.</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><input aria-label="From date" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} title="From date" /></div>
        <div className="field"><input aria-label="To date" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} title="To date" /></div>
        <div className="field"><select aria-label="User role" value={fRole} onChange={(e) => setFRole(e.target.value)}><option value="">All roles</option>{roles.map((r) => (<option key={r} value={r}>{roleLabel(r)}</option>))}</select></div>
        <div className="field"><select aria-label="Department" value={fDept} onChange={(e) => setFDept(e.target.value)}><option value="">All departments</option>{depts.map((d) => (<option key={d} value={d}>{d}</option>))}<option value="__none">No department</option></select></div>
        <div className="field"><label className="small">Idle after <input aria-label="Idle hours" type="number" min="1" step="1" value={idleH} onChange={(e) => setIdleH(e.target.value)} style={{ width: 64 }} /> hours</label></div>
        {(fRole || fDept) && <div className="field"><button className="btn ghost" type="button" onClick={() => { setFRole(''); setFDept('') }}>Clear filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{busy ? 'Loading…' : data.length === 0 ? 'No active users.' : 'No user matches these filters.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th><th>Role</th><th>Department</th><th className="right">Entries posted</th><th className="right">Tasks completed</th>
                <th className="right">Tasks pending</th><th>Last activity</th><th>Idle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td>{r.name}<div className="small muted">{r.job_title || r.email}</div></td>
                  <td><span className="chip">{roleLabel(r.role)}</span></td>
                  <td>
                    <input
                      key={r.user_id + (r.department ?? '')}
                      aria-label={`Department for ${r.name}`}
                      list="dept-list"
                      defaultValue={r.department ?? ''}
                      placeholder="Set department"
                      style={{ width: 150 }}
                      onBlur={(e) => void setDepartment(r, e.target.value)}
                    />
                  </td>
                  <td className="right mono"><strong>{r.entries}</strong></td>
                  <td className="right mono">{r.tasks_completed}</td>
                  <td className="right mono">{r.tasks_pending}{r.tasks_overdue > 0 && <span className="chip bad" style={{ marginLeft: 6 }}>{r.tasks_overdue} overdue</span>}</td>
                  <td className="mono small">{r.last_activity ? new Date(r.last_activity).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                  <td>{r.is_idle ? <span className="chip warn">Idle {idleText(r.idle_hours)}</span> : <span className="chip good">Active · {idleText(r.idle_hours)} ago</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="dept-list">{depts.map((d) => (<option key={d} value={d} />))}</datalist>
        </div>
      )}
    </>
  )
}