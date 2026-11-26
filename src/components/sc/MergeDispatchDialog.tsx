/** Merge to Dispatch: one dispatch (one truck, one mill invoice) recorded across the Dispatch and Billing items of
 *  several Sales Confirmations that have the same buyer and the same supplier. Each item gets its own dispatch entry
 *  (Partially or Fully Dispatch by quantity), all sharing one merge number; the database checks every rule. */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../Modal'
import { errMessage } from '../../lib/party'
import { inr, uomLabel, TRANSPORT_TYPES } from '../../lib/deals'
import type { ScRow } from './scShared'

type Item = {
  id: string; order_no: string; sales_confirmation_id: string; count_id: string | null; quantity: number; uom: string
  dispatched_qty: number; cancelled_qty: number; returned_qty: number; status: string; vehicle_no: string | null; transport_type: string | null
}
const leftOf = (x: Item) => (x.returned_qty > 0 ? 0 : Math.max(x.quantity - x.dispatched_qty - x.cancelled_qty, 0))
const toNum = (v: string) => { const n = Number(v.replace(/,/g, '')); return v.trim() === '' || !Number.isFinite(n) ? NaN : n }

export function MergeDispatchDialog({ scs, countName, buyer, supplier, onClose, onDone }: {
  scs: ScRow[]
  countName: Map<string, string>
  buyer: string
  supplier: string
  onClose: () => void
  onDone: (text: string) => void | Promise<void>
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [items, setItems] = useState<Item[] | null>(null)
  const [pick, setPick] = useState<Map<string, string>>(new Map())
  const [date, setDate] = useState(today)
  const [invNo, setInvNo] = useState('')
  const [invDate, setInvDate] = useState(today)
  const [vehicle, setVehicle] = useState(scs.find((x) => x.vehicle_no)?.vehicle_no ?? '')
  const [lr, setLr] = useState('')
  const [tt, setTt] = useState('')
  const [dc, setDc] = useState('')
  const [delDate, setDelDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const scNo = useMemo(() => new Map(scs.map((x) => [x.id, x.sc_no])), [scs])

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from('orders')
        .select('id,order_no,sales_confirmation_id,count_id,quantity,uom,dispatched_qty,cancelled_qty,returned_qty,status,vehicle_no,transport_type')
        .in('sales_confirmation_id', scs.map((x) => x.id)).neq('status', 'cancelled').order('order_no')
      if (error) { setErr(errMessage(error, 'Could not load the items')); setItems([]); return }
      const list = (data ?? []) as Item[]
      // every item with something left starts ticked, with all that is left
      setPick(new Map(list.filter((x) => leftOf(x) > 0).map((x) => [x.id, String(leftOf(x))])))
      setTt(list.find((x) => x.transport_type)?.transport_type ?? '')
      setItems(list)
    })()
  }, [scs])

  const chosen = (items ?? []).filter((x) => pick.has(x.id))
  const problems = chosen.map((x) => {
    const q = toNum(pick.get(x.id) ?? '')
    return !Number.isFinite(q) || q <= 0 ? `${x.order_no}: enter a quantity above 0` : q > leftOf(x) ? `${x.order_no}: only ${inr(leftOf(x))} ${uomLabel(x.uom)} left` : null
  }).filter(Boolean) as string[]
  const noItems = items !== null && items.every((x) => leftOf(x) === 0)

  function toggle(x: Item) {
    setPick((m) => { const n = new Map(m); if (n.has(x.id)) n.delete(x.id); else n.set(x.id, String(leftOf(x))); return n })
  }

  async function save() {
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('merge_dispatch', {
      p_lines: chosen.map((x) => ({ order_id: x.id, quantity: toNum(pick.get(x.id) ?? '') })),
      p_details: { dispatch_date: date, invoice_no: invNo, invoice_date: invDate, vehicle_no: vehicle, lr_no: lr, transport_type: tt, dc_no: dc, delivery_date: delDate, remarks },
    })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not merge the dispatch'))
    await onDone(`Merged dispatch ${String(data)} saved: ${chosen.length} item${chosen.length === 1 ? '' : 's'} (${chosen.map((x) => x.order_no).join(', ')}).`)
  }

  return (
    <Modal
      title="Merge to Dispatch"
      description={`One dispatch for ${scs.length} confirmations of ${buyer} from ${supplier}. Each item gets its own dispatch entry under one merge number.`}
      size="lg"
      portal
      onClose={onClose}
      footer={(
        <>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || items === null || chosen.length === 0 || problems.length > 0}
            title={chosen.length === 0 ? 'Tick at least one item.' : problems[0]}>
            {busy ? 'Saving…' : `Dispatch ${chosen.length} item${chosen.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    >
      {err && <div className="alert" role="alert">{err}</div>}
      {items === null ? <p className="muted">Loading items…</p> : (
        <>
          {noItems && <div className="alert">Nothing is left to dispatch on these confirmations.</div>}
          <div className="table-wrap lines-wrap">
            <table className="lines-table merge-table">
              <thead>
                <tr><th aria-label="Include" /><th>Item</th><th>Confirmation</th><th>Count</th><th className="right">Left</th><th className="right">Dispatch now</th></tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const left = leftOf(x)
                  const on = pick.has(x.id)
                  return (
                    <tr key={x.id} className={left === 0 ? 'muted' : undefined}>
                      <td><input type="checkbox" aria-label={`Include ${x.order_no}`} checked={on} disabled={left === 0 || busy} onChange={() => toggle(x)} /></td>
                      <td className="mono">{x.order_no}</td>
                      <td className="mono">{scNo.get(x.sales_confirmation_id) ?? '—'}</td>
                      <td>{x.count_id ? countName.get(x.count_id) ?? '—' : '—'}</td>
                      <td className="right mono">{left === 0 ? 'Nothing left' : `${inr(left)} ${uomLabel(x.uom)}`}</td>
                      <td className="right">
                        {on && (
                          <input className="mono num-in" inputMode="decimal" aria-label={`Quantity for ${x.order_no}`} value={pick.get(x.id) ?? ''} disabled={busy}
                            onChange={(e) => { const v = e.target.value; setPick((m) => new Map(m).set(x.id, v)) }} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {problems.length > 0 && <div className="alert" role="alert">{problems.join("; ")}</div>}

          <h4 className="merge-sub">Shared dispatch details</h4>
          <div className="form-grid">
            <label className="field"><span>Dispatch Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="field"><span>Invoice No.</span><input value={invNo} onChange={(e) => setInvNo(e.target.value)} /><small className="muted">The mill's invoice; fills each item's Mill Invoice task.</small></label>
            <label className="field"><span>Invoice Date</span><input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></label>
            <label className="field"><span>Vehicle Number</span><input value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} /></label>
            <label className="field"><span>LR No.</span><input value={lr} onChange={(e) => setLr(e.target.value)} /></label>
            <label className="field"><span>Transport Type</span>
              <select value={tt} onChange={(e) => setTt(e.target.value)}>
                <option value="">—</option>
                {TRANSPORT_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </label>
          </div>
          <details className="more-details">
            <summary>More details (optional)</summary>
            <div className="form-grid">
              <label className="field"><span>DC No.</span><input value={dc} onChange={(e) => setDc(e.target.value)} /></label>
              <label className="field"><span>Del Date</span><input type="date" value={delDate} onChange={(e) => setDelDate(e.target.value)} /></label>
              <label className="field"><span>Remarks</span><input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
            </div>
          </details>
        </>
      )}
    </Modal>
  )
}
