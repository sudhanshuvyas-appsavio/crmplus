/** "Dispatch & Billing Creation Form" tab. Dispatch and Billing items are made from a
 *  Sales Confirmation (one item per count), so this form is: pick a confirmation that
 *  still has counts without an item, see what it will create, and create the items. */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Field } from './PartyForms'
import { errMessage } from '../lib/party'
import { formatDateTime } from '../lib/format'
import { inr, uomLabel } from '../lib/deals'

type Sc = { id: string; sc_no: string; confirmed_at: string; buyer_id: string | null; supplier_id: string | null; status: string }
type Line = { id: string; sc_id: string; line_no: number; count_id: string; quantity: number; uom: string; rate: number | null }

export function DnbCreationForm({ canCreate, buyerName, supplierName, countName, onCreated }: {
  canCreate: boolean
  buyerName: Map<string, string>
  supplierName: Map<string, string>
  countName: Map<string, string>
  /** Called with the first new item's id. */
  onCreated: (orderId: string, text: string) => void | Promise<void>
}) {
  const [scs, setScs] = useState<Sc[] | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [withItem, setWithItem] = useState<Set<string>>(new Set())
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [s, l, o] = await Promise.all([
        supabase.from('sales_confirmations').select('id,sc_no,confirmed_at,buyer_id,supplier_id,status').eq('status', 'confirmed').order('confirmed_at', { ascending: false }),
        supabase.from('sc_lines').select('id,sc_id,line_no,count_id,quantity,uom,rate').order('line_no'),
        supabase.from('orders').select('sc_line_id').neq('status', 'cancelled').not('sc_line_id', 'is', null),
      ])
      if (!alive) return
      if (s.error) setErr(errMessage(s.error, 'Could not load the Sales Confirmations'))
      setScs((s.data ?? []) as Sc[])
      setLines((l.data ?? []) as Line[])
      setWithItem(new Set(((o.data ?? []) as { sc_line_id: string }[]).map((x) => x.sc_line_id)))
    })()
    return () => { alive = false }
  }, [])

  // confirmations that still have at least one count without a live item
  const open = (scs ?? []).filter((s) => lines.some((l) => l.sc_id === s.id && !withItem.has(l.id)))
  const chosen = open.find((s) => s.id === pick) ?? null
  const rows = chosen ? lines.filter((l) => l.sc_id === chosen.id) : []
  const todo = rows.filter((l) => !withItem.has(l.id))
  const missingRate = todo.some((l) => l.rate === null)

  async function create() {
    if (!chosen) return
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.rpc('create_dispatch_bill', { p_sc: chosen.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not create the Dispatch and Billing items'))
    await onCreated(data as string, `${chosen.sc_no}: ${todo.length} Dispatch and Billing item${todo.length === 1 ? '' : 's'} created.`)
  }

  if (!canCreate) return <div className="notice">Creating Dispatch and Billing items needs the “Create and manage orders” permission.</div>
  if (!scs) return <p className="muted small">Loading…</p>

  return (
    <section className="inline-form" aria-label="Dispatch & Billing Creation Form">
      <header className="inline-form-head"><h2>Dispatch &amp; Billing Creation Form</h2></header>
      <div className="inline-form-body">
        {err && <div className="alert">{err}</div>}
        <p className="small muted">An item is made from a complete Sales Confirmation: one item per count, with the parties, rate, commission and delivery details copied over.</p>
        {open.length === 0 ? (
          <p className="notice small">Every complete Sales Confirmation already has its Dispatch and Billing items.</p>
        ) : (
          <>
            <Field id="dnb-sc" label="Sales Confirmation" required>
              <select id="dnb-sc" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose…</option>
                {open.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sc_no} · {buyerName.get(s.buyer_id ?? '') ?? '—'} · {formatDateTime(s.confirmed_at)}
                  </option>
                ))}
              </select>
            </Field>
            {chosen && (
              <>
                <dl className="kv">
                  <dt>Buyer</dt><dd><strong>{buyerName.get(chosen.buyer_id ?? '') ?? '—'}</strong></dd>
                  <dt>Supplier</dt><dd>{supplierName.get(chosen.supplier_id ?? '') ?? '—'}</dd>
                </dl>
                <div className="table-wrap lines-wrap">
                  <table className="lines-table">
                    <thead><tr><th>#</th><th>Count</th><th className="right">Quantity</th><th className="right">Final Rate (₹/kg)</th><th>Dispatch and Billing</th></tr></thead>
                    <tbody>
                      {rows.map((l) => (
                        <tr key={l.id}>
                          <td className="muted small">{l.line_no}</td>
                          <td className="small">{countName.get(l.count_id) ?? '—'}</td>
                          <td className="right mono small">{inr(l.quantity)} {uomLabel(l.uom)}</td>
                          <td className="right mono small">{inr(l.rate)}</td>
                          <td className="small">{withItem.has(l.id) ? <span className="muted">has an item</span> : <strong>will be created</strong>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {missingRate && <p className="field-hint">Every count needs a rate before its item can be created.</p>}
                <div className="drawer-actions">
                  <button className="btn primary" type="button" disabled={busy || missingRate || todo.length === 0} onClick={() => void create()}>
                    {busy ? 'Creating…' : `Create ${todo.length} item${todo.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}
