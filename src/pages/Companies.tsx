/** Companies -- a multi-record object (T-001 widened from a single org
 *  profile into general company master data).
 *
 * Reading the list is open to anyone signed in, same as the old singleton
 * screen; creating, editing, deleting (one or many) and importing are gated
 * by `settings.manage` at the database layer via RLS, not just in this
 * component. Exactly one company may be flagged "home" -- that one drives
 * the app's own branding and the deal reference-number prefix, enforced by
 * a partial unique index in the database, not just client-side care. */

import { CompanyContacts } from '../components/CompanyContacts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { COMPANY_CSV_COLUMNS } from '../api/types'
import type { Company } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { downloadCSV, parseCSV, toCSV } from '../lib/csv'
import { formatDateTime } from '../lib/format'

type Editing = { mode: 'create' } | { mode: 'edit'; company: Company } | null

type FormState = {
  name: string
  short_name: string
  brand_name: string
  currency: string
  ref_prefix: string
  address: string
  phone_numbers: string
  mobile: string
  fax: string
  email: string
  tax_id: string
  pan_number: string
  is_home: boolean
  is_buyer: boolean
  is_supplier: boolean
  is_active: boolean
}

const BLANK_FORM: FormState = {
  name: '',
  short_name: '',
  brand_name: '',
  currency: 'USD',
  ref_prefix: '',
  address: '',
  phone_numbers: '',
  mobile: '',
  fax: '',
  email: '',
  tax_id: '',
  pan_number: '',
  is_home: false,
  is_buyer: false,
  is_supplier: false,
  is_active: true,
}

function toForm(company: Company): FormState {
  return {
    name: company.name,
    short_name: company.short_name,
    brand_name: company.brand_name ?? '',
    currency: company.currency,
    ref_prefix: company.ref_prefix,
    address: company.address ?? '',
    phone_numbers: (company.phone_numbers ?? []).join(', '),
    mobile: company.mobile ?? '',
    fax: company.fax ?? '',
    email: company.email ?? '',
    tax_id: company.tax_id ?? '',
    pan_number: company.pan_number ?? '',
    is_home: company.is_home,
    is_buyer: company.is_buyer,
    is_supplier: company.is_supplier,
    is_active: company.is_active,
  }
}

async function loadCompanies(): Promise<Company[]> {
  const { data, error } = await supabase.from('companies').select('*').order('name')
  if (error) throw error
  return data ?? []
}

/** Only one row may have is_home = true (a partial unique index enforces
 *  this in the database) -- when a save wants to flag a new home, any
 *  existing one has to be cleared first in a separate statement. */
async function clearExistingHome(exceptId?: string) {
  let query = supabase.from('companies').update({ is_home: false }).eq('is_home', true)
  if (exceptId) query = query.neq('id', exceptId)
  const { error } = await query
  if (error) throw error
}

interface CsvRowResult {
  row: number
  name: string
  status: 'created' | 'error'
  detail?: string
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  const v = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(v)) return true
  if (['false', '0', 'no', 'n', ''].includes(v)) return false
  return fallback
}

