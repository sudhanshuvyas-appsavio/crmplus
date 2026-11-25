/** The seven task boards of the monday.com "Tasks" folder, as configuration:
 *  the board's name, the columns it shows (in monday's order and with monday's
 *  labels), the fields of its creation form and the labels of its statuses.
 *
 *  Screens read this instead of hard-coding a board, so the queue, the form and
 *  the detail view of every board stay in step with each other. A board is a
 *  view over one task type: Monthly Visit -> `monthly_visit`, and so on. The
 *  Cheque Collection board is the one board whose rows are cheque records
 *  (task_cheques) rather than tasks; its columns are listed here too. */

import type { TaskStatus } from '../api/types'
import { MODE_OPTIONS } from './tasks'

/** What a cell can show. Each screen knows how to draw every key. */
export type ColumnKey =
  | 'name'              // the task title with its number underneath
  | 'person'            // assigned_to
  | 'accounts'          // accounts_staff_id
  | 'buyer'             // buyer name
  | 'buyer_messenger'   // the buyer's messenger (a user)
  | 'supplier'
  | 'supplier_messenger'
  | 'created'           // start_date
  | 'visited_date'      // details.visited_on or the check-in day
  | 'gps'               // lat / lng as a map link
  | 'check_in'
  | 'check_out'
  | 'summary'           // details.visit_summary
  | 'pending_payment'   // details.pending_payment as No / Yes
  | 'visit_status'      // details.visit_status as Not visited / Visited / Completed
  | 'payment_link'      // the payment-collection task opened from this one
  | 'connected'         // the task this one was opened from (source_task_id)
  | 'status'            // the board's own status labels (see statusLabels)
  | 'invoice_no'        // details.invoice_no (or the dispatch / commission invoice number)
  | 'invoice_date'
  | 'invoice_amount'    // tasks.amount
  | 'delivery_mode'
  | 'invoice_status'    // details.delivery_status as Not delivered / Delivered
  | 'proof'             // count of proof files, with a link to the gallery
  | 'dispatch_link'     // the dispatch the task came from
  | 'commission_link'   // the commission invoice the task came from
  | 'acknowledgement'
  | 'transport_bill_no' // details.bill_no
  | 'transport_amount'
  | 'load_reference'
  | 'received'          // details.received as Yes / No (the freight board's "Status")
  | 'check_status'      // details.check_status as Outstanding / Cleared
  | 'sample_quality'
  | 'sample_type'
  | 'sample_lot'
  | 'delivery_date'
  | 'feedback_due'      // delivery_date + 7 days
  | 'feedback_status'
  | 'amount'
  | 'collected'
  | 'mode'
  | 'balance'
  | 'payment_status'    // Outstanding / Completed
  | 'start_date'
  | 'end_date'          // completed_at
  | 'days_aging'        // days from start to end, or to today while open
  | 'task_status'       // the generic task status (To do / In progress / ...)
  // cheque board columns (rows are task_cheques)
  | 'cheque_no'
  | 'cheque_bank'
  | 'cheque_date'
  | 'cheque_amount'
  | 'deposit_status'    // Pending / Collected / Deposited / Cleared / Bounced
  | 'cheque_notes'
  | 'actions'

export interface BoardColumn {
  key: ColumnKey
  /** The column title as it appears on the monday board. */
  label: string
  /** Long text or names: left aligned. Everything else is centred. */
  left?: boolean
}

export type FieldKind = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea'

/** One field of the board's creation form. `details` fields are saved into
 *  tasks.details under `key`; `column` fields are plain columns of tasks. */
export interface FieldSpec {
  key: string
  label: string
  kind: FieldKind
  target: 'details' | 'column'
  options?: { value: string; label: string }[]
  required?: boolean
  hint?: string
}

/** The standard parts of the form every board has. */
export type CommonField = 'title' | 'assigned_to' | 'accounts_staff' | 'buyer' | 'supplier' | 'order' | 'due_date' | 'priority' | 'notes'

export interface BoardConfig {
  /** The value of ?view= on /tasks. */
  key: string
  /** The board's name on monday.com. */
  title: string
  /** One line saying what the board is for. */
  purpose: string
  /** The task type this board is a view over. */
  taskType: string
  /** The label of the button that adds a record: "New task", "New item". */
  newLabel: string
  /** What the assignee column is called: Person (one) or People (several on monday). */
  personLabel: string
  columns: BoardColumn[]
  /** Form fields in monday's order (after the common ones). */
  fields: FieldSpec[]
  common: CommonField[]
  /** The board's own words for the task status (monday's "Working on it / Stuck / Done"). */
  statusLabels?: Partial<Record<TaskStatus, string>>
  /** The headings of the form's sections as monday's creation form names them. */
  sections?: { general?: string; details?: string }
  /** Groups the rows are filed under, in order. `of` names how a row picks its group. */
  groups?: { key: string; label: string }[]
}

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

