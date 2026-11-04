/** Count Master (T-002).
 *
 *  A count is a yarn specification: count number (6s-120s), machine,
 *  composition, ratio, blend, yarn type, process, certification and ply.
 *  The display name ("10 S RING SPUN 100% COTTON CONE COMBED COMPACT") is
 *  built by a database trigger, and a unique index on it stops the same
 *  specification being created twice. Gated by `article.manage`. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  COUNT_BLENDS, COUNT_CERTIFICATIONS, COUNT_COMMON_RATIOS, COUNT_COMPOSITIONS, COUNT_MACHINES,
  COUNT_PLIES, COUNT_PROCESSES, COUNT_YARN_TYPES,
} from '../api/types'
import type { CountRow } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool, pickOne } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'
import { formatDateTime } from '../lib/format'

const COUNT_CSV_COLUMNS = [
  'display_name', 'count_no', 'machine', 'composition', 'ratio', 'blended', 'yarn_type',
  'process', 'certification', 'ply', 'is_active',
] as const

type Editing = { mode: 'create' } | { mode: 'edit'; row: CountRow } | null

type FormState = {
  count_no: string
  machine: string
  composition: string
  ratio: string
  blended: string
  yarn_type: string
  process: string
  certification: string
  ply: string
  is_active: boolean
}

const BLANK: FormState = {
  count_no: '', machine: '', composition: '', ratio: '', blended: '', yarn_type: '',
  process: '', certification: '', ply: '', is_active: true,
}

function toForm(row: CountRow): FormState {
  return {
    count_no: String(row.count_no),
    machine: row.machine,
    composition: row.composition,
    ratio: row.ratio,
    blended: row.blended ?? '',
    yarn_type: row.yarn_type,
    process: row.process ?? '',
    certification: row.certification ?? '',
    ply: row.ply ?? '',
    is_active: row.is_active,
  }
}

/** Mirrors the database trigger so the form can preview the name. */
function previewName(f: FormState): string {
  if (!f.count_no && !f.machine && !f.composition) return '—'
  return [
    f.count_no ? `${f.count_no} S` : '',
    f.machine,
    f.ratio,
    f.composition === 'BLENDED' ? f.blended : f.composition,
    f.yarn_type,
    f.process,
    f.certification,
    f.ply,
  ]
    .filter(Boolean)
    .join(' ')
}

function problems(f: FormState): string[] {
  const out: string[] = []
  const n = Number(f.count_no)
  if (!f.count_no || !Number.isInteger(n) || n < 6 || n > 120) out.push('Count (a whole number from 6 to 120)')
  if (!f.machine) out.push('Machine')
  if (!f.composition) out.push('Composition')
  if (!/^[0-9]{1,3}(%|(\/[0-9]{1,3})+)$/.test(f.ratio.trim())) out.push('Ratio (like 100% or 60/40)')
  if (f.composition === 'BLENDED' && !f.blended) out.push('Blended (cotton/polyester or cotton/viscose)')
  if (!f.yarn_type) out.push('Type (cheese or cone)')
  return out
}

