/** Subitems of a task: monday's Payment Collection and Cheque Collection boards
 *  carry the default subitem columns (Name, Owner, Status, Date). Rows live in
 *  `task_subitems`; who may change them is decided by the table's policies. */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { SubitemStatus, TaskSubitem } from '../../api/types'
import { StatusPill } from '../../components/StatusPill'
import { pushToast } from '../../components/Toast'
import { formatDate } from '../../lib/format'
import { errMessage } from '../../lib/party'
import { useProfileNameMap, useProfileOptions } from '../../lib/taskData'

const STATUS: { value: SubitemStatus; label: string; tone: 'info' | 'ok' | 'danger' }[] = [
  { value: 'working_on_it', label: 'Working on it', tone: 'info' },
  { value: 'done', label: 'Done', tone: 'ok' },
  { value: 'stuck', label: 'Stuck', tone: 'danger' },
]

export function TaskSubitems({ taskId, canWrite }: { taskId: string; canWrite: boolean }) {
  const people = useProfileOptions()
  const names = useProfileNameMap()
  const [rows, setRows] = useState<TaskSubitem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('task_subitems').select('*').eq('task_id', taskId).order('created_at')
    if (error) {
      setLoadError(errMessage(error, 'Could not load the subitems'))
      setRows([])
      return
    }
    setLoadError(null)
    setRows((data ?? []) as TaskSubitem[])
  }, [taskId])

  useEffect(() => {
    void load()
  }, [load])

  async function add() {
    if (!name.trim()) return
    setBusy(true)
    const { error } = await supabase
      .from('task_subitems')
      .insert({ task_id: taskId, name: name.trim(), owner_id: owner || null, item_date: date || null })
    setBusy(false)
    if (error) return pushToast('error', errMessage(error, 'Could not add the subitem'))
    setName('')
    setOwner('')
    setDate('')
    await load()
  }

  async function setStatus(row: TaskSubitem, status: SubitemStatus) {
    const { error } = await supabase.from('task_subitems').update({ status }).eq('id', row.id)
    if (error) return pushToast('error', errMessage(error, 'Could not change the status'))
    await load()
  }

  async function remove(row: TaskSubitem) {
    if (!window.confirm(`Delete the subitem "${row.name}"?`)) return
    const { error } = await supabase.from('task_subitems').delete().eq('id', row.id)
    if (error) return pushToast('error', errMessage(error, 'Could not delete the subitem'))
    await load()
  }

  return (
    <section className="td-section" aria-label="Subitems">
      <h3>Subitems{rows && rows.length > 0 ? ` (${rows.length})` : ''}</h3>
      {loadError && <div className="alert">{loadError}</div>}
      {rows && rows.length === 0 && !loadError && <p className="td-empty">No subitems.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="left">Name</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Date</th>
                {canWrite && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS.find((s) => s.value === r.status) ?? STATUS[0]!
                return (
                  <tr key={r.id}>
                    <td className="left">{r.name}</td>
                    <td>{r.owner_id ? (names[r.owner_id] ?? '—') : '—'}</td>
                    <td>
                      {canWrite ? (
                        <select value={r.status} aria-label={`Status of ${r.name}`} onChange={(e) => void setStatus(r, e.target.value as SubitemStatus)}>
                          {STATUS.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusPill tone={st.tone}>{st.label}</StatusPill>
                      )}
                    </td>
                    <td>{r.item_date ? formatDate(r.item_date) : '—'}</td>
                    {canWrite && (
                      <td>
                        <button type="button" className="btn ghost sm" onClick={() => void remove(r)}>
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {canWrite && (
        <div className="td-row" style={{ marginTop: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Subitem name" aria-label="Subitem name" />
          <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
            <option value="">Owner</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <button type="button" className="btn sm" disabled={busy || !name.trim()} onClick={() => void add()}>
            Add subitem
          </button>
        </div>
      )}
    </section>
  )
}