const PAYMENT_MODES = MODE_OPTIONS.filter((m) => ['online', 'cash', 'cheque'].includes(m.value))

export const TASK_BOARDS: BoardConfig[] = [
  {
    key: 'visits',
    title: 'Monthly Visit',
    purpose: 'Plan and log monthly visits to buyers: check in and out with the location, a meeting summary, and whether payment is still pending.',
    taskType: 'monthly_visit',
    sections: { general: 'Visit', details: 'Summaries' },
    newLabel: 'New task',
    personLabel: 'Person',
    common: ['title', 'assigned_to', 'accounts_staff', 'buyer', 'due_date', 'notes'],
    columns: [
      { key: 'name', label: 'Name', left: true },
      { key: 'person', label: 'Person' },
      { key: 'accounts', label: 'Accounts' },
      { key: 'buyer', label: 'Buyers Name', left: true },
      { key: 'buyer_messenger', label: 'Buyer Messenger' },
      { key: 'created', label: 'Created Date' },
      { key: 'visited_date', label: 'Visited Date' },
      { key: 'gps', label: 'GPS Check-In' },
      { key: 'check_in', label: 'Check-In Time' },
      { key: 'check_out', label: 'Check-Out Time' },
      { key: 'summary', label: 'Meeting Summary', left: true },
      { key: 'pending_payment', label: 'Pending Payment Status' },
      { key: 'visit_status', label: 'Visited/Not Visited' },
      { key: 'payment_link', label: 'link to Payment Collection' },
      { key: 'actions', label: '' },
    ],
    fields: [
      { key: 'pending_payment', label: 'Pending Payment Status', kind: 'checkbox', target: 'details', hint: 'Tick when the buyer still has payment pending. The reminders at 30, 45 and 60 days then open a Payment Collection task.' },
      {
        key: 'visit_status', label: 'Visited/Not Visited', kind: 'select', target: 'details',
        options: [{ value: 'planned', label: 'Not Visited' }, { value: 'visited', label: 'Visited' }, { value: 'completed', label: 'Completed' }],
      },
      { key: 'visited_on', label: 'Visited Date', kind: 'date', target: 'details' },
      { key: 'visit_summary', label: 'Meeting Summary', kind: 'textarea', target: 'details' },
    ],
  },
  {
    key: 'mill',
    title: 'Mill Invoice Delivery',
    purpose: 'Carry each mill invoice to the buyer, by hand or courier, and upload proof of delivery with the location.',
    taskType: 'mill_invoice_delivery',
    sections: { details: 'Delivery Information' },
    newLabel: 'New task',
    personLabel: 'People',
    common: ['title', 'assigned_to', 'accounts_staff', 'buyer', 'supplier', 'order', 'due_date', 'notes'],
    statusLabels: { todo: 'Working on it', in_progress: 'Working on it', blocked: 'Stuck', done: 'Done', cancelled: 'Cancelled' },
    columns: [
      { key: 'name', label: 'Name', left: true },
      { key: 'person', label: 'People' },
      { key: 'accounts', label: 'Accounts' },
      { key: 'status', label: 'Status' },
      { key: 'buyer', label: 'Buyers', left: true },
      { key: 'buyer_messenger', label: 'Buyer Messenger' },
      { key: 'supplier', label: 'Supplier Name', left: true },
      { key: 'supplier_messenger', label: 'Supplier Messenger' },
      { key: 'invoice_no', label: 'Invoice Number' },
      { key: 'invoice_date', label: 'Invoice Date' },
      { key: 'invoice_amount', label: 'Invoice Amount' },
      { key: 'delivery_mode', label: 'Delivery Mode' },
      { key: 'proof', label: 'Delivery Proof Upload' },
      { key: 'gps', label: 'GPS Check-In' },
      { key: 'dispatch_link', label: 'Dispatch and Billing' },
      { key: 'invoice_status', label: 'Invoice Status' },
      { key: 'actions', label: '' },
    ],
    fields: [
      { key: 'invoice_no', label: 'Invoice Number', kind: 'text', target: 'details' },
      { key: 'invoice_date', label: 'Invoice Date', kind: 'date', target: 'details' },
      { key: 'amount', label: 'Invoice Amount', kind: 'number', target: 'column' },
      { key: 'delivery_mode', label: 'Delivery Mode', kind: 'select', target: 'details', options: [{ value: 'hand', label: 'Hand' }, { value: 'courier', label: 'Courier' }] },
      { key: 'delivery_status', label: 'Invoice Status', kind: 'select', target: 'details', options: [{ value: 'not_delivered', label: 'Not Delivered' }, { value: 'delivered', label: 'Delivered' }] },
    ],
  },
  {
    key: 'commission',
    title: 'Commission Invoice Delivery',
    purpose: 'Hand over each commission invoice to the buyer, record the acknowledgement and flag whether payment is still pending.',
    taskType: 'commission_invoice_delivery',
    sections: { general: 'General Information', details: 'Commission Invoice Details' },
    newLabel: 'New task',
    personLabel: 'People',
    common: ['title', 'assigned_to', 'accounts_staff', 'buyer', 'order', 'due_date', 'notes'],
    columns: [
      { key: 'name', label: 'Name', left: true },
      { key: 'person', label: 'People' },
      { key: 'accounts', label: 'Accounts' },
      { key: 'commission_link', label: 'Commission Invoices' },
      { key: 'invoice_amount', label: 'Commission Amount' },
      { key: 'buyer', label: 'Buyer', left: true },
      { key: 'buyer_messenger', label: 'Buyer Messenger' },
      { key: 'invoice_no', label: 'Commission Invoice No.' },
      { key: 'invoice_date', label: 'Invoice Date' },
      { key: 'acknowledgement', label: 'Acknowledgement Received' },
      { key: 'proof', label: 'Photo Upload' },
      { key: 'gps', label: 'GPS Check-In' },
      { key: 'pending_payment', label: 'Pending Payment Status' },
      { key: 'created', label: 'Created Date' },
      { key: 'payment_link', label: 'link to Payment Collection' },
      { key: 'actions', label: '' },
    ],
    fields: [
      { key: 'invoice_no', label: 'Commission Invoice No.', kind: 'text', target: 'details' },
      { key: 'invoice_date', label: 'Invoice Date', kind: 'date', target: 'details' },
      { key: 'amount', label: 'Commission Amount', kind: 'number', target: 'column' },
      { key: 'acknowledgement', label: 'Acknowledgement Received', kind: 'select', target: 'details', options: YES_NO },
      { key: 'pending_payment', label: 'Pending Payment Status', kind: 'checkbox', target: 'details', hint: 'Tick when payment is still pending after delivery. A Payment Collection task is then opened.' },
    ],
  },
  {
    key: 'freight',
    title: 'Transport Freight Invoice',
    purpose: 'Check each transporter bill: bill number, amount, load reference and delivery proof, then clear it once paid.',
    taskType: 'freight_bill_check',
    sections: { details: 'Transport Details' },
    newLabel: 'New task',
    personLabel: 'Person',
    common: ['title', 'assigned_to', 'accounts_staff', 'buyer', 'order', 'due_date', 'notes'],
    columns: [
      { key: 'name', label: 'Name', left: true },
      { key: 'person', label: 'Person' },
      { key: 'accounts', label: 'Accounts' },
      { key: 'dispatch_link', label: 'Transport Invoice' },
      { key: 'buyer', label: 'Buyer', left: true },
      { key: 'transport_bill_no', label: 'Transport Bill No.' },
      { key: 'transport_amount', label: 'Transport Amount' },
      { key: 'load_reference', label: 'Load Reference' },
      { key: 'proof', label: 'Delivery Proof' },
      { key: 'gps', label: 'GPS Check-In' },
      { key: 'received', label: 'Status' },
      { key: 'check_status', label: 'Check' },
      { key: 'actions', label: '' },
    ],
    fields: [
      { key: 'bill_no', label: 'Transport Bill No.', kind: 'text', target: 'details' },
      { key: 'amount', label: 'Transport Amount', kind: 'number', target: 'column' },
      { key: 'load_reference', label: 'Load Reference', kind: 'text', target: 'details' },
      { key: 'received', label: 'Status', kind: 'select', target: 'details', options: YES_NO },
      { key: 'check_status', label: 'Check', kind: 'select', target: 'details', options: [{ value: 'outstanding', label: 'Outstanding' }, { value: 'cleared', label: 'Cleared' }] },
    ],
  },
  {
    key: 'samples',
    title: 'Sample Delivery',
    purpose: 'Samples that come from mills for a buyer: lot, quality and type, and the buyer’s feedback, due seven days after delivery.',
    taskType: 'sample_delivery',
    sections: { general: 'General Information' },
    newLabel: 'New task',
    personLabel: 'Person',
    common: ['title', 'assigned_to', 'accounts_staff', 'buyer', 'supplier', 'due_date', 'notes'],
    columns: [
      { key: 'name', label: 'Name', left: true },
      { key: 'person', label: 'Person' },
      { key: 'accounts', label: 'Accounts' },
      { key: 'buyer', label: 'Buyer', left: true },
      { key: 'buyer_messenger', label: 'Buyer Messenger' },
      { key: 'supplier', label: 'Supplier', left: true },
      { key: 'supplier_messenger', label: 'Supplier Messenger' },
      { key: 'sample_quality', label: 'Sample Quality', left: true },
      { key: 'sample_type', label: 'Sample Type' },
      { key: 'sample_lot', label: 'Sample Lot' },
      { key: 'delivery_date', label: 'Delivery Date' },
      { key: 'feedback_due', label: 'Feedback Due Date' },
      { key: 'feedback_status', label: 'Feedback Status' },
      { key: 'gps', label: 'GPS Check-In' },
      { key: 'proof', label: 'Photo Proof' },
      { key: 'actions', label: '' },
    ],
    fields: [
      { key: 'sample_quality', label: 'Sample Quality', kind: 'text', target: 'details' },
      { key: 'sample_type', label: 'Sample Type', kind: 'text', target: 'details' },
      { key: 'sample_lot', label: 'Sample Lot', kind: 'text', target: 'details' },
      { key: 'delivery_date', label: 'Delivery Date', kind: 'date', target: 'details', hint: 'Feedback is due seven days after this date.' },
      {
        key: 'feedback_status', label: 'Feedback Status', kind: 'select', target: 'details',
        options: [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }],
      },
    ],
  },
  {
    key: 'payments',
    title: 'Payment Collection',
    purpose: 'Payments to collect from buyers: amount, what has been collected so far, the mode and proof, with the balance and how long it has been open.',
    taskType: 'payment_collection',
    sections: { general: 'General Information', details: 'Payment Details' },
    newLabel: 'New payment',
    personLabel: 'Person',
    common: ['title', 'assigned_to', 'accounts_staff', 'buyer', 'order', 'due_date', 'notes'],
    columns: [
      { key: 'name', label: 'Name', left: true },
      { key: 'person', label: 'Person' },
      { key: 'accounts', label: 'Accounts' },
      { key: 'connected', label: 'Connected Boards' },
      { key: 'buyer', label: 'Buyer Name', left: true },
      { key: 'invoice_no', label: 'Invoice Number' },
      { key: 'amount', label: 'Amount' },
      { key: 'collected', label: 'Amount Collected' },
      { key: 'mode', label: 'Mode of Payment' },
      { key: 'proof', label: 'Payment Proof Upload' },
      { key: 'balance', label: 'Balance Amount' },
      { key: 'gps', label: 'GPS Check-In' },
      { key: 'payment_status', label: 'Payment Status' },
      { key: 'start_date', label: 'Start Date' },
      { key: 'end_date', label: 'End Date' },
      { key: 'days_aging', label: 'Days Aging' },
      { key: 'actions', label: '' },
    ],
    fields: [
      { key: 'invoice_no', label: 'Invoice Number', kind: 'text', target: 'details' },
      { key: 'amount', label: 'Amount', kind: 'number', target: 'column', required: true },
      { key: 'mode', label: 'Mode of Payment', kind: 'select', target: 'column', options: PAYMENT_MODES },
    ],
  },
  {
    key: 'cheques',
    title: 'Cheque Collection',
    purpose: 'Cheques collected from buyers: number, bank, date, amount and photo, then deposited and cleared.',
    taskType: 'cheque_collection',
    sections: { general: 'General Information', details: 'Cheque Collection Details' },
    newLabel: 'New cheque',
    personLabel: 'Person',
    common: ['buyer', 'order', 'notes'],
    columns: [
      { key: 'name', label: 'Name', left: true },
      { key: 'accounts', label: 'Accounts' },
      { key: 'person', label: 'Person' },
      { key: 'buyer', label: 'Buyer Name', left: true },
      { key: 'invoice_no', label: 'Invoice Number' },
      { key: 'cheque_no', label: 'Cheque Number' },
      { key: 'cheque_bank', label: 'Bank Name' },
      { key: 'cheque_date', label: 'Cheque Date' },
      { key: 'cheque_amount', label: 'Cheque Amount' },
      { key: 'proof', label: 'Cheque Photo Upload' },
      { key: 'deposit_status', label: 'Deposit Status' },
      { key: 'cheque_notes', label: 'Notes', left: true },
      { key: 'gps', label: 'GPS Check-In' },
      { key: 'actions', label: '' },
    ],
    fields: [],
    groups: [
      { key: 'to_collect', label: 'To Collect' },
      { key: 'in_progress', label: 'In Progress' },
      { key: 'collected', label: 'Collected' },
    ],
  },
]

export function boardFor(viewKey: string): BoardConfig | undefined {
  return TASK_BOARDS.find((b) => b.key === viewKey)
}

export function boardForType(taskType: string): BoardConfig | undefined {
  return TASK_BOARDS.find((b) => b.taskType === taskType)
}

/** A task status in the words of the board it belongs to. */
export function boardStatusLabel(board: BoardConfig | undefined, status: TaskStatus, fallback: string): string {
  return board?.statusLabels?.[status] ?? fallback
}
