/** The form behind a status choice on a Dispatch and Billing item: Partially Dispatch, Cancel or Return each add an entry
 *  (a sub-item), with the move monday makes for it. Used from the board and from the item's details. */

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Order } from '../api/types'
import { Modal } from './Modal'
import { errMessage } from '../lib/party'
import { inr, uomLabel, TRANSPORT_TYPES } from '../lib/deals'

export type SubKind = 'partial' | 'full' | 'cancel' | 'return'
export const SUB_LABEL = { partial: 'Partially Dispatch', full: 'Fully Dispatch', cancel: 'Cancel', return: 'Return' } as const
const num = (v: string) => { const n = Number(v.replace(/,/g, '')); return v.trim() === '' || !Number.isFinite(n) ? null : n }


/** Adds the sub-item behind a status choice, with the automation monday runs for it:
 *  Draft -> Partially Dispatch starts the item (In Progress); Cancel and Return finish it (Fully Dispatch). */
export function SubitemDialog({ order, kind, onClose, onDone }: { order: Order; kind: SubKind; onClose: () => void; onDone: (text: string) => void | Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10)
  const left = order.returned_qty > 0 ? 0 : Math.max(order.quantity - order.dispatched_qty - order.cancelled_qty, 0)
  const returnableNow = Math.max(order.dispatched_qty - order.returned_qty, 0)
  const startQty = (k: SubKind) => (k === 'partial' ? '' : String(k === 'return' ? returnableNow : left))
  const [which, setWhich] = useState<SubKind>(kind)
  const isDispatch = which === 'partial' || which === 'full'
  const returnable = Math.max(order.dispatched_qty - order.returned_qty, 0)
  const limit = which === 'return' ? returnable : left
  const [qty, setQty] = useState(startQty(kind))
  const [date, setDate] = useState(today)
  const [invNo, setInvNo] = useState('')
  const [invDate, setInvDate] = useState(today)
  const [vehicle, setVehicle] = useState(order.vehicle_no ?? '')
  const [reason, setReason] = useState('')
  const [dc, setDc] = useState('')
  const [delDate, setDelDate] = useState('')
  const [tt, setTt] = useState(order.transport_type ?? '')
  const [lr, setLr] = useState('')
  const [cgst, setCgst] = useState(order.cgst_pct === null ? '' : String(order.cgst_pct))
  const [ins, setIns] = useState(order.insurance_pct === null ? '' : String(order.insurance_pct))
  const [addA, setAddA] = useState('')
  const [ded, setDed] = useState('')
  const [round, setRound] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const q = Number(qty.replace(/,/g, ''))
  const bad = !Number.isFinite(q) || q <= 0 || q > limit
  const started = order.status === 'open_for_execution'
  const label = SUB_LABEL[which]

  async function save() {
    setBusy(true)
    setErr(null)
    if (!started) {
      if (!isDispatch) { setBusy(false); return setErr('Start dispatch with a Partially Dispatch entry first.') }
      const { data, error } = await supabase.from('orders').update({ status: 'open_for_execution' }).eq('id', order.id).select('id')
      if (error || !data || data.length === 0) { setBusy(false); return setErr(error ? errMessage(error, 'Could not start dispatch') : 'Your account cannot change this item.') }
    }
    const row: Record<string, unknown> = isDispatch
      ? { order_id: order.id, quantity: q, dispatch_date: date, invoice_no: invNo.trim() || null, invoice_date: invNo.trim() ? invDate : null, vehicle_no: vehicle.trim() || null,
          dc_no: dc.trim() || null, delivery_date: delDate || null, transport_type: tt || null, lr_no: lr.trim() || null,
          cgst_pct: num(cgst), insurance_pct: num(ins), add_amount: num(addA), deduct_amount: num(ded), round_off: num(round), person_id: order.person_id }
      : { order_id: order.id, kind: which, quantity: q, entry_date: date, invoice_no: invNo.trim() || null, invoice_date: invNo.trim() ? invDate : null, reason: reason.trim() || null }
    const { error } = await supabase.from(isDispatch ? 'order_dispatches' : 'order_dispatch_adjustments').insert(row)
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not add the entry'))
    await onDone(`${order.order_no}: ${label} entry added.`)
  }

  return (
    <Modal
      title={`${order.order_no} · ${label}`}
      description={isDispatch ? (which === 'full' ? 'Sends everything that is left in one entry. The item becomes Fully Dispatch.' : 'Adds a dispatch entry. The item moves to In Progress.') : 'Adds an entry and makes the item Fully Dispatch.'}
      size="md"
      portal
      onClose={onClose}
      footer={(
        <>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || bad}>{busy ? 'Adding…' : `Add ${label} entry`}</button>
        </>
      )}
    >
      {err && <div className="alert" role="alert">{err}</div>}
      <div className="form-grid">
        <label className="field"><span>Status</span>
          <select value={which} onChange={(e) => { const w = e.target.value as SubKind; setWhich(w); setQty(startQty(w)) }}>
            {(left > 0 || kind === 'partial') && <option value="partial">Partially Dispatch</option>}
            {left > 0 && <option value="full">Fully Dispatch</option>}
            {started && left > 0 && <option value="cancel">Cancel</option>}
            {started && returnable > 0 && <option value="return">Return</option>}
          </select>
        </label>
        <label className="field"><span>Quantity ({uomLabel(order.uom)}) *</span>
          <input className="mono" inputMode="decimal" value={qty} readOnly={which === 'full'} onChange={(e) => setQty(e.target.value)} autoFocus />
          <small className="muted">{which === 'full' ? `All that is left: ${inr(limit)} ${uomLabel(order.uom)}.` : `Up to ${inr(limit)} ${uomLabel(order.uom)}.`}</small>
        </label>
        <label className="field"><span>{isDispatch ? 'Dispatch Date' : 'Date'}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>Invoice No.</span><input value={invNo} onChange={(e) => setInvNo(e.target.value)} /></label>
        <label className="field"><span>Invoice Date</span><input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></label>
        {isDispatch
          ? <label className="field"><span>Vehicle Number</span><input value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} /></label>
          : <label className="field"><span>Reason</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
      </div>
      {isDispatch && (
        <details className="more-details">
          <summary>More details (optional)</summary>
          <div className="form-grid">
            <label className="field"><span>DC No.</span><input value={dc} onChange={(e) => setDc(e.target.value)} /></label>
            <label className="field"><span>Del Date</span><input type="date" value={delDate} onChange={(e) => setDelDate(e.target.value)} /></label>
            <label className="field"><span>Transport Type</span>
              <select value={tt} onChange={(e) => setTt(e.target.value)}>
                <option value="">—</option>
                {TRANSPORT_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </label>
            <label className="field"><span>LR No.</span><input value={lr} onChange={(e) => setLr(e.target.value)} /></label>
            <label className="field"><span>CGST</span><input className="mono" inputMode="decimal" value={cgst} onChange={(e) => setCgst(e.target.value)} /></label>
            <label className="field"><span>Insurance Tax</span><input className="mono" inputMode="decimal" value={ins} onChange={(e) => setIns(e.target.value)} /></label>
            <label className="field"><span>Add</span><input className="mono" inputMode="decimal" value={addA} onChange={(e) => setAddA(e.target.value)} /></label>
            <label className="field"><span>Deduct</span><input className="mono" inputMode="decimal" value={ded} onChange={(e) => setDed(e.target.value)} /></label>
            <label className="field"><span>Round off</span><input className="mono" inputMode="decimal" value={round} onChange={(e) => setRound(e.target.value)} /></label>
          </div>
        </details>
      )}
    </Modal>
  )
}
