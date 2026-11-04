/** Deal register: Convert Lead to Deal (T-012) and Create Deal -- Draft (T-013).
 *
 *  A draft deal has three parts: the parties (buyer, optional supplier, our
 *  company, payment term), the product (a count from the Count Master) and the
 *  commercials (rates, price basis, freight, commission). Commission and
 *  margin are worked out by the database whenever the deal is saved; the
 *  preview in the drawer uses the same rules so what you see is what is
 *  stored. Only drafts exist so far -- later stories move a deal on from here. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { COMMISSION_TYPES, LEAD_UOMS } from '../api/types'
import type { CountRow, Deal, DealChange, PaymentTerm } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { ActivityPanel, useProfileNames } from '../components/PartyExtras'
import { bulkDelete, deleteSummary } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage, numOrNull } from '../lib/party'
import { formatDateTime } from '../lib/format'

type Party = { id: string; name: string; gst: string; is_active: boolean }
type Company = { id: string; name: string; is_home: boolean; is_active: boolean }

const CSV_COLUMNS = [
  'deal_no', 'status', 'buyer', 'supplier', 'count', 'quantity', 'uom', 'supplier_rate', 'buyer_rate',
  'price_basis', 'freight', 'commission_type', 'commission_value', 'commission_total', 'margin', 'margin_total', 'notes',
] as const

const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }))

/** Same rules as the database trigger (crm_deals_derive). */
export function commissionPerUnit(f: { type: string; uom: string; supplierRate: number | null; bagWeight: number | null }): number | null {
  const kg = f.uom === 'KG' ? 1 : f.uom === 'TONS' ? 1000 : f.uom === 'BAGS' ? f.bagWeight : null
  switch (f.type) {
    case 'pct_0_5': return f.supplierRate === null ? null : (f.supplierRate * 0.5) / 100
    case 'pct_1': return f.supplierRate === null ? null : f.supplierRate / 100
    case 'pct_2': return f.supplierRate === null ? null : (f.supplierRate * 2) / 100
    case 'per_kg_1': return kg
    case 'per_bag_30':
      if (f.uom === 'BAGS') return 30
      if (!f.bagWeight) return null
      if (f.uom === 'KG') return 30 / f.bagWeight
      if (f.uom === 'TONS') return (30 * 1000) / f.bagWeight
      return null
    default: return null
  }
}

