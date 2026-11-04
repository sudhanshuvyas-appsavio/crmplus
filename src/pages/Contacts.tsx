/** Contacts: the Buyer Master and Supplier Master on one screen.
 *
 *  Every contact has a Role -- Buyer, Supplier or Both. Underneath, buyers and
 *  suppliers are still two tables (leads, qualification and deals point at
 *  them), so a contact with the role Both is one record on each side sharing
 *  a PAN. The screen hides that: it lists one row per contact, edits both
 *  records together, and changing the role adds the missing record or, when
 *  narrowing, marks the dropped side inactive (nothing is deleted, so its
 *  documents, notes and history stay and the role can be widened again).
 *
 *  Buyer rules and Supplier rules are the same as before; a role that includes
 *  a side asks for that side's required fields. Changing a buyer record needs
 *  "Add and edit buyers", a supplier record needs "Add and edit supplier mills". */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { BuyerMaster, SupplierMaster } from '../api/types'
import { CATEGORIES } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import {
  CommissionFields, Field, gstPatch,
  blankSupplier, buyerPayload, buyerProblems, supplierPayload, supplierProblems,
  type BuyerForm, type SupplierForm,
} from '../components/PartyForms'
import { PartyExtras } from '../components/PartyExtras'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool, pickOne } from '../lib/bulk'
import type { BulkDeleteResult, CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage, isGst, isMobile, numOrNull } from '../lib/party'
import { formatDateTime } from '../lib/format'

export type Role = 'buyer' | 'supplier' | 'both'
const ROLES: { value: Role; label: string }[] = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'both', label: 'Both' },
]
const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)?.label ?? r
const hasSupplier = (r: Role) => r === 'supplier' || r === 'both'
const hasBuyer = (r: Role) => r === 'buyer' || r === 'both'

type Contact = {
  key: string
  role: Role
  supplier: SupplierMaster | null
  buyer: BuyerMaster | null
  name: string
  active: boolean
  updated: string
}

/** One contact per PAN when that PAN has exactly one supplier record and one
 *  buyer record; every other record stands alone. */
function buildContacts(suppliers: SupplierMaster[], buyers: BuyerMaster[]): Contact[] {
  const sByPan = new Map<string, SupplierMaster[]>()
  const bByPan = new Map<string, BuyerMaster[]>()
  const panOf = (r: { pan: string | null }) => (r.pan ?? '').toUpperCase()
  for (const s of suppliers) if (panOf(s)) sByPan.set(panOf(s), [...(sByPan.get(panOf(s)) ?? []), s])
  for (const b of buyers) if (panOf(b)) bByPan.set(panOf(b), [...(bByPan.get(panOf(b)) ?? []), b])

  const out: Contact[] = []
  const pairedB = new Set<string>()
  for (const s of suppliers) {
    const sameS = sByPan.get(panOf(s)) ?? []
    const sameB = bByPan.get(panOf(s)) ?? []
    const b = sameS.length === 1 && sameB.length === 1 ? sameB[0]! : null
    if (b) pairedB.add(b.id)
    out.push(makeContact(s, b))
  }
  for (const b of buyers) if (!pairedB.has(b.id)) out.push(makeContact(null, b))
  return out.sort((x, y) => x.name.localeCompare(y.name))
}

function makeContact(supplier: SupplierMaster | null, buyer: BuyerMaster | null): Contact {
  let role: Role
  if (supplier && buyer) {
    role = supplier.is_active && buyer.is_active ? 'both' : supplier.is_active ? 'supplier' : buyer.is_active ? 'buyer' : 'both'
  } else role = supplier ? 'supplier' : 'buyer'
  const primary = supplier ?? buyer!
  const updated = [supplier?.updated_at, buyer?.updated_at].filter(Boolean).sort().pop() ?? primary.updated_at
  return {
    key: `${supplier?.id ?? '-'}:${buyer?.id ?? '-'}`,
    role,
    supplier,
    buyer,
    name: primary.name,
    active: Boolean(supplier?.is_active || buyer?.is_active),
    updated,
  }
}

