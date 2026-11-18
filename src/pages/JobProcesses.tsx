/** Job process.
 *
 *  A job process is a party the goods are delivered to instead of the buyer's
 *  own address (a sizing or weaving mill, a dyer and so on). The fields follow
 *  the job process form: process name, short name, station, two contacts with
 *  mobiles, office and residence phone, office and mill/factory/delivery
 *  addresses, a company, and Account / Info / Remarks tabs. A buyer can be
 *  linked so the register shows whose goods go there. Only the name is
 *  required; GST and PAN are checked when entered. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { JobProcess, Station } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { RowActionMenu } from '../components/RowActionMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DocumentList, countDocuments, uploadDocuments, type DocumentStore } from '../components/documents/DocumentList'
import { FormSection, FullWidth, RecordAction } from '../components/FormKit'
import { PendingDocuments } from '../components/documents/PendingDocuments'
import { DocumentsModal } from '../components/documents/DocumentsModal'
import { Field } from '../components/PartyForms'
import { LinkPicker, useLocationOptions } from '../components/LinkPicker'
import { loadLinkIds, syncLinks } from '../lib/links'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { GridPager, GridToolbar, usePaging, type FilterDef } from '../components/GridKit'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { GST_STATES, errMessage, isGst, isMobile } from '../lib/party'
import { formatDate } from '../lib/format'

type Company = { id: string; name: string; is_active: boolean }

/** Where a record's documents (monday's Documents column) are kept. */
const jobDocStore = (id: string): DocumentStore => ({
  table: 'job_process_documents',
  bucket: 'mdm-documents',
  parentColumn: 'job_process_id',
  pathPrefix: `job-process/${id}`,
  noun: 'record',
})

type Buyer = { id: string; name: string; is_active: boolean }

const CSV_COLUMNS = [
  'process_code', 'name', 'short_name', 'buyer', 'station', 'contact_person', 'mobile',
  'contact_person_2', 'mobile_2', 'office_phone', 'res_phone', 'office_address', 'delivery_address',
  'gst', 'state_code', 'state', 'pan', 'bank_account', 'company', 'info', 'remarks', 'is_active',
  'email_1', 'email_2',
] as const

type Form = {
  name: string
  short_name: string
  buyer_id: string
  station_id: string
  office_address: string
  delivery_address: string
  contact_person: string
  mobile: string
  contact_person_2: string
  mobile_2: string
  office_phone: string
  res_phone: string
  gst: string
  state_code: string
  state: string
  pan: string
  bank_account: string
  company_id: string
  info: string
  remarks: string
  is_active: boolean
  email_1: string
  email_2: string
}

const blank: Form = {
  name: '', short_name: '', buyer_id: '', station_id: '', office_address: '', delivery_address: '',
  contact_person: '', mobile: '', contact_person_2: '', mobile_2: '', office_phone: '', res_phone: '',
  gst: '', state_code: '', state: '', pan: '', bank_account: '', company_id: '', info: '', remarks: '', is_active: true,
  email_1: '', email_2: '',
}

const fromRow = (r: JobProcess): Form => ({
  name: r.name, short_name: r.short_name ?? '', buyer_id: r.buyer_id ?? '', station_id: r.station_id ?? '',
  office_address: r.office_address ?? '', delivery_address: r.delivery_address ?? '', contact_person: r.contact_person ?? '',
  mobile: r.mobile ?? '', contact_person_2: r.contact_person_2 ?? '', mobile_2: r.mobile_2 ?? '', office_phone: r.office_phone ?? '',
  res_phone: r.res_phone ?? '', gst: r.gst ?? '', state_code: r.state_code ?? '', state: r.state ?? '', pan: r.pan ?? '',
  bank_account: r.bank_account ?? '', company_id: r.company_id ?? '', info: r.info ?? '', remarks: r.remarks ?? '', is_active: r.is_active,
  email_1: r.email_1 ?? '', email_2: r.email_2 ?? '',
})

