/** Dispatch and Billing board, modelled on the monday.com "Dispatch and Billing" board and built like
 *  Leads, Deals and Sales Confirmation: an Actions column (view, edit, start dispatch, cancel), a read-only
 *  details drawer, and a pop-up form to create or update an item.
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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { CountRow, JobProcess, Order, OrderAdjustment, OrderDispatch, PaymentTerm, Transporter } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { OrderFormModal } from '../components/OrderFormModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SubitemDialog, SUB_LABEL, type SubKind } from '../components/SubitemDialog'
import { RowActionMenu, type RowAction } from '../components/RowActionMenu'
import { BoardTabs } from '../components/board/BoardTabs'
import { Board, PersonCell, DownloadIcon, StatusPicker, ViewSwitch, useStoredState, type BoardColumn } from '../components/board/Board'
import { cell } from '../components/board/mirrors'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'
import {
  COMM_BASES, DNB_GROUPS, dnbGroup, dispatchStatus, inr, rateText, saleTypeLabel, transportTypeLabel, uomLabel,
} from '../lib/deals'
import { formatShortDate } from '../lib/format'

type Named = { id: string; name: string }
type ScRef = { id: string; sc_no: string }

const CSV_COLUMNS = [
  'order_no', 'sr_no', 'status', 'sales_confirmation', 'invoice_no', 'invoice_date', 'buyer', 'supplier', 'count', 'quantity', 'dispatched_qty', 'uom',
  'final_rate', 'total_weight', 'order_value', 'buyer_commission', 'supplier_commission', 'cgst_pct', 'insurance_pct', 'add_amount',
  'deduct_amount', 'total_amount', 'round_off', 'sale_type', 'transport_type', 'transporter', 'vehicle_no',
] as const

export default function DispatchAndBilling() {
  const { can, me } = useAuth()
  const canManage = can('order.manage')
  const canRead = canManage || can('order.read')
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<Order[] | null>(null)
  const [buyers, setBuyers] = useState<Named[]>([])
  const [suppliers, setSuppliers] = useState<Named[]>([])
  const [, setCompanies] = useState<Named[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [, setTerms] = useState<PaymentTerm[]>([])
  const [jobs, setJobs] = useState<JobProcess[]>([])
  const [transporters, setTransporters] = useState<Transporter[]>([])
  const [people, setPeople] = useState<Named[]>([])
  const [scs, setScs] = useState<Map<string, string>>(new Map())
  const navigate = useNavigate()
  const [details, setDetails] = useState<Order | null>(null)
  const [formFor, setFormFor] = useState<Order | 'new' | null>(null)
  const [cancelling, setCancelling] = useState<Order | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [tab, setTab] = useState<'table' | 'duplicates'>('table')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [ownerFilter, setOwnerFilter] = useStoredState('dnb.owner', '')
  const [view, setView] = useStoredState<'table' | 'kanban'>('dnb.view', 'table')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  const [subFor, setSubFor] = useState<{ order: Order; kind: SubKind } | null>(null)
  const [dispatches, setDispatches] = useState<OrderDispatch[]>([])
  const [adjustments, setAdjustments] = useState<OrderAdjustment[]>([])

  const load = useCallback(async () => {
    const [o, b, s, c, k, t, j, tr, p, sc, dd, aa] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('buyer_master').select('id,name'),
      supabase.from('supplier_master').select('id,name'),
      supabase.from('companies').select('id,name'),
      supabase.from('count_master').select('*'),
      supabase.from('payment_terms').select('*'),
      supabase.from('job_processes').select('*').order('name'),
      supabase.from('transporters').select('*').order('name'),
      supabase.from('profiles').select('id,name').eq('is_active', true).order('name'),
      supabase.from('sales_confirmations').select('id,sc_no'),
      supabase.from('order_dispatches').select('*').order('created_at'),
      supabase.from('order_dispatch_adjustments').select('*').order('created_at'),
    ])
    setDispatches((dd.data ?? []) as OrderDispatch[])
    setAdjustments((aa.data ?? []) as OrderAdjustment[])
    if (o.error) setBanner({ kind: 'bad', text: errMessage(o.error, 'Could not load Dispatch and Billing') })
    setRows((o.data ?? []) as Order[])
    setBuyers((b.data ?? []) as Named[])
    setSuppliers((s.data ?? []) as Named[])
    setCompanies((c.data ?? []) as Named[])
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
      if (hit) setDetails(hit)
      setParams({}, { replace: true })
    }
  }, [openId, rows, setParams])

  // the sub-items of an item: its dispatch, cancel and return entries in the order they were made
  const subsByOrder = useMemo(() => {
    const m = new Map<string, SubEntry[]>()
    const push = (id: string, e: SubEntry) => m.set(id, [...(m.get(id) ?? []), e])
    const qtyOf = new Map((rows ?? []).map((o) => [o.id, o.quantity]))
    const running = new Map<string, number>()
    for (const d of dispatches) {
      const total = (running.get(d.order_id) ?? 0) + d.quantity
      running.set(d.order_id, total)
      // the entry that brings dispatched + cancelled up to the quantity is the Fully Dispatch one
      const cancelledBy = adjustments.filter((a) => a.order_id === d.order_id && a.kind === 'cancel' && a.created_at <= d.created_at).reduce((n, a) => n + a.quantity, 0)
      push(d.order_id, { id: d.id, at: d.created_at, no: d.dispatch_no, status: total + cancelledBy >= (qtyOf.get(d.order_id) ?? Infinity) ? 'full' : 'partial', qty: d.quantity, date: d.dispatch_date, invoiceNo: d.invoice_no, invoiceDate: d.invoice_date, d })
    }
    for (const a of adjustments) push(a.order_id, { id: a.id, at: a.created_at, no: a.entry_no, status: a.kind, qty: a.quantity, date: a.entry_date, invoiceNo: a.invoice_no, invoiceDate: a.invoice_date, d: null })
    for (const list of m.values()) list.sort((x, y) => x.at.localeCompare(y.at))
    return m
  }, [dispatches, adjustments, rows])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(
      (x) =>
        (!statusFilter || dnbGroup(x) === statusFilter) &&
        (!ownerFilter || x.person_id === ownerFilter) &&
        (!q ||
        x.order_no.toLowerCase().includes(q) ||
        (x.invoice_no ?? '').toLowerCase().includes(q) ||
        x.order_date.includes(q) ||
        (scs.get(x.sales_confirmation_id) ?? '').toLowerCase().includes(q) ||
        (buyerName.get(x.buyer_id) ?? '').toLowerCase().includes(q) ||
        (supplierName.get(x.supplier_id) ?? '').toLowerCase().includes(q) ||
        (countName.get(x.count_id) ?? '').toLowerCase().includes(q) ||
        (x.vehicle_no ?? '').toLowerCase().includes(q)),
    )
  }, [rows, search, statusFilter, ownerFilter, scs, buyerName, supplierName, countName])

  async function startDispatch(x: Order) {
    setBanner(null)
    const { data, error } = await supabase.from('orders').update({ status: 'open_for_execution' }).eq('id', x.id).select('id')
    if (error || !data || data.length === 0) return setBanner({ kind: 'bad', text: error ? errMessage(error, 'Could not start dispatch') : 'Your account cannot change this item.' })
    setBanner({ kind: 'ok', text: `${x.order_no}: dispatch started.` })
    await load()
  }

  async function cancelItem() {
    if (!cancelling) return
    setCancelBusy(true)
    setCancelError(null)
    const { data, error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', cancelling.id).select('id')
    setCancelBusy(false)
    if (error || !data || data.length === 0) return setCancelError(error ? errMessage(error, 'Could not cancel this item') : 'Your account cannot change this item.')
    setBanner({ kind: 'ok', text: `${cancelling.order_no} cancelled.` })
    setCancelling(null)
    await load()
  }

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
  const lockedIds = new Set(rows.filter((x) => x.status === 'closed' || x.status === 'cancelled').map((x) => x.id))
  /** Row Actions, in the Pharma ERP order: read, edit, status moves, destructive last.
   *  An item that cannot be used stays visible with the reason. */
  function actionsFor(x: Order): RowAction[] {
    const list: RowAction[] = [{ label: 'View details', onSelect: () => setDetails(x) }]
    const cancelled = x.status === 'cancelled'
    const closed = x.status === 'closed'
    const started = x.status === 'open_for_execution' || closed
    list.push({
      label: 'Edit',
      onSelect: () => setFormFor(x),
      disabledReason: !canManage ? 'You need the "Create and manage orders" permission.' : cancelled ? 'A cancelled item cannot be changed.' : closed ? 'A closed item cannot be changed.' : null,
    })
    if (canManage && !started && !cancelled) list.push({ label: 'Start dispatch', onSelect: () => void startDispatch(x) })
    list.push({ label: 'Go to Sales Confirmation', onSelect: () => navigate(`/sales-confirmations?open=${x.sales_confirmation_id}`) })
    list.push({
      label: 'Cancel item',
      tone: 'danger',
      onSelect: () => { setCancelError(null); setCancelling(x) },
      disabledReason: !canManage ? 'You need the "Create and manage orders" permission.' : cancelled ? 'It is already cancelled.' : closed ? 'A closed item cannot be cancelled.' : x.dispatched_qty > 0 ? 'Dispatches are already recorded against it.' : null,
    })
    return list
  }
  const jobName = new Map(jobs.map((j) => [j.id, j.name]))
  const basisLabel = (b: string | null) => COMM_BASES.find((x) => x.value === b)?.label ?? null
  const money = (v: number | null) => <span className="mono">{inr(v, 0)}</span>
  // Columns: monday's Dispatch and Billing columns (the document does not cover this board), without the party lookups.
  const columns: BoardColumn<Order>[] = [
    { key: 'no', label: 'Item', width: 130, render: (x) => <span className="mono">{x.order_no}</span> },
    { key: 'srno', hidden: true, label: 'Sr. No', render: (x) => cell(x.sr_no, { mono: true }) },
    { key: 'status', label: 'Status', width: 170, interactive: true, render: (x) => {
      const st = dispatchStatus(x.dispatch_status)
      const open = x.status === 'open_for_execution'
      const draft = x.status === 'draft' || x.status === 'confirmed'
      // as on monday: choosing a status adds a sub-item (a dispatch, cancel or return entry) and moves the item on
      const left = x.returned_qty > 0 ? 0 : Math.max(x.quantity - x.dispatched_qty - x.cancelled_qty, 0)
      const options = !canManage ? [] : [
        ...((open || draft) && left > 0 ? [{ value: 'partial', label: 'Partially Dispatch', tone: 'green' }] : []),
        ...((open || draft) && left > 0 ? [{ value: 'full', label: 'Fully Dispatch', tone: 'blue' }] : []),
        ...(open && left > 0 ? [{ value: 'cancel', label: 'Cancel', tone: 'orange' }] : []),
        ...(open && x.dispatched_qty - x.returned_qty > 0 ? [{ value: 'return', label: 'Return', tone: 'red' }] : []),
      ]
      return <StatusPicker current={{ value: st.value, label: st.label, tone: st.tone }} options={options} onPick={(v) => setSubFor({ order: x, kind: v as SubKind })} />
    } },
    { key: 'inv', label: 'Invoice No.', render: (x) => (x.is_duplicate ? <span className="mono small field-warn" title={x.duplication_error ?? ''}>{x.invoice_no} · duplicate</span> : cell(x.invoice_no, { mono: true })) },
    { key: 'invdate', hidden: true, label: 'Invoice Date', render: (x) => cell(x.invoice_date) },
    { key: 'created', label: 'Created Date', render: (x) => cell(formatShortDate(x.created_at)) },
    { key: 'sc', label: 'Sales Confirmation', interactive: true, render: (x) => <Link className="mono small" to={`/sales-confirmations?open=${x.sales_confirmation_id}`}>{scs.get(x.sales_confirmation_id) ?? '—'}</Link> },
    { key: 'buyer', label: 'Buyer', render: (x) => <strong>{buyerName.get(x.buyer_id) ?? '—'}</strong> },
    { key: 'bctype', hidden: true, label: 'Buyer Commission Type', render: (x) => cell(basisLabel(x.buyer_comm_basis)) },
    { key: 'bcval', hidden: true, label: 'Buyer Commission Value', align: 'right', render: (x) => cell(x.buyer_comm_value, { mono: true }) },
    { key: 'supplier', label: 'Supplier', render: (x) => supplierName.get(x.supplier_id) ?? '—' },
    { key: 'sctype', hidden: true, label: 'Supplier Commission Type', render: (x) => cell(basisLabel(x.supplier_comm_basis)) },
    { key: 'scval', hidden: true, label: 'Supplier Commission Value', align: 'right', render: (x) => cell(x.supplier_comm_value, { mono: true }) },
    { key: 'delivery', hidden: true, label: 'Sizing/Delivery Address', render: (x) => cell(x.job_process_id ? jobName.get(x.job_process_id) : x.alt_delivery_address, { clip: true }) },
    { key: 'qty', label: 'Quantity', align: 'right', render: (x) => <span>{inr(x.quantity)} {uomLabel(x.uom)}</span> },
    { key: 'transporter', hidden: true, label: 'Transporter Name', render: (x) => cell(x.transporter_id ? transporterName.get(x.transporter_id) : null) },
    { key: 'vehicle', hidden: true, label: 'Vehicle Number', render: (x) => cell(x.vehicle_no, { mono: true }) },
    { key: 'driver', hidden: true, label: 'Driver Contact Phone', render: (x) => cell(x.driver_phone, { mono: true }) },
    { key: 'schedule', hidden: true, label: 'Delivery Schedule', render: (x) => cell(x.delivery_schedule, { clip: true }) },
    { key: 'count', label: 'Counts', render: (x) => cell(countName.get(x.count_id)) },
    { key: 'rate', label: 'Final Rate', align: 'right', render: (x) => (x.final_rate === null ? cell(null) : <span>₹{rateText(x.final_rate)}</span>) },
    { key: 'bag', hidden: true, label: 'Bags Weight', align: 'right', render: (x) => cell(x.bag_weight, { mono: true }) },
    { key: 'weight', hidden: true, label: 'Total Weight', align: 'right', render: (x) => cell(x.total_weight, { mono: true }) },
    { key: 'value', label: 'Value', align: 'right', render: (x) => money(x.order_value), total: sum((r) => r.order_value) },
    { key: 'bcomm', hidden: true, label: 'Buyer Commission', align: 'right', render: (x) => money(x.buyer_commission), total: sum((r) => r.buyer_commission) },
    { key: 'scomm', hidden: true, label: 'Supplier Commission', align: 'right', render: (x) => money(x.supplier_commission), total: sum((r) => r.supplier_commission) },
    { key: 'cgst', hidden: true, label: 'CGST', align: 'right', render: (x) => cell(x.cgst_pct, { mono: true }) },
    { key: 'ins', hidden: true, label: 'Insurance Tax', align: 'right', render: (x) => cell(x.insurance_pct, { mono: true }) },
    { key: 'add', hidden: true, label: 'Add', align: 'right', render: (x) => cell(x.add_amount, { mono: true }) },
    { key: 'deduct', hidden: true, label: 'Deduct', align: 'right', render: (x) => cell(x.deduct_amount, { mono: true }) },
    { key: 'total', hidden: true, label: 'Total Amount', align: 'right', render: (x) => money(x.total_amount), total: sum((r) => r.total_amount) },
    { key: 'round', hidden: true, label: 'Round off', align: 'right', render: (x) => cell(x.round_off, { mono: true }) },
    { key: 'dispatched', label: 'Quantity Dispatched', render: (x) => <Progress done={x.dispatched_qty} total={x.quantity} uom={x.uom} /> },
    { key: 'cancelled', hidden: true, label: 'Quantity Cancelled', align: 'right', render: (x) => cell(x.cancelled_qty > 0 ? x.cancelled_qty : null, { mono: true }) },
    { key: 'remark', hidden: true, label: 'Remark 1', render: (x) => cell(x.special_instructions, { clip: true }) },
    { key: 'dispatch-date', hidden: true, label: 'Dispatch Date', render: (x) => cell(x.tentative_dispatch_date) },
    { key: 'person', label: 'Person', render: (x) => <PersonCell name={x.person_id ? personName.get(x.person_id) : undefined} /> },
    { key: 'transport', hidden: true, label: 'Transport Type', render: (x) => cell(x.transport_type ? transportTypeLabel(x.transport_type) : null) },
    { key: 'action', label: 'Actions', interactive: true, pinRight: true, render: (x) => <RowActionMenu label={`Actions for ${x.order_no}`} actions={actionsFor(x)} /> },
  ]

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dispatch and Billing</h1>
          <p className="page-sub">One item per Sales Confirmation. Add the billing and transport, then record each dispatch.</p>
        </div>
      </header>

      <BoardTabs
        tabs={[
          { key: 'table', label: 'Main table' },
          { key: 'duplicates', label: `Duplicate Checks${rows.some((x) => x.is_duplicate) ? ` (${rows.filter((x) => x.is_duplicate).length})` : ''}` },
        ]}
        active={tab}
        onChange={(k) => setTab(k as 'table' | 'duplicates')}
      />

      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}{' '}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      {(tab === 'table' || tab === 'duplicates') && (<>
      <div className="board-toolbar">
        <ViewSwitch view={view} onChange={setView} />
        <input className="toolbar-search" aria-label="Search items" placeholder="Search item, invoice, SC, buyer, supplier, vehicle" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {DNB_GROUPS.map((g) => (<option key={g.value} value={g.value}>{g.label}</option>))}
        </select>
        <select aria-label="Owner" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="">All owners</option>
          {me && <option value={me.id}>My items</option>}
          {people.filter((p) => p.id !== me?.id).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <button className="btn sm" type="button" disabled={shown.length === 0} onClick={exportCSV}>
          <DownloadIcon />Export {shown.length === rows.length ? 'all' : `${shown.length} shown`}
        </button>
        <span className="push" />
        <div className="board-cols-slot">
          {canManage && (
            <button className="btn primary" type="button" onClick={() => setFormFor('new')}>
              + New item
            </button>
          )}
        </div>
      </div>

      <Board
        rows={tab === 'duplicates' ? shown.filter((x) => x.is_duplicate) : shown}
        groups={DNB_GROUPS}
        groupOf={dnbGroup}
        columns={columns}
        rowKey={(x) => x.id}
        viewKey="orders"
        onOpen={(x) => setDetails(x)}
        rowOpens={false}
        expandable={{
          count: (x) => subsByOrder.get(x.id)?.length ?? 0,
          subRows: (x) => (subsByOrder.get(x.id) ?? []).map((e) => ({ key: e.id, cell: (col) => subCell(x, e, col.key, { buyer: buyerName.get(x.buyer_id) ?? '—', supplier: supplierName.get(x.supplier_id) ?? '—', count: countName.get(x.count_id) ?? '—', transporter: x.transporter_id ? transporterName.get(x.transporter_id) ?? '—' : '—', people: personName }) })),
        }}
        view={view}
        emptyText={tab === 'duplicates' ? 'No duplicate invoice numbers.' : rows.length === 0 ? 'Nothing yet. Open a complete Sales Confirmation and choose “Create Dispatch and Billing”.' : 'No item matches.'}
        card={(x) => (
          <>
            <span className="kcard-top">
              <span className="mono small">{x.order_no}</span>
              <span className="mono small muted">{scs.get(x.sales_confirmation_id) ?? ''}</span>
              <RowActionMenu label={`Actions for ${x.order_no}`} actions={actionsFor(x)} />
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
      </>)}

      {formFor && (
        <OrderFormModal
          orders={rows}
          lockedIds={lockedIds}
          scNos={scs}
          buyerName={buyerName}
          supplierName={supplierName}
          countName={countName}
          counts={counts}
          jobs={jobs}
          transporters={transporters}
          people={people}
          initialOrder={formFor === 'new' ? null : formFor}
          onRefresh={load}
          onClose={() => setFormFor(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setFormFor(null)
            setTab('table')
            await load()
          }}
        />
      )}

      {subFor && (
        <SubitemDialog
          order={subFor.order}
          kind={subFor.kind}
          onClose={() => setSubFor(null)}
          onDone={async (text) => { setSubFor(null); setBanner({ kind: 'ok', text }); await load() }}
        />
      )}

      {details && (
        <OrderFormModal
          key={`view-${details.id}`}
          readOnly
          orders={rows}
          lockedIds={lockedIds}
          scNos={scs}
          buyerName={buyerName}
          supplierName={supplierName}
          countName={countName}
          counts={counts}
          jobs={jobs}
          transporters={transporters}
          people={people}
          initialOrder={rows.find((x) => x.id === details.id) ?? details}
          onRefresh={load}
          onEdit={(x) => { setDetails(null); setFormFor(x) }}
          onClose={() => setDetails(null)}
          onDone={async () => { setDetails(null) }}
        />
      )}

      {cancelling && (
        <ConfirmDialog title={`Cancel ${cancelling.order_no}?`} confirmLabel="Cancel item" busy={cancelBusy} error={cancelError} onConfirm={() => void cancelItem()} onClose={() => setCancelling(null)}>
          Its Sales Confirmation can then be cancelled or used again. This cannot be undone.
        </ConfirmDialog>
      )}
    </>
  )
}

type SubEntry = { id: string; at: string; no: string | null; status: 'partial' | 'full' | 'cancel' | 'return'; qty: number; date: string | null; invoiceNo: string | null; invoiceDate: string | null; d: OrderDispatch | null }

/** One sub-item (a dispatch, cancel or return entry) under the board's own columns: the entry's figures where it has
 *  them, the item's buyer, supplier, count and rate in grey, and nothing where a column does not apply to an entry. */
function subCell(o: Order, e: SubEntry, key: string, ctx: SubCtx): ReactNode {
  const d = e.d
  const faint = (v: ReactNode) => <span className="faint">{v}</span>
  const mono = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : <span className="mono">{v}</span>)
  const num = (v: number | null | undefined, dp = 2) => (v === null || v === undefined ? null : <span className="mono">{inr(v, dp)}</span>)
  switch (key) {
    case 'no': return <span className="sub-no mono">{e.no ?? '—'}</span>
    case 'status': return <span className={`entry-status ${e.status}`}>{SUB_LABEL[e.status]}</span>
    case 'inv': return mono(e.invoiceNo)
    case 'invdate': return e.invoiceDate ? formatShortDate(e.invoiceDate) : null
    case 'created': return e.date ? formatShortDate(e.date) : null
    case 'buyer': return faint(ctx.buyer)
    case 'supplier': return faint(ctx.supplier)
    case 'count': return faint(ctx.count)
    case 'qty': return <span>{inr(e.qty)} {uomLabel(o.uom)}</span>
    case 'rate': return o.final_rate === null ? null : faint(`₹${rateText(o.final_rate)}`)
    case 'bag': return d ? num(o.bag_weight) : null
    case 'weight': return d ? num(d.total_weight) : null
    case 'value': return d ? num(d.entry_value, 0) : null
    case 'bcomm': return d ? num(d.buyer_commission, 0) : null
    case 'scomm': return d ? num(d.supplier_commission, 0) : null
    case 'cgst': return d ? num(d.cgst_pct) : null
    case 'ins': return d ? num(d.insurance_pct) : null
    case 'add': return d ? num(d.add_amount) : null
    case 'deduct': return d ? num(d.deduct_amount) : null
    case 'total': return d ? num(d.total_amount, 0) : null
    case 'round': return d ? num(d.round_off) : null
    case 'transporter': return d && o.transporter_id ? faint(ctx.transporter) : null
    case 'vehicle': return d ? mono(d.vehicle_no) : null
    case 'remark': return d ? d.remarks : null
    case 'dispatch-date': return d ? formatShortDate(d.dispatch_date) : null
    case 'transport': return d?.transport_type ? transportTypeLabel(d.transport_type) : null
    case 'person': return d?.person_id ? <PersonCell name={ctx.people.get(d.person_id)} /> : null
    default: return null
  }
}
type SubCtx = { buyer: string; supplier: string; count: string; transporter: string; people: Map<string, string> }

function Progress({ done, total, uom }: { done: number; total: number; uom: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <span className="progress" title={`${inr(done)} of ${inr(total)} ${uomLabel(uom)}`}>
      <span className="progress-bar"><span style={{ width: `${pct}%` }} /></span>
      <span className="mono small">{inr(done)}/{inr(total)} {uomLabel(uom)}</span>
    </span>
  )
}
