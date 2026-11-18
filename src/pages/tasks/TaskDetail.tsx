/** One task in a dialog: details, proof and location, payments, cheque,
 *  messages and the timeline, with the status actions in the footer.
 *
 *  Who may act follows the database: people who manage tasks, or a person
 *  with the work permission on a task assigned to them (or where they are the
 *  accounts person). Everyone else sees it read-only. The database stays the
 *  judge: its refusal text is shown as it is. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { Modal } from '../../components/Modal'
import { Field } from '../../components/PartyForms'
import { StatusPill } from '../../components/StatusPill'
import { pushToast } from '../../components/Toast'
import { CheckInButtons } from '../../components/GeoCapture'
import { ProofGallery, ProofUpload } from '../../components/ProofUpload'
import { formatDate, formatDateTime } from '../../lib/format'
import { errMessage } from '../../lib/party'
import {
  MESSAGE_STATUS_TONE, MODE_LABEL, MODE_OPTIONS, PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE,
  CHEQUE_STATUS_OPTIONS, CHEQUE_STATUS_TONE, balanceOf, daysOverdue, formatMoney, isOpen, todayIST,
} from '../../lib/tasks'
import { boardStatusLabel, type ColumnKey } from '../../lib/taskBoards'
import { useProfileNameMap, useTaskTypes } from '../../lib/taskData'
import type { MessageRow, PaymentMode, Task, TaskCheque, TaskEvent, TaskPayment, TaskStatus } from '../../api/types'
import { ChequeForm } from './ChequeForm'
import { SendMessageDialog } from './SendMessage'
import { TaskForm, boardOfType } from './TaskForm'
import '../../styles/tasks-detail.css'

type TaskRow = Task & {
  buyer: { name: string; messenger_id: string | null } | null
  supplier: { name: string; messenger_id: string | null } | null
  order: { order_no: string | null } | null
}

/** The task this one was opened from, and the tasks opened from it (a visit's payment collection). */
interface TaskLinks {
  source: { task_no: string; title: string } | null
  children: { task_no: string; task_type: string; title: string }[]
}

type TabKey = 'details' | 'proof' | 'payments' | 'cheque' | 'messages' | 'timeline'

const PAYMENT_TYPES = ['payment_collection', 'payment_deposit', 'mill_payment_deposit']

/** Readable labels for the type-specific values kept in `tasks.details`. */
const DETAIL_LABELS: Record<string, string> = {
  delivery_mode: 'Delivery mode',
  delivery_status: 'Delivery status',
  acknowledgement: 'Acknowledged by buyer',
  pending_payment: 'Payment pending',
  invoice_no: 'Invoice no',
  bill_no: 'Bill no',
  load_reference: 'Load reference',
  check_status: 'Check status',
  sample_lot: 'Sample lot',
  sample_quality: 'Sample quality',
  sample_type: 'Sample type',
  delivery_date: 'Delivery date',
  feedback_status: 'Feedback',
  visit_status: 'Visit status',
  visited_on: 'Visited on',
  visit_summary: 'Visit summary',
  escalation: 'Escalation',
  step_days: 'Escalation step',
}

const DETAIL_VALUES: Record<string, Record<string, string>> = {
  delivery_mode: { hand: 'By hand', courier: 'Courier' },
  delivery_status: { not_delivered: 'Not delivered', delivered: 'Delivered' },
  acknowledgement: { yes: 'Yes', no: 'No' },
  check_status: { outstanding: 'Outstanding', cleared: 'Cleared' },
  feedback_status: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' },
  visit_status: { planned: 'Planned', visited: 'Visited', missed: 'Missed' },
}

const DATE_KEYS = new Set(['delivery_date', 'visited_on'])

function prettyKey(key: string): string {
  const spaced = key.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function detailValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (key === 'step_days') return `Day ${String(value)}`
  const text = String(value)
  if (DETAIL_VALUES[key]?.[text]) return DETAIL_VALUES[key][text]
  if (DATE_KEYS.has(key)) return formatDate(text)
  return typeof value === 'object' ? JSON.stringify(value) : text
}

/** monday's words for the select columns of the boards. */
const BOARD_WORDS: Record<string, Record<string, string>> = {
  delivery_mode: { hand: 'Hand', courier: 'Courier' },
  delivery_status: { not_delivered: 'Not Delivered', delivered: 'Delivered' },
  visit_status: { planned: 'Not Visited', visited: 'Visited', completed: 'Completed', missed: 'Missed' },
  check_status: { outstanding: 'Outstanding', cleared: 'Cleared' },
  feedback_status: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' },
  acknowledgement: { yes: 'Yes', no: 'No' },
  received: { yes: 'Yes', no: 'No' },
}

