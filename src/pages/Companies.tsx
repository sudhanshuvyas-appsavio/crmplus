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
import { CompanyDocuments, COMPANY_DOC_LIMIT } from '../components/CompanyDocuments'
import { PhoneField } from '../components/PhoneField'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { COMPANY_CSV_COLUMNS } from '../api/types'
import type { Company } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { GridPager, GridToolbar, usePaging } from '../components/GridKit'
import { downloadCSV, parseCSV, toCSV } from '../lib/csv'
import { formatDateTime } from '../lib/format'
import { GST_STATES, isGst, isMobile } from '../lib/party'
import { todayIST } from '../lib/tasks'
import { formatPhone, joinPhone, phoneProblem, splitPhone } from '../lib/phone'

type Editing = { mode: 'create' } | { mode: 'edit'; company: Company } | null

type FormState = {
  record_date: string
  name: string
  trade_name: string
  legal_name: string
  short_name: string
  brand_name: string
  currency: string
  ref_prefix: string
  address: string
  phone_numbers: string
  phone_1: string
  phone_2: string
  phone_3: string
  mobile: string
  fax: string
  email: string
  tax_id: string
  pan_number: string
  state: string
  state_code: string
  bank_account_1: string
  bank_account_2: string
  is_home: boolean
  is_buyer: boolean
  is_supplier: boolean
  is_active: boolean
}

const BLANK_FORM: FormState = {
  record_date: '',
  name: '',
  trade_name: '',
  legal_name: '',
  short_name: '',
  brand_name: '',
  currency: 'USD',
  ref_prefix: '',
  address: '',
  phone_numbers: '',
  phone_1: '',
  phone_2: '',
  phone_3: '',
  mobile: '',
  fax: '',
  email: '',
  tax_id: '',
  pan_number: '',
  state: '',
  state_code: '',
  bank_account_1: '',
  bank_account_2: '',
  is_home: false,
  is_buyer: false,
  is_supplier: false,
  is_active: true,
}

