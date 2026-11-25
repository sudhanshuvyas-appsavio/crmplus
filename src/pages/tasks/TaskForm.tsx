/** New / edit task, in the Master Data modal style: sections, a four column grid,
 *  required marks. The form follows the monday board of the task's type (see
 *  lib/taskBoards.ts): the standard fields the board has, then the board's own
 *  fields in monday's order and with monday's labels. Type-specific values are
 *  written into `tasks.details`; the `amount` and `mode` fields are columns.
 *
 *  Without task.manage a person can only create a task assigned to themselves
 *  (the row-level-security policy says so), and editing is for managers. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { PaymentMode, Task, TaskDetails, TaskPriority } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { Modal } from '../../components/Modal'
import { Field } from '../../components/PartyForms'
import { pushToast } from '../../components/Toast'
import { errMessage, numOrNull } from '../../lib/party'
import { MODE_OPTIONS, PRIORITY_OPTIONS, TASK_VIEWS, todayIST } from '../../lib/tasks'
import { boardFor, boardForType, type BoardConfig, type CommonField, type FieldSpec } from '../../lib/taskBoards'
import { useBuyerOptions, useOrderOptions, useProfileOptions, useSupplierOptions, useTaskTypes, type Option } from '../../lib/taskData'
import '../../styles/tasks-queue.css'
import '../../styles/tasks-detail.css'

/** Task types that carry an amount and a mode when no board covers them. */
const MONEY_TYPES = ['payment_collection', 'payment_deposit', 'mill_payment_deposit', 'freight_bill_check', 'commission_invoice_delivery']

const ALL_COMMON: CommonField[] = ['title', 'assigned_to', 'accounts_staff', 'buyer', 'supplier', 'order', 'due_date', 'priority', 'notes']

/** What a new task starts with in `details`, by board. */
const DETAIL_DEFAULTS: Record<string, Record<string, string>> = {
  visits: { visit_status: 'planned' },
  mill: { delivery_status: 'not_delivered' },
  commission: { delivery_status: 'not_delivered' },
  samples: { feedback_status: 'pending' },
  freight: { check_status: 'outstanding' },
}

/** The board a task type belongs to (types such as payment_deposit share the Payment Collection board). */
export function boardOfType(type: string): BoardConfig | undefined {
  if (!type) return undefined
  const direct = boardForType(type)
  if (direct) return direct
  const view = TASK_VIEWS.find((v) => v.types?.includes(type))
  return view ? boardFor(view.key) : undefined
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The label of a board column, or a fallback when the board does not have it. */
function columnLabel(board: BoardConfig | undefined, key: string, fallback: string): string {
  return board?.columns.find((c) => c.key === key)?.label || fallback
}

function detailFields(board: BoardConfig | undefined): FieldSpec[] {
  return board ? board.fields.filter((f) => f.target === 'details') : []
}

/** The `details` keys the form owns for a board; anything else on an edited task is kept as it was. */
function ownedKeys(board: BoardConfig | undefined): string[] {
  if (!board) return []
  return [...new Set([...detailFields(board).map((f) => f.key), ...Object.keys(DETAIL_DEFAULTS[board.key] ?? {})])]
}

function defaultDetails(type: string): Record<string, string | boolean> {
  const board = boardOfType(type)
  return board ? { ...(DETAIL_DEFAULTS[board.key] ?? {}) } : {}
}

interface FormState {
  task_type: string
  title: string
  priority: TaskPriority
  due_date: string
  start_date: string
  assigned_to: string
  accounts_staff_id: string
  buyer_id: string
  supplier_id: string
  order_id: string
  source_task_id: string
  amount: string
  mode: string
  notes: string
  details: Record<string, string | boolean>
}

function toForm(task: Task | null | undefined, type: string, myId: string, manager: boolean): FormState {
  if (task) {
    const details: Record<string, string | boolean> = {}
    for (const key of ownedKeys(boardOfType(task.task_type))) {
      const v = (task.details as Record<string, unknown>)[key]
      if (typeof v === 'boolean') details[key] = v
      else if (v != null) details[key] = String(v)
    }
    return {
      task_type: task.task_type,
      title: task.title,
      priority: task.priority,
      due_date: task.due_date,
      start_date: task.start_date,
      assigned_to: task.assigned_to ?? '',
      accounts_staff_id: task.accounts_staff_id ?? '',
      buyer_id: task.buyer_id ?? '',
      supplier_id: task.supplier_id ?? '',
      order_id: task.order_id ?? '',
      source_task_id: task.source_task_id ?? '',
      amount: Number(task.amount) > 0 ? String(task.amount) : '',
      mode: task.mode ?? '',
      notes: task.notes ?? '',
      details,
    }
  }
  const today = todayIST()
  return {
    task_type: type,
    title: '',
    priority: 'normal',
    due_date: today,
    start_date: today,
    assigned_to: manager ? '' : myId,
    accounts_staff_id: '',
    buyer_id: '',
    supplier_id: '',
    order_id: '',
    source_task_id: '',
    amount: '',
    mode: '',
    notes: '',
    details: defaultDetails(type),
  }
}

function OptionList({ options, blank = '—' }: { options: Option[]; blank?: string }) {
  return (
    <>
      <option value="">{blank}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
          {o.inactive ? ' (inactive)' : ''}
        </option>
      ))}
    </>
  )
}

