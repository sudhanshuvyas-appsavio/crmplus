/** The "Reports" chart monday puts on each Tasks board: how many items each person has,
 *  stacked by the board's status. Built from the rows on screen, so it always agrees with
 *  the table and its filters. The widget filters monday's own charts carry were not readable,
 *  so this counts every row of the board. */

import { useMemo } from 'react'
import { useProfileNameMap } from '../../lib/taskData'
import type { BoardConfig } from '../../lib/taskBoards'
import type { TaskRow } from './TaskQueue'

const COLORS = ['#9aa3b2', '#f59e0b', '#16a34a', '#dc2626']

/** The stack a row falls in, in the words of the board. */
function stackOf(board: BoardConfig, t: TaskRow): string {
  const d = (t.details ?? {}) as Record<string, unknown>
  switch (board.key) {
    case 'visits':
      return d.visit_status === 'completed' ? 'Completed' : d.visit_status === 'visited' || t.check_in_at ? 'Visited' : 'Not Visited'
    case 'samples':
      return d.feedback_status === 'approved' ? 'Approved' : d.feedback_status === 'rejected' ? 'Rejected' : 'Pending'
    case 'mill':
    case 'commission':
      return d.delivery_status === 'delivered' || t.status === 'done' ? 'Delivered' : 'Not Delivered'
    case 'freight':
      return d.check_status === 'cleared' ? 'Cleared' : 'Outstanding'
    case 'payments':
      return t.status === 'done' || (Number(t.amount) > 0 && Number(t.amount_collected) >= Number(t.amount)) ? 'Completed' : 'Outstanding'
    default:
      return 'All'
  }
}

export function TaskReport({ board, rows }: { board: BoardConfig; rows: TaskRow[] }) {
  const names = useProfileNameMap()
  const { people, stacks, max } = useMemo(() => {
    const stackList: string[] = []
    const byPerson = new Map<string, Map<string, number>>()
    for (const t of rows) {
      const who = t.assigned_to ? (names[t.assigned_to] ?? 'Unknown user') : 'Blank'
      const stack = stackOf(board, t)
      if (!stackList.includes(stack)) stackList.push(stack)
      const m = byPerson.get(who) ?? new Map<string, number>()
      m.set(stack, (m.get(stack) ?? 0) + 1)
      byPerson.set(who, m)
    }
    const list = [...byPerson.entries()]
      .map(([who, m]) => ({ who, m, total: [...m.values()].reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total)
    return { people: list, stacks: stackList, max: Math.max(1, ...list.map((p) => p.total)) }
  }, [rows, names, board])

  if (rows.length === 0) return null
  return (
    <section className="md-pane tk-card" aria-label={`${board.title} report`}>
      <div className="gk-head">
        <div className="gk-title">
          <h2>Count by person</h2>
          <p>{rows.length} {rows.length === 1 ? 'item' : 'items'}, by who it is assigned to and its status.</p>
        </div>
      </div>
      <div style={{ padding: '4px 16px 16px' }}>
        {people.map((p) => (
          <div key={p.who} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 40px', alignItems: 'center', gap: 10, margin: '6px 0' }}>
            <span className="small" title={p.who}>{p.who}</span>
            <div style={{ display: 'flex', height: 18, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
              {stacks.map((s, i) => {
                const n = p.m.get(s) ?? 0
                return n > 0 ? (
                  <div key={s} title={`${s}: ${n}`} style={{ width: `${(n / max) * 100}%`, background: COLORS[i % COLORS.length] }} />
                ) : null
              })}
            </div>
            <span className="small mono">{p.total}</span>
          </div>
        ))}
        <div className="td-row" style={{ marginTop: 8 }}>
          {stacks.map((s, i) => (
            <span key={s} className="small">
              <span style={{ display: 'inline-block', width: 10, height: 10, background: COLORS[i % COLORS.length], marginRight: 5, borderRadius: 2 }} />
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
