/** Shapes the app works with. These mirror the tables and views in
 *  supabase/migrations/, not a FastAPI schema anymore. */

export interface Org {
  name: string
  short_name: string
  currency: string
}

export interface PasswordPolicy {
  min_length: number
  rules: string[]
}

/** Supabase Auth enforces its own minimum; this is just what the UI shows
 *  while someone is typing, so the requirement list from the old app is kept
 *  as a client-side constant rather than a server-provided policy object. */
export const PASSWORD_POLICY: PasswordPolicy = {
  min_length: 8,
  rules: ['At least 8 characters', 'Not the same as your email or name'],
}

export interface PublicConfig {
  org: Org
  mail_enabled: boolean
  password_policy: PasswordPolicy
  needs_bootstrap: boolean
}

export interface Me {
  id: string
  email: string
  name: string
  job_title: string | null
  is_admin: boolean
  is_active: boolean
  must_change_password: boolean
  profile_template: string | null
  last_login_at: string | null
  created_at: string
  /** Everything this user may do. For an administrator, the whole catalogue. */
  permissions: string[]
  /** Only what an administrator ticked, ignoring the admin override. */
  granted_permissions: string[]
}

export interface PermissionDef {
  key: string
  label: string
  group: string
  hint: string
  dangerous: boolean
}

export interface ProfileTemplate {
  id: string
  label: string
  description: string
  permissions: string[]
}

export interface Meta {
  org: Org
  user: Me
  permission_catalogue: PermissionDef[]
  permission_groups: string[]
  profile_templates: ProfileTemplate[]
  password_policy: PasswordPolicy
  mail_enabled: boolean
}

export interface UserDetail extends Me {
  created_by_name: string | null
  active_sessions: number
}

export interface UserCreated extends UserDetail {
  initial_password: string | null
  invitation_emailed: boolean
}

export interface SessionInfo {
  id: string
  created_at: string
  last_seen_at: string
  expires_at: string
  user_agent: string | null
  ip: string | null
  current: boolean
}

export interface AuditRow {
  id: number
  at: string
  actor_name: string | null
  entity: string
  entity_id: string | null
  action: string
  detail: string | null
  ip: string | null
}

/** A row in `companies` (T-001, "how the company works here", widened from a
 *  single org profile into a general Companies object). Exactly one row may
 *  have is_home = true -- that one drives the app's own branding and deal
 *  reference-number prefix, the role org_settings.id=1 used to play.
 *
 *  The business trades under one market-facing brand but bills through
 *  several legal companies -- brand_name is the free-text field that groups
 *  those legal entities together (same brand_name, different name/ref_prefix)
 *  without a separate parent table. is_buyer/is_supplier let the same record
 *  carry both roles (or neither, for a purely internal legal entity) so a
 *  party that buys and sells is never duplicated across two objects. */
