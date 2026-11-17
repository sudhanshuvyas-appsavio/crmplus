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
import { Field } from '../components/PartyForms'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool, pickOne } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { GST_STATES, errMessage, isGst } from '../lib/party'

const LOCATION_CSV_COLUMNS = [
  'name', 'zone', 'state', 'address', 'gst', 'phone', 'email', 'md_contact', 'accounts_phone', 'is_active',
] as const

const PHONE_RE = /^[0-9]{6,15}$/

type Editing = { mode: 'create' } | { mode: 'edit'; row: StationMaster } | null
type StatusFilter = 'all' | 'active' | 'inactive'

type FormState = {
  name: string
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
  name: '', zone: '', state: '', address: '', gst: '', phone: '', accounts_phone: '',
  email: '', md_contact: '', is_active: true,
}

function toForm(row: StationMaster): FormState {
  return {
    name: row.name,
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

/** What is wrong with the form, as short phrases a person can act on. */
function problems(f: FormState): string[] {
  const out: string[] = []
  if (!f.name.replace(/\s+/g, ' ').trim()) out.push('Location name')
  const gst = f.gst.trim()
  if (gst && !isGst(gst)) out.push('GST (15 characters, like 24ABCDE1234F1Z5)')
  const phone = f.phone.trim()
  if (phone && !PHONE_RE.test(phone)) out.push('Phone (6 to 15 digits)')
  const accounts = f.accounts_phone.trim()
  if (accounts && !PHONE_RE.test(accounts)) out.push('Accounts phone (6 to 15 digits)')
  const email = f.email.trim()
  if (email && !email.includes('@')) out.push('Email (needs an @)')
  return out
}

/** The columns written to the database; blanks become null. */
function toPayload(f: FormState) {
  const text = (v: string) => v.trim() || null
  return {
    name: f.name.replace(/\s+/g, ' ').trim(),
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
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [zone, setZone] = useState('')
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
    setRows((data ?? []) as StationMaster[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(
      (r) =>
        (!q ||
          [r.name, r.state, r.address, r.md_contact].some((v) => (v ?? '').toLowerCase().includes(q))) &&
        (status === 'all' || (status === 'active' ? r.is_active : !r.is_active)) &&
        (!zone || r.zone === zone),
    )
  }, [rows, search, status, zone])

  const paging = usePaging(shown, `${search}|${status}|${zone}`)
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
          zone: pickOne('Zone', row.get('zone'), ZONES.map((z) => z.value)),
          state,
          address: row.get('address'),
          gst,
          phone: row.get('phone').replace(/[\s-]+/g, ''),
          accounts_phone: row.get('accounts_phone').replace(/[\s-]+/g, ''),
          email: row.get('email'),
          md_contact: row.get('md_contact'),
          is_active: parseBool(row.get('is_active'), true),
        }
        if (!form.name.replace(/\s+/g, ' ').trim()) throw new Error('name is required')
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

  if (!rows) return <Loading label="Loading locations" />

  const activeCount = rows.filter((r) => r.is_active).length
  const zoneLabel = (value: string | null) => ZONES.find((z) => z.value === value)?.label ?? value ?? '—'

  return (
    <>
      {editing && canManage && (
        <LocationDrawer
          key={editing.mode === 'edit' ? editing.row.id : 'create'}
          row={editing.mode === 'edit' ? editing.row : null}
          onClose={() => setEditing(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            await load()
          }}
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
        searchPlaceholder="Search name, state, address or MD contact"
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
        ]}
        values={{ status: status === 'all' ? '' : status, zone }}
        onFilter={(name, value) => {
          if (name === 'status') setStatus((value || 'all') as StatusFilter)
          else if (name === 'zone') setZone(value)
        }}
        onClear={() => {
          setStatus('all')
          setZone('')
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
              <th className="left">Location</th>
              <th>Zone</th>
              <th>State</th>
              <th>Phone</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {paging.visible.map((r) => (
              <tr
                key={r.id}
                className={canManage ? 'clickable' : ''}
                onClick={() => canManage && setEditing({ mode: 'edit', row: r })}
              >
                {canManage && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selection.isSelected(r.id)}
                      onChange={() => selection.toggle(r.id)}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                )}
                <td className="left">
                  <strong>{r.name}</strong>
                </td>
                <td className="small">{zoneLabel(r.zone)}</td>
                <td className="small">{r.state ?? '—'}</td>
                <td className="mono small">{r.phone ?? '—'}</td>
                <td>
                  {r.is_active ? <span className="chip good">Active</span> : <span className="chip bad">Inactive</span>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td className="empty" colSpan={canManage ? 6 : 5}>
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
  row,
  onClose,
  onDone,
}: {
  row: StationMaster | null
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
}) {
  const [form, setForm] = useState<FormState>(row ? toForm(row) : BLANK)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const missing = problems(form)

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
    setBusy(true)
    setErr(null)
    const payload = toPayload(form)
    const { error } = row
      ? await supabase.from('station_master').update(payload).eq('id', row.id)
      : await supabase.from('station_master').insert(payload)
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this location'))
    await onDone(`${payload.name} ${row ? 'updated' : 'added'}.`)
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
    <Drawer title={row ? row.name : 'Add a location'} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <p className="muted small">Fields marked * are required.</p>
      <div className="form-grid">
        <Field id="loc-name" label="Location name" required hint="Must be unique; capitals and spacing are ignored when checking.">
          <input id="loc-name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field id="loc-zone" label="Zone">
          <select id="loc-zone" value={form.zone} onChange={(e) => set('zone', e.target.value)}>
            <option value="">—</option>
            {ZONES.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="loc-gst" label="GST" hint="Optional. The state is filled from the first two digits.">
          <input id="loc-gst" className="mono" value={form.gst} onChange={(e) => setGst(e.target.value)} maxLength={15} />
        </Field>
        <Field id="loc-state" label="State">
          <input id="loc-state" value={form.state} onChange={(e) => set('state', e.target.value)} />
        </Field>
        <Field id="loc-address" label="Address">
          <textarea id="loc-address" rows={3} value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field id="loc-phone" label="Phone" hint="6 to 15 digits.">
          <input
            id="loc-phone"
            inputMode="numeric"
            className="mono"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field id="loc-acc-phone" label="Accounts phone" hint="6 to 15 digits.">
          <input
            id="loc-acc-phone"
            inputMode="numeric"
            className="mono"
            value={form.accounts_phone}
            onChange={(e) => set('accounts_phone', e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field id="loc-email" label="Email">
          <input id="loc-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field id="loc-md" label="MD contact">
          <input id="loc-md" value={form.md_contact} onChange={(e) => set('md_contact', e.target.value)} />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
        <span className="check-body">
          <span className="check-label">Active</span>
          <span className="check-hint">Inactive locations stay on existing records but are no longer offered on new ones.</span>
        </span>
      </label>
      {missing.length > 0 && <p className="field-hint">Still needed: {missing.join(', ')}.</p>}
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy || missing.length > 0} onClick={() => void save()}>
          {busy ? 'Saving…' : row ? 'Save changes' : 'Add the location'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {row && <DeleteControl label="Delete this location" name={row.name} busy={busy} onConfirm={() => void remove()} />}
      </div>
      {row && <UsedBy locationId={row.id} />}
    </Drawer>
  )
}
