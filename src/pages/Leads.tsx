/** Leads (T-009 record) and Qualify Lead (T-011).
 *
 *  A lead is an inquiry: who is asking (buyer / supplier / both), what yarn
 *  count and how much. Qualifying a lead is the gate before it can become a
 *  deal, and the rules are enforced by a trigger in the database, so this
 *  screen can only ever *attempt* a qualification:
 *
 *    - a count is selected and a quantity is entered
 *    - Party Role = Buyer    -> the party is in the Buyer Master
 *    - Party Role = Supplier -> the party is in the Supplier Master
 *    - Party Role = Both     -> both
 *
 *  If the party is not in a master yet, the Qualify panel lets the user
 *  create the master record there and then, with its required fields. */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LEAD_ROLES, LEAD_STATUSES, LEAD_UOMS } from '../api/types'
import { uomLabel } from '../lib/deals'
import type { Activity, CountRow, Lead, LeadRole, LeadStatus, Station } from '../api/types'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ActivityPanel } from '../components/PartyExtras'
import { LeadQuotationPage } from '../components/LeadQuotation'
import { BoardTabs } from '../components/board/BoardTabs'
import { LeadDocuments } from '../components/LeadDocuments'
import { LeadFormModal } from '../components/LeadFormModal'
import { LeadSubitems, type SubLine } from '../components/LeadSubitems'
import { RowActionMenu, type RowAction } from '../components/RowActionMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { leadPayload, leadProblems, type LeadForm } from '../lib/leadForm'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { ImportIssues, useSelection } from '../components/ListTools'
import { Board, DownloadIcon, StatusPill, ViewSwitch, useStoredState, type BoardColumn, type BoardGroup } from '../components/board/Board'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, pickOne } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage, numOrNull } from '../lib/party'
import { formatDate, formatDateTime } from '../lib/format'

const LEAD_CSV_COLUMNS = [
  'lead_no', 'status', 'lead_type', 'lead_source', 'party_role', 'party_name', 'contact_person', 'mobile_cc', 'mobile', 'station', 'office_address',
  'gst', 'count', 'quantity', 'uom', 'expected_rate', 'timeline', 'timeline_from', 'timeline_to', 'remarks', 'sales_staff',
  'follow_up_date', 'follow_up_at', 'buyer_code', 'supplier_code', 'qualified_at', 'created_at',
] as const

type StaffOption = { id: string; name: string }
type Editing = { mode: 'create' } | { mode: 'edit'; lead: Lead } | null
type Banner = { kind: 'ok' | 'bad'; text: string } | null

/** Board groups, one per lead status, coloured like the other boards. */
const LEAD_GROUPS: BoardGroup[] = [
  { value: 'new', label: 'New Leads', tone: 'blue' },
  { value: 'contacted', label: 'Contacted', tone: 'orange' },
  { value: 'qualified', label: 'Qualified', tone: 'green' },
  { value: 'lost', label: 'Disqualified', tone: 'red' },
]

function statusLabel(status: LeadStatus): string {
  return LEAD_STATUSES.find((s) => s.value === status)?.label ?? status
}

function roleLabel(role: LeadRole): string {
  return LEAD_ROLES.find((r) => r.value === role)?.label ?? role
}

