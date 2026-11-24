/** Deals board, modelled on the monday.com "Deals" board and built like Leads: an Actions column
 *  (view, edit, status moves, delete), a read-only details drawer, and a pop-up form to create or
 *  update a deal.
 *
 *  Pipeline: New Deal -> Manager Approval -> Approved | Reconsider | Closed Lost.
 *  A deal is one trade between a buyer and a supplier for a count. It has a
 *  single final rate per kg; each side pays its own commission (Percentage,
 *  per KG or per BAG), copied from the party master and editable here. Weight,
 *  value and commissions are worked out by the database (crm_deals_derive) and
 *  previewed here with the same rules (lib/deals.ts). Once Approved, the terms
 *  lock and the Sales Confirmation can be created. */

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { COMMISSION_TYPES, type CountRow, type Deal, type DealChange, type PaymentTerm } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer } from '../components/Drawer'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RowActionMenu, type RowAction } from '../components/RowActionMenu'
import { DealFormModal, mapsUrl } from '../components/DealFormModal'
import { useSelection } from '../components/ListTools'
import { useProfileNames } from '../components/PartyExtras'
import { Avatar, Board, DownloadIcon, StatusPill, ViewSwitch, useStoredState, type BoardColumn, type BoardGroup } from '../components/board/Board'
import { MIRROR_PARTY_COLS, cell, type MirrorParty } from '../components/board/mirrors'
import { BoardTabs } from '../components/board/BoardTabs'
import { DealDocuments } from '../components/DealDocuments'
import { CountLinesView, toLineForm, type LineForm } from '../components/CountLines'
import { bulkDelete, deleteSummary } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'
import { formatDateTime } from '../lib/format'
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
  new_deal: 'moved back to New Deal',
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
      supabase.from('sales_confirmations').select('id,sc_no'),
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

  async function deleteDeal() {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    // the deal's files live in storage; remember them to clear after the delete
    const docs = await supabase.from('crm_deal_documents').select('storage_path').eq('deal_id', deleting.id)
    const { data, error } = await supabase.from('crm_deals').delete().eq('id', deleting.id).select('id')
    setDeleteBusy(false)
    if (error || !data || data.length === 0) {
      setDeleteError(error ? errMessage(error, 'Could not delete this deal') : 'Only a New Deal without a Sales Confirmation can be deleted.')
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
      if (x.status === 'closed_lost') items.push(statusAction(x, 'new_deal', 'Reopen as New Deal'))
      if (x.status === 'approved' && next.includes('manager_approval')) items.push(statusAction(x, 'manager_approval', 'Move back to Manager Approval'))
      if (next.includes('closed_lost')) items.push(statusAction(x, 'closed_lost', 'Close as lost'))
    }
    if (x.sales_confirmation_id) items.push({ label: 'Go to Sales Confirmation', onSelect: () => navigate(`/sales-confirmations?open=${x.sales_confirmation_id}`) })
    items.push({
      label: 'Delete',
      tone: 'danger',
      onSelect: () => { setDeleteError(null); setDeleting(x) },
      disabledReason: !canCreate ? 'You need the "Create deals" permission.' : x.sales_confirmation_id ? 'This deal has a Sales Confirmation, so it cannot be deleted.' : x.status !== 'new_deal' ? 'Only a New Deal can be deleted.' : null,
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
    { key: 'qty', label: 'Quantity', align: 'right', render: (x) => perLine(x, (r) => <span className="mono">{inr(r.quantity)}</span>) },
    { key: 'uom', label: 'Unit', render: (x) => perLine(x, (r) => cell(uomLabel(r.uom))) },
    { key: 'bag', label: 'Bag Weight', align: 'right', render: (x) => perLine(x, (r) => cell(r.bag_weight, { mono: true })) },
    { key: 'rate', label: 'Final Rate', align: 'right', render: (x) => perLine(x, (r) => <span className="mono">{rateText(r.final_rate)}</span>) },
    { key: 'bcomm', label: 'Buyer Commission', render: (x) => cell(commTerms(x.buyer_comm_basis, x.buyer_comm_value)) },
    { key: 'scomm', label: 'Supplier Commission', render: (x) => cell(commTerms(x.supplier_comm_basis, x.supplier_comm_value)) },
    { key: 'terms', label: 'Payment Terms', render: (x) => cell(x.payment_term_id ? termName.get(x.payment_term_id) : null) },
    { key: 'mode', label: 'Mode', render: (x) => cell(x.price_basis === 'net' ? 'Net' : 'Ex-Mill') },
    { key: 'freight', label: 'Freight', render: (x) => cell(x.freight === 'included' ? 'Included' : 'Excluded') },
    { key: 'location', label: 'Location', render: (x) => (x.location_text || x.location_lat !== null
      ? <span>{x.location_text ?? ''}{x.location_lat !== null && x.location_lng !== null ? <> <a className="small" href={mapsUrl(x.location_lat, x.location_lng)} target="_blank" rel="noopener noreferrer">map</a></> : null}</span>
      : cell(null)), interactive: true },
    { key: 'owner', label: 'Owner', render: (x) => <Avatar name={x.owner_id ? personName.get(x.owner_id) : undefined} /> },
    { key: 'manager', label: 'Manager', render: (x) => <Avatar name={x.manager_id ? personName.get(x.manager_id) : undefined} /> },
    { key: 'created', label: 'Created Date', render: (x) => cell(formatDateTime(x.created_at)) },
    { key: 'approved', label: 'Approval Date', render: (x) => cell(x.approved_at ? x.approved_at.slice(0, 10) : null) },
    { key: 'lead', label: 'Lead', interactive: true, render: (x) => (x.lead_id ? <Link className="mono small" to="/leads">{leadNos.get(x.lead_id) ?? 'open'}</Link> : cell(null)) },
    {
      key: 'sc', label: 'Sales Confirmation', interactive: true,
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
        {canCreate && (
          <button className="btn primary" type="button" onClick={() => { setTab('table'); setFormFor('new') }}>
            + New deal
          </button>
        )}
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
      </div>

      <Board
        rows={shown}
        groups={groups}
        groupOf={(x) => x.status}
        columns={columns}
        rowKey={(x) => x.id}
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
        <DealDetails
          key={details.id}
          deal={deals.find((x) => x.id === details.id) ?? details}
          canEdit={canEdit}
          canOrder={can('order.manage')}
          counts={counts}
          buyers={buyers}
          suppliers={suppliers}
          companies={companies}
          terms={terms}
          onClose={() => setDetails(null)}
          onEdit={(d) => { setDetails(null); setFormFor(d) }}
          onChanged={async (text) => { if (text) setBanner({ kind: 'ok', text }); await load() }}
        />
      )}

      {deleting && (
        <ConfirmDialog title={`Delete ${deleting.deal_no}?`} busy={deleteBusy} error={deleteError} onConfirm={() => void deleteDeal()} onClose={() => setDeleting(null)}>
          This cannot be undone.{deleting.lead_id ? ' Its lead becomes editable again.' : ''}
        </ConfirmDialog>
      )}

      {confirmDelete && (
        <ConfirmDialog title={`Delete ${chosen} selected deal${chosen === 1 ? '' : 's'}?`} busy={busy} onConfirm={() => void deleteSelected()} onClose={() => setConfirmDelete(false)}>
          Only New Deals without a Sales Confirmation can be deleted; the others are skipped and reported.
        </ConfirmDialog>
      )}
    </>
  )
}

