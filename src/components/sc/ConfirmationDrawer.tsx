import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SC_UOMS } from '../../api/types'
import type { CountRow, PaymentTerm } from '../../api/types'
import { Drawer, DeleteControl } from '../Drawer'
import { Field } from '../PartyForms'
import { errMessage, numOrNull } from '../../lib/party'
import { formatDateTime } from '../../lib/format'
import { CancelControl, NotificationLog } from './NotificationLog'
import { SendPanel } from './SendPanel'
import type { Company, Names, Party, ScRow } from './scShared'

type Form = {
  supplier_id: string
  supplier_company_id: string
  buyer_id: string
  buyer_company_id: string
  count_id: string
  uom: string
  quantity: string
  net_quantity: string
  freight: 'included' | 'excluded'
  bag_weight: string
  rate: string
  payment_term_id: string
  remarks: string
  price_basis: '' | 'ex_mill' | 'net'
  delivery_schedule: string
  special_instructions: string
}

function toForm(sc: ScRow | null): Form {
  return {
    supplier_id: sc?.supplier_id ?? '',
    supplier_company_id: sc?.supplier_company_id ?? '',
    buyer_id: sc?.buyer_id ?? '',
    buyer_company_id: sc?.buyer_company_id ?? '',
    count_id: sc?.count_id ?? '',
    uom: sc?.uom ?? 'KG',
    quantity: sc?.quantity != null ? String(sc.quantity) : '',
    net_quantity: sc?.net_quantity != null ? String(sc.net_quantity) : '',
    freight: sc?.freight ?? 'excluded',
    bag_weight: sc?.bag_weight != null ? String(sc.bag_weight) : '',
    rate: sc?.rate != null ? String(sc.rate) : '',
    payment_term_id: sc?.payment_term_id ?? '',
    remarks: sc?.remarks ?? '',
    price_basis: sc?.price_basis ?? '',
    delivery_schedule: sc?.delivery_schedule ?? '',
    special_instructions: sc?.special_instructions ?? '',
  }
}

