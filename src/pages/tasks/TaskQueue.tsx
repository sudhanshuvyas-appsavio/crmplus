/** The task queue: one card with the toolbar, the table, the bulk bar and the
 *  pager, in the Master Data register style. The Tasks page decides which view
 *  and quick filter it shows; this component loads the rows and works on them.
 *
 *  On a board view (Monthly Visit, Mill Invoice Delivery, ...) the table shows
 *  exactly that board's columns from lib/taskBoards.ts, in monday's order and
 *  with monday's labels. The 'all' and 'mine' views keep the generic columns. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Task, TaskPriority, TaskStatus } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { Loading } from '../../components/Loading'
import { GridPager, GridToolbar, usePaging } from '../../components/GridKit'
import { useSelection } from '../../components/ListTools'
import { Modal } from '../../components/Modal'
import { RowActionMenu, type RowAction } from '../../components/RowActionMenu'
import { StatusPill } from '../../components/StatusPill'
import type { SummaryCard } from '../../components/SummaryCards'
import { pushToast } from '../../components/Toast'
import { downloadCSV, toCSV } from '../../lib/csv'
import { formatDate, formatDateTime } from '../../lib/format'
import { errMessage } from '../../lib/party'
import { boardFor, boardStatusLabel, type BoardConfig, type ColumnKey } from '../../lib/taskBoards'
import {
  MODE_LABEL,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_OPTIONS,
  STATUS_TONE,
  balanceOf,
  daysOverdue,
  formatMoney,
  isOpen,
  taskHref,
  todayIST,
  type Tone,
  type TaskView,
} from '../../lib/tasks'
import { useProfileNameMap, useProfileOptions, useTaskTypes } from '../../lib/taskData'
import { TaskForm } from './TaskForm'
import '../../styles/tasks-queue.css'

export type TaskRow = Task & {
  buyer: { name: string; messenger_id: string | null } | null
  supplier: { name: string; messenger_id: string | null } | null
  order: { order_no: string | null } | null
  dispatch: { mill_invoice_no: string | null; mill_invoice_date: string | null; transporter_invoice_no: string | null } | null
  ci: { invoice_no: string | null; invoice_date: string | null; amount: number | null } | null
  proofs: { count: number }[] | null
}

const FILTER_LABEL: Record<string, string> = {
  open: 'Open tasks',
  due_today: 'Due today',
  overdue: 'Overdue',
  awaiting_proof: 'Awaiting proof',
  payment_outstanding: 'Payment outstanding',
  mine: 'My tasks',
}

const CSV_COLUMNS = [
  'task_no', 'title', 'type', 'buyer', 'order', 'assigned_to', 'due_date', 'status', 'priority',
  'amount', 'amount_collected', 'balance',
] as const

const SINGULAR = 'task'
const PLURAL = 'tasks'
const DASH = '—'

/* ---- small helpers shared with the Tasks page (summary cards) -------------- */

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))

/** details.pending_payment is a checkbox, but tolerate text values too. */
export const isPendingPayment = (t: Pick<Task, 'details'>): boolean => {
  const v = t.details?.pending_payment as unknown
  return v === true || v === 'true' || v === 'yes' || v === 'Yes'
}

export type VisitState = 'planned' | 'visited' | 'completed' | 'missed'
export function visitState(t: Pick<Task, 'details' | 'check_in_at'>): VisitState {
  const v = t.details?.visit_status
  if (v === 'completed' || v === 'visited' || v === 'missed') return v
  return t.check_in_at ? 'visited' : 'planned'
}

export const invoiceDelivered = (t: Pick<Task, 'details' | 'status'>): boolean =>
  t.details?.delivery_status === 'delivered' || t.status === 'done'

