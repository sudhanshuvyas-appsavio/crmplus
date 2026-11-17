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
import { BUYER_MACHINE_TYPES, CATEGORIES } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import {
  Field, PartyProfileSections, gstPatch,
  blankBuyerOnly, blankSupplier, buyerOnlyFromRow, buyerPayload, buyerProblems, profileFromRows,
  supplierOnlyFromRow, supplierPayload, supplierProblems,
  type BuyerForm, type FullPartyForm, type SupplierForm,
} from '../components/PartyForms'
import { PartyExtras, useProfileNames } from '../components/PartyExtras'
import { loadLinkIds, syncLinks } from '../lib/links'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { GridPager, GridToolbar, usePaging, type FilterDef } from '../components/GridKit'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool, pickOne } from '../lib/bulk'
import type { BulkDeleteResult, CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage, isGst, numOrNull } from '../lib/party'
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

type ContactForm = FullPartyForm & { role: Role; company_id: string }
type CompanyOption = { id: string; name: string; is_active: boolean }

function formFromContact(c: Contact | null): ContactForm {
  if (!c) return { ...blankSupplier(), ...blankBuyerOnly(), spindlage_capacity: '', role: 'buyer', company_id: '' }
  const s = c.supplier
  const b = c.buyer
  const pick = (a: string | null | undefined, z: string | null | undefined) => (a ?? '').trim() || (z ?? '') || ''
  const base = s ?? b!
  return {
    ...profileFromRows(s, b),
    ...supplierOnlyFromRow(s),
    ...buyerOnlyFromRow(b),
    role: c.role,
    company_id: s?.company_id ?? b?.company_id ?? '',
    name: base.name,
    contact_person: pick(s?.contact_person, b?.contact_person),
    mobile: pick(s?.mobile, b?.mobile),
    email: pick(s?.email, b?.email),
    address: pick(s?.address, b?.address),
    gst: pick(s?.gst, b?.gst),
    pan: pick(s?.pan, b?.pan),
    bank_account_1: pick(s?.bank_account_1, b?.bank_account_1),
    bank_account_2: pick(s?.bank_account_2, b?.bank_account_2),
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
const toBuyerForm = (f: ContactForm): BuyerForm => ({ ...f })

/** What is still missing for the chosen role, in the masters' own wording. */
function problems(f: ContactForm): string[] {
  const out: string[] = []
  if (hasSupplier(f.role)) out.push(...supplierProblems(toSupplierForm(f)))
  if (hasBuyer(f.role)) out.push(...buyerProblems(toBuyerForm(f)))
  const cleaned = out.map((p) => (p === 'Supplier name' || p === 'Buyer name' ? 'Name' : p))
  return [...new Set(cleaned)]
}

type SavedIds = { supplier: string | null; buyer: string | null }

async function createContact(f: ContactForm): Promise<SavedIds> {
  let supplierId: string | null = null
  let buyerId: string | null = null
  if (hasSupplier(f.role)) {
    const { data, error } = await supabase.from('supplier_master').insert({ ...supplierPayload(toSupplierForm(f)), company_id: f.company_id || null }).select('id').single()
    if (error) throw error
    supplierId = (data as { id: string }).id
  }
  if (hasBuyer(f.role)) {
    const { data, error } = await supabase.from('buyer_master').insert({ ...buyerPayload(toBuyerForm(f)), company_id: f.company_id || null }).select('id').single()
    if (error) {
      // keep it all-or-nothing: take back the supplier record this call just made
      if (supplierId) await supabase.from('supplier_master').delete().eq('id', supplierId)
      throw error
    }
    buyerId = (data as { id: string }).id
  }
  return { supplier: supplierId, buyer: buyerId }
}

/** Saves the form onto the contact's existing records, adding the missing
 *  side when the role widens and deactivating a side the role no longer has.
 *  Returns the id of each side the role includes (for saving its links). */
async function saveContact(c: Contact, f: ContactForm): Promise<SavedIds> {
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

  const ids: SavedIds = { supplier: null, buyer: null }
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
      ids[side.label] = side.row.id
    } else if (side.want) {
      const res = await attempt(side.label, () => supabase.from(side.table).insert(payload).select('id'))
      ids[side.label] = ((res.data as { id: string }[] | null) ?? [])[0]?.id ?? null
    } else if (side.row && side.row.is_active) {
      const res = await attempt(side.label, () => supabase.from(side.table).update({ is_active: false }).eq('id', side.row!.id).select('id'))
      if (((res.data as unknown[]) ?? []).length === 0) throw new Error('Your account cannot change the ' + side.label + ' record.')
    }
  }
  return ids
}

