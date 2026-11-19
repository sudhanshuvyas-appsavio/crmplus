/** Payment terms: the monday "Payment Terms" board has two columns, Name and Days.
 *  Reading needs deal/lead access; changing the list needs "Change system settings".
 *  (The database also keeps an advance % and a description; they are not on monday and
 *  are not shown here.) */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PaymentTerm } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { GridPager, GridToolbar, usePaging, type FilterDef } from '../components/GridKit'
import { Drawer, DeleteControl } from '../components/Drawer'
import { RowActionMenu } from '../components/RowActionMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorBanner } from '../components/FormKit'
import { Field } from '../components/PartyForms'
import { errMessage, numOrNull } from '../lib/party'
import { findDuplicate, focusFirstError, nameKey, nameProblem, type FieldErrors, searchKey } from '../lib/validate'

type Form = { name: string; days: string; is_active: boolean }
const blank: Form = { name: '', days: '0', is_active: true }

export default function PaymentTerms() {
  const { can } = useAuth()
  const canEdit = can('settings.manage')
  const [rows, setRows] = useState<PaymentTerm[] | null>(null)
  const [editing, setEditing] = useState<PaymentTerm | 'new' | null>(null)
  const [viewing, setViewing] = useState<PaymentTerm | null>(null)
  const [deleting, setDeleting] = useState<PaymentTerm | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [delErr, setDelErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('payment_terms').select('*').order('name')
    if (error) setBanner({ kind: 'bad', text: errMessage(error, 'Could not load payment terms') })
    setRows((data ?? []) as PaymentTerm[])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function confirmDelete() {
    if (!deleting) return
    setDelBusy(true)
    setDelErr(null)
    const { data, error } = await supabase.from('payment_terms').delete().eq('id', deleting.id).select('id')
    setDelBusy(false)
    if (error || !data || data.length === 0) return setDelErr(error ? errMessage(error) : 'Could not delete this term.')
    setBanner({ kind: 'ok', text: `${deleting.name} deleted.` })
    setDeleting(null)
    await load()
  }

  const filterDefs: FilterDef[] = [
    { name: 'status', label: 'Status', allLabel: 'All statuses', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
  ]

  // Search covers every column the grid shows: Name and Days.
  const shown = useMemo(() => {
    const q = searchKey(search)
    return (rows ?? []).filter(
      (r) =>
        (!statusFilter || (statusFilter === 'active') === r.is_active) &&
        (!q || [r.name, String(r.days)].some((v) => searchKey(v).includes(q))),
    )
  }, [rows, search, statusFilter])
  const paging = usePaging(shown, `${search}|${statusFilter}`)

  if (!rows) return <Loading label="Loading payment terms" />
  return (
    <>
      {editing && canEdit && (
        <TermDrawer
          key={editing === 'new' ? 'new' : editing.id}
          term={editing === 'new' ? null : editing}
          rows={rows}
          onClose={() => setEditing(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            await load()
          }}
        />
      )}

      {viewing && <TermDrawer key={`v-${viewing.id}`} term={viewing} rows={rows} readOnly onClose={() => setViewing(null)} onDone={() => setViewing(null)} />}
      {deleting && (
        <ConfirmDialog title="Delete payment term" busy={delBusy} error={delErr} onConfirm={() => void confirmDelete()} onClose={() => setDeleting(null)}>
          Delete <strong>{deleting.name}</strong>? This cannot be undone.
        </ConfirmDialog>
      )}

      <GridToolbar
        title="Payment Terms"
        total={rows.length}
        singular="payment term"
        plural="payment terms"
        query={search}
        onQuery={setSearch}
        searchPlaceholder="Search name or days"
        filters={filterDefs}
        values={{ status: statusFilter }}
        onFilter={(_, value) => setStatusFilter(value)}
        onClear={() => setStatusFilter('')}
      >
        {canEdit && (
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
            New payment term
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
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="left">Name</th>
              <th>Days</th>
              <th className="md-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paging.visible.map((r) => (
              <tr key={r.id}>
                <td className="left">
                  <strong>{r.name}</strong>
                  {!r.is_active && <span className="chip bad" style={{ marginLeft: 8 }}>Inactive</span>}
                </td>
                <td className="mono">{r.days}</td>
                <td className="md-actions">
                  <RowActionMenu
                    label={r.name}
                    actions={[
                      { label: 'Edit', onSelect: () => (canEdit ? setEditing(r) : setViewing(r)) },
                      { label: 'Delete', tone: 'danger', onSelect: () => { setDelErr(null); setDeleting(r) }, disabledReason: canEdit ? null : 'Needs “Change system settings”' },
                    ]}
                  />
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td className="empty" colSpan={3}>
                  {rows.length === 0 ? 'No payment terms yet.' : 'No payment term matches those filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <GridPager {...paging.pager} singular="payment term" plural="payment terms" />
    </>
  )
}

function TermDrawer({
  term,
  rows,
  onClose,
  onDone,
  readOnly = false,
}: {
  term: PaymentTerm | null
  rows: PaymentTerm[]
  onClose: () => void
  onDone: (m: string) => void | Promise<void>
  readOnly?: boolean
}) {
  const [f, setF] = useState<Form>(term ? { name: term.name, days: String(term.days), is_active: term.is_active } : blank)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const days = numOrNull(f.days)

  const errors = useMemo(() => {
    const e: FieldErrors = {}
    if (!f.name.trim()) e['pt-name'] = 'Name is required.'
    else if (nameProblem('Name', f.name)) e['pt-name'] = nameProblem('Name', f.name) as string
    else if (findDuplicate(rows, term?.id, (r) => r.name, f.name, nameKey)) e['pt-name'] = 'A payment term with this name already exists.'
    if (!f.days.trim()) e['pt-days'] = 'Days is required.'
    else if (days === null || !Number.isInteger(days) || days < 0 || days > 365) e['pt-days'] = 'Days must be a whole number between 0 and 365.'
    return e
  }, [f, rows, term, days])
  const show = (id: string, value: string) => (submitted || value.trim() !== '' ? errors[id] : undefined)

  async function save() {
    setSubmitted(true)
    setErr(null)
    if (Object.keys(errors).length > 0) return focusFirstError(errors)
    setBusy(true)
    const base = { name: f.name.trim().replace(/\s+/g, ' '), days, is_active: f.is_active }
    const { error } = term
      ? await supabase.from('payment_terms').update({ ...base, updated_at: new Date().toISOString() }).eq('id', term.id)
      : await supabase.from('payment_terms').insert(base)
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this payment term'))
    await onDone(`${base.name} ${term ? 'updated' : 'added'}.`)
  }

  async function remove() {
    if (!term) return
    setBusy(true)
    const { data, error } = await supabase.from('payment_terms').delete().eq('id', term.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Could not delete this term.')
    await onDone(`${term.name} deleted.`)
  }

  return (
    <Drawer title={term ? term.name : 'Add a payment term'} onClose={onClose} readOnly={readOnly}>
      <ErrorBanner message={err} />
      <div className="form-grid">
        <Field id="pt-name" label="Name" required error={show('pt-name', f.name)} hint="Must be unique.">
          <input id="pt-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field id="pt-days" label="Days" required error={show('pt-days', f.days)} hint="Number of days for the payment term.">
          <input id="pt-days" className="mono" inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
        </Field>
      </div>

      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : term ? 'Save changes' : 'Add the term'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {term && <DeleteControl label="Delete this term" name={term.name} busy={busy} onConfirm={() => void remove()} />}
      </div>
    </Drawer>
  )
}
