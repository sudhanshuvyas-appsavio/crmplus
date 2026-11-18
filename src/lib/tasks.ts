/** Labels, tones, views and small helpers shared by every Tasks screen. */

import type { ChequeStatus, MessageStatus, PaymentMode, Task, TaskPriority, TaskStatus } from '../api/types'

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'muted'

export const OPEN_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked']
export const isOpen = (status: TaskStatus): boolean => OPEN_STATUSES.includes(status)

export const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]
export const STATUS_LABEL: Record<TaskStatus, string> = Object.fromEntries(
  STATUS_OPTIONS.map((o) => [o.value, o.label]),
) as Record<TaskStatus, string>
export const STATUS_TONE: Record<TaskStatus, Tone> = {
  todo: 'neutral',
  in_progress: 'info',
  blocked: 'warn',
  done: 'ok',
  cancelled: 'muted',
}

export const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]
export const PRIORITY_LABEL: Record<TaskPriority, string> = Object.fromEntries(
  PRIORITY_OPTIONS.map((o) => [o.value, o.label]),
) as Record<TaskPriority, string>
export const PRIORITY_TONE: Record<TaskPriority, Tone> = { low: 'muted', normal: 'neutral', high: 'warn', urgent: 'danger' }

export const MODE_OPTIONS: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'online', label: 'Online' },
  { value: 'neft', label: 'NEFT' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'upi', label: 'UPI' },
  { value: 'cards', label: 'Card' },
]
export const MODE_LABEL: Record<PaymentMode, string> = Object.fromEntries(
  MODE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<PaymentMode, string>

export const CHEQUE_STATUS_OPTIONS: { value: ChequeStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'collected', label: 'Collected' },
  { value: 'deposited', label: 'Deposited' },
  { value: 'cleared', label: 'Cleared' },
  { value: 'bounced', label: 'Bounced' },
]
export const CHEQUE_STATUS_TONE: Record<ChequeStatus, Tone> = {
  pending: 'neutral',
  collected: 'info',
  deposited: 'warn',
  cleared: 'ok',
  bounced: 'danger',
}

export const MESSAGE_STATUS_TONE: Record<MessageStatus, Tone> = {
  queued: 'neutral',
  sending: 'info',
  sent: 'info',
  delivered: 'ok',
  read: 'ok',
  replied: 'ok',
  failed: 'danger',
  manual: 'warn',
}

/** The sub-tabs of the Tasks module. `types` narrows the queue to those task types. */
export interface TaskView {
  key: string
  label: string
  types?: string[]
  mine?: boolean
  /** Shown only to people who may manage tasks. */
  manage?: boolean
}

export const TASK_VIEWS: TaskView[] = [
  { key: 'all', label: 'All tasks' },
  { key: 'mine', label: 'My tasks', mine: true },
  // The seven boards of the monday Tasks folder, in monday's order (see lib/taskBoards.ts).
  { key: 'visits', label: 'Monthly Visit', types: ['monthly_visit'] },
  { key: 'mill', label: 'Mill Invoice Delivery', types: ['mill_invoice_delivery', 'delivery_note'] },
  { key: 'commission', label: 'Commission Invoice Delivery', types: ['commission_invoice_delivery'] },
  { key: 'freight', label: 'Transport Freight Invoice', types: ['freight_bill_check'] },
  { key: 'samples', label: 'Sample Delivery', types: ['sample_delivery'] },
  { key: 'payments', label: 'Payment Collection', types: ['payment_collection', 'payment_deposit', 'mill_payment_deposit'] },
  { key: 'cheques', label: 'Cheque Collection', types: ['cheque_collection'] },
  { key: 'rules', label: 'Rules', manage: true },
  { key: 'messages', label: 'Messages', manage: true },
]

/** Today's date in India (the business runs on IST), as YYYY-MM-DD. */
export function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/** Whole days a task is past its due date (0 when it is not overdue or not open). */
export function daysOverdue(task: Pick<Task, 'status' | 'due_date'>, today = todayIST()): number {
  if (!isOpen(task.status)) return 0
  const diff = Math.round((Date.parse(today) - Date.parse(task.due_date)) / 86_400_000)
  return diff > 0 ? diff : 0
}

export const balanceOf = (task: Pick<Task, 'amount' | 'amount_collected'>): number =>
  Math.max(0, Number(task.amount) - Number(task.amount_collected))

const MONEY = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
export const formatMoney = (value: number | null | undefined): string => (value == null ? '—' : MONEY.format(Number(value)))

export const taskHref = (id: string): string => `/tasks?task=${id}`

export const TASK_BUCKET = 'task-proofs'

/** <task id>/<uuid>-<safe file name>: the first segment is what the storage policy reads. */
export function proofPath(taskId: string, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file'
  return `${taskId}/${crypto.randomUUID()}-${safe}`
}

/** Digits only, ready for a wa.me link or the sender (the database normalises again). */
export const phoneDigits = (value: string | null | undefined): string => (value ?? '').replace(/\D/g, '')
