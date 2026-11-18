/** Deals board, modelled on the monday.com "Deals" board.
 *
 *  Pipeline: New Deal -> Manager Approval -> Approved | Reconsider | Closed Lost.
 *  A deal is one trade between a buyer and a supplier for a count. It has a
 *  single final rate per kg; each side pays its own commission (Percentage,
 *  per KG or per BAG), copied from the party master and editable here. Weight,
 *  value and commissions are worked out by the database (crm_deals_derive) and
 *  previewed here with the same rules (lib/deals.ts). Once Approved, the terms
 *  lock and the Sales Confirmation can be created. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { CountRow, Deal, DealChange, PaymentTerm } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { useSelection } from '../components/ListTools'
import { ActivityPanel, useProfileNames } from '../components/PartyExtras'
import { Avatar, Board, StatusPicker, ViewSwitch, useStoredState, type BoardColumn, type BoardGroup } from '../components/board/Board'
import { MIRROR_PARTY_COLS, cell, type MirrorParty } from '../components/board/mirrors'
import { bulkDelete, deleteSummary } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage, numOrNull } from '../lib/party'
import { formatDateTime } from '../lib/format'
import {
  COMM_BASES, DEAL_GROUPS, UOMS, commTerms, dealStatus, inr, needsUnitWeight, uomLabel,
} from '../lib/deals'

type Party = MirrorParty
const PARTY_COLS = MIRROR_PARTY_COLS
type Company = { id: string; name: string; is_home: boolean; is_active: boolean; phone_1?: string | null; mobile?: string | null }
type Person = { id: string; name: string }

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
  const [editing, setEditing] = useState<Deal | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useStoredState('deals.owner', '')
  const [view, setView] = useStoredState<'table' | 'kanban'>('deals.view', 'table')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    const [d, b, s, c, t, co, p, sc, ld] = await Promise.all([
      supabase.from('crm_deals').select('*').order('created_at', { ascending: false }),
      supabase.from('buyer_master').select(PARTY_COLS).order('name'),
      supabase.from('supplier_master').select(PARTY_COLS).order('name'),
      supabase.from('count_master').select('*').order('count_no').order('display_name'),
      supabase.from('payment_terms').select('*').order('name'),
      supabase.from('companies').select('id,name,is_home,is_active,phone_1,mobile').order('name'),
      supabase.from('profiles').select('id,name').eq('is_active', true).order('name'),
      supabase.from('sales_confirmations').select('id,sc_no'),
      supabase.from('leads').select('id,lead_no'),
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
      setEditing('new')
      setParams({}, { replace: true })
      return
    }
    if (!openId || !deals) return
    const found = deals.find((x) => x.id === openId)
    if (found) setEditing(found)
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
        (!q ||
          x.deal_no.toLowerCase().includes(q) ||
          ((x.buyer_id ? buyerName.get(x.buyer_id) ?? '' : '')).toLowerCase().includes(q) ||
          (x.supplier_id ? supplierName.get(x.supplier_id) ?? '' : '').toLowerCase().includes(q) ||
          (countName.get(x.count_id) ?? '').toLowerCase().includes(q)),
    )
  }, [deals, search, ownerFilter, buyerName, supplierName, countName])

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
      count: countName.get(x.count_id) ?? '',
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
  // Columns: the deal fields in the lead's "Changes needed" document.
  const columns: BoardColumn<Deal>[] = [
    { key: 'deal', label: 'Deal No', width: 120, render: (x) => <span className="mono">{x.deal_no}</span> },
    {
      key: 'status', label: 'Status', width: 160, interactive: true,
      render: (x) => {
        const cur = dealStatus(x.status)
        const opts = canEdit ? nextStatuses(x, canApprove, isAdmin).map(dealStatus) : []
        return <StatusPicker current={cur} options={opts} onPick={(s) => void moveStatus(x, s)} />
      },
    },
    { key: 'buyer', label: 'Buyer', render: (x) => x.buyer_id ? <strong>{buyerName.get(x.buyer_id) ?? '—'}</strong> : <span className="muted">not picked</span> },
    { key: 'supplier', label: 'Supplier', render: (x) => (x.supplier_id ? supplierName.get(x.supplier_id) ?? '—' : <span className="muted">not set</span>) },
    { key: 'count', label: 'Count', render: (x) => cell(countName.get(x.count_id)) },
    { key: 'qty', label: 'Quantity', align: 'right', render: (x) => <span className="mono">{inr(x.quantity)}</span> },
    { key: 'uom', label: 'Unit', render: (x) => cell(uomLabel(x.uom)) },
    { key: 'bag', label: 'Bag Weight', align: 'right', render: (x) => cell(x.bag_weight, { mono: true }) },
    { key: 'rate', label: 'Final Rate', align: 'right', render: (x) => <span className="mono">{inr(x.final_rate)}</span> },
    { key: 'bcomm', label: 'Buyer Commission', render: (x) => cell(commTerms(x.buyer_comm_basis, x.buyer_comm_value)) },
    { key: 'scomm', label: 'Supplier Commission', render: (x) => cell(commTerms(x.supplier_comm_basis, x.supplier_comm_value)) },
    { key: 'terms', label: 'Payment Terms', render: (x) => cell(x.payment_term_id ? termName.get(x.payment_term_id) : null) },
    { key: 'freight', label: 'Freight', render: (x) => cell(x.freight === 'included' ? 'Included' : 'Excluded') },
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
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
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

      <div className="board-toolbar">
        <ViewSwitch view={view} onChange={setView} />
        <input className="toolbar-search" aria-label="Search deals" placeholder="Search deal, buyer, supplier, count" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Owner" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="">All owners</option>
          {me && <option value={me.id}>My deals</option>}
          {people.filter((p) => p.id !== me?.id).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <span className="push" />
        {canCreate && chosen > 0 && (
          confirmDelete ? (
            <span className="toolbar-confirm">
              <span className="field-warn">Delete {chosen} selected?</span>
              <button className="btn danger sm" type="button" disabled={busy} onClick={() => void deleteSelected()}>Yes, delete</button>
              <button className="btn ghost sm" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn sm" type="button" onClick={() => setConfirmDelete(true)}>Delete {chosen} selected</button>
          )
        )}
        <button className="btn sm" type="button" disabled={shown.length === 0} onClick={exportCSV}>
          Export {chosen > 0 ? `${chosen} selected` : shown.length === deals.length ? 'all' : `${shown.length} shown`}
        </button>
      </div>

      <Board
        rows={shown}
        groups={groups}
        groupOf={(x) => x.status}
        columns={columns}
        rowKey={(x) => x.id}
        onOpen={(x) => setEditing(x)}
        view={view}
        selection={canCreate && view === 'table' ? selection : undefined}
        emptyText={deals.length === 0 ? 'No deals yet. Start one with “+ New deal”.' : 'No deal matches that search.'}
        card={(x) => (
          <>
            <span className="kcard-top">
              <span className="mono small">{x.deal_no}</span>
              <Avatar name={x.owner_id ? personName.get(x.owner_id) : undefined} />
            </span>
            <strong className="kcard-title">{x.buyer_id ? buyerName.get(x.buyer_id) ?? '—' : 'Buyer not picked'}</strong>
            <span className="small muted">{x.supplier_id ? `from ${supplierName.get(x.supplier_id) ?? '—'}` : 'supplier not set'}</span>
            <span className="small">{countName.get(x.count_id) ?? ''}</span>
            <span className="kcard-foot mono small">
              <span>{inr(x.quantity)} {uomLabel(x.uom)}</span>
              <span>{inr(x.quantity)} {uomLabel(x.uom)}</span>
            </span>
          </>
        )}
      />

      {editing && (
        <DealPanel
          key={editing === 'new' ? 'new' : editing.id}
          deal={editing === 'new' ? null : editing}
          canEdit={canEdit}
          canDelete={canCreate}
          canApprove={canApprove}
          isAdmin={isAdmin}
          canOrder={can('order.manage')}
          buyers={buyers}
          suppliers={suppliers}
          counts={counts}
          terms={terms}
          companies={companies}
          people={people}
          onClose={() => setEditing(null)}
          onDone={async (text, keepOpen) => {
            setBanner({ kind: 'ok', text })
            await load()
            if (!keepOpen) setEditing(null)
          }}
          onReload={async (id) => {
            await load()
            const { data } = await supabase.from('crm_deals').select('*').eq('id', id).maybeSingle()
            if (data) setEditing(data as Deal)
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
  final_rate: string
  price_basis: 'ex_mill' | 'net'
  freight: 'included' | 'excluded'
  buyer_comm_basis: string
  buyer_comm_value: string
  supplier_comm_basis: string
  supplier_comm_value: string
  owner_id: string
  manager_id: string
  notes: string
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

function toForm(d: Deal | null, companies: Company[], meId: string | undefined): Form {
  const home = companies.find((c) => c.is_home && c.is_active)
  return {
    buyer_id: d?.buyer_id ?? '',
    supplier_id: d?.supplier_id ?? '',
    company_id: d?.company_id ?? home?.id ?? '',
    payment_term_id: d?.payment_term_id ?? '',
    count_id: d?.count_id ?? '',
    quantity: d ? String(d.quantity) : '',
    uom: d?.uom ?? 'KG',
    bag_weight: str(d?.bag_weight),
    final_rate: str(d?.final_rate),
    price_basis: d?.price_basis ?? 'ex_mill',
    freight: d?.freight ?? 'excluded',
    buyer_comm_basis: d?.buyer_comm_basis ?? '',
    buyer_comm_value: str(d?.buyer_comm_value),
    supplier_comm_basis: d?.supplier_comm_basis ?? '',
    supplier_comm_value: str(d?.supplier_comm_value),
    owner_id: d?.owner_id ?? meId ?? '',
    manager_id: d?.manager_id ?? '',
    notes: d?.notes ?? '',
  }
}

function DealPanel({
  deal, canEdit, canDelete, canApprove, isAdmin, canOrder, buyers, suppliers, counts, terms, companies, people, onClose, onDone, onReload,
}: {
  deal: Deal | null
  canEdit: boolean
  canDelete: boolean
  canApprove: boolean
  isAdmin: boolean
  canOrder: boolean
  buyers: Party[]
  suppliers: Party[]
  counts: CountRow[]
  terms: PaymentTerm[]
  companies: Company[]
  people: Person[]
  onClose: () => void
  onDone: (message: string, keepOpen?: boolean) => void | Promise<void>
  onReload: (id: string) => void | Promise<void>
}) {
  const { me } = useAuth()
  const navigate = useNavigate()
  const names = useProfileNames()
  const [f, setF] = useState<Form>(toForm(deal, companies, me?.id))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[] | null>(null)
  const [sc, setSc] = useState<{ id: string; sc_no: string | null } | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [leadNo, setLeadNo] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(!deal)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  useEffect(() => {
    if (!deal?.lead_id) return
    void supabase.from('leads').select('lead_no').eq('id', deal.lead_id).maybeSingle()
      .then(({ data }) => setLeadNo((data as { lead_no: string } | null)?.lead_no ?? null))
  }, [deal?.lead_id])

  const approved = deal?.status === 'approved'
  const locked = approved
  const status = deal ? dealStatus(deal.status) : dealStatus('new_deal')

  useEffect(() => {
    if (!deal) return
    let alive = true
    if (deal.sales_confirmation_id) {
      void supabase.from('sales_confirmations').select('id, sc_no').eq('id', deal.sales_confirmation_id).maybeSingle()
        .then(({ data }) => { if (alive) setSc(data as { id: string; sc_no: string | null } | null) })
      void supabase.from('orders').select('id').eq('sales_confirmation_id', deal.sales_confirmation_id).neq('status', 'cancelled').maybeSingle()
        .then(({ data }) => { if (alive) setOrderId(data?.id ?? null) })
    } else if (deal.status === 'approved') {
      void supabase.rpc('deal_confirm_problems', { p_deal: deal.id })
        .then(({ data }) => { if (alive) setProblems((data ?? []) as string[]) })
    }
    return () => { alive = false }
  }, [deal])

  // party change: take that party's commission terms from its master
  function pickBuyer(id: string) {
    const b = buyers.find((x) => x.id === id)
    setF((p) => ({ ...p, buyer_id: id, buyer_comm_basis: b?.commission_basis ?? '', buyer_comm_value: str(b?.commission_value) }))
  }
  function pickSupplier(id: string) {
    const s = suppliers.find((x) => x.id === id)
    setF((p) => ({ ...p, supplier_id: id, supplier_comm_basis: s?.commission_basis ?? '', supplier_comm_value: str(s?.commission_value) }))
  }

  const qty = numOrNull(f.quantity)
  const rate = numOrNull(f.final_rate)
  const unitW = numOrNull(f.bag_weight)
  const bVal = numOrNull(f.buyer_comm_value)
  const sVal = numOrNull(f.supplier_comm_value)
  const basisName = (b: string) => COMM_BASES.find((x) => x.value === b)?.label ?? '—'
  const count = counts.find((c) => c.id === f.count_id)
  const buyer = buyers.find((x) => x.id === f.buyer_id)
  const supplier = suppliers.find((x) => x.id === f.supplier_id)

  const missing: string[] = []

  if (!f.count_id) missing.push('Count')
  if (qty === null || qty <= 0) missing.push('Quantity (above zero)')
  if (f.uom === 'BAGS' && (unitW === null || unitW <= 0)) missing.push('Bag weight')
  if (f.final_rate && (rate === null || rate < 0)) missing.push('Final rate (a number)')

  async function save(thenStatus?: string) {
    setBusy(true)
    setErr(null)
    const payload: Record<string, unknown> = {
      buyer_id: f.buyer_id || null,
      supplier_id: f.supplier_id || null,
      company_id: f.company_id || null,
      payment_term_id: f.payment_term_id || null,
      count_id: f.count_id,
      quantity: qty,
      uom: f.uom,
      bag_weight: unitW && unitW > 0 ? unitW : null,
      final_rate: rate,
      price_basis: f.price_basis,
      freight: f.freight,
      buyer_comm_basis: f.buyer_comm_basis || null,
      buyer_comm_value: f.buyer_comm_basis ? bVal : null,
      supplier_comm_basis: f.supplier_comm_basis || null,
      supplier_comm_value: f.supplier_comm_basis ? sVal : null,
      owner_id: f.owner_id || null,
      manager_id: f.manager_id || null,
      notes: f.notes.trim() || null,
    }
    if (locked) {
      // approved: only the people and notes can change
      for (const k of Object.keys(payload)) if (!['owner_id', 'manager_id', 'notes'].includes(k)) delete payload[k]
    }
    const res = deal
      ? await supabase.from('crm_deals').update(payload).eq('id', deal.id).select('id, deal_no')
      : await supabase.from('crm_deals').insert(payload).select('id, deal_no')
    if (res.error || !res.data || res.data.length === 0) {
      setBusy(false)
      return setErr(res.error ? errMessage(res.error, 'Could not save this deal') : 'Your account cannot change this deal.')
    }
    const saved = res.data[0] as { id: string; deal_no: string }
    if (thenStatus) {
      const st = await supabase.from('crm_deals').update({ status: thenStatus }).eq('id', saved.id).select('id')
      setBusy(false)
      if (st.error) {
        setErr(errMessage(st.error, 'Saved, but the status could not change'))
        return onReload(saved.id)
      }
      return onDone(`${saved.deal_no} ${STATUS_MESSAGE[thenStatus] ?? 'updated'}.`)
    }
    setBusy(false)
    setEditMode(false)
    await onDone(deal ? `${saved.deal_no} saved.` : `${saved.deal_no} created.`)
  }

  async function move(next: string, extra: Record<string, unknown> = {}) {
    if (!deal) return
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.from('crm_deals').update({ status: next, ...extra }).eq('id', deal.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error, 'Could not change the status') : 'Your account cannot change this deal.')
    await onDone(`${deal.deal_no} ${STATUS_MESSAGE[next] ?? 'updated'}.`)
  }

  async function createSc() {
    if (!deal) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.rpc('confirm_deal', { p_deal: deal.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not create the Sales Confirmation'))
    await onDone(`${deal.deal_no}: Sales Confirmation created.`, true)
    await onReload(deal.id)
  }

  async function createOrder() {
    if (!deal) return
    setBusy(true)
    const { data, error } = await supabase.rpc('create_order', { p_deal: deal.id })
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not create the Dispatch and Billing item'))
    navigate(`/orders?open=${data as string}`)
  }

  async function remove() {
    if (!deal) return
    setBusy(true)
    const { data, error } = await supabase.from('crm_deals').delete().eq('id', deal.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Only a New Deal without a Sales Confirmation can be deleted.')
    await onDone(`${deal.deal_no} deleted${deal.lead_id ? '; its lead is editable again' : ''}.`)
  }

  const nexts = deal && canEdit ? nextStatuses(deal, canApprove, isAdmin) : []
  // Editable until the deal is converted (Approved, which creates its Sales Confirmation).
  const canChange = canEdit && !locked
  const editable = canChange && editMode
  const dirty = deal ? JSON.stringify(f) !== JSON.stringify(toForm(deal, companies, me?.id)) : true

  return (
    <Drawer title={deal ? deal.deal_no : 'New deal'} onClose={onClose}>
      <div className="panel-status">
        <StatusPicker
          current={status}
          options={deal ? nexts.filter((s) => s !== 'closed_lost').map(dealStatus) : []}
          onPick={(s) => void move(s)}
          disabled={!deal || busy}
        />
        {deal && (
          <span className="small muted">
            Created {formatDateTime(deal.created_at)}
            {deal.status_changed_at ? ` · status changed ${formatDateTime(deal.status_changed_at)}` : ''}
          </span>
        )}
      </div>

      {err && <div className="alert">{err}</div>}
      {!canEdit && <div className="notice small">You can view this deal; changing it needs the “Edit deals” permission.</div>}
      {deal?.status === 'closed_lost' && (
        <div className="notice small">Closed Lost.</div>
      )}
      {approved && (
        <div className="notice small">
          Approved by {deal?.approved_by ? names[deal.approved_by] ?? 'a manager' : 'a manager'}
          {deal?.approved_at ? ` on ${formatDateTime(deal.approved_at)}` : ''}. The deal is converted and can no longer be edited.
        </div>
      )}

      <fieldset disabled={!editable} className="plain-fieldset">
        <h3 className="section-title">Parties</h3>
        <div className="form-grid">
          <Field id="d-buyer" label="Buyer" hint="From Buyers & Suppliers. Needed before Manager Approval.">
            <select id="d-buyer" value={f.buyer_id} onChange={(e) => pickBuyer(e.target.value)}>
              <option value="">—</option>
              {buyers.filter((x) => x.is_active || x.id === f.buyer_id).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </Field>
          <Field id="d-supplier" label="Supplier" hint="Needed before Manager Approval.">
            <select id="d-supplier" value={f.supplier_id} onChange={(e) => pickSupplier(e.target.value)}>
              <option value="">—</option>
              {suppliers.filter((x) => x.is_active || x.id === f.supplier_id).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </Field>
          <Field id="d-term" label="Payment terms">
            <select id="d-term" value={f.payment_term_id} onChange={(e) => set('payment_term_id', e.target.value)}>
              <option value="">—</option>
              {terms.filter((t) => t.is_active || t.id === f.payment_term_id).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
          </Field>
        </div>
        {(buyer || supplier) && (
          <div className="lookup-grid">
            {buyer && <PartyLookup title="Buyer" p={buyer} unit={companies.find((c) => c.id === buyer.company_id)?.name} />}
            {supplier && <PartyLookup title="Supplier" p={supplier} unit={companies.find((c) => c.id === supplier.company_id)?.name} />}
          </div>
        )}
        {deal?.lead_id && (
          <p className="small muted">From lead <Link className="mono" to="/leads">{leadNo ?? '…'}</Link>.</p>
        )}

        <h3 className="section-title">Product</h3>
        <div className="form-grid">
          <Field id="d-count" label="Count" required>
            <select id="d-count" value={f.count_id} onChange={(e) => set('count_id', e.target.value)}>
              <option value="">—</option>
              {counts.filter((c) => c.is_active || c.id === f.count_id).map((c) => (<option key={c.id} value={c.id}>{c.display_name}</option>))}
            </select>
          </Field>
          <Field id="d-qty" label="Quantity" required>
            <input id="d-qty" className="mono" inputMode="decimal" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </Field>
          <Field id="d-uom" label="UOM">
            <select id="d-uom" value={f.uom} onChange={(e) => set('uom', e.target.value)}>
              {UOMS.map((u) => (<option key={u.value} value={u.value}>{u.label}</option>))}
            </select>
          </Field>
          <Field id="d-bag" label={f.uom === 'BAGS' ? 'Bag weight (kg)' : 'Weight per unit (kg)'} required={f.uom === 'BAGS'}
            hint={needsUnitWeight(f.uom) ? 'Used to work out total weight.' : 'Only needed for a per-bag commission.'}>
            <input id="d-bag" className="mono" inputMode="decimal" value={f.bag_weight} onChange={(e) => set('bag_weight', e.target.value)} />
          </Field>
        </div>
        {count && <p className="small muted">{count.display_name}</p>}

        <h3 className="section-title">Commercials</h3>
        <div className="form-grid">
          <Field id="d-rate" label="Final rate (₹ per kg)">
            <input id="d-rate" className="mono" inputMode="decimal" value={f.final_rate} onChange={(e) => set('final_rate', e.target.value)} />
          </Field>
          <Field id="d-freight" label="Freight">
            <select id="d-freight" value={f.freight} onChange={(e) => set('freight', e.target.value as Form['freight'])}>
              <option value="excluded">Excluded</option>
              <option value="included">Included</option>
            </select>
          </Field>
        </div>
        <dl className="kv">
          <dt>Buyer Commission</dt><dd>{basisName(f.buyer_comm_basis)} · {f.buyer_comm_value || '—'}</dd>
          <dt>Supplier Commission</dt><dd>{basisName(f.supplier_comm_basis)} · {f.supplier_comm_value || '—'}</dd>
        </dl>
        <p className="field-hint">Commission type and value come from the Buyers &amp; Suppliers master.</p>
      </fieldset>

      <fieldset disabled={!editable} className="plain-fieldset">
        <h3 className="section-title">People</h3>
        <div className="form-grid">
          <Field id="d-owner" label="Owner">
            <select id="d-owner" value={f.owner_id} onChange={(e) => set('owner_id', e.target.value)}>
              <option value="">—</option>
              {people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </Field>
          <Field id="d-manager" label="Manager" hint="Who approves this deal.">
            <select id="d-manager" value={f.manager_id} onChange={(e) => set('manager_id', e.target.value)}>
              <option value="">—</option>
              {people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </Field>
        </div>
        <Field id="d-notes" label="Remarks">
          <textarea id="d-notes" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </fieldset>

      {missing.length > 0 && editable && <p className="field-hint">Still needed: {missing.join(', ')}.</p>}

      <div className="drawer-actions">
        {deal && canChange && !editMode && (
          <button className="btn" type="button" disabled={busy} onClick={() => setEditMode(true)}>Edit</button>
        )}
        {editable && (!deal || dirty) && (
          <button className="btn primary" type="button" disabled={busy || missing.length > 0} onClick={() => void save()}>
            {busy ? 'Saving…' : deal ? 'Save changes' : 'Create deal'}
          </button>
        )}
        {deal && editable && (
          <button className="btn ghost" type="button" disabled={busy} onClick={() => { setF(toForm(deal, companies, me?.id)); setErr(null); setEditMode(false) }}>Cancel editing</button>
        )}
        {canEdit && deal && ['new_deal', 'reconsider'].includes(deal.status) && (
          <button className="btn primary" type="button" disabled={busy || missing.length > 0} onClick={() => void (dirty ? save('manager_approval') : move('manager_approval'))}>
            {dirty ? 'Save and send for approval' : 'Send for approval'}
          </button>
        )}
        {canEdit && !deal && (
          <button className="btn" type="button" disabled={busy || missing.length > 0} onClick={() => void save('manager_approval')}>
            Create and send for approval
          </button>
        )}
        {deal?.status === 'manager_approval' && canApprove && (
          <>
            <button className="btn primary" type="button" disabled={busy || dirty} onClick={() => void move('approved')} title="Approving creates the Sales Confirmation">Approve</button>
            <button className="btn" type="button" disabled={busy || dirty} onClick={() => void move('reconsider')}>Send back to Reconsider</button>
          </>
        )}
        {deal?.status === 'closed_lost' && canEdit && (
          <button className="btn" type="button" disabled={busy} onClick={() => void move('new_deal')}>Reopen as New Deal</button>
        )}
        {deal && nexts.includes('closed_lost') && (
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void move('closed_lost')}>Close as lost</button>
        )}
        {deal && canDelete && deal.status === 'new_deal' && !deal.sales_confirmation_id && (
          <DeleteControl label="Delete" name={deal.deal_no} busy={busy} onConfirm={() => void remove()} />
        )}
      </div>
      {deal?.status === 'manager_approval' && canApprove && dirty && <p className="field-hint">Save your changes before approving.</p>}


      {deal && approved && !deal.sales_confirmation_id && (
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
      {deal?.sales_confirmation_id && (
        <div className="notice">
          <h3 className="section-title" style={{ marginTop: 0 }}>Sales Confirmation</h3>
          <p className="small">
            <Link className="mono" to={`/sales-confirmations?open=${deal.sales_confirmation_id}`}>{sc?.sc_no ?? '…'}</Link> · send it to the supplier and buyer from there.
          </p>
          {orderId ? (
            <p className="small"><Link to={`/orders?open=${orderId}`}>Open its Dispatch and Billing item</Link></p>
          ) : (
            canOrder && <p><button className="btn" type="button" disabled={busy} onClick={() => void createOrder()}>Create Dispatch and Billing</button></p>
          )}
        </div>
      )}

      {deal && <DealHistory dealId={deal.id} refreshKey={deal.updated_at} />}
      {deal && (
        <ActivityPanel entityType="deal" entityId={deal.id} canWrite={canEdit} kinds={['call', 'email', 'whatsapp', 'meeting', 'note']} title="Updates" />
      )}
      {deal && <p className="muted small">Last updated {formatDateTime(deal.updated_at)}.</p>}
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
        <dt>Contact person 1</dt><dd>{p.contact_person || '—'}{p.mobile ? ` · +91 ${p.mobile}` : ''}</dd>
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
  return v
}

function DealHistory({ dealId, refreshKey }: { dealId: string; refreshKey: string }) {
  const names = useProfileNames()
  const [rows, setRows] = useState<DealChange[] | null>(null)
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
          {rows.map((r) => (
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
    </>
  )
}