export default function Leads() {
  const { can, me } = useAuth()
  const canManage = can('lead.manage')
  const canQualify = can('lead.qualify')

  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [counts, setCounts] = useState<CountRow[]>([])
  const [subLines, setSubLines] = useState<SubLine[]>([])
  const [supplierNames, setSupplierNames] = useState<Map<string, string>>(new Map())
  const [stations, setStations] = useState<Station[]>([])
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [editing, setEditing] = useState<Editing>(null)
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')
  const [editLead, setEditLead] = useState<Lead | null>(null)
  const [tab, setTab] = useState<'table' | 'quotation'>('table')
  const [quoteLeadId, setQuoteLeadId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Lead | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [qualifying, setQualifying] = useState<Lead | null>(null)
  const [dealPrompt, setDealPrompt] = useState<{ id: string; lead_no: string } | null>(null)
  const [dealBusy, setDealBusy] = useState(false)
  const navigate = useNavigate()

  async function createDeal() {
    if (!dealPrompt) return
    setDealBusy(true)
    const { data, error } = await supabase.rpc('convert_lead_to_deal', { p_lead: dealPrompt.id })
    setDealBusy(false)
    if (error) {
      setDealPrompt(null)
      setBanner({ kind: 'bad', text: errMessage(error, 'Could not create the deal') })
      return
    }
    setDealPrompt(null)
    navigate(`/deals?open=${data as string}`)
  }
  const [statusFilter, setStatusFilter] = useState<'all' | LeadStatus>('all')
  const [ownerFilter, setOwnerFilter] = useStoredState('leads.owner', '')
  const [view, setView] = useStoredState<'table' | 'kanban'>('leads.view', 'table')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [banner, setBanner] = useState<Banner>(null)
  const [busy, setBusy] = useState(false)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)

  const load = useCallback(async () => {
    const [leadRes, countRes, staffRes, stationRes, subRes, supRes] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      supabase.from('count_master').select('*').order('count_no').order('display_name'),
      supabase.from('profiles').select('id, name').eq('is_active', true).order('name'),
      supabase.from('station_master').select('*').order('name'),
      supabase.from('lead_quote_lines').select('lead_id, line_no, count_id, supplier_id, rate, created_by, created_at').order('line_no'),
      supabase.from('supplier_master').select('id, name'),
    ])
    setSubLines((subRes.data ?? []) as SubLine[])
    setSupplierNames(new Map(((supRes.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])))
    setStations((stationRes.data ?? []) as Station[])
    if (leadRes.error) {
      setBanner({ kind: 'bad', text: errMessage(leadRes.error, 'Could not load leads') })
      setLeads([])
    } else {
      setLeads((leadRes.data ?? []) as Lead[])
    }
    setCounts((countRes.data ?? []) as CountRow[])
    setStaff((staffRes.data ?? []) as StaffOption[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // /leads?open=<id> (a reminder notification or the automation log): open that lead's details
  useEffect(() => {
    if (!openId || !leads) return
    const hit = leads.find((l) => l.id === openId)
    if (hit) setEditing({ mode: 'edit', lead: hit })
    setParams({}, { replace: true })
  }, [openId, leads, setParams])

  const countById = useMemo(() => new Map(counts.map((c) => [c.id, c])), [counts])
  const subsByLead = useMemo(() => {
    const m = new Map<string, SubLine[]>()
    for (const s of subLines) m.set(s.lead_id, [...(m.get(s.lead_id) ?? []), s])
    return m
  }, [subLines])
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff])

  /** Adds a station to the Station Master when it is new (case-insensitive).
   *  Returns the spelling to store on the lead. */
  async function ensureStation(raw: string): Promise<string> {
    const name = raw.trim().replace(/\s+/g, ' ')
    if (!name) return ''
    const known = stations.find((st) => st.name.toLowerCase() === name.toLowerCase())
    if (known) return known.name
    const { data, error } = await supabase.from('station_master').insert({ name }).select('*').maybeSingle()
    if (error) {
      if (error.code === '23505') {
        const again = await supabase.from('station_master').select('*').ilike('name', name).maybeSingle()
        if (again.data) {
          setStations((prev) => (prev.some((x) => x.id === again.data.id) ? prev : [...prev, again.data as Station]))
          return (again.data as Station).name
        }
        return name
      }
      throw error
    }
    if (data) setStations((prev) => [...prev, data as Station].sort((a, b) => a.name.localeCompare(b.name)))
    return name
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (leads ?? []).filter((l) => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false
      if (ownerFilter && l.sales_staff_id !== ownerFilter) return false
      if (!q) return true
      const count = l.count_id ? countById.get(l.count_id)?.display_name ?? '' : ''
      return (
        l.lead_no.toLowerCase().includes(q) ||
        l.party_name.toLowerCase().includes(q) ||
        (l.contact_person ?? '').toLowerCase().includes(q) ||
        (l.station ?? '').toLowerCase().includes(q) ||
        count.toLowerCase().includes(q)
      )
    })
  }, [leads, statusFilter, ownerFilter, search, countById])

  const selection = useSelection(useMemo(() => shown.map((l) => l.id), [shown]))

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    const names = new Map((leads ?? []).map((l) => [l.id, l.lead_no]))
    const result = await bulkDelete('leads', selection.chosen)
    setBanner(deleteSummary('lead', 'leads', result, (id) => names.get(id) ?? id))
    selection.clear()
    await load()
    setBusy(false)
  }

  async function exportCSV() {
    setBusy(true)
    const [b, s] = await Promise.all([
      supabase.from('buyer_master').select('id, buyer_code'),
      supabase.from('supplier_master').select('id, supplier_code'),
    ])
    const buyerCode = new Map((b.data ?? []).map((r) => [r.id as string, r.buyer_code as string]))
    const supplierCode = new Map((s.data ?? []).map((r) => [r.id as string, r.supplier_code as string]))
    const list = selection.chosen.length > 0 ? shown.filter((l) => selection.isSelected(l.id)) : shown
    const rows = list.map((l) => ({
      ...l,
      count: l.count_id ? countById.get(l.count_id)?.display_name ?? '' : '',
      sales_staff: l.sales_staff_id ? staffById.get(l.sales_staff_id) ?? '' : '',
      buyer_code: l.buyer_id ? buyerCode.get(l.buyer_id) ?? '' : '',
      supplier_code: l.supplier_id ? supplierCode.get(l.supplier_id) ?? '' : '',
    }))
    downloadCSV(`leads-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(LEAD_CSV_COLUMNS, rows))
    setBusy(false)
  }

  /** Imported leads always start as New: a lead is qualified through the
   *  Qualify panel, never by a file, so the status column is ignored. */
  async function importCSV(file: File) {
    setBusy(true)
    setBanner(null)
    setImportResults(null)
    const [b, s] = await Promise.all([
      supabase.from('buyer_master').select('id, buyer_code'),
      supabase.from('supplier_master').select('id, supplier_code'),
    ])
    const buyerByCode = new Map((b.data ?? []).map((r) => [(r.buyer_code as string).toLowerCase(), r.id as string]))
    const supplierByCode = new Map((s.data ?? []).map((r) => [(r.supplier_code as string).toLowerCase(), r.id as string]))
    const countByName = new Map(counts.map((c) => [c.display_name.toLowerCase(), c.id]))
    const staffByName = new Map(staff.map((x) => [x.name.toLowerCase(), x.id]))

    const outcome = await importCsvFile(
      file,
      (r) => r.get('party_name'),
      async (r) => {
        const role = (r.get('party_role').toLowerCase() || 'buyer') as LeadRole
        if (!LEAD_ROLES.some((x) => x.value === role)) throw new Error('Party role must be buyer, supplier or both')

        const countName = r.get('count')
        const countId = countName ? countByName.get(countName.toLowerCase()) : undefined
        if (countName && !countId) throw new Error(`Count "${countName}" is not in the Count Master`)

        const staffName = r.get('sales_staff')
        const staffId = staffName ? staffByName.get(staffName.toLowerCase()) : me?.id
        if (staffName && !staffId) throw new Error(`Sales staff "${staffName}" is not an active user`)

        const buyerCodeCell = r.get('buyer_code')
        const buyerId = buyerCodeCell ? buyerByCode.get(buyerCodeCell.toLowerCase()) : undefined
        if (buyerCodeCell && !buyerId) throw new Error(`Buyer code "${buyerCodeCell}" is not in the Buyer Master`)
        const supplierCodeCell = r.get('supplier_code')
        const supplierId = supplierCodeCell ? supplierByCode.get(supplierCodeCell.toLowerCase()) : undefined
        if (supplierCodeCell && !supplierId) throw new Error(`Supplier code "${supplierCodeCell}" is not in the Supplier Master`)

        const quantity = r.get('quantity')
        const stationName = await ensureStation(r.get('station'))
        const followDate = r.get('follow_up_date')
        const form: LeadForm = {
          lead_type: buyerId || supplierId ? 'existing' : 'new',
          lead_source: r.get('lead_source'),
          party_role: role,
          party_name: r.get('party_name'),
          contact_person: r.get('contact_person'),
          mobile_cc: r.get('mobile_cc') || '+91',
          mobile: r.get('mobile').replace(/\D/g, ''),
          station: stationName,
          office_address: r.get('office_address'),
          gst: r.get('gst').toUpperCase().replace(/\s+/g, ''),
          buyer_id: buyerId ?? '',
          supplier_id: supplierId ?? '',
          count_id: countId ?? '',
          quantity,
          uom: pickOne('UOM', r.get('uom'), LEAD_UOMS) || (quantity ? 'KG' : ''),
          expected_rate: r.get('expected_rate'),
          timeline: r.get('timeline'),
          timeline_from: r.get('timeline_from'),
          timeline_to: r.get('timeline_to'),
          remarks: r.get('remarks'),
          sales_staff_id: staffId ?? '',
          follow_up_at: /^\d{4}-\d{2}-\d{2}$/.test(followDate) ? `${followDate}T10:00` : '',
          entry_weaves_yarn: '', entry_payment_cycle: '', entry_current_supplier: '', entry_price_range: '', entry_next_purchase: '',
        }
        const missing = leadProblems(form).filter((m) => !m.startsWith('Buyer from') && !m.startsWith('Supplier from'))
        if (form.expected_rate && numOrNull(form.expected_rate) === null) missing.push('Expected rate (a number)')
        if (followDate && !/^\d{4}-\d{2}-\d{2}$/.test(followDate)) missing.push('Follow-up date (YYYY-MM-DD)')
        for (const [k, v] of [['timeline_from', form.timeline_from], ['timeline_to', form.timeline_to]] as const) {
          if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) missing.push(`${k} (YYYY-MM-DD)`)
        }
        if (missing.length > 0) throw new Error(`Needs: ${missing.join(', ')}`)

        const { error } = await supabase
          .from('leads')
          .insert({ ...leadPayload(form), status: 'new', buyer_id: buyerId ?? null, supplier_id: supplierId ?? null })
        if (error) throw error
      },
    )
    if ('error' in outcome) setBanner({ kind: 'bad', text: outcome.error })
    else {
      setImportResults(outcome.results)
      setBanner(importSummary(outcome.results))
      await load()
    }
    setBusy(false)
  }

  function openQuotation(l: Lead) {
    setEditing(null)
    setQuoteLeadId(l.id)
    setTab('quotation')
  }

  async function deleteLead() {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    // the lead's files and quotation PDFs live in storage; remember them to clear after the delete
    const [docs, quotes] = await Promise.all([
      supabase.from('lead_documents').select('storage_path').eq('lead_id', deleting.id),
      supabase.from('lead_quotations').select('storage_path').eq('lead_id', deleting.id),
    ])
    const { data, error } = await supabase.from('leads').delete().eq('id', deleting.id).select('id')
    setDeleteBusy(false)
    if (error || !data || data.length === 0) {
      setDeleteError(error ? errMessage(error, 'Could not delete this lead') : 'Your account cannot delete this lead.')
      return
    }
    const paths = (rows: { data: unknown }) => ((rows.data ?? []) as { storage_path: string | null }[]).map((r) => r.storage_path).filter((p): p is string => !!p)
    if (paths(docs).length) void supabase.storage.from('lead-documents').remove(paths(docs))
    if (paths(quotes).length) void supabase.storage.from('lead-quotations').remove(paths(quotes))
    setBanner({ kind: 'ok', text: `${deleting.lead_no} deleted.` })
    setDeleting(null)
    await load()
  }

  if (!leads) return <Loading label="Loading leads" />

  // a lead that has become a deal is read-only (the database refuses changes to it)
  const lockedIds = new Set(leads.filter((l) => l.converted_deal_id).map((l) => l.id))


  /** Row Actions, in the Pharma ERP order: read, edit, status moves, destructive last.
   *  An item that cannot be used stays visible with the reason. */
  function actionsFor(l: Lead): RowAction[] {
    const converted = Boolean(l.converted_deal_id)
    const open = (l.status === 'new' || l.status === 'contacted') && !converted
    const items: RowAction[] = [
      { label: 'View details', onSelect: () => setEditing({ mode: 'edit', lead: l }) },
      { label: 'Edit', onSelect: () => setEditLead(l), disabledReason: !canManage ? 'You need the "Manage leads" permission.' : converted ? 'This lead has been converted to a deal, so it is read-only.' : null },
    ]
    items.push({ label: 'Quotation', onSelect: () => openQuotation(l) })
    if (converted && can('deal.read')) items.push({ label: 'Go to deal', onSelect: () => navigate(`/deals?open=${l.converted_deal_id}`) })
    if (canQualify && open) items.push({ label: 'Qualify…', onSelect: () => setQualifying(l) })
    items.push({
      label: 'Delete', tone: 'danger',
      onSelect: () => { setDeleteError(null); setDeleting(l) },
      disabledReason: !canManage ? 'You need the "Manage leads" permission.' : converted ? 'This lead has a deal, so it cannot be deleted.' : null,
    })
    return items
  }

  const columns: BoardColumn<Lead>[] = [
    { key: 'no', label: 'Lead', width: 130, render: (l) => <span className="mono">{l.lead_no}</span> },
    {
      key: 'party', label: 'Party',
      render: (l) => (
        <>
          <strong>{l.party_name}</strong>
          <span className="chip" style={{ marginLeft: 8 }}>{roleLabel(l.party_role)}</span>
          {l.station && <div className="small muted">{l.station}</div>}
        </>
      ),
    },
    { key: 'count', label: 'Count', render: (l) => <span className="small">{(l.count_id ? countById.get(l.count_id)?.display_name : '') || <span className="muted">—</span>}</span> },
    { key: 'qty', label: 'Quantity', align: 'right', render: (l) => <span className="mono">{l.quantity !== null ? `${l.quantity} ${l.uom ?? ''}` : '—'}</span> },
    {
      key: 'status', label: 'Status', width: 150,
      render: (l) => (
        <>
          <StatusPill label={statusLabel(l.status)} tone={LEAD_GROUPS.find((g) => g.value === l.status)?.tone ?? 'grey'} />
          {l.converted_deal_id && <div className="small muted" style={{ marginTop: 2 }}>Converted to deal</div>}
        </>
      ),
    },
    { key: 'follow', label: 'Follow-up', render: (l) => <span className="mono small">{formatDate(l.follow_up_date)}</span> },
    { key: 'staff', label: 'Sales staff', render: (l) => <span className="small">{l.sales_staff_id ? staffById.get(l.sales_staff_id) ?? '—' : '—'}</span> },
    {
      key: 'action', label: 'Actions', interactive: true, pinRight: true,
      render: (l) => <RowActionMenu label={`Actions for ${l.lead_no}`} actions={actionsFor(l)} />,
    },
  ]

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Leads</h1>
          <p className="page-sub">
            Every inquiry, until it is qualified and ready to become a deal. A lead can be qualified
            only once its count, quantity and Buyer / Supplier Master records are in place.
          </p>
        </div>
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
            + New lead
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

      <BoardTabs tabs={[{ key: 'table', label: 'Main table' }, { key: 'quotation', label: 'Lead-Quotation' }]} active={tab} onChange={(k) => { setTab(k as 'table' | 'quotation'); if (k === 'table') void load() }} />

      {tab === 'quotation' && (
        <LeadQuotationPage key={quoteLeadId ?? 'none'} leads={leads} counts={counts} canEdit={canManage} initialLeadId={quoteLeadId} />
      )}

      {tab === 'table' && (
        <>
      <ImportIssues results={importResults} />

      <FollowUps leads={leads} onOpen={(l) => canManage && setEditing({ mode: 'edit', lead: l })} />

      <div className="board-toolbar">
        <ViewSwitch view={view} onChange={setView} />
        <input
          className="toolbar-search"
          aria-label="Search leads"
          placeholder="Search lead no., party, station or count"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | LeadStatus)}>
          <option value="all">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select aria-label="Owner" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="">All owners</option>
          {me && <option value={me.id}>My leads</option>}
          {staff.filter((p) => p.id !== me?.id).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        {canManage && (
          <>
            <input
              ref={importInput}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void importCSV(file)
              }}
            />
            <button className="btn sm" type="button" disabled={busy} onClick={() => importInput.current?.click()}>Import CSV</button>
          </>
        )}
        <button className="btn sm" type="button" disabled={shown.length === 0 || busy} onClick={() => void exportCSV()}>
          <DownloadIcon />{`Export ${selection.chosen.length > 0 ? `${selection.chosen.length} selected` : shown.length === leads.length ? 'all' : `${shown.length} shown`}`}
        </button>
        <span className="push" />
        {canManage && selection.chosen.length > 0 && (
          confirmDelete ? (
            <span className="toolbar-confirm">
              <span className="field-warn">Delete {selection.chosen.length} selected? This can’t be undone.</span>
              <button className="btn danger sm" type="button" disabled={busy} onClick={async () => { await deleteSelected(); setConfirmDelete(false) }}>
                {busy ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button className="btn ghost sm" type="button" onClick={() => setConfirmDelete(false)}>No</button>
            </span>
          ) : (
            <button className="btn danger sm" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete {selection.chosen.length} selected</button>
          )
        )}
      </div>

      <Board
        rows={shown}
        groups={LEAD_GROUPS}
        groupOf={(l) => l.status}
        columns={columns}
        rowKey={(l) => l.id}
        onOpen={(l) => canManage && setEditing({ mode: 'edit', lead: l })}
        rowOpens={false}
        expandable={{
          count: (l) => subsByLead.get(l.id)?.length ?? 0,
          render: (l) => (
            <LeadSubitems
              lines={subsByLead.get(l.id) ?? []}
              countName={new Map(counts.map((c) => [c.id, c.display_name]))}
              supplierName={supplierNames}
              canEdit={canManage && !lockedIds.has(l.id)}
              onEdit={() => openQuotation(l)}
            />
          ),
        }}
        view={view}
        selection={canManage ? { isSelected: selection.isSelected, toggle: selection.toggle } : undefined}
        emptyText={leads.length === 0 ? `No leads yet.${canManage ? ' Add the first inquiry.' : ''}` : 'No lead matches that filter.'}
        card={(l) => (
          <>
            <span className="kcard-top">
              <span className="mono small">{l.lead_no}</span>
              <span className="small muted">{formatDate(l.follow_up_date)}</span>
              <RowActionMenu label={`Actions for ${l.lead_no}`} actions={actionsFor(l)} />
            </span>
            <strong className="kcard-title">{l.party_name}</strong>
            <span className="small muted">{(l.count_id ? countById.get(l.count_id)?.display_name : '') || 'no count'}</span>
            <span className="kcard-foot mono small">
              <span>{l.quantity !== null ? `${l.quantity} ${l.uom ?? ''}` : '—'}</span>
              <span>{l.sales_staff_id ? staffById.get(l.sales_staff_id) ?? '' : ''}</span>
            </span>
          </>
        )}
      />
        </>
      )}

      {(editing?.mode === 'create' || editLead) && canManage && (
        <LeadFormModal
          key={editLead?.id ?? 'create'}
          counts={counts}
          stations={stations}
          ensureStation={ensureStation}
          defaultStaffId={me?.id ?? null}
          leads={leads}
          lockedIds={lockedIds}
          initialLead={editLead}
          onClose={() => { setEditing(null); setEditLead(null) }}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            setEditLead(null)
            await load()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete lead"
          confirmLabel="Delete"
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void deleteLead()}
          onClose={() => setDeleting(null)}
        >
          Are you sure you want to delete this lead? <strong>{deleting.lead_no} · {deleting.party_name}</strong>
          <p className="small muted" style={{ marginTop: 8 }}>This cannot be undone.</p>
        </ConfirmDialog>
      )}

      {editing?.mode === 'edit' && (
        <LeadDetails
          key={editing.lead.id}
          lead={editing.lead}
          counts={counts}
          staff={staff}
          locked={lockedIds.has(editing.lead.id)}
          canQualify={canQualify}
          onClose={() => setEditing(null)}
          onQualify={(lead) => {
            setEditing(null)
            setQualifying(lead)
          }}
          onEdit={(lead) => {
            setEditing(null)
            setEditLead(lead)
          }}
          onQuote={openQuotation}
          onRefresh={load}
        />
      )}

      {dealPrompt && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card pad" role="dialog" aria-modal="true" aria-label="Create a deal" style={{ maxWidth: 420, width: 'calc(100% - 32px)' }}>
            <h3 className="section-title" style={{ marginTop: 0 }}>Deal created</h3>
            <p>{dealPrompt.lead_no} is now Qualified, and its deal was created as a New Deal. Add the supplier and the final rate there.</p>
            <div className="drawer-actions">
              <button className="btn primary" type="button" onClick={() => void createDeal()} disabled={dealBusy}>
                {dealBusy ? 'Opening…' : 'Open the deal'}
              </button>
              <button className="btn ghost" type="button" onClick={() => setDealPrompt(null)} disabled={dealBusy}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {qualifying && canQualify && (
        <QualifyPanel
          key={qualifying.id}
          lead={qualifying}
          counts={counts}
          onClose={() => setQualifying(null)}
          onDone={async (text, leadId) => {
            const done = qualifying
            setBanner({ kind: 'ok', text })
            setQualifying(null)
            await load()
            if (can('deal.read') && done) setDealPrompt({ id: leadId, lead_no: done.lead_no })
          }}
        />
      )}
    </>
  )
}

const CYCLE_LABEL: Record<string, string> = { '7_days': '7 days', '30_days': '30 days', '60_days': '60 days', advance: 'Advance' }

/** The lead's details, read-only. Changing the lead is Actions > Edit (the pop-up form), so this
 *  view carries what the form does not: documents, quotation, discussion and history. */
function LeadDetails({
  lead: initial,
  counts,
  staff,
  locked,
  canQualify,
  onClose,
  onQualify,
  onEdit,
  onQuote,
  onRefresh,
}: {
  lead: Lead
  counts: CountRow[]
  staff: StaffOption[]
  locked: boolean
  canQualify: boolean
  onClose: () => void
  onQualify: (lead: Lead) => void
  onEdit: (lead: Lead) => void
  onQuote: (lead: Lead) => void
  onRefresh: () => Promise<void>
}) {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [lead, setLead] = useState<Lead>(initial)
  const [dealNo, setDealNo] = useState<string | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [convertOpen, setConvertOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)

  useEffect(() => {
    const id = lead.converted_deal_id
    if (!id) return
    void supabase.from('crm_deals').select('deal_no').eq('id', id).maybeSingle()
      .then(({ data }) => setDealNo((data as { deal_no: string } | null)?.deal_no ?? null))
  }, [lead.converted_deal_id])

  /** Re-reads the lead after a change made by the database (discussion log, conversion). */
  async function reloadLead() {
    const { data } = await supabase.from('leads').select('*').eq('id', lead.id).maybeSingle()
    if (data) setLead(data as Lead)
    setHistoryKey((k) => k + 1)
    await onRefresh()
  }

  async function convert() {
    setBusy(true)
    setConvertError(null)
    const { data, error } = await supabase.rpc('convert_lead_to_deal', { p_lead: lead.id })
    setBusy(false)
    if (error) {
      setConvertError(errMessage(error, 'Could not convert this lead'))
      return
    }
    await onRefresh()
    navigate(`/deals?open=${data as string}`)
  }

  const count = counts.find((c) => c.id === lead.count_id)
  const owner = staff.find((x) => x.id === lead.sales_staff_id)
  const qualified = lead.status === 'qualified'
  const open = (lead.status === 'new' || lead.status === 'contacted') && !lead.converted_deal_id
  const canConvert = can('deal.create') && qualified && !lead.converted_deal_id
  const rows: [string, string | null][] = [
    ['Type', lead.lead_type === 'existing' ? 'Existing' : 'New'],
    ['Lead source', lead.lead_source],
    ['Party role', roleLabel(lead.party_role)],
    ['Contact person', lead.contact_person],
    ['Phone', lead.mobile ? `${lead.mobile_cc ?? '+91'} ${lead.mobile}` : null],
    ['Station', lead.station],
    ['GST', lead.gst],
    ['Office address', lead.office_address],
    ['Count', count?.display_name ?? null],
    ['Quantity', lead.quantity !== null ? `${lead.quantity} ${uomLabel(lead.uom ?? '')}`.trim() : null],
    ['Expected rate', lead.expected_rate !== null ? String(lead.expected_rate) : null],
    ['Timeline', lead.timeline_from || lead.timeline_to ? `${formatDate(lead.timeline_from)} → ${formatDate(lead.timeline_to)}` : lead.timeline],
    ['Follow-up', lead.follow_up_at ? formatDateTime(lead.follow_up_at) : null],
    ['Lead owner', owner?.name ?? null],
    ['Weaving yarn buyer', lead.entry_weaves_yarn === 'yes' ? 'Yes' : lead.entry_weaves_yarn === 'no' ? 'No' : null],
    ['Payment cycle', lead.entry_payment_cycle ? CYCLE_LABEL[lead.entry_payment_cycle] ?? lead.entry_payment_cycle : null],
    ['Currently buying from', lead.entry_current_supplier],
    ['Purchase price range', lead.entry_price_range],
    ['Next purchase', lead.entry_next_purchase ? formatDate(lead.entry_next_purchase) : null],
    ['Remarks', lead.remarks],
    ['Created', formatDateTime(lead.created_at)],
  ]

  return (
    <Drawer title={`${lead.lead_no} · ${lead.party_name}`} onClose={onClose}>
      <p className="small">
        <StatusPill label={statusLabel(lead.status)} tone={LEAD_GROUPS.find((g) => g.value === lead.status)?.tone ?? 'grey'} />
        {qualified && lead.qualified_at && <span className="muted"> · qualified {formatDateTime(lead.qualified_at)}</span>}
        {lead.converted_deal_id && <span className="muted"> · converted to {dealNo ?? 'a deal'}</span>}
      </p>
      {locked && (
        <div className="notice small">This lead has been converted to a deal and is read-only. Change the deal instead.</div>
      )}
      <dl className="kv">
        {rows.filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
          <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
        ))}
      </dl>
      <div className="drawer-actions">
        <button className="btn" type="button" disabled={locked} title={locked ? 'This lead has been converted to a deal, so it is read-only.' : undefined} onClick={() => onEdit(lead)}>Edit</button>
        {canQualify && open && <button className="btn" type="button" onClick={() => onQualify(lead)}>Qualify…</button>}
        <button className="btn" type="button" onClick={() => onQuote(lead)}>Quotation</button>
        {canConvert && <button className="btn" type="button" onClick={() => { setConvertError(null); setConvertOpen(true) }}>Convert to deal…</button>}
        {lead.converted_deal_id && can('deal.read') && <button className="btn" type="button" onClick={() => navigate(`/deals?open=${lead.converted_deal_id}`)}>Go to deal</button>}
        <button className="btn ghost" type="button" onClick={onClose}>Close</button>
      </div>
      <LeadDocuments leadId={lead.id} canEdit={!locked} />
      {!locked && <DiscussionPanel lead={lead} onLogged={reloadLead} />}
      <ActivityPanel entityType="lead" entityId={lead.id} canWrite={!locked} title="Discussion history, notes and tasks" refreshKey={historyKey} />
      {convertOpen && (
        <ConfirmDialog
          title={`Convert ${lead.lead_no} to a deal?`}
          confirmLabel="Create the deal"
          busy={busy}
          error={convertError}
          onConfirm={() => void convert()}
          onClose={() => setConvertOpen(false)}
        >
          The deal is created from this lead, and the lead becomes read-only.
        </ConfirmDialog>
      )}
    </Drawer>
  )
}

/* ---- qualify a lead (T-011) ------------------------------------------------- */

/** Qualifying never asks for Contact or Company details. The one thing it asks
 *  is the Contact's Role, because that must be chosen, never assumed. The
 *  database then finds or creates the Company and the Contact from whatever the
 *  lead holds (anything missing is left empty and the Contact is flagged
 *  incomplete). Count and quantity are the lead's own prerequisites and are only
 *  asked for here when the lead does not have them yet. */
function QualifyPanel({
  lead,
  counts,
  onClose,
  onDone,
}: {
  lead: Lead
  counts: CountRow[]
  onClose: () => void
  onDone: (message: string, leadId: string) => void | Promise<void>
}) {
  const roles: { value: 'buyer' | 'supplier' | 'both'; label: string }[] = [
    { value: 'buyer', label: 'Buyer' },
    { value: 'supplier', label: 'Supplier' },
  ]
  if (lead.party_role === 'both') roles.push({ value: 'both', label: 'Both' })

  const [role, setRole] = useState<'' | 'buyer' | 'supplier' | 'both'>('')
  const [countId, setCountId] = useState(lead.count_id ?? '')
  const [quantity, setQuantity] = useState(lead.quantity === null ? '' : String(lead.quantity))
  const [uom, setUom] = useState(lead.uom ?? 'KG')
  const [units, setUnits] = useState<{ id: string; name: string }[] | null>(null)
  const [companyId, setCompanyId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The Business Unit is chosen, never created here. One that matches the lead's name is picked for you.
  useEffect(() => {
    let alive = true
    void supabase.from('companies').select('id,name').eq('is_active', true).order('name').then(({ data }) => {
      if (!alive) return
      const list = (data ?? []) as { id: string; name: string }[]
      setUnits(list)
      const hit = list.find((c) => c.name.trim().toLowerCase() === lead.party_name.trim().toLowerCase())
      if (hit) setCompanyId(hit.id)
    })
    return () => { alive = false }
  }, [lead.party_name])

  const needsProduct = !lead.count_id || lead.quantity === null || lead.quantity <= 0
  const qtyNumber = numOrNull(quantity)
  const productReady = !needsProduct || (countId !== '' && qtyNumber !== null && qtyNumber > 0 && uom !== '')

  async function qualify() {
    if (role === '' || companyId === '') return
    setBusy(true)
    setError(null)
    try {
      if (needsProduct) {
        const { error: e } = await supabase.from('leads').update({ count_id: countId, quantity: qtyNumber, uom }).eq('id', lead.id)
        if (e) throw e
      }
      const { data, error: e } = await supabase.rpc('qualify_lead_auto', { p_lead: lead.id, p_role: role, p_company: companyId })
      if (e) throw e
      const res = data as { created?: string[]; incomplete?: boolean } | null
      const created = res?.created ?? []
      await onDone(
        `${lead.lead_no} is now Qualified.${created.length ? ` Created ${created.join(', ')}.` : ' Linked to existing records.'}${
          res?.incomplete ? ' The Contact has missing details -- it is marked "Incomplete" in Contacts.' : ''
        }`,
        lead.id,
      )
    } catch (caught) {
      setError(errMessage(caught, 'Could not qualify this lead'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
      <div className="card pad" role="dialog" aria-modal="true" aria-label={`Qualify ${lead.lead_no}`} style={{ maxWidth: 440, width: 'calc(100% - 32px)' }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>Qualify {lead.lead_no}</h3>
        <p className="muted small">
          {lead.party_name}. The Contact is created from the lead. Choose its role and the Business Unit it belongs to.
        </p>

        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        <Field id="q-role" label="Role" required>
          <select id="q-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="">Choose…</option>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        <Field id="q-unit" label="Business Unit" required hint={units && units.length === 0 ? 'There is no active Business Unit yet. Add one in Master Data > Business Units first.' : undefined}>
          <select id="q-unit" value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={units === null}>
            <option value="">{units === null ? 'Loading…' : 'Choose…'}</option>
            {(units ?? []).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </Field>

        {needsProduct && (
          <>
            <p className="field-hint">This lead still needs its product details before it can be qualified.</p>
            <div className="form-grid">
              <Field id="q-count" label="Count" required>
                <select id="q-count" value={countId} onChange={(e) => setCountId(e.target.value)}>
                  <option value="">Choose…</option>
                  {counts
                    .filter((c) => c.is_active || c.id === countId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.display_name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field id="q-qty" label="Quantity" required>
                <input id="q-qty" inputMode="decimal" className="mono" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
              <Field id="q-uom" label="UOM" required>
                <select id="q-uom" value={uom} onChange={(e) => setUom(e.target.value)}>
                  {LEAD_UOMS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}

        <div className="drawer-actions">
          <button className="btn primary" type="button" onClick={() => void qualify()} disabled={busy || role === '' || companyId === '' || !productReady}>
            {busy ? 'Qualifying…' : 'Qualify this lead'}
          </button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---- station picker, discussion log, follow-ups ------------------------------ */

/** T-010: record what was discussed with the party. One database function
 *  stores the note with the user and time, applies any new quantity / rate /
 *  timeline, moves a New lead to Contacted and can create a follow-up task. */
function DiscussionPanel({ lead, onLogged }: { lead: Lead; onLogged: () => Promise<void> }) {
  const [note, setNote] = useState('')
  const [qty, setQty] = useState('')
  const [rate, setRate] = useState('')
  const [timeline, setTimeline] = useState('')
  const [task, setTask] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function log() {
    setMsg(null)
    if (!note.trim()) return setMsg('Write what was discussed.')
    if (qty && (numOrNull(qty) === null || Number(qty) <= 0)) return setMsg('Quantity must be a number above zero.')
    if (rate && (numOrNull(rate) === null || Number(rate) < 0)) return setMsg('Rate must be a number.')
    if (task.trim() && !due) return setMsg('Pick a due date for the follow-up task.')
    setBusy(true)
    const { error } = await supabase.rpc('log_lead_discussion', {
      p_lead: lead.id,
      p_note: note.trim(),
      p_quantity: numOrNull(qty),
      p_rate: numOrNull(rate),
      p_timeline: timeline.trim() || null,
      p_task_note: task.trim() || null,
      p_task_due: task.trim() ? due : null,
    })
    setBusy(false)
    if (error) return setMsg(errMessage(error, 'Could not save the discussion'))
    setNote(''); setQty(''); setRate(''); setTimeline(''); setTask(''); setDue('')
    await onLogged()
  }

  return (
    <section className="card pad" style={{ marginTop: 16 }}>
      <h3 className="card-title" style={{ marginTop: 0 }}>Log a discussion</h3>
      <p className="muted small">
        Saving moves a New lead to Contacted. Fill in quantity, rate or timeline only if they changed.
      </p>
      <textarea aria-label="What was discussed" rows={3} placeholder="What was discussed" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="form-grid" style={{ marginTop: 8 }}>
        <input aria-label="New quantity" inputMode="decimal" className="mono" placeholder={`Quantity (now ${lead.quantity ?? '—'})`} value={qty} onChange={(e) => setQty(e.target.value)} />
        <input aria-label="New rate" inputMode="decimal" className="mono" placeholder={`Rate (now ${lead.expected_rate ?? '—'})`} value={rate} onChange={(e) => setRate(e.target.value)} />
        <input aria-label="New timeline" placeholder={`Timeline (now ${lead.timeline || '—'})`} value={timeline} onChange={(e) => setTimeline(e.target.value)} />
      </div>
      <div className="form-grid" style={{ marginTop: 8 }}>
        <input aria-label="Follow-up task" placeholder="Follow-up task (optional)" value={task} onChange={(e) => setTask(e.target.value)} />
        <input aria-label="Task due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <button className="btn sm" type="button" style={{ marginTop: 8 }} disabled={busy} onClick={() => void log()}>
        {busy ? 'Saving…' : 'Save discussion'}
      </button>
      {msg && <p className="field-warn">{msg}</p>}
    </section>
  )
}

/** T-010 follow-up reminders: open tasks that are overdue or due within a
 *  week, and open leads nobody has touched for 14 days. */
function FollowUps({ leads, onOpen }: { leads: Lead[]; onOpen: (lead: Lead) => void }) {
  const [tasks, setTasks] = useState<Activity[]>([])
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const weekAhead = iso(new Date(today.getTime() + 7 * 86400000))
  const quietBefore = today.getTime() - 14 * 86400000

  useEffect(() => {
    void supabase
      .from('activity_log')
      .select('*')
      .eq('entity_type', 'lead')
      .in('kind', ['task', 'reminder'])
      .eq('is_done', false)
      .lte('due_date', weekAhead)
      .order('due_date')
      .then(({ data }) => setTasks((data ?? []) as Activity[]))
  }, [weekAhead, leads])

  const byId = new Map(leads.map((l) => [l.id, l]))
  const open = leads.filter((l) => (l.status === 'new' || l.status === 'contacted') && !l.converted_deal_id)
  const quiet = open.filter((l) => new Date(l.updated_at).getTime() < quietBefore)
  const dueLeads = open.filter((l) => l.follow_up_date && l.follow_up_date <= weekAhead)
  const total = tasks.length + quiet.length + dueLeads.length
  if (total === 0) return null
  const todayIso = iso(today)

  return (
    <details className="followups" open>
      <summary>Follow-ups <span className="muted small">({total})</span></summary>
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
        {tasks.map((t) => {
          const l = byId.get(t.entity_id)
          return (
            <li key={t.id} style={{ padding: '4px 0' }}>
              <span className={`chip ${t.due_date && t.due_date < todayIso ? 'bad' : 'warn'}`}>Task · {formatDate(t.due_date)}</span>{' '}
              {l ? (
                <button className="btn ghost sm" type="button" onClick={() => onOpen(l)}>{l.lead_no} · {l.party_name}</button>
              ) : null}{' '}
              <span className="small">{t.note}</span>
            </li>
          )
        })}
        {dueLeads.map((l) => (
          <li key={`d-${l.id}`} style={{ padding: '4px 0' }}>
            <span className={`chip ${l.follow_up_date! < todayIso ? 'bad' : 'warn'}`}>Follow-up · {formatDate(l.follow_up_date)}</span>{' '}
            <button className="btn ghost sm" type="button" onClick={() => onOpen(l)}>{l.lead_no} · {l.party_name}</button>
          </li>
        ))}
        {quiet.map((l) => (
          <li key={`q-${l.id}`} style={{ padding: '4px 0' }}>
            <span className="chip">No update in 14+ days</span>{' '}
            <button className="btn ghost sm" type="button" onClick={() => onOpen(l)}>{l.lead_no} · {l.party_name}</button>
          </li>
        ))}
      </ul>
    </details>
  )
}