export default function Deals() {
  const { can, me } = useAuth()
  const canCreate = can('deal.create')
  const canEdit = can('deal.edit') || canCreate
  const canApprove = can('deal.approve')
  const canOrder = can('order.manage')
  const [params, setParams] = useSearchParams()
  const [deals, setDeals] = useState<Deal[] | null>(null)
  const [buyers, setBuyers] = useState<Party[]>([])
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [editing, setEditing] = useState<Deal | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [d, b, s, c, t, co] = await Promise.all([
      supabase.from('crm_deals').select('*').order('created_at', { ascending: false }),
      supabase.from('buyer_master').select('id,name,gst,is_active').order('name'),
      supabase.from('supplier_master').select('id,name,gst,is_active').order('name'),
      supabase.from('count_master').select('*').order('count_no').order('display_name'),
      supabase.from('payment_terms').select('*').order('name'),
      supabase.from('companies').select('id,name,is_home,is_active').order('name'),
    ])
    if (d.error) setBanner({ kind: 'bad', text: errMessage(d.error, 'Could not load deals') })
    setDeals((d.data ?? []) as Deal[])
    setBuyers((b.data ?? []) as Party[])
    setSuppliers((s.data ?? []) as Party[])
    setCounts((c.data ?? []) as CountRow[])
    setTerms((t.data ?? []) as PaymentTerm[])
    setCompanies((co.data ?? []) as Company[])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  // /deals?open=<id> arrives from "Convert to deal" on a lead
  const openId = params.get('open')
  useEffect(() => {
    if (!openId || !deals) return
    const found = deals.find((x) => x.id === openId)
    if (found) setEditing(found)
    setParams({}, { replace: true })
  }, [openId, deals, setParams])

  const buyerName = useMemo(() => new Map(buyers.map((x) => [x.id, x.name])), [buyers])
  const supplierName = useMemo(() => new Map(suppliers.map((x) => [x.id, x.name])), [suppliers])
  const countName = useMemo(() => new Map(counts.map((x) => [x.id, x.display_name])), [counts])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (deals ?? []).filter(
      (x) =>
        (!statusFilter || x.status === statusFilter) &&
        (!q ||
        x.deal_no.toLowerCase().includes(q) ||
        (buyerName.get(x.buyer_id) ?? '').toLowerCase().includes(q) ||
        (x.supplier_id ? supplierName.get(x.supplier_id) ?? '' : '').toLowerCase().includes(q) ||
        (countName.get(x.count_id) ?? '').toLowerCase().includes(q)),
    )
  }, [deals, search, statusFilter, buyerName, supplierName, countName])

  const selection = useSelection(useMemo(() => shown.map((x) => x.id), [shown]))

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    const names = new Map((deals ?? []).map((x) => [x.id, x.deal_no]))
    const result = await bulkDelete('crm_deals', selection.chosen)
    setBanner(deleteSummary('deal', 'deals', result, (id) => names.get(id) ?? id))
    selection.clear()
    await load()
    setBusy(false)
  }

  function exportCSV() {
    const list = (selection.chosen.length > 0 ? shown.filter((x) => selection.isSelected(x.id)) : shown).map((x) => ({
      ...x,
      buyer: buyerName.get(x.buyer_id) ?? '',
      supplier: x.supplier_id ? supplierName.get(x.supplier_id) ?? '' : '',
      count: countName.get(x.count_id) ?? '',
    }))
    downloadCSV(`deals-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!deals) return <Loading label="Loading deals" />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Deal register</h1>
          <p className="page-sub">Draft deals, created by hand or by converting a Qualified lead.</p>
        </div>
        {canCreate && (
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
            New draft deal
          </button>
        )}
      </header>

      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      )}

      <ListTools
        plural="deals"
        canImport={false}
        canDelete={canCreate}
        selectedCount={selection.chosen.length}
        exportLabel={`Export ${selection.chosen.length > 0 ? `${selection.chosen.length} selected` : shown.length === deals.length ? 'all' : `${shown.length} shown`} as CSV`}
        exportDisabled={shown.length === 0}
        busy={busy}
        onImport={() => undefined}
        onExport={exportCSV}
        onDelete={deleteSelected}
      />
      <ImportIssues results={null} />

      <div className="field" style={{ maxWidth: 360 }}>
        <input aria-label="Search deals" placeholder="Search by deal no., buyer, supplier or count" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="rate_discussion">Rate Discussion</option>
          <option value="supplier_confirmed">Supplier Confirmed</option>
          <option value="buyer_confirmed">Buyer Confirmed</option>
          <option value="approved">Approved</option>
          <option value="confirmed">Confirmed</option>
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="card pad empty">{deals.length === 0 ? 'No deals yet. Convert a Qualified lead, or start a draft.' : 'No deal matches that search.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canCreate && (
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={selection.allSelected} onChange={selection.toggleAll} aria-label="Select all deals" />
                  </th>
                )}
                <th>Deal</th>
                <th>Buyer</th>
                <th>Supplier</th>
                <th>Count</th>
                <th className="right">Quantity</th>
                <th className="right">Supplier rate</th>
                <th className="right">Buyer rate</th>
                <th className="right">Commission</th>
                <th className="right">Margin</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.id} className="clickable" onClick={() => setEditing(x)}>
                  {canCreate && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selection.isSelected(x.id)} onChange={() => selection.toggle(x.id)} aria-label={`Select ${x.deal_no}`} />
                    </td>
                  )}
                  <td className="mono">{x.deal_no}</td>
                  <td>
                    <strong>{buyerName.get(x.buyer_id) ?? '—'}</strong>
                  </td>
                  <td className="small">{x.supplier_id ? supplierName.get(x.supplier_id) ?? '—' : <span className="muted">not set</span>}</td>
                  <td className="small">{countName.get(x.count_id) ?? '—'}</td>
                  <td className="right mono">
                    {x.quantity} {x.uom}
                  </td>
                  <td className="right mono">{money(x.supplier_rate)}</td>
                  <td className="right mono">{money(x.buyer_rate)}</td>
                  <td className="right mono">{money(x.commission_total)}</td>
                  <td className="right mono">{money(x.margin_total)}</td>
                  <td>
                    <span className={x.status === 'supplier_confirmed' || x.status === 'buyer_confirmed' || x.status === 'approved' || x.status === 'confirmed' ? 'chip good' : x.status === 'rate_discussion' ? 'chip' : 'chip warn'}>{statusLabel(x.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DealDrawer
          key={editing === 'new' ? 'new' : editing.id}
          deal={editing === 'new' ? null : editing}
          canEdit={canEdit}
          canDelete={canCreate}
          isAdmin={!!me?.is_admin}
          canApprove={canApprove}
          canOrder={canOrder}
          buyers={buyers}
          suppliers={suppliers}
          counts={counts}
          terms={terms}
          companies={companies}
          onClose={() => setEditing(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            await load()
          }}
        />
      )}
    </>
  )
}

type Form = {
  buyer_id: string
  supplier_id: string
  company_id: string
  payment_term_id: string
  count_id: string
  quantity: string
  uom: string
  bag_weight: string
  supplier_rate: string
  buyer_rate: string
  price_basis: 'ex_mill' | 'net'
  freight: 'included' | 'excluded'
  commission_type: string
  notes: string
}

function toForm(d: Deal | null, companies: Company[]): Form {
  const home = companies.find((c) => c.is_home && c.is_active)
  return {
    buyer_id: d?.buyer_id ?? '',
    supplier_id: d?.supplier_id ?? '',
    company_id: d?.company_id ?? home?.id ?? '',
    payment_term_id: d?.payment_term_id ?? '',
    count_id: d?.count_id ?? '',
    quantity: d ? String(d.quantity) : '',
    uom: d?.uom ?? 'KG',
    bag_weight: d?.bag_weight ? String(d.bag_weight) : '',
    supplier_rate: d?.supplier_rate != null ? String(d.supplier_rate) : '',
    buyer_rate: d?.buyer_rate != null ? String(d.buyer_rate) : '',
    price_basis: d?.price_basis ?? 'ex_mill',
    freight: d?.freight ?? 'excluded',
    commission_type: d?.commission_type ?? '',
    notes: d?.notes ?? '',
  }
}

function DealDrawer({
  deal, canEdit, canDelete, isAdmin, canApprove, canOrder, buyers, suppliers, counts, terms, companies, onClose, onDone,
}: {
  deal: Deal | null
  canEdit: boolean
  canDelete: boolean
  isAdmin: boolean
  canApprove: boolean
  canOrder: boolean
  buyers: Party[]
  suppliers: Party[]
  counts: CountRow[]
  terms: PaymentTerm[]
  companies: Company[]
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
}) {
  const [f, setF] = useState<Form>(toForm(deal, companies))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  const navigate = useNavigate()
  const [orderId, setOrderId] = useState<string | null>(null)
  const confirmedDeal = deal?.status === 'confirmed'
  const approved = deal?.status === 'approved' || confirmedDeal
  const [problemList, setProblemList] = useState<string[] | null>(null)
  const [sc, setSc] = useState<{ sc_no: string | null; confirmed_at: string } | null>(null)
  useEffect(() => {
    if (!deal) return
    let alive = true
    if (deal.status === 'approved') {
      void supabase.rpc('deal_confirm_problems', { p_deal: deal.id }).then(({ data }) => { if (alive) setProblemList((data ?? []) as string[]) })
    } else if (deal.sales_confirmation_id) {
      void supabase.from('orders').select('id').eq('deal_id', deal.id).maybeSingle().then(({ data }) => { if (alive) setOrderId(data?.id ?? null) })
      void supabase.from('sales_confirmations').select('sc_no, confirmed_at').eq('id', deal.sales_confirmation_id).maybeSingle().then(({ data }) => { if (alive) setSc(data) })
    }
    return () => { alive = false }
  }, [deal])
  const names = useProfileNames()
  const [validated, setValidated] = useState(false)
  const [apprCompany, setApprCompany] = useState(deal?.company_id ?? '')
  const locked = !!deal?.supplier_confirmed_at
  const bLocked = !!deal?.buyer_confirmed_at
  const qty = numOrNull(f.quantity)
  const sRate = numOrNull(f.supplier_rate)
  const bRate = numOrNull(f.buyer_rate)
  const bag = numOrNull(f.bag_weight)
  const count = counts.find((c) => c.id === f.count_id)
  const buyer = buyers.find((x) => x.id === f.buyer_id)
  const supplier = suppliers.find((x) => x.id === f.supplier_id)

  const problems: string[] = []
  if (!f.buyer_id) problems.push('Buyer')
  if (!f.count_id) problems.push('Count')
  if (qty === null || qty <= 0) problems.push('Quantity (above zero)')
  if (f.uom === 'BAGS' && (bag === null || bag <= 0)) problems.push('Bag weight (needed for BAGS)')
  if (f.supplier_rate && (sRate === null || sRate < 0)) problems.push('Supplier rate (a number)')
  if (f.buyer_rate && (bRate === null || bRate < 0)) problems.push('Buyer rate (a number)')

  const perUnit = commissionPerUnit({ type: f.commission_type, uom: f.uom, supplierRate: sRate, bagWeight: bag })
  const commTotal = perUnit !== null && qty !== null ? perUnit * qty : null
  const margin = perUnit !== null && sRate !== null && bRate !== null ? bRate - sRate - perUnit : null
  const marginTotal = margin !== null && qty !== null ? margin * qty : null

  async function save() {
    setBusy(true)
    setErr(null)
    const payload = {
      buyer_id: f.buyer_id,
      supplier_id: f.supplier_id || null,
      company_id: f.company_id || null,
      payment_term_id: f.payment_term_id || null,
      count_id: f.count_id,
      quantity: qty,
      uom: f.uom,
      bag_weight: f.uom === 'BAGS' ? bag : bag && bag > 0 ? bag : null,
      supplier_rate: sRate,
      buyer_rate: bRate,
      price_basis: f.price_basis,
      freight: f.freight,
      commission_type: f.commission_type || null,
      notes: f.notes.trim() || null,
    }
    const { data, error } = deal
      ? await supabase.from('crm_deals').update(payload).eq('id', deal.id).select('id')
      : await supabase.from('crm_deals').insert(payload).select('id')
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this deal'))
    if (!data || data.length === 0) return setErr('Your account cannot change this deal.')
    await onDone(deal ? `${deal.deal_no} updated.` : 'Draft deal created.')
  }

  async function startDiscussion() {
    if (!deal) return
    setBusy(true)
    const { data, error } = await supabase.from('crm_deals').update({ status: 'rate_discussion' }).eq('id', deal.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Your account cannot change this deal.')
    await onDone(`${deal.deal_no} is now in Rate Discussion.`)
  }

  async function setStatus(status: string, msg: string) {
    if (!deal) return
    setBusy(true)
    const { data, error } = await supabase.from('crm_deals').update({ status }).eq('id', deal.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Your account cannot change this deal.')
    await onDone(`${deal.deal_no} ${msg}`)
  }

  async function confirmDeal() {
    if (!deal) return
    setBusy(true)
    const { error } = await supabase.rpc('confirm_deal', { p_deal: deal.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not confirm this deal'))
    await onDone(`${deal.deal_no} confirmed; its Sales Confirmation was created.`)
  }

  async function createOrder() {
    if (!deal) return
    setBusy(true)
    const { data, error } = await supabase.rpc('create_order', { p_deal: deal.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not create the order'))
    navigate(`/orders?open=${data as string}`)
  }

  async function approve() {
    if (!deal) return
    setBusy(true)
    const { data, error } = await supabase.from('crm_deals').update({ company_id: apprCompany, status: 'approved' }).eq('id', deal.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Your account cannot approve this deal.')
    await onDone(`${deal.deal_no} approved.`)
  }

  async function remove() {
    if (!deal) return
    setBusy(true)
    const { data, error } = await supabase.from('crm_deals').delete().eq('id', deal.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Only draft deals can be deleted, and only with permission to create deals.')
    await onDone(`${deal.deal_no} deleted${deal.lead_id ? '; its lead is editable again' : ''}.`)
  }

  return (
    <Drawer title={deal ? `${deal.deal_no} · ${statusLabel(deal.status)}` : 'New draft deal'} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      {!canEdit && <div className="notice small">You can view this deal; changing it needs the “Edit deals” permission.</div>}
      {deal?.lead_id && <p className="muted small">Created from a lead. The lead stays read-only until this draft is deleted.</p>}
      <fieldset disabled={!canEdit || approved} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <h3 className="section-title">A · Parties</h3>
        <div className="form-grid">
          <Field id="d-company" label="Our company">
            <select id="d-company" value={f.company_id} onChange={(e) => set('company_id', e.target.value)}>
              <option value="">—</option>
              {companies.filter((c) => c.is_active || c.id === f.company_id).map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.is_home ? ' (home)' : ''}</option>
              ))}
            </select>
          </Field>
          <Field id="d-buyer" label="Buyer" required>
            <select id="d-buyer" value={f.buyer_id} onChange={(e) => set('buyer_id', e.target.value)}>
              <option value="">—</option>
              {buyers.filter((x) => x.is_active || x.id === f.buyer_id).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </Field>
          <Field id="d-bgst" label="Buyer GST">
            <input id="d-bgst" className="mono" readOnly value={buyer?.gst ?? ''} />
          </Field>
          <Field id="d-supplier" label="Supplier" hint="Can be added later while the deal is a draft.">
            <select id="d-supplier" disabled={locked} value={f.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
              <option value="">—</option>
              {suppliers.filter((x) => x.is_active || x.id === f.supplier_id).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </Field>
          <Field id="d-sgst" label="Supplier GST">
            <input id="d-sgst" className="mono" readOnly value={supplier?.gst ?? ''} />
          </Field>
          <Field id="d-term" label="Payment term">
            <select id="d-term" value={f.payment_term_id} onChange={(e) => set('payment_term_id', e.target.value)}>
              <option value="">—</option>
              {terms.filter((t) => t.is_active || t.id === f.payment_term_id).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <h3 className="section-title">B · Product</h3>
        <div className="form-grid">
          <Field id="d-count" label="Count" required hint="From the Count Master.">
            <select id="d-count" value={f.count_id} onChange={(e) => set('count_id', e.target.value)}>
              <option value="">—</option>
              {counts.filter((c) => c.is_active || c.id === f.count_id).map((c) => (
                <option key={c.id} value={c.id}>{c.display_name}</option>
              ))}
            </select>
          </Field>
          <Field id="d-qty" label="Quantity" required>
            <input id="d-qty" className="mono" inputMode="decimal" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </Field>
          <Field id="d-uom" label="Unit">
            <select id="d-uom" value={f.uom} onChange={(e) => set('uom', e.target.value)}>
              {LEAD_UOMS.map((u) => (<option key={u} value={u}>{u}</option>))}
            </select>
          </Field>
          <Field id="d-bag" label="Bag weight (kg)" required={f.uom === 'BAGS'} hint={f.uom === 'BAGS' ? 'Required when the unit is BAGS.' : 'Needed only for the ₹30-per-bag commission on KG or TONS.'}>
            <input id="d-bag" className="mono" inputMode="decimal" value={f.bag_weight} onChange={(e) => set('bag_weight', e.target.value)} />
          </Field>
        </div>
        {count && (
          <dl className="kv">
            <dt>Machine</dt><dd>{count.machine}</dd>
            <dt>Composition</dt><dd>{count.composition} {count.ratio}</dd>
            <dt>Type</dt><dd>{count.yarn_type}</dd>
            <dt>Process</dt><dd>{count.process ?? '—'}</dd>
            <dt>Certification</dt><dd>{count.certification ?? '—'}</dd>
          </dl>
        )}

        <h3 className="section-title">C · Commercials</h3>
        <p className="muted small">Rates are per {f.uom === 'BAGS' ? 'bag' : f.uom.toLowerCase()}.</p>
        <div className="form-grid">
          <Field id="d-srate" label="Supplier rate" hint={locked ? 'Locked: the supplier has confirmed this deal.' : undefined}>
            <input id="d-srate" className="mono" disabled={locked} inputMode="decimal" value={f.supplier_rate} onChange={(e) => set('supplier_rate', e.target.value)} />
          </Field>
          <Field id="d-brate" label="Buyer rate" hint={bLocked ? 'Locked: the buyer has confirmed this deal.' : undefined}>
            <input id="d-brate" className="mono" disabled={bLocked} inputMode="decimal" value={f.buyer_rate} onChange={(e) => set('buyer_rate', e.target.value)} />
          </Field>
          <Field id="d-basis" label="Price basis">
            <select id="d-basis" disabled={bLocked} value={f.price_basis} onChange={(e) => set('price_basis', e.target.value as Form['price_basis'])}>
              <option value="ex_mill">Ex-mill</option>
              <option value="net">Net</option>
            </select>
          </Field>
          <Field id="d-freight" label="Freight">
            <select id="d-freight" disabled={bLocked} value={f.freight} onChange={(e) => set('freight', e.target.value as Form['freight'])}>
              <option value="excluded">Excluded</option>
              <option value="included">Included</option>
            </select>
          </Field>
          <Field id="d-comm" label="Commission" hint={deal ? undefined : 'Left blank, it follows the supplier’s (then buyer’s) master terms.'}>
            <select id="d-comm" value={f.commission_type} onChange={(e) => set('commission_type', e.target.value)}>
              <option value="">{deal ? 'Not set' : 'From master terms'}</option>
              {COMMISSION_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </select>
          </Field>
        </div>
        <dl className="kv">
          <dt>Commission per unit</dt><dd className="mono">{money(perUnit)}</dd>
          <dt>Commission total</dt><dd className="mono">{money(commTotal)}</dd>
          <dt>Margin per unit</dt><dd className="mono">{money(margin)}</dd>
          <dt>Margin total</dt><dd className="mono">{money(marginTotal)}</dd>
        </dl>
        {!f.commission_type && !deal && <p className="muted small">Commission shows once saved if a master term applies.</p>}
        <Field id="d-notes" label="Notes">
          <textarea id="d-notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </fieldset>

      {problems.length > 0 && <p className="field-hint">Still needed: {problems.join(', ')}.</p>}
      <div className="drawer-actions">
        {canEdit && !approved && (
          <button className="btn primary" type="button" disabled={busy || problems.length > 0} onClick={() => void save()}>
            {busy ? 'Saving…' : deal ? 'Save changes' : 'Create draft'}
          </button>
        )}
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Close
        </button>
        {deal && canDelete && deal.status === 'draft' && <DeleteControl label="Delete this draft" name={deal.deal_no} busy={busy} onConfirm={() => void remove()} />}
      </div>
      {deal && deal.status === 'draft' && canEdit && (
        <p className="muted small">
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void startDiscussion()}>Start rate discussion</button>{' '}
          Changing any rate, commission, freight or Ex-Mill/Net value also moves the deal to Rate Discussion.
        </p>
      )}
      {deal && confirmedDeal && (
        <div className="notice">
          <h3 className="section-title">Deal confirmed</h3>
          <dl className="kv">
            <dt>Confirmation number</dt><dd className="mono">{sc?.sc_no ?? '…'}</dd>
            <dt>Confirmation date</dt><dd className="mono">{deal.confirmed_at ? new Date(deal.confirmed_at).toLocaleDateString('en-IN') : '—'}</dd>
            <dt>Confirmation time</dt><dd className="mono">{deal.confirmed_at ? new Date(deal.confirmed_at).toLocaleTimeString('en-IN') : '—'}</dd>
          </dl>
          <p className="muted small">This deal is read-only. <Link to="/sales-confirmations">Open Sales Confirmations</Link> to send it to the supplier and buyer.</p>
          {orderId ? (
            <p className="small"><Link to={`/orders?open=${orderId}`}>Open the order for this deal</Link></p>
          ) : (
            canOrder && <p><button className="btn primary" type="button" disabled={busy} onClick={() => void createOrder()}>Create order</button></p>
          )}
        </div>
      )}
      {deal && deal.status === 'approved' && canEdit && (
        <div className="notice">
          <h3 className="section-title">Confirm deal</h3>
          {problemList === null ? (
            <p className="muted small">Checking…</p>
          ) : problemList.length === 0 ? (
            <p className="small">All checks passed: supplier and buyer confirmed, approval done, commercial fields filled, GST and master records valid.</p>
          ) : (
            <>
              <p className="small">Fix these before the deal can be confirmed:</p>
              <ul className="small">{problemList.map((x) => (<li key={x}>{x}</li>))}</ul>
            </>
          )}
          <p>
            <button className="btn primary" type="button" disabled={busy || problemList === null || problemList.length > 0} onClick={() => void confirmDeal()}>Confirm deal</button>
          </p>
          <p className="muted small">Confirming creates the Sales Confirmation (number, date and time are automatic and cannot be edited) and makes this deal read-only.</p>
        </div>
      )}
      {deal && approved && (
        <p className="notice small">
          Approved by {deal.approved_by ? names[deal.approved_by] ?? 'a manager' : 'a manager'} on {deal.approved_at ? formatDateTime(deal.approved_at) : ''}
          {deal.approval_margin_pct !== null ? ` at a margin of ${deal.approval_margin_pct}%` : ''}. All deal terms are locked.{' '}
          {isAdmin && !confirmedDeal && (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => void setStatus('buyer_confirmed', 'was reopened to Buyer Confirmed.')}>Reopen approval (admin)</button>
          )}
        </p>
      )}
      {deal && deal.status === 'buyer_confirmed' && canApprove && (
        <div className="notice">
          <h3 className="section-title">Manager approval</h3>
          <dl className="kv">
            <dt>Margin per unit</dt><dd className="mono">{money(deal.margin)}</dd>
            <dt>Margin %</dt><dd className="mono">{deal.margin !== null && deal.buyer_rate ? `${((deal.margin / deal.buyer_rate) * 100).toFixed(2)}%` : '—'}</dd>
          </dl>
          <Field id="d-appr-company" label="Internal company" required hint="The company of ours that will carry this deal.">
            <select id="d-appr-company" value={apprCompany} onChange={(e) => setApprCompany(e.target.value)}>
              <option value="">—</option>
              {companies.filter((c) => c.is_active || c.id === apprCompany).map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.is_home ? ' (home)' : ''}</option>
              ))}
            </select>
          </Field>
          <label className="small">
            <input type="checkbox" checked={validated} onChange={(e) => setValidated(e.target.checked)} /> I have checked the margin % above and it is acceptable.
          </label>
          <p>
            <button className="btn primary" type="button" disabled={busy || !validated || !apprCompany || deal.margin === null || deal.margin < 0} onClick={() => void approve()}>Approve deal</button>
          </p>
          {deal.margin !== null && deal.margin < 0 && <p className="field-hint">The margin is negative, so this deal cannot be approved.</p>}
          <p className="muted small">Approving records your name and the date and time, and sets the status to Approved.</p>
        </div>
      )}
      {deal && (locked || bLocked) && !approved && (
        <p className="notice small">
          {locked && <>Supplier confirmed {deal.supplier_confirmed_at ? formatDateTime(deal.supplier_confirmed_at) : ''}: supplier and supplier rate locked. </>}
          {bLocked && <>Buyer confirmed {deal.buyer_confirmed_at ? formatDateTime(deal.buyer_confirmed_at) : ''}: buyer rate, freight and Ex-Mill/Net locked. </>}
          {isAdmin && (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => void setStatus('rate_discussion', 'was reopened for rate discussion.')}>Reopen (admin)</button>
          )}
        </p>
      )}
      {deal && (deal.status === 'draft' || deal.status === 'rate_discussion') && canEdit && (
        <p className="muted small">
          <button className="btn" type="button" disabled={busy || !deal.supplier_id || !deal.supplier_rate || deal.supplier_rate <= 0} onClick={() => void setStatus('supplier_confirmed', 'is now Supplier Confirmed; the supplier rate is locked.')}>Supplier confirmed</button>{' '}
          Locks the supplier and supplier rate. Needs a saved supplier and supplier rate{deal.supplier_id && deal.supplier_rate ? '' : ' (save them first)'}.
        </p>
      )}
      {deal && ['draft', 'rate_discussion', 'supplier_confirmed'].includes(deal.status) && canEdit && (
        <p className="muted small">
          <button className="btn" type="button" disabled={busy || !deal.buyer_rate || deal.buyer_rate <= 0} onClick={() => void setStatus('buyer_confirmed', 'is now Buyer Confirmed; buyer rate, freight and Ex-Mill/Net are locked.')}>Buyer confirmed</button>{' '}
          Locks the buyer rate, freight and Ex-Mill/Net. Needs a saved buyer rate{deal.buyer_rate ? '' : ' (save it first)'}.
        </p>
      )}
      {deal && <RateChanges dealId={deal.id} refreshKey={deal.updated_at} />}
      {deal && (
        <ActivityPanel
          entityType="deal"
          entityId={deal.id}
          canWrite={canEdit}
          kinds={['call', 'email', 'whatsapp', 'meeting', 'note']}
          title="Communication history"
        />
      )}
      {deal && <p className="muted small">Last updated {formatDateTime(deal.updated_at)}.</p>}
    </Drawer>
  )
}

function statusLabel(s: string): string {
  return s === 'draft' ? 'Draft' : s === 'rate_discussion' ? 'Rate Discussion' : s === 'supplier_confirmed' ? 'Supplier Confirmed' : s === 'buyer_confirmed' ? 'Buyer Confirmed' : s === 'approved' ? 'Approved' : s === 'confirmed' ? 'Confirmed' : s
}

const CHANGE_LABEL: Record<string, string> = {
  buyer_rate: 'Buyer rate',
  supplier_rate: 'Supplier rate',
  commission_type: 'Commission type',
  freight: 'Freight',
  price_basis: 'Ex-Mill/Net',
  status: 'Status',
}

function changeValue(field: string, v: string | null): string {
  if (v === null || v === '') return '—'
  if (field === 'price_basis') return v === 'ex_mill' ? 'Ex-mill' : v === 'net' ? 'Net' : v
  if (field === 'status') return statusLabel(v)
  if (field === 'commission_type') return COMMISSION_TYPES.find((t) => t.value === v)?.label ?? v
  if (field === 'freight') return v === 'included' ? 'Included' : v === 'excluded' ? 'Excluded' : v
  return v
}

function RateChanges({ dealId, refreshKey }: { dealId: string; refreshKey: string }) {
  const names = useProfileNames()
  const [rows, setRows] = useState<DealChange[] | null>(null)
  useEffect(() => {
    let alive = true
    void supabase
      .from('deal_changes')
      .select('*')
      .eq('deal_id', dealId)
      .order('changed_at', { ascending: false })
      .then(({ data }) => {
        if (alive) setRows((data ?? []) as DealChange[])
      })
    return () => {
      alive = false
    }
  }, [dealId, refreshKey])
  return (
    <>
      <h3 className="section-title">Rate changes</h3>
      {rows === null ? (
        <p className="muted small">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">No changes recorded yet.</p>
      ) : (
        <ul className="timeline" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line, #e5e5e5)' }}>
              <strong>{CHANGE_LABEL[r.field] ?? r.field}</strong>: {changeValue(r.field, r.old_value)} → {changeValue(r.field, r.new_value)}
              <div className="muted small">
                {formatDateTime(r.changed_at)}
                {r.changed_by ? ` · ${names[r.changed_by] ?? 'a user'}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}