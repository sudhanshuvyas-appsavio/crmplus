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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LEAD_ROLES, LEAD_SOURCES, LEAD_STATUSES, LEAD_UOMS } from '../api/types'
import { uomLabel } from '../lib/deals'
import type { Activity, CountRow, Lead, LeadRole, LeadStatus, Station } from '../api/types'
import { useNavigate } from 'react-router-dom'
import { ActivityPanel } from '../components/PartyExtras'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { ImportIssues, useSelection } from '../components/ListTools'
import { Board, DownloadIcon, StatusPill, ViewSwitch, useStoredState, type BoardColumn, type BoardGroup } from '../components/board/Board'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, pickOne } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage, isGst, isMobile, numOrNull } from '../lib/party'
import { formatDate, formatDateTime } from '../lib/format'

const LEAD_CSV_COLUMNS = [
  'lead_no', 'status', 'lead_type', 'lead_source', 'party_role', 'party_name', 'contact_person', 'mobile_cc', 'mobile', 'station', 'office_address',
  'gst', 'count', 'quantity', 'uom', 'expected_rate', 'timeline', 'timeline_from', 'timeline_to', 'remarks', 'sales_staff',
  'follow_up_date', 'follow_up_at', 'buyer_code', 'supplier_code', 'qualified_at', 'created_at',
] as const

type StaffOption = { id: string; name: string }
type MasterParty = { id: string; name: string; contact_person: string | null; mobile: string | null; gst: string | null; address: string | null; is_active: boolean }
type Editing = { mode: 'create' } | { mode: 'edit'; lead: Lead } | null
type Banner = { kind: 'ok' | 'bad'; text: string } | null

const STATUS_CHIP: Record<LeadStatus, string> = {
  new: 'chip brand',
  contacted: 'chip warn',
  qualified: 'chip good',
  lost: 'chip bad',
}

