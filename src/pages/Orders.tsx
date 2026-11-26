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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { tripsLinkedToRecords } from '../lib/boards'
import type { CountRow, JobProcess, Order, PaymentTerm, Transporter } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { OrderDetails } from '../components/OrderDetails'
import { OrderFormModal } from '../components/OrderFormModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RowActionMenu, type RowAction } from '../components/RowActionMenu'
import { BoardTabs } from '../components/board/BoardTabs'
import { Avatar, Board, DownloadIcon, StatusPill, ViewSwitch, useStoredState, type BoardColumn } from '../components/board/Board'
import { cell } from '../components/board/mirrors'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'
import {
  COMM_BASES, DNB_GROUPS, dnbGroup, dispatchStatus, inr, saleTypeLabel, transportTypeLabel, uomLabel,
} from '../lib/deals'

type Named = { id: string; name: string }
type ScRef = { id: string; sc_no: string }

const CSV_COLUMNS = [
  'order_no', 'status', 'sales_confirmation', 'invoice_no', 'invoice_date', 'buyer', 'supplier', 'count', 'quantity', 'dispatched_qty', 'uom',
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
  const [companies, setCompanies] = useState<Named[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [jobs, setJobs] = useState<JobProcess[]>([])
  const [transporters, setTransporters] = useState<Transporter[]>([])
  const [people, setPeople] = useState<Named[]>([])
  const [scs, setScs] = useState<Map<string, string>>(new Map())
  // Transporter Type Details rows linked to each item (the other end of the trip's link)
  const [trips, setTrips] = useState<Map<string, string[]>>(new Map())
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

  const load = useCallback(async () => {
    const [o, b, s, c, k, t, j, tr, p, sc] = await Promise.all([
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
    ])
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
    try {
      setTrips((await tripsLinkedToRecords()).byOrder)
    } catch {
      setTrips(new Map())
    }
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
    { key: 'status', label: 'Status', width: 170, render: (x) => <StatusPill label={dispatchStatus(x.dispatch_status).label} tone={dispatchStatus(x.dispatch_status).tone} /> },
    { key: 'inv', label: 'Invoice No.', render: (x) => (x.is_duplicate ? <span className="mono small field-warn" title={x.duplication_error ?? ''}>{x.invoice_no} · duplicate</span> : cell(x.invoice_no, { mono: true })) },
    { key: 'invdate', label: 'Invoice Date', render: (x) => cell(x.invoice_date) },
    { key: 'created', label: 'Created Date', render: (x) => cell(x.created_at.slice(0, 10)) },
    { key: 'sc', label: 'Sales Confirmation', interactive: true, render: (x) => <Link className="mono small" to={`/sales-confirmations?open=${x.sales_confirmation_id}`}>{scs.get(x.sales_confirmation_id) ?? '—'}</Link> },
    { key: 'buyer', label: 'Buyer', render: (x) => <strong>{buyerName.get(x.buyer_id) ?? '—'}</strong> },
    { key: 'bctype', label: 'Buyer Commission Type', render: (x) => cell(basisLabel(x.buyer_comm_basis)) },
    { key: 'bcval', label: 'Buyer Commission Value', align: 'right', render: (x) => cell(x.buyer_comm_value, { mono: true }) },
    { key: 'supplier', label: 'Supplier', render: (x) => supplierName.get(x.supplier_id) ?? '—' },
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
    {
      key: 'ttd',
      label: 'Transporter Type Details',
      interactive: true,
      render: (x) => (trips.get(x.id)?.length ? <Link className="mono small" to="/transporter-type-details">{trips.get(x.id)!.join(', ')}</Link> : cell(null)),
    },
    { key: 'action', label: 'Actions', interactive: true, pinRight: true, render: (x) => <RowActionMenu label={`Actions for ${x.order_no}`} actions={actionsFor(x)} /> },
  ]

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dispatch and Billing</h1>
          <p className="page-sub">One item per Sales Confirmation. Add the billing and transport, then record each dispatch.</p>
        </div>
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setFormFor('new')}>
            + New item
          </button>
        )}
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
      </div>

      <Board
        rows={tab === 'duplicates' ? shown.filter((x) => x.is_duplicate) : shown}
        groups={DNB_GROUPS}
        groupOf={dnbGroup}
        columns={columns}
        rowKey={(x) => x.id}
        onOpen={(x) => setDetails(x)}
        rowOpens={false}
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
          onClose={() => setFormFor(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setFormFor(null)
            setTab('table')
            await load()
          }}
        />
      )}

      {details && (
        <OrderDetails
          key={details.id}
          order={rows.find((x) => x.id === details.id) ?? details}
          canManage={canManage}
          scNo={scs.get(details.sales_confirmation_id) ?? ''}
          names={{
            buyer: buyerName.get(details.buyer_id) ?? '—',
            supplier: supplierName.get(details.supplier_id) ?? '—',
            company: companies.find((c) => c.id === details.company_id)?.name ?? '—',
            term: terms.find((t) => t.id === details.payment_term_id)?.name ?? '—',
          }}
          count={counts.find((c) => c.id === details.count_id) ?? null}
          jobs={jobs}
          transporters={transporters}
          people={people}
          onClose={() => setDetails(null)}
          onEdit={(x) => { setDetails(null); setFormFor(x) }}
          onRefresh={load}
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

function Progress({ done, total, uom }: { done: number; total: number; uom: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <span className="progress" title={`${inr(done)} of ${inr(total)} ${uomLabel(uom)}`}>
      <span className="progress-bar"><span style={{ width: `${pct}%` }} /></span>
      <span className="mono small">{inr(done)}/{inr(total)} {uomLabel(uom)}</span>
    </span>
  )
}
