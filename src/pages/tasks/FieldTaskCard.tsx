import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { errMessage } from '../../lib/party'
import { formatDate } from '../../lib/format'
import { MODE_OPTIONS, PRIORITY_LABEL, PRIORITY_TONE, balanceOf, daysOverdue, formatMoney, taskHref } from '../../lib/tasks'
import type { PaymentMode, Task } from '../../api/types'
import { CheckInButtons } from '../../components/GeoCapture'
import { ProofUpload } from '../../components/ProofUpload'
import { StatusPill } from '../../components/StatusPill'
import { pushToast } from '../../components/Toast'
import '../../styles/field.css'

export type FieldTask = Task & { buyer: { name: string } | null }

/** One open task in the phone view, with large buttons for the field actions. */
export default function FieldTaskCard({
  task,
  typeLabel,
  today,
  onChanged,
}: {
  task: FieldTask
  typeLabel: string
  today: string
  onChanged: () => void
}) {
  const [payOpen, setPayOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [busy, setBusy] = useState(false)

  const late = daysOverdue(task, today)
  const isPayment = task.task_type === 'payment_collection'

  async function addPayment() {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return pushToast('error', 'Enter the amount collected.')
    setBusy(true)
    const { error } = await supabase.rpc('task_add_payment', { p_task: task.id, p_amount: value, p_mode: mode })
    setBusy(false)
    if (error) return pushToast('error', errMessage(error, 'Could not record the payment'))
    pushToast('success', 'Payment recorded.')
    setAmount('')
    setPayOpen(false)
    onChanged()
  }

  async function markDone() {
    setBusy(true)
    const { error } = await supabase.rpc('task_set_status', { p_task: task.id, p_status: 'done' })
    setBusy(false)
    if (error) return pushToast('error', errMessage(error, 'Could not mark the task done'))
    pushToast('success', 'Task marked done.')
    onChanged()
  }

  return (
    <article className="field-task">
      <div className="field-task-head">
        <div>
          <h3>{task.title}</h3>
          <span className="muted small">{task.task_no} · {typeLabel}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {late > 0 && <StatusPill tone="danger">{late} day{late === 1 ? '' : 's'} overdue</StatusPill>}
          {(task.priority === 'high' || task.priority === 'urgent') && (
            <StatusPill tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</StatusPill>
          )}
        </div>
      </div>

      <div className="field-task-meta">
        {task.buyer?.name && <span>{task.buyer.name}</span>}
        <span>Due {formatDate(task.due_date)}</span>
        {isPayment && (
          <span>
            Balance {formatMoney(balanceOf(task))} <span className="muted">of {formatMoney(task.amount)}</span>
          </span>
        )}
      </div>

      <div className="field-actions">
        <CheckInButtons
          taskId={task.id}
          checkedIn={!!task.check_in_at}
          checkedOut={!!task.check_out_at}
          disabled={busy}
          big
          onDone={onChanged}
        />
        <ProofUpload taskId={task.id} kind="photo" camera withLocation label="Take photo" disabled={busy} onUploaded={onChanged} />
        {isPayment && (
          <button type="button" className="btn big" disabled={busy} onClick={() => setPayOpen((v) => !v)}>
            Add payment
          </button>
        )}
        <button type="button" className="btn big" disabled={busy} onClick={() => void markDone()}>
          Mark done
        </button>
        <Link className="btn big field-wide" to={taskHref(task.id)}>
          Details
        </Link>
      </div>

      {isPayment && payOpen && (
        <div className="field-pay">
          <div className="field-pay-row">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              aria-label="Amount collected"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <select aria-label="Payment mode" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <button type="button" className="btn primary big" disabled={busy} onClick={() => void addPayment()}>
            {busy ? 'Saving…' : 'Save payment'}
          </button>
        </div>
      )}
    </article>
  )
}
