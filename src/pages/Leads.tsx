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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LEAD_ROLES, LEAD_STATUSES, LEAD_UOMS } from '../api/types'
import type { Activity, CountRow, Lead, LeadRole, LeadStatus, Station } from '../api/types'
import { useNavigate } from 'react-router-dom'
import { ActivityPanel } from '../components/PartyExtras'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, pickOne } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage, isGst, isMobile, numOrNull } from '../lib/party'
import { formatDate, formatDateTime } from '../lib/format'

const LEAD_CSV_COLUMNS = [
  'lead_no', 'status', 'party_role', 'party_name', 'contact_person', 'mobile', 'station', 'office_address',
  'gst', 'count', 'quantity', 'uom', 'expected_rate', 'timeline', 'remarks', 'sales_staff',
  'follow_up_date', 'buyer_code', 'supplier_code', 'qualified_at',
] as const

type StaffOption = { id: string; name: string }
type Editing = { mode: 'create' } | { mode: 'edit'; lead: Lead } | null
type Banner = { kind: 'ok' | 'bad'; text: string } | null

const STATUS_CHIP: Record<LeadStatus, string> = {
  new: 'chip brand',
  contacted: 'chip warn',
  qualified: 'chip good',
  lost: 'chip bad',
}

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
        const form: LeadForm = {
          party_role: role,
          party_name: r.get('party_name'),
          contact_person: r.get('contact_person'),
          mobile: r.get('mobile').replace(/\D/g, ''),
          station: stationName,
          office_address: r.get('office_address'),
          gst: r.get('gst').toUpperCase().replace(/\s+/g, ''),
          count_id: countId ?? '',
          quantity,
          uom: pickOne('UOM', r.get('uom'), LEAD_UOMS) || (quantity ? 'KG' : ''),
          expected_rate: r.get('expected_rate'),
          timeline: r.get('timeline'),
          remarks: r.get('remarks'),
          sales_staff_id: staffId ?? '',
          follow_up_date: r.get('follow_up_date'),
        }
        const missing = leadProblems(form)
        if (form.expected_rate && numOrNull(form.expected_rate) === null) missing.push('Expected rate (a number)')
        if (form.follow_up_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.follow_up_date)) missing.push('Follow-up date (YYYY-MM-DD)')
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

      <ListTools
        plural="leads"
        canImport={canManage}
        canDelete={canManage}
        selectedCount={selection.chosen.length}
        exportLabel={`Export ${selection.chosen.length > 0 ? `${selection.chosen.length} selected` : shown.length === leads.length ? 'all' : `${shown.length} shown`} as CSV`}
        exportDisabled={shown.length === 0}
        busy={busy}
        onImport={(f) => void importCSV(f)}
        onExport={() => void exportCSV()}
        onDelete={deleteSelected}
      />
      <ImportIssues results={importResults} />

      <FollowUps leads={leads} onOpen={(l) => canManage && setEditing({ mode: 'edit', lead: l })} />

      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="drawer-actions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
          <input
            aria-label="Search leads"
            placeholder="Search lead no., party, station or count"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | LeadStatus)}
          >
            <option value="all">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card pad empty">
          {leads.length === 0 ? 'No leads yet.' : 'No lead matches that filter.'}
          {leads.length === 0 && canManage ? ' Add the first inquiry.' : ''}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canManage && (
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={selection.allSelected} onChange={selection.toggleAll} aria-label="Select all leads" />
                  </th>
                )}
                <th>Lead</th>
                <th>Party</th>
                <th>Count</th>
                <th className="right">Quantity</th>
                <th>Status</th>
                <th>Follow-up</th>
                <th>Sales staff</th>
                <th>Change status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const count = l.count_id ? countById.get(l.count_id) : undefined
                const open = (l.status === 'new' || l.status === 'contacted') && !l.converted_deal_id
                return (
                  <tr
                    key={l.id}
                    className={canManage ? 'clickable' : ''}
                    onClick={() => canManage && setEditing({ mode: 'edit', lead: l })}
                  >
                    {canManage && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selection.isSelected(l.id)} onChange={() => selection.toggle(l.id)} aria-label={`Select ${l.lead_no}`} />
                      </td>
                    )}
                    <td className="mono">{l.lead_no}</td>
                    <td>
                      <strong>{l.party_name}</strong>
                      <span className="chip" style={{ marginLeft: 8 }}>
                        {roleLabel(l.party_role)}
                      </span>
                      {l.station && <div className="small muted">{l.station}</div>}
                    </td>
                    <td className="small">{count ? count.display_name : <span className="muted">—</span>}</td>
                    <td className="right mono">{l.quantity !== null ? `${l.quantity} ${l.uom ?? ''}` : '—'}</td>
                    <td>
                      <span className={STATUS_CHIP[l.status]}>{statusLabel(l.status)}</span>
                    </td>
                    <td className="mono small">{formatDate(l.follow_up_date)}</td>
                    <td className="small">{l.sales_staff_id ? staffById.get(l.sales_staff_id) ?? '—' : '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canQualify && open && (
                        <button className="btn sm" type="button" onClick={() => setQualifying(l)} style={{ marginRight: 8 }}>
                          Qualify
                        </button>
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

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
            <h3 className="section-title" style={{ marginTop: 0 }}>Create a deal?</h3>
            <p>{dealPrompt.lead_no} is now Qualified. Do you want to create a Deal from it now?</p>
            <div className="drawer-actions">
              <button className="btn primary" type="button" onClick={() => void createDeal()} disabled={dealBusy}>
                {dealBusy ? 'Creating…' : 'Yes, create deal'}
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
            if (can('deal.create') && done) setDealPrompt({ id: leadId, lead_no: done.lead_no })
          }}
        />
      )}
    </>
  )
}

