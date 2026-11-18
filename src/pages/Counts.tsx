/** Count Master (T-002), the yarn recipe as on the monday.com Counts board.
 *
 *  A count is Yarn 1 with its percentage and, while Yarn 1 is below 100%, a
 *  Yarn 2 for the remaining percentage: entering 45 opens Yarn 2 at 55, and
 *  entering 100 closes it (src/lib/counts.ts holds those rules). The name is
 *  built from the recipe like monday's Summary formula, by the database
 *  trigger. A count whose recipe already exists is saved flagged as a
 *  duplicate, as monday does, and listed under the "Record Validations"
 *  filter. Gated by `article.manage`. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  COUNT_CERTIFICATIONS, COUNT_MACHINES, COUNT_PLIES, COUNT_PROCESSES, COUNT_YARN_TYPES, COUNT_YARNS,
} from '../api/types'
import type { CountRow } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { GridPager, GridToolbar, usePaging, type FilterDef } from '../components/GridKit'
import { Drawer, DeleteControl } from '../components/Drawer'
import { RowActionMenu } from '../components/RowActionMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorBanner, FormSection, FullWidth } from '../components/FormKit'
import { focusFirstError, type FieldErrors, searchKey } from '../lib/validate'
import { Field } from '../components/PartyForms'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool, pickOne } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'
import { formatDateTime } from '../lib/format'
import {
  buildName, countLabel, fmtPct, normaliseRecipe, parsePct, recipeKey, recipeProblems, recipeState, YARNS,
  type CountRecipe,
} from '../lib/counts'

const COUNT_CSV_COLUMNS = [
  'item_no', 'name', 'display_name', 'count_no', 'machine', 'yarn_1', 'yarn_1_pct', 'yarn_2', 'yarn_2_pct',
  'overall_composition', 'overall_yarn', 'ply', 'process', 'certification', 'yarn_type',
  'is_duplicate', 'is_active',
] as const

type Editing = { mode: 'create' } | { mode: 'edit'; row: CountRow } | null

type FormState = CountRecipe & { name: string; is_active: boolean }

const BLANK: FormState = {
  name: '', count_no: '', machine: '', yarn_1: '', yarn_1_pct: '', yarn_2: '', ply: '', process: '',
  certification: '', yarn_type: '', is_active: true,
}

function toForm(row: CountRow): FormState {
  return {
    name: row.name ?? '',
    count_no: String(row.count_no),
    machine: row.machine,
    yarn_1: row.yarn_1,
    yarn_1_pct: fmtPct(Number(row.yarn_1_pct)),
    yarn_2: row.yarn_2 ?? '',
    ply: row.ply ?? '',
    process: row.process ?? '',
    certification: row.certification ?? '',
    yarn_type: row.yarn_type,
    is_active: row.is_active,
  }
}

/** monday's "Overall Yarn Composition" and "Overall Yarn" for a saved count. */
function overallOf(row: CountRow): { composition: string; yarn: string } {
  const total = Number(row.yarn_1_pct) + Number(row.yarn_2_pct ?? 0)
  return { composition: `${fmtPct(total)}%`, yarn: Number(row.yarn_1_pct) < 100 ? 'Blended' : countLabel(row.yarn_1) }
}

const FILTERS: FilterDef[] = [
  {
    name: 'dup',
    label: 'Record validations',
    allLabel: 'All counts',
    options: [{ value: 'dup', label: 'Duplicates only' }],
  },
  {
    name: 'status',
    label: 'Status',
    allLabel: 'All statuses',
    options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }],
  },
  {
    name: 'machine',
    label: 'Machine',
    allLabel: 'All machines',
    options: COUNT_MACHINES.map((m) => ({ value: m, label: countLabel(m) })),
  },
]

