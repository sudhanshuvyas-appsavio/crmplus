/** Locations (MDM plan G13 -- the delivery-site master).
 *
 *  The delivery / station sites that buyers, suppliers, transport companies and
 *  delivery addresses all pick from. Each site carries its zone, state, address,
 *  GST, phones, e-mail and the MD contact. The list, search, add, edit, switch
 *  off, import, export and delete all live here.
 *
 *  Reading follows the database policy (lead, deal or settings access).
 *  Changing names, switching off and deleting need `settings.manage`, exactly
 *  as the station_master row-level-security policies say; the screen only
 *  hides what the database would refuse anyway. A location that a lead,
 *  transporter or delivery address still uses cannot be deleted -- the
 *  database says so and the screen suggests switching it off instead. When a
 *  location is opened, a read-only "Used by" section counts the buyers,
 *  suppliers, transporters and delivery addresses linked to it. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ZONES } from '../api/types'
import type { LocationLink, StationMaster } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { GridPager, GridToolbar, usePaging } from '../components/GridKit'
import { Drawer, DeleteControl } from '../components/Drawer'
import { RowActionMenu } from '../components/RowActionMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DocumentList, countDocuments, uploadDocuments, type DocumentStore } from '../components/documents/DocumentList'
import { ErrorBanner, FormSection, FullWidth } from '../components/FormKit'
import { findDuplicate, focusFirstError, isEmail, nameKey, requireText, type FieldErrors, searchKey } from '../lib/validate'
import { PendingDocuments } from '../components/documents/PendingDocuments'
import { DocumentsModal } from '../components/documents/DocumentsModal'
import { formatDate } from '../lib/format'
import { todayIST } from '../lib/tasks'
import { Field } from '../components/PartyForms'
import { LinkPicker, type LinkOption } from '../components/LinkPicker'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool, pickOne } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { GST_STATES, errMessage, isGst } from '../lib/party'

const LOCATION_CSV_COLUMNS = [
  'name', 'zone', 'state', 'address', 'gst', 'phone', 'email', 'md_contact', 'accounts_phone', 'is_active',
] as const

const PHONE_RE = /^[0-9]{6,15}$/

/** Where a location's documents (monday's Documents column) are kept. */
const locationDocStore = (id: string): DocumentStore => ({
  table: 'location_documents',
  bucket: 'mdm-documents',
  parentColumn: 'station_id',
  pathPrefix: `location/${id}`,
  noun: 'location',
})

type Editing = { mode: 'create' } | { mode: 'edit'; row: StationMaster } | null
type StatusFilter = 'all' | 'active' | 'inactive'

type FormState = {
  name: string
  record_date: string
  zone: string
  state: string
  address: string
  gst: string
  phone: string
  accounts_phone: string
  email: string
  md_contact: string
  is_active: boolean
}

const BLANK: FormState = {
  name: '', record_date: '', zone: '', state: '', address: '', gst: '', phone: '', accounts_phone: '',
  email: '', md_contact: '', is_active: true,
}

function toForm(row: StationMaster): FormState {
  return {
    name: row.name,
    record_date: row.record_date ?? '',
    zone: row.zone ?? '',
    state: row.state ?? '',
    address: row.address ?? '',
    gst: row.gst ?? '',
    phone: row.phone ?? '',
    accounts_phone: row.accounts_phone ?? '',
    email: row.email ?? '',
    md_contact: row.md_contact ?? '',
    is_active: row.is_active,
  }
}

/** A pasted number such as "+91 98765 43210": spaces, dashes and a leading +91 removed. */
const cleanPhone = (v: string): string => {
  const digits = v.replace(/[^0-9+]/g, '')
  return digits.replace(/^\+?91(?=[0-9]{10}$)/, '').replace(/^\+/, '')
}

