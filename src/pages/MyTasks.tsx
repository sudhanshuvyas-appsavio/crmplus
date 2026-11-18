import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { errMessage } from '../lib/party'
import { OPEN_STATUSES, daysOverdue, todayIST } from '../lib/tasks'
import { useTaskTypes } from '../lib/taskData'
import { pushToast } from '../components/Toast'
import FieldTaskCard from './tasks/FieldTaskCard'
import type { FieldTask } from './tasks/FieldTaskCard'
import '../styles/field.css'

type Bucket = 'today' | 'overdue' | 'upcoming'
const TABS: { key: Bucket; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
]

/** The phone-first view of the tasks assigned to me (route /tasks/my). */
export default function MyTasks() {
  const { me, canAny } = useAuth()
  const types = useTaskTypes()
  const [tasks, setTasks] = useState<FieldTask[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Bucket>('today')
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const allowed = canAny('task.work', 'task.manage')
  const userId = me?.id

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('tasks')
      .select('*, buyer:buyer_master(name)')
      .eq('assigned_to', userId)
      .in('status', OPEN_STATUSES)
      .order('due_date', { ascending: true })
    setLoading(false)
    if (error) return pushToast('error', errMessage(error, 'Could not load your tasks'))
    setTasks((data ?? []) as unknown as FieldTask[])
  }, [userId])

  useEffect(() => {
    if (allowed) void load()
  }, [allowed, load])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const today = todayIST()
  const typeLabel = useMemo(() => Object.fromEntries(types.map((t) => [t.key, t.label])), [types])

  const buckets = useMemo(() => {
    const out: Record<Bucket, FieldTask[]> = { today: [], overdue: [], upcoming: [] }
    for (const t of tasks ?? []) {
      if (daysOverdue(t, today) > 0) out.overdue.push(t)
      else if (t.due_date === today) out.today.push(t)
      else out.upcoming.push(t)
    }
    return out
  }, [tasks, today])

  const shown = buckets[tab]

  return (
    <div className="tk-page field-view">
      <div className="field-head">
        <h1>My tasks</h1>
        <Link to="/tasks">Back to Tasks</Link>
      </div>

      {!allowed ? (
        <div className="field-empty">You do not have access to tasks. Ask an administrator to give you the task permissions.</div>
      ) : (
        <>
          {!online && (
            <div className="field-offline" role="status">
              Offline. You can see what was loaded, but check-ins, photos and payments need a connection.
            </div>
          )}

          <div className="field-bar">
            <div className="sub-tabs field-tabs" role="tablist" style={{ marginBottom: 0, flex: 1 }}>
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`sub-tab${tab === t.key ? ' active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  <span className="sub-tab-count">{buckets[t.key].length}</span>
                </button>
              ))}
            </div>
            <button type="button" className="btn" disabled={loading} onClick={() => void load()}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {tasks === null ? (
            <p className="muted">Loading…</p>
          ) : tasks.length === 0 ? (
            <div className="field-empty">Nothing assigned to you. Nice.</div>
          ) : shown.length === 0 ? (
            <div className="field-empty">No {TABS.find((t) => t.key === tab)?.label.toLowerCase()} tasks.</div>
          ) : (
            shown.map((t) => (
              <FieldTaskCard key={t.id} task={t} typeLabel={typeLabel[t.task_type] ?? t.task_type} today={today} onChanged={() => void load()} />
            ))
          )}
        </>
      )}
    </div>
  )
}