/** Details values the board columns already show; the rest go under "Other details". */
const BOARD_DETAIL_KEYS = new Set([
  'pending_payment', 'visit_status', 'visited_on', 'visit_summary', 'invoice_no', 'invoice_date', 'delivery_mode',
  'delivery_status', 'acknowledgement', 'bill_no', 'load_reference', 'received', 'check_status', 'sample_lot',
  'sample_quality', 'sample_type', 'delivery_date', 'feedback_status',
])

/** Columns that are shown by other parts of the dialog (the Proof & GPS tab) or are only buttons. */
const SKIPPED_COLUMNS: ColumnKey[] = ['actions', 'proof', 'gps']

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const istDate = (value: string): string => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

/** Whole days from the start date to the end date, or to today while the task is open. */
function daysAging(task: Task): number {
  const end = task.completed_at && !isOpen(task.status) ? istDate(task.completed_at) : todayIST()
  const diff = Math.round((Date.parse(end) - Date.parse(task.start_date)) / 86_400_000)
  return diff > 0 ? diff : 0
}

export function TaskDetail({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: string
  onClose: () => void
  onChanged: () => void
}) {
  const { me, can } = useAuth()
  const names = useProfileNameMap()
  const types = useTaskTypes()

  const [task, setTask] = useState<TaskRow | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [payments, setPayments] = useState<TaskPayment[]>([])
  const [cheques, setCheques] = useState<TaskCheque[]>([])
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [proofCount, setProofCount] = useState(0)
  const [proofKey, setProofKey] = useState(0)
  const [links, setLinks] = useState<TaskLinks>({ source: null, children: [] })

  const [tab, setTab] = useState<TabKey>('details')
  const [busy, setBusy] = useState(false)
  const [subDialog, setSubDialog] = useState<null | 'edit' | 'cheque' | 'message'>(null)
  const [editingCheque, setEditingCheque] = useState<TaskCheque | null>(null)

  const [comment, setComment] = useState('')
  const [pay, setPay] = useState({ amount: '', mode: '' as PaymentMode | '', reference: '', notes: '' })

  // The modal's Escape handling re-subscribes whenever onClose changes, so keep it
  // stable, and ignore it while a dialog stacked on top of this one is open.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const subOpen = useRef(false)
  subOpen.current = subDialog !== null
  const handleClose = useCallback(() => {
    if (!subOpen.current) onCloseRef.current()
  }, [])
  const closeSub = useCallback(() => {
    setSubDialog(null)
    setEditingCheque(null)
  }, [])

  const load = useCallback(async () => {
    const [t, pays, chq, msg, ev, proofs, kids] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, buyer:buyer_master(name, messenger_id), supplier:supplier_master(name, messenger_id), order:orders(order_no)')
        .eq('id', taskId)
        .maybeSingle(),
      supabase.from('task_payments').select('*').eq('task_id', taskId).order('created_at', { ascending: false }),
      supabase.from('task_cheques').select('*').eq('task_id', taskId).order('created_at', { ascending: false }),
      supabase.from('messages').select('*').eq('task_id', taskId).order('created_at', { ascending: false }),
      supabase.from('task_events').select('*').eq('task_id', taskId).order('created_at', { ascending: false }).order('id', { ascending: false }),
      supabase.from('task_attachments').select('id', { count: 'exact', head: true }).eq('task_id', taskId),
      supabase.from('tasks').select('task_no, task_type, title').eq('source_task_id', taskId).order('created_at', { ascending: true }),
    ])
    if (t.error || !t.data) {
      setLoadError(t.error ? errMessage(t.error, 'Could not load this task') : 'This task does not exist or you cannot see it.')
      return
    }
    const sourceId = (t.data as TaskRow).source_task_id
    const src = sourceId ? await supabase.from('tasks').select('task_no, title').eq('id', sourceId).maybeSingle() : null
    setLinks({
      source: (src?.data as TaskLinks['source']) ?? null,
      children: (kids.data ?? []) as TaskLinks['children'],
    })
    setLoadError(null)
    setTask(t.data as TaskRow)
    setPayments((pays.data ?? []) as TaskPayment[])
    setCheques((chq.data ?? []) as TaskCheque[])
    setMessages((msg.data ?? []) as MessageRow[])
    setEvents((ev.data ?? []) as TaskEvent[])
    setProofCount(proofs.count ?? 0)
    setProofKey((k) => k + 1)
  }, [taskId])

  useEffect(() => {
    void load()
  }, [load])

  /** After something changed: reload here, tell the list. */
  const changed = useCallback(async () => {
    await load()
    onChanged()
  }, [load, onChanged])

  const type = task ? types.find((t) => t.key === task.task_type) : undefined
  const typeLabel = type?.label ?? (task ? prettyKey(task.task_type) : '')
  const canManage = can('task.manage')
  const mine = Boolean(task && me && (task.assigned_to === me.id || task.accounts_staff_id === me.id))
  const canAct = canManage || (can('task.work') && mine)
  const open = task ? isOpen(task.status) : false
  const canMessage = canManage || can('message.send')
  const board = task ? boardOfType(task.task_type) : undefined
  /** A status in the words of the task's board ("Working on it", "Stuck", "Done"). */
  const statusName = (s: TaskStatus) => boardStatusLabel(board, s, STATUS_LABEL[s])

  async function setStatus(status: TaskStatus) {
    if (!task) return
    if (status === 'cancelled' && !window.confirm('Cancel this task?')) return
    setBusy(true)
    const { error } = await supabase.rpc('task_set_status', { p_task: task.id, p_status: status })
    setBusy(false)
    if (error) return pushToast('error', errMessage(error, 'Could not change the status'))
    pushToast('success', `Task is now ${statusName(status).toLowerCase()}.`)
    await changed()
  }

  async function addPayment() {
    if (!task) return
    const amount = Number(pay.amount)
    if (!(amount > 0)) return pushToast('error', 'Enter an amount more than zero.')
    setBusy(true)
    const { error } = await supabase.rpc('task_add_payment', {
      p_task: task.id,
      p_amount: amount,
      p_mode: pay.mode || null,
      p_reference: pay.reference.trim() || null,
      p_notes: pay.notes.trim() || null,
    })
    setBusy(false)
    if (error) return pushToast('error', errMessage(error, 'Could not record the payment'))
    pushToast('success', 'Payment recorded.')
    setPay({ amount: '', mode: '', reference: '', notes: '' })
    await changed()
  }

  async function addComment() {
    if (!task || !comment.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('task_add_comment', { p_task: task.id, p_text: comment.trim() })
    setBusy(false)
    if (error) return pushToast('error', errMessage(error, 'Could not add the comment'))
    setComment('')
    await changed()
  }

  if (!task) {
    return (
      <Modal size="xl" title="Task" onClose={handleClose} footer={<button type="button" className="btn" onClick={handleClose}>Close</button>}>
        {loadError ? (
          <div className="alert" role="alert">
            {loadError}
          </div>
        ) : (
          <p className="muted small">Loading…</p>
        )}
      </Modal>
    )
  }

  const showPayments = PAYMENT_TYPES.includes(task.task_type) || Number(task.amount) > 0
  const showCheque = task.task_type === 'cheque_collection'
  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'details', label: 'Details' },
    { key: 'proof', label: 'Proof & GPS', count: proofCount },
    ...(showPayments ? [{ key: 'payments' as const, label: 'Payments', count: payments.length }] : []),
    ...(showCheque ? [{ key: 'cheque' as const, label: 'Cheque', count: cheques.length }] : []),
    { key: 'messages', label: 'Messages', count: messages.length },
    { key: 'timeline', label: 'Timeline', count: events.length },
  ]
  const activeTab = tabs.some((t) => t.key === tab) ? tab : 'details'

  const overdue = daysOverdue(task)
  const balance = balanceOf(task)
  const person = (id: string | null) => (id ? (names[id] ?? 'Unknown user') : '—')

  const detailEntries = Object.entries(task.details ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
  const otherEntries = detailEntries.filter(([k]) => !BOARD_DETAIL_KEYS.has(k))
  const mapUrl = task.lat != null && task.lng != null ? `https://www.google.com/maps?q=${task.lat},${task.lng}` : null
  const boardColumns = board ? board.columns.filter((c) => !SKIPPED_COLUMNS.includes(c.key)) : []
  const t: TaskRow = task

  /* ---- footer actions ---- */
  // A board with its own status words names the buttons after them ("Mark stuck").
  const customWord = (s: TaskStatus) => (board?.statusLabels?.[s] && board.statusLabels[s] !== STATUS_LABEL[s] ? board.statusLabels[s] : null)
  const markWord = (s: TaskStatus, fallback: string) => {
    const w = customWord(s)
    return w ? `Mark ${w.toLowerCase()}` : fallback
  }
  const actions: { label: string; status: TaskStatus; primary?: boolean; danger?: boolean }[] = []
  if (canAct) {
    if (task.status === 'todo') actions.push({ label: 'Start', status: 'in_progress' })
    if (task.status === 'blocked') {
      const w = customWord('in_progress')
      actions.push({ label: w && w !== statusName('blocked') ? `Back to ${w.toLowerCase()}` : 'Unblock', status: 'in_progress' })
    }
    if (task.status === 'todo' || task.status === 'in_progress') actions.push({ label: markWord('blocked', 'Block'), status: 'blocked' })
    if (canManage && open) actions.push({ label: 'Cancel task', status: 'cancelled', danger: true })
    if (open) actions.push({ label: markWord('done', 'Mark done'), status: 'done', primary: true })
    if (canManage && !open) actions.push({ label: 'Reopen', status: 'todo', primary: true })
  }

  /** One column of the board as the detail grid shows it; null skips it. */
  function boardValue(key: ColumnKey): ReactNode {
    const d = (task?.details ?? {}) as Record<string, unknown>
    const str = (k: string): string => {
      const v = d[k]
      return v === null || v === undefined || v === '' ? '—' : String(v)
    }
    const word = (k: string): string => {
      const v = d[k]
      if (v === null || v === undefined || v === '') return '—'
      return BOARD_WORDS[k]?.[String(v)] ?? String(v)
    }
    const date = (v: unknown): string => (typeof v === 'string' && v ? formatDate(v) : '—')
    const money = (v: number | null | undefined): string => (Number(v) > 0 ? formatMoney(v) : '—')
    const cheque = cheques[0]
    switch (key) {
      case 'name': return t.title
      case 'person': return person(t.assigned_to)
      case 'accounts': return person(t.accounts_staff_id)
      case 'buyer': return t.buyer?.name ?? '—'
      case 'buyer_messenger': return person(t.buyer?.messenger_id ?? null)
      case 'supplier': return t.supplier?.name ?? '—'
      case 'supplier_messenger': return person(t.supplier?.messenger_id ?? null)
      case 'created': return formatDate(t.created_at)
      case 'visited_date': return d.visited_on ? date(d.visited_on) : t.check_in_at ? formatDate(t.check_in_at) : '—'
      case 'check_in': return formatDateTime(t.check_in_at)
      case 'check_out': return formatDateTime(t.check_out_at)
      case 'summary': return str('visit_summary')
      case 'pending_payment': return d.pending_payment === true ? 'Yes' : 'No'
      case 'visit_status': return word('visit_status')
      case 'payment_link': {
        const pays = links.children.filter((c) => PAYMENT_TYPES.includes(c.task_type))
        return pays.length > 0 ? pays.map((c) => c.task_no).join(', ') : '—'
      }
      case 'connected': return links.source ? `${links.source.task_no} · ${links.source.title}` : '—'
      case 'status': return statusName(t.status)
      case 'task_status': return STATUS_LABEL[t.status]
      case 'invoice_no': return str('invoice_no')
      case 'invoice_date': return date(d.invoice_date)
      case 'invoice_amount': return money(t.amount)
      case 'delivery_mode': return word('delivery_mode')
      case 'invoice_status': return word('delivery_status')
      case 'dispatch_link': return t.dispatch_id ? 'Linked' : '—'
      case 'commission_link': return t.commission_invoice_id ? 'Linked' : '—'
      case 'acknowledgement': return word('acknowledgement')
      case 'transport_bill_no': return str('bill_no')
      case 'transport_amount': return money(t.amount)
      case 'load_reference': return str('load_reference')
      case 'received': return word('received')
      case 'check_status': return word('check_status')
      case 'sample_quality': return str('sample_quality')
      case 'sample_type': return str('sample_type')
      case 'sample_lot': return str('sample_lot')
      case 'delivery_date': return date(d.delivery_date)
      case 'feedback_due': return typeof d.delivery_date === 'string' && d.delivery_date ? formatDate(addDays(d.delivery_date, 7)) : '—'
      case 'feedback_status': return word('feedback_status')
      case 'amount': return money(t.amount)
      case 'collected': return Number(t.amount_collected) > 0 ? formatMoney(t.amount_collected) : '—'
      case 'mode': return t.mode ? (MODE_LABEL[t.mode] ?? t.mode) : '—'
      case 'balance': return Number(t.amount) > 0 ? formatMoney(balance) : '—'
      case 'payment_status': return t.status === 'done' || (Number(t.amount) > 0 && balance <= 0) ? 'Completed' : 'Outstanding'
      case 'start_date': return formatDate(t.start_date)
      case 'end_date': return t.completed_at ? formatDate(t.completed_at) : '—'
      case 'days_aging': {
        const n = daysAging(t)
        return `${n} ${n === 1 ? 'day' : 'days'}`
      }
      case 'cheque_no': return cheque?.cheque_no ?? '—'
      case 'cheque_bank': return cheque?.bank_name ?? '—'
      case 'cheque_date': return cheque?.cheque_date ? formatDate(cheque.cheque_date) : '—'
      case 'cheque_amount': return cheque ? formatMoney(cheque.amount) : '—'
      case 'deposit_status': return cheque ? (CHEQUE_STATUS_OPTIONS.find((o) => o.value === cheque.status)?.label ?? cheque.status) : '—'
      case 'cheque_notes': return cheque?.notes ?? '—'
      default: return null
    }
  }

  return (
    <>
      <Modal
        size="xl"
        title={`${task.task_no} — ${task.title}`}
        description={typeLabel}
        onClose={handleClose}
        footer={
          <>
            <button type="button" className="btn" onClick={handleClose}>
              Close
            </button>
            <div className="td-actions">
              {!canAct && <span className="muted small">Read only: this task is not assigned to you.</span>}
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`}
                  disabled={busy}
                  onClick={() => void setStatus(a.status)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </>
        }
      >
        <div className="td-body">
          <div className="td-strip">
            <StatusPill tone={STATUS_TONE[task.status]}>{statusName(task.status)}</StatusPill>
            <StatusPill tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]} priority</StatusPill>
            {overdue > 0 && <StatusPill tone="danger">{overdue} {overdue === 1 ? 'day' : 'days'} overdue</StatusPill>}
            {task.status === 'done' && task.completed_at && (
              <span className="muted small">Completed {formatDateTime(task.completed_at)}</span>
            )}
          </div>

          <div className="sub-tabs" role="tablist" aria-label="Task sections">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                className={`sub-tab${activeTab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {t.count ? <span className="sub-tab-count">{t.count}</span> : null}
              </button>
            ))}
          </div>

          {/* ---------------- Details ---------------- */}
          {activeTab === 'details' && (
            <>
              <section className="td-section">
                <div className="td-head-row">
                  <h3>Task</h3>
                  {canManage && (
                    <button type="button" className="btn sm" onClick={() => setSubDialog('edit')}>
                      Edit
                    </button>
                  )}
                </div>
                {board ? (
                  <dl className="detail-grid">
                    <div><dt>Task no</dt><dd className="mono">{task.task_no}</dd></div>
                    <div><dt>Due date</dt><dd>{formatDate(task.due_date)}</dd></div>
                    {task.order && <div><dt>Order</dt><dd>{task.order.order_no ?? '—'}</dd></div>}
                    <div><dt>Created</dt><dd>{formatDateTime(task.created_at)}{task.created_by ? ` by ${person(task.created_by)}` : ''}</dd></div>
                    {task.completed_at && (
                      <div><dt>Completed</dt><dd>{formatDateTime(task.completed_at)}{task.completed_by ? ` by ${person(task.completed_by)}` : ''}</dd></div>
                    )}
                  </dl>
                ) : (
                <dl className="detail-grid">
                  <div><dt>Task no</dt><dd className="mono">{task.task_no}</dd></div>
                  <div><dt>Type</dt><dd>{typeLabel}</dd></div>
                  <div><dt>Due date</dt><dd>{formatDate(task.due_date)}</dd></div>
                  <div><dt>Start date</dt><dd>{formatDate(task.start_date)}</dd></div>
                  <div><dt>Assigned to</dt><dd>{person(task.assigned_to)}</dd></div>
                  <div><dt>Accounts staff</dt><dd>{person(task.accounts_staff_id)}</dd></div>
                  <div><dt>Buyer</dt><dd>{task.buyer?.name ?? '—'}</dd></div>
                  <div><dt>Supplier</dt><dd>{task.supplier?.name ?? '—'}</dd></div>
                  <div><dt>Order</dt><dd>{task.order?.order_no ?? '—'}</dd></div>
                  {(Number(task.amount) > 0 || Number(task.amount_collected) > 0) && (
                    <>
                      <div><dt>Amount</dt><dd>{formatMoney(task.amount)}</dd></div>
                      <div><dt>Collected</dt><dd>{formatMoney(task.amount_collected)}</dd></div>
                      <div><dt>Balance</dt><dd>{formatMoney(balance)}</dd></div>
                    </>
                  )}
                  {task.mode && <div><dt>Payment mode</dt><dd>{MODE_LABEL[task.mode] ?? task.mode}</dd></div>}
                  <div><dt>Created</dt><dd>{formatDateTime(task.created_at)}{task.created_by ? ` by ${person(task.created_by)}` : ''}</dd></div>
                  {task.completed_at && (
                    <div><dt>Completed</dt><dd>{formatDateTime(task.completed_at)}{task.completed_by ? ` by ${person(task.completed_by)}` : ''}</dd></div>
                  )}
                </dl>
                )}
              </section>

              {board && (
                <section className="td-section">
                  <h3>{board.title}</h3>
                  <dl className="detail-grid">
                    {boardColumns.map((c) => {
                      const value = boardValue(c.key)
                      if (value === null) return null
                      return (
                        <div key={`${c.key}-${c.label}`}>
                          <dt>{c.label}</dt>
                          <dd>{value}</dd>
                        </div>
                      )
                    })}
                  </dl>
                </section>
              )}

              {board && otherEntries.length > 0 && (
                <section className="td-section">
                  <h3>Other details</h3>
                  <dl className="detail-grid">
                    {otherEntries.map(([key, value]) => (
                      <div key={key}>
                        <dt>{DETAIL_LABELS[key] ?? prettyKey(key)}</dt>
                        <dd>{detailValue(key, value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {!board && detailEntries.length > 0 && (
                <section className="td-section">
                  <h3>{typeLabel} details</h3>
                  <dl className="detail-grid">
                    {detailEntries.map(([key, value]) => (
                      <div key={key}>
                        <dt>{DETAIL_LABELS[key] ?? prettyKey(key)}</dt>
                        <dd>{detailValue(key, value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              <section className="td-section">
                <h3>Notes</h3>
                {task.notes ? <p className="td-notes">{task.notes}</p> : <p className="td-empty">No notes.</p>}
              </section>
            </>
          )}

          {/* ---------------- Proof & GPS ---------------- */}
          {activeTab === 'proof' && (
            <>
              {type?.requires_proof && proofCount === 0 && (
                <p className="td-hint" role="status">
                  Proof is required: upload a photo before this task can be completed.
                </p>
              )}
              {type?.requires_gps && task.lat == null && open && (
                <p className="td-hint" role="status">
                  This task records a location: check in from the place of the visit or delivery.
                </p>
              )}
              <section className="td-section">
                <h3>Check in and out</h3>
                <dl className="detail-grid">
                  <div><dt>Checked in</dt><dd>{formatDateTime(task.check_in_at)}</dd></div>
                  <div><dt>Checked out</dt><dd>{formatDateTime(task.check_out_at)}</dd></div>
                  <div>
                    <dt>Location</dt>
                    <dd>
                      {mapUrl ? (
                        <>
                          {Number(task.lat).toFixed(5)}, {Number(task.lng).toFixed(5)}
                          {task.accuracy_m != null ? ` (±${Math.round(Number(task.accuracy_m))} m)` : ''}{' '}
                          <a href={mapUrl} target="_blank" rel="noreferrer">View on map</a>
                        </>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                </dl>
                {canAct && (
                  <div className="td-row" style={{ marginTop: 12 }}>
                    <CheckInButtons
                      taskId={task.id}
                      checkedIn={Boolean(task.check_in_at)}
                      checkedOut={Boolean(task.check_out_at)}
                      disabled={!open || busy}
                      onDone={() => void changed()}
                    />
                  </div>
                )}
              </section>
              <section className="td-section">
                <div className="td-head-row">
                  <h3>Proof</h3>
                  {canAct && (
                    <div className="td-row">
                      <ProofUpload taskId={task.id} camera withLocation label="Take photo" onUploaded={() => void changed()} />
                      <ProofUpload taskId={task.id} label="Upload file" onUploaded={() => void changed()} />
                    </div>
                  )}
                </div>
                <ProofGallery taskId={task.id} refreshKey={proofKey} />
              </section>
            </>
          )}

          {/* ---------------- Payments ---------------- */}
          {activeTab === 'payments' && showPayments && (
            <>
              <div className="td-money">
                <div><span>Amount</span><strong>{formatMoney(task.amount)}</strong></div>
                <div><span>Collected</span><strong>{formatMoney(task.amount_collected)}</strong></div>
                <div><span>Balance</span><strong>{formatMoney(balance)}</strong></div>
              </div>

              <section className="td-section">
                <h3>Payments received</h3>
                {payments.length === 0 ? (
                  <p className="td-empty">No payments recorded yet.</p>
                ) : (
                  <div className="td-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th className="num">Amount</th>
                          <th>Mode</th>
                          <th>Reference</th>
                          <th>Notes</th>
                          <th>Recorded by</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id}>
                            <td>{formatDate(p.paid_on)}</td>
                            <td className="num">{formatMoney(p.amount)}</td>
                            <td>{p.mode ? (MODE_LABEL[p.mode] ?? p.mode) : '—'}</td>
                            <td>{p.reference ?? '—'}</td>
                            <td>
                              {p.notes ?? '—'}
                              {p.order_payment_id && (
                                <div><StatusPill tone="info" title="A matching buyer receipt was posted on the order">Posted to the order</StatusPill></div>
                              )}
                            </td>
                            <td>{person(p.created_by)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {canAct && open ? (
                <section className="td-section">
                  <h3>Add a payment</h3>
                  <div className="td-pay-form">
                    <Field id="pay-amount" label="Amount" required>
                      <input
                        id="pay-amount"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={pay.amount}
                        placeholder={balance > 0 ? String(balance) : undefined}
                        onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))}
                      />
                    </Field>
                    <Field id="pay-mode" label="Mode">
                      <select id="pay-mode" value={pay.mode} onChange={(e) => setPay((p) => ({ ...p, mode: e.target.value as PaymentMode | '' }))}>
                        <option value="">—</option>
                        {MODE_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field id="pay-ref" label="Reference">
                      <input id="pay-ref" value={pay.reference} onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))} />
                    </Field>
                    <Field id="pay-notes" label="Notes">
                      <input id="pay-notes" value={pay.notes} onChange={(e) => setPay((p) => ({ ...p, notes: e.target.value }))} />
                    </Field>
                  </div>
                  <button type="button" className="btn primary" disabled={busy || !(Number(pay.amount) > 0)} onClick={() => void addPayment()}>
                    {busy ? 'Saving…' : 'Add payment'}
                  </button>
                </section>
              ) : (
                !open && <p className="muted small">This task is closed. Reopen it to record another payment.</p>
              )}
            </>
          )}

          {/* ---------------- Cheque ---------------- */}
          {activeTab === 'cheque' && showCheque && (
            <section className="td-section">
              <div className="td-head-row">
                <h3>Cheques for this task</h3>
                {canAct && open && (
                  <button type="button" className="btn sm" onClick={() => { setEditingCheque(null); setSubDialog('cheque') }}>
                    Add cheque
                  </button>
                )}
              </div>
              {cheques.length === 0 ? (
                <p className="td-empty">No cheque recorded for this task yet.</p>
              ) : (
                <div className="td-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Cheque no</th>
                        <th>Bank</th>
                        <th>Cheque date</th>
                        <th className="num">Amount</th>
                        <th>Status</th>
                        <th>Deposit</th>
                        <th>Photo</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {cheques.map((c) => (
                        <tr key={c.id}>
                          <td className="mono">{c.cheque_no}</td>
                          <td>{c.bank_name ?? '—'}</td>
                          <td>{formatDate(c.cheque_date)}</td>
                          <td className="num">{formatMoney(c.amount)}</td>
                          <td>
                            <StatusPill tone={CHEQUE_STATUS_TONE[c.status]}>
                              {CHEQUE_STATUS_OPTIONS.find((o) => o.value === c.status)?.label ?? c.status}
                            </StatusPill>
                          </td>
                          <td className="cq-dep">
                            {c.deposit_bank || c.slip_no || c.deposited_on
                              ? [c.deposit_bank, c.slip_no ? `Slip ${c.slip_no}` : null, c.deposited_on ? formatDate(c.deposited_on) : null].filter(Boolean).join(' · ')
                              : '—'}
                          </td>
                          <td>{c.photo_path ? <span className="cq-photo">✓</span> : '—'}</td>
                          <td>
                            {canAct && (
                              <button type="button" className="btn ghost sm" onClick={() => { setEditingCheque(c); setSubDialog('cheque') }}>
                                Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ---------------- Messages ---------------- */}
          {activeTab === 'messages' && (
            <section className="td-section">
              <div className="td-head-row">
                <h3>Messages sent for this task</h3>
                {canMessage && (
                  <button type="button" className="btn sm" onClick={() => setSubDialog('message')}>
                    Send message
                  </button>
                )}
              </div>
              {messages.length === 0 ? (
                <p className="td-empty">No messages yet.</p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="td-msg">
                    <div className="td-msg-top">
                      <StatusPill tone={MESSAGE_STATUS_TONE[m.status]}>{m.status}</StatusPill>
                      <strong>{m.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</strong>
                      <span className="muted">{m.direction === 'in' ? 'from' : 'to'} {m.recipient}</span>
                      <span className="muted small">{formatDateTime(m.sent_at ?? m.created_at)}</span>
                    </div>
                    {m.subject && <strong>{m.subject}</strong>}
                    <p className="td-msg-body">{m.body}</p>
                    {m.error && <p className="td-msg-err">{m.error}</p>}
                  </div>
                ))
              )}
            </section>
          )}

          {/* ---------------- Timeline ---------------- */}
          {activeTab === 'timeline' && (
            <section className="td-section">
              {events.length === 0 ? (
                <p className="td-empty">Nothing has happened on this task yet.</p>
              ) : (
                <ul className="tl">
                  {events.map((e) => (
                    <li key={e.id}>
                      <span className={`tl-dot ${e.kind}`} aria-hidden="true" />
                      <div>
                        <div>{describeEvent(e, names, statusName)}</div>
                        <div className="tl-meta">
                          {e.created_by ? (names[e.created_by] ?? 'Unknown user') : 'System'} · {formatDateTime(e.created_at)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="td-comment">
                <label htmlFor="td-comment" className="small muted">Add a comment</label>
                <textarea
                  id="td-comment"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Write a note for the timeline"
                />
                <button type="button" className="btn" disabled={busy || !comment.trim()} onClick={() => void addComment()}>
                  Add comment
                </button>
              </div>
            </section>
          )}
        </div>
      </Modal>

      {subDialog === 'edit' && (
        <TaskForm
          task={task}
          onClose={closeSub}
          onSaved={() => {
            closeSub()
            void changed()
          }}
        />
      )}
      {subDialog === 'cheque' && (
        <ChequeForm
          cheque={editingCheque}
          taskId={task.id}
          onClose={closeSub}
          onSaved={() => void changed()}
        />
      )}
      {subDialog === 'message' && (
        <SendMessageDialog
          task={task}
          onClose={closeSub}
          onSent={() => {
            closeSub()
            void changed()
          }}
        />
      )}
    </>
  )
}

function describeEvent(e: TaskEvent, names: Record<string, string>, statusName: (s: TaskStatus) => string): string {
  const status = (v: string | null) => (v ? (STATUS_LABEL[v as TaskStatus] ? statusName(v as TaskStatus) : v) : '—')
  const who = (v: string | null) => (v ? (names[v] ?? 'someone') : 'nobody')
  switch (e.kind) {
    case 'created':
      return e.note ? `Task created: ${e.note}` : 'Task created'
    case 'status':
      return `Status changed from ${status(e.from_value)} to ${status(e.to_value)}`
    case 'assigned':
      return e.to_value ? `Assigned to ${who(e.to_value)}` : 'Assignment removed'
    case 'comment':
      return e.note ?? 'Comment'
    case 'check_in': {
      const lat = e.data?.lat
      const lng = e.data?.lng
      return lat != null && lng != null ? `Checked in at ${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : 'Checked in'
    }
    case 'check_out':
      return e.note ? `Checked out: ${e.note}` : 'Checked out'
    case 'payment': {
      const amount = e.to_value ? formatMoney(Number(e.to_value)) : 'Payment'
      return `${amount} collected${e.note ? ` (${e.note})` : ''}`
    }
    case 'proof':
      return `Proof added${e.note ? `: ${e.note}` : ''}`
    case 'message':
      return `Message sent by ${e.to_value === 'email' ? 'email' : (e.to_value ?? 'message')}${e.note ? ` (${e.note})` : ''}`
    default:
      return e.note ?? e.kind.replace(/_/g, ' ')
  }
}