/* ---- create / edit a lead (T-009) ------------------------------------------ */

type LeadForm = {
  party_role: LeadRole
  party_name: string
  contact_person: string
  mobile: string
  station: string
  office_address: string
  gst: string
  count_id: string
  quantity: string
  uom: string
  expected_rate: string
  timeline: string
  remarks: string
  sales_staff_id: string
  follow_up_date: string
}

function leadToForm(lead: Lead): LeadForm {
  return {
    party_role: lead.party_role,
    party_name: lead.party_name,
    contact_person: lead.contact_person ?? '',
    mobile: lead.mobile ?? '',
    station: lead.station ?? '',
    office_address: lead.office_address ?? '',
    gst: lead.gst ?? '',
    count_id: lead.count_id ?? '',
    quantity: lead.quantity === null ? '' : String(lead.quantity),
    uom: lead.uom ?? '',
    expected_rate: lead.expected_rate === null ? '' : String(lead.expected_rate),
    timeline: lead.timeline ?? '',
    remarks: lead.remarks ?? '',
    sales_staff_id: lead.sales_staff_id ?? '',
    follow_up_date: lead.follow_up_date ?? '',
  }
}

function leadProblems(f: LeadForm): string[] {
  const out: string[] = []
  if (!f.party_name.trim()) out.push('Party name')
  if (f.mobile.trim() && !isMobile(f.mobile)) out.push('Mobile (10 digits, or leave blank)')
  if (f.gst.trim() && !isGst(f.gst)) out.push('GST (15-character format, or leave blank)')
  if (f.quantity.trim()) {
    const q = numOrNull(f.quantity)
    if (q === null || q <= 0) out.push('Quantity (more than zero)')
  }
  if (f.quantity.trim() && !f.uom) out.push('Unit of measure')
  return out
}

function leadPayload(form: LeadForm) {
  return {
    party_role: form.party_role,
    party_name: form.party_name.trim(),
    contact_person: form.contact_person.trim() || null,
    mobile: form.mobile.trim() || null,
    station: form.station.trim() || null,
    office_address: form.office_address.trim() || null,
    gst: form.gst.trim().toUpperCase() || null,
    count_id: form.count_id || null,
    quantity: numOrNull(form.quantity),
    uom: form.uom || null,
    expected_rate: numOrNull(form.expected_rate),
    timeline: form.timeline.trim() || null,
    remarks: form.remarks.trim() || null,
    sales_staff_id: form.sales_staff_id || null,
    follow_up_date: form.follow_up_date || null,
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
          party_role: 'buyer', party_name: '', contact_person: '', mobile: '', station: '',
          office_address: '', gst: '', count_id: '', quantity: '', uom: 'KG', expected_rate: '',
          timeline: '', remarks: '', sales_staff_id: defaultStaffId ?? '', follow_up_date: '',
        },
  )
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function set<K extends keyof LeadForm>(key: K, value: LeadForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const missing = leadProblems(form)
  const selectedCount = counts.find((c) => c.id === form.count_id)
  const qualified = existing?.status === 'qualified'
  const locked = Boolean(existing?.converted_deal_id)
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
    if (!window.confirm(`Convert ${existing.lead_no} to a draft deal? The lead becomes read-only.`)) return
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

      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <h3 className="section-title">Party</h3>
      <p className="muted small">
        Temporary details, held until the party is validated against the Buyer / Supplier Master.
      </p>
      <div className="form-grid">
        <Field id="l-role" label="Party role" required>
          <select id="l-role" value={form.party_role} onChange={(e) => set('party_role', e.target.value as LeadRole)}>
            {LEAD_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="l-name" label="Party name" required>
          <input id="l-name" value={form.party_name} onChange={(e) => set('party_name', e.target.value)} autoFocus />
        </Field>
        <Field id="l-contact" label="Contact person">
          <input id="l-contact" value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
        </Field>
        <Field
          id="l-mobile"
          label="Mobile"
          hint={form.mobile && !isMobile(form.mobile) ? 'Mobile must be exactly 10 digits.' : undefined}
        >
          <input
            id="l-mobile"
            className="mono"
            inputMode="numeric"
            maxLength={10}
            value={form.mobile}
            onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))}
          />
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
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field id="l-rate" label="Expected rate">
          <input id="l-rate" inputMode="decimal" className="mono" value={form.expected_rate} onChange={(e) => set('expected_rate', e.target.value)} />
        </Field>
        <Field id="l-timeline" label="Timeline">
          <input id="l-timeline" value={form.timeline} onChange={(e) => set('timeline', e.target.value)} />
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
        <Field id="l-follow" label="Follow-up date">
          <input id="l-follow" type="date" value={form.follow_up_date} onChange={(e) => set('follow_up_date', e.target.value)} />
        </Field>
      </div>
      <Field id="l-remarks" label="Remarks">
        <textarea id="l-remarks" rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
      </Field>
      </fieldset>

      {missing.length > 0 && <p className="field-hint">Still needed: {missing.join(', ')}.</p>}
      <div className="drawer-actions">
        {!locked && (
        <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || missing.length > 0}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Create the lead'}
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
    <details className="card pad" style={{ marginBottom: 16 }} open>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Follow-ups ({total})</summary>
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