function problems(f: Form): string[] {
  const out: string[] = []
  if (!f.name.trim()) out.push('Name')
  if (f.mobile && !isMobile(f.mobile)) out.push('Mobile (10 digits)')
  if (f.mobile_2 && !isMobile(f.mobile_2)) out.push('Second mobile (10 digits)')
  if (f.gst && !isGst(f.gst)) out.push('GST (15 characters, valid format)')
  if (f.email_1.trim() && !f.email_1.includes('@')) out.push('Email 1 (must contain @)')
  if (f.email_2.trim() && !f.email_2.includes('@')) out.push('Email 2 (must contain @)')
  if (f.pan && f.pan.trim().length !== 10) out.push('PAN (10 characters)')
  if (f.gst && f.state_code && f.gst.slice(0, 2) !== f.state_code) out.push('State code (must match the first two digits of the GST)')
  return out
}

const payload = (f: Form) => {
  const t = (v: string) => v.trim() || null
  return {
    name: f.name.trim(), short_name: t(f.short_name), buyer_id: f.buyer_id || null, station_id: f.station_id || null,
    office_address: t(f.office_address), delivery_address: t(f.delivery_address), contact_person: t(f.contact_person),
    mobile: t(f.mobile), contact_person_2: t(f.contact_person_2), mobile_2: t(f.mobile_2), office_phone: t(f.office_phone),
    res_phone: t(f.res_phone), gst: t(f.gst.toUpperCase()), state_code: t(f.state_code), state: t(f.state),
    pan: t(f.pan.toUpperCase()), bank_account: t(f.bank_account), company_id: f.company_id || null,
    info: t(f.info), remarks: t(f.remarks), is_active: f.is_active,
    email_1: t(f.email_1), email_2: t(f.email_2),
  }
}

