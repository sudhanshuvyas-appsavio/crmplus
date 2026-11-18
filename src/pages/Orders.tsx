/** Dispatch and Billing board, modelled on the monday.com "Dispatch and Billing" board.
 *
 *  One item per Sales Confirmation, created from the confirmation ("Create
 *  Dispatch and Billing"). Parties, goods, rate and commission are copied from
 *  it and fixed. Here the team adds the billing (invoice, CGST, insurance,
 *  add / deduct, round off) and transport details, starts dispatch, and records
 *  dispatch entries (monday subitems), each with its own weight, value,
 *  commission and total. The status follows the dispatches:
 *  Draft -> In Progress -> Partially Dispatch -> Fully Dispatch (or Return / Cancel).
 *
 *  The data lives in `orders` / `order_dispatches`, so the task screens
 *  (pending dispatches, mill invoices, transport, collections, commission bills)
 *  keep working off the same records. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { CountRow, JobProcess, Order, PaymentTerm, Transporter } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { OrderExecution } from '../components/OrderExecution'
import { Avatar, Board, StatusPill, ViewSwitch, useStoredState, type BoardColumn } from '../components/board/Board'
import { MIRROR_PARTY_COLS, cell, partyMirrors, type MirrorCompany, type MirrorParty } from '../components/board/mirrors'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage, numOrNull } from '../lib/party'
import { formatDateTime } from '../lib/format'
import {
  COMM_BASES, DISPATCH_STATUSES, TRANSPORT_TYPES, commTerms, dispatchStatus, inr, saleTypeLabel, totalAmount, transportTypeLabel, uomLabel,
} from '../lib/deals'

type Named = { id: string; name: string }
type ScRef = { id: string; sc_no: string }

const CSV_COLUMNS = [
  'order_no', 'status', 'sales_confirmation', 'invoice_no', 'invoice_date', 'buyer', 'supplier', 'count', 'quantity', 'dispatched_qty', 'uom',
  'final_rate', 'total_weight', 'order_value', 'buyer_commission', 'supplier_commission', 'cgst_pct', 'insurance_pct', 'add_amount',
  'deduct_amount', 'total_amount', 'round_off', 'sale_type', 'transport_type', 'transporter', 'vehicle_no',
] as const

export default function DispatchAndBilling() {
  const { can } = useAuth()
  const canManage = can('order.manage')
  const canRead = canManage || can('order.read')
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<Order[] | null>(null)
  const [buyers, setBuyers] = useState<MirrorParty[]>([])
  const [suppliers, setSuppliers] = useState<MirrorParty[]>([])
  const [companies, setCompanies] = useState<MirrorCompany[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [jobs, setJobs] = useState<JobProcess[]>([])
  const [transporters, setTransporters] = useState<Transporter[]>([])
  const [people, setPeople] = useState<Named[]>([])
  const [scs, setScs] = useState<Map<string, string>>(new Map())
  const [editing, setEditing] = useState<Order | null>(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useStoredState<'table' | 'kanban'>('dnb.view', 'table')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    const [o, b, s, c, k, t, j, tr, p, sc] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('buyer_master').select(MIRROR_PARTY_COLS),
      supabase.from('supplier_master').select(MIRROR_PARTY_COLS),
      supabase.from('companies').select('id,name,phone_1,mobile'),
      supabase.from('count_master').select('*'),
      supabase.from('payment_terms').select('*'),
      supabase.from('job_processes').select('*').order('name'),
      supabase.from('transporters').select('*').order('name'),
      supabase.from('profiles').select('id,name').eq('is_active', true).order('name'),
      supabase.from('sales_confirmations').select('id,sc_no'),
    ])
    if (o.error) setBanner({ kind: 'bad', text: errMessage(o.error, 'Could not load Dispatch and Billing') })
    setRows((o.data ?? []) as Order[])
    setBuyers((b.data ?? []) as MirrorParty[])
    setSuppliers((s.data ?? []) as MirrorParty[])
    setCompanies((c.data ?? []) as MirrorCompany[])
    setCounts((k.data ?? []) as CountRow[])
    setTerms((t.data ?? []) as PaymentTerm[])
    setJobs((j.data ?? []) as JobProcess[])
    setTransporters((tr.data ?? []) as Transporter[])
    setPeople((p.data ?? []) as Named[])
    setScs(new Map(((sc.data ?? []) as ScRef[]).map((x) => [x.id, x.sc_no])))
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const nameMap = (list: Named[]) => new Map(list.map((x) => [x.id, x.name]))
  const buyerName = useMemo(() => nameMap(buyers), [buyers])
  const supplierName = useMemo(() => nameMap(suppliers), [suppliers])
  const countName = useMemo(() => new Map(counts.map((x) => [x.id, x.display_name])), [counts])
  const transporterName = useMemo(() => nameMap(transporters), [transporters])
  const personName = useMemo(() => nameMap(people), [people])

  const openId = params.get('open')
  useEffect(() => {
    if (openId && rows) {
      const hit = rows.find((x) => x.id === openId)
      if (hit) setEditing(hit)
      setParams({}, { replace: true })
    }
  }, [openId, rows, setParams])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(
      (x) =>
        !q ||
        x.order_no.toLowerCase().includes(q) ||
        (x.invoice_no ?? '').toLowerCase().includes(q) ||
        (scs.get(x.sales_confirmation_id) ?? '').toLowerCase().includes(q) ||
        (buyerName.get(x.buyer_id) ?? '').toLowerCase().includes(q) ||
        (supplierName.get(x.supplier_id) ?? '').toLowerCase().includes(q) ||
        (countName.get(x.count_id) ?? '').toLowerCase().includes(q) ||
        (x.vehicle_no ?? '').toLowerCase().includes(q),
    )
  }, [rows, search, scs, buyerName, supplierName, countName])

  function exportCSV() {
    const list = shown.map((x) => ({
      ...x,
      status: dispatchStatus(x.dispatch_status).label,
      sales_confirmation: scs.get(x.sales_confirmation_id) ?? '',
      buyer: buyerName.get(x.buyer_id) ?? '',
      supplier: supplierName.get(x.supplier_id) ?? '',
      count: countName.get(x.count_id) ?? '',
      uom: uomLabel(x.uom),
      sale_type: saleTypeLabel(x.sale_type),
      transport_type: transportTypeLabel(x.transport_type),
      transporter: x.transporter_id ? transporterName.get(x.transporter_id) ?? '' : '',
    }))
    downloadCSV(`dispatch-and-billing-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!canRead) return <div className="card pad narrow-card">Your account does not have access to Dispatch and Billing.</div>
  if (!rows) return <Loading label="Loading Dispatch and Billing" />

  const sum = (pick: (d: Order) => number | null) => (list: Order[]) => (
    <span className="mono strong">{inr(list.reduce((a, r) => a + (pick(r) ?? 0), 0), 0)}</span>
  )
  const buyerById = new Map(buyers.map((x) => [x.id, x]))
  const supplierById = new Map(suppliers.map((x) => [x.id, x]))
  const ctx = { people: personName, companies: new Map(companies.map((c) => [c.id, c])) }
  const jobName = new Map(jobs.map((j) => [j.id, j.name]))
  const basisLabel = (b: string | null) => COMM_BASES.find((x) => x.value === b)?.label ?? null
  const money = (v: number | null) => <span className="mono">{inr(v, 0)}</span>
  // Columns in the order of the monday Dispatch and Billing board.
  const columns: BoardColumn<Order>[] = [
    { key: 'no', label: 'Item', width: 130, render: (x) => <span className="mono">{x.order_no}</span> },
    { key: 'status', label: 'Status', width: 170, render: (x) => <StatusPill label={dispatchStatus(x.dispatch_status).label} tone={dispatchStatus(x.dispatch_status).tone} /> },
    { key: 'inv', label: 'Invoice No.', render: (x) => cell(x.invoice_no, { mono: true }) },
    { key: 'invdate', label: 'Invoice Date', render: (x) => cell(x.invoice_date) },
    { key: 'created', label: 'Created Date', render: (x) => cell(x.created_at.slice(0, 10)) },
    { key: 'sc', label: 'Sales Confirmation', interactive: true, render: (x) => <Link className="mono small" to={`/sales-confirmations?open=${x.sales_confirmation_id}`}>{scs.get(x.sales_confirmation_id) ?? '—'}</Link> },
    { key: 'buyer', label: 'Buyer', render: (x) => <strong>{buyerName.get(x.buyer_id) ?? '—'}</strong> },
    ...partyMirrors<Order>('Buyer', (x) => buyerById.get(x.buyer_id),
      ['messenger', 'officePhone', 'officeAddress', 'millAddress', 'gst', 'unit', 'unitPhone', 'cp1', 'cp1Phone', 'cp1Email', 'cp2Phone', 'cp2Email', 'email', 'pan'], ctx),
    { key: 'bctype', label: 'Buyer Commission Type', render: (x) => cell(basisLabel(x.buyer_comm_basis)) },
    { key: 'bcval', label: 'Buyer Commission Value', align: 'right', render: (x) => cell(x.buyer_comm_value, { mono: true }) },
    { key: 'supplier', label: 'Supplier', render: (x) => supplierName.get(x.supplier_id) ?? '—' },
    ...partyMirrors<Order>('Supplier', (x) => supplierById.get(x.supplier_id), ['messenger', 'unit', 'unitPhone'], ctx),
    { key: 'sctype', label: 'Supplier Commission Type', render: (x) => cell(basisLabel(x.supplier_comm_basis)) },
    { key: 'scval', label: 'Supplier Commission Value', align: 'right', render: (x) => cell(x.supplier_comm_value, { mono: true }) },
    { key: 'delivery', label: 'Sizing/Delivery Address', render: (x) => cell(x.job_process_id ? jobName.get(x.job_process_id) : x.alt_delivery_address, { clip: true }) },
    { key: 'qty', label: 'Quantity', align: 'right', render: (x) => cell(x.quantity, { mono: true }) },
    { key: 'transporter', label: 'Transporter Name', render: (x) => cell(x.transporter_id ? transporterName.get(x.transporter_id) : null) },
    { key: 'vehicle', label: 'Vehicle Number', render: (x) => cell(x.vehicle_no, { mono: true }) },
    { key: 'driver', label: 'Driver Contact Phone', render: (x) => cell(x.driver_phone, { mono: true }) },
    { key: 'schedule', label: 'Delivery Schedule', render: (x) => cell(x.delivery_schedule, { clip: true }) },
    { key: 'count', label: 'Counts', render: (x) => cell(countName.get(x.count_id)) },
    { key: 'uom', label: 'UOM', render: (x) => cell(uomLabel(x.uom)) },
    { key: 'rate', label: 'Final Rate', align: 'right', render: (x) => cell(x.final_rate, { mono: true }) },
    { key: 'bag', label: 'Bags Weight', align: 'right', render: (x) => cell(x.bag_weight, { mono: true }) },
    { key: 'weight', label: 'Total Weight', align: 'right', render: (x) => cell(x.total_weight, { mono: true }) },
    { key: 'value', label: 'Value', align: 'right', render: (x) => money(x.order_value), total: sum((r) => r.order_value) },
    { key: 'bcomm', label: 'Buyer Commission', align: 'right', render: (x) => money(x.buyer_commission), total: sum((r) => r.buyer_commission) },
    { key: 'scomm', label: 'Supplier Commission', align: 'right', render: (x) => money(x.supplier_commission), total: sum((r) => r.supplier_commission) },
    { key: 'cgst', label: 'CGST', align: 'right', render: (x) => cell(x.cgst_pct, { mono: true }) },
    { key: 'ins', label: 'Insurance Tax', align: 'right', render: (x) => cell(x.insurance_pct, { mono: true }) },
    { key: 'add', label: 'Add', align: 'right', render: (x) => cell(x.add_amount, { mono: true }) },
    { key: 'deduct', label: 'Deduct', align: 'right', render: (x) => cell(x.deduct_amount, { mono: true }) },
    { key: 'total', label: 'Total Amount', align: 'right', render: (x) => money(x.total_amount), total: sum((r) => r.total_amount) },
    { key: 'round', label: 'Round off', align: 'right', render: (x) => cell(x.round_off, { mono: true }) },
    { key: 'dispatched', label: 'Quantity Dispatched', render: (x) => <Progress done={x.dispatched_qty} total={x.quantity} uom={x.uom} /> },
    { key: 'remark', label: 'Remark 1', render: (x) => cell(x.special_instructions, { clip: true }) },
    { key: 'dispatch-date', label: 'Dispatch Date', render: (x) => cell(x.tentative_dispatch_date) },
    { key: 'person', label: 'Person', render: (x) => <Avatar name={x.person_id ? personName.get(x.person_id) : undefined} /> },
    { key: 'transport', label: 'Transport Type', render: (x) => cell(x.transport_type ? transportTypeLabel(x.transport_type) : null) },
  ]

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dispatch and Billing</h1>
          <p className="page-sub">One item per Sales Confirmation. Add the billing and transport, then record each dispatch.</p>
        </div>
      </header>

      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}{' '}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      <div className="board-toolbar">
        <ViewSwitch view={view} onChange={setView} />
        <input className="toolbar-search" aria-label="Search" placeholder="Search item, invoice, SC, buyer, supplier, vehicle" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="push" />
        <button className="btn sm" type="button" disabled={shown.length === 0} onClick={exportCSV}>
          Export {shown.length === rows.length ? 'all' : `${shown.length} shown`}
        </button>
      </div>

      <Board
        rows={shown}
        groups={DISPATCH_STATUSES}
        groupOf={(x) => x.dispatch_status}
        columns={columns}
        rowKey={(x) => x.id}
        onOpen={(x) => setEditing(x)}
        view={view}
        emptyText={rows.length === 0 ? 'Nothing yet. Open a complete Sales Confirmation and choose “Create Dispatch and Billing”.' : 'No item matches.'}
        card={(x) => (
          <>
            <span className="kcard-top">
              <span className="mono small">{x.order_no}</span>
              <span className="mono small muted">{scs.get(x.sales_confirmation_id) ?? ''}</span>
            </span>
            <strong className="kcard-title">{buyerName.get(x.buyer_id) ?? '—'}</strong>
            <span className="small muted">from {supplierName.get(x.supplier_id) ?? '—'}</span>
            <Progress done={x.dispatched_qty} total={x.quantity} uom={x.uom} />
            <span className="kcard-foot mono small">
              <span>{x.invoice_no ?? 'no invoice'}</span>
              <span>₹{inr(x.total_amount, 0)}</span>
            </span>
          </>
        )}
      />

      {editing && (
        <ItemPanel
          key={editing.id}
          order={editing}
          canManage={canManage}
          scNo={scs.get(editing.sales_confirmation_id) ?? ''}
          names={{
            buyer: buyerName.get(editing.buyer_id) ?? '—',
            supplier: supplierName.get(editing.supplier_id) ?? '—',
            company: companies.find((c) => c.id === editing.company_id)?.name ?? '—',
            term: terms.find((t) => t.id === editing.payment_term_id)?.name ?? '—',
          }}
          count={counts.find((c) => c.id === editing.count_id) ?? null}
          jobs={jobs}
          transporters={transporters}
          people={people}
          onClose={() => setEditing(null)}
          onRefresh={async () => {
            const { data } = await supabase.from('orders').select('*').eq('id', editing.id).maybeSingle()
            if (data) setEditing(data as Order)
            await load()
          }}
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

function Progress({ done, total, uom }: { done: number; total: number; uom: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <span className="progress" title={`${inr(done)} of ${inr(total)} ${uomLabel(uom)}`}>
      <span className="progress-bar"><span style={{ width: `${pct}%` }} /></span>
      <span className="mono small">{inr(done)}/{inr(total)} {uomLabel(uom)}</span>
    </span>
  )
}

type BillForm = {
  invoice_no: string
  invoice_date: string
  cgst_pct: string
  insurance_pct: string
  add_amount: string
  deduct_amount: string
  round_off: string
  transport_type: string
  transporter_id: string
  vehicle_no: string
  driver_phone: string
  person_id: string
  tentative_dispatch_date: string
  delivery_schedule: string
  special_instructions: string
  job_process_id: string
  alt_delivery_address: string
}

const s = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

function toBill(o: Order): BillForm {
  return {
    invoice_no: o.invoice_no ?? '',
    invoice_date: o.invoice_date ?? '',
    cgst_pct: s(o.cgst_pct),
    insurance_pct: s(o.insurance_pct),
    add_amount: s(o.add_amount),
    deduct_amount: s(o.deduct_amount),
    round_off: s(o.round_off),
    transport_type: o.transport_type ?? '',
    transporter_id: o.transporter_id ?? '',
    vehicle_no: o.vehicle_no ?? '',
    driver_phone: o.driver_phone ?? '',
    person_id: o.person_id ?? '',
    tentative_dispatch_date: o.tentative_dispatch_date ?? '',
    delivery_schedule: o.delivery_schedule ?? '',
    special_instructions: o.special_instructions ?? '',
    job_process_id: o.job_process_id ?? '',
    alt_delivery_address: o.alt_delivery_address ?? '',
  }
}

function ItemPanel({
  order, canManage, scNo, names, count, jobs, transporters, people, onClose, onDone, onRefresh,
}: {
  order: Order
  canManage: boolean
  scNo: string
  names: { buyer: string; supplier: string; company: string; term: string }
  count: CountRow | null
  jobs: JobProcess[]
  transporters: Transporter[]
  people: Named[]
  onClose: () => void
  onDone: (text: string) => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const [f, setF] = useState<BillForm>(toBill(order))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [askCancel, setAskCancel] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const set = <K extends keyof BillForm>(k: K, v: BillForm[K]) => setF((p) => ({ ...p, [k]: v }))
  const st = dispatchStatus(order.dispatch_status)
  const cancelled = order.status === 'cancelled'
  const closed = order.status === 'closed'
  // Editable until the item is closed (or cancelled).
  const canChange = canManage && !cancelled && !closed
  const editable = canChange && editMode
  const started = order.status === 'open_for_execution' || closed
  const dirty = JSON.stringify(f) !== JSON.stringify(toBill(order))

  const cgst = numOrNull(f.cgst_pct)
  const ins = numOrNull(f.insurance_pct)
  const add = numOrNull(f.add_amount)
  const ded = numOrNull(f.deduct_amount)
  const round = numOrNull(f.round_off)
  const total = totalAmount(order.order_value, cgst, ins, add, ded)

  const bad: string[] = []
  if (f.cgst_pct && (cgst === null || cgst < 0 || cgst > 100)) bad.push('CGST % (0 to 100)')
  if (f.insurance_pct && (ins === null || ins < 0 || ins > 100)) bad.push('Insurance % (0 to 100)')
  if (f.add_amount && (add === null || add < 0)) bad.push('Add (a positive number)')
  if (f.deduct_amount && (ded === null || ded < 0)) bad.push('Deduct (a positive number)')
  if (f.round_off && round === null) bad.push('Round off (a number)')
  if (f.driver_phone && !/^[0-9+ -]{6,20}$/.test(f.driver_phone.trim())) bad.push('Driver phone (digits only)')

  function pickJob(id: string) {
    const j = jobs.find((x) => x.id === id)
    setF((p) => ({ ...p, job_process_id: id, alt_delivery_address: j ? j.delivery_address || j.office_address || '' : '' }))
  }

  const payload = () => ({
    invoice_no: f.invoice_no.trim() || null,
    invoice_date: f.invoice_date || null,
    cgst_pct: cgst,
    insurance_pct: ins,
    add_amount: add,
    deduct_amount: ded,
    round_off: round,
    transport_type: f.transport_type || null,
    transporter_id: f.transporter_id || null,
    vehicle_no: f.vehicle_no.trim() || null,
    driver_phone: f.driver_phone.trim() || null,
    person_id: f.person_id || null,
    tentative_dispatch_date: f.tentative_dispatch_date || null,
    delivery_schedule: f.delivery_schedule.trim() || null,
    special_instructions: f.special_instructions.trim() || null,
    job_process_id: f.job_process_id || null,
    alt_delivery_address: f.alt_delivery_address.trim() || null,
  })

  async function run(extra: Record<string, unknown>, msg: string, stayOpen = false) {
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.from('orders').update({ ...payload(), ...extra }).eq('id', order.id).select('id')
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this item'))
    if (!data || data.length === 0) return setErr('Your account cannot change this item.')
    setEditMode(false)
    if (stayOpen) await onRefresh()
    else await onDone(msg)
  }

  return (
    <Drawer title={order.order_no} onClose={onClose}>
      <div className="panel-status">
        <StatusPill label={st.label} tone={st.tone} />
        <span className="small muted">
          Created {order.order_date} · from <Link className="mono" to={`/sales-confirmations?open=${order.sales_confirmation_id}`}>{scNo || 'its Sales Confirmation'}</Link>
          {order.execution_opened_at ? ` · dispatch started ${formatDateTime(order.execution_opened_at)}` : ''}
        </span>
      </div>
      {err && <div className="alert">{err}</div>}
      {cancelled && <div className="notice small">Cancelled{order.cancelled_at ? ` ${formatDateTime(order.cancelled_at)}` : ''}. Its Sales Confirmation can now be cancelled or used again.</div>}

      <h3 className="section-title">From the Sales Confirmation</h3>
      <dl className="kv">
        <dt>Buyer</dt><dd><strong>{names.buyer}</strong></dd>
        <dt>Supplier</dt><dd>{names.supplier}</dd>
        <dt>Count</dt><dd>{count?.display_name ?? '—'}</dd>
        <dt>Quantity</dt><dd className="mono">{inr(order.quantity)} {uomLabel(order.uom)}{order.bag_weight ? ` · ${inr(order.bag_weight)} kg each` : ''}</dd>
        <dt>Final rate</dt><dd className="mono">₹{inr(order.final_rate)} per kg</dd>
        <dt>Commission</dt><dd>Buyer {commTerms(order.buyer_comm_basis, order.buyer_comm_value)} · Supplier {commTerms(order.supplier_comm_basis, order.supplier_comm_value)}</dd>
        <dt>Type</dt><dd>{saleTypeLabel(order.sale_type)} · {order.price_basis === 'net' ? 'Net' : 'Ex-mill'} · freight {order.freight === 'included' ? 'included' : 'excluded'}</dd>
        <dt>Payment terms</dt><dd>{names.term}</dd>
        <dt>Our company</dt><dd>{names.company}</dd>
      </dl>
      <div className="figures">
        <div><span>Total weight</span><strong className="mono">{order.total_weight === null ? '—' : `${inr(order.total_weight)} kg`}</strong></div>
        <div><span>Value</span><strong className="mono">₹{inr(order.order_value, 0)}</strong></div>
        <div><span>Buyer commission</span><strong className="mono">₹{inr(order.buyer_commission, 0)}</strong></div>
        <div><span>Supplier commission</span><strong className="mono">₹{inr(order.supplier_commission, 0)}</strong></div>
      </div>

      <fieldset disabled={!editable} className="plain-fieldset">
        <h3 className="section-title">Billing</h3>
        <div className="form-grid">
          <Field id="b-inv" label="Invoice no."><input id="b-inv" className="mono" value={f.invoice_no} onChange={(e) => set('invoice_no', e.target.value)} /></Field>
          <Field id="b-invd" label="Invoice date"><input id="b-invd" type="date" value={f.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} /></Field>
          <Field id="b-cgst" label="CGST %"><input id="b-cgst" className="mono" inputMode="decimal" value={f.cgst_pct} onChange={(e) => set('cgst_pct', e.target.value)} /></Field>
          <Field id="b-ins" label="Insurance %"><input id="b-ins" className="mono" inputMode="decimal" value={f.insurance_pct} onChange={(e) => set('insurance_pct', e.target.value)} /></Field>
          <Field id="b-add" label="Add (₹)"><input id="b-add" className="mono" inputMode="decimal" value={f.add_amount} onChange={(e) => set('add_amount', e.target.value)} /></Field>
          <Field id="b-ded" label="Deduct (₹)"><input id="b-ded" className="mono" inputMode="decimal" value={f.deduct_amount} onChange={(e) => set('deduct_amount', e.target.value)} /></Field>
          <Field id="b-round" label="Round off (₹)"><input id="b-round" className="mono" inputMode="decimal" value={f.round_off} onChange={(e) => set('round_off', e.target.value)} /></Field>
        </div>
        <div className="figures">
          <div><span>Total amount</span><strong className="mono">₹{inr(total, 2)}</strong></div>
          <div><span>After round off</span><strong className="mono">₹{inr(total === null ? null : total + (round ?? 0), 2)}</strong></div>
        </div>

        <h3 className="section-title">Transport and delivery</h3>
        <div className="form-grid">
          <Field id="b-tt" label="Transport type">
            <select id="b-tt" value={f.transport_type} onChange={(e) => set('transport_type', e.target.value)}>
              <option value="">—</option>
              {TRANSPORT_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </select>
          </Field>
          <Field id="b-tr" label="Transport company">
            <select id="b-tr" value={f.transporter_id} onChange={(e) => set('transporter_id', e.target.value)}>
              <option value="">—</option>
              {transporters.filter((t) => t.is_active || t.id === f.transporter_id).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
          </Field>
          <Field id="b-veh" label="Vehicle number"><input id="b-veh" value={f.vehicle_no} onChange={(e) => set('vehicle_no', e.target.value.toUpperCase())} /></Field>
          <Field id="b-drv" label="Driver phone"><input id="b-drv" inputMode="tel" value={f.driver_phone} onChange={(e) => set('driver_phone', e.target.value)} /></Field>
          <Field id="b-person" label="Person">
            <select id="b-person" value={f.person_id} onChange={(e) => set('person_id', e.target.value)}>
              <option value="">—</option>
              {people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </Field>
          <Field id="b-date" label="Planned dispatch date"><input id="b-date" type="date" value={f.tentative_dispatch_date} onChange={(e) => set('tentative_dispatch_date', e.target.value)} /></Field>
          <Field id="b-job" label="Sizing / delivery address">
            <select id="b-job" value={f.job_process_id} onChange={(e) => pickJob(e.target.value)}>
              <option value="">Buyer’s address</option>
              {jobs.filter((j) => j.is_active || j.id === f.job_process_id).map((j) => (<option key={j.id} value={j.id}>{j.name}</option>))}
            </select>
          </Field>
        </div>
        {(f.job_process_id || f.alt_delivery_address) && (
          <Field id="b-addr" label="Delivery address"><textarea id="b-addr" rows={2} value={f.alt_delivery_address} onChange={(e) => set('alt_delivery_address', e.target.value)} /></Field>
        )}
        <Field id="b-sched" label="Delivery schedule"><textarea id="b-sched" rows={2} value={f.delivery_schedule} onChange={(e) => set('delivery_schedule', e.target.value)} /></Field>
        <Field id="b-instr" label="Special instructions"><textarea id="b-instr" rows={2} value={f.special_instructions} onChange={(e) => set('special_instructions', e.target.value)} /></Field>
      </fieldset>

      {bad.length > 0 && <p className="field-hint">Check: {bad.join(', ')}.</p>}

      {closed && <div className="notice small">This item is closed and can no longer be edited.</div>}
      {canChange && (
        <div className="drawer-actions">
          {!editMode && (
            <button className="btn" type="button" disabled={busy} onClick={() => setEditMode(true)}>Edit</button>
          )}
          {editable && dirty && (
            <button className="btn primary" type="button" disabled={busy || bad.length > 0} onClick={() => void run({}, `${order.order_no} saved.`, true)}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
          {editable && (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => { setF(toBill(order)); setErr(null); setEditMode(false) }}>Cancel editing</button>
          )}
          {!started && (
            <button className="btn primary" type="button" disabled={busy || bad.length > 0} onClick={() => void run({ status: 'open_for_execution' }, `${order.order_no}: dispatch started.`, true)}>
              {dirty ? 'Save and start dispatch' : 'Start dispatch'}
            </button>
          )}
          {!closed && order.dispatched_qty === 0 && !askCancel && (
            <button className="btn ghost push" type="button" disabled={busy} onClick={() => setAskCancel(true)}>Cancel item</button>
          )}
          {askCancel && (
            <span className="push toolbar-confirm">
              <span className="field-warn">Cancel {order.order_no}?</span>
              <button className="btn danger sm" type="button" disabled={busy} onClick={() => void run({ status: 'cancelled' }, `${order.order_no} cancelled.`)}>Yes, cancel</button>
              <button className="btn ghost sm" type="button" onClick={() => setAskCancel(false)}>No</button>
            </span>
          )}
        </div>
      )}
      {!started && !cancelled && <p className="muted small">Start dispatch to record dispatch entries, transport, job processes and payments.</p>}

      {started && <OrderExecution order={order} canManage={canManage} jobs={jobs} onChanged={onRefresh} />}
    </Drawer>
  )
}