/* ---- the form: the union of the two masters' fields --------------------------- */

type ContactForm = SupplierForm & { spindlage_capacity: string; role: Role; company_id: string }
type CompanyOption = { id: string; name: string; is_active: boolean }

function formFromContact(c: Contact | null): ContactForm {
  if (!c) return { ...blankSupplier(), spindlage_capacity: '', role: 'buyer', company_id: '' }
  const s = c.supplier
  const b = c.buyer
  const pick = (a: string | null | undefined, z: string | null | undefined) => (a ?? '').trim() || (z ?? '') || ''
  const base = s ?? b!
  return {
    role: c.role,
    company_id: s?.company_id ?? b?.company_id ?? '',
    name: base.name,
    contact_person: pick(s?.contact_person, b?.contact_person),
    mobile: pick(s?.mobile, b?.mobile),
    email: pick(s?.email, b?.email),
    address: pick(s?.address, b?.address),
    gst: pick(s?.gst, b?.gst),
    pan: pick(s?.pan, b?.pan),
    bank_account_1: s?.bank_account_1 ?? '',
    bank_account_2: s?.bank_account_2 ?? '',
    spindlage_capacity: b?.spindlage_capacity ?? '',
    product_range: pick(b?.product_range, s?.product_range),
    state_code: pick(s?.state_code, b?.state_code),
    state: pick(s?.state, b?.state),
    category: pick(s?.category, b?.category),
    commission_basis: pick(s?.commission_basis, b?.commission_basis),
    commission_value:
      (s?.commission_value ?? b?.commission_value) === null || (s?.commission_value ?? b?.commission_value) === undefined
        ? ''
        : String(s?.commission_value ?? b?.commission_value),
    notes: pick(s?.notes, b?.notes),
    is_active: c.active,
  }
}

const toSupplierForm = (f: ContactForm): SupplierForm => ({ ...f })
const toBuyerForm = (f: ContactForm): BuyerForm => ({
  name: f.name, contact_person: f.contact_person, mobile: f.mobile, email: f.email, address: f.address,
  gst: f.gst, pan: f.pan, spindlage_capacity: f.spindlage_capacity, product_range: f.product_range,
  state_code: f.state_code, state: f.state, category: f.category, commission_basis: f.commission_basis,
  commission_value: f.commission_value, notes: f.notes, is_active: f.is_active,
})

/** What is still missing for the chosen role, in the masters' own wording. */
function problems(f: ContactForm): string[] {
  const out: string[] = []
  if (hasSupplier(f.role)) out.push(...supplierProblems(toSupplierForm(f)))
  if (hasBuyer(f.role)) out.push(...buyerProblems(toBuyerForm(f)))
  const cleaned = out.map((p) => (p === 'Supplier name' || p === 'Buyer name' ? 'Name' : p))
  return [...new Set(cleaned)]
}

async function createContact(f: ContactForm): Promise<void> {
  let supplierId: string | null = null
  if (hasSupplier(f.role)) {
    const { data, error } = await supabase.from('supplier_master').insert({ ...supplierPayload(toSupplierForm(f)), company_id: f.company_id || null }).select('id').single()
    if (error) throw error
    supplierId = (data as { id: string }).id
  }
  if (hasBuyer(f.role)) {
    const { error } = await supabase.from('buyer_master').insert({ ...buyerPayload(toBuyerForm(f)), company_id: f.company_id || null })
    if (error) {
      // keep it all-or-nothing: take back the supplier record this call just made
      if (supplierId) await supabase.from('supplier_master').delete().eq('id', supplierId)
      throw error
    }
  }
}

/** Saves the form onto the contact's existing records, adding the missing
 *  side when the role widens and deactivating a side the role no longer has. */