export default function Counts() {
  const { can } = useAuth()
  const canManage = can('article.manage')
  const [rows, setRows] = useState<CountRow[] | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [viewing, setViewing] = useState<CountRow | null>(null)
  const [deleting, setDeleting] = useState<CountRow | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delErr, setDelErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
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
    const q = searchKey(search)
    return (rows ?? []).filter((r) => {
      if (filterValues.dup === 'dup' && !r.is_duplicate) return false
      if (filterValues.status && (filterValues.status === 'active') !== r.is_active) return false
      if (filterValues.machine && r.machine !== filterValues.machine) return false
      if (!q) return true
      const overall = overallOf(r)
      // Every column the grid shows.
      return searchKey([
        r.name ?? '', formatDateTime(r.created_at), r.display_name, String(r.count_no), r.machine, r.yarn_1, String(r.yarn_1_pct),
        r.yarn_2 ?? '', r.yarn_2_pct === null ? '' : String(r.yarn_2_pct), overall.composition, overall.yarn, r.ply ?? '',
        r.process ?? '', r.certification ?? '', r.yarn_type, String(r.item_no), r.is_duplicate ? 'duplicate' : '', r.duplicate_error ?? '',
      ].join(' ')).includes(q)
    })
  }, [rows, search, filterValues])

  const paging = usePaging(shown, `${search}|${filterValues.dup ?? ''}|${filterValues.status ?? ''}|${filterValues.machine ?? ''}`)
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
    const out = list.map((r) => {
      const o = overallOf(r)
      return { ...r, overall_composition: o.composition, overall_yarn: o.yarn }
    })
    downloadCSV(`counts-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(COUNT_CSV_COLUMNS, out))
  }

  /** Reads one CSV row into a recipe. The new columns are the recipe; the old
   *  composition / ratio / blended columns are still understood. */
  function recipeFromCsv(r: { get: (c: string) => string }): FormState {
    let yarn_1 = r.get('yarn_1') ? pickOne('Yarn 1', r.get('yarn_1'), YARNS, true) : ''
    let yarn_1_pct = r.get('yarn_1_pct').trim()
    let yarn_2 = r.get('yarn_2') ? pickOne('Yarn 2', r.get('yarn_2'), YARNS) : ''

    if (!yarn_1 && r.get('composition')) {
      const composition = r.get('composition').trim().toUpperCase()
      const ratio = r.get('ratio').replace(/\s+/g, '')
      if (composition === 'BLENDED') {
        const pair = r.get('blended').replace(/\s*\/\s*/g, '/').toUpperCase().split('/')
        const [a, b] = pair
        if (!a || !b) throw new Error('Blended is required for a blended count')
        yarn_1 = pickOne('Yarn 1', a, YARNS, true)
        yarn_2 = pickOne('Yarn 2', b, YARNS, true)
        const first = ratio.split('/')[0] ?? ''
        yarn_1_pct = first === '' ? '' : first
      } else {
        yarn_1 = pickOne('Composition', composition, YARNS, true)
        yarn_1_pct = ratio.endsWith('%') ? ratio.slice(0, -1) : '100'
      }
    }
    // Yarn 1 alone means 100%.
    if (yarn_1_pct === '' && yarn_2 === '') yarn_1_pct = '100'

    const form: FormState = {
      name: r.get('name').trim(),
      count_no: r.get('count_no'),
      machine: pickOne('Machine', r.get('machine'), COUNT_MACHINES, true),
      yarn_1,
      yarn_1_pct,
      yarn_2,
      ply: pickOne('Single / double', r.get('ply'), COUNT_PLIES),
      process: pickOne('Process', r.get('process'), COUNT_PROCESSES),
      certification: pickOne('Certification', r.get('certification'), COUNT_CERTIFICATIONS),
      yarn_type: pickOne('Type', r.get('yarn_type'), COUNT_YARN_TYPES, true),
      is_active: parseBool(r.get('is_active'), true),
    }
    const given2 = r.get('yarn_2_pct').trim()
    const state = recipeState(form)
    if (given2 !== '' && state.remainder !== null && parsePct(given2) !== state.remainder) {
      throw new Error(`Yarn 2 % must be ${fmtPct(state.remainder)} (100 minus Yarn 1 %)`)
    }
    return normaliseRecipe(form)
  }

  async function importCSV(file: File) {
    setBusy(true)
    setBanner(null)
    setImportResults(null)
    const outcome = await importCsvFile(
      file,
      (r) => r.get('display_name') || [r.get('count_no'), r.get('machine'), r.get('yarn_1') || r.get('composition')].filter(Boolean).join(' '),
      async (r) => {
        const form = recipeFromCsv(r)
        const missing = recipeProblems(form)
        if (missing.length > 0) throw new Error(`Needs: ${missing.join(', ')}`)
        const { data: saved, error } = await supabase.from('count_master').insert(payloadOf(form)).select('is_duplicate,duplicate_error').single()
        if (!error && saved?.is_duplicate) throw new Error(`Saved, but flagged as a duplicate: ${saved.duplicate_error ?? ''}`)
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
    setDelBusy(true)
    setDelErr(null)
    const { data, error } = await supabase.from('count_master').delete().eq('id', deleting.id).select('id')
    setDelBusy(false)
    if (error || !data || data.length === 0) return setDelErr(error ? errMessage(error, 'Could not delete this count') : 'Could not delete this count.')
    setBanner({ kind: 'ok', text: 'Count deleted.' })
    setDeleting(null)
    await load()
  }

  if (!rows) return <Loading label="Loading counts" />

  const duplicateCount = rows.filter((r) => r.is_duplicate).length

  return (
    <>
      {editing && canManage && (
        <CountDrawer
          key={editing.mode === 'edit' ? editing.row.id : 'create'}
          editing={editing}
          rows={rows}
          onClose={() => setEditing(null)}
          onDone={async (text, kind = 'ok') => {
            setBanner({ kind, text })
            setEditing(null)
            await load()
          }}
          onError={(text) => setBanner({ kind: 'bad', text })}
        />
      )}

      {viewing && (
        <CountDrawer
          key={`v-${viewing.id}`}
          editing={{ mode: 'edit', row: viewing }}
          rows={rows}
          readOnly
          onClose={() => setViewing(null)}
          onDone={() => setViewing(null)}
          onError={() => undefined}
        />
      )}
      {deleting && (
        <ConfirmDialog title="Delete count" busy={delBusy} error={delErr} onConfirm={() => void confirmDelete()} onClose={() => setDeleting(null)}>
          Delete <strong>{deleting.display_name}</strong>? This cannot be undone.
        </ConfirmDialog>
      )}

      <GridToolbar
        searchPlaceholder="Search name, item ID, summary, thread count, machine, yarn, process, certification or type"
        title="Counts"
        subtitle={duplicateCount > 0 ? `${rows.length} counts · ${duplicateCount} flagged as duplicates` : undefined}
        total={rows.length}
        singular="count"
        plural="counts"
        query={search}
        onQuery={setSearch}
        filters={FILTERS}
        values={filterValues}
        onFilter={(name, value) => setFilterValues((v) => ({ ...v, [name]: value }))}
        onClear={() => setFilterValues({})}
      >
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
            New count
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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {canManage && (
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={selection.allSelected} onChange={selection.toggleAll} aria-label="Select all counts" />
                </th>
              )}
              <th className="left md-sticky">Name</th>
              <th>Created Date</th>
              <th className="left">Summary</th>
              <th>Thread Count</th>
              <th>Machine</th>
              <th>Yarn 1</th>
              <th>Yarn 1 (Percentage)</th>
              <th>Yarn 2</th>
              <th>Yarn 2 (Percentage)</th>
              <th>Overall Yarn Composition</th>
              <th>Overall Yarn</th>
              <th>Yarn</th>
              <th>Process</th>
              <th>Certification</th>
              <th>Type</th>
              <th>Item ID</th>
              <th>Is Duplicate</th>
              <th>Duplicate Error</th>
              <th className="md-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paging.visible.map((r) => {
              const overall = overallOf(r)
              const none = <span className="muted">—</span>
              return (
                <tr key={r.id}>
                  {canManage && (
                    <td>
                      <input type="checkbox" checked={selection.isSelected(r.id)} onChange={() => selection.toggle(r.id)} aria-label={`Select ${r.display_name}`} />
                    </td>
                  )}
                  <td className="left md-sticky">
                    <strong>{r.name || r.display_name}</strong>
                    {!r.is_active && <span className="chip bad" style={{ marginLeft: 8 }}>Inactive</span>}
                  </td>
                  <td className="mono small">{formatDateTime(r.created_at)}</td>
                  <td className="left small">{r.display_name}</td>
                  <td className="mono small">{r.count_no}</td>
                  <td className="small">{countLabel(r.machine)}</td>
                  <td className="small">{countLabel(r.yarn_1)}</td>
                  <td className="mono small">{fmtPct(Number(r.yarn_1_pct))}</td>
                  <td className="small">{r.yarn_2 ? countLabel(r.yarn_2) : none}</td>
                  <td className="mono small">{r.yarn_2 ? fmtPct(Number(r.yarn_2_pct)) : none}</td>
                  <td className="small">{overall.composition}</td>
                  <td className="small">{overall.yarn}</td>
                  <td className="small muted">{r.ply ? countLabel(r.ply) : '—'}</td>
                  <td className="small muted">{r.process ? countLabel(r.process) : '—'}</td>
                  <td className="small muted">{r.certification ? countLabel(r.certification) : '—'}</td>
                  <td className="small">{countLabel(r.yarn_type)}</td>
                  <td className="mono small">{r.item_no}</td>
                  <td>{r.is_duplicate ? <span className="chip warn">Duplicate</span> : none}</td>
                  <td className="small md-wrap">{r.duplicate_error ?? '—'}</td>
                  <td className="md-actions">
                    <RowActionMenu
                      label={r.display_name}
                      actions={[
                        { label: 'View', onSelect: () => setViewing(r) },
                        { label: 'Edit', onSelect: () => setEditing({ mode: 'edit', row: r }), disabledReason: canManage ? null : 'Needs “Add and edit article”' },
                        { label: 'Delete', tone: 'danger', onSelect: () => { setDelErr(null); setDeleting(r) }, disabledReason: canManage ? null : 'Needs “Add and edit article”' },
                      ]}
                    />
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr>
                <td className="empty" colSpan={canManage ? 20 : 19}>
                  {rows.length === 0 ? 'No counts yet.' : 'No count matches that search.'}
                  {rows.length === 0 && canManage ? ' Add the first one.' : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <GridPager {...paging.pager} singular="count" plural="counts" />
    </>
  )
}

/** What is saved: the recipe. The database derives the name, composition,
 *  ratio, blend, key and duplicate flag from it. */
function payloadOf(form: FormState) {
  const state = recipeState(form)
  return {
    name: form.name.trim() || null,
    count_no: Number(form.count_no),
    machine: form.machine,
    yarn_1: form.yarn_1,
    yarn_1_pct: state.pct1,
    yarn_2: state.pct2 !== null ? form.yarn_2 : null,
    yarn_2_pct: state.pct2,
    yarn_type: form.yarn_type,
    process: form.process || null,
    certification: form.certification || null,
    ply: form.ply || null,
    is_active: form.is_active,
  }
}

function CountDrawer({
  editing,
  rows,
  onClose,
  onDone,
  onError,
  readOnly = false,
}: {
  editing: NonNullable<Editing>
  readOnly?: boolean
  rows: CountRow[]
  onClose: () => void
  onDone: (message: string, kind?: 'ok' | 'bad') => void | Promise<void>
  onError: (message: string) => void
}) {
  const opened = editing.mode === 'edit' ? editing.row : null
  const existing = opened
  const [form, setForm] = useState<FormState>(opened ? toForm(opened) : BLANK)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  /** Every change goes through the recipe rules: 100% closes Yarn 2, and Yarn 2 cannot repeat Yarn 1. */
  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => normaliseRecipe({ ...prev, [key]: value }))
  }

  const state = recipeState(form)
  const missing = [...recipeProblems(form), ...(!existing && !form.name.trim() ? ['Name'] : [])]
  const errors = useMemo(() => {
    const er: FieldErrors = {}
    if (!existing && !form.name.trim()) er['ct-name'] = 'Name is required.'
    const n = Number(form.count_no)
    if (!form.count_no.trim()) er['ct-no'] = 'Thread Count is required (6 to 120).'
    else if (!Number.isInteger(n) || n < 6 || n > 120) er['ct-no'] = 'Thread Count must be a whole number from 6 to 120.'
    if (!form.machine) er['ct-machine'] = 'Machine is required.'
    if (!form.yarn_type) er['ct-type'] = 'Type is required.'
    if (!form.yarn_1) er['ct-y1'] = 'Yarn 1 is required.'
    const st = recipeState(form)
    if (st.pct1 === null) er['ct-p1'] = 'Yarn 1 (Percentage) must be more than 0 and at most 100.'
    else if (st.pct1 < 100 && form.yarn_2 === '') er['ct-y2'] = `Yarn 2 is required for the remaining ${fmtPct(100 - st.pct1)}%.`
    return er
  }, [form, existing])
  const fieldValue: Record<string, string> = {
    'ct-name': form.name, 'ct-no': form.count_no, 'ct-machine': form.machine, 'ct-type': form.yarn_type,
    'ct-y1': form.yarn_1, 'ct-p1': form.yarn_1_pct, 'ct-y2': form.yarn_2,
  }
  const show = (id: string): string | undefined => (submitted || (fieldValue[id] ?? '').trim() !== '' ? errors[id] : undefined)
  const twin = useMemo(() => {
    if (missing.length > 0) return null
    const key = recipeKey(form)
    return rows.find((r) => r.id !== existing?.id && r.recipe_key === key) ?? null
  }, [form, missing.length, rows, existing])

  async function save() {
    setSubmitted(true)
    setFormError(null)
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors)
      return
    }
    setBusy(true)
    const payload = payloadOf(form)
    const res = existing
      ? await supabase.from('count_master').update(payload).eq('id', existing.id).select('is_duplicate,duplicate_error').single()
      : await supabase.from('count_master').insert(payload).select('is_duplicate,duplicate_error').single()
    setBusy(false)
    if (res.error) {
      setFormError(errMessage(res.error, 'Could not save this count'))
      return
    }
    const saved = res.data as { is_duplicate: boolean; duplicate_error: string | null } | null
    const done = existing ? 'Count updated.' : 'Count added.'
    if (saved?.is_duplicate) await onDone(`${done} It is flagged as a duplicate: ${saved.duplicate_error ?? ''}`, 'bad')
    else await onDone(done)
  }

  async function remove() {
    if (!opened) return
    setBusy(true)
    const { error } = await supabase.from('count_master').delete().eq('id', opened.id)
    setBusy(false)
    if (error) {
      onError(errMessage(error, 'Could not delete this count'))
      onClose()
      return
    }
    await onDone('Count deleted.')
  }

  const select = (
    id: string,
    value: string,
    options: readonly string[],
    onChange: (v: string) => void,
    blank = '—',
    disabled = false,
  ) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{blank}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {countLabel(o)}
        </option>
      ))}
    </select>
  )

  const name = buildName(form)
  const readOnlyStyle = { background: 'var(--surface-3)' }

  return (
    <Drawer title={opened ? opened.display_name : 'Counts Creation Form'} onClose={onClose} readOnly={readOnly}>
      <ErrorBanner message={formError} />
      <>
          <div className="notice small">
            Summary: <strong>{name || '—'}</strong>
          </div>
          {twin && (
            <div className="alert warn" role="status">
              A count with this recipe already exists (“{twin.name || twin.display_name}”, item ID {twin.item_no}). It can still be saved, but it will be flagged as a duplicate.
            </div>
          )}

          <FormSection title="Count Information" count={7}>
            <Field id="ct-name" label="Name" required error={show('ct-name')} hint="Your own label for the count; the Summary is built from the recipe.">
              <input id="ct-name" value={form.name} placeholder="Enter Name" onChange={(e) => set('name', e.target.value)} autoFocus />
            </Field>
            <Field id="ct-no" label="Thread Count" required error={show('ct-no')} hint="Enter a value between 6s and 120s.">
              <input id="ct-no" inputMode="numeric" className="mono" value={form.count_no} placeholder="Enter Thread Count" onChange={(e) => set('count_no', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id="ct-machine" label="Machine" required error={show('ct-machine')}>
              {select('ct-machine', form.machine, COUNT_MACHINES, (v) => set('machine', v), '-- Select Machine --')}
            </Field>
            <Field id="ct-type" label="Type" required error={show('ct-type')} hint="Type of product.">
              {select('ct-type', form.yarn_type, COUNT_YARN_TYPES, (v) => set('yarn_type', v), '-- Select Type --')}
            </Field>
            <Field id="ct-process" label="Process">
              {select('ct-process', form.process, COUNT_PROCESSES, (v) => set('process', v), '-- Select Process --')}
            </Field>
            <Field id="ct-cert" label="Certification">
              {select('ct-cert', form.certification, COUNT_CERTIFICATIONS, (v) => set('certification', v), '-- Select Certification --')}
            </Field>
            <Field id="ct-ply" label="Yarn">
              {select('ct-ply', form.ply, COUNT_PLIES, (v) => set('ply', v), '-- Select Yarn --')}
            </Field>
            {opened && (
              <Field id="ct-item" label="Item ID" hint="Assigned automatically.">
                <input id="ct-item" className="mono" readOnly style={readOnlyStyle} value={opened.item_no} />
              </Field>
            )}
          </FormSection>

          <FormSection title="Fabric Composition" count={5}>
            <Field id="ct-y1" label="Yarn 1" required error={show('ct-y1')}>
              {select('ct-y1', form.yarn_1, COUNT_YARNS, (v) => set('yarn_1', v), '-- Select Yarn 1 --')}
            </Field>
            <Field id="ct-p1" label="Yarn 1 (Percentage)" required error={show('ct-p1')} hint="Up to 100. Below 100, a second yarn takes the rest.">
              <input id="ct-p1" inputMode="decimal" className="mono" value={form.yarn_1_pct} placeholder="Enter Yarn 1 (Percentage)" onChange={(e) => set('yarn_1_pct', e.target.value.replace(/[^0-9.]/g, ''))} />
            </Field>
            <Field
              id="ct-y2"
              label="Yarn 2"
              required={state.yarn2Enabled}
              error={show('ct-y2')}
              hint={state.yarn2Reason ?? `Takes the remaining ${fmtPct(state.remainder ?? 0)}%.`}
            >
              {select(
                'ct-y2',
                form.yarn_2,
                COUNT_YARNS.filter((y) => y !== form.yarn_1),
                (v) => set('yarn_2', v),
                state.yarn2Enabled ? '-- Select Yarn 2 --' : '—',
                !state.yarn2Enabled,
              )}
            </Field>
            <Field id="ct-p2" label="Yarn 2 (Percentage)" hint="Always the remainder of Yarn 1; it cannot be edited.">
              <input
                id="ct-p2"
                className="mono"
                readOnly
                style={readOnlyStyle}
                value={state.remainder !== null && form.yarn_2 !== '' ? fmtPct(state.remainder) : ''}
                placeholder={state.remainder !== null ? `${fmtPct(state.remainder)} remaining` : ''}
              />
            </Field>
            <Field id="ct-overall" label="Overall Yarn Composition" hint="Calculated field.">
              <input id="ct-overall" className="mono" readOnly style={readOnlyStyle} value={state.pct1 === null ? '' : state.overallComposition} placeholder="(Calculated field)" />
            </Field>
            <Field id="ct-overall-yarn" label="Overall Yarn" hint="Calculated field.">
              <input id="ct-overall-yarn" readOnly style={readOnlyStyle} value={state.pct1 === null ? '' : state.overallYarn} placeholder="(Calculated field)" />
            </Field>
            <FullWidth>
              <label className="check">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
                <span className="check-body">
                  <span className="check-label">Active</span>
                  <span className="check-hint">Inactive counts stay on record but should not be used on new leads.</span>
                </span>
              </label>
            </FullWidth>
          </FormSection>
      </>

      <div className="drawer-actions">
        <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : existing ? '✓ Update Item' : '✓ Create Item'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {opened && <DeleteControl label="Delete this count" name={opened.display_name} busy={busy} onConfirm={() => void remove()} />}
      </div>
    </Drawer>
  )
}