export default function Companies() {
  const { can } = useAuth()
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Editing>(null)
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canManage = can('settings.manage')

  const load = useCallback(async () => {
    try {
      const rows = await loadCompanies()
      setCompanies(rows)
      setSelected((prev) => new Set([...prev].filter((id) => rows.some((r) => r.id === id))))
    } catch (caught) {
      setBanner({ kind: 'bad', text: caught instanceof Error ? caught.message : 'Could not load companies' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allSelected = companies !== null && companies.length > 0 && selected.size === companies.length

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (!companies) return
    setSelected(allSelected ? new Set() : new Set(companies.map((c) => c.id)))
  }

  async function deleteOne(company: Company) {
    setBusy(true)
    setBanner(null)
    try {
      const { error } = await supabase.from('companies').delete().eq('id', company.id)
      if (error) throw error
      setEditing(null)
      setBanner({ kind: 'ok', text: `${company.name} deleted.` })
      await load()
    } catch (caught) {
      setBanner({ kind: 'bad', text: caught instanceof Error ? caught.message : 'Could not delete the company' })
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    try {
      const ids = [...selected]
      const { error } = await supabase.from('companies').delete().in('id', ids)
      if (error) throw error
      setConfirmingBulkDelete(false)
      setSelected(new Set())
      setBanner({ kind: 'ok', text: `${ids.length} compan${ids.length === 1 ? 'y' : 'ies'} deleted.` })
      await load()
    } catch (caught) {
      setBanner({ kind: 'bad', text: caught instanceof Error ? caught.message : 'Could not delete the selected companies' })
    } finally {
      setBusy(false)
    }
  }

  function exportCSV() {
    if (!companies) return
    const rows = selected.size > 0 ? companies.filter((c) => selected.has(c.id)) : companies
    const csv = toCSV(COMPANY_CSV_COLUMNS, rows)
    downloadCSV(`companies-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  async function importCSV(file: File) {
    setBusy(true)
    setBanner(null)
    setImportResults(null)
    try {
      const text = await file.text()
      const parsed = parseCSV(text)
      if (parsed.length < 2) {
        setBanner({ kind: 'bad', text: 'That file has no data rows below the header.' })
        return
      }
      const header = (parsed[0] ?? []).map((h) => h.trim().toLowerCase())
      const dataRows = parsed.slice(1)
      const results: CsvRowResult[] = []
      // Sequential, not Promise.all: a row that sets is_home needs the
      // previous home cleared first, and we want row N+1 to see row N's
      // write rather than racing it.
      for (let i = 0; i < dataRows.length; i++) {
        const cells = dataRows[i]
        if (!cells || cells.every((c) => c.trim() === '')) continue // skip blank lines
        const get = (col: string) => {
          const idx = header.indexOf(col)
          return idx === -1 ? undefined : cells[idx]
        }
        const name = (get('name') ?? '').trim()
        const shortName = (get('short_name') ?? '').trim()
        const refPrefix = (get('ref_prefix') ?? '').trim()
        const rowNum = i + 2 // account for the header row, 1-indexed for humans
        if (!name || !shortName || !refPrefix) {
          results.push({
            row: rowNum,
            name: name || '(blank)',
            status: 'error',
            detail: 'name, short_name and ref_prefix are required',
          })
          continue
        }
        try {
          const wantsHome = parseBool(get('is_home'), false)
          if (wantsHome) await clearExistingHome()
          const phones = (get('phone_numbers') ?? '')
            .split(';')
            .map((p) => p.trim())
            .filter(Boolean)
          const pan = (get('pan_number') ?? '').trim().toUpperCase()
          const { error } = await supabase.from('companies').insert({
            name,
            short_name: shortName,
            brand_name: (get('brand_name') ?? '').trim() || null,
            currency: (get('currency') ?? '').trim() || 'USD',
            ref_prefix: refPrefix,
            address: (get('address') ?? '').trim() || null,
            phone_numbers: phones.length ? phones : null,
            mobile: (get('mobile') ?? '').trim() || null,
            fax: (get('fax') ?? '').trim() || null,
            email: (get('email') ?? '').trim() || null,
            tax_id: (get('tax_id') ?? '').trim() || null,
            pan_number: pan || null,
            is_home: wantsHome,
            is_buyer: parseBool(get('is_buyer'), false),
            is_supplier: parseBool(get('is_supplier'), false),
            is_active: parseBool(get('is_active'), true),
          })
          if (error) throw error
          results.push({ row: rowNum, name, status: 'created' })
        } catch (caught) {
          results.push({
            row: rowNum,
            name,
            status: 'error',
            detail: caught instanceof Error ? caught.message : 'Could not create this row',
          })
        }
      }
      setImportResults(results)
      const created = results.filter((r) => r.status === 'created').length
      const failed = results.length - created
      setBanner({
        kind: failed === 0 ? 'ok' : 'bad',
        text: `Imported ${created} of ${results.length} row${results.length === 1 ? '' : 's'}.${
          failed ? ` ${failed} failed -- see the details below.` : ''
        }`,
      })
      await load()
    } catch (caught) {
      setBanner({ kind: 'bad', text: caught instanceof Error ? caught.message : 'Could not read that file' })
    } finally {
      setBusy(false)
    }
  }

  if (!companies) return <Loading label="Loading companies" />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Companies</h1>
          <p className="page-sub">
            Every company record your agency deals with. The one marked <strong>Home</strong> drives
            the app's own branding and the deal reference-number prefix.
          </p>
        </div>
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
            Add a company
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
          You can see company records, but adding, editing, deleting or importing them needs the
          “Change system settings” permission. An administrator can grant it under Users.
        </div>
      )}

      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="drawer-actions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
          {canManage && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void importCSV(file)
                }}
              />
              <button
                className="btn"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                Import CSV
              </button>
            </>
          )}
          <button className="btn" type="button" onClick={exportCSV} disabled={companies.length === 0}>
            Export {selected.size > 0 ? `${selected.size} selected` : 'all'} as CSV
          </button>
          {canManage && selected.size > 0 && (
            <>
              {!confirmingBulkDelete ? (
                <button className="btn danger" type="button" onClick={() => setConfirmingBulkDelete(true)}>
                  Delete {selected.size} selected
                </button>
              ) : (
                <>
                  <span className="field-warn">Delete {selected.size} companies? This can't be undone.</span>
                  <button className="btn danger" type="button" onClick={() => void deleteSelected()} disabled={busy}>
                    {busy ? 'Deleting…' : 'Yes, delete them'}
                  </button>
                  <button className="btn ghost" type="button" onClick={() => setConfirmingBulkDelete(false)} disabled={busy}>
                    Cancel
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {importResults && importResults.some((r) => r.status === 'error') && (
        <div className="card pad" style={{ marginBottom: 16 }}>
          <h2 className="card-title">Import issues</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>CSV row</th>
                  <th>Name</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {importResults
                  .filter((r) => r.status === 'error')
                  .map((r) => (
                    <tr key={r.row}>
                      <td className="mono">{r.row}</td>
                      <td>{r.name}</td>
                      <td className="small">{r.detail}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {companies.length === 0 ? (
        <div className="card pad empty">
          No companies yet.{canManage ? ' Add one, or import a CSV to bring in several at once.' : ''}
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
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all companies"
                    />
                  </th>
                )}
                <th>Name</th>
                <th>Brand / group</th>
                <th>Short name</th>
                <th>Currency</th>
                <th>Ref prefix</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr
                  key={company.id}
                  className={canManage ? 'clickable' : ''}
                  onClick={() => canManage && setEditing({ mode: 'edit', company })}
                >
                  {canManage && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(company.id)}
                        onChange={() => toggleOne(company.id)}
                        aria-label={`Select ${company.name}`}
                      />
                    </td>
                  )}
                  <td>
                    <strong>{company.name}</strong>
                    {company.is_home && <span className="chip brand" style={{ marginLeft: 8 }}>Home</span>}
                  </td>
                  <td className="small muted">{company.brand_name || '—'}</td>
                  <td className="mono">{company.short_name}</td>
                  <td className="mono">{company.currency}</td>
                  <td className="mono">{company.ref_prefix}</td>
                  <td>
                    {!company.is_buyer && !company.is_supplier ? (
                      <span className="small muted">—</span>
                    ) : (
                      <>
                        {company.is_buyer && <span className="chip">Buyer</span>}
                        {company.is_supplier && (
                          <span className="chip" style={company.is_buyer ? { marginLeft: 6 } : undefined}>
                            Supplier
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {company.is_active ? (
                      <span className="chip good">Active</span>
                    ) : (
                      <span className="chip bad">Inactive</span>
                    )}
                  </td>
                  <td className="mono small">{formatDateTime(company.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && canManage && (
        <CompanyDrawer
          key={editing.mode === 'edit' ? editing.company.id : 'create'}
          editing={editing}
          onClose={() => setEditing(null)}
          onDelete={deleteOne}
          onSaved={async (message) => {
            setBanner({ kind: 'ok', text: message })
            setEditing(null)
            await load()
          }}
          onError={(message) => setBanner({ kind: 'bad', text: message })}
        />
      )}
    </>
  )
}

interface DrawerProps {
  editing: NonNullable<Editing>
  onClose: () => void
  onDelete: (company: Company) => Promise<void>
  onSaved: (message: string) => void | Promise<void>
  onError: (message: string) => void
}

function CompanyDrawer({ editing, onClose, onDelete, onSaved, onError }: DrawerProps) {
  const creating = editing.mode === 'create'
  const existing = editing.mode === 'edit' ? editing.company : null

  const [form, setForm] = useState<FormState>(existing ? toForm(existing) : BLANK_FORM)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setBusy(true)
    try {
      const payload = {
        name: form.name.trim(),
        short_name: form.short_name.trim(),
        brand_name: form.brand_name.trim() || null,
        currency: form.currency.trim() || 'USD',
        ref_prefix: form.ref_prefix.trim(),
        address: form.address.trim() || null,
        phone_numbers: form.phone_numbers
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean),
        mobile: form.mobile.trim() || null,
        fax: form.fax.trim() || null,
        email: form.email.trim() || null,
        tax_id: form.tax_id.trim() || null,
        pan_number: form.pan_number.trim().toUpperCase() || null,
        is_home: form.is_home,
        is_buyer: form.is_buyer,
        is_supplier: form.is_supplier,
        is_active: form.is_active,
      }

      // Flagging this one home needs any existing home cleared first --
      // the partial unique index would otherwise reject the write.
      if (form.is_home && !(existing?.is_home ?? false)) {
        await clearExistingHome(existing?.id)
      }

      if (creating) {
        const { error } = await supabase.from('companies').insert(payload)
        if (error) throw error
        await onSaved(`${payload.name} added.`)
      } else if (existing) {
        const { error } = await supabase.from('companies').update(payload).eq('id', existing.id)
        if (error) throw error
        await onSaved(`${payload.name} updated.`)
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not save this company')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer title={creating ? 'Add a company' : existing?.name ?? 'Edit company'} onClose={onClose}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="c-name">Company name</label>
          <input id="c-name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="c-short">Short name</label>
          <input id="c-short" value={form.short_name} onChange={(e) => set('short_name', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-brand">Brand / group name</label>
          <input id="c-brand" value={form.brand_name} onChange={(e) => set('brand_name', e.target.value)} />
          <p className="field-hint">
            The market-facing name customers recognise. Give the same value to every legal company
            that bills under this one brand.
          </p>
        </div>
        <div className="field">
          <label htmlFor="c-currency">Currency</label>
          <input
            id="c-currency"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value.toUpperCase())}
            maxLength={3}
          />
        </div>
        <div className="field">
          <label htmlFor="c-ref">Reference number prefix</label>
          <input
            id="c-ref"
            value={form.ref_prefix}
            onChange={(e) => set('ref_prefix', e.target.value.toUpperCase())}
          />
        </div>
        <div className="field">
          <label htmlFor="c-email">Email</label>
          <input id="c-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-phones">Phone numbers</label>
          <input id="c-phones" value={form.phone_numbers} onChange={(e) => set('phone_numbers', e.target.value)} />
          <p className="field-hint">Comma-separated if there's more than one.</p>
        </div>
        <div className="field">
          <label htmlFor="c-mobile">Mobile</label>
          <input id="c-mobile" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
          <p className="field-hint">Primary contact mobile, separate from the office lines above.</p>
        </div>
        <div className="field">
          <label htmlFor="c-fax">Fax</label>
          <input id="c-fax" value={form.fax} onChange={(e) => set('fax', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-tax">Tax ID</label>
          <input id="c-tax" value={form.tax_id} onChange={(e) => set('tax_id', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-pan">PAN number</label>
          <input
            id="c-pan"
            value={form.pan_number}
            onChange={(e) => set('pan_number', e.target.value.toUpperCase())}
            maxLength={10}
            className="mono"
          />
          <p className="field-hint">As it appears on the PAN card, e.g. AHFP5121IG.</p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="c-address">Address</label>
        <textarea id="c-address" rows={3} value={form.address} onChange={(e) => set('address', e.target.value)} />
      </div>

      <div className="switch-row">
        <label className="check">
          <input type="checkbox" checked={form.is_home} onChange={(e) => set('is_home', e.target.checked)} />
          <span className="check-body">
            <span className="check-label">
              Home company
              <em className="tag warn">drives branding</em>
            </span>
            <span className="check-hint">
              Its name, currency and reference prefix show up across the app. Flagging this one
              automatically un-flags whichever company held it before.
            </span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          <span className="check-body">
            <span className="check-label">Active</span>
            <span className="check-hint">Inactive companies stay on record but are flagged as such.</span>
          </span>
        </label>
      </div>

      <h3 className="section-title">Role</h3>
      <p className="muted small">
        A party can be a buyer, a supplier, or both at once -- tick what applies instead of creating
        a second record for the same company.
      </p>
      <div className="switch-row">
        <label className="check">
          <input type="checkbox" checked={form.is_buyer} onChange={(e) => set('is_buyer', e.target.checked)} />
          <span className="check-body">
            <span className="check-label">Buyer</span>
            <span className="check-hint">This company buys from us.</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.is_supplier} onChange={(e) => set('is_supplier', e.target.checked)} />
          <span className="check-body">
            <span className="check-label">Supplier</span>
            <span className="check-hint">This company supplies to us.</span>
          </span>
        </label>
      </div>

      <div className="drawer-actions">
        <button
          className="btn primary"
          type="button"
          onClick={() => void save()}
          disabled={busy || !form.name.trim() || !form.short_name.trim() || !form.ref_prefix.trim()}
        >
          {busy ? 'Saving…' : creating ? 'Create the company' : 'Save changes'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {!creating && existing && (
          <>
            {!confirmingDelete ? (
              <button className="btn danger push" type="button" onClick={() => setConfirmingDelete(true)} disabled={busy}>
                Delete this company
              </button>
            ) : (
              <span className="push" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="field-warn">Delete {existing.name}?</span>
                <button className="btn danger" type="button" onClick={() => void onDelete(existing)} disabled={busy}>
                  {busy ? 'Deleting…' : 'Yes, delete it'}
                </button>
                <button className="btn ghost" type="button" onClick={() => setConfirmingDelete(false)} disabled={busy}>
                  Cancel
                </button>
              </span>
            )}
          </>
        )}
      </div>
      {!creating && existing && <CompanyContacts companyId={existing.id} />}
    </Drawer>
  )
}

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <button className="scrim" type="button" aria-label="Close" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  )
}