export default function JobProcesses() {
  const { can } = useAuth()
  const canManage = can('jobprocess.manage')
  const canRead = canManage || can('jobprocess.read')
  const [rows, setRows] = useState<JobProcess[] | null>(null)
  const [stations, setStations] = useState<Station[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [editing, setEditing] = useState<JobProcess | 'new' | null>(null)
  const [viewing, setViewing] = useState<JobProcess | null>(null)
  const [deleting, setDeleting] = useState<JobProcess | null>(null)
  const [docsFor, setDocsFor] = useState<JobProcess | null>(null)
  const [delErr, setDelErr] = useState<string | null>(null)
  const [docCounts, setDocCounts] = useState<Record<string, number>>({})
  const [locationsOf, setLocationsOf] = useState<Record<string, string[]>>({})
  const [search, setSearch] = useState('')
  const [buyerFilter, setBuyerFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [r, s, c, b] = await Promise.all([
      supabase.from('job_processes').select('*').order('name'),
      supabase.from('station_master').select('*').order('name'),
      supabase.from('companies').select('id,name,is_active').order('name'),
      supabase.from('buyer_master').select('id,name,is_active').order('name'),
    ])
    if (r.error) setBanner({ kind: 'bad', text: errMessage(r.error, 'Could not load job processes') })
    setRows((r.data ?? []) as JobProcess[])
    setStations((s.data ?? []) as Station[])
    setCompanies((c.data ?? []) as Company[])
    setBuyers((b.data ?? []) as Buyer[])
    const list = (r.data ?? []) as JobProcess[]
    setDocCounts(await countDocuments('job_process_documents', 'job_process_id', list.map((x) => x.id)))
    // "Locations" column: the stations each record serves.
    const links = await supabase.from('location_links').select('owner_id,location_id').eq('owner_type', 'job_process')
    const names = new Map(((s.data ?? []) as Station[]).map((x) => [x.id, x.name]))
    const byRow: Record<string, string[]> = {}
    for (const l of (links.data ?? []) as { owner_id: string; location_id: string }[]) {
      const n = names.get(l.location_id)
      if (n) (byRow[l.owner_id] ??= []).push(n)
    }
    setLocationsOf(byRow)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const buyerName = useMemo(() => new Map(buyers.map((x) => [x.id, x.name])), [buyers])
  const stationName = useMemo(() => new Map(stations.map((x) => [x.id, x.name])), [stations])
  const companyName = useMemo(() => new Map(companies.map((x) => [x.id, x.name])), [companies])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(
      (x) =>
        (!buyerFilter || x.buyer_id === buyerFilter) &&
        (!statusFilter || (statusFilter === 'active') === x.is_active) &&
        (!q ||
          [x.name, x.short_name, x.process_code, x.contact_person, x.mobile, x.gst, x.pan, x.station_id ? stationName.get(x.station_id) : '']
            .some((v) => (v ?? '').toLowerCase().includes(q))),
    )
  }, [rows, search, buyerFilter, statusFilter, stationName])

  const paging = usePaging(shown, [search, buyerFilter, statusFilter].join('|'))

  const filterDefs: FilterDef[] = [
    { name: 'buyer', label: 'Buyer', allLabel: 'All buyers', options: buyers.map((b) => ({ value: b.id, label: b.name })) },
    { name: 'status', label: 'Status', allLabel: 'All statuses', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
  ]

  const selection = useSelection(useMemo(() => shown.map((x) => x.id), [shown]))

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    const names = new Map((rows ?? []).map((x) => [x.id, x.name]))
    const result = await bulkDelete('job_processes', selection.chosen)
    setBanner(deleteSummary('job process', 'job processes', result, (id) => names.get(id) ?? id))
    selection.clear()
    await load()
    setBusy(false)
  }

  function exportCSV() {
    const list = (selection.chosen.length > 0 ? shown.filter((x) => selection.isSelected(x.id)) : shown).map((x) => ({
      ...x,
      buyer: x.buyer_id ? buyerName.get(x.buyer_id) ?? '' : '',
      station: x.station_id ? stationName.get(x.station_id) ?? '' : '',
      company: x.company_id ? companyName.get(x.company_id) ?? '' : '',
    }))
    downloadCSV(`job-processes-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  async function importCSV(file: File) {
    setBusy(true)
    setBanner(null)
    setImportResults(null)
    const outcome = await importCsvFile(
      file,
      (r) => r.get('name'),
      async (r) => {
        const stationText = r.get('station')
        const station = stationText ? stations.find((s) => s.name.toLowerCase() === stationText.toLowerCase()) : null
        if (stationText && !station) throw new Error(`Station "${stationText}" is not in the Station list`)
        const companyText = r.get('company')
        const company = companyText ? companies.find((c) => c.name.toLowerCase() === companyText.toLowerCase()) : null
        if (companyText && !company) throw new Error(`Company "${companyText}" was not found`)
        const buyerText = r.get('buyer')
        const buyer = buyerText ? buyers.find((x) => x.name.toLowerCase() === buyerText.toLowerCase()) : null
        if (buyerText && !buyer) throw new Error(`Buyer "${buyerText}" was not found`)
        const gst = r.get('gst').toUpperCase().replace(/\s+/g, '')
        const f: Form = {
          ...blank,
          buyer_id: buyer?.id ?? '',
          name: r.get('name'), short_name: r.get('short_name'), station_id: station?.id ?? '',
          office_address: r.get('office_address'), delivery_address: r.get('delivery_address'),
          contact_person: r.get('contact_person'), mobile: r.get('mobile'), contact_person_2: r.get('contact_person_2'),
          mobile_2: r.get('mobile_2'), office_phone: r.get('office_phone'), res_phone: r.get('res_phone'),
          gst, state_code: r.get('state_code') || gst.slice(0, 2), state: r.get('state') || GST_STATES[gst.slice(0, 2)] || '',
          pan: r.get('pan').toUpperCase(), bank_account: r.get('bank_account'), company_id: company?.id ?? '',
          info: r.get('info'), remarks: r.get('remarks'), is_active: parseBool(r.get('is_active'), true),
          email_1: r.get('email_1'), email_2: r.get('email_2'),
        }
        const missing = problems(f)
        if (missing.length > 0) throw new Error(`Needs: ${missing.join(', ')}`)
        const { error } = await supabase.from('job_processes').insert(payload(f))
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

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    setDelErr(null)
    const { data, error } = await supabase.from('job_processes').delete().eq('id', deleting.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setDelErr(error ? errMessage(error) : 'Your account cannot delete this record.')
    setBanner({ kind: 'ok', text: `${deleting.name} deleted.` })
    setDeleting(null)
    await load()
  }

  if (!canRead) return <div className="card pad narrow-card">Your account does not have access to transportation records.</div>
  if (!rows) return <Loading label="Loading job processes" />

  return (
    <>
      <GridToolbar
        title="Sizing / Delivery Address"
        total={rows.length}
        singular="job process"
        plural="job processes"
        query={search}
        onQuery={setSearch}
        searchPlaceholder="Search name, code, contact, mobile, GST, PAN or station"
        filters={filterDefs}
        values={{ buyer: buyerFilter, status: statusFilter }}
        onFilter={(name, value) => (name === 'buyer' ? setBuyerFilter(value) : setStatusFilter(value))}
        onClear={() => {
          setBuyerFilter('')
          setStatusFilter('')
        }}
      >
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
            New job process
          </button>
        )}
      </GridToolbar>

      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      )}

      <ListTools
        plural="job processes"
        canImport={canManage}
        canDelete={canManage}
        selectedCount={selection.chosen.length}
        exportLabel={`Export ${selection.chosen.length > 0 ? `${selection.chosen.length} selected` : shown.length === rows.length ? 'all' : `${shown.length} shown`} as CSV`}
        exportDisabled={shown.length === 0}
        busy={busy}
        onImport={(file) => void importCSV(file)}
        onExport={exportCSV}
        onDelete={deleteSelected}
      />
      <ImportIssues results={importResults} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {canManage && (
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={selection.allSelected} onChange={selection.toggleAll} aria-label="Select all job processes" />
                </th>
              )}
              <th className="left md-sticky">Name</th>
              <th>Date</th>
              <th>Office Address</th>
              <th>GST No.</th>
              <th>State</th>
              <th>Contact Person 1</th>
              <th>Contact Person 1 Phone</th>
              <th>Contact Person 1 Email</th>
              <th>Contact Person 2</th>
              <th>Contact Person 2 Phone</th>
              <th>Contact Person 2 Email</th>
              <th>Remarks 1</th>
              <th>Documents</th>
              <th>Locations</th>
              <th className="md-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td className="empty" colSpan={canManage ? 17 : 16}>
                  {rows.length === 0 ? 'No job processes yet.' : 'No job process matches.'}
                </td>
              </tr>
            ) : (
              paging.visible.map((x) => (
                <tr key={x.id}>
                  {canManage && (
                    <td>
                      <input type="checkbox" checked={selection.isSelected(x.id)} onChange={() => selection.toggle(x.id)} aria-label={`Select ${x.name}`} />
                    </td>
                  )}
                  <td className="left md-sticky">
                    <strong>{x.name}</strong>
                    {!x.is_active && <span className="chip bad" style={{ marginLeft: 8 }}>Inactive</span>}
                  </td>
                  <td className="mono small">{formatDate(x.created_at)}</td>
                  <td className="small md-wrap" style={{ whiteSpace: 'pre-line' }}>{x.office_address ?? '—'}</td>
                  <td className="mono small">{x.gst ?? '—'}</td>
                  <td className="small">{x.state ?? '—'}</td>
                  <td className="small">{x.contact_person ?? '—'}</td>
                  <td className="mono small">{x.mobile ?? '—'}</td>
                  <td className="small">{x.email_1 ?? '—'}</td>
                  <td className="small">{x.contact_person_2 ?? '—'}</td>
                  <td className="mono small">{x.mobile_2 ?? '—'}</td>
                  <td className="small">{x.email_2 ?? '—'}</td>
                  <td className="small md-wrap">{x.remarks ?? '—'}</td>
                  <td className="mono small">{docCounts[x.id] ?? 0}</td>
                  <td className="small md-wrap">{locationsOf[x.id]?.join(', ') ?? '—'}</td>
                  <td className="md-actions">
                    <RowActionMenu
                      label={x.name}
                      actions={[
                        { label: 'View', onSelect: () => setViewing(x) },
                        { label: 'Edit', onSelect: () => setEditing(x), disabledReason: canManage ? null : 'Needs “Add and edit job processes”' },
                        { label: 'Documents', onSelect: () => setDocsFor(x) },
                        { label: 'Delete', tone: 'danger', onSelect: () => { setDelErr(null); setDeleting(x) }, disabledReason: canManage ? null : 'Needs “Add and edit job processes”' },
                      ]}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {viewing && (
        <JobProcessDrawer
          key={`v-${viewing.id}`}
          row={viewing}
          rows={rows}
          canManage={canManage}
          viewOnly
          stations={stations}
          companies={companies}
          buyers={buyers}
          onClose={() => setViewing(null)}
          onDone={() => setViewing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog title="Delete record" busy={busy} error={delErr} onConfirm={() => void confirmDelete()} onClose={() => setDeleting(null)}>
          Delete <strong>{deleting.name}</strong>? This cannot be undone.
        </ConfirmDialog>
      )}
      {docsFor && (
        <DocumentsModal
          title={docsFor.name}
          store={jobDocStore(docsFor.id)}
          parentId={docsFor.id}
          canEdit={canManage}
          onClose={() => setDocsFor(null)}
          onChanged={() => void load()}
        />
      )}

      {editing && (
        <JobProcessDrawer
          key={editing === 'new' ? 'new' : editing.id}
          row={editing === 'new' ? null : editing}
          rows={rows}
          canManage={canManage}
          stations={stations}
          companies={companies}
          buyers={buyers}
          onClose={() => setEditing(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            await load()
          }}
        />
      )}

      <GridPager {...paging.pager} singular="job process" plural="job processes" />
    </>
  )
}

function JobProcessDrawer({
  row: existing, rows, canManage: canManageRecords, viewOnly = false, stations, companies, buyers, onClose, onDone,
}: {
  row: JobProcess | null
  rows: JobProcess[]
  canManage: boolean
  viewOnly?: boolean
  stations: Station[]
  buyers: Buyer[]
  companies: Company[]
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
}) {
  const canManage = canManageRecords && !viewOnly
  // monday's form opens with "Select Action": create a new record or update an existing one.
  const [action, setAction] = useState<'create' | 'update'>('create')
  const [pickedId, setPickedId] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const picked = rows.find((r) => r.id === pickedId) ?? null
  const row = existing ?? (action === 'update' ? picked : null)
  const [f, setF] = useState<Form>(existing ? fromRow(existing) : blank)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const locationOptions = useLocationOptions()
  const [locationIds, setLocationIds] = useState<string[]>([])
  const [linksLoaded, setLinksLoaded] = useState(!row)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  // The monday creation form marks these required; they are asked for on a new record
  // (an existing record may legitimately lack some of them).
  const required: [string, string][] = row
    ? []
    : [
        ['Name', f.name], ['GST No.', f.gst], ['State', f.state], ['Office Address', f.office_address],
        ['Contact Person 1', f.contact_person], ['Contact Person 2', f.contact_person_2],
        ['Contact Person 1 Phone', f.mobile], ['Contact Person 2 Phone', f.mobile_2],
        ['Contact Person 1 Email', f.email_1], ['Contact Person 2 Email', f.email_2], ['Remarks 1', f.remarks],
      ]
  const missing = [
    ...required.filter(([, v]) => !v.trim()).map(([k]) => k),
    ...(!row && files.length === 0 ? ['Documents'] : []),
    ...problems(f).filter((p) => !required.some(([k]) => p.startsWith(k))),
  ]

  useEffect(() => {
    if (!row) return undefined
    let live = true
    setLinksLoaded(false)
    loadLinkIds('location', 'job_process', row.id)
      .then((ids) => { if (live) { setLocationIds(ids); setLinksLoaded(true) } })
      .catch(() => { if (live) setErr("Could not load this record's locations.") })
    return () => { live = false }
  }, [row])

  function chooseAction(next: 'create' | 'update') {
    setAction(next)
    setPickedId('')
    setFiles([])
    setF(blank)
    setLocationIds([])
    setLinksLoaded(true)
  }
  function pick(id: string) {
    setPickedId(id)
    const r = rows.find((x) => x.id === id)
    setF(r ? fromRow(r) : blank)
  }

  /** Typing a GSTIN fills the state code, state and PAN that it carries. */
  function setGst(value: string) {
    const gst = value.toUpperCase().replace(/\s+/g, '')
    setF((p) => {
      const next = { ...p, gst }
      const code = gst.slice(0, 2)
      if (/^[0-9]{2}$/.test(code)) {
        next.state_code = code
        if (GST_STATES[code] && (p.state.trim() === '' || p.state === GST_STATES[p.gst.slice(0, 2)])) next.state = GST_STATES[code]!
      }
      if (gst.length >= 12 && !p.pan.trim()) next.pan = gst.slice(2, 12)
      return next
    })
  }

  async function save() {
    if (missing.length > 0) return setErr(`Fix: ${missing.join(', ')}.`)
    setBusy(true)
    setErr(null)
    const { data, error } = row
      ? await supabase.from('job_processes').update(payload(f)).eq('id', row.id).select('id')
      : await supabase.from('job_processes').insert(payload(f)).select('id')
    if (error) {
      setBusy(false)
      return setErr(errMessage(error, 'Could not save this job process'))
    }
    if (!data || data.length === 0) {
      setBusy(false)
      return setErr('Your account cannot change this job process.')
    }
    const savedId = data[0]!.id as string
    const saved = row ? `${f.name.trim()} updated.` : `${f.name.trim()} added.`
    const notes: string[] = []
    if (row ? linksLoaded : locationIds.length > 0) {
      try {
        await syncLinks('location', 'job_process', savedId, locationIds)
      } catch {
        notes.push('its locations could not be saved; open it again to retry')
      }
    }
    if (!row && files.length > 0) {
      const failed = await uploadDocuments(jobDocStore(savedId), savedId, files)
      if (failed.length > 0) notes.push(`some documents were not uploaded (${failed.join('; ')}); use Documents on the list to retry`)
    }
    setBusy(false)
    await onDone(notes.length > 0 ? `${saved} The record saved, but ${notes.join('; ')}.` : saved)
  }

  async function remove() {
    if (!existing) return
    setBusy(true)
    const { data, error } = await supabase.from('job_processes').delete().eq('id', existing.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Your account cannot delete this job process.')
    await onDone(`${existing.name} deleted.`)
  }

  const showForm = existing || action === 'create' || picked

  return (
    <Drawer title={existing ? `${existing.process_code} · ${existing.name}` : 'Sizing/Delivery Address Creation Form'} onClose={onClose} readOnly={viewOnly}>
      {err && <div className="alert">{err}</div>}
      {!existing && !viewOnly && (
        <RecordAction
          action={action}
          onAction={chooseAction}
          pickedId={pickedId}
          onPick={pick}
          records={rows.map((r) => ({ id: r.id, label: r.name }))}
          noun="sizing / delivery address"
        />
      )}
      {!canManage && !viewOnly && <div className="notice small">You can view this record; changing it needs the “Add and edit job processes” permission.</div>}
      {showForm && (
        <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <FormSection title="Sizing/Delivery Address Information" count={6}>
            <Field id="t-name" label="Name" required>
              <input id="t-name" value={f.name} placeholder="Enter Name" onChange={(ev) => set('name', ev.target.value)} />
            </Field>
            <Field id="t-gst" label="GST No." required hint="Fills state code, state and PAN.">
              <input id="t-gst" className="mono" maxLength={15} value={f.gst} placeholder="Enter GST No." onChange={(ev) => setGst(ev.target.value)} />
            </Field>
            <Field id="t-state" label="State" required>
              <input id="t-state" value={f.state} placeholder="Enter State" onChange={(ev) => set('state', ev.target.value)} />
            </Field>
            <Field id="t-oaddr" label="Office Address" required>
              <textarea id="t-oaddr" rows={3} value={f.office_address} placeholder="Enter Office Address" onChange={(ev) => set('office_address', ev.target.value)} />
            </Field>
            <FullWidth>
              <LinkPicker
                id="t-locations"
                label="Locations"
                hint="Optional: the stations this record serves."
                options={locationOptions}
                value={locationIds}
                onChange={setLocationIds}
                disabled={!canManage}
              />
            </FullWidth>
          </FormSection>

          <FormSection title="Contact Details" count={6}>
            <Field id="t-cp" label="Contact Person 1" required>
              <input id="t-cp" value={f.contact_person} placeholder="Enter Contact Person 1" onChange={(ev) => set('contact_person', ev.target.value)} />
            </Field>
            <Field id="t-cp2" label="Contact Person 2" required>
              <input id="t-cp2" value={f.contact_person_2} placeholder="Enter Contact Person 2" onChange={(ev) => set('contact_person_2', ev.target.value)} />
            </Field>
            <Field id="t-mob" label="Contact Person 1 Phone" required hint="10 digits.">
              <input id="t-mob" className="mono" inputMode="numeric" maxLength={10} value={f.mobile} placeholder="Contact Person 1 Phone number" onChange={(ev) => set('mobile', ev.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id="t-mob2" label="Contact Person 2 Phone" required hint="10 digits.">
              <input id="t-mob2" className="mono" inputMode="numeric" maxLength={10} value={f.mobile_2} placeholder="Contact Person 2 Phone number" onChange={(ev) => set('mobile_2', ev.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id="t-email1" label="Contact Person 1 Email" required>
              <input id="t-email1" type="email" value={f.email_1} placeholder="Enter Contact Person 1 Email" onChange={(ev) => set('email_1', ev.target.value)} />
            </Field>
            <Field id="t-email2" label="Contact Person 2 Email" required>
              <input id="t-email2" type="email" value={f.email_2} placeholder="Enter Contact Person 2 Email" onChange={(ev) => set('email_2', ev.target.value)} />
            </Field>
          </FormSection>

          <FormSection title="Remarks" count={1}>
            <FullWidth>
              <Field id="t-remarks" label="Remarks 1" required>
                <textarea id="t-remarks" rows={3} value={f.remarks} placeholder="Enter Remarks 1" onChange={(ev) => set('remarks', ev.target.value)} />
              </Field>
            </FullWidth>
          </FormSection>

          {!viewOnly && (
            <FormSection title="Documents" count={1}>
              <FullWidth>
                {row ? (
                  <DocumentList store={jobDocStore(row.id)} parentId={row.id} canEdit={canManage} />
                ) : (
                  <>
                    <p className="field-hint" style={{ marginBottom: 8 }}>Documents *: at least one file is needed on a new record.</p>
                    <PendingDocuments files={files} onChange={setFiles} disabled={busy} />
                  </>
                )}
              </FullWidth>
            </FormSection>
          )}

          <FormSection title="More details" description="Kept in CRM+ for deliveries; not on the monday form.">
            <Field id="t-short" label="Short name">
              <input id="t-short" value={f.short_name} onChange={(ev) => set('short_name', ev.target.value)} />
            </Field>
            <Field id="t-buyer" label="Buyer" hint="Optional: the buyer whose goods are delivered here.">
              <select id="t-buyer" value={f.buyer_id} onChange={(ev) => set('buyer_id', ev.target.value)}>
                <option value="">—</option>
                {buyers.filter((b) => b.is_active || b.id === f.buyer_id).map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
              </select>
            </Field>
            <Field id="t-station" label="Station">
              <select id="t-station" value={f.station_id} onChange={(ev) => set('station_id', ev.target.value)}>
                <option value="">—</option>
                {stations.filter((s) => s.is_active || s.id === f.station_id).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </Field>
            <Field id="t-company" label="Company">
              <select id="t-company" value={f.company_id} onChange={(ev) => set('company_id', ev.target.value)}>
                <option value="">—</option>
                {companies.filter((c) => c.is_active || c.id === f.company_id).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </Field>
            <Field id="t-ophone" label="Office phone">
              <input id="t-ophone" className="mono" value={f.office_phone} onChange={(ev) => set('office_phone', ev.target.value)} />
            </Field>
            <Field id="t-rphone" label="Res. phone">
              <input id="t-rphone" className="mono" value={f.res_phone} onChange={(ev) => set('res_phone', ev.target.value)} />
            </Field>
            <Field id="t-pan" label="IT PAN" hint="10 characters.">
              <input id="t-pan" className="mono" maxLength={10} value={f.pan} onChange={(ev) => set('pan', ev.target.value.toUpperCase().replace(/\s+/g, ''))} />
            </Field>
            <Field id="t-sc" label="State code">
              <input id="t-sc" className="mono" maxLength={2} value={f.state_code} onChange={(ev) => set('state_code', ev.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id="t-daddr" label="Mill / Factory / Delivery address">
              <textarea id="t-daddr" rows={3} value={f.delivery_address} onChange={(ev) => set('delivery_address', ev.target.value)} />
            </Field>
            <Field id="t-bank" label="Bank A/c. No.">
              <textarea id="t-bank" rows={3} value={f.bank_account} onChange={(ev) => set('bank_account', ev.target.value)} />
            </Field>
            <FullWidth>
              <Field id="t-info" label="Info" hint="Anything else worth knowing about this address.">
                <textarea id="t-info" rows={3} value={f.info} onChange={(ev) => set('info', ev.target.value)} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={f.is_active} onChange={(ev) => set('is_active', ev.target.checked)} />
                <span className="check-body">
                  <span className="check-label">Active</span>
                </span>
              </label>
            </FullWidth>
          </FormSection>
        </fieldset>
      )}

      {missing.length > 0 && !viewOnly && <p className="field-hint">Still needed: {missing.join(', ')}.</p>}

      {canManage && (
        <div className="drawer-actions">
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || missing.length > 0 || (!existing && action === 'update' && !picked)}>
            {busy ? 'Saving…' : row ? '✓ Update Item' : '✓ Create Item'}
          </button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {existing && <DeleteControl label="Delete" name={existing.name} busy={busy} onConfirm={() => void remove()} />}
        </div>
      )}
    </Drawer>
  )
}