export function TaskForm({
  task,
  defaultType,
  onClose,
  onSaved,
}: {
  task?: Task | null
  defaultType?: string
  onClose: () => void
  onSaved: (task: Task) => void
}) {
  const { me, can } = useAuth()
  const canManage = can('task.manage')
  const canWork = can('task.work')
  const myId = me?.id ?? ''
  const editing = Boolean(task)

  const types = useTaskTypes()
  const people = useProfileOptions()
  const buyers = useBuyerOptions()
  const suppliers = useSupplierOptions()
  const orders = useOrderOptions()

  const [form, setForm] = useState<FormState>(() => toForm(task, defaultType ?? '', myId, canManage))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dueTouched = useRef(editing)
  const assigneeTouched = useRef(editing)

  const typeRow = useMemo(() => types.find((t) => t.key === form.task_type), [types, form.task_type])

  // Payment Collection's "Connected Boards": the visit or commission delivery the payment belongs to.
  const [sources, setSources] = useState<Option[]>([])
  const isPayments = boardOfType(form.task_type)?.key === 'payments'
  useEffect(() => {
    if (!isPayments) return
    let live = true
    void supabase
      .from('tasks')
      .select('id, task_no, title, task_type')
      .in('task_type', ['monthly_visit', 'commission_invoice_delivery'])
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (!live) return
        const rows = (data ?? []) as { id: string; task_no: string; title: string; task_type: string }[]
        setSources(
          rows.map((r) => ({
            id: r.id,
            label: `${r.task_type === 'monthly_visit' ? 'Monthly Visit' : 'Commission Invoice'} · ${r.task_no} · ${r.title}`,
          })),
        )
      })
    return () => {
      live = false
    }
  }, [isPayments])

  // Once the types have loaded, a new task with no type yet takes the first one.
  useEffect(() => {
    if (!editing && !form.task_type && types.length > 0) {
      setForm((f) => ({ ...f, task_type: types[0]?.key ?? '' }))
    }
  }, [editing, form.task_type, types])

  // A new task starts with the board's own defaults (planned, not delivered, pending, outstanding).
  useEffect(() => {
    if (editing) return
    setForm((f) => ({ ...f, details: defaultDetails(f.task_type) }))
  }, [editing, form.task_type])

  // The due date follows the type's usual turnaround until someone sets it.
  useEffect(() => {
    if (editing || dueTouched.current || !typeRow) return
    setForm((f) => ({ ...f, due_date: addDays(todayIST(), typeRow.default_due_days) }))
  }, [editing, typeRow])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  function setDetail(key: string, value: string | boolean) {
    setForm((f) => ({ ...f, details: { ...f.details, [key]: value } }))
  }
  const text = (key: string) => (typeof form.details[key] === 'string' ? (form.details[key] as string) : '')

  /** Picking a buyer fills Person with the buyer's Messenger (as monday does), unless someone is already chosen. Accounts stay as typed. */
  async function pickBuyer(buyerId: string) {
    set('buyer_id', buyerId)
    if (!buyerId || !canManage || assigneeTouched.current || form.assigned_to) return
    const { data } = await supabase.from('buyer_master').select('messenger_id').eq('id', buyerId).maybeSingle()
    const row = data as { messenger_id: string | null } | null
    const staff = row?.messenger_id ?? ''
    if (staff && people.some((p) => p.id === staff)) {
      setForm((f) => (f.assigned_to ? f : { ...f, assigned_to: staff }))
    }
  }

  const type = form.task_type
  const board = useMemo(() => boardOfType(type), [type])
  const common = board?.common ?? ALL_COMMON
  // A board without a title field (Cheque Collection) still names its task.
  const has = (c: CommonField) => common.includes(c) || (c === 'title' && Boolean(board))
  const fields = board?.fields ?? []
  const showType = !board || (!editing && !boardOfType(defaultType ?? ''))
  const hasAmountField = fields.some((f) => f.target === 'column' && f.key === 'amount')
  const hasModeField = fields.some((f) => f.target === 'column' && f.key === 'mode')
  // Without a board, the money types keep the plain Amount / Mode pair.
  const showGenericMoney = !board && MONEY_TYPES.includes(type)
  const writesAmount = hasAmountField || showGenericMoney
  const writesMode = hasModeField || showGenericMoney
  const amountNum = numOrNull(form.amount)
  const amountLabel = fields.find((f) => f.target === 'column' && f.key === 'amount')?.label ?? 'Amount'
  const amountRequired = fields.some((f) => f.target === 'column' && f.key === 'amount' && f.required)

  const missing: string[] = []
  if (!type) missing.push('Type')
  if (!form.title.trim()) missing.push(board ? columnLabel(board, 'name', 'Name') : 'Title')
  if (has('due_date') && !form.due_date) missing.push('Due date')
  if (writesAmount && form.amount.trim() && (amountNum === null || amountNum < 0)) missing.push(`${amountLabel} (a number, not negative)`)
  if (writesAmount && amountRequired && !form.amount.trim()) missing.push(amountLabel)
  for (const f of fields) {
    if (!f.required || f.target !== 'details') continue
    const v = form.details[f.key]
    if (f.kind !== 'checkbox' && !(typeof v === 'string' && v.trim())) missing.push(f.label)
  }
  if (!canManage && !form.assigned_to) missing.push(board?.personLabel ?? 'Assigned to')

  const blocked = editing ? !canManage : !(canManage || canWork)

  async function save() {
    setBusy(true)
    setErr(null)

    const details: Record<string, unknown> = { ...(task?.details ?? {}) }
    const owned = ownedKeys(board)
    for (const key of owned) delete details[key]
    for (const key of owned) {
      const value = form.details[key]
      if (typeof value === 'boolean') details[key] = value
      else if (typeof value === 'string' && value.trim()) {
        const spec = detailFields(board).find((f) => f.key === key)
        const trimmed = value.trim()
        details[key] = spec?.kind === 'number' ? Number(trimmed) : trimmed
      }
    }
    // A ticked-then-cleared checkbox still reads as an explicit No.
    for (const f of detailFields(board)) {
      if (f.kind === 'checkbox' && typeof details[f.key] !== 'boolean') details[f.key] = false
    }

    const payload = {
      title: form.title.trim(),
      priority: form.priority,
      due_date: form.due_date,
      start_date: form.start_date || form.due_date,
      assigned_to: canManage ? form.assigned_to || null : myId,
      accounts_staff_id: canManage ? form.accounts_staff_id || null : null,
      buyer_id: form.buyer_id || null,
      supplier_id: form.supplier_id || null,
      order_id: form.order_id || null,
      ...(isPayments && canManage ? { source_task_id: form.source_task_id || null } : {}),
      amount: writesAmount ? (amountNum ?? 0) : Number(task?.amount ?? 0),
      mode: writesMode ? ((form.mode || null) as PaymentMode | null) : (task?.mode ?? null),
      notes: form.notes.trim() || null,
      details: details as TaskDetails,
    }

    const { data, error } = task
      ? await supabase.from('tasks').update(payload).eq('id', task.id).select('*').single()
      : await supabase.from('tasks').insert({ ...payload, task_type: type }).select('*').single()
    setBusy(false)
    if (error || !data) {
      setErr(errMessage(error, 'Could not save this task'))
      return
    }
    const saved = data as Task
    pushToast('success', `${saved.task_no} ${editing ? 'updated' : 'created'}.`)
    onSaved(saved)
  }

  const modalTitle = board ? (task ? `Edit ${board.title}` : board.newLabel) : task ? `Edit ${task.task_no}` : 'New task'
  const modalDescription = board ? (task ? `${board.title} · ${task.task_no}` : board.title) : task ? task.title : 'Fields marked * are required.'
  const createLabel = board ? board.newLabel.replace(/^New\b/, 'Create') : 'Create task'

  const peopleShown = has('assigned_to') || has('accounts_staff')
  const linksShown = has('buyer') || has('supplier') || has('order') || isPayments

  /** One board field, drawn by its kind. */
  function renderField(f: FieldSpec) {
    const id = `tf-f-${f.target}-${f.key}`
    const isColumn = f.target === 'column'
    const value = isColumn ? (f.key === 'amount' ? form.amount : f.key === 'mode' ? form.mode : '') : text(f.key)
    const onValue = (v: string) => {
      if (f.key === 'amount' && isColumn) set('amount', v)
      else if (f.key === 'mode' && isColumn) set('mode', v)
      else setDetail(f.key, v)
    }

    if (f.kind === 'checkbox') {
      return (
        <div className="field tk-wide" key={id}>
          <label className="check" htmlFor={id}>
            <input id={id} type="checkbox" checked={form.details[f.key] === true} onChange={(e) => setDetail(f.key, e.target.checked)} />
            <span className="check-body">
              <span className="check-label">{f.label}</span>
              {f.hint && <span className="check-hint">{f.hint}</span>}
            </span>
          </label>
        </div>
      )
    }
    if (f.kind === 'textarea') {
      return (
        <div className="tk-wide" key={id}>
          <Field id={id} label={f.label} required={f.required} hint={f.hint}>
            <textarea id={id} rows={3} value={value} onChange={(e) => onValue(e.target.value)} />
          </Field>
        </div>
      )
    }
    if (f.kind === 'select') {
      const defaulted = Boolean(DETAIL_DEFAULTS[board?.key ?? '']?.[f.key])
      return (
        <Field key={id} id={id} label={f.label} required={f.required} hint={f.hint}>
          <select id={id} value={value} onChange={(e) => onValue(e.target.value)}>
            {!defaulted && <option value="">—</option>}
            {(f.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )
    }
    if (f.kind === 'number') {
      return (
        <Field key={id} id={id} label={f.label} required={f.required} hint={f.hint}>
          <input id={id} inputMode="decimal" className="mono" value={value} onChange={(e) => onValue(e.target.value.replace(/[^0-9.]/g, ''))} />
        </Field>
      )
    }
    // monday shows the invoice number and date of a mill delivery as calculated fields (mirrors of Dispatch and Billing).
    const mirrored = board?.key === 'mill' && Boolean(task?.dispatch_id) && (f.key === 'invoice_no' || f.key === 'invoice_date')
    return (
      <Field key={id} id={id} label={f.label} required={f.required} hint={mirrored ? 'Calculated from Dispatch and Billing.' : f.hint}>
        <input id={id} type={f.kind === 'date' ? 'date' : 'text'} value={value} disabled={mirrored} onChange={(e) => onValue(e.target.value)} />
      </Field>
    )
  }

  return (
    <Modal
      title={modalTitle}
      description={modalDescription}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button className="btn primary" type="button" disabled={busy || blocked || missing.length > 0} onClick={() => void save()}>
            {busy ? 'Saving…' : task ? 'Save changes' : createLabel}
          </button>
        </>
      }
    >
      {err && (
        <div className="alert" role="alert">
          {err}
        </div>
      )}
      {blocked && (
        <div className="notice small">
          {editing ? 'Editing a task needs the “Create and manage tasks” permission.' : 'You do not have permission to create tasks.'}
        </div>
      )}
      {!canManage && !editing && !blocked && (
        <div className="notice small">You can create a task for yourself. Managers can assign tasks to anyone.</div>
      )}

      <fieldset className="tk-section" disabled={blocked || busy}>
        <h3>{board ? (board.sections?.general ?? board.title) : 'Task'}</h3>
        <div className="form-grid">
          {showType && (
            <Field id="tf-type" label="Type" required>
              <select id="tf-type" value={form.task_type} onChange={(e) => set('task_type', e.target.value)} disabled={editing}>
                {types.length === 0 && task && <option value={task.task_type}>{task.task_type.replace(/_/g, ' ')}</option>}
                {types.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('title') && (
            <Field id="tf-title" label={board ? columnLabel(board, 'name', 'Name') : 'Title'} required>
              <input id="tf-title" value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus />
            </Field>
          )}
          {has('priority') && (
            <Field id="tf-priority" label="Priority">
              <select id="tf-priority" value={form.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)}>
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('due_date') && (
            <Field id="tf-due" label="Due date" required>
              <input
                id="tf-due"
                type="date"
                value={form.due_date}
                onChange={(e) => {
                  dueTouched.current = true
                  set('due_date', e.target.value)
                }}
              />
            </Field>
          )}
          {!board && (
            <Field id="tf-start" label="Start date">
              <input id="tf-start" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </Field>
          )}
        </div>
      </fieldset>

      {peopleShown && (
        <fieldset className="tk-section" disabled={blocked || busy}>
          <h3>People</h3>
          <div className="form-grid">
            {has('assigned_to') && (
              <Field id="tf-assignee" label={board?.personLabel ?? 'Assigned to'} required={!canManage}>
                <select
                  id="tf-assignee"
                  value={form.assigned_to}
                  disabled={!canManage}
                  onChange={(e) => {
                    assigneeTouched.current = true
                    set('assigned_to', e.target.value)
                  }}
                >
                  <OptionList options={people} blank="Unassigned" />
                </select>
              </Field>
            )}
            {has('accounts_staff') && (
              <Field id="tf-accounts" label={board ? columnLabel(board, 'accounts', 'Accounts') : 'Accounts staff'}>
                <select id="tf-accounts" value={form.accounts_staff_id} disabled={!canManage} onChange={(e) => set('accounts_staff_id', e.target.value)}>
                  <OptionList options={people} />
                </select>
              </Field>
            )}
          </div>
        </fieldset>
      )}

      {linksShown && (
        <fieldset className="tk-section" disabled={blocked || busy}>
          <h3>Links</h3>
          <div className="form-grid">
            {has('buyer') && (
              <Field id="tf-buyer" label={columnLabel(board, 'buyer', 'Buyer')}>
                <select id="tf-buyer" value={form.buyer_id} onChange={(e) => void pickBuyer(e.target.value)}>
                  <OptionList options={buyers} />
                </select>
              </Field>
            )}
            {has('supplier') && (
              <Field id="tf-supplier" label={columnLabel(board, 'supplier', 'Supplier')}>
                <select id="tf-supplier" value={form.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
                  <OptionList options={suppliers} />
                </select>
              </Field>
            )}
            {has('order') && (
              <Field id="tf-order" label="Order">
                <select id="tf-order" value={form.order_id} onChange={(e) => set('order_id', e.target.value)}>
                  <OptionList options={orders} />
                </select>
              </Field>
            )}
            {isPayments && (
              <Field id="tf-source" label="Connected Boards" hint="The Monthly Visit or Commission Invoice Delivery this payment belongs to.">
                <select id="tf-source" value={form.source_task_id} disabled={!canManage} onChange={(e) => set('source_task_id', e.target.value)}>
                  <OptionList options={sources} />
                </select>
              </Field>
            )}
          </div>
        </fieldset>
      )}

      {showGenericMoney && (
        <fieldset className="tk-section" disabled={blocked || busy}>
          <h3>Money</h3>
          <div className="form-grid">
            <Field id="tf-amount" label="Amount" hint="Payments are recorded on the task afterwards.">
              <input id="tf-amount" inputMode="decimal" className="mono" value={form.amount} onChange={(e) => set('amount', e.target.value.replace(/[^0-9.]/g, ''))} />
            </Field>
            <Field id="tf-mode" label="Mode">
              <select id="tf-mode" value={form.mode} onChange={(e) => set('mode', e.target.value)}>
                <option value="">—</option>
                {MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </fieldset>
      )}

      {(fields.length > 0 || has('notes')) && (
        <fieldset className="tk-section" disabled={blocked || busy}>
          <h3>{fields.length > 0 ? (board?.sections?.details ?? 'Details') : 'Notes'}</h3>
          {fields.length > 0 && <div className="form-grid">{fields.map(renderField)}</div>}
          {has('notes') && (
            <Field id="tf-notes" label="Notes">
              <textarea id="tf-notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          )}
        </fieldset>
      )}

      {missing.length > 0 && !blocked && <p className="field-hint">Still needed: {missing.join(', ')}.</p>}
    </Modal>
  )
}