export function ConfirmationDrawer({
  sc, canManage, suppliers, buyers, companies, counts, terms, onClose, onDone,
}: {
  sc: ScRow | null
  canManage: boolean
  suppliers: Party[]
  buyers: Party[]
  companies: Company[]
  counts: CountRow[]
  terms: PaymentTerm[]
  onClose: () => void
  onDone: (message: string, keepOpenId?: string) => void | Promise<void>
}) {
  const [f, setF] = useState<Form>(toForm(sc))
  const [dealNo, setDealNo] = useState<string | null>(null)
  useEffect(() => {
    if (!sc?.deal_id) return
    void supabase.from('crm_deals').select('deal_no').eq('id', sc.deal_id).maybeSingle().then(({ data }) => setDealNo((data as { deal_no: string } | null)?.deal_no ?? null))
  }, [sc?.deal_id])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  const qty = numOrNull(f.quantity)
  const net = numOrNull(f.net_quantity)
  const bag = numOrNull(f.bag_weight)
  const rate = numOrNull(f.rate)

  const problems: string[] = []
  if (!f.supplier_id) problems.push('Supplier')
  if (!f.supplier_company_id) problems.push('Supplier company')
  if (!f.buyer_id) problems.push('Buyer')
  if (!f.buyer_company_id) problems.push('Buyer company')
  if (!f.count_id) problems.push('Count')
  if (qty === null || qty <= 0) problems.push('Ex-mill quantity (above zero)')
  if (f.net_quantity && (net === null || net <= 0)) problems.push('Net quantity (above zero)')
  if (f.uom === 'BAGS' && (bag === null || bag <= 0)) problems.push('Bag weight (needed for BAGS)')
  if (f.bag_weight && (bag === null || bag <= 0)) problems.push('Bag weight (a number above zero)')
  if (f.rate && (rate === null || rate < 0)) problems.push('Rate (a number)')
  const locked = !!sc?.deal_id
  if (locked && !f.price_basis) problems.push('Ex-mill / Net')

  /** Picking a contact fills in its company; it can still be changed. */
  function pickParty(side: 'supplier' | 'buyer', id: string) {
    const list = side === 'supplier' ? suppliers : buyers
    const company = list.find((x) => x.id === id)?.company_id ?? ''
    setF((p) => ({ ...p, [`${side}_id`]: id, [`${side}_company_id`]: company || p[`${side}_company_id` as const] }) as Form)
  }

  async function save() {
    setBusy(true)
    setErr(null)
    const editable = {
      net_quantity: net ?? qty,
      freight: f.freight,
      price_basis: f.price_basis || null,
      bag_weight: bag,
      delivery_schedule: f.delivery_schedule.trim() || null,
      special_instructions: f.special_instructions.trim() || null,
      remarks: f.remarks.trim() || null,
    }
    const payload = locked ? editable : {
      ...editable,
      supplier_id: f.supplier_id || null,
      supplier_company_id: f.supplier_company_id || null,
      buyer_id: f.buyer_id || null,
      buyer_company_id: f.buyer_company_id || null,
      count_id: f.count_id || null,
      uom: f.uom,
      quantity: qty,
      rate,
      payment_term_id: f.payment_term_id || null,
    }
    const { data, error } = sc
      ? await supabase.from('sales_confirmations').update(payload).eq('id', sc.id).select('id, sc_no, status')
      : await supabase.from('sales_confirmations').insert(payload).select('id, sc_no, status')
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this confirmation'))
    const row = data?.[0] as { id: string; sc_no: string; status: string } | undefined
    if (!row) return setErr('Your account cannot change this confirmation.')
    const ready = row.status === 'confirmed'
    await onDone(
      `${row.sc_no} ${sc ? 'updated' : 'created'}.${ready ? ' Use "SMS Supplier" and "SMS Buyer" to send it.' : ' It is still a draft: fill in every required field to send it.'}`,
      ready ? row.id : undefined,
    )
  }

  async function cancelSc() {
    if (!sc) return
    setBusy(true)
    const { error } = await supabase.rpc('cancel_sales_confirmation', { p_sc: sc.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not cancel this confirmation'))
    await onDone(`${sc.sc_no} cancelled.`)
  }

  async function remove() {
    if (!sc) return
    setBusy(true)
    const { data, error } = await supabase.from('sales_confirmations').delete().eq('id', sc.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Only drafts can be deleted.')
    await onDone(`${sc.sc_no} deleted.`)
  }

  const names: Names = {
    supplier: suppliers.find((x) => x.id === f.supplier_id)?.name ?? '',
    buyer: buyers.find((x) => x.id === f.buyer_id)?.name ?? '',
    supplierCompany: companies.find((x) => x.id === f.supplier_company_id)?.name ?? '',
    buyerCompany: companies.find((x) => x.id === f.buyer_company_id)?.name ?? '',
    count: counts.find((x) => x.id === f.count_id)?.display_name ?? '',
    term: terms.find((x) => x.id === f.payment_term_id)?.name ?? '',
  }
  const saved = sc !== null && sc.status === 'confirmed' && problems.length === 0

  const partyOptions = (list: Party[], current: string) =>
    list.filter((x) => x.is_active || x.id === current).map((x) => (
      <option key={x.id} value={x.id}>{x.name}</option>
    ))
  const companyOptions = (current: string) =>
    companies.filter((c) => c.is_active || c.id === current).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)

  return (
    <Drawer title={sc ? `${sc.sc_no} · ${sc.status === 'confirmed' ? 'Confirmed' : sc.status === 'cancelled' ? 'Cancelled' : 'Draft'}` : 'New sales confirmation'} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      {!canManage && <div className="notice small">You can view this confirmation; changing or sending it needs the “Create, edit and send sales confirmations” permission.</div>}

      <p className="muted small">
        Date and time:{' '}
        <strong>{sc ? formatDateTime(sc.confirmed_at) : 'recorded automatically when you save'}</strong>
        {' '}· not editable.
      </p>

      {locked && (
        <div className="notice small">
          Created from a deal: the commercial terms below are locked. You can change freight, ex-mill / net, bag weight, delivery schedule and special instructions.
        </div>
      )}
      <fieldset disabled={!canManage || locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {locked && (
          <>
            <h3 className="section-title">Internal company and commission</h3>
            <div className="form-grid">
              <Field id="sc-co" label="Internal company"><input id="sc-co" value={companies.find((c) => c.id === sc?.company_id)?.name ?? '—'} readOnly /></Field>
              <Field id="sc-deal" label="Deal reference"><input id="sc-deal" value={dealNo ?? '—'} readOnly /></Field>
              <Field id="sc-br" label="Buyer rate"><input id="sc-br" className="mono" value={sc?.buyer_rate ?? ''} readOnly /></Field>
              <Field id="sc-sr" label="Supplier rate"><input id="sc-sr" className="mono" value={sc?.supplier_rate ?? ''} readOnly /></Field>
              <Field id="sc-cs" label="Commission structure"><input id="sc-cs" value={sc?.commission_type ? `${sc.commission_type}${sc.commission_value !== null ? ` · ${sc.commission_value}` : ''}` : '—'} readOnly /></Field>
            </div>
          </>
        )}

        <h3 className="section-title">A · Supplier</h3>
        <div className="form-grid">
          <Field id="sc-supplier" label="Supplier" required>
            <select id="sc-supplier" value={f.supplier_id} onChange={(e) => pickParty('supplier', e.target.value)}>
              <option value="">Choose…</option>
              {partyOptions(suppliers, f.supplier_id)}
            </select>
          </Field>
          <Field id="sc-supplier-co" label="Supplier company" required hint="Filled from the supplier's Company; change it if needed.">
            <select id="sc-supplier-co" value={f.supplier_company_id} onChange={(e) => set('supplier_company_id', e.target.value)}>
              <option value="">Choose…</option>
              {companyOptions(f.supplier_company_id)}
            </select>
          </Field>
        </div>

        <h3 className="section-title">B · Buyer</h3>
        <div className="form-grid">
          <Field id="sc-buyer" label="Buyer" required>
            <select id="sc-buyer" value={f.buyer_id} onChange={(e) => pickParty('buyer', e.target.value)}>
              <option value="">Choose…</option>
              {partyOptions(buyers, f.buyer_id)}
            </select>
          </Field>
          <Field id="sc-buyer-co" label="Buyer company" required hint="Filled from the buyer's Company; change it if needed.">
            <select id="sc-buyer-co" value={f.buyer_company_id} onChange={(e) => set('buyer_company_id', e.target.value)}>
              <option value="">Choose…</option>
              {companyOptions(f.buyer_company_id)}
            </select>
          </Field>
        </div>

        <h3 className="section-title">C · Goods, rate and terms</h3>
        <div className="form-grid">
          <Field id="sc-count" label="Count" required>
            <select id="sc-count" value={f.count_id} onChange={(e) => set('count_id', e.target.value)}>
              <option value="">Choose…</option>
              {counts.filter((c) => c.is_active || c.id === f.count_id).map((c) => (
                <option key={c.id} value={c.id}>{c.display_name}</option>
              ))}
            </select>
          </Field>
          <Field id="sc-uom" label="UOM" required>
            <select id="sc-uom" value={f.uom} onChange={(e) => set('uom', e.target.value)}>
              {SC_UOMS.map((u) => (<option key={u} value={u}>{u}</option>))}
            </select>
          </Field>
          <Field id="sc-qty" label="Ex-mill quantity" required>
            <input id="sc-qty" inputMode="decimal" className="mono" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </Field>
          <Field id="sc-rate" label={`Rate (per ${f.uom})`}>
            <input id="sc-rate" inputMode="decimal" className="mono" value={f.rate} onChange={(e) => set('rate', e.target.value)} />
          </Field>
          <Field id="sc-term" label="Payment terms">
            <select id="sc-term" value={f.payment_term_id} onChange={(e) => set('payment_term_id', e.target.value)}>
              <option value="">—</option>
              {terms.filter((t) => t.is_active || t.id === f.payment_term_id).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
          </Field>
        </div>
      </fieldset>

      <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <h3 className="section-title">Editable terms</h3>
        <div className="form-grid">
          <Field id="sc-freight" label="Freight" required>
            <select id="sc-freight" value={f.freight} onChange={(e) => set('freight', e.target.value as Form['freight'])}>
              <option value="excluded">Excluded</option>
              <option value="included">Included</option>
            </select>
          </Field>
          <Field id="sc-basis" label="Ex-mill / Net" required={locked}>
            <select id="sc-basis" value={f.price_basis} onChange={(e) => set('price_basis', e.target.value as Form['price_basis'])}>
              <option value="">Choose…</option>
              <option value="ex_mill">Ex-mill</option>
              <option value="net">Net</option>
            </select>
          </Field>
          <Field id="sc-bag" label="Bag weight (kg)" required={f.uom === 'BAGS'} hint="For example 60 or 45.36. Shown on the confirmation.">
            <input id="sc-bag" inputMode="decimal" className="mono" value={f.bag_weight} onChange={(e) => set('bag_weight', e.target.value)} />
          </Field>
          <Field id="sc-net" label="Net quantity" hint="Leave blank to use the ex-mill quantity.">
            <input id="sc-net" inputMode="decimal" className="mono" value={f.net_quantity} onChange={(e) => set('net_quantity', e.target.value)} />
          </Field>
          <Field id="sc-sched" label="Delivery schedule">
            <input id="sc-sched" value={f.delivery_schedule} onChange={(e) => set('delivery_schedule', e.target.value)} />
          </Field>
        </div>
        <Field id="sc-instr" label="Special instructions">
          <textarea id="sc-instr" rows={2} value={f.special_instructions} onChange={(e) => set('special_instructions', e.target.value)} />
        </Field>
        <Field id="sc-remarks" label="Remarks">
          <textarea id="sc-remarks" rows={2} value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </Field>
      </fieldset>

      {problems.length > 0 && <p className="field-hint">Still needed to confirm: {problems.join(', ')}.</p>}

      {canManage && (
        <div className="drawer-actions">
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : sc ? 'Save changes' : 'Create confirmation'}
          </button>
          {sc && sc.status === 'draft' && <DeleteControl label="Delete draft" name={sc.sc_no} busy={busy} onConfirm={() => void remove()} />}
          {sc && sc.status !== 'draft' && sc.status !== 'cancelled' && <CancelControl busy={busy} onConfirm={() => void cancelSc()} />}
        </div>
      )}

      {saved && canManage && sc && (
        <SendPanel sc={sc} names={names} supplier={suppliers.find((x) => x.id === sc.supplier_id) ?? null} buyer={buyers.find((x) => x.id === sc.buyer_id) ?? null} onSent={(text) => onDone(text, sc.id)} />
      )}
      {sc && <NotificationLog sc={sc} canManage={canManage} />}
    </Drawer>
  )
}