export default function Counts() {
  const { can } = useAuth()
  const canManage = can('article.manage')
  const [rows, setRows] = useState<CountRow[] | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [search, setSearch] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('count_master').select('*').order('count_no').order('display_name')
    if (error) {
      setBanner({ kind: 'bad', text: errMessage(error, 'Could not load counts') })
      setRows([])
      return
    }
    setRows((data ?? []) as CountRow[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter((r) => !q || r.display_name.toLowerCase().includes(q))
  }, [rows, search])

  const selection = useSelection(useMemo(() => shown.map((r) => r.id), [shown]))

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    const names = new Map((rows ?? []).map((r) => [r.id, r.display_name]))
    const result = await bulkDelete('count_master', selection.chosen)
    setBanner(deleteSummary('count', 'counts', result, (id) => names.get(id) ?? id))
    selection.clear()
    await load()
    setBusy(false)
  }

  function exportCSV() {
    const list = selection.chosen.length > 0 ? shown.filter((r) => selection.isSelected(r.id)) : shown
    downloadCSV(`counts-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(COUNT_CSV_COLUMNS, list))
  }

  async function importCSV(file: File) {
    setBusy(true)
    setBanner(null)
    setImportResults(null)
    const outcome = await importCsvFile(
      file,
      (r) => [r.get('count_no'), r.get('machine'), r.get('composition')].filter(Boolean).join(' '),
      async (r) => {
        const composition = pickOne('Composition', r.get('composition'), COUNT_COMPOSITIONS, true)
        const form: FormState = {
          count_no: r.get('count_no'),
          machine: pickOne('Machine', r.get('machine'), COUNT_MACHINES, true),
          composition,
          ratio: r.get('ratio').replace(/\s+/g, '').toUpperCase(),
          blended: composition === 'BLENDED' ? pickOne('Blended', r.get('blended'), COUNT_BLENDS, true) : '',
          yarn_type: pickOne('Type', r.get('yarn_type'), COUNT_YARN_TYPES, true),
          process: pickOne('Process', r.get('process'), COUNT_PROCESSES),
          certification: pickOne('Certification', r.get('certification'), COUNT_CERTIFICATIONS),
          ply: pickOne('Single / double', r.get('ply'), COUNT_PLIES),
          is_active: parseBool(r.get('is_active'), true),
        }
        const missing = problems(form)
        if (missing.length > 0) throw new Error(`Needs: ${missing.join(', ')}`)
        const { error } = await supabase.from('count_master').insert({
          count_no: Number(form.count_no),
          machine: form.machine,
          composition: form.composition,
          ratio: form.ratio,
          blended: form.blended || null,
          yarn_type: form.yarn_type,
          process: form.process || null,
          certification: form.certification || null,
          ply: form.ply || null,
          is_active: form.is_active,
        })
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

  if (!rows) return <Loading label="Loading counts" />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Count master</h1>
          <p className="page-sub">
            The yarn specifications leads and deals are quoted against. Each specification can exist
            only once.
          </p>
        </div>
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
            Add a count
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
          You can see counts, but adding or editing them needs the “Add and edit article
          specifications” permission.
        </div>
      )}

      <ListTools
        plural="counts"
        canImport={canManage}
        canDelete={canManage}
        selectedCount={selection.chosen.length}
        exportLabel={`Export ${selection.chosen.length > 0 ? `${selection.chosen.length} selected` : shown.length === rows.length ? 'all' : `${shown.length} shown`} as CSV`}
        exportDisabled={shown.length === 0}
        busy={busy}
        onImport={(f) => void importCSV(f)}
        onExport={exportCSV}
        onDelete={deleteSelected}
      />
      <ImportIssues results={importResults} />

      <div className="field" style={{ maxWidth: 360 }}>
        <input
          aria-label="Search counts"
          placeholder="Search counts, e.g. ring spun cotton"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <div className="card pad empty">
          {rows.length === 0 ? 'No counts yet.' : 'No count matches that search.'}
          {rows.length === 0 && canManage ? ' Add the first one.' : ''}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canManage && (
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={selection.allSelected} onChange={selection.toggleAll} aria-label="Select all counts" />
                  </th>
                )}
                <th>Count</th>
                <th>Machine</th>
                <th>Composition</th>
                <th>Type</th>
                <th>Process</th>
                <th>Certification</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={canManage ? 'clickable' : ''} onClick={() => canManage && setEditing({ mode: 'edit', row: r })}>
                  {canManage && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selection.isSelected(r.id)} onChange={() => selection.toggle(r.id)} aria-label={`Select ${r.display_name}`} />
                    </td>
                  )}
                  <td>
                    <strong>{r.display_name}</strong>
                  </td>
                  <td className="small">{r.machine}</td>
                  <td className="small">
                    {r.ratio} {r.blended ?? r.composition}
                  </td>
                  <td className="small">{r.yarn_type}</td>
                  <td className="small muted">{r.process ?? '—'}</td>
                  <td className="small muted">{r.certification ?? '—'}</td>
                  <td>{r.is_active ? <span className="chip good">Active</span> : <span className="chip bad">Inactive</span>}</td>
                  <td className="mono small">{formatDateTime(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && canManage && (
        <CountDrawer
          key={editing.mode === 'edit' ? editing.row.id : 'create'}
          editing={editing}
          onClose={() => setEditing(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            await load()
          }}
          onError={(text) => setBanner({ kind: 'bad', text })}
        />
      )}
    </>
  )
}

function CountDrawer({
  editing,
  onClose,
  onDone,
  onError,
}: {
  editing: NonNullable<Editing>
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
  onError: (message: string) => void
}) {
  const existing = editing.mode === 'edit' ? editing.row : null
  const [form, setForm] = useState<FormState>(existing ? toForm(existing) : BLANK)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      // the blend only means something for a BLENDED composition
      if (key === 'composition' && value !== 'BLENDED') next.blended = ''
      return next
    })
  }

  const missing = problems(form)

  async function save() {
    setBusy(true)
    setFormError(null)
    const payload = {
      count_no: Number(form.count_no),
      machine: form.machine,
      composition: form.composition,
      ratio: form.ratio.trim().toUpperCase(),
      blended: form.composition === 'BLENDED' ? form.blended : null,
      yarn_type: form.yarn_type,
      process: form.process || null,
      certification: form.certification || null,
      ply: form.ply || null,
      is_active: form.is_active,
    }
    const { error } = existing
      ? await supabase.from('count_master').update(payload).eq('id', existing.id)
      : await supabase.from('count_master').insert(payload)
    setBusy(false)
    if (error) {
      setFormError(errMessage(error, 'Could not save this count'))
      return
    }
    await onDone(existing ? 'Count updated.' : 'Count added.')
  }

  async function remove() {
    if (!existing) return
    setBusy(true)
    const { error } = await supabase.from('count_master').delete().eq('id', existing.id)
    setBusy(false)
    if (error) {
      onError(errMessage(error, 'Could not delete this count'))
      onClose()
      return
    }
    await onDone('Count deleted.')
  }

  const select = (id: string, value: string, options: readonly string[], onChange: (v: string) => void, blank = '—') => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{blank}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )

  return (
    <Drawer title={existing ? existing.display_name : 'Add a count'} onClose={onClose}>
      <div className="notice small">
        <strong>{previewName(form)}</strong>
      </div>
      {formError && (
        <div className="alert" role="alert">
          {formError}
        </div>
      )}
      <p className="muted small">Fields marked * are required.</p>
      <div className="form-grid">
        <Field id="ct-no" label="Count" required hint="Between 6s and 120s.">
          <input id="ct-no" inputMode="numeric" className="mono" value={form.count_no} onChange={(e) => set('count_no', e.target.value.replace(/\D/g, ''))} autoFocus />
        </Field>
        <Field id="ct-machine" label="Machine" required>
          {select('ct-machine', form.machine, COUNT_MACHINES, (v) => set('machine', v), 'Choose…')}
        </Field>
        <Field id="ct-comp" label="Composition" required>
          {select('ct-comp', form.composition, COUNT_COMPOSITIONS, (v) => set('composition', v), 'Choose…')}
        </Field>
        <Field id="ct-ratio" label="Ratio" required hint="100% for a pure yarn; 50/50, 60/40, 70/30 … for a blend.">
          <input id="ct-ratio" list="ct-ratios" className="mono" value={form.ratio} onChange={(e) => set('ratio', e.target.value.replace(/\s+/g, ''))} />
          <datalist id="ct-ratios">
            {COUNT_COMMON_RATIOS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
        {form.composition === 'BLENDED' && (
          <Field id="ct-blend" label="Blended" required>
            {select('ct-blend', form.blended, COUNT_BLENDS, (v) => set('blended', v), 'Choose…')}
          </Field>
        )}
        <Field id="ct-type" label="Type" required>
          {select('ct-type', form.yarn_type, COUNT_YARN_TYPES, (v) => set('yarn_type', v), 'Choose…')}
        </Field>
        <Field id="ct-process" label="Process">
          {select('ct-process', form.process, COUNT_PROCESSES, (v) => set('process', v))}
        </Field>
        <Field id="ct-cert" label="Certification">
          {select('ct-cert', form.certification, COUNT_CERTIFICATIONS, (v) => set('certification', v))}
        </Field>
        <Field id="ct-ply" label="Single / double yarn">
          {select('ct-ply', form.ply, COUNT_PLIES, (v) => set('ply', v))}
        </Field>
      </div>
      <div className="switch-row">
        <label className="check">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          <span className="check-body">
            <span className="check-label">Active</span>
            <span className="check-hint">Inactive counts stay on record but should not be used on new leads.</span>
          </span>
        </label>
      </div>
      {missing.length > 0 && <p className="field-hint">Still needed: {missing.join(', ')}.</p>}
      <div className="drawer-actions">
        <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || missing.length > 0}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Add the count'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {existing && <DeleteControl label="Delete this count" name={existing.display_name} busy={busy} onConfirm={() => void remove()} />}
      </div>
    </Drawer>
  )
}