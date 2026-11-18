/** Sales Confirmation board, modelled on the monday.com "Sales Confirmation" board.
 *
 *  Pipeline: Draft -> Send -> Send with Delivery Info (Cancelled kept apart).
 *  The status moves on by itself when the confirmation is sent to a party
 *  ("Send"), or "Send with Delivery Info" when the transport details are in.
 *  It can also be set by hand from the status label.
 *
 *  The number and date/time come from the database and never change. A
 *  confirmation is complete when both parties and their companies, the count,
 *  quantity, UOM, freight and (for bags) the bag weight are in; only then can it
 *  be sent or turned into a Dispatch and Billing item. No messaging provider is
 *  connected yet, so a send opens the prefilled WhatsApp chat / email and the
 *  screen records it (see lib/integrations.ts). */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { CountRow, JobProcess, PaymentTerm, Transporter } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { useSelection } from '../components/ListTools'
import { Board, StatusPicker, ViewSwitch, useStoredState, type BoardColumn } from '../components/board/Board'
import { MIRROR_PARTY_COLS, cell } from '../components/board/mirrors'
import { bulkDelete, deleteSummary } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'
import { formatDateTime } from '../lib/format'
import { SC_GROUPS, SC_STAGES, dispatchStatus, inr, rateText, saleTypeLabel, scGroup, scStage, uomLabel } from '../lib/deals'
import { ConfirmationDrawer } from '../components/sc/ConfirmationDrawer'
import { BulkSendDrawer } from '../components/sc/BulkSendDrawer'
import { ScReports } from '../components/sc/ScReports'
import { BoardTabs } from '../components/board/BoardTabs'
import type { Company, Party, ScRow } from '../components/sc/scShared'

const CSV_COLUMNS = [
  'sc_no', 'confirmed_at', 'stage', 'sale_type', 'supplier', 'buyer', 'count', 'quantity', 'uom', 'bag_weight', 'total_weight', 'rate', 'sc_value',
  'freight', 'price_basis', 'delivery_to', 'transporter', 'vehicle_no', 'delivery_schedule', 'execution_status', 'dispatch_billing', 'remarks',
] as const

export type ScItem = { id: string; order_no: string; dispatch_status: string; sales_confirmation_id: string }
type ScLineRow = { sc_id: string; line_no: number; count_id: string; quantity: number; uom: string; bag_weight: number | null; rate: number | null }

