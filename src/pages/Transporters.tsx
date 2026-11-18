/** Transportation (transporter records).
 *
 *  One record per transporter, whether it is one of our own vehicles/people
 *  ("Internal") or an outside party ("Third party"). The fields follow the
 *  transporter form: name, short name, station, two contacts with mobiles,
 *  office and residence phone, office and mill/factory/delivery addresses, a
 *  company, and Account / Info / Remarks tabs (GST, state code, state, PAN, bank
 *  account). Only the name is required; GST and PAN are checked when entered. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Station, Transporter } from '../api/types'
import { VEHICLE_TYPES } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { RowActionMenu } from '../components/RowActionMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DocumentList, countDocuments, uploadDocuments, type DocumentStore } from '../components/documents/DocumentList'
import { ErrorBanner, FormSection, FullWidth, RecordAction } from '../components/FormKit'
import { findDuplicate, focusFirstError, isEmail, isStateCode, nameKey, requireText, type FieldErrors } from '../lib/validate'
import { PendingDocuments } from '../components/documents/PendingDocuments'
import { DocumentsModal } from '../components/documents/DocumentsModal'
import { Field } from '../components/PartyForms'
import { LinkPicker, useLocationOptions } from '../components/LinkPicker'
import { loadLinkIds, syncLinks } from '../lib/links'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { GridPager, GridToolbar, usePaging, type FilterDef } from '../components/GridKit'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool, pickOne } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { GST_STATES, errMessage, isGst, isMobile } from '../lib/party'
import { formatDate } from '../lib/format'

type Company = { id: string; name: string; is_active: boolean }

/** Where a transporter's documents (monday's Documents column) are kept. */
const transporterDocStore = (id: string): DocumentStore => ({
  table: 'transporter_documents',
  bucket: 'mdm-documents',
  parentColumn: 'transporter_id',
  pathPrefix: `transporter/${id}`,
  noun: 'transporter',
})

const TYPES = [
  { value: 'third_party', label: 'Third party' },
  { value: 'internal', label: 'Internal' },
] as const

const CSV_COLUMNS = [
  'transporter_code', 'name', 'short_name', 'transporter_type', 'station', 'contact_person', 'mobile',
  'contact_person_2', 'mobile_2', 'office_phone', 'res_phone', 'office_address', 'delivery_address',
  'gst', 'state_code', 'state', 'pan', 'bank_account', 'company', 'info', 'remarks', 'is_active',
  'email', 'vehicle_type', 'vehicle_no_1', 'vehicle_no_2', 'vehicle_no_3', 'bank_account_2',
] as const

type Form = {
  transporter_type: 'internal' | 'third_party'
  name: string
  short_name: string
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
  email: string
  vehicle_type: string
  vehicle_no_1: string
  vehicle_no_2: string
  vehicle_no_3: string
  bank_account_2: string
}

const blank: Form = {
  transporter_type: 'third_party', name: '', short_name: '', station_id: '', office_address: '', delivery_address: '',
  contact_person: '', mobile: '', contact_person_2: '', mobile_2: '', office_phone: '', res_phone: '',
  gst: '', state_code: '', state: '', pan: '', bank_account: '', company_id: '', info: '', remarks: '', is_active: true,
  email: '', vehicle_type: '', vehicle_no_1: '', vehicle_no_2: '', vehicle_no_3: '', bank_account_2: '',
}

const fromRow = (r: Transporter): Form => ({
  transporter_type: r.transporter_type, name: r.name, short_name: r.short_name ?? '', station_id: r.station_id ?? '',
  office_address: r.office_address ?? '', delivery_address: r.delivery_address ?? '', contact_person: r.contact_person ?? '',
  mobile: r.mobile ?? '', contact_person_2: r.contact_person_2 ?? '', mobile_2: r.mobile_2 ?? '', office_phone: r.office_phone ?? '',
  res_phone: r.res_phone ?? '', gst: r.gst ?? '', state_code: r.state_code ?? '', state: r.state ?? '', pan: r.pan ?? '',
  bank_account: r.bank_account ?? '', company_id: r.company_id ?? '', info: r.info ?? '', remarks: r.remarks ?? '', is_active: r.is_active,
  email: r.email ?? '', vehicle_type: r.vehicle_type ?? '', vehicle_no_1: r.vehicle_no_1 ?? '', vehicle_no_2: r.vehicle_no_2 ?? '',
  vehicle_no_3: r.vehicle_no_3 ?? '', bank_account_2: r.bank_account_2 ?? '',
})

