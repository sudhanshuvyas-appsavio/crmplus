/** Deals board, modelled on the monday.com "Deals" board and built like Leads: an Actions column
 *  (view, edit, status moves, delete), a read-only details drawer, and a pop-up form to create or
 *  update a deal.
 *
 *  Pipeline: Draft -> Manager Approval -> Approved | Reconsider | Closed Lost.
 *  A deal is one trade between a buyer and a supplier for a count. It has a
 *  single final rate per kg; each side pays its own commission (Percentage,
 *  per KG or per BAG), copied from the party master and editable here. Weight,
 *  value and commissions are worked out by the database (crm_deals_derive) and
 *  previewed here with the same rules (lib/deals.ts). Once Approved, the terms
 *  lock and the Sales Confirmation can be created. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { CountRow, Deal, PaymentTerm } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RowActionMenu, type RowAction } from '../components/RowActionMenu'
import { DealFormModal, mapsUrl } from '../components/DealFormModal'
import { useSelection } from '../components/ListTools'
import { Avatar, Board, PersonCell, DownloadIcon, StatusPill, ViewSwitch, useStoredState, type BoardColumn, type BoardGroup } from '../components/board/Board'
import { MIRROR_PARTY_COLS, cell, type MirrorParty } from '../components/board/mirrors'
import { BoardTabs } from '../components/board/BoardTabs'
import { bulkDelete, deleteSummary } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'
import { formatShortDate } from '../lib/format'
import {
  DEAL_GROUPS, commTerms, dealStatus, inr, rateText, uomLabel,
} from '../lib/deals'

type Party = MirrorParty
const PARTY_COLS = MIRROR_PARTY_COLS
type Company = { id: string; name: string; is_home: boolean; is_active: boolean; phone_1?: string | null; mobile?: string | null }
type Person = { id: string; name: string }
type DealLineRow = { deal_id: string; line_no: number; count_id: string | null; quantity: number | null; uom: string; bag_weight: number | null; final_rate: number | null }

const CSV_COLUMNS = [
  'deal_no', 'status', 'buyer', 'supplier', 'count', 'quantity', 'uom', 'bag_weight', 'final_rate', 'total_weight', 'deal_value',
  'buyer_commission_terms', 'buyer_commission', 'supplier_commission_terms', 'supplier_commission', 'owner', 'manager', 'created', 'notes',
] as const

/** Statuses a deal can move to from `from`, matching crm_deals_status_guard. */
function nextStatuses(d: Deal, canApprove: boolean, isAdmin: boolean): string[] {
  switch (d.status) {
    case 'new_deal': return ['manager_approval', 'closed_lost']
    case 'manager_approval': return [...(canApprove ? ['approved', 'reconsider'] : []), 'new_deal', 'closed_lost']
    case 'reconsider': return ['manager_approval', 'new_deal', 'closed_lost']
    case 'closed_lost': return ['new_deal']
    case 'approved': return isAdmin && !d.sales_confirmation_id ? ['manager_approval', 'new_deal', 'closed_lost'] : []
    default: return []
  }
}

const STATUS_MESSAGE: Record<string, string> = {
  manager_approval: 'sent for Manager Approval',
  approved: 'approved; its Sales Confirmation was created',
  reconsider: 'sent back to Reconsider',
  closed_lost: 'closed as lost',
  new_deal: 'moved back to Draft',
}