/* ---- list screen ------------------------------------------------------------------ */

const CSV_COLUMNS = [
  'role', 'company', 'supplier_code', 'buyer_code', 'name', 'contact_person', 'mobile', 'email', 'address', 'gst', 'pan',
  'bank_account_1', 'bank_account_2', 'spindlage_capacity', 'product_range', 'state_code', 'state', 'category',
  'commission_basis', 'commission_value', 'notes', 'is_active', 'gst_status',
  // the profile: scalar columns only (locations and counts are links, kept in the form)
  'short_name', 'customer_code', 'website', 'map_url', 'office_phone', 'res_phone', 'mill_address', 'remarks_2',
  'contact_1_email', 'contact_2_name', 'contact_2_mobile', 'contact_2_email', 'contact_3_name', 'contact_3_mobile', 'contact_3_email',
  'sales_person', 'collection_staff', 'messenger',
  'machine_types', 'no_of_looms', 'fabric_producing', 'reed_pick', 'width',
  'machine_type', 'counts_supplying', 'spindles', 'monthly_production', 'qty_bags_month', 'qty_kgs_month',
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
  const [statusFilter, setStatusFilter] = useState('')
  const [rangeSearch, setRangeSearch] = useState('')
  const [spinSearch, setSpinSearch] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)
  const profileNames = useProfileNames()

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
      if (statusFilter && (statusFilter === 'active') !== c.active) return false
      if (companyFilter && (c.supplier?.company_id ?? c.buyer?.company_id) !== companyFilter) return false
      const cat = c.supplier?.category ?? c.buyer?.category ?? ''
      if (catFilter && cat !== catFilter && c.buyer?.category !== catFilter) return false
      const range = `${c.buyer?.product_range ?? ''} ${c.supplier?.product_range ?? ''}`.toLowerCase()
      if (rq && !range.includes(rq)) return false
      if (sq && !(c.buyer?.spindlage_capacity ?? '').toLowerCase().includes(sq)) return false
      if (!q) return true
      return [
        c.name, c.supplier?.short_name, c.buyer?.short_name, c.supplier?.customer_code, c.buyer?.customer_code,
        c.supplier?.supplier_code, c.buyer?.buyer_code, c.supplier?.gst, c.buyer?.gst, c.supplier?.pan, c.buyer?.pan,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [contacts, search, roleFilter, statusFilter, companyFilter, catFilter, rangeSearch, spinSearch])

  const paging = usePaging(shown, [search, roleFilter, statusFilter, companyFilter, catFilter, rangeSearch, spinSearch].join('|'))

  const filterDefs: FilterDef[] = [
    { name: 'role', label: 'Role', allLabel: 'All roles', options: ROLES },
    { name: 'status', label: 'Status', allLabel: 'All statuses', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
    { name: 'company', label: 'Company', allLabel: 'All companies', options: companies.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'category', label: 'Category', allLabel: 'All categories', options: CATEGORIES.map((c) => ({ value: c, label: `Category ${c}` })) },
  ]
  const filterValues = { role: roleFilter, status: statusFilter, company: companyFilter, category: catFilter }
  function setFilter(name: string, value: string) {
    if (name === 'role') setRoleFilter(value as '' | Role)
    else if (name === 'status') setStatusFilter(value)
    else if (name === 'company') setCompanyFilter(value)
    else if (name === 'category') setCatFilter(value)
  }
  function clearFilters() {
    setRoleFilter('')
    setStatusFilter('')
    setCompanyFilter('')
    setCatFilter('')
  }

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
        sales_person: profileNames[f.sales_person_id] ?? '',
        collection_staff: profileNames[f.collection_staff_id] ?? '',
        messenger: profileNames[f.messenger_id] ?? '',
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
        const machineTypes = r
          .get('machine_types')
          .split(/[;,|/]/)
          .map((m) => m.trim().toUpperCase())
          .filter(Boolean)
        const badMachine = machineTypes.find((m) => !(BUYER_MACHINE_TYPES as readonly string[]).includes(m))
        if (badMachine) throw new Error(`Machine type "${badMachine}" is not one of: ${BUYER_MACHINE_TYPES.join(', ')}`)
        const person = (col: string): string => {
          const wanted = r.get(col)
          if (!wanted) return ''
          const hit = Object.entries(profileNames).find(([, n]) => n.toLowerCase() === wanted.toLowerCase())
          if (!hit) throw new Error(`${col.replace('_', ' ')} "${wanted}" is not a user of this app`)
          return hit[0]
        }
        const base: ContactForm = {
          ...blankBuyerOnly(),
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
            short_name: r.get('short_name'),
            customer_code: r.get('customer_code'),
            website: r.get('website'),
            map_url: r.get('map_url'),
            office_phone: r.get('office_phone').replace(/\D/g, ''),
            res_phone: r.get('res_phone').replace(/\D/g, ''),
            mill_address: r.get('mill_address'),
            remarks_2: r.get('remarks_2'),
            contact_1_email: r.get('contact_1_email'),
            contact_2_name: r.get('contact_2_name'),
            contact_2_mobile: r.get('contact_2_mobile').replace(/\D/g, ''),
            contact_2_email: r.get('contact_2_email'),
            contact_3_name: r.get('contact_3_name'),
            contact_3_mobile: r.get('contact_3_mobile').replace(/\D/g, ''),
            contact_3_email: r.get('contact_3_email'),
            sales_person_id: person('sales_person'),
            collection_staff_id: person('collection_staff'),
            messenger_id: person('messenger'),
            machine_type: r.get('machine_type'),
            counts_supplying: r.get('counts_supplying'),
            spindles: r.get('spindles'),
            monthly_production: r.get('monthly_production'),
            qty_bags_month: r.get('qty_bags_month'),
            qty_kgs_month: r.get('qty_kgs_month'),
          }),
          machine_types: [...new Set(machineTypes)],
          no_of_looms: r.get('no_of_looms'),
          fabric_producing: r.get('fabric_producing'),
          reed_pick: r.get('reed_pick'),
          width: r.get('width'),
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
      <GridToolbar
        title="Buyers & Suppliers"
        total={contacts.length}
        singular="contact"
        plural="contacts"
        query={search}
        onQuery={setSearch}
        searchPlaceholder="Search by name, short name, code, GST or PAN"
        filters={filterDefs}
        values={filterValues}
        onFilter={setFilter}
        onClear={clearFilters}
      >
        {canCreateAny && (
          <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
            New contact
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
        <input aria-label="Filter by product range or count" placeholder="Product range / count" value={rangeSearch} onChange={(e) => setRangeSearch(e.target.value)} style={{ maxWidth: 200 }} />
        <input aria-label="Filter by spindlage or capacity" placeholder="Spindlage / capacity" value={spinSearch} onChange={(e) => setSpinSearch(e.target.value)} style={{ maxWidth: 180 }} />
      </div>

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
              <th>Customer code</th>
              <th className="left">Contact</th>
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
            {shown.length === 0 ? (
              <tr>
                <td className="empty" colSpan={canCreateAny ? 13 : 12}>
                  {contacts.length === 0 ? 'No contacts yet.' : 'No contact matches those filters.'}
                  {contacts.length === 0 && canCreateAny ? ' Add the first one.' : ''}
                </td>
              </tr>
            ) : (
              paging.visible.map((c) => {
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
                    <td className="mono small">{c.supplier?.customer_code || c.buyer?.customer_code || '—'}</td>
                    <td className="left">
                      <strong>{c.name}</strong>
                      {(c.supplier?.short_name || c.buyer?.short_name) && (
                        <div className="muted small">{c.supplier?.short_name || c.buyer?.short_name}</div>
                      )}
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
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ContactDrawer
          key={editing.mode === 'edit' ? editing.contact.key : 'create'}
          editing={editing}
          companies={companies}
          canBuyer={canBuyer}
          canSupplier={canSupplier}
          canEdit={editing.mode === 'create' ? canCreateAny : canEditContact(editing.contact)}
          onClose={() => setEditing(null)}
          onDone={async (text, kind = 'ok') => {
            setBanner({ kind, text })
            setEditing(null)
            await load()
          }}
          onError={(text) => setBanner({ kind: 'bad', text })}
        />
      )}

      <GridPager {...paging.pager} singular="contact" plural="contacts" />
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
  onDone: (message: string, kind?: 'ok' | 'bad') => void | Promise<void>
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
  const [locationIds, setLocationIds] = useState<string[]>([])
  const [countIds, setCountIds] = useState<string[]>([])
  // an existing contact's links must be read before they can be saved, or saving would wipe them
  const [linksReady, setLinksReady] = useState(!existing)
  const [linksNote, setLinksNote] = useState<string | null>(null)

  useEffect(() => {
    if (!existing) return undefined
    let live = true
    const owners: { type: 'supplier' | 'buyer'; id: string }[] = [
      ...(existing.supplier ? [{ type: 'supplier' as const, id: existing.supplier.id }] : []),
      ...(existing.buyer ? [{ type: 'buyer' as const, id: existing.buyer.id }] : []),
    ]
    const read = async (kind: 'location' | 'count') => [...new Set((await Promise.all(owners.map((o) => loadLinkIds(kind, o.type, o.id)))).flat())]
    Promise.all([read('location'), read('count')])
      .then(([l, c]) => {
        if (!live) return
        setLocationIds(l)
        setCountIds(c)
        setLinksReady(true)
      })
      .catch((caught) => {
        if (live) setLinksNote(`Locations and counts could not be loaded (${errMessage(caught)}). They are left unchanged when you save.`)
      })
    return () => {
      live = false
    }
  }, [existing])

  const set = <K extends keyof ContactForm>(key: K, value: ContactForm[K]) => setForm((p) => ({ ...p, [key]: value }))
  const patch = (values: Partial<ContactForm>) => setForm((p) => ({ ...p, ...values }))
  const setProfile = <K extends keyof FullPartyForm>(key: K, value: FullPartyForm[K]) => setForm((p) => ({ ...p, [key]: value }) as ContactForm)
  const missing = problems(form)
  const p = 'c'
  const roleAllowed = (r: Role) => (hasSupplier(r) ? canSupplier : true) && (hasBuyer(r) ? canBuyer : true)

  /** Saves locations and counts for each side the role includes. Returns what failed, in words. */
  async function saveLinks(ids: SavedIds): Promise<string[]> {
    if (!linksReady) return []
    if (!existing && locationIds.length === 0 && countIds.length === 0) return []
    const failures: string[] = []
    const owners = [
      ...(hasSupplier(form.role) && ids.supplier ? [{ type: 'supplier' as const, id: ids.supplier }] : []),
      ...(hasBuyer(form.role) && ids.buyer ? [{ type: 'buyer' as const, id: ids.buyer }] : []),
    ]
    for (const o of owners) {
      for (const kind of ['location', 'count'] as const) {
        try {
          await syncLinks(kind, o.type, o.id, kind === 'location' ? locationIds : countIds)
        } catch (caught) {
          failures.push(`${kind === 'location' ? 'locations' : 'counts'} on the ${o.type} record: ${errMessage(caught)}`)
        }
      }
    }
    return failures
  }

  async function save() {
    setBusy(true)
    setFormError(null)
    let ids: SavedIds
    try {
      ids = existing ? await saveContact(existing, form) : await createContact(form)
    } catch (caught) {
      setBusy(false)
      setFormError(errMessage(caught, 'Could not save this contact'))
      return
    }
    const linkFailures = await saveLinks(ids)
    setBusy(false)
    const saved = `${form.name.trim()} ${existing ? 'updated' : 'added'}.`
    if (linkFailures.length > 0) {
      await onDone(`${saved} The contact itself is saved, but its links were not: ${linkFailures.join('; ')}. Open it again and save to retry.`, 'bad')
      return
    }
    await onDone(saved)
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
        </div>
        <PartyProfileSections
          idPrefix={p}
          form={form}
          set={setProfile}
          patch={patch}
          showBuyer={showBuyer}
          showSupplier={showSupplier}
          locationIds={locationIds}
          countIds={countIds}
          onLocationIds={setLocationIds}
          onCountIds={setCountIds}
          linksDisabled={!canEdit || !linksReady}
          linksNote={linksNote}
          businessUnit={
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
          }
        />
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