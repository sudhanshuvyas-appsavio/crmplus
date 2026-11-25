/** "Needs attention": the most urgent open tasks in the Pharma dashboard to-do
 *  style. Overdue first, then due today, then high and urgent priority. Reads
 *  the tasks table directly, so what a person sees follows their own access. */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { TaskPriority } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate } from '../../lib/format'
import { OPEN_STATUSES, daysOverdue, taskHref, todayIST } from '../../lib/tasks'
import '../../styles/tasks-queue.css'

interface Row {
  id: string
  title: string
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
  priority: TaskPriority
  due_date: string
  assigned_to: string | null
  buyer: { name: string } | null
}

type Severity = 'critical' | 'warning' | 'normal'
type Segment = 'all' | 'critical' | 'mine'

const SHOWN = 6

function severityOf(r: Row, today: string): Severity {
  if (daysOverdue(r, today) > 0 || r.priority === 'urgent') return 'critical'
  if (r.due_date === today || r.priority === 'high') return 'warning'
  return 'normal'
}

/** Lower sorts first: overdue (longest first), due today, then high and urgent priority. */
function rank(r: Row, today: string): number {
  const late = daysOverdue(r, today)
  if (late > 0) return -1000 - late
  if (r.due_date === today) return r.priority === 'urgent' ? -20 : -10
  return r.priority === 'urgent' ? 0 : 10
}

export function TaskOverview({ refreshKey = 0 }: { refreshKey?: number }) {
  const { me } = useAuth()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [segment, setSegment] = useState<Segment>('all')

  useEffect(() => {
    let live = true
    void supabase
      .from('tasks')
      .select('id, title, status, priority, due_date, assigned_to, buyer:buyer_master(name)')
      .in('status', OPEN_STATUSES)
      .order('due_date', { ascending: true })
      .limit(500)
      .then(({ data, error }) => {
        if (!live) return
        setFailed(Boolean(error))
        setRows(error ? [] : ((data ?? []) as unknown as Row[]))
      })
    return () => {
      live = false
    }
  }, [refreshKey])

  const today = todayIST()
  const urgent = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => severityOf(r, today) !== 'normal')
        .sort((a, b) => rank(a, today) - rank(b, today) || a.due_date.localeCompare(b.due_date)),
    [rows, today],
  )
  const list = useMemo(
    () =>
      urgent.filter((r) => {
        if (segment === 'critical') return severityOf(r, today) === 'critical'
        if (segment === 'mine') return r.assigned_to === me?.id
        return true
      }),
    [urgent, segment, me?.id, today],
  )

  const top = list.slice(0, SHOWN)
  const rest = list.slice(SHOWN)

  return (
    <section className="card pad" aria-label="Needs attention">
      <div className="tk-todo-head">
        <h2>Needs attention</h2>
        <div className="tk-seg" role="radiogroup" aria-label="Show">
          {(['all', 'critical', 'mine'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={segment === s}
              className={segment === s ? 'on' : undefined}
              onClick={() => setSegment(s)}
            >
              {s === 'all' ? 'All' : s === 'critical' ? 'Critical' : 'Mine'}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <p className="muted small">Loading…</p>
      ) : failed ? (
        <p className="muted small">Could not load tasks.</p>
      ) : list.length === 0 ? (
        <div className="tk-clear">
          <strong>All clear</strong>
          {segment === 'all' ? 'Nothing is overdue, due today or high priority.' : 'Nothing matches this filter.'}
        </div>
      ) : (
        <>
          <ul className="tk-todo">
            {top.map((r) => (
              <Item key={r.id} row={r} today={today} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="tk-more">
              <summary>Show {rest.length} more</summary>
              <ul className="tk-todo">
                {rest.map((r) => (
                  <Item key={r.id} row={r} today={today} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}

function Item({ row, today }: { row: Row; today: string }) {
  const sev = severityOf(row, today)
  const late = daysOverdue(row, today)
  const label = sev === 'critical' ? 'Critical' : sev === 'warning' ? 'Warning' : 'Normal'
  return (
    <li>
      <Link to={taskHref(row.id)} className="tk-todo-row">
        <span className={`tk-dot ${sev === 'critical' ? 'danger' : sev === 'warning' ? 'warn' : 'info'}`} aria-hidden="true" />
        <span>
          <span className="tk-todo-title">
            {row.title}
            {row.buyer?.name && <span className="tk-todo-buyer"> · {row.buyer.name}</span>}
          </span>
          <span className="tk-todo-meta">
            {label} · due {formatDate(row.due_date)}
            {late > 0 && ` · ${late}d overdue`}
          </span>
        </span>
        <span className="tk-open-chip">Open</span>
      </Link>
    </li>
  )
}
