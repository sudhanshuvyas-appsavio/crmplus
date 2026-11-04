/** Vehicle maintenance and staff expense report.
 *
 *  Monthly summary per staff member or driver: petrol, service charges, food,
 *  advance taken, Diwali bonus, and attendance with leave. People are kept in
 *  their own list (drivers need not be app users). Viewing needs order.manage
 *  or report.view; adding and removing entries needs order.manage. */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

interface Summary {
  person_id: string; person_name: string; person_type: string
  petrol: number; service: number; food: number; advance: number; diwali_bonus: number; total_expense: number
  days_present: number; half_days: number; days_absent: number; days_leave: number
  leave_casual: number; leave_sick: number; leave_paid: number; leave_unpaid: number
}
interface Expense { id: string; person_id: string; entry_date: string; category: string; amount: number; vehicle_no: string | null; notes: string | null }
interface Attendance { id: string; person_id: string; att_date: string; status: string; leave_type: string | null; notes: string | null }

const CATS: Record<string, string> = { petrol: 'Petrol', service: 'Service charges', food: 'Food', advance: 'Advance taken', diwali_bonus: 'Diwali bonus' }
const STATUS: Record<string, string> = { present: 'Present', half_day: 'Half day', absent: 'Absent', leave: 'Leave' }
const money = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return iso(new Date(y!, mo!, 1)) }

const CSV_COLUMNS = ['month', 'name', 'type', 'petrol', 'service_charges', 'food', 'advance_taken', 'diwali_bonus', 'total', 'present', 'half_days', 'absent', 'leave_days', 'casual', 'sick', 'paid', 'unpaid'] as const