/** Field id -> message, in the order the fields appear. A new record also needs the
 *  fields monday's form marks required (an existing one may lack some of them). */
function transporterErrors(f: Form, rows: readonly Transporter[], selfId: string | null | undefined, isNew: boolean): FieldErrors {
  const er: FieldErrors = {}
  requireText(er, 't-name', f.name, 'Name is required.')
  if (!er['t-name'] && findDuplicate(rows, selfId, (r) => r.name, f.name, nameKey)) er['t-name'] = 'A transport company with this name already exists.'
  if (f.email.trim() && !isEmail(f.email)) er['t-email'] = 'Enter a valid email, like name@company.com.'
  if (isNew) requireText(er, 't-gst', f.gst, 'GST No. is required.')
  const gst = f.gst.trim().toUpperCase()
  if (gst && !isGst(gst)) er['t-gst'] = 'Enter a complete GST number (15 characters, like 33AHFPS5121G2ZK).'
  if (isNew) requireText(er, 't-ophone', f.office_phone, 'Office Phone is required.')
  if (isNew) requireText(er, 't-state', f.state, 'State is required.')
  if (isNew) requireText(er, 't-sc', f.state_code, 'State Code is required.')
  if (f.state_code.trim() && !isStateCode(f.state_code)) er['t-sc'] = 'State Code must be 2 digits.'
  else if (gst && isGst(gst) && f.state_code.trim() && gst.slice(0, 2) !== f.state_code.trim()) er['t-sc'] = 'State Code must match the first two digits of the GST number.'
  if (isNew) requireText(er, 't-oaddr', f.office_address, 'Office Address is required.')
  if (isNew && !f.company_id) er['t-company'] = 'Business Units is required.'
  if (isNew) requireText(er, 't-bank', f.bank_account, 'Bank Account Number 1 is required.')
  if (isNew) requireText(er, 't-pan', f.pan, 'IT PAN is required.')
  if (f.pan.trim() && f.pan.trim().length !== 10) er['t-pan'] = 'PAN must be 10 characters.'
  if (isNew) requireText(er, 't-cp', f.contact_person, 'Contact Person 1 is required.')
  if (isNew) requireText(er, 't-mob', f.mobile, 'Contact Person 1 Phone is required.')
  if (f.mobile.trim() && !isMobile(f.mobile)) er['t-mob'] = 'Phone numbers are 10 digits, without +91 or a leading 0.'
  if (f.mobile_2.trim() && !isMobile(f.mobile_2)) er['t-mob2'] = 'Phone numbers are 10 digits, without +91 or a leading 0.'
  if (isNew) requireText(er, 't-vtype', f.vehicle_type, 'Vehicle Type is required.')
  return er
}

const payload = (f: Form) => {
  const t = (v: string) => v.trim() || null
  return {
    transporter_type: f.transporter_type, name: f.name.trim(), short_name: t(f.short_name), station_id: f.station_id || null,
    office_address: t(f.office_address), delivery_address: t(f.delivery_address), contact_person: t(f.contact_person),
    mobile: t(f.mobile), contact_person_2: t(f.contact_person_2), mobile_2: t(f.mobile_2), office_phone: t(f.office_phone),
    res_phone: t(f.res_phone), gst: t(f.gst.toUpperCase()), state_code: t(f.state_code), state: t(f.state),
    pan: t(f.pan.toUpperCase()), bank_account: t(f.bank_account), company_id: f.company_id || null,
    info: t(f.info), remarks: t(f.remarks), is_active: f.is_active,
    email: t(f.email), vehicle_type: f.vehicle_type || null, vehicle_no_1: t(f.vehicle_no_1.toUpperCase()),
    vehicle_no_2: t(f.vehicle_no_2.toUpperCase()), vehicle_no_3: t(f.vehicle_no_3.toUpperCase()), bank_account_2: t(f.bank_account_2),
  }
}