/** What is wrong with the form, as short phrases a person can act on. */
function problems(f: FormState): string[] {
  const out: string[] = []
  if (!f.name.replace(/\s+/g, ' ').trim()) out.push('Name')
  const gst = f.gst.trim()
  if (gst && !isGst(gst)) out.push('GST (15 characters, like 24ABCDE1234F1Z5)')
  const phone = f.phone.trim()
  if (phone && !PHONE_RE.test(phone)) out.push('Phone (6 to 15 digits)')
  const accounts = f.accounts_phone.trim()
  if (accounts && !PHONE_RE.test(accounts)) out.push('Accounts phone (6 to 15 digits)')
  const email = f.email.trim()
  if (email && !isEmail(email)) out.push('Email (like name@company.com)')
  return out
}

/** The columns written to the database; blanks become null. */
function toPayload(f: FormState) {
  const text = (v: string) => v.trim() || null
  return {
    name: f.name.replace(/\s+/g, ' ').trim(),
    record_date: f.record_date || null,
    zone: f.zone || null,
    state: text(f.state),
    address: text(f.address),
    gst: f.gst.trim() ? f.gst.trim().toUpperCase() : null,
    phone: text(f.phone),
    accounts_phone: text(f.accounts_phone),
    email: text(f.email),
    md_contact: text(f.md_contact),
    is_active: f.is_active,
  }
}

