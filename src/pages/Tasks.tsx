/** The Tasks module: summary cards, view tabs and the queue. The open view, the
 *  quick filter and an open task all live in the URL (?view=, ?f=, ?task=), so
 *  every card, tab and notification is a plain link. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { TaskCounts } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { SubTabs } from '../components/SubTabs'
import { SummaryCards } from '../components/SummaryCards'
import { boardFor } from '../lib/taskBoards'
import { TASK_VIEWS } from '../lib/tasks'
import { TaskQueue, boardSummary, type TaskRow } from './tasks/TaskQueue'
import { TaskOverview } from './tasks/TaskOverview'
import { TaskReport } from './tasks/TaskReport'
import { TaskDetail } from './tasks/TaskDetail'
import { ChequeQueue } from './tasks/ChequeQueue'
import { RulesPanel } from './tasks/RulesPanel'
import { MessagesPanel } from './tasks/MessagesPanel'
import '../styles/tasks-queue.css'

const EMPTY: TaskCounts = { open: 0, due_today: 0, overdue: 0, awaiting_proof: 0, payment_outstanding: 0, mine: 0 }

export default function Tasks() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [counts, setCounts] = useState<TaskCounts>(EMPTY)
  const [refreshKey, setRefreshKey] = useState(0)
  const [rows, setRows] = useState<TaskRow[]>([])

  const canManage = can('task.manage')
  const canMessages = canManage || can('message.view')

  const views = useMemo(
    () => TASK_VIEWS.filter((v) => (v.key === 'messages' ? canMessages : !v.manage || canManage)),
    [canManage, canMessages],
  )
  const view = views.find((v) => v.key === params.get('view')) ?? views[0] ?? TASK_VIEWS[0]!
  const filter = params.get('f')
  const taskId = params.get('task')

  useEffect(() => {
    let live = true
    void supabase.rpc('task_counts').then(({ data, error }) => {
      if (live && !error && data) setCounts({ ...EMPTY, ...(data as Partial<TaskCounts>) })
    })
    return () => {
      live = false
    }
  }, [refreshKey])

  const changed = useCallback(() => setRefreshKey((k) => k + 1), [])

  const openTask = useCallback(
    (id: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('task', id)
          return next
        },
        { replace: false },
      ),
    [setParams],
  )

  const closeTask = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('task')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const link = (v: string, f: string) => `/tasks?view=${v}&f=${f}`
  const cards = [
    { key: 'open', label: 'Open', value: counts.open, href: link('all', 'open') },
    { key: 'due_today', label: 'Due today', value: counts.due_today, tone: 'warn' as const, href: link('all', 'due_today') },
    { key: 'overdue', label: 'Overdue', value: counts.overdue, tone: 'danger' as const, href: link('all', 'overdue') },
    { key: 'awaiting_proof', label: 'Awaiting proof', value: counts.awaiting_proof, tone: 'warn' as const, href: link('all', 'awaiting_proof') },
    { key: 'payment_outstanding', label: 'Payment outstanding', value: counts.payment_outstanding, href: link('payments', 'payment_outstanding') },
    { key: 'mine', label: 'My tasks', value: counts.mine, href: link('mine', 'mine') },
  ]

  const listView = !['cheques', 'rules', 'messages'].includes(view.key)
  // The six task boards have their own header and summary cards; Cheque Collection keeps the global ones.
  const board = view.key === 'cheques' ? undefined : boardFor(view.key)
  const boardCards = useMemo(() => (board ? boardSummary(board, view.types, rows) : []), [board, view.types, rows])

  return (
    <div className="tk-page">
      <header className="tk-head tk-head-row">
        <div>
          <h1>Tasks</h1>
          <p className="page-sub">
            {board ? board.purpose : 'Deliveries, collections, cheques, samples and visits: who does what, by when, with proof.'}
          </p>
        </div>
        <Link to="/tasks/my" className="tk-head-link">
          Field view
        </Link>
      </header>

      <SummaryCards cards={board ? boardCards : cards} />

      <SubTabs
        tabs={views.map((v) => ({ key: v.key, label: v.label }))}
        active={view.key}
        hrefFor={(key) => (key === 'all' ? '/tasks' : `/tasks?view=${key}`)}
      />

      {taskId && <TaskDetail key={taskId} taskId={taskId} onClose={closeTask} onChanged={changed} />}

      <div className="tk-stack">
        {(view.key === 'all' || view.key === 'mine') && <TaskOverview refreshKey={refreshKey} />}
        {listView && (
          <TaskQueue
            view={view}
            filter={filter}
            refreshKey={refreshKey}
            onOpen={openTask}
            onChanged={changed}
            onRows={setRows}
          />
        )}
        {board && listView && <TaskReport board={board} rows={rows} />}
        {view.key === 'cheques' && <ChequeQueue />}
        {view.key === 'rules' && <RulesPanel />}
        {view.key === 'messages' && <MessagesPanel />}
      </div>
    </div>
  )
}