export interface Company {
  id: string
  name: string
  short_name: string
  currency: string
  ref_prefix: string
  brand_name: string | null
  address: string | null
  phone_numbers: string[] | null
  mobile: string | null
  fax: string | null
  email: string | null
  tax_id: string | null
  pan_number: string | null
  is_home: boolean
  is_buyer: boolean
  is_supplier: boolean
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

/** The subset of Company columns a CSV import/export round-trips. Order here
 *  is the column order used for export, and the header row import matches
 *  against (case-insensitively). */
export const COMPANY_CSV_COLUMNS = [
  'name',
  'short_name',
  'brand_name',
  'currency',
  'ref_prefix',
  'address',
  'phone_numbers',
  'mobile',
  'fax',
  'email',
  'tax_id',
  'pan_number',
  'is_home',
  'is_buyer',
  'is_supplier',
  'is_active',
] as const

export type CompanyCsvColumn = (typeof COMPANY_CSV_COLUMNS)[number]

/* ---- Count master (T-002) ------------------------------------------------ */

export const COUNT_MACHINES = ['OE', 'RING SPUN', 'VORTEX'] as const
export const COUNT_COMPOSITIONS = ['COTTON', 'POLYESTER', 'VISCOSE', 'LINEN', 'HEMP', 'BLENDED'] as const
export const COUNT_BLENDS = ['COTTON/POLYESTER', 'COTTON/VISCOSE'] as const
export const COUNT_YARN_TYPES = ['CHEESE', 'CONE'] as const
export const COUNT_PROCESSES = ['COMBED', 'KARDED', 'KARDED COMPACT', 'COMBED COMPACT'] as const
export const COUNT_CERTIFICATIONS = ['BCI', 'OEKO TEX', 'GOTS', 'NPOP', 'NOP'] as const
export const COUNT_PLIES = ['SINGLE', 'DOUBLE'] as const
export const COUNT_COMMON_RATIOS = ['100%', '50/50', '60/40', '70/30', '65/35', '80/20'] as const

/** A row in `count_master`. display_name is built by a database trigger, e.g.
 *  "10 S RING SPUN 100% COTTON CONE COMBED COMPACT". */
export interface CountRow {
  id: string
  count_no: number
  machine: string
  composition: string
  ratio: string
  blended: string | null
  yarn_type: string
  process: string | null
  certification: string | null
  ply: string | null
  display_name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

/* ---- Supplier and buyer masters (T-003, T-004) --------------------------- */

export const CATEGORIES = ['1', '2', '3', '4'] as const
export const COMMISSION_BASES: { value: string; label: string }[] = [
  { value: 'pct', label: '% of ex-mill value' },
  { value: 'per_bag', label: 'Per bag' },
  { value: 'per_kg', label: 'Per kg' },
]

/** A row in `supplier_master`. One record per supplier; a party that is also a
 *  buyer has a separate row in buyer_master, matched on PAN/GST. */
export interface SupplierMaster {
  id: string
  supplier_code: string
  name: string
  contact_person: string | null
  mobile: string | null
  email: string | null
  address: string | null
  gst: string | null
  pan: string | null
  bank_account_1: string | null
  bank_account_2: string | null
  state_code: string | null
  state: string | null
  category: string | null
  commission_basis: string | null
  commission_value: number | null
  product_range: string | null
  company_id: string | null
  incomplete: boolean
  gst_status: 'unverified' | 'verified' | 'failed'
  gst_verified_at: string | null
  gst_verified_by: string | null
  gst_verify_note: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** A row in `buyer_master`. */
export interface BuyerMaster {
  id: string
  buyer_code: string
  name: string
  contact_person: string | null
  mobile: string | null
  email: string | null
  address: string | null
  gst: string | null
  pan: string | null
  spindlage_capacity: string | null
  product_range: string | null
  state_code: string | null
  state: string | null
  category: string | null
  commission_basis: string | null
  commission_value: number | null
  company_id: string | null
  incomplete: boolean
  gst_status: 'unverified' | 'verified' | 'failed'
  gst_verified_at: string | null
  gst_verified_by: string | null
  gst_verify_note: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/* ---- Leads (T-009 record, T-011 qualification) --------------------------- */

export const LEAD_ROLES: { value: 'buyer' | 'supplier' | 'both'; label: string }[] = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'both', label: 'Both' },
]
export const LEAD_UOMS = ['KG', 'TONS', 'METERS', 'BAGS'] as const
export const LEAD_STATUSES: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'lost', label: 'Lost' },
]

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'lost'
export type LeadRole = 'buyer' | 'supplier' | 'both'

/** A row in `leads`. The qualification rules are enforced by a database
 *  trigger, so a lead can only reach 'qualified' when its count, quantity and
 *  the Buyer/Supplier Master links its role requires are in place. */