async function saveContact(c: Contact, f: ContactForm): Promise<void> {
  const done: string[] = []
  const attempt = async (label: string, run: () => PromiseLike<{ error: unknown; data?: unknown }>) => {
    const res = await run()
    if (res.error) {
      const e = errMessage(res.error)
      throw new Error(done.length > 0 ? `${done.join(' and ')} saved, but the ${label} record failed: ${e}` : e)
    }
    done.push(label)
    return res
  }

  const sides: { label: 'supplier' | 'buyer'; want: boolean; row: SupplierMaster | BuyerMaster | null; table: string }[] = [
    { label: 'supplier', want: hasSupplier(f.role), row: c.supplier, table: 'supplier_master' },
    { label: 'buyer', want: hasBuyer(f.role), row: c.buyer, table: 'buyer_master' },
  ]
  for (const side of sides) {
    const payload: Record<string, unknown> = {
      ...(side.label === 'supplier' ? supplierPayload(toSupplierForm(f)) : buyerPayload(toBuyerForm(f))),
      company_id: f.company_id || null,
    }
    if (side.want && side.row) {
      const res = await attempt(side.label, () => supabase.from(side.table).update(payload).eq('id', side.row!.id).select('id'))
      if (((res.data as unknown[]) ?? []).length === 0) throw new Error('Your account cannot change the ' + side.label + ' record.')
    } else if (side.want) {
      await attempt(side.label, () => supabase.from(side.table).insert(payload))
    } else if (side.row && side.row.is_active) {
      const res = await attempt(side.label, () => supabase.from(side.table).update({ is_active: false }).eq('id', side.row!.id).select('id'))
      if (((res.data as unknown[]) ?? []).length === 0) throw new Error('Your account cannot change the ' + side.label + ' record.')
    }
  }
}

/* ---- list screen ------------------------------------------------------------------ */

const CSV_COLUMNS = [
  'role', 'company', 'supplier_code', 'buyer_code', 'name', 'contact_person', 'mobile', 'email', 'address', 'gst', 'pan',
  'bank_account_1', 'bank_account_2', 'spindlage_capacity', 'product_range', 'state_code', 'state', 'category',
  'commission_basis', 'commission_value', 'notes', 'is_active', 'gst_status',
] as const

type Editing = { mode: 'create' } | { mode: 'edit'; contact: Contact } | null