/** The deal's details, read-only. Changing the deal is Actions > Edit (the pop-up form) and moving
 *  it through the pipeline is in the Actions menu too, so this view carries what the form does not:
 *  the Sales Confirmation step, documents, history and updates. */
function DealDetails({
  deal, canEdit, canOrder, counts, buyers, suppliers, companies, terms, onClose, onEdit, onChanged,
}: {
  deal: Deal
  canEdit: boolean
  canOrder: boolean
  counts: CountRow[]
  buyers: Party[]
  suppliers: Party[]
  companies: Company[]
  terms: PaymentTerm[]
  onClose: () => void
  onEdit: (deal: Deal) => void
  onChanged: (message?: string) => void | Promise<void>
}) {
  const navigate = useNavigate()
  const names = useProfileNames()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[] | null>(null)
  const [sc, setSc] = useState<{ id: string; sc_no: string | null } | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [leadNo, setLeadNo] = useState<string | null>(null)
  const firstLine: LineForm[] = [toLineForm({ count_id: deal.count_id, quantity: deal.quantity, uom: deal.uom, bag_weight: deal.bag_weight, rate: deal.final_rate })]
  const [lines, setLines] = useState<LineForm[]>(firstLine)

  useEffect(() => {
    let alive = true
    void supabase.from('crm_deal_lines').select('count_id,quantity,uom,bag_weight,final_rate').eq('deal_id', deal.id).order('line_no')
      .then(({ data }) => {
        const rows = (data ?? []) as { count_id: string; quantity: number; uom: string; bag_weight: number | null; final_rate: number | null }[]
        if (alive && rows.length > 0) setLines(rows.map((r) => toLineForm({ ...r, rate: r.final_rate })))
      })
    return () => { alive = false }
  }, [deal.id, deal.updated_at])
  useEffect(() => {
    if (!deal.lead_id) return
    void supabase.from('leads').select('lead_no').eq('id', deal.lead_id).maybeSingle()
      .then(({ data }) => setLeadNo((data as { lead_no: string } | null)?.lead_no ?? null))
  }, [deal.lead_id])
  useEffect(() => {
    let alive = true
    if (deal.sales_confirmation_id) {
      void supabase.from('sales_confirmations').select('id, sc_no').eq('id', deal.sales_confirmation_id).maybeSingle()
        .then(({ data }) => { if (alive) setSc(data as { id: string; sc_no: string | null } | null) })
      void supabase.from('orders').select('id').eq('sales_confirmation_id', deal.sales_confirmation_id).neq('status', 'cancelled').order('created_at').limit(1).maybeSingle()
        .then(({ data }) => { if (alive) setOrderId(data?.id ?? null) })
    } else if (deal.status === 'approved') {
      void supabase.rpc('deal_confirm_problems', { p_deal: deal.id })
        .then(({ data }) => { if (alive) setProblems((data ?? []) as string[]) })
    }
    return () => { alive = false }
  }, [deal.id, deal.status, deal.sales_confirmation_id])

  const approved = deal.status === 'approved'
  const status = dealStatus(deal.status)
  const buyer = buyers.find((x) => x.id === deal.buyer_id)
  const supplier = suppliers.find((x) => x.id === deal.supplier_id)
  const termName = terms.find((t) => t.id === deal.payment_term_id)?.name ?? null

  async function createSc() {
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('confirm_deal', { p_deal: deal.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not create the Sales Confirmation'))
    await onChanged(`${deal.deal_no}: Sales Confirmation created.`)
  }

  async function createOrder() {
    setBusy(true)
    const { data, error } = await supabase.rpc('create_order', { p_deal: deal.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not create the Dispatch and Billing item'))
    navigate(`/orders?open=${data as string}`)
  }

  const rows: [string, ReactNode][] = [
    ['Buyer', buyer?.name ?? null],
    ['Supplier', supplier?.name ?? null],
    ['Payment Terms', termName],
    ['Manager', deal.manager_id ? names[deal.manager_id] ?? null : null],
    ['Owner', deal.owner_id ? names[deal.owner_id] ?? null : null],
    ['Mode', deal.price_basis === 'net' ? 'Net' : 'Ex-Mill'],
    ['Freight', deal.freight === 'included' ? 'Included' : 'Excluded'],
    ['Buyer Commission', commTerms(deal.buyer_comm_basis, deal.buyer_comm_value)],
    ['Supplier Commission', commTerms(deal.supplier_comm_basis, deal.supplier_comm_value)],
    ['Location', deal.location_text || deal.location_lat !== null
      ? <>{deal.location_text ?? ''}{deal.location_lat !== null && deal.location_lng !== null ? <> <a href={mapsUrl(deal.location_lat, deal.location_lng)} target="_blank" rel="noopener noreferrer">open in Maps</a></> : null}</>
      : null],
    ['Lead', deal.lead_id ? <Link className="mono" to="/leads">{leadNo ?? '…'}</Link> : null],
    ['Remarks', deal.notes],
    ['Created', formatDateTime(deal.created_at)],
    ['Approval Date', deal.approved_at ? formatDateTime(deal.approved_at) : null],
  ]

  return (
    <Drawer title={deal.deal_no} onClose={onClose} footer={
        <div className="drawer-actions">
          <button className="btn" type="button" disabled={!canEdit || approved} title={!canEdit ? 'You need the “Edit deals” permission.' : approved ? 'An Approved deal is locked.' : undefined} onClick={() => onEdit(deal)}>Edit</button>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
        </div>
      }>
      <p className="small">
        <StatusPill label={status.label} tone={status.tone} />
        <span className="muted"> · created {formatDateTime(deal.created_at)}{deal.status_changed_at ? ` · status changed ${formatDateTime(deal.status_changed_at)}` : ''}</span>
      </p>
      {err && <div className="alert">{err}</div>}
      {!canEdit && <div className="notice small">You can view this deal; changing it needs the “Edit deals” permission.</div>}
      {approved && (
        <div className="notice small">
          Approved by {deal.approved_by ? names[deal.approved_by] ?? 'a manager' : 'a manager'}
          {deal.approved_at ? ` on ${formatDateTime(deal.approved_at)}` : ''}. The deal is converted and can no longer be edited.
        </div>
      )}

      <dl className="kv">
        {rows.filter(([, v]) => v !== null && v !== '' && v !== undefined).map(([k, v]) => (
          <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
        ))}
      </dl>

      <h3 className="section-title">Counts</h3>
      <CountLinesView lines={lines} counts={counts}
        buyer={{ basis: deal.buyer_comm_basis, value: deal.buyer_comm_value }} supplier={{ basis: deal.supplier_comm_basis, value: deal.supplier_comm_value }} />

      {(buyer || supplier) && (
        <div className="lookup-grid">
          {buyer && <PartyLookup title="Buyer" p={buyer} unit={companies.find((c) => c.id === buyer.company_id)?.name} />}
          {supplier && <PartyLookup title="Supplier" p={supplier} unit={companies.find((c) => c.id === supplier.company_id)?.name} />}
        </div>
      )}


      {approved && !deal.sales_confirmation_id && (
        <div className="notice">
          <h3 className="section-title" style={{ marginTop: 0 }}>Sales Confirmation</h3>
          {problems === null ? (
            <p className="muted small">Checking…</p>
          ) : problems.length === 0 ? (
            <p className="small">Everything needed is in place.</p>
          ) : (
            <>
              <p className="small">Fix these first:</p>
              <ul className="small">{problems.map((x) => (<li key={x}>{x}</li>))}</ul>
            </>
          )}
          {canEdit && (
            <p>
              <button className="btn primary" type="button" disabled={busy || problems === null || problems.length > 0} onClick={() => void createSc()}>
                Create Sales Confirmation
              </button>
            </p>
          )}
        </div>
      )}
      {deal.sales_confirmation_id && (
        <div className="notice">
          <h3 className="section-title" style={{ marginTop: 0 }}>Sales Confirmation</h3>
          <p className="small">
            <Link className="mono" to={`/sales-confirmations?open=${deal.sales_confirmation_id}`}>{sc?.sc_no ?? '…'}</Link> · send it to the supplier and buyer from there.
          </p>
          {orderId ? (
            <p className="small"><Link to={`/orders?open=${orderId}`}>Open its Dispatch and Billing items</Link></p>
          ) : (
            canOrder && <p><button className="btn" type="button" disabled={busy} onClick={() => void createOrder()}>Create Dispatch and Billing</button></p>
          )}
        </div>
      )}

      <DealDocuments dealId={deal.id} canEdit={canEdit && !approved} />
      <DealHistory dealId={deal.id} refreshKey={deal.updated_at} />
      <p className="muted small">Last updated {formatDateTime(deal.updated_at)}.</p>
    </Drawer>
  )
}

/** Read-only details from the party master (monday's mirror columns on the Deals board). */
function PartyLookup({ title, p, unit }: { title: string; p: Party; unit?: string }) {
  return (
    <div className="lookup">
      <h4>{title}: {p.name}</h4>
      <dl className="kv">
        <dt>GST</dt><dd className="mono">{p.gst || '—'}</dd>
        <dt>PAN</dt><dd className="mono">{p.pan || '—'}</dd>
        <dt>Contact person 1</dt><dd>{[p.contact_person, p.mobile ? `+91 ${p.mobile}` : ''].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Office address</dt><dd>{p.address || '—'}</dd>
        <dt>Mill / delivery address</dt><dd>{p.mill_address || '—'}</dd>
        <dt>Business unit</dt><dd>{unit || '—'}</dd>
        <dt>Commission</dt><dd>{commTerms(p.commission_basis ?? null, p.commission_value ?? null)}</dd>
      </dl>
    </div>
  )
}


const CHANGE_LABEL: Record<string, string> = {
  final_rate: 'Final rate',
  buyer_commission: 'Buyer commission',
  supplier_commission: 'Supplier commission',
  freight: 'Freight',
  price_basis: 'Mode',
  location_text: 'Location',
  status: 'Status',
  // older entries
  buyer_rate: 'Buyer rate',
  supplier_rate: 'Supplier rate',
  commission_type: 'Commission type',
}

const OLD_STATUS: Record<string, string> = {
  draft: 'Draft', rate_discussion: 'Rate Discussion', supplier_confirmed: 'Supplier Confirmed', buyer_confirmed: 'Buyer Confirmed', confirmed: 'Confirmed',
}

function changeValue(field: string, v: string | null): string {
  if (v === null || v === '') return '—'
  if (field === 'status') return OLD_STATUS[v] ?? dealStatus(v).label
  if (field === 'price_basis') return v === 'ex_mill' ? 'Ex-Mill' : v === 'net' ? 'Net' : v
  if (field === 'freight') return v === 'included' ? 'Included' : v === 'excluded' ? 'Excluded' : v
  if (field === 'buyer_commission' || field === 'supplier_commission') {
    const [num, basis] = v.split(' ')
    return commTerms(basis ?? null, num ? Number(num) : null)
  }
  if (field === 'commission_type') return COMMISSION_TYPES.find((c) => c.value === v)?.label ?? v.replace(/_/g, ' ')
  return v
}

const HISTORY_SHOWN = 8

function DealHistory({ dealId, refreshKey }: { dealId: string; refreshKey: string }) {
  const names = useProfileNames()
  const [rows, setRows] = useState<DealChange[] | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    let alive = true
    void supabase.from('deal_changes').select('*').eq('deal_id', dealId).order('changed_at', { ascending: false })
      .then(({ data }) => { if (alive) setRows((data ?? []) as DealChange[]) })
    return () => { alive = false }
  }, [dealId, refreshKey])
  return (
    <>
      <h3 className="section-title">History</h3>
      {rows === null ? (
        <p className="muted small">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">No changes recorded yet.</p>
      ) : (
        <ul className="history">
          {(all ? rows : rows.slice(0, HISTORY_SHOWN)).map((r) => (
            <li key={r.id}>
              <strong>{CHANGE_LABEL[r.field] ?? r.field}</strong>: {changeValue(r.field, r.old_value)} → {changeValue(r.field, r.new_value)}
              <div className="muted small">
                {formatDateTime(r.changed_at)}
                {r.changed_by ? ` · ${names[r.changed_by] ?? 'a user'}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length > HISTORY_SHOWN && (
        <button className="btn ghost sm" type="button" onClick={() => setAll(!all)}>
          {all ? 'Show the latest only' : `Show all ${rows.length} changes`}
        </button>
      )}
    </>
  )
}
