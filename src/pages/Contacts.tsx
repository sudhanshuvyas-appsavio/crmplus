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

import { Fragment, isValidElement, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { BuyerMaster, SupplierMaster } from '../api/types'
import { BUYER_MACHINE_TYPES, CATEGORIES } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import {
  DEFAULT_COMMISSIONS, Field, FieldErrorsProvider, PartyProfileSections, gstPatch,
  blankBuyerOnly, blankSupplier, buyerOnlyFromRow, buyerPayload, profileFromRows,
  supplierOnlyFromRow, supplierPayload,
  type BuyerForm, type FullPartyForm, type SupplierForm,
} from '../components/PartyForms'
import { DocumentsPanel, useProfileNames } from '../components/PartyExtras'
import { RowActionMenu } from '../components/RowActionMenu'
import { setActive } from '../lib/active'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Modal } from '../components/Modal'
import { ErrorBanner } from '../components/FormKit'
import { BuyerSupplierForm } from '../components/BuyerSupplierForm'
import { loadLinkIds, syncLinks } from '../lib/links'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { GridPager, GridToolbar, usePaging, type FilterDef } from '../components/GridKit'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool, pickOne } from '../lib/bulk'
import type { BulkDeleteResult, CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage, isGst, isMobile, numOrNull } from '../lib/party'
import { findDuplicate, focusFirstError, isEmail, isPan, nameKey, panMatchesGst, nameProblem, personProblem, placeProblem, requireText, type FieldErrors, searchKey } from '../lib/validate'
import { formatDate } from '../lib/format'
import '../styles/cheque-board.css'

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
type CompanyOption = { id: string; name: string; is_active: boolean; mobile?: string | null; phone_1?: string | null }

function formFromContact(c: Contact | null): ContactForm {
  if (!c) return { ...blankSupplier(), ...blankBuyerOnly(), spindlage_capacity: '', role: 'buyer', company_id: '', commission_basis: '' }
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
    spindlage_capacity: '',
    product_range: '',
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

interface RuleCtx {
  suppliers: readonly SupplierMaster[]
  buyers: readonly BuyerMaster[]
  selfSupplierId?: string | null
  selfBuyerId?: string | null
  /** The counts chosen on the form; undefined where counts cannot be given (the CSV import). */
  countIds?: string[]
}

const upText = (v: string | null | undefined) => (v ?? '').trim().toUpperCase()

/** Field id -> message, in the order the fields appear. The required set is monday's:
 *  Name, Office Phone, Office Address, GST, Business Unit, Default Commission and Counts. */
function contactErrors(f: ContactForm, ctx: RuleCtx): FieldErrors {
  const er: FieldErrors = {}
  const side = (s: 'supplier' | 'buyer') => (s === 'supplier' ? hasSupplier(f.role) : hasBuyer(f.role))

  requireText(er, 'c-name', f.name, 'Name is required.')
  if (!er['c-name']) { const m = nameProblem('Name', f.name); if (m) er['c-name'] = m }
  { const m = placeProblem('State', f.state); if (m) er['c-state'] = m }
  { const m = personProblem('Contact Person 1', f.contact_person); if (m) er['c-contact'] = m }
  { const m = personProblem('Contact Person 2', f.contact_2_name); if (m) er['c-c2name'] = m }
  { const m = personProblem('Contact Person 3', f.contact_3_name); if (m) er['c-c3name'] = m }
  if (!er['c-name']) {
    const s = side('supplier') ? findDuplicate(ctx.suppliers, ctx.selfSupplierId, (r) => r.name, f.name, nameKey) : null
    const b = side('buyer') ? findDuplicate(ctx.buyers, ctx.selfBuyerId, (r) => r.name, f.name, nameKey) : null
    if (s) er['c-name'] = `A supplier called "${s.name}" already exists (${s.supplier_code}).`
    else if (b) er['c-name'] = `A buyer called "${b.name}" already exists (${b.buyer_code}).`
  }
  if (f.customer_code.trim()) {
    const s = side('supplier') ? findDuplicate(ctx.suppliers, ctx.selfSupplierId, (r) => r.customer_code, f.customer_code, upText) : null
    const b = side('buyer') ? findDuplicate(ctx.buyers, ctx.selfBuyerId, (r) => r.customer_code, f.customer_code, upText) : null
    if (s || b) er['c-ccode'] = `That customer code is already used by ${s ? `supplier ${s.name}` : `buyer ${b!.name}`}.`
  }

  const gst = upText(f.gst)
  if (!gst) er['c-gst'] = 'GST is required.'
  else if (!isGst(gst)) er['c-gst'] = 'Enter a complete GST number (15 characters, like 33AHFPK5121I1Z5).'
  else {
    const s = side('supplier') ? findDuplicate(ctx.suppliers, ctx.selfSupplierId, (r) => r.gst, gst, upText) : null
    const b = side('buyer') ? findDuplicate(ctx.buyers, ctx.selfBuyerId, (r) => r.gst, gst, upText) : null
    if (s || b) er['c-gst'] = `This GST number is already used by ${s ? `supplier ${s.name}` : `buyer ${b!.name}`}.`
  }
  if (f.pan.trim()) {
    if (!isPan(f.pan)) er['c-pan'] = 'Enter a valid PAN: 5 letters, 4 digits, 1 letter (like AHFPK5121I).'
    else if (gst && isGst(gst) && !panMatchesGst(gst, f.pan)) er['c-pan'] = 'PAN must match the GST number (characters 3 to 12 of the GST).'
  }
  if (f.state_code.trim() && !/^[0-9]{2}$/.test(f.state_code.trim())) er['c-scode'] = 'State code must be 2 digits.'
  else if (isGst(gst) && f.state_code.trim() && gst.slice(0, 2) !== f.state_code.trim()) er['c-scode'] = 'State code must match the first two digits of the GST number.'

  if (f.mobile.trim() && !isMobile(f.mobile)) er['c-mobile'] = 'Mobile numbers are exactly 10 digits.'
  if (f.contact_1_email.trim() && !isEmail(f.contact_1_email)) er['c-c1email'] = 'Enter a valid email, like name@company.com.'
  if (f.contact_2_mobile.trim() && !isMobile(f.contact_2_mobile)) er['c-c2mobile'] = 'Mobile numbers are exactly 10 digits.'
  if (f.contact_2_email.trim() && !isEmail(f.contact_2_email)) er['c-c2email'] = 'Enter a valid email, like name@company.com.'
  if (f.contact_3_mobile.trim() && !isMobile(f.contact_3_mobile)) er['c-c3mobile'] = 'Mobile numbers are exactly 10 digits.'
  if (f.contact_3_email.trim() && !isEmail(f.contact_3_email)) er['c-c3email'] = 'Enter a valid email, like name@company.com.'

  if (!f.office_phone.trim()) er['c-ophone'] = 'Office Phone is required.'
  else if (!/^[0-9]{6,15}$/.test(f.office_phone.trim())) er['c-ophone'] = 'Phone numbers are 6 to 15 digits.'
  if (f.res_phone.trim() && !/^[0-9]{6,15}$/.test(f.res_phone.trim())) er['c-rphone'] = 'Phone numbers are 6 to 15 digits.'
  if (f.email.trim() && !isEmail(f.email)) er['c-email'] = 'Enter a valid email, like name@company.com.'
  requireText(er, 'c-address', f.address, 'Office address is required.')

  if (f.commission_value.trim()) {
    const n = numOrNull(f.commission_value)
    if (n === null || n < 0) er['c-cv'] = 'Commission value must be a number, 0 or more.'
  }
  if (!f.default_commission) er['c-defcomm'] = 'Default Commision Percentage is required.'
  if (!f.company_id) er['c-company'] = 'Business Unit is required.'
  if (ctx.countIds !== undefined && ctx.countIds.length === 0) er['c-counts'] = 'Counts is required: choose at least one.'
  return er
}

/** The same rules as plain sentences (the CSV import reports them per row). */
const problems = (f: ContactForm, ctx: RuleCtx): string[] => Object.values(contactErrors(f, ctx))

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
  'bank_account_1', 'bank_account_2', 'state_code', 'state', 'category',
  'commission_basis', 'commission_value', 'default_commission', 'notes', 'is_active', 'gst_status',
  // the profile: scalar columns only (locations and counts are links, kept in the form)
  'short_name', 'customer_code', 'website', 'map_url', 'office_phone', 'res_phone', 'mill_address', 'remarks_2',
  'contact_1_email', 'contact_2_name', 'contact_2_mobile', 'contact_2_email', 'contact_3_name', 'contact_3_mobile', 'contact_3_email',
  'sales_person', 'collection_staff', 'messenger',
  'machine_types', 'no_of_looms', 'fabric_producing', 'reed_pick', 'width', 'quantity', 'type_text',
  'machine_type', 'counts_supplying', 'current_machines', 'spindles', 'monthly_production', 'qty_bags_month', 'qty_kgs_month',
] as const