function toForm(company: Company): FormState {
  return {
    record_date: company.record_date ?? '',
    name: company.name,
    trade_name: company.trade_name ?? '',
    legal_name: company.legal_name ?? '',
    short_name: company.short_name,
    brand_name: company.brand_name ?? '',
    currency: company.currency,
    ref_prefix: company.ref_prefix,
    address: company.address ?? '',
    phone_numbers: (company.phone_numbers ?? []).join(', '),
    phone_1: company.phone_1 ?? '',
    phone_2: company.phone_2 ?? '',
    phone_3: company.phone_3 ?? '',
    mobile: company.mobile ?? '',
    fax: company.fax ?? '',
    email: company.email ?? '',
    tax_id: company.tax_id ?? '',
    pan_number: company.pan_number ?? '',
    state: company.state ?? '',
    state_code: company.state_code ?? '',
    bank_account_1: company.bank_account_1 ?? '',
    bank_account_2: company.bank_account_2 ?? '',
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
  const [search, setSearch] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)
  const [docCounts, setDocCounts] = useState<Map<string, number>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canManage = can('settings.manage')

  const load = useCallback(async () => {
    try {
      const rows = await loadCompanies()
      setCompanies(rows)
      // Documents column: how many files each business unit holds (people without access see 0).
      const docs = await supabase.from('company_documents').select('company_id')
      const counts = new Map<string, number>()
      for (const d of (docs.data ?? []) as { company_id: string }[]) counts.set(d.company_id, (counts.get(d.company_id) ?? 0) + 1)
      setDocCounts(counts)
      setSelected((prev) => new Set([...prev].filter((id) => rows.some((r) => r.id === id))))
    } catch (caught) {
      setBanner({ kind: 'bad', text: caught instanceof Error ? caught.message : 'Could not load companies' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (companies ?? []).filter(
      (c) =>
        !q ||
        [c.name, c.legal_name, c.brand_name, c.tax_id, c.state, c.short_name, c.ref_prefix].some((v) =>
          (v ?? '').toLowerCase().includes(q),
        ),
    )
  }, [companies, search])
  const paging = usePaging(shown, search)

  const allSelected = shown.length > 0 && shown.every((c) => selected.has(c.id))

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(shown.map((c) => c.id)))
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
        if (!name || !shortName || !refPrefix || !(get('bank_account_1') ?? '').trim()) {
          results.push({
            row: rowNum,
            name: name || '(blank)',
            status: 'error',
            detail: 'name, short_name, ref_prefix and bank_account_1 are required',
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
          const taxId = (get('tax_id') ?? '').trim().toUpperCase()
          // A valid GSTIN carries its own state: its first two digits are the
          // state code, so a row that leaves state blank still gets it.
          const gstState = isGst(taxId) ? taxId.slice(0, 2) : ''
          const stateCode = (get('state_code') ?? '').trim() || gstState
          const optional = (col: string) => (get(col) ?? '').trim() || null
          const { error } = await supabase.from('companies').insert({
            name,
            trade_name: optional('trade_name'),
            legal_name: optional('legal_name'),
            short_name: shortName,
            brand_name: optional('brand_name'),
            currency: (get('currency') ?? '').trim() || 'USD',
            ref_prefix: refPrefix,
            address: optional('address'),
            phone_numbers: phones.length ? phones : null,
            phone_1: joinPhone(splitPhone(get('phone_1'))) || null,
            phone_2: joinPhone(splitPhone(get('phone_2'))) || null,
            phone_3: joinPhone(splitPhone(get('phone_3'))) || null,
            mobile: optional('mobile'),
            fax: optional('fax'),
            email: optional('email'),
            tax_id: taxId || null,
            pan_number: pan || null,
            state_code: stateCode || null,
            state: optional('state') ?? (stateCode ? GST_STATES[stateCode] ?? null : null),
            bank_account_1: optional('bank_account_1'),
            bank_account_2: optional('bank_account_2'),
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

      <GridToolbar
        title="Business Units"
        total={companies.length}
        singular="business unit"
        plural="business units"
        query={search}
        onQuery={setSearch}
      >
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
            New business unit
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
              <th className="left">Name</th>
              <th>Trade name</th>
              <th>Legal name</th>
              <th>Brand / group</th>
              <th>State</th>
              <th>GST number</th>
              <th>Phone 1</th>
              <th>Phone 2</th>
              <th>Phone 3</th>
              <th>Bank account 1</th>
              <th>Bank account 2</th>
              <th>Documents</th>
              <th>Short name</th>
              <th>Ref prefix</th>
              <th>Role</th>
              <th>Status</th>
              <th>Record date</th>
            </tr>
          </thead>
          <tbody>
            {paging.visible.map((company) => (
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
                <td className="left">
                  <strong>{company.name}</strong>
                  {company.is_home && <span className="chip brand" style={{ marginLeft: 8 }}>Home</span>}
                </td>
                <td className="small">{company.trade_name || '—'}</td>
                <td className="small">{company.legal_name || '—'}</td>
                <td className="small muted">{company.brand_name || '—'}</td>
                <td className="small">{company.state || '—'}</td>
                <td className="mono small">{company.tax_id || '—'}</td>
                <td className="mono small">{formatPhone(company.phone_1) || '—'}</td>
                <td className="mono small">{formatPhone(company.phone_2) || '—'}</td>
                <td className="mono small">{formatPhone(company.phone_3) || '—'}</td>
                <td className="small" style={{ maxWidth: 220, whiteSpace: 'pre-line' }}>{company.bank_account_1 || '—'}</td>
                <td className="small" style={{ maxWidth: 220, whiteSpace: 'pre-line' }}>{company.bank_account_2 || '—'}</td>
                <td className="mono small">{docCounts.get(company.id) ?? 0}/{COMPANY_DOC_LIMIT}</td>
                <td className="mono">{company.short_name}</td>
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
                <td className="mono small">{company.record_date || formatDateTime(company.created_at)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td className="empty" colSpan={canManage ? 18 : 17}>
                  {companies.length === 0
                    ? `No business units yet.${canManage ? ' Add one, or import a CSV to bring in several at once.' : ''}`
                    : 'No business unit matches that search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <GridPager {...paging.pager} singular="business unit" plural="business units" />
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

  // monday sets the Date to today when a business unit is created; it stays editable.
  const [form, setForm] = useState<FormState>(existing ? toForm(existing) : { ...BLANK_FORM, record_date: todayIST() })
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setBusy(true)
    try {
      const payload = {
        record_date: form.record_date || todayIST(),
        name: form.name.trim(),
        trade_name: form.trade_name.trim() || null,
        legal_name: form.legal_name.trim() || null,
        short_name: form.short_name.trim(),
        brand_name: form.brand_name.trim() || null,
        currency: form.currency.trim() || 'USD',
        ref_prefix: form.ref_prefix.trim(),
        address: form.address.trim() || null,
        phone_numbers: form.phone_numbers
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean),
        phone_1: joinPhone(splitPhone(form.phone_1)) || null,
        phone_2: joinPhone(splitPhone(form.phone_2)) || null,
        phone_3: joinPhone(splitPhone(form.phone_3)) || null,
        mobile: form.mobile.trim() || null,
        fax: form.fax.trim() || null,
        email: form.email.trim() || null,
        tax_id: form.tax_id.trim() || null,
        pan_number: form.pan_number.trim().toUpperCase() || null,
        state: form.state.trim() || null,
        state_code: form.state_code.trim() || null,
        bank_account_1: form.bank_account_1.trim() || null,
        bank_account_2: form.bank_account_2.trim() || null,
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
          <label htmlFor="c-date">Date</label>
          <input id="c-date" type="date" value={form.record_date} onChange={(e) => set('record_date', e.target.value)} />
          <p className="field-hint">Set to today for a new business unit; change it if the record belongs to another day.</p>
        </div>
        <div className="field">
          <label htmlFor="c-name">Company name</label>
          <input id="c-name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="c-trade">Trade name</label>
          <input id="c-trade" value={form.trade_name} onChange={(e) => set('trade_name', e.target.value)} />
          <p className="field-hint">The name the business trades under, if it differs from the legal name.</p>
        </div>
        <div className="field">
          <label htmlFor="c-legal">Legal name</label>
          <input id="c-legal" value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
          <p className="field-hint">As registered, and as it appears on the GST certificate.</p>
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
        <PhoneField id="c-phone1" label="Phone 1" value={form.phone_1} onChange={(v) => set('phone_1', v)} />
        <PhoneField id="c-phone2" label="Phone 2" value={form.phone_2} onChange={(v) => set('phone_2', v)} />
        <PhoneField id="c-phone3" label="Phone 3" value={form.phone_3} onChange={(v) => set('phone_3', v)} />
        <div className="field">
          <label htmlFor="c-mobile">Mobile</label>
          <input id="c-mobile" inputMode="numeric" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
          {form.mobile.trim() !== '' && !isMobile(form.mobile) ? (
            <p className="field-warn">Mobile numbers are 10 digits, without +91 or a leading 0.</p>
          ) : (
            <p className="field-hint">Primary contact mobile, separate from the office lines above.</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="c-fax">Fax</label>
          <input id="c-fax" value={form.fax} onChange={(e) => set('fax', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c-tax">GST number</label>
          <input
            id="c-tax"
            className="mono"
            value={form.tax_id}
            onChange={(e) => {
              // "GSTIN : 33AB…" pasted from a certificate: keep only the number.
              const value = e.target.value.replace(/^\s*gstin\s*:?\s*/i, '').replace(/\s+/g, '').toUpperCase()
              setForm((prev) => ({
                ...prev,
                tax_id: value,
                // The first two digits of a GSTIN are the state code.
                ...(isGst(value)
                  ? { state_code: value.slice(0, 2), state: GST_STATES[value.slice(0, 2)] ?? prev.state }
                  : {}),
              }))
            }}
            maxLength={15}
          />
          {form.tax_id.trim() !== '' && !isGst(form.tax_id) ? (
            <p className="field-warn">Not a complete GST number yet (15 characters, e.g. 33AHFPK5121I1Z5).</p>
          ) : (
            <p className="field-hint">Filling this in sets the state below.</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="c-state">State</label>
          <select
            id="c-state"
            value={form.state_code}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                state_code: e.target.value,
                state: e.target.value ? GST_STATES[e.target.value] ?? '' : '',
              }))
            }
          >
            <option value="">—</option>
            {Object.entries(GST_STATES).map(([code, name]) => (
              <option key={code} value={code}>
                {name} ({code})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="c-bank1">
            Bank account details 1<span aria-hidden="true"> *</span>
          </label>
          <textarea id="c-bank1" rows={3} value={form.bank_account_1} onChange={(e) => set('bank_account_1', e.target.value)} />
          <p className="field-hint">Bank, branch, account number and IFSC. Required.</p>
        </div>
        <div className="field">
          <label htmlFor="c-bank2">Bank account details 2</label>
          <textarea id="c-bank2" rows={3} value={form.bank_account_2} onChange={(e) => set('bank_account_2', e.target.value)} />
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
          disabled={busy || !form.name.trim() || !form.short_name.trim() || !form.ref_prefix.trim() || !form.bank_account_1.trim() || [form.phone_1, form.phone_2, form.phone_3].some((v) => phoneProblem(v) !== null)}
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
      {!creating && existing && <CompanyDocuments companyId={existing.id} canEdit />}
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