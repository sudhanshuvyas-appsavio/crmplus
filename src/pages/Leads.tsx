/** Leads (T-009 record) and Qualify Lead (T-011).
 *
 *  A lead is an inquiry from a buyer: what yarn count and how much. Qualifying a
 *  lead is the gate before it can become a deal, and the rules are enforced by a
 *  trigger in the database, so this screen can only ever *attempt* a qualification:
 *
 *    - a count is selected and a quantity is entered
 *    - Qualify is one click: the buyer is added to Buyers & Suppliers under the home
 *      Business Unit (or the existing buyer's own), and a Draft deal is created. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LEAD_STATUSES, LEAD_UOMS } from '../api/types'
import type { Activity, CountRow, Lead, LeadRole, LeadStatus, Station } from '../api/types'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LeadQuotationPage } from '../components/LeadQuotation'
import { BoardTabs } from '../components/board/BoardTabs'
import { LeadFormModal } from '../components/LeadFormModal'
import { LeadSubitems, type SubLine } from '../components/LeadSubitems'
import { RowActionMenu, type RowAction } from '../components/RowActionMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { leadPayload, leadProblems, type LeadForm } from '../lib/leadForm'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { ImportIssues, useSelection } from '../components/ListTools'
import { Board, PersonCell, DownloadIcon, StatusPill, ViewSwitch, useStoredState, type BoardColumn, type BoardGroup } from '../components/board/Board'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, pickOne } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage, numOrNull } from '../lib/party'
import { formatDate, formatShortDate } from '../lib/format'

const LEAD_CSV_COLUMNS = [
  'lead_no', 'status', 'lead_type', 'lead_source', 'party_role', 'party_name', 'contact_person', 'mobile_cc', 'mobile', 'station', 'office_address',
  'gst', 'count', 'quantity', 'uom', 'expected_rate', 'timeline', 'timeline_from', 'timeline_to', 'remarks', 'sales_staff',
  'follow_up_date', 'follow_up_at', 'buyer_code', 'qualified_at', 'created_at',
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
  const [qualifyBusy, setQualifyBusy] = useState(false)
  const [dealPrompt, setDealPrompt] = useState<{ id: string; lead_no: string } | null>(null)
  const [dealBusy, setDealBusy] = useState(false)
  const [convertPrompt, setConvertPrompt] = useState<{ id: string; lead_no: string } | null>(null)
  const [convertBusy, setConvertBusy] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function convertToDeal() {
    if (!convertPrompt) return
    setConvertBusy(true)
    setConvertError(null)
    const { data, error } = await supabase.rpc('convert_lead_to_deal', { p_lead: convertPrompt.id })
    setConvertBusy(false)
    if (error) { setConvertError(errMessage(error, 'Could not convert this lead')); return }
    setConvertPrompt(null)
    await load()
    navigate(`/deals?open=${data as string}`)
  }

  /** Qualify in one click, like monday's status change: the lead becomes a buyer in Buyers & Suppliers
   *  and its deal is created. The buyer keeps its own Business Unit if it already has one; a new buyer
   *  gets the home company, which can be changed later on the buyer. */
  async function qualify(l: Lead) {
    if (qualifyBusy) return
    if (!l.count_id || l.quantity === null || l.quantity <= 0) {
      setBanner({ kind: 'bad', text: `${l.lead_no} needs a count and a quantity before it can be qualified. Use Edit to add them.` })
      return
    }
    setQualifyBusy(true)
    setBanner(null)
    try {
      let unit: string | null = null
      if (l.buyer_id) unit = ((await supabase.from('buyer_master').select('company_id').eq('id', l.buyer_id).maybeSingle()).data as { company_id: string | null } | null)?.company_id ?? null
      if (!unit) unit = ((await supabase.from('companies').select('id').eq('is_home', true).eq('is_active', true).limit(1).maybeSingle()).data as { id: string } | null)?.id ?? null
      if (!unit) {
        setBanner({ kind: 'bad', text: 'No home company is set. Mark the agency’s own Business Unit as the home company first.' })
        return
      }
      const { data, error } = await supabase.rpc('qualify_lead_auto', { p_lead: l.id, p_role: 'buyer', p_company: unit })
      if (error) { setBanner({ kind: 'bad', text: errMessage(error, 'Could not qualify this lead') }); return }
      const res = data as { created?: string[]; incomplete?: boolean } | null
      const created = res?.created ?? []
      setBanner({ kind: 'ok', text: `${l.lead_no} is now Qualified.${created.length ? ` Created ${created.join(', ')}.` : ''}${res?.incomplete ? ' The buyer has missing details and is marked "Incomplete" in Buyers & Suppliers.' : ''}` })
      await load()
      if (can('deal.read')) setDealPrompt({ id: l.id, lead_no: l.lead_no })
    } finally {
      setQualifyBusy(false)
    }
  }

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
    const b = await supabase.from('buyer_master').select('id, buyer_code')
    const buyerCode = new Map((b.data ?? []).map((r) => [r.id as string, r.buyer_code as string]))
    const list = selection.chosen.length > 0 ? shown.filter((l) => selection.isSelected(l.id)) : shown
    const rows = list.map((l) => ({
      ...l,
      count: l.count_id ? countById.get(l.count_id)?.display_name ?? '' : '',
      sales_staff: l.sales_staff_id ? staffById.get(l.sales_staff_id) ?? '' : '',
      buyer_code: l.buyer_id ? buyerCode.get(l.buyer_id) ?? '' : '',
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
    const b = await supabase.from('buyer_master').select('id, buyer_code')
    const buyerByCode = new Map((b.data ?? []).map((r) => [(r.buyer_code as string).toLowerCase(), r.id as string]))
    const countByName = new Map(counts.map((c) => [c.display_name.toLowerCase(), c.id]))
    const staffByName = new Map(staff.map((x) => [x.name.toLowerCase(), x.id]))

    const outcome = await importCsvFile(
      file,
      (r) => r.get('party_name'),
      async (r) => {
        const role: LeadRole = 'buyer' // a lead is always a buyer

        const countName = r.get('count')
        const countId = countName ? countByName.get(countName.toLowerCase()) : undefined
        if (countName && !countId) throw new Error(`Count "${countName}" is not in the Count Master`)

        const staffName = r.get('sales_staff')
        const staffId = staffName ? staffByName.get(staffName.toLowerCase()) : me?.id
        if (staffName && !staffId) throw new Error(`Sales staff "${staffName}" is not an active user`)

        const buyerCodeCell = r.get('buyer_code')
        const buyerId = buyerCodeCell ? buyerByCode.get(buyerCodeCell.toLowerCase()) : undefined
        if (buyerCodeCell && !buyerId) throw new Error(`Buyer code "${buyerCodeCell}" is not in the Buyer Master`)

        const quantity = r.get('quantity')
        const stationName = await ensureStation(r.get('station'))
        const followDate = r.get('follow_up_date')
        const form: LeadForm = {
          lead_type: buyerId ? 'existing' : 'new',
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
          supplier_id: '',
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
          .insert({ ...leadPayload(form), status: 'new', buyer_id: buyerId ?? null, supplier_id: null })
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
    if (canQualify && open) items.push({ label: 'Qualify', onSelect: () => void qualify(l) })
    if (can('deal.create') && l.status === 'qualified' && !converted) items.push({ label: 'Convert to deal…', onSelect: () => { setConvertError(null); setConvertPrompt({ id: l.id, lead_no: l.lead_no }) } })
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
      key: 'status', label: 'Status', width: 150,
      render: (l) => (
        <span title={l.converted_deal_id ? 'Converted to a deal' : undefined}>
          <StatusPill label={statusLabel(l.status)} tone={LEAD_GROUPS.find((g) => g.value === l.status)?.tone ?? 'grey'} />
        </span>
      ),
    },
    {
      key: 'party', label: 'Buyer', width: 170,
      render: (l) => (
        <>
          <strong>{l.party_name}</strong>
          {l.station && <span className="small muted"> · {l.station}</span>}
        </>
      ),
    },
    { key: 'count', label: 'Count', width: 210, render: (l) => <span className="small">{(l.count_id ? countById.get(l.count_id)?.display_name : '') || <span className="muted">—</span>}</span> },
    { key: 'qty', label: 'Quantity', align: 'right', render: (l) => <span className="mono">{l.quantity !== null ? `${l.quantity} ${l.uom ?? ''}` : '—'}</span> },
    { key: 'follow', label: 'Follow-up', render: (l) => <span className="mono small">{formatDate(l.follow_up_date)}</span> },
    { key: 'staff', label: 'Sales staff', width: 160, render: (l) => <PersonCell name={l.sales_staff_id ? staffById.get(l.sales_staff_id) : undefined} /> },
    { key: 'created', label: 'Created Date', render: (l) => <span className="small">{formatShortDate(l.created_at)}</span> },
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
            Every inquiry, until it is qualified and becomes a deal. Qualifying needs its count and quantity.
          </p>
        </div>
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
        <div className="board-cols-slot">
          {canManage && (
            <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
              + New lead
            </button>
          )}
        </div>
      </div>

      <Board
        rows={shown}
        groups={LEAD_GROUPS}
        groupOf={(l) => l.status}
        columns={columns}
        rowKey={(l) => l.id}
        viewKey="leads"
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
          onRefresh={load}
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
        <LeadFormModal
          key={`view-${editing.lead.id}`}
          readOnly
          counts={counts}
          stations={stations}
          ensureStation={ensureStation}
          defaultStaffId={me?.id ?? null}
          leads={leads}
          lockedIds={lockedIds}
          initialLead={editing.lead}
          onEdit={(l) => { setEditing(null); setEditLead(l) }}
          onClose={() => setEditing(null)}
          onDone={() => setEditing(null)}
        />
      )}

      {convertPrompt && (
        <ConfirmDialog
          title={`Convert ${convertPrompt.lead_no} to a deal?`}
          confirmLabel="Create the deal"
          busy={convertBusy}
          error={convertError}
          onConfirm={() => void convertToDeal()}
          onClose={() => setConvertPrompt(null)}
        >
          The deal is created from this lead, and the lead becomes read-only.
        </ConfirmDialog>
      )}

      {dealPrompt && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card pad" role="dialog" aria-modal="true" aria-label="Create a deal" style={{ maxWidth: 420, width: 'calc(100% - 32px)' }}>
            <h3 className="section-title" style={{ marginTop: 0 }}>Deal created</h3>
            <p>{dealPrompt.lead_no} is now Qualified, and its deal was created as a Draft. Add the supplier and the final rate there.</p>
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

    </>
  )
}

/* ---- qualify a lead (T-011) ------------------------------------------------- */

/* ---- station picker, discussion log, follow-ups ------------------------------ */

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