export default function Contacts() {
  const { can } = useAuth()
  const canBuyer = can('buyer.manage')
  const canSupplier = can('mill.manage')
  const canCreateAny = canBuyer || canSupplier

  const [suppliers, setSuppliers] = useState<SupplierMaster[] | null>(null)
  const [buyers, setBuyers] = useState<BuyerMaster[] | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [params] = useSearchParams()
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companyFilter, setCompanyFilter] = useState('')
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [roleFilter, setRoleFilter] = useState<'' | Role>('')
  const [catFilter, setCatFilter] = useState('')
  const [rangeSearch, setRangeSearch] = useState('')
  const [spinSearch, setSpinSearch] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)

  const load = useCallback(async () => {
    const [s, b, co] = await Promise.all([
      supabase.from('supplier_master').select('*').order('name'),
      supabase.from('buyer_master').select('*').order('name'),
      supabase.from('companies').select('id,name,is_active').order('name'),
    ])
    setCompanies((co.data ?? []) as CompanyOption[])
    const err = s.error ?? b.error
    if (err) setBanner({ kind: 'bad', text: errMessage(err, 'Could not load contacts') })
    setSuppliers((s.data ?? []) as SupplierMaster[])
    setBuyers((b.data ?? []) as BuyerMaster[])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const contacts = useMemo(() => buildContacts(suppliers ?? [], buyers ?? []), [suppliers, buyers])

  /** A contact can be changed by someone who may manage every side it has. */
  const canEditContact = useCallback(
    (c: Contact) => (!c.supplier || canSupplier) && (!c.buyer || canBuyer),
    [canBuyer, canSupplier],
  )

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rq = rangeSearch.trim().toLowerCase()
    const sq = spinSearch.trim().toLowerCase()
    return contacts.filter((c) => {
      if (roleFilter && c.role !== roleFilter) return false
      if (companyFilter && (c.supplier?.company_id ?? c.buyer?.company_id) !== companyFilter) return false
      const cat = c.supplier?.category ?? c.buyer?.category ?? ''
      if (catFilter && cat !== catFilter && c.buyer?.category !== catFilter) return false
      const range = `${c.buyer?.product_range ?? ''} ${c.supplier?.product_range ?? ''}`.toLowerCase()
      if (rq && !range.includes(rq)) return false
      if (sq && !(c.buyer?.spindlage_capacity ?? '').toLowerCase().includes(sq)) return false
      if (!q) return true
      return [c.name, c.supplier?.supplier_code, c.buyer?.buyer_code, c.supplier?.gst, c.buyer?.gst, c.supplier?.pan, c.buyer?.pan]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [contacts, search, roleFilter, companyFilter, catFilter, rangeSearch, spinSearch])

  const selection = useSelection(useMemo(() => shown.map((c) => c.key), [shown]))
  const byKey = useMemo(() => new Map(contacts.map((c) => [c.key, c])), [contacts])

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    const chosen = selection.chosen.map((k) => byKey.get(k)).filter((c): c is Contact => Boolean(c))
    const sIds = chosen.flatMap((c) => (c.supplier ? [c.supplier.id] : []))
    const bIds = chosen.flatMap((c) => (c.buyer ? [c.buyer.id] : []))
    const rs: BulkDeleteResult = sIds.length ? await bulkDelete('supplier_master', sIds) : { deleted: [], failed: [] }
    const rb: BulkDeleteResult = bIds.length ? await bulkDelete('buyer_master', bIds) : { deleted: [], failed: [] }
    const nameById = new Map<string, string>()
    for (const c of chosen) {
      if (c.supplier) nameById.set(c.supplier.id, `${c.name} (supplier)`)
      if (c.buyer) nameById.set(c.buyer.id, `${c.name} (buyer)`)
    }
    // a contact counts as deleted when every record it had is gone
    const goneIds = new Set([...rs.deleted, ...rb.deleted])
    const fullyDeleted = chosen.filter((c) => [c.supplier?.id, c.buyer?.id].filter(Boolean).every((id) => goneIds.has(id as string))).length
    const merged: BulkDeleteResult = { deleted: Array.from({ length: fullyDeleted }, (_, i) => String(i)), failed: [...rs.failed, ...rb.failed] }
    setBanner(deleteSummary('contact', 'contacts', merged, (id) => nameById.get(id) ?? id))
    selection.clear()
    await load()
    setBusy(false)
  }

  function exportCSV() {
    const list = (selection.chosen.length > 0 ? shown.filter((c) => selection.isSelected(c.key)) : shown).map((c) => {
      const f = formFromContact(c)
      return {
        ...f,
        role: roleLabel(c.role),
        company: companies.find((x) => x.id === (c.supplier?.company_id ?? c.buyer?.company_id))?.name ?? '',
        supplier_code: c.supplier?.supplier_code ?? '',
        buyer_code: c.buyer?.buyer_code ?? '',
        is_active: c.active,
        gst_status: (c.supplier ?? c.buyer)?.gst_status ?? '',
      }
    })
    downloadCSV(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  async function importCSV(file: File) {
    setBusy(true)
    setBanner(null)
    setImportResults(null)
    const outcome = await importCsvFile(
      file,
      (r) => r.get('name'),
      async (r) => {
        const rawRole = r.get('role').trim().toLowerCase()
        if (rawRole && !['buyer', 'supplier', 'both'].includes(rawRole)) throw new Error('Role must be Buyer, Supplier or Both')
        // older Buyer / Supplier exports have no Role column: work it out from the columns filled in
        const role: Role = (rawRole as Role) || (r.get('bank_account_1') && r.get('spindlage_capacity') ? 'both' : r.get('bank_account_1') ? 'supplier' : 'buyer')
        const basis = r.get('commission_basis').toLowerCase()
        if (basis && !['pct', 'per_bag', 'per_kg'].includes(basis)) throw new Error('Commission basis must be pct, per_bag or per_kg')
        if (r.get('commission_value') && numOrNull(r.get('commission_value')) === null) throw new Error('Commission value must be a number')
        const companyName = r.get('company')
        const company = companyName ? companies.find((x) => x.name.toLowerCase() === companyName.toLowerCase()) : undefined
        if (companyName && !company) throw new Error(`Company "${companyName}" is not in the Companies list`)
        const base: ContactForm = {
          ...blankSupplier({
            name: r.get('name'),
            contact_person: r.get('contact_person'),
            mobile: r.get('mobile').replace(/\D/g, ''),
            email: r.get('email'),
            address: r.get('address'),
            gst: r.get('gst').toUpperCase().replace(/\s+/g, ''),
            pan: r.get('pan').toUpperCase().replace(/\s+/g, ''),
            bank_account_1: r.get('bank_account_1'),
            bank_account_2: r.get('bank_account_2'),
            product_range: r.get('product_range'),
            state_code: r.get('state_code'),
            state: r.get('state'),
            category: pickOne('Category', r.get('category'), CATEGORIES),
            commission_value: r.get('commission_value'),
            notes: r.get('notes'),
            is_active: parseBool(r.get('is_active'), true),
          }),
          commission_basis: basis,
          spindlage_capacity: r.get('spindlage_capacity'),
          role,
          company_id: company?.id ?? '',
        }
        const fromGst = isGst(base.gst) ? gstPatch(base, base.gst) : {}
        const form: ContactForm = { ...base, state_code: base.state_code || fromGst.state_code || '', state: base.state || fromGst.state || '' }
        const missing = problems(form)
        if (missing.length > 0) throw new Error(`Needs: ${missing.join(', ')}`)
        await createContact(form)
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

  if (!suppliers || !buyers) return <Loading label="Loading contacts" />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Contacts</h1>
          <p className="page-sub">
            Buyers and suppliers in one list. Each contact has a role: Buyer, Supplier or Both.
          </p>
        </div>
        {canCreateAny && (
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
            Add a contact
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
      {!canCreateAny && (
        <div className="notice small">
          You can see contacts, but adding or editing them needs the “Add and edit buyers” or “Add and edit supplier mills” permission.
        </div>
      )}

      <ListTools
        plural="contacts"
        canImport={canCreateAny}
        canDelete={canCreateAny}
        selectedCount={selection.chosen.length}
        exportLabel={`Export ${selection.chosen.length > 0 ? `${selection.chosen.length} selected` : shown.length === contacts.length ? 'all' : `${shown.length} shown`} as CSV`}
        exportDisabled={shown.length === 0}
        busy={busy}
        onImport={(f) => void importCSV(f)}
        onExport={exportCSV}
        onDelete={deleteSelected}
      />
      <ImportIssues results={importResults} />

      <div className="drawer-actions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none', marginBottom: 12 }}>
        <input aria-label="Search contacts" placeholder="Search by name, code, GST or PAN" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260 }} />
        <select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as '' | Role)}>
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select aria-label="Filter by company" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Filter by category" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              Category {c}
            </option>
          ))}
        </select>
        <input aria-label="Filter by product range or count" placeholder="Product range / count" value={rangeSearch} onChange={(e) => setRangeSearch(e.target.value)} style={{ maxWidth: 200 }} />
        <input aria-label="Filter by spindlage or capacity" placeholder="Spindlage / capacity" value={spinSearch} onChange={(e) => setSpinSearch(e.target.value)} style={{ maxWidth: 180 }} />
      </div>

      {shown.length === 0 ? (
        <div className="card pad empty">
          {contacts.length === 0 ? 'No contacts yet.' : 'No contact matches those filters.'}
          {contacts.length === 0 && canCreateAny ? ' Add the first one.' : ''}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canCreateAny && (
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={selection.allSelected} onChange={selection.toggleAll} aria-label="Select all contacts" />
                  </th>
                )}
                <th>Code</th>
                <th>Contact</th>
                <th>Role</th>
                <th>Company</th>
                <th>Person</th>
                <th>GST</th>
                <th>State</th>
                <th>Category</th>
                <th>Product range</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const base = c.supplier ?? c.buyer!
                return (
                  <tr key={c.key} className="clickable" onClick={() => setEditing({ mode: 'edit', contact: c })}>
                    {canCreateAny && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selection.isSelected(c.key)} onChange={() => selection.toggle(c.key)} aria-label={`Select ${c.name}`} />
                      </td>
                    )}
                    <td className="mono small">
                      {c.supplier?.supplier_code}
                      {c.supplier && c.buyer && <br />}
                      {c.buyer?.buyer_code}
                    </td>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td>
                      <span className={c.role === 'both' ? 'chip brand' : 'chip'}>{roleLabel(c.role)}</span>
                    </td>
                    <td className="small">{companies.find((x) => x.id === (c.supplier?.company_id ?? c.buyer?.company_id))?.name ?? '—'}</td>
                    <td className="small">
                      {base.contact_person}
                      <div className="mono muted">{base.mobile}</div>
                    </td>
                    <td className="mono small">{base.gst ?? '—'}</td>
                    <td className="small">{base.state ?? '—'}</td>
                    <td className="small">{base.category ?? '—'}</td>
                    <td className="small">{c.buyer?.product_range || c.supplier?.product_range || '—'}</td>
                    <td>
                      {c.active ? <span className="chip good">Active</span> : <span className="chip bad">Inactive</span>}
                      {(c.supplier?.incomplete || c.buyer?.incomplete) && (
                        <span className="chip" style={{ marginLeft: 6 }} title="Created from a lead with some details missing. Open it to complete them.">
                          Incomplete
                        </span>
                      )}
                    </td>
                    <td className="mono small">{formatDateTime(c.updated)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ContactDrawer
          key={editing.mode === 'edit' ? editing.contact.key : 'create'}
          editing={editing}
          companies={companies}
          canBuyer={canBuyer}
          canSupplier={canSupplier}
          canEdit={editing.mode === 'create' ? canCreateAny : canEditContact(editing.contact)}
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

/* ---- create / edit drawer ------------------------------------------------------------ */

function ContactDrawer({
  editing, companies, canBuyer, canSupplier, canEdit, onClose, onDone, onError,
}: {
  companies: CompanyOption[]
  editing: NonNullable<Editing>
  canBuyer: boolean
  canSupplier: boolean
  canEdit: boolean
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
  onError: (message: string) => void
}) {
  const existing = editing.mode === 'edit' ? editing.contact : null
  const [form, setForm] = useState<ContactForm>(() => {
    const f = formFromContact(existing)
    // a new contact starts on a role the person is allowed to create
    if (!existing) f.role = canBuyer ? 'buyer' : 'supplier'
    return f
  })
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [side, setSide] = useState<'buyer' | 'supplier'>(existing?.buyer ? 'buyer' : 'supplier')

  const set = <K extends keyof ContactForm>(key: K, value: ContactForm[K]) => setForm((p) => ({ ...p, [key]: value }))
  const patch = (values: Partial<ContactForm>) => setForm((p) => ({ ...p, ...values }))
  const missing = problems(form)
  const p = 'c'
  const roleAllowed = (r: Role) => (hasSupplier(r) ? canSupplier : true) && (hasBuyer(r) ? canBuyer : true)

  async function save() {
    setBusy(true)
    setFormError(null)
    try {
      if (existing) await saveContact(existing, form)
      else await createContact(form)
    } catch (caught) {
      setBusy(false)
      setFormError(errMessage(caught, 'Could not save this contact'))
      return
    }
    setBusy(false)
    await onDone(`${form.name.trim()} ${existing ? 'updated' : 'added'}.`)
  }

  async function remove() {
    if (!existing) return
    setBusy(true)
    const results = await Promise.all([
      existing.supplier ? bulkDelete('supplier_master', [existing.supplier.id]) : Promise.resolve<BulkDeleteResult>({ deleted: [], failed: [] }),
      existing.buyer ? bulkDelete('buyer_master', [existing.buyer.id]) : Promise.resolve<BulkDeleteResult>({ deleted: [], failed: [] }),
    ])
    setBusy(false)
    const failed = results.flatMap((r) => r.failed)
    if (failed.length > 0) {
      onError(`${existing.name} could not be fully deleted: ${[...new Set(failed.map((f) => f.message))].join(' ')}`)
      onClose()
      return
    }
    await onDone(`${existing.name} deleted.`)
  }

  const showSupplier = hasSupplier(form.role)
  const showBuyer = hasBuyer(form.role)
  const otherRow = side === 'buyer' ? existing?.supplier : existing?.buyer
  const sideRow = side === 'buyer' ? existing?.buyer : existing?.supplier
  const codes = [existing?.supplier?.supplier_code, existing?.buyer?.buyer_code].filter(Boolean).join(' / ')

  return (
    <Drawer title={existing ? `${codes} · ${existing.name}` : 'Add a contact'} onClose={onClose}>
      {formError && (
        <div className="alert" role="alert">
          {formError}
        </div>
      )}
      {!canEdit && <div className="notice small">You can view this contact; changing it needs permission for each side it has (buyer and supplier).</div>}

      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-grid">
          <Field
            id={`${p}-role`}
            label="Role"
            required
            hint={
              existing && existing.role !== form.role
                ? 'Saving adds the missing record, or marks the dropped side inactive. Nothing is deleted.'
                : 'Both keeps a buyer record and a supplier record, linked by PAN.'
            }
          >
            <select id={`${p}-role`} value={form.role} onChange={(e) => set('role', e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value} disabled={!roleAllowed(r.value) && r.value !== form.role}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${p}-company`} label="Company" hint="The company this contact belongs to. It then appears in that company's Contacts list.">
            <select id={`${p}-company`} value={form.company_id} onChange={(e) => set('company_id', e.target.value)}>
              <option value="">—</option>
              {companies
                .filter((c) => c.is_active || c.id === form.company_id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <p className="muted small">Fields marked * are required.</p>
        <div className="form-grid">
          <Field id={`${p}-name`} label="Name" required hint="Must be unique -- the same contact is never entered twice.">
            <input id={`${p}-name`} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id={`${p}-contact`} label="Contact person" required>
            <input id={`${p}-contact`} value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
          </Field>
          <Field id={`${p}-mobile`} label="Mobile" required={showSupplier} hint={form.mobile && !isMobile(form.mobile) ? 'Mobile must be exactly 10 digits.' : undefined}>
            <input id={`${p}-mobile`} inputMode="numeric" maxLength={10} className="mono" value={form.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id={`${p}-email`} label="Email">
            <input id={`${p}-email`} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field
            id={`${p}-gst`}
            label="GST"
            required
            hint={form.gst && !isGst(form.gst) ? 'Not a valid GST number yet -- 15 characters, e.g. 33AHFPK5121I1Z5.' : 'Format-checked. The state is filled in from the first two digits.'}
          >
            <input id={`${p}-gst`} className="mono" maxLength={15} value={form.gst} onChange={(e) => patch(gstPatch(form, e.target.value))} />
          </Field>
          <Field id={`${p}-pan`} label="PAN" required hint="10 characters, upper case.">
            <input id={`${p}-pan`} className="mono" maxLength={10} value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase().replace(/\s+/g, ''))} />
          </Field>
          {showSupplier && (
            <>
              <Field id={`${p}-bank1`} label="Bank A/c (1)" required>
                <input id={`${p}-bank1`} className="mono" value={form.bank_account_1} onChange={(e) => set('bank_account_1', e.target.value)} />
              </Field>
              <Field id={`${p}-bank2`} label="Bank A/c (2)">
                <input id={`${p}-bank2`} className="mono" value={form.bank_account_2} onChange={(e) => set('bank_account_2', e.target.value)} />
              </Field>
            </>
          )}
          {showBuyer && (
            <Field id={`${p}-spin`} label="Capacity / spindlage" required>
              <input id={`${p}-spin`} value={form.spindlage_capacity} onChange={(e) => set('spindlage_capacity', e.target.value)} />
            </Field>
          )}
          <Field
            id={`${p}-range`}
            label="Product range"
            required={showBuyer}
            hint={showBuyer ? 'The counts and types this buyer uses.' : 'Counts and yarn types this supplier makes -- used by the search.'}
          >
            <input id={`${p}-range`} value={form.product_range} onChange={(e) => set('product_range', e.target.value)} />
          </Field>
          <Field id={`${p}-scode`} label="State code" required={showSupplier}>
            <input id={`${p}-scode`} className="mono" maxLength={2} inputMode="numeric" value={form.state_code} onChange={(e) => set('state_code', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id={`${p}-state`} label="State" required={showSupplier}>
            <input id={`${p}-state`} value={form.state} onChange={(e) => set('state', e.target.value)} />
          </Field>
          <CommissionFields idPrefix={p} form={form} set={set} />
        </div>
        <Field id={`${p}-address`} label="Full address">
          <textarea id={`${p}-address`} rows={3} value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field id={`${p}-notes`} label="Notes">
          <textarea id={`${p}-notes`} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div className="switch-row">
          <label className="check">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            <span className="check-body">
              <span className="check-label">Active</span>
              <span className="check-hint">Inactive contacts cannot be used to qualify a lead.</span>
            </span>
          </label>
        </div>
      </fieldset>

      {missing.length > 0 && <p className="field-hint">Still needed: {missing.join(', ')}.</p>}
      <div className="drawer-actions">
        {canEdit && (
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || missing.length > 0}>
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Add the contact'}
          </button>
        )}
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {existing && canEdit && <DeleteControl label="Delete this contact" name={existing.name} busy={busy} onConfirm={() => void remove()} />}
      </div>

      {existing && (existing.supplier || existing.buyer) && (
        <>
          {existing.supplier && existing.buyer && (
            <div className="drawer-actions" style={{ marginTop: 16, paddingTop: 0, borderTop: 'none' }}>
              <span className="muted small">Documents, MD contacts and history shown for the</span>
              <select aria-label="Which record's documents to show" value={side} onChange={(e) => setSide(e.target.value as 'buyer' | 'supplier')}>
                <option value="buyer">Buyer record ({existing.buyer.buyer_code})</option>
                <option value="supplier">Supplier record ({existing.supplier.supplier_code})</option>
              </select>
            </div>
          )}
          {sideRow && (
            <PartyExtras
              key={`${side}-${sideRow.id}`}
              partyType={side}
              partyId={sideRow.id}
              gst={sideRow.gst ?? ''}
              gstStatus={sideRow.gst_status}
              gstVerifiedAt={sideRow.gst_verified_at}
              gstNote={sideRow.gst_verify_note}
              mirror={otherRow ? { table: side === 'buyer' ? 'supplier_master' : 'buyer_master', id: otherRow.id } : null}
            />
          )}
        </>
      )}
    </Drawer>
  )
}