export const feedbackPending = (t: Pick<Task, 'details'>): boolean => {
  const f = t.details?.feedback_status
  return f !== 'approved' && f !== 'rejected'
}

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone drift). */
function addDays(day: string, n: number): string {
  const ms = Date.parse(`${day.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(ms) ? '' : new Date(ms + n * 86_400_000).toISOString().slice(0, 10)
}

export function feedbackDueDate(t: Pick<Task, 'details'>): string {
  const d = text(t.details?.delivery_date)
  return d ? addDays(d, 7) : ''
}

const istDay = (iso: string): string => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

/** Whole days from the start date to the completion date, or to today while open. */
function daysAging(t: Pick<Task, 'start_date' | 'completed_at'>): number | null {
  if (!t.start_date) return null
  const end = t.completed_at ? istDay(t.completed_at) : todayIST()
  const diff = Math.round((Date.parse(end) - Date.parse(t.start_date.slice(0, 10))) / 86_400_000)
  return Number.isNaN(diff) ? null : Math.max(0, diff)
}

/** The three summary cards of a board, computed from its loaded rows. */
export function boardSummary(board: BoardConfig, types: string[] | undefined, all: TaskRow[]): SummaryCard[] {
  const today = todayIST()
  const rows = all.filter((t) => (types ? types.includes(t.task_type) : t.task_type === board.taskType) && t.status !== 'cancelled')
  const count = (fn: (t: TaskRow) => boolean) => rows.filter(fn).length
  const proofsOf = (t: TaskRow) => t.proofs?.[0]?.count ?? 0
  switch (board.key) {
    case 'visits':
      return [
        { key: 'a', label: 'Not visited', value: count((t) => visitState(t) === 'planned' || visitState(t) === 'missed'), tone: 'warn' },
        { key: 'b', label: 'Visited', value: count((t) => visitState(t) === 'visited' || visitState(t) === 'completed') },
        { key: 'c', label: 'Pending payment', value: count(isPendingPayment), tone: 'warn' },
      ]
    case 'mill':
      return [
        { key: 'a', label: 'Not delivered', value: count((t) => !invoiceDelivered(t)), tone: 'warn' },
        { key: 'b', label: 'Delivered', value: count(invoiceDelivered) },
        { key: 'c', label: 'Stuck', value: count((t) => t.status === 'blocked'), tone: 'danger' },
      ]
    case 'commission':
      return [
        { key: 'a', label: 'Awaiting acknowledgement', value: count((t) => isOpen(t.status) && t.details?.acknowledgement !== 'yes'), tone: 'warn' },
        { key: 'b', label: 'Delivered', value: count((t) => invoiceDelivered(t) || t.details?.acknowledgement === 'yes') },
        { key: 'c', label: 'Pending payment', value: count(isPendingPayment), tone: 'warn' },
      ]
    case 'freight':
      return [
        { key: 'a', label: 'Outstanding', value: count((t) => t.details?.check_status !== 'cleared'), tone: 'warn' },
        { key: 'b', label: 'Cleared', value: count((t) => t.details?.check_status === 'cleared') },
        { key: 'c', label: 'Awaiting proof', value: count((t) => isOpen(t.status) && proofsOf(t) === 0), tone: 'warn' },
      ]
    case 'samples':
      return [
        { key: 'a', label: 'Feedback pending', value: count(feedbackPending) },
        {
          key: 'b',
          label: 'Feedback due',
          value: count((t) => {
            const due = feedbackDueDate(t)
            return feedbackPending(t) && due !== '' && due <= today
          }),
          tone: 'danger',
        },
        { key: 'c', label: 'Approved', value: count((t) => t.details?.feedback_status === 'approved') },
      ]
    case 'payments': {
      const open = rows.filter((t) => isOpen(t.status))
      return [
        { key: 'a', label: 'Outstanding amount', value: formatMoney(open.reduce((s, t) => s + balanceOf(t), 0)), tone: 'warn' },
        { key: 'b', label: 'Collected amount', value: formatMoney(rows.reduce((s, t) => s + Number(t.amount_collected || 0), 0)) },
        { key: 'c', label: 'Overdue', value: open.filter((t) => daysOverdue(t, today) > 0).length, tone: 'danger' },
      ]
    }
    default:
      return []
  }
}

type LinkedTask = { id: string; task_no: string }
interface Links {
  pay: Map<string, LinkedTask[]>
  src: Map<string, LinkedTask>
}
const NO_LINKS: Links = { pay: new Map(), src: new Map() }

interface Cell {
  /** Plain text: used for the CSV export and as the display when there is no node. */
  text: string
  node?: ReactNode
}

export function TaskQueue({
  view,
  filter,
  refreshKey,
  onOpen,
  onChanged,
  onRows,
}: {
  view: TaskView
  filter: string | null
  refreshKey: number
  onOpen: (id: string) => void
  onChanged: () => void
  /** Called with the loaded rows, so the page can compute its board summary cards. */
  onRows?: (rows: TaskRow[]) => void
}) {
  const { me, can } = useAuth()
  const canManage = can('task.manage')
  const canWork = can('task.work')
  const canCreate = canManage || canWork
  const myId = me?.id ?? null

  const board = view.key === 'cheques' ? undefined : boardFor(view.key)
  const names = useProfileNameMap()
  const people = useProfileOptions()
  const types = useTaskTypes()
  const typeLabel = useMemo(() => new Map(types.map((t) => [t.key, t.label])), [types])
  const proofTypes = useMemo(() => new Set(types.filter((t) => t.requires_proof).map((t) => t.key)), [types])

  const statusText = useCallback((s: TaskStatus) => boardStatusLabel(board, s, STATUS_LABEL[s]), [board])
  // One option per word: monday's "Working on it" covers both To do and In progress.
  const statusOptions = useMemo(
    () => [...new Map(STATUS_OPTIONS.map((o) => [statusText(o.value), o.value] as const))].map(([label, value]) => ({ value, label })),
    [statusText],
  )

  const [rows, setRows] = useState<TaskRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [links, setLinks] = useState<Links>(NO_LINKS)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [reassign, setReassign] = useState<TaskRow | null>(null)
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [bulkStatus, setBulkStatus] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select(
        '*, buyer:buyer_master(name, messenger_id), supplier:supplier_master(name, messenger_id), order:orders(order_no), dispatch:order_dispatches(mill_invoice_no, mill_invoice_date, transporter_invoice_no), ci:commission_invoices(invoice_no, invoice_date, amount), proofs:task_attachments(count)',
      )
      .order('due_date', { ascending: true })
      .limit(1000)
    if (error) {
      setLoadError(errMessage(error, 'Could not load tasks'))
      setRows([])
      return
    }
    setLoadError(null)
    setRows((data ?? []) as unknown as TaskRow[])
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    if (rows) onRows?.(rows)
  }, [rows, onRows])

  // Switching view starts with a clean set of filters.
  useEffect(() => {
    setSearch('')
    setStatus('')
    setType('')
    setAssignee('')
    setPriority('')
  }, [view.key])

  const shown = useMemo(() => {
    const today = todayIST()
    const q = search.trim().toLowerCase()
    const wanted = status ? statusText(status as TaskStatus) : ''
    return (rows ?? []).filter((t) => {
      if (view.types && !view.types.includes(t.task_type)) return false
      if (view.mine && t.assigned_to !== myId) return false

      switch (filter) {
        case 'open':
          if (!isOpen(t.status)) return false
          break
        case 'due_today':
          if (!isOpen(t.status) || t.due_date !== today) return false
          break
        case 'overdue':
          if (daysOverdue(t, today) === 0) return false
          break
        case 'awaiting_proof':
          if (!isOpen(t.status) || !proofTypes.has(t.task_type) || (t.proofs?.[0]?.count ?? 0) > 0) return false
          break
        case 'payment_outstanding':
          if (t.task_type !== 'payment_collection' || !isOpen(t.status) || Number(t.amount_collected) >= Number(t.amount)) return false
          break
        case 'mine':
          if (!isOpen(t.status) || t.assigned_to !== myId) return false
          break
        default:
          break
      }

      if (status && statusText(t.status) !== wanted) return false
      if (type && t.task_type !== type) return false
      if (assignee && t.assigned_to !== assignee) return false
      if (priority && t.priority !== priority) return false
      if (
        q &&
        ![t.task_no, t.title, t.buyer?.name, t.supplier?.name, t.order?.order_no, text(t.details?.invoice_no), text(t.details?.bill_no)].some((v) =>
          (v ?? '').toLowerCase().includes(q),
        )
      ) {
        return false
      }
      return true
    })
  }, [rows, view, filter, myId, proofTypes, search, status, type, assignee, priority, statusText])

  const paging = usePaging(shown, `${view.key}|${filter}|${search}|${status}|${type}|${assignee}|${priority}`)
  const selection = useSelection(useMemo(() => shown.map((t) => t.id), [shown]))

  // Related payment-collection tasks (and the source task) for the rows on this page.
  const needLinks = Boolean(board?.columns.some((c) => c.key === 'payment_link' || c.key === 'connected'))
  const visibleIds = paging.visible.map((t) => t.id).join(',')
  const sourceIds = paging.visible.map((t) => t.source_task_id).filter((id): id is string => Boolean(id)).join(',')
  useEffect(() => {
    if (!needLinks || !visibleIds) {
      setLinks(NO_LINKS)
      return undefined
    }
    let live = true
    const parts = [`source_task_id.in.(${visibleIds})`]
    if (sourceIds) parts.push(`id.in.(${sourceIds})`)
    void supabase
      .from('tasks')
      .select('id, task_no, task_type, source_task_id')
      .or(parts.join(','))
      .then(({ data, error }) => {
        if (!live) return
        if (error) {
          setLinks(NO_LINKS)
          return
        }
        const ids = new Set(visibleIds.split(','))
        const srcs = new Set(sourceIds ? sourceIds.split(',') : [])
        const pay = new Map<string, LinkedTask[]>()
        const src = new Map<string, LinkedTask>()
        for (const r of (data ?? []) as { id: string; task_no: string; task_type: string; source_task_id: string | null }[]) {
          if (r.source_task_id && ids.has(r.source_task_id) && r.task_type === 'payment_collection') {
            pay.set(r.source_task_id, [...(pay.get(r.source_task_id) ?? []), { id: r.id, task_no: r.task_no }])
          }
          if (srcs.has(r.id)) src.set(r.id, { id: r.id, task_no: r.task_no })
        }
        setLinks({ pay, src })
      })
    return () => {
      live = false
    }
  }, [needLinks, visibleIds, sourceIds, refreshKey])

  const showTypeFilter = !view.types
  const filters = [
    {
      name: 'status',
      label: 'Status',
      allLabel: 'All statuses',
      options: statusOptions,
    },
    ...(showTypeFilter
      ? [
          {
            name: 'type',
            label: 'Type',
            allLabel: 'All types',
            options: types.map((t) => ({ value: t.key, label: t.label })),
          },
        ]
      : []),
    {
      name: 'assignee',
      label: board ? board.personLabel : 'Assigned to',
      allLabel: 'Anyone',
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    {
      name: 'priority',
      label: 'Priority',
      allLabel: 'Any priority',
      options: PRIORITY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    },
  ]

  async function setTaskStatus(task: TaskRow, next: TaskStatus, done: string) {
    setBusyId(task.id)
    const { error } = await supabase.rpc('task_set_status', { p_task: task.id, p_status: next })
    setBusyId(null)
    if (error) {
      pushToast('error', errMessage(error, 'Could not change the status'))
      return
    }
    pushToast('success', `${task.task_no} ${done}`)
    onChanged()
  }

  /** Merges `patch` into the task's existing details object. */
  async function patchDetails(task: TaskRow, patch: Record<string, unknown>, done: string) {
    setBusyId(task.id)
    const { error } = await supabase
      .from('tasks')
      .update({ details: { ...task.details, ...patch } })
      .eq('id', task.id)
    setBusyId(null)
    if (error) {
      pushToast('error', errMessage(error, 'Could not update the task'))
      return
    }
    pushToast('success', `${task.task_no} ${done}`)
    onChanged()
  }

  async function assignTasks(ids: string[], user: string) {
    const { data, error } = await supabase.rpc('task_assign_many', { p_tasks: ids, p_user: user })
    if (error) {
      pushToast('error', errMessage(error, 'Could not assign'))
      return false
    }
    const n = Number(data ?? 0)
    pushToast('success', n === 0 ? 'Nothing changed: already assigned to that person.' : `Assigned ${n} ${n === 1 ? SINGULAR : PLURAL}.`)
    onChanged()
    return true
  }

  async function bulkAssign() {
    if (!bulkAssignee || selection.chosen.length === 0) return
    setBulkBusy(true)
    const ok = await assignTasks(selection.chosen, bulkAssignee)
    setBulkBusy(false)
    if (ok) {
      setBulkAssignee('')
      selection.clear()
    }
  }

  async function bulkSetStatus() {
    if (!bulkStatus || selection.chosen.length === 0) return
    setBulkBusy(true)
    const { data, error } = await supabase.rpc('task_set_status_many', { p_tasks: selection.chosen, p_status: bulkStatus })
    setBulkBusy(false)
    if (error) {
      pushToast('error', errMessage(error, 'Could not change the status'))
      return
    }
    const n = Number(data ?? 0)
    pushToast(
      n === selection.chosen.length ? 'success' : 'error',
      `${n} of ${selection.chosen.length} tasks set to ${statusText(bulkStatus as TaskStatus)}.${
        n < selection.chosen.length ? ' The rest were skipped (no access, already that status, or proof missing).' : ''
      }`,
    )
    setBulkStatus('')
    selection.clear()
    onChanged()
  }

  /** One cell of a board column: the text (for the CSV) and, where it has one, the rendering. */
  function cell(key: ColumnKey, t: TaskRow): Cell {
    const d = t.details ?? {}
    const none: Cell = { text: '' }
    const plain = (v: string): Cell => ({ text: v })
    const pill = (label: string, tone: Tone): Cell => ({ text: label, node: <StatusPill tone={tone}>{label}</StatusPill> })
    const person = (id: string | null | undefined): Cell => plain(id ? (names[id] ?? '') : '')
    const money = (v: number | null | undefined, zeroIsEmpty = true): Cell => {
      const n = Number(v ?? 0)
      return n > 0 || !zeroIsEmpty ? plain(formatMoney(n)) : none
    }
    const date = (v: string | null | undefined): Cell => (v ? plain(formatDate(v)) : none)
    const taskLinks = (list: LinkedTask[]): Cell =>
      list.length === 0
        ? none
        : {
            text: list.map((l) => l.task_no).join('; '),
            node: (
              <span className="tk-links">
                {list.map((l) => (
                  <Link key={l.id} to={taskHref(l.id)} className="mono" onClick={(e) => e.stopPropagation()}>
                    {l.task_no}
                  </Link>
                ))}
              </span>
            ),
          }

    switch (key) {
      case 'name':
        return {
          text: t.title,
          node: (
            <>
              <strong>{t.title}</strong>
              <span className="tk-sub mono">{t.task_no}</span>
            </>
          ),
        }
      case 'person':
        return person(t.assigned_to)
      case 'accounts':
        return person(t.accounts_staff_id)
      case 'buyer':
        return plain(t.buyer?.name ?? '')
      case 'supplier':
        return plain(t.supplier?.name ?? '')
      case 'buyer_messenger':
        return person(t.buyer?.messenger_id)
      case 'supplier_messenger':
        return person(t.supplier?.messenger_id)
      case 'created':
      case 'start_date':
        return date(t.start_date)
      case 'visited_date':
        return date(text(d.visited_on) || t.check_in_at)
      case 'gps': {
        if (t.lat == null || t.lng == null) return none
        return {
          text: `${t.lat},${t.lng}`,
          node: (
            <a
              href={`https://www.google.com/maps?q=${t.lat},${t.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              View
            </a>
          ),
        }
      }
      case 'check_in':
        return t.check_in_at ? plain(formatDateTime(t.check_in_at)) : none
      case 'check_out':
        return t.check_out_at ? plain(formatDateTime(t.check_out_at)) : none
      case 'summary': {
        const s = text(d.visit_summary)
        return s ? { text: s, node: <span className="tk-clip" title={s}>{s}</span> } : none
      }
      case 'pending_payment':
        return isPendingPayment(t) ? pill('Yes', 'warn') : pill('No', 'neutral')
      case 'visit_status': {
        const v = visitState(t)
        return v === 'completed' ? pill('Completed', 'ok') : v === 'visited' ? pill('Visited', 'info') : v === 'missed' ? pill('Missed', 'danger') : pill('Not Visited', 'neutral')
      }
      case 'payment_link':
        return taskLinks(links.pay.get(t.id) ?? [])
      case 'connected': {
        const s = t.source_task_id ? links.src.get(t.source_task_id) : undefined
        return s ? taskLinks([s]) : none
      }
      case 'status':
        return pill(statusText(t.status), STATUS_TONE[t.status])
      case 'task_status':
        return pill(STATUS_LABEL[t.status], STATUS_TONE[t.status])
      case 'invoice_no':
        return plain(text(d.invoice_no) || t.dispatch?.mill_invoice_no || t.ci?.invoice_no || '')
      case 'invoice_date':
        return date(text(d.invoice_date) || t.dispatch?.mill_invoice_date || t.ci?.invoice_date)
      case 'invoice_amount':
        return money(Number(t.amount) > 0 ? t.amount : t.ci?.amount)
      case 'delivery_mode':
        return d.delivery_mode === 'hand' ? plain('Hand') : d.delivery_mode === 'courier' ? plain('Courier') : none
      case 'invoice_status':
        return invoiceDelivered(t) ? pill('Delivered', 'ok') : pill('Not Delivered', 'warn')
      case 'proof': {
        const n = t.proofs?.[0]?.count ?? 0
        return n > 0 ? plain(`${n} ${n === 1 ? 'file' : 'files'}`) : none
      }
      case 'dispatch_link':
        return plain((board?.key === 'freight' ? t.dispatch?.transporter_invoice_no : null) || t.dispatch?.mill_invoice_no || '')
      case 'commission_link':
        return plain(t.ci?.invoice_no ?? '')
      case 'acknowledgement':
        return d.acknowledgement === 'yes' ? pill('Yes', 'ok') : d.acknowledgement === 'no' ? pill('No', 'warn') : none
      case 'transport_bill_no':
        return plain(text(d.bill_no) || t.dispatch?.transporter_invoice_no || '')
      case 'transport_amount':
        return money(t.amount)
      case 'load_reference':
        return plain(text(d.load_reference))
      case 'received':
        return d.received === 'yes' ? pill('Yes', 'ok') : pill('No', 'neutral')
      case 'check_status':
        return d.check_status === 'cleared' ? pill('Cleared', 'ok') : pill('Outstanding', 'warn')
      case 'sample_quality':
        return plain(text(d.sample_quality))
      case 'sample_type':
        return plain(text(d.sample_type))
      case 'sample_lot':
        return plain(text(d.sample_lot))
      case 'delivery_date':
        return date(text(d.delivery_date))
      case 'feedback_due': {
        const due = feedbackDueDate(t)
        if (!due) return none
        const late = feedbackPending(t) && due <= todayIST()
        return { text: formatDate(due), node: <span className={late ? 'tk-late' : undefined}>{formatDate(due)}</span> }
      }
      case 'feedback_status': {
        const f = d.feedback_status
        return f === 'approved' ? pill('Approved', 'ok') : f === 'rejected' ? pill('Rejected', 'danger') : pill('Pending', 'warn')
      }
      case 'amount':
        return money(t.amount)
      case 'collected':
        return money(t.amount_collected)
      case 'mode':
        return t.mode ? plain(MODE_LABEL[t.mode] ?? t.mode) : none
      case 'balance':
        return money(balanceOf(t), false)
      case 'payment_status':
        return t.status === 'done' || balanceOf(t) === 0 ? pill('Completed', 'ok') : pill('Outstanding', 'warn')
      case 'end_date':
        return date(t.completed_at)
      case 'days_aging': {
        const n = daysAging(t)
        return n == null ? none : plain(String(n))
      }
      default:
        return none
    }
  }

  function exportCSV() {
    const list = selection.chosen.length > 0 ? shown.filter((t) => selection.isSelected(t.id)) : shown
    const day = new Date().toISOString().slice(0, 10)
    if (board) {
      const cols = board.columns.filter((c) => c.key !== 'actions')
      const records = list.map((t) => Object.fromEntries(cols.map((c) => [c.label, cell(c.key, t).text])))
      downloadCSV(`${board.key}-${day}.csv`, toCSV(cols.map((c) => c.label), records))
      return
    }
    const records = list.map((t) => ({
      task_no: t.task_no,
      title: t.title,
      type: typeLabel.get(t.task_type) ?? t.task_type,
      buyer: t.buyer?.name ?? '',
      order: t.order?.order_no ?? '',
      assigned_to: t.assigned_to ? (names[t.assigned_to] ?? '') : '',
      due_date: t.due_date,
      status: STATUS_LABEL[t.status],
      priority: PRIORITY_LABEL[t.priority],
      amount: t.amount,
      amount_collected: t.amount_collected,
      balance: balanceOf(t),
    }))
    downloadCSV(`tasks-${day}.csv`, toCSV(CSV_COLUMNS, records))
  }

  function actionsFor(t: TaskRow): RowAction[] {
    const list: RowAction[] = [{ label: 'Open', onSelect: () => onOpen(t.id) }]
    if (!(canManage || canWork)) return list

    switch (board?.key) {
      case 'mill':
      case 'commission':
        if (!invoiceDelivered(t)) {
          list.push({ label: 'Mark delivered', onSelect: () => void patchDetails(t, { delivery_status: 'delivered' }, 'marked delivered.') })
        }
        break
      case 'freight':
        if (t.details?.check_status !== 'cleared') {
          list.push({ label: 'Mark cleared', onSelect: () => void patchDetails(t, { check_status: 'cleared' }, 'marked cleared.') })
        }
        break
      case 'samples':
        if (feedbackPending(t)) {
          list.push({ label: 'Approve feedback', onSelect: () => void patchDetails(t, { feedback_status: 'approved' }, 'feedback approved.') })
          list.push({ label: 'Reject feedback', tone: 'danger', onSelect: () => void patchDetails(t, { feedback_status: 'rejected' }, 'feedback rejected.') })
        }
        break
      case 'payments':
        list.push({ label: 'Record payment', onSelect: () => onOpen(t.id) })
        break
      default:
        break
    }

    if (isOpen(t.status)) {
      if (t.status === 'todo') {
        list.push({ label: 'Start', onSelect: () => void setTaskStatus(t, 'in_progress', 'started.') })
      }
      list.push({ label: 'Complete', onSelect: () => void setTaskStatus(t, 'done', 'completed.') })
      if (t.status === 'blocked') {
        list.push({ label: 'Unblock', onSelect: () => void setTaskStatus(t, 'in_progress', 'unblocked.') })
      } else {
        list.push({ label: 'Block', onSelect: () => void setTaskStatus(t, 'blocked', 'blocked.') })
      }
      if (canManage) {
        list.push({ label: 'Reassign', onSelect: () => setReassign(t) })
        list.push({ label: 'Cancel task', tone: 'danger', onSelect: () => void setTaskStatus(t, 'cancelled', 'cancelled.') })
      }
    } else if (canManage) {
      list.push({ label: 'Reopen', onSelect: () => void setTaskStatus(t, 'todo', 'reopened.') })
    }
    return list
  }

  if (!rows) return <Loading label="Loading tasks" />

  const defaultType = board?.taskType ?? view.types?.[0]
  const subtitle = filter && FILTER_LABEL[filter] ? `${FILTER_LABEL[filter]} · ${shown.length} ${shown.length === 1 ? SINGULAR : PLURAL}` : undefined
  const colCount = (board ? board.columns.length : 9) + 1

  return (
    <section className="md-pane tk-card">
      {creating && (
        <TaskForm
          defaultType={defaultType}
          onClose={() => setCreating(false)}
          onSaved={(task) => {
            setCreating(false)
            onChanged()
            onOpen(task.id)
          }}
        />
      )}
      {reassign && (
        <ReassignModal
          task={reassign}
          people={people}
          onClose={() => setReassign(null)}
          onAssign={async (user) => {
            const ok = await assignTasks([reassign.id], user)
            if (ok) setReassign(null)
          }}
        />
      )}

      <GridToolbar
        title={board?.title ?? view.label}
        subtitle={subtitle}
        total={shown.length}
        singular={SINGULAR}
        plural={PLURAL}
        query={search}
        onQuery={setSearch}
        searchPlaceholder={board ? 'Search name, buyer, supplier, invoice or order' : 'Search task no, title, buyer or order'}
        filters={filters}
        values={{ status, type, assignee, priority }}
        onFilter={(name, value) => {
          if (name === 'status') setStatus(value)
          else if (name === 'type') setType(value)
          else if (name === 'assignee') setAssignee(value)
          else if (name === 'priority') setPriority(value as TaskPriority | '')
        }}
        onClear={() => {
          setStatus('')
          setType('')
          setAssignee('')
          setPriority('')
        }}
      >
        <button className="btn" type="button" onClick={exportCSV} disabled={shown.length === 0}>
          {selection.chosen.length > 0 ? `Export ${selection.chosen.length}` : 'Export'}
        </button>
        {canCreate && (
          <button className="btn primary" type="button" onClick={() => setCreating(true)}>
            {board?.newLabel ?? 'New task'}
          </button>
        )}
      </GridToolbar>

      {filter && FILTER_LABEL[filter] && (
        <p className="tk-clear-note">
          <span>Showing: {FILTER_LABEL[filter]}</span>
          <Link to={view.key === 'all' ? '/tasks' : `/tasks?view=${view.key}`}>Clear quick filter</Link>
        </p>
      )}
      {loadError && (
        <div className="alert tk-banner" role="alert">
          {loadError}
        </div>
      )}

      <div className="table-wrap">
        <table className={board ? 'tk-board' : undefined}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={selection.allSelected}
                  onChange={selection.toggleAll}
                  aria-label="Select all tasks"
                />
              </th>
              {board ? (
                board.columns.map((c) => (
                  <th
                    key={c.key}
                    className={c.key === 'actions' ? 'tk-actions' : c.left ? 'left' : undefined}
                    aria-label={c.key === 'actions' ? 'Actions' : undefined}
                  >
                    {c.label}
                  </th>
                ))
              ) : (
                <>
                  <th className="left">Task</th>
                  <th>Type</th>
                  <th>Buyer</th>
                  <th>Assigned to</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Amount / Balance</th>
                  <th className="tk-actions">Actions</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {paging.visible.map((t) => {
              const late = daysOverdue(t)
              return (
                <tr key={t.id} className="clickable" onClick={() => onOpen(t.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selection.isSelected(t.id)}
                      onChange={() => selection.toggle(t.id)}
                      aria-label={`Select ${t.task_no}`}
                    />
                  </td>
                  {board ? (
                    board.columns.map((c) =>
                      c.key === 'actions' ? (
                        <td key={c.key} className="tk-actions" onClick={(e) => e.stopPropagation()}>
                          <RowActionMenu label={t.task_no} actions={actionsFor(t)} busy={busyId === t.id} />
                        </td>
                      ) : (
                        <td key={c.key} className={`${c.left ? 'left ' : ''}small`}>
                          {(() => {
                            const v = cell(c.key, t)
                            return v.node ?? (v.text || DASH)
                          })()}
                        </td>
                      ),
                    )
                  ) : (
                    <>
                      <td className="left">
                        <span className="mono tk-task-no">{t.task_no}</span>
                        <strong>{t.title}</strong>
                        {t.order?.order_no && <span className="tk-sub">Order {t.order.order_no}</span>}
                      </td>
                      <td className="small">{typeLabel.get(t.task_type) ?? t.task_type.replace(/_/g, ' ')}</td>
                      <td className="small">{t.buyer?.name ?? DASH}</td>
                      <td className="small">{t.assigned_to ? (names[t.assigned_to] ?? '…') : 'Unassigned'}</td>
                      <td>
                        <span className="tk-due">
                          {formatDate(t.due_date)}
                          {late > 0 && <StatusPill tone="danger">{late}d overdue</StatusPill>}
                        </span>
                      </td>
                      <td>
                        <StatusPill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusPill>
                      </td>
                      <td>
                        <StatusPill tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</StatusPill>
                      </td>
                      <td className="small">
                        {Number(t.amount) > 0 ? (
                          <span className="tk-money">
                            {formatMoney(t.amount)}
                            <span className="tk-sub">Balance {formatMoney(balanceOf(t))}</span>
                          </span>
                        ) : (
                          DASH
                        )}
                      </td>
                      <td className="tk-actions" onClick={(e) => e.stopPropagation()}>
                        <RowActionMenu label={t.task_no} actions={actionsFor(t)} busy={busyId === t.id} />
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr>
                <td className="empty" colSpan={colCount}>
                  {rows.length === 0
                    ? `No tasks yet.${canCreate ? ` Use ${board?.newLabel ?? 'New task'} to add one.` : ''}`
                    : `No ${board ? 'record' : 'task'} matches these filters.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selection.chosen.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <span className="bulk-count">{selection.chosen.length} selected</span>
          {canManage && (
            <>
              <select value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)} aria-label="Assign selected to">
                <option value="">Assign to…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button className="btn" type="button" disabled={!bulkAssignee || bulkBusy} onClick={() => void bulkAssign()}>
                Assign
              </button>
            </>
          )}
          {(canManage || canWork) && (
            <>
              <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} aria-label="Set status of selected">
                <option value="">Set status…</option>
                {statusOptions
                  .filter((o) => canManage || o.value !== 'cancelled')
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </select>
              <button className="btn" type="button" disabled={!bulkStatus || bulkBusy} onClick={() => void bulkSetStatus()}>
                Apply
              </button>
            </>
          )}
          <span className="bulk-sep" />
          <button className="btn" type="button" onClick={exportCSV}>
            Export CSV
          </button>
          <button className="btn" type="button" onClick={selection.clear}>
            Clear
          </button>
        </div>
      )}

      <GridPager {...paging.pager} singular={SINGULAR} plural={PLURAL} />
    </section>
  )
}

function ReassignModal({
  task,
  people,
  onClose,
  onAssign,
}: {
  task: TaskRow
  people: { id: string; label: string }[]
  onClose: () => void
  onAssign: (user: string) => Promise<void>
}) {
  const [user, setUser] = useState(task.assigned_to ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title="Reassign task"
      description={`${task.task_no} · ${task.title}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!user || user === task.assigned_to || busy}
            onClick={async () => {
              setBusy(true)
              await onAssign(user)
              setBusy(false)
            }}
          >
            {busy ? 'Saving…' : 'Reassign'}
          </button>
        </>
      }
    >
      <div className="tk-modal-field">
        <label htmlFor="tk-reassign">Assign to</label>
        <select id="tk-reassign" value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="">Choose a person…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  )
}