/** Board groups, one per lead status, coloured like the other boards. */
const LEAD_GROUPS: BoardGroup[] = [
  { value: 'new', label: 'New', tone: 'blue' },
  { value: 'contacted', label: 'Contacted', tone: 'orange' },
  { value: 'qualified', label: 'Qualified', tone: 'green' },
  { value: 'lost', label: 'Lost', tone: 'red' },
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
  const [stations, setStations] = useState<Station[]>([])
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [editing, setEditing] = useState<Editing>(null)
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
  const [view, setView] = useStoredState<'table' | 'kanban'>('leads.view', 'table')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [banner, setBanner] = useState<Banner>(null)
  const [busy, setBusy] = useState(false)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)

  const load = useCallback(async () => {
    const [leadRes, countRes, staffRes, stationRes] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      supabase.from('count_master').select('*').order('count_no').order('display_name'),
      supabase.from('profiles').select('id, name').eq('is_active', true).order('name'),
      supabase.from('station_master').select('*').order('name'),
    ])
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

  const countById = useMemo(() => new Map(counts.map((c) => [c.id, c])), [counts])
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
  }, [leads, statusFilter, search, countById])

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

  if (!leads) return <Loading label="Loading leads" />

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
    { key: 'status', label: 'Status', width: 140, render: (l) => <StatusPill label={statusLabel(l.status)} tone={LEAD_GROUPS.find((g) => g.value === l.status)?.tone ?? 'grey'} /> },
    { key: 'follow', label: 'Follow-up', render: (l) => <span className="mono small">{formatDate(l.follow_up_date)}</span> },
    { key: 'staff', label: 'Sales staff', render: (l) => <span className="small">{l.sales_staff_id ? staffById.get(l.sales_staff_id) ?? '—' : '—'}</span> },
    {
      key: 'action', label: 'Change status', interactive: true,
      render: (l) => {
        const open = (l.status === 'new' || l.status === 'contacted') && !l.converted_deal_id
        return (
          <>
            {canQualify && open && (
              <button className="btn sm" type="button" onClick={() => setQualifying(l)} style={{ marginRight: 8 }}>Qualify</button>
            )}
            {l.converted_deal_id && <span className="chip good">Converted to deal</span>}
            {(canManage || canQualify) && !l.converted_deal_id && (
              <StatusMover
                lead={l}
                canQualify={canQualify}
                onQualify={setQualifying}
                onChanged={async (text) => {
                  setBanner({ kind: 'ok', text })
                  await load()
                }}
                onError={(text) => setBanner({ kind: 'bad', text })}
              />
            )}
          </>
        )
      },
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
            Add a lead
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
        view={view}
        selection={canManage ? { isSelected: selection.isSelected, toggle: selection.toggle } : undefined}
        emptyText={leads.length === 0 ? `No leads yet.${canManage ? ' Add the first inquiry.' : ''}` : 'No lead matches that filter.'}
        card={(l) => (
          <>
            <span className="kcard-top">
              <span className="mono small">{l.lead_no}</span>
              <span className="small muted">{formatDate(l.follow_up_date)}</span>
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

      {editing && canManage && (
        <LeadDrawer
          key={editing.mode === 'edit' ? editing.lead.id : 'create'}
          editing={editing}
          counts={counts}
          staff={staff}
          stations={stations}
          ensureStation={ensureStation}
          onRefresh={load}
          defaultStaffId={me?.id ?? null}
          canQualify={canQualify}
          onClose={() => setEditing(null)}
          onQualify={(lead) => {
            setEditing(null)
            setQualifying(lead)
          }}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            await load()
          }}
          onError={(text) => setBanner({ kind: 'bad', text })}
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

/* ---- create / edit a lead (T-009) ------------------------------------------ */

type LeadForm = {
  lead_type: 'existing' | 'new'
  lead_source: string
  party_role: LeadRole
  party_name: string
  contact_person: string
  mobile_cc: string
  mobile: string
  station: string
  office_address: string
  gst: string
  buyer_id: string
  supplier_id: string
  count_id: string
  quantity: string
  uom: string
  expected_rate: string
  timeline: string
  timeline_from: string
  timeline_to: string
  remarks: string
  sales_staff_id: string
  /** datetime-local value (browser time), e.g. 2026-11-20T15:30 */
  follow_up_at: string
}

/** ISO timestamp -> value for <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function leadToForm(lead: Lead): LeadForm {
  return {
    lead_type: lead.lead_type ?? (lead.buyer_id || lead.supplier_id ? 'existing' : 'new'),
    lead_source: lead.lead_source ?? '',
    party_role: lead.party_role,
    party_name: lead.party_name,
    contact_person: lead.contact_person ?? '',
    mobile_cc: lead.mobile_cc ?? '+91',
    mobile: lead.mobile ?? '',
    station: lead.station ?? '',
    office_address: lead.office_address ?? '',
    gst: lead.gst ?? '',
    buyer_id: lead.buyer_id ?? '',
    supplier_id: lead.supplier_id ?? '',
    count_id: lead.count_id ?? '',
    quantity: lead.quantity === null ? '' : String(lead.quantity),
    uom: lead.uom ?? '',
    expected_rate: lead.expected_rate === null ? '' : String(lead.expected_rate),
    timeline: lead.timeline ?? '',
    timeline_from: lead.timeline_from ?? '',
    timeline_to: lead.timeline_to ?? '',
    remarks: lead.remarks ?? '',
    sales_staff_id: lead.sales_staff_id ?? '',
    follow_up_at: lead.follow_up_at ? toLocalInput(lead.follow_up_at) : lead.follow_up_date ? `${lead.follow_up_date}T10:00` : '',
  }
}

const phoneOk = (cc: string, n: string) => (cc === '+91' ? isMobile(n) : /^[0-9]{6,14}$/.test(n))

function leadProblems(f: LeadForm): string[] {
  const out: string[] = []
  if (!f.party_name.trim()) out.push('Party name')
  if (f.lead_type === 'existing' && (f.party_role === 'buyer' || f.party_role === 'both') && !f.buyer_id) out.push('Buyer from Buyers & Suppliers')
  if (f.lead_type === 'existing' && (f.party_role === 'supplier' || f.party_role === 'both') && !f.supplier_id) out.push('Supplier from Buyers & Suppliers')
  if (!/^\+[0-9]{1,4}$/.test(f.mobile_cc)) out.push('Country code (like +91)')
  if (f.mobile.trim() && !phoneOk(f.mobile_cc, f.mobile)) out.push(f.mobile_cc === '+91' ? 'Mobile (10 digits, or leave blank)' : 'Mobile (6 to 14 digits)')
  if (f.gst.trim() && !isGst(f.gst)) out.push('GST (15-character format, or leave blank)')
  if (f.quantity.trim()) {
    const q = numOrNull(f.quantity)
    if (q === null || q <= 0) out.push('Quantity (more than zero)')
  }
  if (f.quantity.trim() && !f.uom) out.push('Unit of measure')
  if (f.timeline_from && f.timeline_to && f.timeline_to < f.timeline_from) out.push('Timeline: "to" on or after "from"')
  return out
}

function leadPayload(form: LeadForm) {
  const existing = form.lead_type === 'existing'
  return {
    lead_type: form.lead_type,
    lead_source: form.lead_source.trim() || null,
    party_role: form.party_role,
    party_name: form.party_name.trim(),
    contact_person: form.contact_person.trim() || null,
    mobile_cc: form.mobile_cc,
    mobile: form.mobile.trim() || null,
    station: form.station.trim() || null,
    office_address: form.office_address.trim() || null,
    gst: form.gst.trim().toUpperCase() || null,
    ...(existing
      ? {
          buyer_id: form.party_role !== 'supplier' ? form.buyer_id || null : null,
          supplier_id: form.party_role !== 'buyer' ? form.supplier_id || null : null,
        }
      : {}),
    count_id: form.count_id || null,
    quantity: numOrNull(form.quantity),
    uom: form.uom || null,
    expected_rate: numOrNull(form.expected_rate),
    timeline: form.timeline.trim() || null,
    timeline_from: form.timeline_from || null,
    timeline_to: form.timeline_to || null,
    remarks: form.remarks.trim() || null,
    sales_staff_id: form.sales_staff_id || null,
    follow_up_at: form.follow_up_at ? new Date(form.follow_up_at).toISOString() : null,
  }
}

/** Moves a lead to any status from any status. Qualified is the one target that
 *  goes through the Qualify panel (its rules are unchanged); every other move,
 *  including out of Qualified to undo a mistaken qualification, is direct. */
function StatusMover({
  lead,
  canQualify,
  onQualify,
  onChanged,
  onError,
}: {
  lead: Lead
  canQualify: boolean
  onQualify: (lead: Lead) => void
  onChanged: (message: string) => void | Promise<void>
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)

  async function change(next: LeadStatus) {
    if (next === lead.status) return
    if (next === 'qualified') {
      onQualify(lead)
      return
    }
    if (
      lead.status === 'qualified' &&
      !window.confirm(
        `${lead.lead_no} is Qualified. Move it to ${statusLabel(next)}? Its qualification is cleared, and you can qualify it again later.`,
      )
    ) {
      return
    }
    setBusy(true)
    const { data, error } = await supabase.from('leads').update({ status: next }).eq('id', lead.id).select('id')
    setBusy(false)
    if (error) {
      onError(errMessage(error, 'Could not change the status'))
      return
    }
    if ((data ?? []).length === 0) {
      onError('Your account does not have permission to change this lead.')
      return
    }
    await onChanged(`${lead.lead_no} moved to ${statusLabel(next)}.`)
  }

  return (
    <select
      aria-label={`Change status of ${lead.lead_no}`}
      value={lead.status}
      disabled={busy}
      onChange={(e) => void change(e.target.value as LeadStatus)}
    >
      {LEAD_STATUSES.map((st) => (
        <option key={st.value} value={st.value} disabled={st.value === 'qualified' && !canQualify && lead.status !== 'qualified'}>
          {st.label}
        </option>
      ))}
    </select>
  )
}

function LeadDrawer({
  editing,
  counts,
  staff,
  stations,
  ensureStation,
  onRefresh,
  defaultStaffId,
  canQualify,
  onClose,
  onQualify,
  onDone,
  onError,
}: {
  editing: NonNullable<Editing>
  counts: CountRow[]
  staff: StaffOption[]
  stations: Station[]
  ensureStation: (name: string) => Promise<string>
  onRefresh: () => Promise<void>
  defaultStaffId: string | null
  canQualify: boolean
  onClose: () => void
  onQualify: (lead: Lead) => void
  onDone: (message: string) => void | Promise<void>
  onError: (message: string) => void
}) {
  const initial = editing.mode === 'edit' ? editing.lead : null
  const [existing, setExisting] = useState<Lead | null>(initial)
  const { can } = useAuth()
  const navigate = useNavigate()
  const [dealNo, setDealNo] = useState<string | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [form, setForm] = useState<LeadForm>(
    existing
      ? leadToForm(existing)
      : {
          lead_type: 'new', lead_source: '', party_role: 'buyer', party_name: '', contact_person: '', mobile_cc: '+91', mobile: '', station: '',
          office_address: '', gst: '', buyer_id: '', supplier_id: '', count_id: '', quantity: '', uom: 'KG', expected_rate: '',
          timeline: '', timeline_from: '', timeline_to: '', remarks: '', sales_staff_id: defaultStaffId ?? '', follow_up_at: '',
        },
  )
  const [busy, setBusy] = useState(false)
  const [editMode, setEditMode] = useState(!initial)
  const [formError, setFormError] = useState<string | null>(null)
  const [masters, setMasters] = useState<{ buyers: MasterParty[]; suppliers: MasterParty[] }>({ buyers: [], suppliers: [] })
  useEffect(() => {
    const cols = 'id,name,contact_person,mobile,gst,address,is_active'
    void Promise.all([
      supabase.from('buyer_master').select(cols).order('name'),
      supabase.from('supplier_master').select(cols).order('name'),
    ]).then(([b, s]) => setMasters({ buyers: (b.data ?? []) as MasterParty[], suppliers: (s.data ?? []) as MasterParty[] }))
  }, [])

  function set<K extends keyof LeadForm>(key: K, value: LeadForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  /** Existing lead: picking the party copies its details from the master (no retyping). */
  function pickMaster(side: 'buyer' | 'supplier', id: string) {
    const p = (side === 'buyer' ? masters.buyers : masters.suppliers).find((x) => x.id === id)
    setForm((prev) => ({
      ...prev,
      [`${side}_id`]: id,
      ...(p
        ? {
            party_name: p.name,
            contact_person: p.contact_person ?? prev.contact_person,
            mobile_cc: p.mobile ? '+91' : prev.mobile_cc,
            mobile: p.mobile ?? prev.mobile,
            gst: p.gst ?? prev.gst,
            office_address: p.address ?? prev.office_address,
          }
        : {}),
    }))
  }

  const missing = leadProblems(form)
  const selectedCount = counts.find((c) => c.id === form.count_id)
  const qualified = existing?.status === 'qualified'
  const locked = Boolean(existing?.converted_deal_id)
  // Editable until the lead is converted into a deal.
  const editable = !locked && (editMode || !existing)
  // qualifying creates the deal by itself; this button only covers leads qualified before that
  const canConvert = can('deal.create') && qualified && !locked

  useEffect(() => {
    const id = existing?.converted_deal_id
    if (!id) return
    void supabase
      .from('crm_deals')
      .select('deal_no')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setDealNo((data as { deal_no: string } | null)?.deal_no ?? null))
  }, [existing?.converted_deal_id])

  /** Re-reads the lead after a change made by the database (discussion log,
   *  conversion) so the form never holds stale values that a later Save
   *  would write back. */
  async function reloadLead() {
    if (!existing) return
    const { data } = await supabase.from('leads').select('*').eq('id', existing.id).maybeSingle()
    if (data) {
      setExisting(data as Lead)
      setForm(leadToForm(data as Lead))
    }
    setHistoryKey((k) => k + 1)
    await onRefresh()
  }

  async function convert() {
    if (!existing) return
    if (!window.confirm(`Create the deal for ${existing.lead_no}? The lead becomes read-only.`)) return
    setBusy(true)
    setFormError(null)
    const { data, error } = await supabase.rpc('convert_lead_to_deal', { p_lead: existing.id })
    setBusy(false)
    if (error) {
      setFormError(errMessage(error, 'Could not convert this lead'))
      return
    }
    await onRefresh()
    navigate(`/deals?open=${data as string}`)
  }

  async function save() {
    setBusy(true)
    setFormError(null)
    let stationName = ''
    try {
      stationName = await ensureStation(form.station)
    } catch (caught) {
      setBusy(false)
      setFormError(errMessage(caught, 'Could not add the station'))
      return
    }
    const payload = { ...leadPayload(form), station: stationName || null }
    const { error } = existing
      ? await supabase.from('leads').update(payload).eq('id', existing.id)
      : await supabase.from('leads').insert(payload)
    setBusy(false)
    if (error) {
      setFormError(errMessage(error, 'Could not save this lead'))
      return
    }
    setEditMode(false)
    await onDone(existing ? `${existing.lead_no} updated.` : 'Lead created.')
  }

  async function remove() {
    if (!existing) return
    setBusy(true)
    const { error } = await supabase.from('leads').delete().eq('id', existing.id)
    setBusy(false)
    if (error) {
      onError(errMessage(error, 'Could not delete this lead'))
      onClose()
      return
    }
    await onDone(`${existing.lead_no} deleted.`)
  }

  return (
    <Drawer title={existing ? `${existing.lead_no} · ${existing.party_name}` : 'Add a lead'} onClose={onClose}>
      {existing && (
        <p className="small">
          <span className={STATUS_CHIP[existing.status]}>{statusLabel(existing.status)}</span>
          {qualified && existing.qualified_at && (
            <span className="muted"> · qualified {formatDateTime(existing.qualified_at)}</span>
          )}
          {locked ? (
            <span className="chip good" style={{ marginLeft: 12 }}>
              Converted → {dealNo ?? 'deal'}
            </span>
          ) : (
            <span style={{ marginLeft: 12 }}>
              <StatusMover lead={existing} canQualify={canQualify} onQualify={onQualify} onChanged={onDone} onError={onError} />
            </span>
          )}
        </p>
      )}
      {locked && (
        <div className="notice small">
          This lead has been converted to a deal and is read-only. Change the deal instead
          {can('deal.read') && existing?.converted_deal_id && (
            <>
              {' '}
              (<a href={`/deals?open=${existing.converted_deal_id}`}>open {dealNo ?? 'the deal'}</a>)
            </>
          )}
          .
        </div>
      )}
      {formError && (
        <div className="alert" role="alert">
          {formError}
        </div>
      )}

      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <h3 className="section-title">Lead</h3>
      <div className="form-grid">
        <Field id="l-type" label="Lead type" required hint={form.lead_type === 'existing' ? 'Pick the party from Buyers & Suppliers.' : 'A party not yet in Buyers & Suppliers.'}>
          <select id="l-type" value={form.lead_type} onChange={(e) => set('lead_type', e.target.value as LeadForm['lead_type'])}>
            <option value="new">New</option>
            <option value="existing">Existing</option>
          </select>
        </Field>
        <Field id="l-source" label="Lead source">
          <input id="l-source" list="l-source-list" value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)} />
          <datalist id="l-source-list">
            {LEAD_SOURCES.map((s) => (<option key={s} value={s} />))}
          </datalist>
        </Field>
        <Field id="l-role" label="Party role" required>
          <select id="l-role" value={form.party_role} onChange={(e) => set('party_role', e.target.value as LeadRole)}>
            {LEAD_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        {existing && (
          <Field id="l-created" label="Created">
            <input id="l-created" readOnly value={formatDateTime(existing.created_at)} />
          </Field>
        )}
      </div>

      <h3 className="section-title">Party</h3>
      {form.lead_type === 'existing' ? (
        <div className="form-grid">
          {form.party_role !== 'supplier' && (
            <Field id="l-buyer" label="Buyer" required>
              <select id="l-buyer" value={form.buyer_id} onChange={(e) => pickMaster('buyer', e.target.value)}>
                <option value="">Choose…</option>
                {masters.buyers.filter((x) => x.is_active || x.id === form.buyer_id).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
              </select>
            </Field>
          )}
          {form.party_role !== 'buyer' && (
            <Field id="l-supplier" label="Supplier" required>
              <select id="l-supplier" value={form.supplier_id} onChange={(e) => pickMaster('supplier', e.target.value)}>
                <option value="">Choose…</option>
                {masters.suppliers.filter((x) => x.is_active || x.id === form.supplier_id).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
              </select>
            </Field>
          )}
        </div>
      ) : (
        <p className="muted small">
          Temporary details, held until the party is validated against Buyers &amp; Suppliers (at Qualify).
        </p>
      )}
      <div className="form-grid">
        <Field id="l-name" label="Party name" required>
          <input id="l-name" value={form.party_name} readOnly={form.lead_type === 'existing'} onChange={(e) => set('party_name', e.target.value)} autoFocus={form.lead_type === 'new'} />
        </Field>
        <Field id="l-contact" label="Contact person">
          <input id="l-contact" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
        </Field>
        <Field
          id="l-mobile"
          label="Mobile"
          hint={form.mobile && !phoneOk(form.mobile_cc, form.mobile) ? (form.mobile_cc === '+91' ? 'Mobile must be exactly 10 digits.' : '6 to 14 digits.') : undefined}
        >
          <div className="phone-row">
            <input
              aria-label="Country code"
              className="mono cc"
              value={form.mobile_cc}
              onChange={(e) => set('mobile_cc', '+' + e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            />
            <input
              id="l-mobile"
              className="mono"
              inputMode="numeric"
              maxLength={form.mobile_cc === '+91' ? 10 : 14}
              value={form.mobile}
              onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))}
            />
          </div>
        </Field>
        <Field id="l-station" label="Station" hint="Pick from the Station Master, or add a new one.">
          <StationPicker value={form.station} stations={stations} onChange={(v) => set('station', v)} />
        </Field>
        <Field
          id="l-gst"
          label="GST"
          hint={form.gst && !isGst(form.gst) ? 'Not a valid GST number yet.' : 'Optional at lead stage.'}
        >
          <input
            id="l-gst"
            className="mono"
            maxLength={15}
            value={form.gst}
            onChange={(e) => set('gst', e.target.value.toUpperCase().replace(/\s+/g, ''))}
          />
        </Field>
      </div>
      <Field id="l-address" label="Office address">
        <textarea id="l-address" rows={2} value={form.office_address} onChange={(e) => set('office_address', e.target.value)} />
      </Field>

      <h3 className="section-title">Product requirement</h3>
      <Field id="l-count" label="Count" hint="From the Count Master. Needed before the lead can be qualified.">
        <select id="l-count" value={form.count_id} onChange={(e) => set('count_id', e.target.value)}>
          <option value="">—</option>
          {counts
            .filter((c) => c.is_active || c.id === form.count_id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
              </option>
            ))}
        </select>
      </Field>
      {selectedCount && (
        <dl className="kv">
          <dt>Machine</dt>
          <dd>{selectedCount.machine}</dd>
          <dt>Composition</dt>
          <dd>{selectedCount.composition}</dd>
          <dt>Ratio</dt>
          <dd>{selectedCount.ratio}</dd>
          <dt>Blended</dt>
          <dd>{selectedCount.blended ?? '—'}</dd>
          <dt>Type</dt>
          <dd>{selectedCount.yarn_type}</dd>
          <dt>Process</dt>
          <dd>{selectedCount.process ?? '—'}</dd>
          <dt>Certification</dt>
          <dd>{selectedCount.certification ?? '—'}</dd>
          <dt>Single / double</dt>
          <dd>{selectedCount.ply ?? '—'}</dd>
        </dl>
      )}

      <h3 className="section-title">Preliminary commercials</h3>
      <div className="form-grid">
        <Field id="l-qty" label="Quantity" hint="Needed before the lead can be qualified.">
          <input id="l-qty" inputMode="decimal" className="mono" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </Field>
        <Field id="l-uom" label="UOM">
          <select id="l-uom" value={form.uom} onChange={(e) => set('uom', e.target.value)}>
            <option value="">—</option>
            {LEAD_UOMS.map((u) => (
              <option key={u} value={u}>
                {uomLabel(u)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="l-rate" label="Expected rate">
          <input id="l-rate" inputMode="decimal" className="mono" value={form.expected_rate} onChange={(e) => set('expected_rate', e.target.value)} />
        </Field>
        <Field id="l-tfrom" label="Timeline from">
          <input id="l-tfrom" type="date" value={form.timeline_from} onChange={(e) => set('timeline_from', e.target.value)} />
        </Field>
        <Field id="l-tto" label="Timeline to" hint={form.timeline && !form.timeline_from && !form.timeline_to ? `Earlier note: ${form.timeline}` : undefined}>
          <input id="l-tto" type="date" min={form.timeline_from || undefined} value={form.timeline_to} onChange={(e) => set('timeline_to', e.target.value)} />
        </Field>
        <Field id="l-staff" label="Sales staff">
          <select id="l-staff" value={form.sales_staff_id} onChange={(e) => set('sales_staff_id', e.target.value)}>
            <option value="">—</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="l-follow" label="Follow-up date and time">
          <input id="l-follow" type="datetime-local" value={form.follow_up_at} onChange={(e) => set('follow_up_at', e.target.value)} />
        </Field>
      </div>
      <Field id="l-remarks" label="Remarks">
        <textarea id="l-remarks" rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
      </Field>
      </fieldset>

      {missing.length > 0 && editable && <p className="field-hint">Still needed: {missing.join(', ')}.</p>}
      <div className="drawer-actions">
        {existing && !locked && !editMode && (
          <button className="btn" type="button" onClick={() => setEditMode(true)} disabled={busy}>
            Edit
          </button>
        )}
        {editable && (
        <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || missing.length > 0}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Create the lead'}
        </button>
        )}
        {existing && editable && (
          <button className="btn ghost" type="button" onClick={() => { setForm(leadToForm(existing)); setFormError(null); setEditMode(false) }} disabled={busy}>
            Cancel editing
          </button>
        )}
        {canConvert && (
          <button className="btn" type="button" onClick={() => void convert()} disabled={busy}>
            Convert to deal…
          </button>
        )}
        {!locked && existing && canQualify && !qualified && existing.status !== 'lost' && (
          <button className="btn" type="button" onClick={() => onQualify(existing)} disabled={busy}>
            Qualify…
          </button>
        )}
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {!locked && existing && <DeleteControl label="Delete this lead" name={existing.lead_no} busy={busy} onConfirm={() => void remove()} />}
      </div>
      {existing && !locked && <DiscussionPanel lead={existing} onLogged={reloadLead} />}
      {existing && <ActivityPanel entityType="lead" entityId={existing.id} canWrite={!locked} title="Discussion history, notes and tasks" refreshKey={historyKey} />}
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsProduct = !lead.count_id || lead.quantity === null || lead.quantity <= 0
  const qtyNumber = numOrNull(quantity)
  const productReady = !needsProduct || (countId !== '' && qtyNumber !== null && qtyNumber > 0 && uom !== '')

  async function qualify() {
    if (role === '') return
    setBusy(true)
    setError(null)
    try {
      if (needsProduct) {
        const { error: e } = await supabase.from('leads').update({ count_id: countId, quantity: qtyNumber, uom }).eq('id', lead.id)
        if (e) throw e
      }
      const { data, error: e } = await supabase.rpc('qualify_lead_auto', { p_lead: lead.id, p_role: role })
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
          {lead.party_name}. The Contact and Company are created automatically from the lead. Choose the Contact's role.
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
          <button className="btn primary" type="button" onClick={() => void qualify()} disabled={busy || role === '' || !productReady}>
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

const NEW_STATION = '__new_station__'

function StationPicker({ value, stations, onChange }: { value: string; stations: Station[]; onChange: (v: string) => void }) {
  const known = stations.some((st) => st.name.toLowerCase() === value.trim().toLowerCase())
  const [adding, setAdding] = useState(false)
  if (adding) {
    return (
      <span style={{ display: 'flex', gap: 8 }}>
        <input id="l-station" autoFocus placeholder="New station name" value={value} onChange={(e) => onChange(e.target.value)} />
        <button className="btn ghost sm" type="button" onClick={() => { setAdding(false); onChange('') }}>
          Use list
        </button>
      </span>
    )
  }
  return (
    <select
      id="l-station"
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW_STATION) {
          setAdding(true)
          onChange('')
        } else onChange(e.target.value)
      }}
    >
      <option value="">—</option>
      {value && !known && <option value={value}>{value} (new)</option>}
      {stations
        .filter((st) => st.is_active || st.name === value)
        .map((st) => (
          <option key={st.id} value={st.name}>
            {st.name}
          </option>
        ))}
      <option value={NEW_STATION}>+ Add new station…</option>
    </select>
  )
}

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