export default function StaffExpenses() {
  const { can } = useAuth()
  const canManage = can('order.manage')
  const [month, setMonth] = useState(iso(new Date()).slice(0, 7))
  const [person, setPerson] = useState('')
  const [rows, setRows] = useState<Summary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [exp, setExp] = useState<Expense[]>([])
  const [att, setAtt] = useState<Attendance[]>([])
  const [drawer, setDrawer] = useState<'expense' | 'attendance' | 'person' | null>(null)

  const load = useCallback(async () => {
    const r = await supabase.rpc('staff_monthly_summary', { p_month: `${month}-01` })
    if (r.error) setError(errMessage(r.error, 'Could not load the report'))
    else setError(null)
    setRows((r.data ?? []) as Summary[])
  }, [month])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!open) return
    void (async () => {
      const [a, b] = await Promise.all([
        supabase.from('staff_expenses').select('*').eq('person_id', open).gte('entry_date', `${month}-01`).lt('entry_date', monthEnd(month)).order('entry_date'),
        supabase.from('staff_attendance').select('*').eq('person_id', open).gte('att_date', `${month}-01`).lt('att_date', monthEnd(month)).order('att_date'),
      ])
      setExp((a.data ?? []) as Expense[])
      setAtt((b.data ?? []) as Attendance[])
    })()
  }, [open, month, rows])

  if (!rows) return <Loading label="Loading staff expenses" />
  const list = person ? rows.filter((x) => x.person_id === person) : rows
  const sum = (k: keyof Summary) => list.reduce((a, x) => a + Number(x[k]), 0)

  function exportCSV() {
    downloadCSV(`staff-expenses-${month}.csv`, toCSV(CSV_COLUMNS, list.map((x) => ({
      month, name: x.person_name, type: x.person_type, petrol: x.petrol, service_charges: x.service, food: x.food, advance_taken: x.advance,
      diwali_bonus: x.diwali_bonus, total: x.total_expense, present: x.days_present, half_days: x.half_days, absent: x.days_absent,
      leave_days: x.days_leave, casual: x.leave_casual, sick: x.leave_sick, paid: x.leave_paid, unpaid: x.leave_unpaid,
    }))))
  }

  async function removeRow(table: 'staff_expenses' | 'staff_attendance', id: string) {
    const r = await supabase.from(table).delete().eq('id', id).select('id')
    if (r.error) return setError(errMessage(r.error, 'Could not remove the entry'))
    await load()
  }

  const drill = rows.find((x) => x.person_id === open)

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Staff expenses and attendance</h1>
          <p className="page-sub">Monthly summary per staff member or driver: petrol, service, food, advances, Diwali bonus, attendance and leave.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canManage && <button className="btn primary" type="button" onClick={() => setDrawer('expense')}>Add expense</button>}
          {canManage && <button className="btn" type="button" onClick={() => setDrawer('attendance')}>Mark attendance</button>}
          {canManage && <button className="btn" type="button" onClick={() => setDrawer('person')}>Add person</button>}
          <button className="btn" type="button" disabled={list.length === 0} onClick={exportCSV}>Export CSV</button>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}

      <div className="form-grid" style={{ maxWidth: 600 }}>
        <div className="field"><input aria-label="Month" type="month" value={month} onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setOpen(null) } }} /></div>
        <div className="field"><select aria-label="Person" value={person} onChange={(e) => setPerson(e.target.value)}><option value="">All staff and drivers</option>{rows.map((x) => (<option key={x.person_id} value={x.person_id}>{x.person_name}</option>))}</select></div>
      </div>

      {list.length === 0 ? (
        <div className="card pad empty">{rows.length === 0 ? 'No staff or drivers yet. Use "Add person" to start.' : 'Nobody matches.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Type</th><th className="right">Petrol</th><th className="right">Service</th><th className="right">Food</th><th className="right">Advance</th><th className="right">Diwali bonus</th><th className="right">Total</th>
                <th className="right">Present</th><th className="right">Half</th><th className="right">Absent</th><th className="right">Leave</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.person_id}>
                  <td>{x.person_name}</td>
                  <td><span className="chip">{x.person_type === 'driver' ? 'Driver' : 'Staff'}</span></td>
                  <td className="right mono">{money(x.petrol)}</td><td className="right mono">{money(x.service)}</td><td className="right mono">{money(x.food)}</td>
                  <td className="right mono">{money(x.advance)}</td><td className="right mono">{money(x.diwali_bonus)}</td><td className="right mono"><strong>{money(x.total_expense)}</strong></td>
                  <td className="right mono">{x.days_present}</td><td className="right mono">{x.half_days}</td><td className="right mono">{x.days_absent}</td>
                  <td className="right mono" title={`Casual ${x.leave_casual}, sick ${x.leave_sick}, paid ${x.leave_paid}, unpaid ${x.leave_unpaid}`}>{x.days_leave}</td>
                  <td><button className="btn ghost sm" type="button" onClick={() => setOpen(open === x.person_id ? null : x.person_id)}>{open === x.person_id ? 'Hide' : 'Details'}</button></td>
                </tr>
              ))}
              <tr>
                <td><strong>Total</strong></td><td />
                <td className="right mono">{money(sum('petrol'))}</td><td className="right mono">{money(sum('service'))}</td><td className="right mono">{money(sum('food'))}</td>
                <td className="right mono">{money(sum('advance'))}</td><td className="right mono">{money(sum('diwali_bonus'))}</td><td className="right mono"><strong>{money(sum('total_expense'))}</strong></td>
                <td className="right mono">{sum('days_present')}</td><td className="right mono">{sum('half_days')}</td><td className="right mono">{sum('days_absent')}</td><td className="right mono">{sum('days_leave')}</td><td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {drill && (
        <div className="card pad" style={{ marginTop: 16 }}>
          <h2>{drill.person_name} · {month}</h2>
          <h3>Expenses</h3>
          {exp.length === 0 ? <p className="muted small">No expense entries this month.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Category</th><th className="right">Amount</th><th>Vehicle</th><th>Notes</th>{canManage && <th />}</tr></thead>
              <tbody>{exp.map((x) => (
                <tr key={x.id}><td className="mono small">{x.entry_date}</td><td>{CATS[x.category] ?? x.category}</td><td className="right mono">{money(x.amount)}</td><td>{x.vehicle_no ?? '—'}</td><td>{x.notes ?? '—'}</td>
                  {canManage && <td><button className="btn ghost sm" type="button" onClick={() => void removeRow('staff_expenses', x.id)}>Remove</button></td>}</tr>
              ))}</tbody>
            </table></div>
          )}
          <h3>Attendance</h3>
          {att.length === 0 ? <p className="muted small">No attendance marked this month.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Status</th><th>Leave type</th><th>Notes</th>{canManage && <th />}</tr></thead>
              <tbody>{att.map((x) => (
                <tr key={x.id}><td className="mono small">{x.att_date}</td><td>{STATUS[x.status] ?? x.status}</td><td>{x.leave_type ?? '—'}</td><td>{x.notes ?? '—'}</td>
                  {canManage && <td><button className="btn ghost sm" type="button" onClick={() => void removeRow('staff_attendance', x.id)}>Remove</button></td>}</tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {drawer === 'person' && <PersonDrawer onClose={() => setDrawer(null)} onDone={async () => { setDrawer(null); await load() }} />}
      {drawer === 'expense' && <EntryDrawer kind="expense" people={rows} month={month} onClose={() => setDrawer(null)} onDone={async () => { setDrawer(null); await load() }} />}
      {drawer === 'attendance' && <EntryDrawer kind="attendance" people={rows} month={month} onClose={() => setDrawer(null)} onDone={async () => { setDrawer(null); await load() }} />}
    </>
  )
}

function PersonDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('staff')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!name.trim()) return setErr('Enter a name.')
    setBusy(true)
    const r = await supabase.from('staff_people').insert({ name: name.trim(), person_type: type }).select('id')
    setBusy(false)
    if (r.error) return setErr(r.error.code === '23505' ? 'That name already exists.' : errMessage(r.error, 'Could not add the person.'))
    await onDone()
  }
  return (
    <Drawer title="Add person" onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <div className="form-grid">
        <Field id="sp-n" label="Name"><input id="sp-n" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field id="sp-t" label="Type"><select id="sp-t" value={type} onChange={(e) => setType(e.target.value)}><option value="staff">Staff</option><option value="driver">Driver</option></select></Field>
      </div>
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </Drawer>
  )
}