export interface Lead {
  id: string
  lead_no: string
  status: LeadStatus
  party_role: LeadRole
  party_name: string
  contact_person: string | null
  mobile: string | null
  station: string | null
  office_address: string | null
  gst: string | null
  count_id: string | null
  quantity: number | null
  uom: string | null
  expected_rate: number | null
  timeline: string | null
  remarks: string | null
  sales_staff_id: string | null
  follow_up_date: string | null
  buyer_id: string | null
  supplier_id: string | null
  qualified_at: string | null
  qualified_by: string | null
  converted_deal_id: string | null
  converted_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/* ---- Station, payment terms, documents, contacts, activity, deals -------- */

export interface Station { id: string; name: string; is_active: boolean }

export interface PaymentTerm {
  id: string
  name: string
  days: number
  advance_pct: number
  description: string | null
  is_active: boolean
}

export const DOC_TYPES: { value: string; label: string }[] = [
  { value: 'gst_copy', label: 'GST copy' },
  { value: 'cancelled_cheque', label: 'Cancelled cheque' },
  { value: 'kyc_form', label: 'KYC form' },
  { value: 'other', label: 'Other' },
]

export interface PartyDocument {
  id: string
  party_type: 'supplier' | 'buyer'
  party_id: string
  doc_type: string
  file_name: string
  storage_path: string
  size_bytes: number | null
  mime_type: string | null
  uploaded_by: string | null
  uploaded_at: string
}

export interface MdContact {
  id: string
  party_type: 'supplier' | 'buyer'
  party_id: string
  name: string
  mobile: string
  email: string | null
  designation: string | null
  created_at: string
}

export type ActivityKind = 'note' | 'call' | 'quotation' | 'reminder' | 'task' | 'discussion' | 'email' | 'whatsapp' | 'meeting'
export interface Activity {
  id: string
  entity_type: 'lead' | 'supplier' | 'buyer' | 'deal'
  entity_id: string
  kind: ActivityKind
  note: string | null
  quotation_ref: string | null
  due_date: string | null
  is_done: boolean
  done_at: string | null
  created_by: string | null
  created_at: string
}

export const COMMISSION_TYPES: { value: string; label: string }[] = [
  { value: 'pct_0_5', label: '0.5% of supplier rate' },
  { value: 'pct_1', label: '1% of supplier rate' },
  { value: 'pct_2', label: '2% of supplier rate' },
  { value: 'per_kg_1', label: '₹1 per kg' },
  { value: 'per_bag_30', label: '₹30 per bag' },
]

export interface Deal {
  id: string
  deal_no: string
  status: string
  lead_id: string | null
  owner_id: string | null
  buyer_id: string
  supplier_id: string | null
  company_id: string | null
  buyer_gst: string | null
  supplier_gst: string | null
  payment_term_id: string | null
  count_id: string
  quantity: number
  uom: string
  supplier_rate: number | null
  buyer_rate: number | null
  price_basis: 'ex_mill' | 'net'
  freight: 'included' | 'excluded'
  bag_weight: number | null
  commission_type: string | null
  commission_value: number | null
  commission_total: number | null
  margin: number | null
  margin_total: number | null
  notes: string | null
  supplier_confirmed_at: string | null
  supplier_confirmed_by: string | null
  buyer_confirmed_at: string | null
  buyer_confirmed_by: string | null
  approved_at: string | null
  approved_by: string | null
  approval_margin_pct: number | null
  confirmed_at: string | null
  confirmed_by: string | null
  sales_confirmation_id: string | null
  created_at: string
  updated_at: string
}

export interface Order {
  id: string
  order_no: string
  order_date: string
  status: 'draft' | 'confirmed' | 'open_for_execution' | 'closed'
  deal_id: string
  sales_confirmation_id: string
  buyer_id: string
  supplier_id: string
  company_id: string
  count_id: string
  quantity: number
  uom: string
  buyer_rate: number
  supplier_rate: number
  commission_type: string | null
  commission_value: number | null
  price_basis: 'ex_mill' | 'net'
  freight: 'included' | 'excluded'
  bag_weight: number | null
  payment_term_id: string | null
  tentative_dispatch_date: string | null
  delivery_schedule: string | null
  special_instructions: string | null
  job_process_id: string | null
  alt_delivery_address: string | null
  confirmed_at: string | null
  execution_opened_at: string | null
  payment_tracking_enabled: boolean
  closed_at: string | null
  created_at: string
  updated_at: string
}

export interface CommissionInvoice {
  id: string
  invoice_no: string
  order_id: string
  invoice_date: string
  amount: number
}

export interface CloseStatus {
  dispatched: number
  quantity: number
  quantity_done: boolean
  buyer_received: number
  buyer_value: number
  buyer_done: boolean
  supplier_paid: number
  supplier_value: number
  supplier_done: boolean
  invoice_done: boolean
}

export interface OrderTransport {
  id: string
  order_id: string
  kind: 'our' | 'third_party'
  transporter_id: string | null
  vehicle_no: string | null
  driver_name: string | null
  driver_mobile: string | null
  freight_amount: number | null
  notes: string | null
  created_at: string
}

export interface OrderJobProcess {
  id: string
  order_id: string
  job_process_id: string
  quantity: number | null
  instructions: string | null
  created_at: string
}

export interface OrderDispatch {
  id: string
  dispatch_no: string
  order_id: string
  dispatch_date: string
  quantity: number
  transport_id: string | null
  vehicle_no: string | null
  lr_no: string | null
  invoice_no: string | null
  remarks: string | null
  mill_invoice_no: string | null
  mill_invoice_date: string | null
  pod_received_on: string | null
  grn_no: string | null
  grn_received_on: string | null
  transporter_invoice_no: string | null
  transporter_invoice_date: string | null
  transporter_invoice_amount: number | null
  transporter_paid_amount: number | null
  transporter_paid_on: string | null
  transporter_payment_ref: string | null
  created_at: string
}

export interface OrderPayment {
  id: string
  order_id: string
  kind: 'buyer_receipt' | 'supplier_payment'
  amount: number
  paid_on: string
  mode: string | null
  reference: string | null
  notes: string | null
  created_at: string
}

export interface DealChange {
  id: string
  deal_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string
}

export interface PipelineStage {
  id: string
  name: string
  phase: string
  owner: string
  permission: string
}

export interface Pipeline {
  phases: { id: string; name: string }[]
  stages: PipelineStage[]
}

/** Starting points offered when creating a user -- there is no server-side
 *  PROFILE_TEMPLATES constant anymore, so this is kept in the frontend. The
 *  keys match profiles.profile_template and permission_catalogue.key. */
export const PROFILE_TEMPLATES: ProfileTemplate[] = [
  {
    id: 'sales', label: 'Sales',
    description: 'Raises enquiries, collects mill quotations, gets the buyer’s approval and confirms the order.',
    permissions: [
      'deal.read', 'quote.read', 'money.read', 'document.read', 'report.view',
      'deal.create', 'deal.edit', 'deal.mark_lost', 'quote.manage', 'order.read', 'order.manage',
      'document.upload', 'buyer.manage', 'mill.manage', 'article.manage', 'stage.move_back',
      'lead.manage', 'lead.qualify', 'sc.read', 'sc.manage', 'transport.read', 'transport.manage', 'jobprocess.read', 'jobprocess.manage',
      'stage.move.lead', 'stage.move.enquiry', 'stage.move.quoted', 'stage.move.approval',
      'stage.move.order', 'stage.move.sent',
    ],
  },
  {
    id: 'ops', label: 'Backend operations',
    description: 'Runs the order at the mill: acknowledgement, production, QC, shipment and delivery.',
    permissions: [
      'deal.read', 'quote.read', 'money.read', 'document.read', 'report.view',
      'deal.edit', 'document.upload', 'buyer.manage', 'mill.manage', 'stage.move_back',
      'stage.move.sent', 'stage.move.production', 'stage.move.shipped', 'stage.move.delivered',
    ],
  },
  {
    id: 'accounts', label: 'Accounts',
    description: 'Raises the buyer invoice, tracks payment, invoices the mill for commission and closes the deal.',
    permissions: [
      'deal.read', 'quote.read', 'money.read', 'document.read', 'report.view',
      'deal.edit', 'invoice.edit', 'commission.edit', 'closeout.edit',
      'document.upload', 'report.export', 'audit.view', 'stage.move_back',
      'stage.move.invoiced', 'stage.move.paid', 'stage.move.comm_invoiced',
      'stage.move.comm_paid', 'stage.move.closed', 'md_contact.view',
    ],
  },
  {
    id: 'management', label: 'Management',
    description: 'Sees everything, signs deals off at close, does not work them day to day.',
    permissions: [
      'deal.read', 'quote.read', 'money.read', 'document.read', 'report.view',
      'deal.approve', 'order.read', 'report.export', 'audit.view', 'sc.read', 'transport.read', 'jobprocess.read', 'closeout.edit', 'stage.move.closed', 'stage.move_back', 'md_contact.view',
    ],
  },
  {
    id: 'viewer', label: 'Viewer',
    description: 'Read-only across the whole system.',
    permissions: ['deal.read', 'quote.read', 'money.read', 'document.read', 'report.view'],
  },
  {
    id: 'custom', label: 'Custom',
    description: 'Start from nothing and tick exactly what this person needs.',
    permissions: [],
  },
]

/* ---- Sales confirmation (T-006) ---------------------------------------------- */

export const SC_UOMS = ['KG', 'TONS', 'METERS', 'BAGS'] as const

export interface SalesConfirmation {
  id: string
  sc_no: string
  confirmed_at: string
  status: 'draft' | 'confirmed' | 'cancelled'
  deal_id: string | null
  supplier_id: string | null
  buyer_id: string | null
  supplier_company_id: string | null
  buyer_company_id: string | null
  count_id: string | null
  uom: string
  quantity: number | null
  net_quantity: number | null
  freight: 'included' | 'excluded'
  bag_weight: number | null
  rate: number | null
  payment_term_id: string | null
  remarks: string | null
  supplier_notified_at: string | null
  buyer_notified_at: string | null
  created_at: string
  updated_at: string
}

/* ---- Transportation ---------------------------------------------------------- */

export interface Transporter {
  id: string
  transporter_code: string
  transporter_type: 'internal' | 'third_party'
  name: string
  short_name: string | null
  station_id: string | null
  office_address: string | null
  delivery_address: string | null
  contact_person: string | null
  mobile: string | null
  contact_person_2: string | null
  mobile_2: string | null
  office_phone: string | null
  res_phone: string | null
  gst: string | null
  state_code: string | null
  state: string | null
  pan: string | null
  bank_account: string | null
  company_id: string | null
  info: string | null
  remarks: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/* ---- Job process ------------------------------------------------------------- */

export interface JobProcess {
  id: string
  process_code: string
  name: string
  short_name: string | null
  buyer_id: string | null
  station_id: string | null
  office_address: string | null
  delivery_address: string | null
  contact_person: string | null
  mobile: string | null
  contact_person_2: string | null
  mobile_2: string | null
  office_phone: string | null
  res_phone: string | null
  gst: string | null
  state_code: string | null
  state: string | null
  pan: string | null
  bank_account: string | null
  company_id: string | null
  info: string | null
  remarks: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CollectionTask {
  id: string
  order_id: string
  task_type: 'buyer_payment' | 'commission_invoice' | 'follow_up' | 'cheque_collection' | 'invoice_delivery' | 'payment_deposit' | 'cash_collection' | 'delivery_note' | 'mill_payment_deposit'
  due_date: string
  assigned_to: string | null
  amount_to_collect: number
  status: 'pending' | 'in_progress' | 'done' | 'cancelled'
  notes: string | null
  completed_at: string | null
  created_at: string
}

export interface ChequeCollection {
  id: string
  order_id: string
  cheque_no: string
  bank_name: string | null
  amount: number
  collection_date: string
  collected_by: string | null
  deposited_on: string | null
  deposit_bank: string | null
  slip_no: string | null
  notes: string | null
  created_at: string
}

export interface OrderTrip {
  id: string
  trip_no: string
  dispatch_id: string
  trip_date: string
  vehicle_no: string | null
  driver_name: string | null
  mileage_start: number
  mileage_end: number
  fuel_used: number
  fuel_cost: number
  other_cost: number
  distance_km: number
  trip_cost: number
  notes: string | null
  created_at: string
}