export default function Transporters() {
  const { can } = useAuth()
  const canManage = can('transport.manage')
  const canRead = canManage || can('transport.read')
  const [rows, setRows] = useState<Transporter[] | null>(null)
  const [stations, setStations] = useState<Station[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [editing, setEditing] = useState<Transporter | 'new' | null>(null)
  const [viewing, setViewing] = useState<Transporter | null>(null)
  const [deleting, setDeleting] = useState<Transporter | null>(null)
  const [docsFor, setDocsFor] = useState<Transporter | null>(null)
  const [delErr, setDelErr] = useState<string | null>(null)
  const [docCounts, setDocCounts] = useState<Record<string, number>>({})
  const [locationsOf, setLocationsOf] = useState<Record<string, string[]>>({})
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [r, s, c] = await Promise.all([
      supabase.from('transporters').select('*').order('name'),
      supabase.from('station_master').select('*').order('name'),
      supabase.from('companies').select('id,name,is_active').order('name'),
    ])
    if (r.error) setBanner({ kind: 'bad', text: errMessage(r.error, 'Could not load transporters') })
    setRows((r.data ?? []) as Transporter[])
    setStations((s.data ?? []) as Station[])
    setCompanies((c.data ?? []) as Company[])
    const list = (r.data ?? []) as Transporter[]
    setDocCounts(await countDocuments('transporter_documents', 'transporter_id', list.map((x) => x.id)))
    // "Locations" column: the stations each transporter serves.
    const links = await supabase.from('location_links').select('owner_id,location_id').eq('owner_type', 'transporter')
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

  const stationName = useMemo(() => new Map(stations.map((x) => [x.id, x.name])), [stations])
  const companyName = useMemo(() => new Map(companies.map((x) => [x.id, x.name])), [companies])

  const stateOptions = useMemo(
    () => [...new Set((rows ?? []).map((x) => x.state).filter((s): s is string => Boolean(s?.trim())))].sort((p, q) => p.localeCompare(q)),
    [rows],
  )
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter((x) => {
      if (typeFilter && x.transporter_type !== typeFilter) return false
      if (statusFilter && (statusFilter === 'active') !== x.is_active) return false
      if (vehicleFilter && x.vehicle_type !== vehicleFilter) return false
      if (stateFilter && x.state !== stateFilter) return false
      if (companyFilter && x.company_id !== companyFilter) return false
      if (!q) return true
      // Every column the grid shows.
      return [
        x.name, VEHICLE_TYPES.find((v) => v.value === x.vehicle_type)?.label ?? x.vehicle_type, formatDate(x.created_at), x.email,
        x.office_address, x.delivery_address, x.office_phone, x.res_phone, x.gst, x.state, x.state_code, x.bank_account,
        x.bank_account_2, x.pan, x.contact_person, x.mobile, x.contact_person_2, x.mobile_2, x.vehicle_no_1, x.vehicle_no_2,
        x.vehicle_no_3, x.remarks, (locationsOf[x.id] ?? []).join(' '), x.company_id ? companyName.get(x.company_id) : '',
      ].some((v) => (v ?? '').toLowerCase().includes(q))
    })
  }, [rows, search, typeFilter, statusFilter, vehicleFilter, stateFilter, companyFilter, locationsOf, companyName])

  const paging = usePaging(shown, [search, typeFilter, statusFilter, vehicleFilter, stateFilter, companyFilter].join('|'))

  const filterDefs: FilterDef[] = [
    { name: 'type', label: 'Type', allLabel: 'All types', options: TYPES },
    { name: 'status', label: 'Status', allLabel: 'All statuses', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
    { name: 'vehicle', label: 'Vehicle Type', allLabel: 'All vehicle types', options: VEHICLE_TYPES.map((v) => ({ value: v.value, label: v.label })) },
    { name: 'state', label: 'State', allLabel: 'All states', options: stateOptions.map((s) => ({ value: s, label: s })) },
    { name: 'company', label: 'Business Units', allLabel: 'All business units', options: companies.map((c) => ({ value: c.id, label: c.name })) },
  ]

  const selection = useSelection(useMemo(() => shown.map((x) => x.id), [shown]))

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    const names = new Map((rows ?? []).map((x) => [x.id, x.name]))
    const result = await bulkDelete('transporters', selection.chosen)
    setBanner(deleteSummary('transporter', 'transporters', result, (id) => names.get(id) ?? id))
    selection.clear()
    await load()
    setBusy(false)
  }

  function exportCSV() {
    const list = (selection.chosen.length > 0 ? shown.filter((x) => selection.isSelected(x.id)) : shown).map((x) => ({
      ...x,
      station: x.station_id ? stationName.get(x.station_id) ?? '' : '',
      company: x.company_id ? companyName.get(x.company_id) ?? '' : '',
    }))
    downloadCSV(`transporters-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
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
        const typeText = r.get('transporter_type').toLowerCase().replace(/[\s-]+/g, '_')
        const gst = r.get('gst').toUpperCase().replace(/\s+/g, '')
        const f: Form = {
          ...blank,
          transporter_type: (pickOne('Type', typeText, ['INTERNAL', 'THIRD_PARTY']) || 'THIRD_PARTY').toLowerCase() as Form['transporter_type'],
          name: r.get('name'), short_name: r.get('short_name'), station_id: station?.id ?? '',
          office_address: r.get('office_address'), delivery_address: r.get('delivery_address'),
          contact_person: r.get('contact_person'), mobile: r.get('mobile'), contact_person_2: r.get('contact_person_2'),
          mobile_2: r.get('mobile_2'), office_phone: r.get('office_phone'), res_phone: r.get('res_phone'),
          gst, state_code: r.get('state_code') || gst.slice(0, 2), state: r.get('state') || GST_STATES[gst.slice(0, 2)] || '',
          pan: r.get('pan').toUpperCase(), bank_account: r.get('bank_account'), company_id: company?.id ?? '',
          info: r.get('info'), remarks: r.get('remarks'), is_active: parseBool(r.get('is_active'), true),
          email: r.get('email'), vehicle_type: pickOne('Vehicle type', r.get('vehicle_type'), VEHICLE_TYPES.map((v) => v.value)),
          vehicle_no_1: r.get('vehicle_no_1'), vehicle_no_2: r.get('vehicle_no_2'), vehicle_no_3: r.get('vehicle_no_3'),
          bank_account_2: r.get('bank_account_2'),
        }
        const found = Object.values(transporterErrors(f, rows ?? [], null, true))
        if (found.length > 0) throw new Error(found.join(' '))
        const { error } = await supabase.from('transporters').insert(payload(f))
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
    const { data, error } = await supabase.from('transporters').delete().eq('id', deleting.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setDelErr(error ? errMessage(error) : 'Your account cannot delete this transporter.')
    setBanner({ kind: 'ok', text: `${deleting.name} deleted.` })
    setDeleting(null)
    await load()
  }

  if (!canRead) return <div className="card pad narrow-card">Your account does not have access to transportation records.</div>
  if (!rows) return <Loading label="Loading transporters" />

  return (
    <>
      <GridToolbar
        title="Transport Company"
        total={rows.length}
        singular="transporter"
        plural="transporters"
        query={search}
        onQuery={setSearch}
        searchPlaceholder="Search name, email, address, phone, GST, PAN, state, vehicle, contact, bank or remarks"
        filters={filterDefs}
        values={{ type: typeFilter, status: statusFilter, vehicle: vehicleFilter, state: stateFilter, company: companyFilter }}
        onFilter={(name, value) => {
          if (name === 'type') setTypeFilter(value)
          else if (name === 'status') setStatusFilter(value)
          else if (name === 'vehicle') setVehicleFilter(value)
          else if (name === 'state') setStateFilter(value)
          else setCompanyFilter(value)
        }}
        onClear={() => {
          setTypeFilter('')
          setStatusFilter('')
          setVehicleFilter('')
          setStateFilter('')
          setCompanyFilter('')
        }}
      >
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
            New transporter
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
        plural="transporters"
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
                  <input type="checkbox" checked={selection.allSelected} onChange={selection.toggleAll} aria-label="Select all transporters" />
                </th>
              )}
              <th className="left md-sticky">Name</th>
              <th>Vehicle Type</th>
              <th>Date</th>
              <th>Email</th>
              <th>Office Address</th>
              <th>Mill/Factory/Delivery Address</th>
              <th>Office Phone</th>
              <th>Res Phone</th>
              <th>GST No.</th>
              <th>State</th>
              <th>State Code</th>
              <th>Bank Account Number 1</th>
              <th>Bank Account Number 2</th>
              <th>IT PAN</th>
              <th>Contact Person 1</th>
              <th>Contact Person 1 Phone</th>
              <th>Contact Person 2</th>
              <th>Contact Person 2 Phone</th>
              <th>Vehicle No 1</th>
              <th>Vehicle No 2</th>
              <th>Vehicle No 3</th>
              <th>Remarks</th>
              <th>Documents</th>
              <th>Locations</th>
              <th>Business Units</th>
              <th className="md-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td className="empty" colSpan={canManage ? 28 : 27}>
                  {rows.length === 0 ? 'No transporters yet.' : 'No transporter matches.'}
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
                  <td className="small">{x.vehicle_type ? <span className="chip">{VEHICLE_TYPES.find((v) => v.value === x.vehicle_type)?.label ?? x.vehicle_type}</span> : '—'}</td>
                  <td className="mono small">{formatDate(x.created_at)}</td>
                  <td className="small">{x.email ?? '—'}</td>
                  <td className="small md-wrap" style={{ whiteSpace: 'pre-line' }}>{x.office_address ?? '—'}</td>
                  <td className="small md-wrap" style={{ whiteSpace: 'pre-line' }}>{x.delivery_address ?? '—'}</td>
                  <td className="mono small">{x.office_phone ?? '—'}</td>
                  <td className="mono small">{x.res_phone ?? '—'}</td>
                  <td className="mono small">{x.gst ?? '—'}</td>
                  <td className="small">{x.state ?? '—'}</td>
                  <td className="mono small">{x.state_code ?? '—'}</td>
                  <td className="small md-wrap" style={{ whiteSpace: 'pre-line' }}>{x.bank_account ?? '—'}</td>
                  <td className="small md-wrap" style={{ whiteSpace: 'pre-line' }}>{x.bank_account_2 ?? '—'}</td>
                  <td className="mono small">{x.pan ?? '—'}</td>
                  <td className="small">{x.contact_person ?? '—'}</td>
                  <td className="mono small">{x.mobile ?? '—'}</td>
                  <td className="small">{x.contact_person_2 ?? '—'}</td>
                  <td className="mono small">{x.mobile_2 ?? '—'}</td>
                  <td className="mono small">{x.vehicle_no_1 ?? '—'}</td>
                  <td className="mono small">{x.vehicle_no_2 ?? '—'}</td>
                  <td className="mono small">{x.vehicle_no_3 ?? '—'}</td>
                  <td className="small md-wrap">{x.remarks ?? '—'}</td>
                  <td className="mono small">{docCounts[x.id] ?? 0}</td>
                  <td className="small md-wrap">{locationsOf[x.id]?.join(', ') ?? '—'}</td>
                  <td className="small">{x.company_id ? companyName.get(x.company_id) ?? '—' : '—'}</td>
                  <td className="md-actions">
                    <RowActionMenu
                      label={x.name}
                      actions={[
                        { label: 'View', onSelect: () => setViewing(x) },
                        { label: 'Edit', onSelect: () => setEditing(x), disabledReason: canManage ? null : 'Needs “Add and edit transporters”' },
                        { label: 'Documents', onSelect: () => setDocsFor(x) },
                        { label: 'Delete', tone: 'danger', onSelect: () => { setDelErr(null); setDeleting(x) }, disabledReason: canManage ? null : 'Needs “Add and edit transporters”' },
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
        <TransporterDrawer
          key={`v-${viewing.id}`}
          row={viewing}
          rows={rows}
          canManage={canManage}
          viewOnly
          stations={stations}
          companies={companies}
          onClose={() => setViewing(null)}
          onDone={() => setViewing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog title="Delete transporter" busy={busy} error={delErr} onConfirm={() => void confirmDelete()} onClose={() => setDeleting(null)}>
          Delete <strong>{deleting.name}</strong>? This cannot be undone.
        </ConfirmDialog>
      )}
      {docsFor && (
        <DocumentsModal
          title={docsFor.name}
          store={transporterDocStore(docsFor.id)}
          parentId={docsFor.id}
          canEdit={canManage}
          onClose={() => setDocsFor(null)}
          onChanged={() => void load()}
        />
      )}

      {editing && (
        <TransporterDrawer
          key={editing === 'new' ? 'new' : editing.id}
          row={editing === 'new' ? null : editing}
          rows={rows}
          onDocsChanged={() => void load()}
          canManage={canManage}
          stations={stations}
          companies={companies}
          onClose={() => setEditing(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            await load()
          }}
        />
      )}

      <GridPager {...paging.pager} singular="transporter" plural="transporters" />
    </>
  )
}

function TransporterDrawer({
  row: existing, rows, canManage: canManageRecords, viewOnly = false, stations, companies, onClose, onDone, onDocsChanged,
}: {
  onDocsChanged?: () => void
  row: Transporter | null
  rows: Transporter[]
  canManage: boolean
  viewOnly?: boolean
  stations: Station[]
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
  const [submitted, setSubmitted] = useState(false)
  const errors = useMemo(() => transporterErrors(f, rows, row?.id, !row), [f, rows, row])
  const locationsMissing = !row && locationIds.length === 0
  const fieldValue: Record<string, string> = {
    't-name': f.name, 't-email': f.email, 't-gst': f.gst, 't-ophone': f.office_phone, 't-state': f.state, 't-sc': f.state_code,
    't-oaddr': f.office_address, 't-company': f.company_id, 't-bank': f.bank_account, 't-pan': f.pan, 't-cp': f.contact_person,
    't-mob': f.mobile, 't-mob2': f.mobile_2, 't-vtype': f.vehicle_type,
  }
  const show = (id: string): string | undefined => (submitted || (fieldValue[id] ?? '').trim() !== '' ? errors[id] : undefined)

  useEffect(() => {
    if (!row) return undefined
    let live = true
    setLinksLoaded(false)
    loadLinkIds('location', 'transporter', row.id)
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
    setSubmitted(true)
    setErr(null)
    if (Object.keys(errors).length > 0 || locationsMissing) {
      if (Object.keys(errors).length > 0) focusFirstError(errors)
      else document.getElementById('t-locations')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    setBusy(true)
    setErr(null)
    const { data, error } = row
      ? await supabase.from('transporters').update(payload(f)).eq('id', row.id).select('id')
      : await supabase.from('transporters').insert(payload(f)).select('id')
    if (error) {
      setBusy(false)
      return setErr(errMessage(error, 'Could not save this transporter'))
    }
    if (!data || data.length === 0) {
      setBusy(false)
      return setErr('Your account cannot change this transporter.')
    }
    const savedId = data[0]!.id as string
    const saved = row ? `${f.name.trim()} updated.` : `${f.name.trim()} added.`
    const notes: string[] = []
    if (row ? linksLoaded : locationIds.length > 0) {
      try {
        await syncLinks('location', 'transporter', savedId, locationIds)
      } catch {
        notes.push('its locations could not be saved; open it again to retry')
      }
    }
    if (!row && files.length > 0) {
      const failed = await uploadDocuments(transporterDocStore(savedId), savedId, files)
      if (failed.length > 0) notes.push(`some documents were not uploaded (${failed.join('; ')}); use Documents on the list to retry`)
    }
    setBusy(false)
    await onDone(notes.length > 0 ? `${saved} The record saved, but ${notes.join('; ')}.` : saved)
  }

  async function remove() {
    if (!existing) return
    setBusy(true)
    const { data, error } = await supabase.from('transporters').delete().eq('id', existing.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Your account cannot delete this transporter.')
    await onDone(`${existing.name} deleted.`)
  }

  const showForm = existing || action === 'create' || picked

  return (
    <Drawer title={existing ? `${existing.transporter_code} · ${existing.name}` : 'Transport Company Creation Form'} onClose={onClose} readOnly={viewOnly}>
      <ErrorBanner message={err} />
      {!existing && !viewOnly && (
        <RecordAction
          action={action}
          onAction={chooseAction}
          pickedId={pickedId}
          onPick={pick}
          records={rows.map((r) => ({ id: r.id, label: r.name }))}
          noun="transport company"
        />
      )}
      {!canManage && !viewOnly && <div className="notice small">You can view this record; changing it needs the “Add and edit transporters” permission.</div>}
      {showForm && (
        <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <FormSection title="Transport Type Details" count={11}>
            <Field id="t-name" label="Name" required error={show('t-name')}>
              <input id="t-name" value={f.name} placeholder="Enter Name" onChange={(ev) => set('name', ev.target.value)} />
            </Field>
            <Field id="t-email" label="Email" error={show('t-email')}>
              <input id="t-email" type="email" value={f.email} placeholder="Enter Email" onChange={(ev) => set('email', ev.target.value)} />
            </Field>
            <Field id="t-gst" label="GST No." required error={show('t-gst')} hint="monday calls this CGST. Fills state code, state and PAN.">
              <input id="t-gst" className="mono" maxLength={15} value={f.gst} placeholder="Enter GST No." onChange={(ev) => setGst(ev.target.value)} />
            </Field>
            <Field id="t-ophone" label="Office Phone" required error={show('t-ophone')}>
              <input id="t-ophone" className="mono" value={f.office_phone} placeholder="Office Phone number" onChange={(ev) => set('office_phone', ev.target.value)} />
            </Field>
            <Field id="t-rphone" label="Res Phone">
              <input id="t-rphone" className="mono" value={f.res_phone} placeholder="Res Phone number" onChange={(ev) => set('res_phone', ev.target.value)} />
            </Field>
            <Field id="t-state" label="State" required error={show('t-state')}>
              <input id="t-state" value={f.state} placeholder="Enter State" onChange={(ev) => set('state', ev.target.value)} />
            </Field>
            <Field id="t-sc" label="State Code" required error={show('t-sc')}>
              <input id="t-sc" className="mono" maxLength={2} value={f.state_code} placeholder="Enter State Code" onChange={(ev) => set('state_code', ev.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id="t-oaddr" label="Office Address" required error={show('t-oaddr')}>
              <textarea id="t-oaddr" rows={3} value={f.office_address} placeholder="Enter Office Address" onChange={(ev) => set('office_address', ev.target.value)} />
            </Field>
            <Field id="t-daddr" label="Mill/Factory/Delivery Address">
              <textarea id="t-daddr" rows={3} value={f.delivery_address} placeholder="Enter Mill/Factory/Delivery Address" onChange={(ev) => set('delivery_address', ev.target.value)} />
            </Field>
            <LinkPicker
              id="t-locations"
              label="Locations *"
              hint="The stations this transporter serves."
              options={locationOptions}
              value={locationIds}
              onChange={setLocationIds}
              disabled={!canManage}
              placeholder="-- Select Locations --"
            />
            {submitted && locationsMissing && <p className="field-warn" role="alert">Locations is required: choose at least one.</p>}
            <Field id="t-company" label="Business Units" required error={show('t-company')}>
              <select id="t-company" value={f.company_id} onChange={(ev) => set('company_id', ev.target.value)}>
                <option value="">-- Select Business Units --</option>
                {companies.filter((c) => c.is_active || c.id === f.company_id).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </Field>
          </FormSection>

          <FormSection title="Account Details" count={3}>
            <Field id="t-bank" label="Bank Account Number 1" required error={show('t-bank')}>
              <textarea id="t-bank" rows={2} value={f.bank_account} placeholder="Enter Bank Account Number 1" onChange={(ev) => set('bank_account', ev.target.value)} />
            </Field>
            <Field id="t-bank2" label="Bank Account Number 2">
              <textarea id="t-bank2" rows={2} value={f.bank_account_2} placeholder="Enter Bank Account Number 2" onChange={(ev) => set('bank_account_2', ev.target.value)} />
            </Field>
            <Field id="t-pan" label="IT PAN" required error={show('t-pan')} hint="10 characters.">
              <input id="t-pan" className="mono" maxLength={10} value={f.pan} placeholder="Enter IT PAN" onChange={(ev) => set('pan', ev.target.value.toUpperCase().replace(/\s+/g, ''))} />
            </Field>
          </FormSection>

          <FormSection title="Contact Details" count={4}>
            <Field id="t-cp" label="Contact Person 1" required error={show('t-cp')}>
              <input id="t-cp" value={f.contact_person} placeholder="Enter Contact Person 1" onChange={(ev) => set('contact_person', ev.target.value)} />
            </Field>
            <Field id="t-mob" label="Contact Person 1 Phone" required error={show('t-mob')} hint="10 digits.">
              <input id="t-mob" className="mono" inputMode="numeric" maxLength={10} value={f.mobile} placeholder="Contact Person 1 Phone number" onChange={(ev) => set('mobile', ev.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id="t-cp2" label="Contact Person 2">
              <input id="t-cp2" value={f.contact_person_2} placeholder="Enter Contact Person 2" onChange={(ev) => set('contact_person_2', ev.target.value)} />
            </Field>
            <Field id="t-mob2" label="Contact Person 2 Phone" error={show('t-mob2')} hint="10 digits.">
              <input id="t-mob2" className="mono" inputMode="numeric" maxLength={10} value={f.mobile_2} placeholder="Contact Person 2 Phone number" onChange={(ev) => set('mobile_2', ev.target.value.replace(/\D/g, ''))} />
            </Field>
          </FormSection>

          <FormSection title="Vehicle Details" count={4}>
            <Field id="t-vtype" label="Vehicle Type" required error={show('t-vtype')}>
              <select id="t-vtype" value={f.vehicle_type} onChange={(ev) => set('vehicle_type', ev.target.value)}>
                <option value="">-- Select Vehicle Type --</option>
                {VEHICLE_TYPES.map((v) => (<option key={v.value} value={v.value}>{v.label}</option>))}
              </select>
            </Field>
            <Field id="t-v1" label="Vehicle No 1">
              <input id="t-v1" className="mono" value={f.vehicle_no_1} placeholder="Enter Vehicle No 1" onChange={(ev) => set('vehicle_no_1', ev.target.value.toUpperCase())} />
            </Field>
            <Field id="t-v2" label="Vehicle No 2">
              <input id="t-v2" className="mono" value={f.vehicle_no_2} placeholder="Enter Vehicle No 2" onChange={(ev) => set('vehicle_no_2', ev.target.value.toUpperCase())} />
            </Field>
            <Field id="t-v3" label="Vehicle No 3">
              <input id="t-v3" className="mono" value={f.vehicle_no_3} placeholder="Enter Vehicle No 3" onChange={(ev) => set('vehicle_no_3', ev.target.value.toUpperCase())} />
            </Field>
          </FormSection>

          <FormSection title="Remarks" count={1}>
            <FullWidth>
              <Field id="t-remarks" label="Remarks">
                <textarea id="t-remarks" rows={3} value={f.remarks} placeholder="Enter Remarks" onChange={(ev) => set('remarks', ev.target.value)} />
              </Field>
            </FullWidth>
          </FormSection>

          {!viewOnly && (
            <FormSection title="Documents" count={1}>
              <FullWidth>
                {row ? <DocumentList store={transporterDocStore(row.id)} parentId={row.id} canEdit={canManage} onChanged={onDocsChanged} /> : <PendingDocuments files={files} onChange={setFiles} disabled={busy} />}
              </FullWidth>
            </FormSection>
          )}

          <FormSection title="More details" description="Kept in CRM+ for transport; not on the monday form.">
            <Field id="t-type" label="Type" hint="Internal = our own vehicle or resource.">
              <select id="t-type" value={f.transporter_type} onChange={(ev) => set('transporter_type', ev.target.value as Form['transporter_type'])}>
                {TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </Field>
            <Field id="t-short" label="Short name">
              <input id="t-short" value={f.short_name} onChange={(ev) => set('short_name', ev.target.value)} />
            </Field>
            <Field id="t-station" label="Station">
              <select id="t-station" value={f.station_id} onChange={(ev) => set('station_id', ev.target.value)}>
                <option value="">—</option>
                {stations.filter((s) => s.is_active || s.id === f.station_id).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </Field>
            <FullWidth>
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


      {canManage && (
        <div className="drawer-actions">
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || (!existing && action === 'update' && !picked)}>
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
