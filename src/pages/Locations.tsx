/** Locations (MDM plan G13 -- the monday "Location MDM" board).
 *
 *  The delivery / station names that Leads, Transport Company and Sizing /
 *  Delivery Address all pick from. The table already existed as a lookup that
 *  was only ever added to inline; this gives it a register of its own: list,
 *  search, add, rename, switch off, import and delete.
 *
 *  Reading follows the database policy (lead, deal or settings access).
 *  Changing names, switching off and deleting need `settings.manage`, exactly
 *  as the station_master row-level-security policies say; the screen only
 *  hides what the database would refuse anyway. A location that a lead,
 *  transporter or delivery address still uses cannot be deleted -- the
 *  database says so and the screen suggests switching it off instead. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { StationMaster } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'
import { formatDateTime } from '../lib/format'

const LOCATION_CSV_COLUMNS = ['name', 'is_active'] as const

type Editing = { mode: 'create' } | { mode: 'edit'; row: StationMaster } | null
type StatusFilter = 'all' | 'active' | 'inactive'

export default function Locations() {
  const { can } = useAuth()
  const canManage = can('settings.manage')
  const [rows, setRows] = useState<StationMaster[] | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
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
        (!q || r.name.toLowerCase().includes(q)) &&
        (status === 'all' || (status === 'active' ? r.is_active : !r.is_active)),
    )
  }, [rows, search, status])

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
        const name = row.get('name').replace(/\s+/g, ' ')
        if (!name) throw new Error('name is required')
        const { error } = await supabase
          .from('station_master')
          .insert({ name, is_active: parseBool(row.get('is_active'), true) })
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

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Locations</h1>
          <p className="page-sub">
            Delivery and station names used by leads, transport companies and delivery addresses.
            {rows.length > 0 && ` ${activeCount} active of ${rows.length}.`}
          </p>
        </div>
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
            Add a location
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

      {!canManage && (
        <div className="notice small">
          You can see locations, but adding, renaming, importing or deleting them needs the “Change system
          settings” permission.
        </div>
      )}

      <div className="list-bar">
        <input
          className="list-search"
          type="search"
          placeholder="Search locations"
          aria-label="Search locations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <span className="small muted push">
          {shown.length} of {rows.length}
        </span>
      </div>

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

      {shown.length === 0 ? (
        <div className="card pad empty">
          {rows.length === 0
            ? `No locations yet.${canManage ? ' Add one, or import a CSV with a name column.' : ''}`
            : 'No location matches that search.'}
        </div>
      ) : (
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
                <th>Location</th>
                <th>Status</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
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
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td>
                    {r.is_active ? <span className="chip good">Active</span> : <span className="chip bad">Inactive</span>}
                  </td>
                  <td className="mono small">{formatDateTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
    </>
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
  const [name, setName] = useState(row?.name ?? '')
  const [active, setActive] = useState(row?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const clean = name.replace(/\s+/g, ' ').trim()

  async function save() {
    setBusy(true)
    setErr(null)
    const payload = { name: clean, is_active: active }
    const { error } = row
      ? await supabase.from('station_master').update(payload).eq('id', row.id)
      : await supabase.from('station_master').insert(payload)
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this location'))
    await onDone(`${clean} ${row ? 'updated' : 'added'}.`)
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
      <Field id="loc-name" label="Location name" required hint="Must be unique; capitals and spacing are ignored when checking.">
        <input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <label className="check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span className="check-body">
          <span className="check-label">Active</span>
          <span className="check-hint">Inactive locations stay on existing records but are no longer offered on new ones.</span>
        </span>
      </label>
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy || !clean} onClick={() => void save()}>
          {busy ? 'Saving…' : row ? 'Save changes' : 'Add the location'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {row && <DeleteControl label="Delete this location" name={row.name} busy={busy} onConfirm={() => void remove()} />}
      </div>
    </Drawer>
  )
}