export default function Locations() {
  const { can } = useAuth()
  const canManage = can('settings.manage')
  const [rows, setRows] = useState<StationMaster[] | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [viewing, setViewing] = useState<StationMaster | null>(null)
  const [deleting, setDeleting] = useState<StationMaster | null>(null)
  const [docsFor, setDocsFor] = useState<StationMaster | null>(null)
  const [delErr, setDelErr] = useState<string | null>(null)
  const [docCounts, setDocCounts] = useState<Record<string, number>>({})
  const [parties, setParties] = useState<Record<string, string[]>>({})
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [zone, setZone] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('station_master').select('*').order('name')
    if (error) {
      setBanner({ kind: 'bad', text: errMessage(error, 'Could not load locations') })
      setRows([])
      return
    }
    const list = (data ?? []) as StationMaster[]
    setRows(list)
    setDocCounts(await countDocuments('location_documents', 'station_id', list.map((r) => r.id)))
    // "Buyers & Suppliers" column: the parties that use each location.
    const [links, buyers, suppliers] = await Promise.all([
      supabase.from('location_links').select('owner_type,owner_id,location_id').in('owner_type', ['buyer', 'supplier']),
      supabase.from('buyer_master').select('id,name'),
      supabase.from('supplier_master').select('id,name'),
    ])
    const names = new Map<string, string>()
    for (const b of (buyers.data ?? []) as { id: string; name: string }[]) names.set(`buyer:${b.id}`, b.name)
    for (const s of (suppliers.data ?? []) as { id: string; name: string }[]) names.set(`supplier:${s.id}`, s.name)
    const byLocation: Record<string, string[]> = {}
    for (const l of (links.data ?? []) as { owner_type: string; owner_id: string; location_id: string }[]) {
      const n = names.get(`${l.owner_type}:${l.owner_id}`)
      if (n) (byLocation[l.location_id] ??= []).push(n)
    }
    setParties(byLocation)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const stateOptions = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.state).filter((s): s is string => Boolean(s?.trim())))].sort((x, y) => x.localeCompare(y)),
    [rows],
  )
  const shown = useMemo(() => {
    const q = searchKey(search)
    return (rows ?? []).filter((r) => {
      if (status !== 'all' && (status === 'active') !== r.is_active) return false
      if (zone && r.zone !== zone) return false
      if (stateFilter && r.state !== stateFilter) return false
      if (!q) return true
      // Every column the grid shows.
      return [
        r.name, r.state, formatDate(r.record_date ?? r.created_at), (parties[r.id] ?? []).join(' '), r.address, r.gst, r.phone, r.email,
        r.md_contact, r.accounts_phone, ZONES.find((z) => z.value === r.zone)?.label ?? r.zone,
      ].some((v) => searchKey(v).includes(q))
    })
  }, [rows, search, status, zone, stateFilter, parties])

  const paging = usePaging(shown, `${search}|${status}|${zone}|${stateFilter}`)
  const selection = useSelection(useMemo(() => shown.map((r) => r.id), [shown]))

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    const names = new Map((rows ?? []).map((r) => [r.id, r.name]))
    const result = await bulkDelete('station_master', selection.chosen)
    setBanner(deleteSummary('location', 'locations', result, (id) => names.get(id) ?? id))
    selection.clear()
    await load()
    setBusy(false)
  }

  function exportCSV() {
    const list = selection.chosen.length > 0 ? shown.filter((r) => selection.isSelected(r.id)) : shown
    downloadCSV(`locations-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(LOCATION_CSV_COLUMNS, list))
  }

  async function importCSV(file: File) {
    setBusy(true)
    setBanner(null)
    setImportResults(null)
    const outcome = await importCsvFile(
      file,
      (row) => row.get('name'),
      async (row) => {
        const gst = row.get('gst').replace(/\s+/g, '').toUpperCase()
        const state = row.get('state').trim() || (isGst(gst) ? (GST_STATES[gst.slice(0, 2)] ?? '') : '')
        const form: FormState = {
          name: row.get('name'),
          record_date: '',
          zone: pickOne('Zone', row.get('zone'), ZONES.map((z) => z.value)),
          state,
          address: row.get('address'),
          gst,
          phone: cleanPhone(row.get('phone')),
          accounts_phone: cleanPhone(row.get('accounts_phone')),
          email: row.get('email'),
          md_contact: row.get('md_contact'),
          is_active: parseBool(row.get('is_active'), true),
        }
        if (!form.name.replace(/\s+/g, ' ').trim()) throw new Error('name is required')
        if (!form.address.trim()) throw new Error('address is required')
        if (findDuplicate(rows ?? [], null, (r) => r.name, form.name, nameKey)) throw new Error('A location with this name already exists.')
        const missing = problems(form)
        if (missing.length > 0) throw new Error(`Needs: ${missing.join(', ')}`)
        const { error } = await supabase.from('station_master').insert(toPayload(form))
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
    const { data, error } = await supabase.from('station_master').delete().eq('id', deleting.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) {
      return setDelErr(error ? errMessage(error) : 'Your account does not have permission to delete this.')
    }
    setBanner({ kind: 'ok', text: `${deleting.name} deleted.` })
    setDeleting(null)
    await load()
  }

  if (!rows) return <Loading label="Loading locations" />

  const activeCount = rows.filter((r) => r.is_active).length
  const zoneLabel = (value: string | null) => ZONES.find((z) => z.value === value)?.label ?? value ?? '—'

  return (
    <>
      {editing && canManage && (
        <LocationDrawer
          key={editing.mode === 'edit' ? editing.row.id : 'create'}
          row={editing.mode === 'edit' ? editing.row : null}
          rows={rows}
          onDocsChanged={() => void load()}
          onClose={() => setEditing(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            await load()
          }}
        />
      )}

      {viewing && (
        <LocationDrawer key={`v-${viewing.id}`} row={viewing} rows={rows} readOnly onClose={() => setViewing(null)} onDone={() => setViewing(null)} />
      )}
      {deleting && (
        <ConfirmDialog title="Delete location" busy={busy} error={delErr} onConfirm={() => void confirmDelete()} onClose={() => setDeleting(null)}>
          Delete <strong>{deleting.name}</strong>? A location that is still used cannot be deleted; switch it off instead.
        </ConfirmDialog>
      )}
      {docsFor && (
        <DocumentsModal
          title={docsFor.name}
          store={locationDocStore(docsFor.id)}
          parentId={docsFor.id}
          canEdit={canManage}
          onClose={() => setDocsFor(null)}
          onChanged={() => void load()}
        />
      )}

      <GridToolbar
        title="Locations"
        subtitle={rows.length > 0 ? `${activeCount} active of ${rows.length}` : undefined}
        total={rows.length}
        singular="location"
        plural="locations"
        query={search}
        onQuery={setSearch}
        searchPlaceholder="Search name, state, address, GST, phone, email, contact or zone"
        filters={[
          {
            name: 'status',
            label: 'Status',
            allLabel: 'All statuses',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ],
          },
          {
            name: 'zone',
            label: 'Zone',
            allLabel: 'All zones',
            options: ZONES.map((z) => ({ value: z.value, label: z.label })),
          },
          {
            name: 'state',
            label: 'State',
            allLabel: 'All states',
            options: stateOptions.map((s) => ({ value: s, label: s })),
          },
        ]}
        values={{ status: status === 'all' ? '' : status, zone, state: stateFilter }}
        onFilter={(name, value) => {
          if (name === 'status') setStatus((value || 'all') as StatusFilter)
          else if (name === 'zone') setZone(value)
          else if (name === 'state') setStateFilter(value)
        }}
        onClear={() => {
          setStatus('all')
          setZone('')
          setStateFilter('')
        }}
      >
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
            New location
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

      {!canManage && (
        <div className="notice small">
          You can see locations, but adding, renaming, importing or deleting them needs the “Change system
          settings” permission.
        </div>
      )}

      <ListTools
        plural="locations"
        canImport={canManage}
        canDelete={canManage}
        selectedCount={selection.chosen.length}
        exportLabel={`Export ${selection.chosen.length > 0 ? `${selection.chosen.length} selected` : 'all'} as CSV`}
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
                  <input
                    type="checkbox"
                    checked={selection.allSelected}
                    onChange={selection.toggleAll}
                    aria-label="Select all locations"
                  />
                </th>
              )}
              <th className="left md-sticky">Name</th>
              <th>State</th>
              <th>Date</th>
              <th>Buyers &amp; Suppliers</th>
              <th>Address</th>
              <th>GST Number</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Contact Person (MD)</th>
              <th>Accounts Dept Phone</th>
              <th>Zone</th>
              <th>Documents</th>
              <th className="md-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paging.visible.map((r) => (
              <tr key={r.id}>
                {canManage && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selection.isSelected(r.id)}
                      onChange={() => selection.toggle(r.id)}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                )}
                <td className="left md-sticky">
                  <strong>{r.name}</strong>
                  {!r.is_active && <span className="chip bad" style={{ marginLeft: 8 }}>Inactive</span>}
                </td>
                <td className="small">{r.state ?? '—'}</td>
                <td className="mono small">{formatDate(r.record_date ?? r.created_at)}</td>
                <td className="small md-wrap">{parties[r.id]?.join(', ') ?? '—'}</td>
                <td className="small md-wrap" style={{ whiteSpace: 'pre-line' }}>{r.address ?? '—'}</td>
                <td className="mono small">{r.gst ?? '—'}</td>
                <td className="mono small">{r.phone ?? '—'}</td>
                <td className="small">{r.email ?? '—'}</td>
                <td className="small">{r.md_contact ?? '—'}</td>
                <td className="mono small">{r.accounts_phone ?? '—'}</td>
                <td className="small">{zoneLabel(r.zone)}</td>
                <td className="mono small">{docCounts[r.id] ?? 0}</td>
                <td className="md-actions">
                  <RowActionMenu
                    label={r.name}
                    actions={[
                      { label: 'Edit', onSelect: () => (canManage ? setEditing({ mode: 'edit', row: r }) : setViewing(r)) },
                      { label: 'Documents', onSelect: () => setDocsFor(r) },
                      { label: 'Delete', tone: 'danger', onSelect: () => { setDelErr(null); setDeleting(r) }, disabledReason: canManage ? null : 'Needs “Change system settings”' },
                    ]}
                  />
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td className="empty" colSpan={canManage ? 15 : 14}>
                  {rows.length === 0
                    ? `No locations yet.${canManage ? ' Add one, or import a CSV with a name column.' : ''}`
                    : 'No location matches that search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <GridPager {...paging.pager} singular="location" plural="locations" />
    </>
  )
}

const USED_BY: { type: LocationLink['owner_type']; label: string }[] = [
  { type: 'buyer', label: 'Buyers' },
  { type: 'supplier', label: 'Suppliers' },
  { type: 'transporter', label: 'Transporters' },
  { type: 'job_process', label: 'Delivery addresses' },
]

/** Read-only counts of the records linked to a location. */
function UsedBy({ locationId }: { locationId: string }) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase.from('location_links').select('owner_type').eq('location_id', locationId)
      if (cancelled) return
      if (error) {
        setFailed(true)
        return
      }
      const tally: Record<string, number> = {}
      for (const r of (data ?? []) as Pick<LocationLink, 'owner_type'>[]) {
        tally[r.owner_type] = (tally[r.owner_type] ?? 0) + 1
      }
      setCounts(tally)
    })()
    return () => {
      cancelled = true
    }
  }, [locationId])

  return (
    <section aria-label="Used by">
      <h3>Used by</h3>
      {failed ? (
        <p className="muted small">Could not load the linked records.</p>
      ) : !counts ? (
        <p className="muted small">Loading…</p>
      ) : (
        <dl className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', margin: 0 }}>
          {USED_BY.map((u) => (
            <div key={u.type} style={{ display: 'contents' }}>
              <dt className="muted">{u.label}</dt>
              <dd style={{ margin: 0 }} className="mono">
                {counts[u.type] ?? 0}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function LocationDrawer({
  row: existing,
  rows,
  onClose,
  onDone,
  onDocsChanged,
  readOnly = false,
}: {
  row: StationMaster | null
  rows: StationMaster[]
  onDocsChanged?: () => void
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
  readOnly?: boolean
}) {
  const [files, setFiles] = useState<File[]>([])
  const row = existing
  const [form, setForm] = useState<FormState>(existing ? toForm(existing) : { ...BLANK, record_date: todayIST() })
  // monday's "Buyers & Suppliers" relation: the parties that use this location (kind:id).
  const [partyOptions, setPartyOptions] = useState<LinkOption[]>([])
  const [partyIds, setPartyIds] = useState<string[]>([])
  const [haveParties, setHaveParties] = useState<string[]>([])
  useEffect(() => {
    let live = true
    void (async () => {
      const [b, su, links] = await Promise.all([
        supabase.from('buyer_master').select('id,name,is_active').order('name'),
        supabase.from('supplier_master').select('id,name,is_active').order('name'),
        row
          ? supabase.from('location_links').select('owner_type,owner_id').eq('location_id', row.id).in('owner_type', ['buyer', 'supplier'])
          : Promise.resolve({ data: [] as { owner_type: string; owner_id: string }[], error: null }),
      ])
      if (!live) return
      const opts: LinkOption[] = [
        ...((b.data ?? []) as { id: string; name: string; is_active: boolean }[]).map((x) => ({ id: `buyer:${x.id}`, label: `${x.name} (Buyer)`, inactive: !x.is_active })),
        ...((su.data ?? []) as { id: string; name: string; is_active: boolean }[]).map((x) => ({ id: `supplier:${x.id}`, label: `${x.name} (Supplier)`, inactive: !x.is_active })),
      ]
      setPartyOptions(opts)
      const have = ((links.data ?? []) as { owner_type: string; owner_id: string }[]).map((l) => `${l.owner_type}:${l.owner_id}`)
      setHaveParties(have)
      setPartyIds(have)
    })()
    return () => {
      live = false
    }
  }, [row])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const errors = useMemo(() => {
    const er: FieldErrors = {}
    requireText(er, 'loc-name', form.name, 'Name is required.')
    if (!er['loc-name'] && findDuplicate(rows, row?.id, (r) => r.name, form.name, nameKey)) er['loc-name'] = 'A location with this name already exists.'
    if (form.gst.trim() && !isGst(form.gst.trim())) er['loc-gst'] = 'Enter a complete GST number (15 characters, like 24ABCDE1234F1Z5).'
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) er['loc-phone'] = 'Phone must be 6 to 15 digits.'
    if (form.email.trim() && !isEmail(form.email)) er['loc-email'] = 'Enter a valid email, like name@company.com.'
    if (form.accounts_phone.trim() && !PHONE_RE.test(form.accounts_phone.trim())) er['loc-acc-phone'] = 'Accounts Dept Phone must be 6 to 15 digits.'
    if (!row) requireText(er, 'loc-address', form.address, 'Address is required.')
    return er
  }, [form, rows, row])
  const fieldValue: Record<string, string> = {
    'loc-name': form.name, 'loc-gst': form.gst, 'loc-phone': form.phone, 'loc-email': form.email,
    'loc-acc-phone': form.accounts_phone, 'loc-address': form.address,
  }
  const show = (id: string): string | undefined => (submitted || (fieldValue[id] ?? '').trim() !== '' ? errors[id] : undefined)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  /** Typing a GST fills the state from its first two digits, as for parties. */
  function setGst(value: string) {
    setForm((prev) => {
      const gst = value.toUpperCase().replace(/\s+/g, '')
      const next = { ...prev, gst }
      const prefix = gst.slice(0, 2)
      if (/^[0-9]{2}$/.test(prefix)) {
        const previousName = GST_STATES[prev.gst.slice(0, 2)]
        const name = GST_STATES[prefix]
        if (name && (prev.state.trim() === '' || prev.state === previousName)) next.state = name
      }
      return next
    })
  }

  async function save() {
    setSubmitted(true)
    setErr(null)
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors)
      return
    }
    setBusy(true)
    const payload = toPayload(form)
    let newId: string | null = null
    let error: { message: string } | null
    if (row) {
      error = (await supabase.from('station_master').update(payload).eq('id', row.id)).error
    } else {
      const res = await supabase.from('station_master').insert(payload).select('id').single()
      error = res.error
      newId = (res.data as { id: string } | null)?.id ?? null
    }
    if (error) {
      setBusy(false)
      return setErr(errMessage(error, 'Could not save this location'))
    }
    const failed = newId && files.length > 0 ? await uploadDocuments(locationDocStore(newId), newId, files) : []
    let linkProblem = ''
    const locationId = row?.id ?? newId
    if (locationId) {
      const want = [...new Set(partyIds)]
      const add = want.filter((id) => !haveParties.includes(id))
      const drop = haveParties.filter((id) => !want.includes(id))
      const split = (id: string) => ({ owner_type: id.split(':')[0] as 'buyer' | 'supplier', owner_id: id.split(':')[1] as string })
      for (const id of drop) {
        const o = split(id)
        const { error: e1 } = await supabase.from('location_links').delete().eq('location_id', locationId).eq('owner_type', o.owner_type).eq('owner_id', o.owner_id)
        if (e1) linkProblem = errMessage(e1)
      }
      if (add.length > 0) {
        const { error: e2 } = await supabase.from('location_links').insert(add.map((id) => ({ ...split(id), location_id: locationId })))
        if (e2) linkProblem = errMessage(e2)
      }
    }
    setBusy(false)
    await onDone(
      failed.length > 0
        ? `${payload.name} added, but some documents were not uploaded (${failed.join('; ')}). Use Documents on the list to retry.`
        : linkProblem
          ? `${payload.name} ${row ? 'updated' : 'added'}, but its Buyers & Suppliers were not saved: ${linkProblem}`
          : `${payload.name} ${row ? 'updated' : 'added'}.`,
    )
  }

  async function remove() {
    if (!row) return
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.from('station_master').delete().eq('id', row.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) {
      return setErr(error ? errMessage(error) : 'Your account does not have permission to delete this.')
    }
    await onDone(`${row.name} deleted.`)
  }

  return (
    <Drawer title={existing ? existing.name : 'Location Creation Form'} onClose={onClose} readOnly={readOnly}>
      <ErrorBanner message={err} />
      <>
          <FormSection title="Location Details" count={11}>
            <Field id="loc-name" label="Name" required error={show('loc-name')} hint="Must be unique; capitals and spacing are ignored when checking.">
              <input id="loc-name" value={form.name} placeholder="Enter Name" onChange={(e) => set('name', e.target.value)} autoFocus />
            </Field>
            <Field id="loc-state" label="State">
              <input id="loc-state" value={form.state} placeholder="Enter State" onChange={(e) => set('state', e.target.value)} />
            </Field>
            <Field id="loc-date" label="Date">
              <input id="loc-date" type="date" value={form.record_date} onChange={(ev) => set('record_date', ev.target.value)} />
            </Field>
            <Field id="loc-zone" label="Zone">
              <select id="loc-zone" value={form.zone} onChange={(e) => set('zone', e.target.value)}>
                <option value="">-- Select Zone --</option>
                {ZONES.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="loc-gst" label="GST Number" error={show('loc-gst')} hint="Optional. The state is filled from the first two digits.">
              <input id="loc-gst" className="mono" value={form.gst} placeholder="Enter GST Number" onChange={(e) => setGst(e.target.value)} maxLength={15} />
            </Field>
            <Field id="loc-phone" label="Phone" error={show('loc-phone')} hint="6 to 15 digits.">
              <input id="loc-phone" inputMode="numeric" className="mono" value={form.phone} placeholder="Phone number" onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id="loc-email" label="Email" error={show('loc-email')}>
              <input id="loc-email" type="email" value={form.email} placeholder="Enter Email" onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field id="loc-md" label="Contact Person (MD)">
              <input id="loc-md" value={form.md_contact} placeholder="Enter Contact Person (MD)" onChange={(e) => set('md_contact', e.target.value)} />
            </Field>
            <LinkPicker
              id="loc-parties"
              label="Buyers & Suppliers"
              options={partyOptions}
              value={partyIds}
              onChange={setPartyIds}
              placeholder="-- Select Buyers & Suppliers --"
            />
            <Field id="loc-acc-phone" label="Accounts Dept Phone" error={show('loc-acc-phone')} hint="6 to 15 digits.">
              <input id="loc-acc-phone" inputMode="numeric" className="mono" value={form.accounts_phone} placeholder="Accounts Dept Phone number" onChange={(e) => set('accounts_phone', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <FullWidth>
              <Field id="loc-address" label="Address" required error={show('loc-address')}>
                <textarea id="loc-address" rows={3} value={form.address} placeholder="Enter Address" onChange={(e) => set('address', e.target.value)} />
              </Field>
            </FullWidth>
            {row && (
              <FullWidth>
                <UsedBy locationId={row.id} />
              </FullWidth>
            )}
            {existing && (
            <FullWidth>
              <label className="check">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
                <span className="check-body">
                  <span className="check-label">Active</span>
                  <span className="check-hint">Inactive locations stay on existing records but are no longer offered on new ones.</span>
                </span>
              </label>
            </FullWidth>
            )}
          </FormSection>

          {!readOnly && (
            <FormSection title="Documents" count={1}>
              <FullWidth>
                {row ? <DocumentList store={locationDocStore(row.id)} parentId={row.id} canEdit onChanged={onDocsChanged} /> : <PendingDocuments files={files} onChange={setFiles} disabled={busy} />}
              </FullWidth>
            </FormSection>
          )}
      </>

      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : row ? '✓ Update Item' : '✓ Create Item'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {existing && <DeleteControl label="Delete this location" name={existing.name} busy={busy} onConfirm={() => void remove()} />}
      </div>
    </Drawer>
  )
}