function EntryDrawer({ kind, people, month, onClose, onDone }: { kind: 'expense' | 'attendance'; people: Summary[]; month: string; onClose: () => void; onDone: () => Promise<void> }) {
  const today = iso(new Date())
  const [pid, setPid] = useState('')
  const [date, setDate] = useState(today.startsWith(month) ? today : `${month}-01`)
  const [cat, setCat] = useState('petrol')
  const [amount, setAmount] = useState('')
  const [veh, setVeh] = useState('')
  const [status, setStatus] = useState('present')
  const [leave, setLeave] = useState('casual')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!pid) return setErr('Choose a person.')
    if (!date) return setErr('Choose a date.')
    let res
    if (kind === 'expense') {
      const amt = Number(amount)
      if (!(amt > 0)) return setErr('Enter an amount greater than zero.')
      setBusy(true)
      res = await supabase.from('staff_expenses').insert({ person_id: pid, entry_date: date, category: cat, amount: amt, vehicle_no: veh.trim() || null, notes: notes.trim() || null }).select('id')
    } else {
      setBusy(true)
      res = await supabase.from('staff_attendance').upsert({ person_id: pid, att_date: date, status, leave_type: status === 'leave' ? leave : null, notes: notes.trim() || null }, { onConflict: 'person_id,att_date' }).select('id')
    }
    setBusy(false)
    if (res.error) return setErr(errMessage(res.error, 'Could not save the entry.'))
    if (!res.data || res.data.length === 0) return setErr('Your account cannot add entries.')
    await onDone()
  }

  return (
    <Drawer title={kind === 'expense' ? 'Add expense entry' : 'Mark attendance'} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <div className="form-grid">
        <Field id="se-p" label="Staff / driver"><select id="se-p" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choose</option>{people.map((x) => (<option key={x.person_id} value={x.person_id}>{x.person_name}</option>))}</select></Field>
        <Field id="se-d" label="Date"><input id="se-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {kind === 'expense' ? (
          <>
            <Field id="se-c" label="Category"><select id="se-c" value={cat} onChange={(e) => setCat(e.target.value)}>{Object.entries(CATS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}</select></Field>
            <Field id="se-a" label="Amount"><input id="se-a" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field id="se-v" label="Vehicle no."><input id="se-v" value={veh} onChange={(e) => setVeh(e.target.value)} /></Field>
          </>
        ) : (
          <>
            <Field id="se-s" label="Status"><select id="se-s" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}</select></Field>
            {status === 'leave' && <Field id="se-l" label="Leave type"><select id="se-l" value={leave} onChange={(e) => setLeave(e.target.value)}><option value="casual">Casual</option><option value="sick">Sick</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select></Field>}
          </>
        )}
        <Field id="se-n" label="Notes"><input id="se-n" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {kind === 'attendance' && <p className="muted small">Marking a date that already has attendance replaces it.</p>}
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </Drawer>
  )
}