export default function SalesConfirmations() {
  const { can } = useAuth()
  const canManage = can('sc.manage')
  const canRead = canManage || can('sc.read')
  const canOrder = can('order.manage')
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<ScRow[] | null>(null)
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [buyers, setBuyers] = useState<Party[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [transporters, setTransporters] = useState<Transporter[]>([])
  const [jobs, setJobs] = useState<JobProcess[]>([])
  const [items, setItems] = useState<Map<string, ScItem[]>>(new Map())
  const [scLines, setScLines] = useState<Map<string, ScLineRow[]>>(new Map())
  const [editing, setEditing] = useState<ScRow | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'table' | 'reports'>('table')
  const [view, setView] = useStoredState<'table' | 'kanban'>('sc.view', 'table')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [exec, setExec] = useState<Map<string, { exec_status: string; dispatched_qty: number }>>(new Map())
  const [bulk, setBulk] = useState(false)
  const [dealNos, setDealNos] = useState<Map<string, string>>(new Map())

  const load = useCallback(async () => {
    const [r, s, b, c, k, t, ex, tr, jp, o, dl, ln] = await Promise.all([
      supabase.from('sales_confirmations').select('*').order('confirmed_at', { ascending: false }),
      supabase.from('supplier_master').select(MIRROR_PARTY_COLS).order('name'),
      supabase.from('buyer_master').select(MIRROR_PARTY_COLS).order('name'),
      supabase.from('companies').select('id,name,is_active,phone_1,mobile').order('name'),
      supabase.from('count_master').select('*').order('count_no').order('display_name'),
      supabase.from('payment_terms').select('*').order('name'),
      supabase.rpc('sc_execution_statuses'),
      supabase.from('transporters').select('*').order('name'),
      supabase.from('job_processes').select('*').order('name'),
      supabase.from('orders').select('id,order_no,dispatch_status,sales_confirmation_id').neq('status', 'cancelled'),
      supabase.from('crm_deals').select('id,deal_no'),
      supabase.from('sc_lines').select('sc_id,line_no,count_id,quantity,uom,bag_weight,rate').order('line_no'),
    ])
    setDealNos(new Map(((dl.data ?? []) as { id: string; deal_no: string }[]).map((x) => [x.id, x.deal_no])))
    setExec(new Map(((ex.data ?? []) as { sc_id: string; exec_status: string; dispatched_qty: number }[]).map((x) => [x.sc_id, x])))
    if (r.error) setBanner({ kind: 'bad', text: errMessage(r.error, 'Could not load sales confirmations') })
    setRows((r.data ?? []) as ScRow[])
    setSuppliers((s.data ?? []) as Party[])
    setBuyers((b.data ?? []) as Party[])
    setCompanies((c.data ?? []) as Company[])
    setCounts((k.data ?? []) as CountRow[])
    setTerms((t.data ?? []) as PaymentTerm[])
    setTransporters((tr.data ?? []) as Transporter[])
    setJobs((jp.data ?? []) as JobProcess[])
    const bySc = new Map<string, ScItem[]>()
    for (const x of (o.data ?? []) as ScItem[]) bySc.set(x.sales_confirmation_id, [...(bySc.get(x.sales_confirmation_id) ?? []), x])
    setItems(bySc)
    const lineMap = new Map<string, ScLineRow[]>()
    for (const r of (ln.data ?? []) as ScLineRow[]) lineMap.set(r.sc_id, [...(lineMap.get(r.sc_id) ?? []), r])
    setScLines(lineMap)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  // /sales-confirmations?open=<id> from a deal or global search
  const openId = params.get('open')
  useEffect(() => {
    if (!openId || !rows) return
    const found = rows.find((x) => x.id === openId)
    if (found) setEditing(found)
    setParams({}, { replace: true })
  }, [openId, rows, setParams])

  const nm = (list: { id: string; name: string }[]) => new Map(list.map((x) => [x.id, x.name]))
  const supplierName = useMemo(() => nm(suppliers), [suppliers])
  const buyerName = useMemo(() => nm(buyers), [buyers])
  const countName = useMemo(() => new Map(counts.map((x) => [x.id, x.display_name])), [counts])
  const transporterName = useMemo(() => nm(transporters), [transporters])
  const jobName = useMemo(() => nm(jobs), [jobs])
  const termNameMap = useMemo(() => nm(terms), [terms])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(
      (x) =>
        (!q ||
          x.sc_no.toLowerCase().includes(q) ||
          (x.supplier_id ? supplierName.get(x.supplier_id) ?? '' : '').toLowerCase().includes(q) ||
          (x.buyer_id ? buyerName.get(x.buyer_id) ?? '' : '').toLowerCase().includes(q) ||
          (x.count_id ? countName.get(x.count_id) ?? '' : '').toLowerCase().includes(q) ||
          (scLines.get(x.id) ?? []).some((l) => (countName.get(l.count_id) ?? '').toLowerCase().includes(q)) ||
          (x.payment_term_id ? termNameMap.get(x.payment_term_id) ?? '' : '').toLowerCase().includes(q) ||
          (x.vehicle_no ?? '').toLowerCase().includes(q)),
    )
  }, [rows, search, supplierName, buyerName, countName, termNameMap, scLines])

  const selection = useSelection(useMemo(() => shown.map((x) => x.id), [shown]))

  async function setStage(sc: ScRow, stage: string) {
    setBanner(null)
    if (stage === 'cancelled') {
      const { error } = await supabase.rpc('cancel_sales_confirmation', { p_sc: sc.id })
      if (error) return setBanner({ kind: 'bad', text: errMessage(error, 'Could not cancel this confirmation') })
      setBanner({ kind: 'ok', text: `${sc.sc_no} cancelled.` })
    } else {
      const { data, error } = await supabase.from('sales_confirmations').update({ stage }).eq('id', sc.id).select('id')
      if (error || !data || data.length === 0) return setBanner({ kind: 'bad', text: error ? errMessage(error, 'Could not change the status') : 'Your account cannot change this confirmation.' })
      setBanner({ kind: 'ok', text: `${sc.sc_no} is now ${scStage(stage).label}.` })
    }
    await load()
  }

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    const names = new Map((rows ?? []).map((x) => [x.id, x.sc_no]))
    const result = await bulkDelete('sales_confirmations', selection.chosen)
    setBanner(deleteSummary('confirmation', 'confirmations', result, (id) => names.get(id) ?? id))
    selection.clear()
    setConfirmDelete(false)
    await load()
    setBusy(false)
  }

  function exportCSV() {
    const list = (selection.chosen.length > 0 ? shown.filter((x) => selection.isSelected(x.id)) : shown).map((x) => ({
      ...x,
      stage: scStage(scGroup(x)).label,
      sale_type: saleTypeLabel(x.sale_type),
      supplier: x.supplier_id ? supplierName.get(x.supplier_id) ?? '' : '',
      buyer: x.buyer_id ? buyerName.get(x.buyer_id) ?? '' : '',
      count: x.count_id ? countName.get(x.count_id) ?? '' : '',
      uom: uomLabel(x.uom),
      delivery_to: x.job_process_id ? jobName.get(x.job_process_id) ?? '' : x.delivery_address ?? '',
      transporter: x.transporter_id ? transporterName.get(x.transporter_id) ?? '' : '',
      execution_status: exec.get(x.id)?.exec_status ?? '',
      dispatch_billing: (items.get(x.id) ?? []).map((i) => i.order_no).join(' '),
    }))
    downloadCSV(`sales-confirmations-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!canRead) return <div className="card pad narrow-card">Your account does not have access to sales confirmations.</div>
  if (!rows) return <Loading label="Loading sales confirmations" />

  const stageOptions = (x: ScRow) => {
    if (!canManage || x.status === 'cancelled') return []
    const opts = SC_STAGES.filter((s) => s.value !== x.stage && s.value !== 'cancelled')
      .filter((s) => s.value === 'draft' || x.status === 'confirmed')
      .filter((s) => s.value !== 'send_delivery' || !!(x.transporter_id || x.vehicle_no))
    const canCancel = !(items.get(x.id)?.length) && !(exec.get(x.id)?.dispatched_qty)
    return canCancel && x.status !== 'draft' ? [...opts, scStage('cancelled')] : opts
  }

  const termName = new Map(terms.map((t) => [t.id, t.name]))
  const rowsOf = (x: ScRow): ScLineRow[] => scLines.get(x.id)
    ?? (x.count_id && x.quantity !== null ? [{ sc_id: x.id, line_no: 1, count_id: x.count_id, quantity: x.quantity, uom: x.uom, bag_weight: x.bag_weight, rate: x.rate }] : [])
  const perLine = (x: ScRow, show: (r: ScLineRow) => ReactNode) => {
    const rows = rowsOf(x)
    return rows.length === 0 ? cell(null) : <span className="lines-list">{rows.map((r) => <span key={r.line_no}>{show(r)}</span>)}</span>
  }
  const sentCell = (at: string | null) => (at ? <span className="chip good small">Sent {formatDateTime(at)}</span> : <span className="muted small">Not sent</span>)
  // Columns: the confirmation fields in the lead's "Changes needed" document.
  const columns: BoardColumn<ScRow>[] = [
    { key: 'no', label: 'Confirmation No', width: 150, render: (x) => <span className="mono">{x.sc_no}</span> },
    {
      key: 'stage', label: 'Status', width: 190, interactive: true,
      render: (x) => <StatusPicker current={scStage(scGroup(x))} options={stageOptions(x)} onPick={(s) => void setStage(x, s)} />,
    },
    { key: 'date', label: 'Created Date', render: (x) => cell(formatDateTime(x.confirmed_at)) },
    {
      key: 'deal', label: 'Link to Deal', interactive: true,
      render: (x) => (x.deal_id ? <Link className="mono small" to={`/deals?open=${x.deal_id}`}>{dealNos.get(x.deal_id) ?? 'open'}</Link> : cell(null)),
    },
    { key: 'supplier', label: 'Supplier', render: (x) => <strong>{x.supplier_id ? supplierName.get(x.supplier_id) ?? '—' : '—'}</strong> },
    { key: 'buyer', label: 'Buyer', render: (x) => (x.buyer_id ? buyerName.get(x.buyer_id) ?? '—' : '—') },
    { key: 'count', label: 'Count', render: (x) => perLine(x, (r) => cell(countName.get(r.count_id))) },
    { key: 'qty', label: 'Quantity', align: 'right', render: (x) => perLine(x, (r) => cell(r.quantity, { mono: true })) },
    { key: 'uom', label: 'Unit', render: (x) => perLine(x, (r) => cell(uomLabel(r.uom))) },
    { key: 'bag', label: 'Bag Weight', align: 'right', render: (x) => perLine(x, (r) => cell(r.bag_weight, { mono: true })) },
    { key: 'rate', label: 'Final Rate', align: 'right', render: (x) => perLine(x, (r) => <span className="mono">{rateText(r.rate)}</span>) },
    { key: 'terms', label: 'Payment Terms', render: (x) => cell(x.payment_term_id ? termName.get(x.payment_term_id) : null) },
    { key: 'freight', label: 'Freight', render: (x) => cell(x.freight === 'included' ? 'Included' : 'Excluded') },
    { key: 'delivery', label: 'Sizing/Delivery Address', render: (x) => cell(x.job_process_id ? jobName.get(x.job_process_id) : x.delivery_address, { clip: true }) },
    { key: 'transporter', label: 'Transporter Name', render: (x) => cell(x.transporter_id ? transporterName.get(x.transporter_id) : null) },
    { key: 'vehicle', label: 'Vehicle Number', render: (x) => cell(x.vehicle_no, { mono: true }) },
    { key: 'driver', label: 'Driver Contact Phone', render: (x) => cell(x.driver_phone, { mono: true }) },
    { key: 'to-supplier', label: 'Sent to Supplier', render: (x) => sentCell(x.supplier_notified_at) },
    { key: 'to-buyer', label: 'Sent to Buyer', render: (x) => sentCell(x.buyer_notified_at) },
    {
      key: 'dnb', label: 'Dispatch and Billing', interactive: true,
      render: (x) => {
        const list = items.get(x.id) ?? []
        if (list.length === 0) return <span className="muted small">{exec.get(x.id)?.exec_status ?? '—'}</span>
        return (
          <span className="lines-list">
            {list.map((it) => <Link key={it.id} className="small" to={`/orders?open=${it.id}`}>{it.order_no} · {dispatchStatus(it.dispatch_status).label}</Link>)}
          </span>
        )
      },
    },
  ]

  const chosen = selection.chosen.length

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Sales Confirmation</h1>
          <p className="page-sub">Confirmations sent to the supplier on the buyer’s behalf, then again with delivery details.</p>
        </div>
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
            + New confirmation
          </button>
        )}
      </header>

      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}{' '}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      <BoardTabs tabs={[{ key: 'table', label: 'Main table' }, { key: 'reports', label: 'Reports' }]} active={tab} onChange={(k) => setTab(k as 'table' | 'reports')} />

      {tab === 'reports' && (
        <ScReports
          rows={rows}
          lines={scLines}
          buyerName={buyerName}
          supplierName={supplierName}
          countName={countName}
          termName={termNameMap}
          onPick={(text) => {
            setSearch(text)
            setTab('table')
          }}
        />
      )}

      {tab === 'table' && (<>
      <div className="board-toolbar">
        <ViewSwitch view={view} onChange={setView} />
        <input className="toolbar-search" aria-label="Search confirmations" placeholder="Search no., supplier, buyer, count, vehicle" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="push" />
        {canManage && chosen > 0 && (
          <button className="btn primary sm" type="button" onClick={() => setBulk(true)}>Send {chosen} selected</button>
        )}
        {canManage && chosen > 0 && (
          confirmDelete ? (
            <span className="toolbar-confirm">
              <span className="field-warn">Delete {chosen} selected? Only drafts can be deleted.</span>
              <button className="btn danger sm" type="button" disabled={busy} onClick={() => void deleteSelected()}>Yes, delete</button>
              <button className="btn ghost sm" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn sm" type="button" onClick={() => setConfirmDelete(true)}>Delete {chosen} selected</button>
          )
        )}
        <button className="btn sm" type="button" disabled={shown.length === 0} onClick={exportCSV}>
          Export {chosen > 0 ? `${chosen} selected` : shown.length === rows.length ? 'all' : `${shown.length} shown`}
        </button>
      </div>

      <Board
        rows={shown}
        groups={SC_GROUPS}
        groupOf={scGroup}
        columns={columns}
        rowKey={(x) => x.id}
        onOpen={(x) => setEditing(x)}
        view={view}
        selection={canManage && view === 'table' ? selection : undefined}
        emptyText={rows.length === 0 ? 'No sales confirmations yet. Create one from an Approved deal, or start one here.' : 'No confirmation matches.'}
        card={(x) => (
          <>
            <span className="kcard-top">
              <span className="mono small">{x.sc_no}</span>
              <span className="small muted">{saleTypeLabel(x.sale_type)}</span>
            </span>
            <strong className="kcard-title">{x.supplier_id ? supplierName.get(x.supplier_id) ?? '—' : '—'}</strong>
            <span className="small muted">to {x.buyer_id ? buyerName.get(x.buyer_id) ?? '—' : '—'}</span>
            <span className="small">{x.count_id ? countName.get(x.count_id) ?? '' : ''}</span>
            <span className="kcard-foot mono small">
              <span>{x.quantity === null ? '—' : `${inr(x.quantity)} ${uomLabel(x.uom)}`}</span>
              <span>₹{inr(x.sc_value, 0)}</span>
            </span>
          </>
        )}
      />
      </>)}

      {editing && (
        <ConfirmationDrawer
          key={editing === 'new' ? 'new' : editing.id}
          sc={editing === 'new' ? null : editing}
          canManage={canManage}
          canOrder={canOrder}
          items={editing === 'new' ? [] : items.get(editing.id) ?? []}
          suppliers={suppliers}
          buyers={buyers}
          companies={companies}
          counts={counts}
          terms={terms}
          transporters={transporters}
          jobs={jobs}
          onClose={() => setEditing(null)}
          onDone={async (text, keepOpenId) => {
            setBanner({ kind: 'ok', text })
            await load()
            if (keepOpenId) {
              const { data } = await supabase.from('sales_confirmations').select('*').eq('id', keepOpenId).single()
              if (data) {
                setEditing(data as ScRow)
                return
              }
            }
            setEditing(null)
          }}
        />
      )}

      {bulk && (
        <BulkSendDrawer
          rows={(rows ?? []).filter((x) => selection.isSelected(x.id))}
          lineRows={scLines}
          suppliers={suppliers}
          buyers={buyers}
          companies={companies}
          counts={counts}
          terms={terms}
          onClose={() => setBulk(false)}
          onChanged={load}
        />
      )}
    </>
  )
}
