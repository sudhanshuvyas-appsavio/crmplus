/** New / edit cheque. A cheque is always tied to a task so the photo goes through
 *  the normal task proof flow: when none is given, a cheque_collection task is
 *  created first and removed again if the cheque itself is refused. */

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { Modal } from '../../components/Modal'
import { Field } from '../../components/PartyForms'
import { ProofUpload } from '../../components/ProofUpload'
import { pushToast } from '../../components/Toast'
import { errMessage } from '../../lib/party'
import { todayIST } from '../../lib/tasks'
import { useBuyerOptions, useOrderOptions, useProfileOptions } from '../../lib/taskData'
import type { TaskCheque } from '../../api/types'
import '../../styles/tasks-detail.css'

interface FormState {
  cheque_no: string
  invoice_no: string
  bank_name: string
  cheque_date: string
  amount: string
  buyer_id: string
  order_id: string
  collection_date: string
  collected_by: string
  notes: string
}

function chequeError(caught: unknown, fallback: string): string {
  const text = errMessage(caught, fallback)
  return /task_cheques_no_bank|duplicate key/i.test(text) ? 'A cheque with this number and bank is already on record.' : text
}

export function ChequeForm({
  cheque,
  taskId,
  onClose,
  onSaved,
}: {
  cheque?: TaskCheque | null
  taskId?: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { me, can } = useAuth()
  const canManage = can('task.manage')
  const buyers = useBuyerOptions()
  const orders = useOrderOptions()
  const people = useProfileOptions()
  const today = todayIST()

  const [form, setForm] = useState<FormState>(() => ({
    cheque_no: cheque?.cheque_no ?? '',
    invoice_no: cheque?.invoice_no ?? '',
    bank_name: cheque?.bank_name ?? '',
    cheque_date: cheque?.cheque_date ?? '',
    amount: cheque ? String(cheque.amount) : '',
    buyer_id: cheque?.buyer_id ?? '',
    order_id: cheque?.order_id ?? '',
    collection_date: cheque?.collection_date ?? today,
    collected_by: cheque?.collected_by ?? me?.id ?? '',
    notes: cheque?.notes ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Set once a new cheque is saved: the task the photo should be attached to.
  const [saved, setSaved] = useState<{ taskId: string; photo: boolean } | null>(null)
  const touchedParty = useRef(false)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    if (key === 'buyer_id' || key === 'order_id') touchedParty.current = true
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // A cheque added from a task starts with that task's buyer, order and amount.
  useEffect(() => {
    if (cheque || !taskId) return
    let live = true
    void supabase
      .from('tasks')
      .select('buyer_id,order_id,amount')
      .eq('id', taskId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live || !data || touchedParty.current) return
        const t = data as { buyer_id: string | null; order_id: string | null; amount: number }
        setForm((prev) => ({
          ...prev,
          buyer_id: prev.buyer_id || t.buyer_id || '',
          order_id: prev.order_id || t.order_id || '',
          amount: prev.amount || (Number(t.amount) > 0 ? String(t.amount) : ''),
        }))
      })
    return () => {
      live = false
    }
  }, [cheque, taskId])

  const amountNum = Number(form.amount)
  const missing: string[] = []
  if (!form.cheque_no.trim()) missing.push('Cheque number')
  if (!(amountNum > 0)) missing.push('Amount (more than zero)')

  const buyerName = (id: string) => (buyers.find((b) => b.id === id)?.label ?? '').replace(/\s*\([^)]*\)\s*$/, '')

  async function save() {
    setBusy(true)
    setErr(null)
    const payload = {
      cheque_no: form.cheque_no.trim(),
      invoice_no: form.invoice_no.trim() || null,
      bank_name: form.bank_name.trim() || null,
      cheque_date: form.cheque_date || null,
      amount: amountNum,
      buyer_id: form.buyer_id || null,
      order_id: form.order_id || null,
      collection_date: form.collection_date || today,
      collected_by: form.collected_by || null,
      notes: form.notes.trim() || null,
    }

    if (cheque) {
      const { data, error } = await supabase.from('task_cheques').update(payload).eq('id', cheque.id).select('id')
      setBusy(false)
      if (error) return setErr(chequeError(error, 'Could not save the cheque'))
      if (!data || data.length === 0) return setErr('Your account cannot change this cheque.')
      pushToast('success', 'Cheque updated.')
      onSaved()
      onClose()
      return
    }

    let linkedTask = taskId ?? null
    let createdTask: string | null = null
    if (!linkedTask) {
      const collector = canManage ? payload.collected_by : (me?.id ?? null)
      const buyer = payload.buyer_id ? buyerName(payload.buyer_id) : ''
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          task_type: 'cheque_collection',
          title: `Cheque ${payload.cheque_no}${buyer ? ` - ${buyer}` : ''}`,
          status: 'in_progress',
          assigned_to: collector,
          buyer_id: payload.buyer_id,
          order_id: payload.order_id,
          amount: payload.amount,
        })
        .select('id')
        .single()
      if (error || !data) {
        setBusy(false)
        return setErr(errMessage(error, 'Could not create the collection task for this cheque'))
      }
      createdTask = (data as { id: string }).id
      linkedTask = createdTask
    }

    const { error } = await supabase
      .from('task_cheques')
      .insert({ ...payload, collected_by: canManage ? payload.collected_by : (me?.id ?? null), task_id: linkedTask })
    if (error) {
      if (createdTask) {
        // Take the task away again; someone who cannot delete cancels it instead.
        const del = await supabase.from('tasks').delete().eq('id', createdTask).select('id')
        if (del.error || !del.data || del.data.length === 0) {
          await supabase.rpc('task_set_status', { p_task: createdTask, p_status: 'cancelled' })
        }
      }
      setBusy(false)
      return setErr(chequeError(error, 'Could not save the cheque'))
    }
    setBusy(false)
    pushToast('success', 'Cheque saved.')
    setSaved({ taskId: linkedTask as string, photo: false })
  }

  function finish() {
    onSaved()
    onClose()
  }

  if (saved) {
    return (
      <Modal
        size="lg"
        title="Cheque saved"
        description={`${form.cheque_no.trim()} for ${Number(form.amount).toLocaleString('en-IN')}`}
        onClose={finish}
        footer={
          <>
            <span />
            <button type="button" className="btn primary" onClick={finish}>
              Done
            </button>
          </>
        }
      >
        <div className="td-followup">
          <h3>Photo of the cheque</h3>
          <p>
            A photo marks the cheque as collected. Take it now, or add it later from the task&apos;s Proof &amp; GPS tab.
          </p>
          <div className="td-row">
            <ProofUpload
              taskId={saved.taskId}
              camera
              withLocation
              label="Take photo"
              onUploaded={() => setSaved((s) => (s ? { ...s, photo: true } : s))}
            />
            <ProofUpload taskId={saved.taskId} label="Upload file" onUploaded={() => setSaved((s) => (s ? { ...s, photo: true } : s))} />
            {saved.photo && <span className="cq-photo">Photo attached</span>}
          </div>
        </div>
      </Modal>
    )
  }

  const orderChoices = orders
  return (
    <Modal
      size="lg"
      title={cheque ? `Cheque ${cheque.cheque_no}` : 'New cheque'}
      description={cheque ? 'Edit the cheque details' : 'Record a cheque collected from a buyer'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || missing.length > 0} onClick={() => void save()}>
            {busy ? 'Saving…' : cheque ? 'Save changes' : 'Save cheque'}
          </button>
        </>
      }
    >
      {err && (
        <div className="alert" role="alert">
          {err}
        </div>
      )}
      <p className="muted small">Fields marked * are required.</p>
      <div className="form-grid">
        <Field id="chq-no" label="Cheque number" required>
          <input id="chq-no" className="mono" value={form.cheque_no} onChange={(e) => set('cheque_no', e.target.value)} autoFocus />
        </Field>
        <Field id="chq-invoice" label="Invoice number">
          <input id="chq-invoice" className="mono" value={form.invoice_no} onChange={(e) => set('invoice_no', e.target.value)} />
        </Field>
        <Field id="chq-bank" label="Bank">
          <input id="chq-bank" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} />
        </Field>
        <Field id="chq-date" label="Cheque date">
          <input id="chq-date" type="date" value={form.cheque_date} onChange={(e) => set('cheque_date', e.target.value)} />
        </Field>
        <Field id="chq-amount" label="Amount" required>
          <input
            id="chq-amount"
            inputMode="decimal"
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
          />
        </Field>
        <Field id="chq-buyer" label="Buyer">
          <select id="chq-buyer" value={form.buyer_id} onChange={(e) => set('buyer_id', e.target.value)}>
            <option value="">—</option>
            {buyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
                {b.inactive ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field id="chq-order" label="Order">
          <select id="chq-order" value={form.order_id} onChange={(e) => set('order_id', e.target.value)}>
            <option value="">—</option>
            {orderChoices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="chq-collected-on" label="Collection date">
          <input
            id="chq-collected-on"
            type="date"
            max={today}
            value={form.collection_date}
            onChange={(e) => set('collection_date', e.target.value)}
          />
        </Field>
        <Field id="chq-by" label="Collected by" hint={canManage ? undefined : 'Cheques you record are collected by you.'}>
          <select
            id="chq-by"
            value={form.collected_by}
            onChange={(e) => set('collected_by', e.target.value)}
            disabled={!canManage}
          >
            <option value="">—</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id="chq-notes" label="Notes">
        <textarea id="chq-notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      {missing.length > 0 && <p className="field-hint">Still needed: {missing.join(', ')}.</p>}
      {cheque?.task_id && (
        <div className="td-followup">
          <h3>Photo of the cheque</h3>
          <p>{cheque.photo_path ? 'A photo is already attached. Add another if needed.' : 'No photo yet. A photo marks the cheque as collected.'}</p>
          <div className="td-row">
            <ProofUpload taskId={cheque.task_id} camera withLocation label="Take photo" onUploaded={() => undefined} />
            <ProofUpload taskId={cheque.task_id} label="Upload file" onUploaded={() => undefined} />
          </div>
        </div>
      )}
    </Modal>
  )
}