type Editing = { mode: 'create' } | { mode: 'edit'; contact: Contact } | null

/** A pasted phone cell as the masters store it: digits only, without a leading +91 / 91 / 0. */
const localDigits = (v: string): string => {
  const d = v.replace(/\D/g, '')
  if (d.length > 10 && d.startsWith('91')) return d.slice(2)
  if (d.length === 11 && d.startsWith('0')) return d.slice(1)
  return d
}

/** The text a grid cell shows, so search can match every visible column. */
function nodeText(n: ReactNode): string {
  if (n === null || n === undefined || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(nodeText).join(' ')
  if (isValidElement(n)) return nodeText((n.props as { children?: ReactNode }).children)
  return ''
}

/** One column of the grid, with monday's title. */
type Col = { id: string; title: string; render: (c: Contact) => ReactNode; wrap?: boolean; mono?: boolean }

const dash = <span className="muted">—</span>
const txt = (v: string | number | null | undefined): ReactNode => (v === null || v === undefined || v === '' ? dash : String(v))
const COMMISSION_LABEL: Record<string, string> = { pct: 'Percentage', per_bag: 'BAG', per_kg: 'KG' }
const commissionType = (v: string | null | undefined): ReactNode => (v ? COMMISSION_LABEL[v] ?? v : dash)
const COLS_KEY = 'crmplus.buyersSuppliers.hiddenColumns'

/** Columns hidden until someone shows them: the fields the aligned layout no longer asks for (Location MDM,
 *  Category, Messenger, Short Name, Contact Person 3). They stay available in the Columns picker. */
const DEFAULT_HIDDEN_COLS = ['cp3', 'cp3p', 'cp3e', 'location', 'category', 'short', 'msg']

function loadHiddenCols(): string[] {
  try {
    const raw = localStorage.getItem(COLS_KEY)
    if (raw === null) return DEFAULT_HIDDEN_COLS
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export default function Contacts() {
  const { can } = useAuth()
  const canBuyer = can('buyer.manage')
  const canSupplier = can('mill.manage')
  const canCreateAny = canBuyer || canSupplier

  const [suppliers, setSuppliers] = useState<SupplierMaster[] | null>(null)
  const [buyers, setBuyers] = useState<BuyerMaster[] | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [viewing, setViewing] = useState<Contact | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)
  const [docsFor, setDocsFor] = useState<Contact | null>(null)
  const [delErr, setDelErr] = useState<string | null>(null)
  const [hiddenCols, setHiddenCols] = useState<string[]>(loadHiddenCols)
  const [partyDocs, setPartyDocs] = useState<Map<string, number>>(new Map())
  const [locationLinks, setLocationLinks] = useState<{ owner_type: string; owner_id: string; location_id: string }[]>([])
  const [stationNames, setStationNames] = useState<Map<string, string>>(new Map())
  const [countNames, setCountNames] = useState<Map<string, string>>(new Map())
  const [creationForm, setCreationForm] = useState(false)
  const [params] = useSearchParams()
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companyFilter, setCompanyFilter] = useState('')
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [roleFilter, setRoleFilter] = useState<'' | Role>('')
  const [catFilter, setCatFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [commFilter, setCommFilter] = useState('')
  const [locFilter, setLocFilter] = useState('')
  const [countFilter, setCountFilter] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)
  const [partyCounts, setPartyCounts] = useState<{ party_type: string; party_id: string; count_id: string }[]>([])
  const [countNos, setCountNos] = useState<Map<string, number>>(new Map())
  const profileNames = useProfileNames()

  const load = useCallback(async () => {
    const [s, b, co, pc, cm, pd, ll, sm] = await Promise.all([
      supabase.from('supplier_master').select('*').order('name'),
      supabase.from('buyer_master').select('*').order('name'),
      supabase.from('companies').select('id,name,is_active,mobile,phone_1').order('name'),
      supabase.from('party_counts').select('party_type,party_id,count_id'),
      supabase.from('count_master').select('id,count_no,display_name'),
      supabase.from('party_documents').select('party_type,party_id'),
      supabase.from('location_links').select('owner_type,owner_id,location_id').in('owner_type', ['buyer', 'supplier']),
      supabase.from('station_master').select('id,name'),
    ])
    const docTally = new Map<string, number>()
    for (const d of (pd.data ?? []) as { party_type: string; party_id: string }[]) {
      const k = `${d.party_type}:${d.party_id}`
      docTally.set(k, (docTally.get(k) ?? 0) + 1)
    }
    setPartyDocs(docTally)
    setLocationLinks((ll.data ?? []) as { owner_type: string; owner_id: string; location_id: string }[])
    setStationNames(new Map(((sm.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])))
    setCountNames(new Map(((cm.data ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name])))
    setCompanies((co.data ?? []) as CompanyOption[])
    setPartyCounts((pc.data ?? []) as { party_type: string; party_id: string; count_id: string }[])
    setCountNos(new Map(((cm.data ?? []) as { id: string; count_no: number }[]).map((c) => [c.id, c.count_no])))
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

  /** monday's mirror columns: the business unit's phone and the thread counts linked to the contact. */
  const companyOf = (c: Contact) => companies.find((x) => x.id === (c.supplier?.company_id ?? c.buyer?.company_id))
  const threadCountsOf = (c: Contact): string => {
    const ids = new Set<string>()
    for (const l of partyCounts) {
      if ((l.party_type === 'supplier' && l.party_id === c.supplier?.id) || (l.party_type === 'buyer' && l.party_id === c.buyer?.id)) ids.add(l.count_id)
    }
    const nos = [...ids].map((id) => countNos.get(id)).filter((n): n is number => n !== undefined)
    return [...new Set(nos)].sort((a, z) => a - z).map((n) => `${n}S`).join(', ')
  }
  const countIdsOf = (c: Contact): string[] => {
    const ids = new Set<string>()
    for (const l of partyCounts) {
      if ((l.party_type === 'supplier' && l.party_id === c.supplier?.id) || (l.party_type === 'buyer' && l.party_id === c.buyer?.id)) ids.add(l.count_id)
    }
    return [...ids]
  }
  const locationsOf = (c: Contact): string =>
    [...new Set(
      locationLinks
        .filter((l) => (l.owner_type === 'supplier' && l.owner_id === c.supplier?.id) || (l.owner_type === 'buyer' && l.owner_id === c.buyer?.id))
        .map((l) => stationNames.get(l.location_id))
        .filter((n): n is string => Boolean(n)),
    )].join(', ')
  const docCountOf = (c: Contact) => (partyDocs.get(`supplier:${c.supplier?.id}`) ?? 0) + (partyDocs.get(`buyer:${c.buyer?.id}`) ?? 0)
  const personName = (id: string | null | undefined) => (id ? profileNames[id] ?? '—' : '—')

  /** monday's columns, in monday's order and with monday's titles. Fields the
   *  two records share are read from the supplier record, else the buyer one. */
  const common = <K extends keyof SupplierMaster & keyof BuyerMaster>(c: Contact, k: K) => (c.supplier?.[k] ?? c.buyer?.[k]) as SupplierMaster[K] | null
  const columns: Col[] = [
    { id: 'date', title: 'Date', mono: true, render: (c) => { const v = common(c, 'record_at'); return v ? formatDate(v) : formatDate(common(c, 'created_at')) } },
    { id: 'type', title: 'Type', render: (c) => <span className={c.role === 'both' ? 'chip brand' : 'chip'}>{roleLabel(c.role)}</span> },
    { id: 'address', title: 'Office Address', wrap: true, render: (c) => txt(common(c, 'address')) },
    { id: 'state', title: 'State', render: (c) => txt(common(c, 'state')) },
    { id: 'gst', title: 'GST No.', mono: true, render: (c) => txt(common(c, 'gst')) },
    { id: 'cp1', title: 'Contact Person 1', render: (c) => txt(common(c, 'contact_person')) },
    { id: 'cp1p', title: 'Contact Person 1 Phone', mono: true, render: (c) => txt(common(c, 'mobile')) },
    { id: 'cp1e', title: 'Contact Person 1 Email', render: (c) => txt(common(c, 'contact_1_email')) },
    { id: 'cp2', title: 'Contact Person 2', render: (c) => txt(common(c, 'contact_2_name')) },
    { id: 'cp2p', title: 'Contact Person 2 Phone', mono: true, render: (c) => txt(common(c, 'contact_2_mobile')) },
    { id: 'cp2e', title: 'Contact Person 2 Email', render: (c) => txt(common(c, 'contact_2_email')) },
    { id: 'cp3', title: 'Contact Person 3', render: (c) => txt(common(c, 'contact_3_name')) },
    { id: 'cp3p', title: 'Contact Person 3 Phone', mono: true, render: (c) => txt(common(c, 'contact_3_mobile')) },
    { id: 'cp3e', title: 'Contact Person 3 Email', render: (c) => txt(common(c, 'contact_3_email')) },
    { id: 'location', title: 'Location MDM', wrap: true, render: (c) => txt(locationsOf(c)) },
    { id: 'category', title: 'Category', render: (c) => txt(common(c, 'category')) },
    { id: 'bank1', title: 'Bank Account Details 1', wrap: true, render: (c) => txt(common(c, 'bank_account_1')) },
    { id: 'bank2', title: 'Bank Account Details 2', wrap: true, render: (c) => txt(common(c, 'bank_account_2')) },
    { id: 'defcomm', title: 'Default Commission Percentage', render: (c) => txt(common(c, 'default_commission')) },
    { id: 'short', title: 'Short Name', render: (c) => txt(common(c, 'short_name')) },
    { id: 'mill', title: 'Mill/Factory/Delivery Address', wrap: true, render: (c) => txt(common(c, 'mill_address')) },
    { id: 'ophone', title: 'Office Phone', mono: true, render: (c) => txt(common(c, 'office_phone')) },
    { id: 'rphone', title: 'Res Phone', mono: true, render: (c) => txt(common(c, 'res_phone')) },
    { id: 'pan', title: 'PAN', mono: true, render: (c) => txt(common(c, 'pan')) },
    { id: 'email', title: 'Email', render: (c) => txt(common(c, 'email')) },
    { id: 'bct', title: 'Buyer Commission Type', render: (c) => commissionType(c.buyer?.commission_basis) },
    { id: 'bcv', title: 'Buyer Commission Value', mono: true, render: (c) => txt(c.buyer?.commission_value) },
    { id: 'sct', title: 'Supplier Commission Type', render: (c) => commissionType(c.supplier?.commission_basis) },
    { id: 'scv', title: 'Supplier Commission Value', mono: true, render: (c) => txt(c.supplier?.commission_value) },
    { id: 'sales', title: 'Sales Person', render: (c) => personName(common(c, 'sales_person_id')) },
    { id: 'coll', title: 'Collection Staff', render: (c) => personName(common(c, 'collection_staff_id')) },
    { id: 'docs', title: 'Documents', mono: true, render: (c) => docCountOf(c) },
    { id: 'counts', title: 'Counts', wrap: true, render: (c) => txt(countIdsOf(c).map((id) => countNames.get(id)).filter(Boolean).join(', ')) },
    { id: 'threads', title: 'Thread Count', render: (c) => txt(threadCountsOf(c)) },
    { id: 'rem1', title: 'Remark 1', wrap: true, render: (c) => txt(common(c, 'notes')) },
    { id: 'rem2', title: 'Remark 2', wrap: true, render: (c) => txt(common(c, 'remarks_2')) },
    { id: 'msg', title: 'Messenger', render: (c) => personName(common(c, 'messenger_id')) },
    { id: 'ccode', title: 'Customer Code', mono: true, render: (c) => txt(common(c, 'customer_code')) },
    { id: 'bmt', title: 'Buyer Machine Type', render: (c) => txt(c.buyer?.machine_types?.[0]) },
    { id: 'bmt1', title: 'Buyer Machine Type 1', render: (c) => txt(c.buyer?.machine_types?.[1]) },
    { id: 'bmt2', title: 'Buyer Machine Type 2', render: (c) => txt(c.buyer?.machine_types?.[2]) },
    { id: 'smt', title: 'Supplier Machine Type', render: (c) => txt(c.supplier?.machine_type) },
    { id: 'quantity', title: 'Quantity', mono: true, render: (c) => txt(c.buyer?.quantity) },
    { id: 'fabric', title: 'Fabric Producing', render: (c) => txt(c.buyer?.fabric_producing) },
    { id: 'looms', title: 'No. of Looms', mono: true, render: (c) => txt(c.buyer?.no_of_looms) },
    { id: 'bqb', title: 'Buyer Qty(Bags/month)', mono: true, render: (c) => txt(c.buyer?.qty_bags_month) },
    { id: 'bqk', title: 'Buyer Qty(Kgs/month)', mono: true, render: (c) => txt(c.buyer?.qty_kgs_month) },
    { id: 'reed', title: 'Reed * Pick', render: (c) => txt(c.buyer?.reed_pick) },
    { id: 'width', title: 'Width', render: (c) => txt(c.buyer?.width) },
    { id: 'typetext', title: 'Type', render: (c) => txt(c.buyer?.type_text) },
    { id: 'csup', title: 'Counts Supplying', mono: true, render: (c) => txt(c.supplier?.counts_supplying) },
    { id: 'curmach', title: 'Current Machines', render: (c) => txt(c.supplier?.current_machines) },
    { id: 'spindles', title: 'Supplier No. of Roters & Spindles', mono: true, render: (c) => txt(c.supplier?.spindles) },
    { id: 'mprod', title: 'Monthly Production Quantity', mono: true, render: (c) => txt(c.supplier?.monthly_production) },
    { id: 'sqb', title: 'Supplier Qty(Bags/month)', mono: true, render: (c) => txt(c.supplier?.qty_bags_month) },
    { id: 'sqk', title: 'Supplier Qty(Kgs/month)', mono: true, render: (c) => txt(c.supplier?.qty_kgs_month) },
    { id: 'bname', title: 'Business Name', render: (c) => txt(companyOf(c)?.name) },
    { id: 'web', title: 'Website URL', render: (c) => { const v = common(c, 'website'); return v ? <a href={/^https?:\/\//i.test(v) ? v : `https://${v}`} target="_blank" rel="noopener noreferrer">{v}</a> : dash } },
    { id: 'map', title: 'Map Location', render: (c) => { const v = common(c, 'map_url'); return v ? <a href={/^https?:\/\//i.test(v) ? v : `https://${v}`} target="_blank" rel="noopener noreferrer">Open map</a> : dash } },
    { id: 'bunit', title: 'Business Unit', render: (c) => txt(companyOf(c)?.name) },
    { id: 'bphone', title: 'Business Phone', mono: true, render: (c) => txt(companyOf(c)?.mobile || companyOf(c)?.phone_1) },
  ]
  const visibleCols = columns.filter((col) => !hiddenCols.includes(col.id))
  /** Active / Inactive for a contact: both of its records (a contact with the role Both has one on each side). */
  async function toggleActive(c: Contact) {
    setBanner(null)
    const next = !c.active
    const targets = [
      ...(c.buyer ? [{ table: 'buyer_master', id: c.buyer.id }] : []),
      ...(c.supplier ? [{ table: 'supplier_master', id: c.supplier.id }] : []),
    ]
    const message = await setActive(targets, next)
    if (message) return setBanner({ kind: 'bad', text: message })
    setBanner({ kind: 'ok', text: `${c.name} marked ${next ? 'active' : 'inactive'}.` })
    await load()
  }

  function toggleCol(id: string) {
    setHiddenCols((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try {
        localStorage.setItem(COLS_KEY, JSON.stringify(next))
      } catch {
        /* a blocked storage just means the choice is not remembered */
      }
      return next
    })
  }
  // checkbox column (when the person can manage) + Name + the chosen columns + Actions
  const gridWidth = visibleCols.length + 2 + (canCreateAny ? 1 : 0)

  async function confirmDeleteContact() {
    if (!deleting) return
    setBusy(true)
    setDelErr(null)
    const results = await Promise.all([
      deleting.supplier ? bulkDelete('supplier_master', [deleting.supplier.id]) : Promise.resolve<BulkDeleteResult>({ deleted: [], failed: [] }),
      deleting.buyer ? bulkDelete('buyer_master', [deleting.buyer.id]) : Promise.resolve<BulkDeleteResult>({ deleted: [], failed: [] }),
    ])
    setBusy(false)
    const failed = results.flatMap((r) => r.failed)
    if (failed.length > 0) {
      setDelErr(`${deleting.name} could not be fully deleted: ${[...new Set(failed.map((f) => f.message))].join(' ')}`)
      await load()
      return
    }
    setBanner({ kind: 'ok', text: `${deleting.name} deleted.` })
    setDeleting(null)
    await load()
  }

  const shown = useMemo(() => {
    const q = searchKey(search)
    return contacts.filter((c) => {
      if (roleFilter && c.role !== roleFilter) return false
      if (statusFilter && (statusFilter === 'active') !== c.active) return false
      if (companyFilter && (c.supplier?.company_id ?? c.buyer?.company_id) !== companyFilter) return false
      const cat = c.supplier?.category ?? c.buyer?.category ?? ''
      if (catFilter && cat !== catFilter && c.buyer?.category !== catFilter) return false
      if (stateFilter && (c.supplier?.state ?? c.buyer?.state) !== stateFilter) return false
      if (commFilter && (c.supplier?.default_commission ?? c.buyer?.default_commission) !== commFilter) return false
      if (locFilter && !locationsOf(c).split(', ').includes(locFilter)) return false
      if (countFilter && !countIdsOf(c).includes(countFilter)) return false
      if (!q) return true
      // Every column the grid shows, plus the record codes.
      const text = searchKey([
        c.name, c.supplier?.supplier_code, c.buyer?.buyer_code,
        ...visibleCols.map((col) => nodeText(col.render(c))),
      ].join(' '))
      return text.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, search, roleFilter, statusFilter, companyFilter, catFilter, stateFilter, commFilter, locFilter, countFilter, hiddenCols, partyDocs, locationLinks, stationNames, countNames, partyCounts, companies, profileNames])

  const paging = usePaging(shown, [search, roleFilter, statusFilter, companyFilter, catFilter, stateFilter, commFilter, locFilter, countFilter].join('|'))

  // The board is grouped Buyer / Supplier; a contact that is both appears under each heading.
  const groups = (['buyer', 'supplier'] as const)
    .map((g) => {
      const has = g === 'buyer' ? hasBuyer : hasSupplier
      return {
        key: g,
        label: g === 'buyer' ? 'Buyer' : 'Supplier',
        total: shown.filter((c) => has(c.role)).length,
        rows: paging.visible.filter((c) => has(c.role)),
      }
    })
    .filter((g) => g.rows.length > 0)

  const stateOptions = [...new Set(contacts.map((c) => c.supplier?.state ?? c.buyer?.state).filter((s): s is string => Boolean(s?.trim())))].sort((x, y) => x.localeCompare(y))
  const filterDefs: FilterDef[] = [
    { name: 'role', label: 'Role', allLabel: 'All roles', options: ROLES },
    { name: 'status', label: 'Status', allLabel: 'All statuses', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
    { name: 'company', label: 'Business Unit', allLabel: 'All business units', options: companies.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'category', label: 'Category', allLabel: 'All categories', options: CATEGORIES.map((c) => ({ value: c, label: c })) },
    { name: 'state', label: 'State', allLabel: 'All states', options: stateOptions.map((s) => ({ value: s, label: s })) },
    { name: 'comm', label: 'Default Commission', allLabel: 'All', options: DEFAULT_COMMISSIONS.map((d) => ({ value: d.value, label: d.label })) },
    { name: 'location', label: 'Location MDM', allLabel: 'All locations', options: [...stationNames.values()].sort((x, y) => x.localeCompare(y)).map((s) => ({ value: s, label: s })) },
    { name: 'count', label: 'Counts', allLabel: 'All counts', options: [...countNames.entries()].map(([id, label]) => ({ value: id, label })) },
  ]
  const filterValues = { role: roleFilter, status: statusFilter, company: companyFilter, category: catFilter, state: stateFilter, comm: commFilter, location: locFilter, count: countFilter }
  function setFilter(name: string, value: string) {
    if (name === 'role') setRoleFilter(value as '' | Role)
    else if (name === 'status') setStatusFilter(value)
    else if (name === 'company') setCompanyFilter(value)
    else if (name === 'category') setCatFilter(value)
    else if (name === 'state') setStateFilter(value)
    else if (name === 'comm') setCommFilter(value)
    else if (name === 'location') setLocFilter(value)
    else if (name === 'count') setCountFilter(value)
  }
  function clearFilters() {
    setRoleFilter('')
    setStatusFilter('')
    setCompanyFilter('')
    setCatFilter('')
    setStateFilter('')
    setCommFilter('')
    setLocFilter('')
    setCountFilter('')
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
        const role: Role = (rawRole as Role) || (r.get('bank_account_1') ? 'supplier' : 'buyer')
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
            mobile: localDigits(r.get('mobile')),
            email: r.get('email'),
            address: r.get('address'),
            gst: r.get('gst').toUpperCase().replace(/\s+/g, ''),
            pan: r.get('pan').toUpperCase().replace(/\s+/g, ''),
            bank_account_1: r.get('bank_account_1'),
            bank_account_2: r.get('bank_account_2'),
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
            office_phone: localDigits(r.get('office_phone')),
            res_phone: localDigits(r.get('res_phone')),
            mill_address: r.get('mill_address'),
            remarks_2: r.get('remarks_2'),
            contact_1_email: r.get('contact_1_email'),
            contact_2_name: r.get('contact_2_name'),
            contact_2_mobile: localDigits(r.get('contact_2_mobile')),
            contact_2_email: r.get('contact_2_email'),
            contact_3_name: r.get('contact_3_name'),
            contact_3_mobile: localDigits(r.get('contact_3_mobile')),
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
          spindlage_capacity: '',
          default_commission: r.get('default_commission'),
          role,
          company_id: company?.id ?? '',
        }
        const fromGst = isGst(base.gst) ? gstPatch(base, base.gst) : {}
        const form: ContactForm = { ...base, state_code: base.state_code || fromGst.state_code || '', state: base.state || fromGst.state || '' }
        const dc = form.default_commission
        if (dc && !DEFAULT_COMMISSIONS.some((x) => x.value === dc)) throw new Error('default_commission must be pct, per_bag or per_kg')
        const found = problems(form, { suppliers: suppliers ?? [], buyers: buyers ?? [] })
        if (found.length > 0) throw new Error(found.join(' '))
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
        searchPlaceholder="Search any column: name, address, state, GST, phone, email, contact, bank, location, count..."
        filters={filterDefs}
        values={filterValues}
        onFilter={setFilter}
        onClear={clearFilters}
      >
        {canCreateAny && (
          <button className="btn primary" type="button" onClick={() => setCreationForm(true)}>
            New buyer / supplier
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


      <details className="col-picker" style={{ marginBottom: 8 }}>
        <summary className="small">Columns ({visibleCols.length + 1} of {columns.length + 1} shown)</summary>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', padding: '8px 0' }}>
          {columns.map((col) => (
            <label key={col.id} className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={!hiddenCols.includes(col.id)} onChange={() => toggleCol(col.id)} />
              {col.title}
            </label>
          ))}
          {hiddenCols.length > 0 && (
            <button className="btn ghost sm" type="button" onClick={() => { setHiddenCols([]); try { localStorage.removeItem(COLS_KEY) } catch { /* ignore */ } }}>
              Show all columns
            </button>
          )}
        </div>
      </details>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {canCreateAny && (
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={selection.allSelected} onChange={selection.toggleAll} aria-label="Select all contacts" />
                </th>
              )}
              <th className="left md-sticky">Name</th>
              {visibleCols.map((col) => (
                <th key={col.id}>{col.title}</th>
              ))}
              <th className="md-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td className="empty" colSpan={gridWidth}>
                  {contacts.length === 0 ? 'No contacts yet.' : 'No contact matches those filters.'}
                  {contacts.length === 0 && canCreateAny ? ' Add the first one.' : ''}
                </td>
              </tr>
            ) : (
              groups.map((grp) => (
                <Fragment key={grp.key}>
                  <tr className="group-row">
                    <td colSpan={gridWidth}>
                      {grp.label}
                      <span className="group-count">{grp.total}</span>
                    </td>
                  </tr>
                  {grp.rows.map((c) => (
                    <tr key={`${grp.key}:${c.key}`}>
                      {canCreateAny && (
                        <td>
                          <input type="checkbox" checked={selection.isSelected(c.key)} onChange={() => selection.toggle(c.key)} aria-label={`Select ${c.name}`} />
                        </td>
                      )}
                      <td className="left md-sticky">
                        <strong>{c.name}</strong>
                        {!c.active && <span className="chip bad" style={{ marginLeft: 8 }}>Inactive</span>}
                        {(c.supplier?.incomplete || c.buyer?.incomplete) && (
                          <span className="chip" style={{ marginLeft: 6 }} title="Created from a lead with some details missing. Edit it to complete them.">
                            Incomplete
                          </span>
                        )}
                      </td>
                      {visibleCols.map((col) => (
                        <td key={col.id} className={`small${col.mono ? ' mono' : ''}${col.wrap ? ' md-wrap' : ' md-nowrap'}`} style={col.wrap ? { whiteSpace: 'pre-line' } : undefined}>
                          {col.render(c)}
                        </td>
                      ))}
                      <td className="md-actions">
                        <RowActionMenu
                          label={c.name}
                          actions={[
                            { label: 'Edit', onSelect: () => (canEditContact(c) ? setEditing({ mode: 'edit', contact: c }) : setViewing(c)) },
                            { label: 'Documents', onSelect: () => setDocsFor(c) },
                            { label: c.active ? 'Mark inactive' : 'Mark active', onSelect: () => void toggleActive(c), disabledReason: canEditContact(c) ? null : 'Needs buyer / supplier edit permission' },
                            { label: 'Delete', tone: 'danger', onSelect: () => { setDelErr(null); setDeleting(c) }, disabledReason: canEditContact(c) ? null : 'Needs buyer / supplier edit permission' },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {viewing && (
        <ContactDrawer
          key={`v-${viewing.key}`}
          editing={{ mode: 'edit', contact: viewing }}
          companies={companies}
          canBuyer={canBuyer}
          canSupplier={canSupplier}
          canEdit={false}
          suppliers={suppliers ?? []}
          buyers={buyers ?? []}
          viewOnly
          onClose={() => setViewing(null)}
          onDone={() => setViewing(null)}
          onError={(text) => setBanner({ kind: 'bad', text })}
        />
      )}
      {deleting && (
        <ConfirmDialog title="Delete contact" busy={busy} error={delErr} onConfirm={() => void confirmDeleteContact()} onClose={() => setDeleting(null)}>
          Delete <strong>{deleting.name}</strong>{deleting.supplier && deleting.buyer ? ' (both its buyer and supplier records)' : ''}? This cannot be undone.
        </ConfirmDialog>
      )}
      {docsFor && <ContactDocumentsModal contact={docsFor} canEdit={canEditContact(docsFor)} onClose={() => { setDocsFor(null); void load() }} />}

      {creationForm && (
        <BuyerSupplierForm
          companies={companies}
          suppliers={suppliers ?? []}
          buyers={buyers ?? []}
          canBuyer={canBuyer}
          canSupplier={canSupplier}
          onClose={() => setCreationForm(false)}
          onDone={async (text, kind = 'ok') => {
            setBanner({ kind, text })
            setCreationForm(false)
            await load()
          }}
        />
      )}

      {editing && (
        <ContactDrawer
          key={editing.mode === 'edit' ? editing.contact.key : 'create'}
          editing={editing}
          companies={companies}
          canBuyer={canBuyer}
          canSupplier={canSupplier}
          canEdit={editing.mode === 'create' ? canCreateAny : canEditContact(editing.contact)}
          suppliers={suppliers ?? []}
          buyers={buyers ?? []}
          onDocsChanged={() => void load()}
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

/** The "Documents" row action: a contact's files, with the buyer / supplier
 *  record picked when the contact is both. */
function ContactDocumentsModal({ contact, canEdit, onClose }: { contact: Contact; canEdit: boolean; onClose: () => void }) {
  const [side, setSide] = useState<'buyer' | 'supplier'>(contact.buyer ? 'buyer' : 'supplier')
  const partyId = side === 'buyer' ? contact.buyer?.id : contact.supplier?.id
  return (
    <Modal
      title={`Documents · ${contact.name}`}
      size="lg"
      onClose={onClose}
      footer={
        <button className="btn ghost" type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      {contact.buyer && contact.supplier && (
        <div style={{ marginBottom: 8 }}>
          <span className="muted small">Documents of the </span>
          <select aria-label="Which record's documents to show" value={side} onChange={(e) => setSide(e.target.value as 'buyer' | 'supplier')}>
            <option value="buyer">Buyer record ({contact.buyer.buyer_code})</option>
            <option value="supplier">Supplier record ({contact.supplier.supplier_code})</option>
          </select>
        </div>
      )}
      {partyId && <DocumentsPanel key={`${side}-${partyId}`} partyType={side} partyId={partyId} canEdit={canEdit} />}
    </Modal>
  )
}

function ContactDrawer({
  editing, companies, canBuyer, canSupplier, canEdit, viewOnly = false, suppliers, buyers, onDocsChanged, onClose, onDone,
}: {
  viewOnly?: boolean
  suppliers: SupplierMaster[]
  buyers: BuyerMaster[]
  onDocsChanged?: () => void
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
  const [submitted, setSubmitted] = useState(false)
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
  const errors = useMemo(
    () =>
      contactErrors(form, {
        suppliers, buyers, countIds,
        selfSupplierId: existing?.supplier?.id,
        selfBuyerId: existing?.buyer?.id,
      }),
    [form, suppliers, buyers, countIds, existing],
  )
  // A missing required value is reported after the first Save click; a wrong or duplicate one shows as it is typed.
  const typed: Record<string, string> = {
    'c-name': form.name, 'c-state': form.state, 'c-contact': form.contact_person, 'c-c2name': form.contact_2_name, 'c-c3name': form.contact_3_name, 'c-ccode': form.customer_code, 'c-gst': form.gst, 'c-pan': form.pan, 'c-scode': form.state_code,
    'c-mobile': form.mobile, 'c-c1email': form.contact_1_email, 'c-c2mobile': form.contact_2_mobile, 'c-c2email': form.contact_2_email,
    'c-c3mobile': form.contact_3_mobile, 'c-c3email': form.contact_3_email, 'c-ophone': form.office_phone, 'c-rphone': form.res_phone,
    'c-email': form.email, 'c-address': form.address, 'c-cv': form.commission_value, 'c-defcomm': form.default_commission,
    'c-company': form.company_id, 'c-counts': countIds.join(','),
  }
  const visibleErrors: Record<string, string> = Object.fromEntries(
    Object.entries(errors).filter(([id]) => submitted || (typed[id] ?? '').trim() !== ''),
  )
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
    setSubmitted(true)
    setFormError(null)
    if (Object.keys(errors).length > 0) {
      focusFirstError(errors)
      return
    }
    setBusy(true)
    let ids: SavedIds
    try {
      ids = existing ? await saveContact(existing, form) : await createContact(form)
    } catch (caught) {
      setBusy(false)
      setFormError(errMessage(caught, 'Could not save this contact'))
      onDocsChanged?.() // one side may have saved before the other failed: refresh the list behind the form
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
      // one side may be gone and the other not: close and refresh the list so it shows the truth
      await onDone(`${existing.name} could not be fully deleted: ${[...new Set(failed.map((f) => f.message))].join(' ')}`, 'bad')
      return
    }
    await onDone(`${existing.name} deleted.`)
  }

  const showSupplier = hasSupplier(form.role)
  const showBuyer = hasBuyer(form.role)
  const sideRow = side === 'buyer' ? existing?.buyer : existing?.supplier
  const codes = [existing?.supplier?.supplier_code, existing?.buyer?.buyer_code].filter(Boolean).join(' / ')

  return (
    <Drawer title={existing ? `${codes} · ${existing.name}` : 'Buyers & Suppliers Creation Form'} onClose={onClose} readOnly={viewOnly}>
      <ErrorBanner message={formError} />
      {!viewOnly && !canEdit && <div className="notice small">You can view this contact; changing it needs permission for each side it has (buyer and supplier).</div>}

      <FieldErrorsProvider value={visibleErrors}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
          typeField={
            <Field
              id={`${p}-role`}
              label="Type"
              required
              hint={
                existing && existing.role !== form.role
                  ? 'Saving adds the missing record, or marks the dropped side inactive. Nothing is deleted.'
                  : form.role === 'both'
                    ? 'Both keeps a buyer record and a supplier record, linked by PAN.'
                    : undefined
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
          }
          businessUnit={
            <Field id={`${p}-company`} label="Business Unit" required>
              <select id={`${p}-company`} value={form.company_id} onChange={(e) => set('company_id', e.target.value)}>
                <option value="">-- Select Business Unit --</option>
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
      </fieldset>
      </FieldErrorsProvider>

      <div className="drawer-actions">
        {canEdit && (
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Add the contact'}
          </button>
        )}
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {existing && canEdit && <DeleteControl label="Delete this contact" name={existing.name} busy={busy} onConfirm={() => void remove()} />}
      </div>

      {existing && !viewOnly && (existing.supplier || existing.buyer) && (
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
            <DocumentsPanel key={`${side}-${sideRow.id}`} partyType={side} partyId={sideRow.id} canEdit={canEdit} onChanged={onDocsChanged} />
          )}
        </>
      )}
    </Drawer>
  )
}