export default function Deals() {
  const { can, me } = useAuth()
  const navigate = useNavigate()
  const canCreate = can('deal.create')
  const canEdit = can('deal.edit') || canCreate
  const canApprove = can('deal.approve')
  const isAdmin = !!me?.is_admin
  const [params, setParams] = useSearchParams()
  const [deals, setDeals] = useState<Deal[] | null>(null)
  const [buyers, setBuyers] = useState<Party[]>([])
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [scNos, setScNos] = useState<Map<string, string>>(new Map())
  const [scStages, setScStages] = useState<Map<string, string>>(new Map())
  const [leadNos, setLeadNos] = useState<Map<string, string>>(new Map())
  const [dealLines, setDealLines] = useState<Map<string, DealLineRow[]>>(new Map())
  const [details, setDetails] = useState<Deal | null>(null)
  const [formFor, setFormFor] = useState<Deal | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Deal | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [tab, setTab] = useState<'table'>('table')
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useStoredState('deals.owner', '')
  const [statusFilter, setStatusFilter] = useState('')
  const [view, setView] = useStoredState<'table' | 'kanban'>('deals.view', 'table')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    const [d, b, s, c, t, co, p, sc, ld, dl] = await Promise.all([
      supabase.from('crm_deals').select('*').order('created_at', { ascending: false }),
      supabase.from('buyer_master').select(PARTY_COLS).order('name'),
      supabase.from('supplier_master').select(PARTY_COLS).order('name'),
      supabase.from('count_master').select('*').order('count_no').order('display_name'),
      supabase.from('payment_terms').select('*').order('name'),
      supabase.from('companies').select('id,name,is_home,is_active,phone_1,mobile').order('name'),
      supabase.from('profiles').select('id,name').eq('is_active', true).order('name'),
      supabase.from('sales_confirmations').select('id,sc_no,stage'),
      supabase.from('leads').select('id,lead_no'),
      supabase.from('crm_deal_lines').select('deal_id,line_no,count_id,quantity,uom,bag_weight,final_rate').order('line_no'),
    ])
    if (d.error) setBanner({ kind: 'bad', text: errMessage(d.error, 'Could not load deals') })
    setDeals((d.data ?? []) as Deal[])
    setBuyers((b.data ?? []) as Party[])
    setSuppliers((s.data ?? []) as Party[])
    setCounts((c.data ?? []) as CountRow[])
    setTerms((t.data ?? []) as PaymentTerm[])
    setCompanies((co.data ?? []) as Company[])
    setPeople((p.data ?? []) as Person[])
    setScNos(new Map(((sc.data ?? []) as { id: string; sc_no: string }[]).map((x) => [x.id, x.sc_no])))
    setScStages(new Map(((sc.data ?? []) as { id: string; stage: string }[]).map((x) => [x.id, x.stage])))
    const byDeal = new Map<string, DealLineRow[]>()
    for (const r of (dl.data ?? []) as DealLineRow[]) byDeal.set(r.deal_id, [...(byDeal.get(r.deal_id) ?? []), r])
    setDealLines(byDeal)
    setLeadNos(new Map(((ld.data ?? []) as { id: string; lead_no: string }[]).map((x) => [x.id, x.lead_no])))
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  // /deals?open=<id> (from a lead, a report or global search); /deals?new=1 from "+ New"
  const openId = params.get('open')
  const wantNew = params.get('new')
  useEffect(() => {
    if (wantNew && canCreate) {
      setTab('table')
      setFormFor('new')
      setParams({}, { replace: true })
      return
    }
    if (!openId || !deals) return
    const found = deals.find((x) => x.id === openId)
    if (found) { setTab('table'); setDetails(found) }
    setParams({}, { replace: true })
  }, [openId, wantNew, deals, setParams, canCreate])

  const buyerName = useMemo(() => new Map(buyers.map((x) => [x.id, x.name])), [buyers])
  const supplierName = useMemo(() => new Map(suppliers.map((x) => [x.id, x.name])), [suppliers])
  const countName = useMemo(() => new Map(counts.map((x) => [x.id, x.display_name])), [counts])
  const personName = useMemo(() => new Map(people.map((x) => [x.id, x.name])), [people])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (deals ?? []).filter(
      (x) =>
        (!ownerFilter || x.owner_id === ownerFilter) &&
        (!statusFilter || x.status === statusFilter) &&
        (!q ||
          x.deal_no.toLowerCase().includes(q) ||
          ((x.buyer_id ? buyerName.get(x.buyer_id) ?? '' : '')).toLowerCase().includes(q) ||
          (x.supplier_id ? supplierName.get(x.supplier_id) ?? '' : '').toLowerCase().includes(q) ||
          (countName.get(x.count_id ?? '') ?? '').toLowerCase().includes(q)),
    )
  }, [deals, search, ownerFilter, statusFilter, buyerName, supplierName, countName])

  const selection = useSelection(useMemo(() => shown.map((x) => x.id), [shown]))

  async function moveStatus(deal: Deal, status: string, extra: Record<string, unknown> = {}) {
    setBanner(null)
    const { data, error } = await supabase.from('crm_deals').update({ status, ...extra }).eq('id', deal.id).select('id')
    if (error || !data || data.length === 0) {
      setBanner({ kind: 'bad', text: error ? errMessage(error, 'Could not change the status') : 'Your account cannot change this deal.' })
      return false
    }
    setBanner({ kind: 'ok', text: `${deal.deal_no} ${STATUS_MESSAGE[status] ?? 'updated'}.` })
    await load()
    return true
  }

  async function createSc(deal: Deal) {
    setBanner(null)
    const chk = await supabase.rpc('deal_confirm_problems', { p_deal: deal.id })
    const problems = (chk.data ?? []) as string[]
    if (problems.length > 0) {
      setBanner({ kind: 'bad', text: `${deal.deal_no}: Fix these first: ${problems.join('; ')}.` })
      return
    }
    const { error } = await supabase.rpc('confirm_deal', { p_deal: deal.id })
    if (error) { setBanner({ kind: 'bad', text: errMessage(error, 'Could not create the Sales Confirmation') }); return }
    setBanner({ kind: 'ok', text: `${deal.deal_no}: Sales Confirmation created.` })
    await load()
  }

  async function createOrder(deal: Deal) {
    setBanner(null)
    const { data, error } = await supabase.rpc('create_order', { p_deal: deal.id })
    if (error) { setBanner({ kind: 'bad', text: errMessage(error, 'Could not create the Dispatch and Billing item') }); return }
    navigate(`/orders?open=${data as string}`)
  }

  async function deleteDeal() {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    // the deal's files live in storage; remember them to clear after the delete
    const docs = await supabase.from('crm_deal_documents').select('storage_path').eq('deal_id', deleting.id)
    const { data, error } = await supabase.from('crm_deals').delete().eq('id', deleting.id).select('id')
    setDeleteBusy(false)
    if (error || !data || data.length === 0) {
      setDeleteError(error ? errMessage(error, 'Could not delete this deal') : 'Only a Draft deal without a Sales Confirmation can be deleted.')
      return
    }
    const paths = ((docs.data ?? []) as { storage_path: string }[]).map((r) => r.storage_path)
    if (paths.length > 0) void supabase.storage.from('crm-deal-documents').remove(paths)
    setBanner({ kind: 'ok', text: `${deleting.deal_no} deleted${deleting.lead_id ? '; its lead is editable again' : ''}.` })
    setDeleting(null)
    await load()
  }

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    const names = new Map((deals ?? []).map((x) => [x.id, x.deal_no]))
    const result = await bulkDelete('crm_deals', selection.chosen)
    setBanner(deleteSummary('deal', 'deals', result, (id) => names.get(id) ?? id))
    selection.clear()
    setConfirmDelete(false)
    await load()
    setBusy(false)
  }

  function exportCSV() {
    const list = (selection.chosen.length > 0 ? shown.filter((x) => selection.isSelected(x.id)) : shown).map((x) => ({
      ...x,
      status: dealStatus(x.status).label,
      buyer: (x.buyer_id ? buyerName.get(x.buyer_id) ?? '' : ''),
      supplier: x.supplier_id ? supplierName.get(x.supplier_id) ?? '' : '',
      count: countName.get(x.count_id ?? '') ?? '',
      uom: uomLabel(x.uom),
      buyer_commission_terms: commTerms(x.buyer_comm_basis, x.buyer_comm_value),
      supplier_commission_terms: commTerms(x.supplier_comm_basis, x.supplier_comm_value),
      owner: x.owner_id ? personName.get(x.owner_id) ?? '' : '',
      manager: x.manager_id ? personName.get(x.manager_id) ?? '' : '',
      created: x.created_at.slice(0, 10),
    }))
    downloadCSV(`deals-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!deals) return <Loading label="Loading deals" />

  const groups: BoardGroup[] = DEAL_GROUPS
  const termName = new Map(terms.map((t) => [t.id, t.name]))
  // one entry per count row (a deal without rows yet shows its own count)
  const rowsOf = (x: Deal): DealLineRow[] => dealLines.get(x.id)
    ?? [{ deal_id: x.id, line_no: 1, count_id: x.count_id, quantity: x.quantity, uom: x.uom, bag_weight: x.bag_weight, final_rate: x.final_rate }]
  const perLine = (x: Deal, show: (r: DealLineRow) => ReactNode) => <span className="lines-list">{rowsOf(x).map((r) => <span key={r.line_no}>{show(r)}</span>)}</span>
  const lockedIds = new Set(deals.filter((x) => x.status === 'approved').map((x) => x.id))
  const statusAction = (x: Deal, to: string, label: string, tone?: 'danger'): RowAction => ({ label, tone, onSelect: () => void moveStatus(x, to) })
  /** Row Actions, in the Pharma ERP order: read, edit, status moves, destructive last.
   *  An item that cannot be used stays visible with the reason. */
  function actionsFor(x: Deal): RowAction[] {
    const items: RowAction[] = [{ label: 'View details', onSelect: () => setDetails(x) }]
    const locked = x.status === 'approved'
    items.push({
      label: 'Edit',
      onSelect: () => setFormFor(x),
      disabledReason: !canEdit ? 'You need the "Edit deals" permission.' : locked ? 'An Approved deal is locked.' : null,
    })
    if (canEdit) {
      const next = nextStatuses(x, canApprove, isAdmin)
      if (next.includes('manager_approval') && x.status !== 'approved') items.push(statusAction(x, 'manager_approval', 'Send for approval'))
      if (next.includes('approved')) items.push(statusAction(x, 'approved', 'Approve'))
      if (next.includes('reconsider')) items.push(statusAction(x, 'reconsider', 'Send back to Reconsider'))
      if (x.status === 'closed_lost') items.push(statusAction(x, 'new_deal', 'Reopen as Draft'))
      if (x.status === 'approved' && next.includes('manager_approval')) items.push(statusAction(x, 'manager_approval', 'Move back to Manager Approval'))
      if (next.includes('closed_lost')) items.push(statusAction(x, 'closed_lost', 'Close as lost'))
    }
    if (x.status === 'approved' && !x.sales_confirmation_id) items.push({ label: 'Create Sales Confirmation', onSelect: () => void createSc(x), disabledReason: !canEdit ? 'You need the "Edit deals" permission.' : null })
    if (x.sales_confirmation_id) items.push({ label: 'Create Dispatch and Billing', onSelect: () => void createOrder(x), disabledReason: !can('order.manage') ? 'You need the "Manage Dispatch and Billing" permission.' : scStages.get(x.sales_confirmation_id) !== 'send_delivery' ? 'Its Sales Confirmation goes to Dispatch and Billing only once it is in Send with Delivery Info.' : null })
    if (x.sales_confirmation_id) items.push({ label: 'Go to Sales Confirmation', onSelect: () => navigate(`/sales-confirmations?open=${x.sales_confirmation_id}`) })
    items.push({
      label: 'Delete',
      tone: 'danger',
      onSelect: () => { setDeleteError(null); setDeleting(x) },
      disabledReason: !canCreate ? 'You need the "Create deals" permission.' : x.sales_confirmation_id ? 'This deal has a Sales Confirmation, so it cannot be deleted.' : x.status !== 'new_deal' ? 'Only a Draft deal can be deleted.' : null,
    })
    return items
  }
  // Columns: the deal fields in the lead's "Changes needed" document.
  const columns: BoardColumn<Deal>[] = [
    { key: 'deal', label: 'Deal No', width: 120, render: (x) => <span className="mono">{x.deal_no}</span> },
    { key: 'status', label: 'Status', width: 140, render: (x) => { const st = dealStatus(x.status); return <StatusPill label={st.label} tone={st.tone} /> } },
    { key: 'buyer', label: 'Buyer', render: (x) => x.buyer_id ? <strong>{buyerName.get(x.buyer_id) ?? '—'}</strong> : <span className="muted">not picked</span> },
    { key: 'supplier', label: 'Supplier', render: (x) => (x.supplier_id ? supplierName.get(x.supplier_id) ?? '—' : <span className="muted">not set</span>) },
    { key: 'count', label: 'Count', render: (x) => perLine(x, (r) => cell(countName.get(r.count_id ?? ''))) },
    { key: 'qty', label: 'Quantity', align: 'right', render: (x) => perLine(x, (r) => (r.quantity === null ? cell(null) : <span>{inr(r.quantity)} {uomLabel(r.uom)}</span>)) },
    { key: 'bag', hidden: true, label: 'Bag Weight', align: 'right', render: (x) => perLine(x, (r) => cell(r.bag_weight, { mono: true })) },
    { key: 'rate', label: 'Final Rate', align: 'right', render: (x) => perLine(x, (r) => (r.final_rate === null ? cell(null) : <span>₹{rateText(r.final_rate)}</span>)) },
    { key: 'value', label: 'Value', align: 'right', render: (x) => (x.deal_value === null ? cell(null) : <span>₹{inr(x.deal_value, 0)}</span>), total: (list) => { const n = list.reduce((sum, r) => sum + (r.deal_value ?? 0), 0); return n ? `₹${inr(n, 0)}` : '—' } },
    { key: 'bcomm', hidden: true, label: 'Buyer Commission', render: (x) => cell(commTerms(x.buyer_comm_basis, x.buyer_comm_value)) },
    { key: 'scomm', hidden: true, label: 'Supplier Commission', render: (x) => cell(commTerms(x.supplier_comm_basis, x.supplier_comm_value)) },
    { key: 'terms', hidden: true, label: 'Payment Terms', render: (x) => cell(x.payment_term_id ? termName.get(x.payment_term_id) : null) },
    { key: 'mode', hidden: true, label: 'Mode', render: (x) => cell(x.price_basis === 'net' ? 'Net' : 'Ex-Mill') },
    { key: 'freight', hidden: true, label: 'Freight', render: (x) => cell(x.freight === 'included' ? 'Included' : 'Excluded') },
    { key: 'location', hidden: true, label: 'Location', render: (x) => (x.location_text || x.location_lat !== null
      ? <span>{x.location_text ?? ''}{x.location_lat !== null && x.location_lng !== null ? <> <a className="small" href={mapsUrl(x.location_lat, x.location_lng)} target="_blank" rel="noopener noreferrer">map</a></> : null}</span>
      : cell(null)), interactive: true },
    { key: 'owner', label: 'Owner', render: (x) => <PersonCell name={x.owner_id ? personName.get(x.owner_id) : undefined} /> },
    { key: 'manager', hidden: true, label: 'Manager', render: (x) => <PersonCell name={x.manager_id ? personName.get(x.manager_id) : undefined} /> },
    { key: 'created', hidden: true, label: 'Created Date', render: (x) => cell(formatShortDate(x.created_at)) },
    { key: 'approved', hidden: true, label: 'Approval Date', render: (x) => cell(x.approved_at ? x.approved_at.slice(0, 10) : null) },
    { key: 'lead', hidden: true, label: 'Lead', interactive: true, render: (x) => (x.lead_id ? <Link className="mono small" to="/leads">{leadNos.get(x.lead_id) ?? 'open'}</Link> : cell(null)) },
    {
      key: 'sc', hidden: true, label: 'Sales Confirmation', interactive: true,
      render: (x) => (x.sales_confirmation_id
        ? <Link className="mono small" to={`/sales-confirmations?open=${x.sales_confirmation_id}`}>{scNos.get(x.sales_confirmation_id) ?? 'open'}</Link>
        : cell(null)),
    },
    { key: 'action', label: 'Actions', interactive: true, pinRight: true, render: (x) => <RowActionMenu label={`Actions for ${x.deal_no}`} actions={actionsFor(x)} /> },
  ]

  const chosen = selection.chosen.length

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Deals</h1>
          <p className="page-sub">Every trade from enquiry to approval. Approved deals become Sales Confirmations.</p>
        </div>
      </header>

      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}{' '}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      <BoardTabs tabs={[{ key: 'table', label: 'Main table' }]} active={tab} onChange={() => setTab('table')} />

      {tab === 'table' && (<>
      <div className="board-toolbar">
        <ViewSwitch view={view} onChange={setView} />
        <input className="toolbar-search" aria-label="Search deals" placeholder="Search deal, buyer, supplier, count" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {DEAL_GROUPS.map((g) => (<option key={g.value} value={g.value}>{g.label}</option>))}
        </select>
        <select aria-label="Owner" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="">All owners</option>
          {me && <option value={me.id}>My deals</option>}
          {people.filter((p) => p.id !== me?.id).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <button className="btn sm" type="button" disabled={shown.length === 0} onClick={exportCSV}>
          <DownloadIcon />Export {chosen > 0 ? `${chosen} selected` : shown.length === deals.length ? 'all' : `${shown.length} shown`}
        </button>
        <span className="push" />
        {canCreate && chosen > 0 && (
          <button className="btn sm" type="button" onClick={() => setConfirmDelete(true)}>Delete {chosen} selected</button>
        )}
        <div className="board-cols-slot">
          {canCreate && (
            <button className="btn primary" type="button" onClick={() => { setTab('table'); setFormFor('new') }}>
              + New deal
            </button>
          )}
        </div>
      </div>

      <Board
        rows={shown}
        groups={groups}
        groupOf={(x) => x.status}
        columns={columns}
        rowKey={(x) => x.id}
        viewKey="deals"
        onOpen={(x) => setDetails(x)}
        rowOpens={false}
        view={view}
        selection={canCreate && view === 'table' ? selection : undefined}
        emptyText={deals.length === 0 ? 'No deals yet. Start one with “+ New deal”.' : 'No deal matches that search.'}
        card={(x) => (
          <>
            <span className="kcard-top">
              <span className="mono small">{x.deal_no}</span>
              <Avatar name={x.owner_id ? personName.get(x.owner_id) : undefined} />
              <RowActionMenu label={`Actions for ${x.deal_no}`} actions={actionsFor(x)} />
            </span>
            <strong className="kcard-title">{x.buyer_id ? buyerName.get(x.buyer_id) ?? '—' : 'Buyer not picked'}</strong>
            <span className="small muted">{x.supplier_id ? `from ${supplierName.get(x.supplier_id) ?? '—'}` : 'supplier not set'}</span>
            <span className="small">{countName.get(x.count_id ?? '') ?? ''}</span>
            <span className="kcard-foot mono small">
              <span>{inr(x.quantity)} {uomLabel(x.uom)}</span>
              <span>{inr(x.quantity)} {uomLabel(x.uom)}</span>
            </span>
          </>
        )}
      />
      </>)}

      {formFor && (
        <DealFormModal
          buyers={buyers}
          suppliers={suppliers}
          counts={counts}
          terms={terms}
          companies={companies}
          people={people}
          meId={me?.id}
          deals={deals}
          lockedIds={lockedIds}
          initialDeal={formFor === 'new' ? null : formFor}
          buyerName={buyerName}
          leadNos={leadNos}
          onClose={() => setFormFor(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setFormFor(null)
            await load()
          }}
        />
      )}

      {details && (
        <DealFormModal
          readOnly
          key={details.id}
          buyers={buyers}
          suppliers={suppliers}
          counts={counts}
          terms={terms}
          companies={companies}
          people={people}
          meId={me?.id}
          deals={deals}
          lockedIds={lockedIds}
          initialDeal={deals.find((x) => x.id === details.id) ?? details}
          buyerName={buyerName}
          leadNos={leadNos}
          scNos={scNos}
          canEdit={canEdit}
          onEdit={(d) => { setDetails(null); setFormFor(d) }}
          onClose={() => setDetails(null)}
          onDone={() => setDetails(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog title={`Delete ${deleting.deal_no}?`} busy={deleteBusy} error={deleteError} onConfirm={() => void deleteDeal()} onClose={() => setDeleting(null)}>
          This cannot be undone.{deleting.lead_id ? ' Its lead becomes editable again.' : ''}
        </ConfirmDialog>
      )}

      {confirmDelete && (
        <ConfirmDialog title={`Delete ${chosen} selected deal${chosen === 1 ? '' : 's'}?`} busy={busy} onConfirm={() => void deleteSelected()} onClose={() => setConfirmDelete(false)}>
          Only Draft deals without a Sales Confirmation can be deleted; the others are skipped and reported.
        </ConfirmDialog>
      )}
    </>
  )
}
