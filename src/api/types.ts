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
  /** Business-unit fields from the monday "Business Units" board (MDM plan G1). */
  trade_name: string | null
  legal_name: string | null
  state: string | null
  state_code: string | null
  phone_1: string | null
  phone_2: string | null
  phone_3: string | null
  bank_account_1: string | null
  bank_account_2: string | null
  /** The business date the record was opened (a date, not a timestamp). */
  record_date: string
  created_by: string | null
  created_at: string
  updated_at: string
}

/** A delivery / station name (`station_master`), the monday "Location MDM" list. */
export interface StationMaster {
  id: string
  name: string
  is_active: boolean
  state: string | null
  address: string | null
  gst: string | null
  phone: string | null
  email: string | null
  md_contact: string | null
  accounts_phone: string | null
  zone: string | null
  created_at: string
  updated_at: string
}

/** A row in `location_links`: a location a buyer, supplier, transporter or delivery address uses. */
export type LinkOwner = 'buyer' | 'supplier' | 'transporter' | 'job_process'
export interface LocationLink {
  id: string
  owner_type: LinkOwner
  owner_id: string
  location_id: string
}

/** A row in `party_counts`: a count a buyer buys or a supplier supplies. */
export interface PartyCount {
  id: string
  party_type: 'buyer' | 'supplier'
  party_id: string
  count_id: string
}

/** The subset of Company columns a CSV import/export round-trips. Order here
 *  is the column order used for export, and the header row import matches
 *  against (case-insensitively). */
export const COMPANY_CSV_COLUMNS = [
  'name',
  'trade_name',
  'legal_name',
  'short_name',
  'currency',
  'ref_prefix',
  'address',
  'phone_1',
  'phone_2',
  'phone_3',
  'mobile',
  'fax',
  'email',
  'tax_id',
  'pan_number',
  'state',
  'state_code',
  'bank_account_1',
  'bank_account_2',
  'is_home',
  'is_active',
] as const

export type CompanyCsvColumn = (typeof COMPANY_CSV_COLUMNS)[number]

/* ---- Count master (T-002) ------------------------------------------------ */

export const COUNT_MACHINES = ['OE', 'RING SPUN', 'VORTEX'] as const
export const COUNT_YARNS = ['COTTON', 'POLYESTER', 'VISCOSE', 'LINEN', 'HEMP', 'LYCRA'] as const
export const COUNT_COMPOSITIONS = [...COUNT_YARNS, 'BLENDED'] as const
export const COUNT_YARN_TYPES = ['CHEESE', 'CONE'] as const
export const COUNT_PROCESSES = ['COMBED', 'KARDED', 'KARDED COMPACT', 'COMBED COMPACT'] as const
export const COUNT_CERTIFICATIONS = ['BCI', 'OEKO TEX', 'GOTS', 'NPOP', 'NOP', 'GRS'] as const
export const COUNT_PLIES = ['SINGLE', 'DOUBLE'] as const

/** A row in `count_master`. The yarn recipe (yarn_1 / yarn_2 and their
 *  percentages) is what is saved; composition, ratio, blended, display_name,
 *  recipe_key and the duplicate flag are derived by the database trigger, e.g.
 *  "20S VORTEX 40% COTTON 60% POLYESTER BLENDED DOUBLE KARDED COMPACT BCI CHEESE". */
export interface CountRow {
  id: string
  item_no: number
  name: string | null
  count_no: number
  machine: string
  yarn_1: string
  yarn_1_pct: number
  yarn_2: string | null
  yarn_2_pct: number | null
  composition: string
  ratio: string
  blended: string | null
  yarn_type: string
  process: string | null
  certification: string | null
  ply: string | null
  display_name: string
  recipe_key: string
  is_duplicate: boolean
  duplicate_error: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/* ---- Lookups used by several masters ------------------------------------- */

export const ZONES: { value: string; label: string }[] = [
  { value: 'WEST', label: 'West Zone' },
  { value: 'SOUTH', label: 'South Zone' },
  { value: 'NORTH', label: 'North Zone' },
]
export const VEHICLE_TYPES: { value: string; label: string }[] = [
  { value: 'TRUCK', label: 'Truck' },
  { value: 'LORRY', label: 'Lorry' },
  { value: 'TEMPO', label: 'Tempo' },
]
export const BUYER_MACHINE_TYPES = ['SULZER', 'AIRJET', 'POWERLOOM'] as const

/** The fields the buyer and supplier masters share beyond the T-003/T-004 core. */
export interface PartyProfile {
  short_name: string | null
  customer_code: string | null
  website: string | null
  map_url: string | null
  office_phone: string | null
  res_phone: string | null
  mill_address: string | null
  remarks_2: string | null
  contact_1_email: string | null
  contact_2_name: string | null
  contact_2_mobile: string | null
  contact_2_email: string | null
  contact_3_name: string | null
  contact_3_mobile: string | null
  contact_3_email: string | null
  sales_person_id: string | null
  collection_staff_id: string | null
  messenger_id: string | null
  qty_bags_month: number | null
  qty_kgs_month: number | null
  /** monday's Date and Default Commission (added by the party creation form migration). */
  record_at?: string | null
  default_commission?: string | null
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
export interface SupplierMaster extends PartyProfile {
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
  /** Supplier-only profile. */
  machine_type: string | null
  counts_supplying: number | null
  spindles: number | null
  monthly_production: number | null
  created_at: string
  updated_at: string
}

/** A row in `buyer_master`. */
export interface BuyerMaster extends PartyProfile {
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
  bank_account_1: string | null
  bank_account_2: string | null
  /** Buyer-only profile. */
  machine_types: string[] | null
  no_of_looms: number | null
  fabric_producing: string | null
  reed_pick: string | null
  width: string | null
  created_at: string
  updated_at: string
}

/* ---- Leads (T-009 record, T-011 qualification) --------------------------- */

export const LEAD_ROLES: { value: 'buyer' | 'supplier' | 'both'; label: string }[] = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'both', label: 'Both' },
]
export const LEAD_UOMS = ['KG', 'BAGS', 'HANKS', 'BALES', 'CARTON', 'CHIPPA', 'METERS', 'TONS'] as const
export const LEAD_SOURCES = ['Referral', 'Repeat buyer', 'Phone call', 'WhatsApp', 'Email', 'Visit', 'Trade fair', 'Website', 'Other'] as const
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
  // migration 20261117190000
  lead_type: 'existing' | 'new'
  lead_source: string | null
  follow_up_at: string | null
  timeline_from: string | null
  timeline_to: string | null
  mobile_cc: string
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
  buyer_id: string | null
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
  // monday-model fields (migration 20261117150000)
  manager_id: string | null
  final_rate: number | null
  buyer_comm_basis: string | null
  buyer_comm_value: number | null
  supplier_comm_basis: string | null
  supplier_comm_value: number | null
  total_weight: number | null
  deal_value: number | null
  buyer_commission: number | null
  supplier_commission: number | null
  lost_reason: string | null
  status_changed_at: string | null
}

export interface Order {
  id: string
  order_no: string
  order_date: string
  status: 'draft' | 'confirmed' | 'open_for_execution' | 'closed' | 'cancelled'
  deal_id: string | null
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
  // monday-model fields (migration 20261117170000)
  dispatch_status: 'draft' | 'in_progress' | 'partially_dispatched' | 'fully_dispatched' | 'cancelled' | 'returned'
  dispatched_qty: number
  invoice_no: string | null
  invoice_date: string | null
  sale_type: 'local' | 'export'
  transport_type: string | null
  transporter_id: string | null
  vehicle_no: string | null
  driver_phone: string | null
  person_id: string | null
  final_rate: number | null
  buyer_comm_basis: string | null
  buyer_comm_value: number | null
  supplier_comm_basis: string | null
  supplier_comm_value: number | null
  total_weight: number | null
  order_value: number | null
  buyer_commission: number | null
  supplier_commission: number | null
  cgst_pct: number | null
  insurance_pct: number | null
  add_amount: number | null
  deduct_amount: number | null
  round_off: number | null
  total_amount: number | null
  cancelled_at: string | null
  is_duplicate: boolean
  duplication_error: string | null
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
  // monday-model fields (migration 20261117170000)
  invoice_date: string | null
  dc_no: string | null
  delivery_date: string | null
  transport_type: string | null
  person_id: string | null
  total_weight: number | null
  entry_value: number | null
  buyer_commission: number | null
  supplier_commission: number | null
  cgst_pct: number | null
  insurance_pct: number | null
  add_amount: number | null
  deduct_amount: number | null
  round_off: number | null
  total_amount: number | null
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
      'task.read', 'task.work', 'message.send',
    ],
  },
  {
    id: 'ops', label: 'Backend operations',
    description: 'Runs the order at the mill: acknowledgement, production, QC, shipment and delivery.',
    permissions: [
      'deal.read', 'quote.read', 'money.read', 'document.read', 'report.view',
      'deal.edit', 'document.upload', 'buyer.manage', 'mill.manage', 'stage.move_back',
      'stage.move.sent', 'stage.move.production', 'stage.move.shipped', 'stage.move.delivered',
      'task.read', 'task.work',
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
      'task.read', 'task.manage', 'task.work', 'message.send', 'message.view',
    ],
  },
  {
    id: 'management', label: 'Management',
    description: 'Sees everything, signs deals off at close, does not work them day to day.',
    permissions: [
      'deal.read', 'quote.read', 'money.read', 'document.read', 'report.view',
      'deal.approve', 'order.read', 'report.export', 'audit.view', 'sc.read', 'transport.read', 'jobprocess.read', 'closeout.edit', 'stage.move.closed', 'stage.move_back', 'md_contact.view',
      'task.read', 'message.view',
    ],
  },
  {
    id: 'field', label: 'Field & collection staff',
    description: 'Works the tasks assigned to them: deliveries, collections, visits, with proof photos and check-in.',
    permissions: ['task.work'],
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

export const SC_UOMS = ['KG', 'BAGS', 'HANKS', 'BALES', 'CARTON', 'CHIPPA', 'METERS', 'TONS'] as const

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
  // monday-model fields (migration 20261117160000)
  stage: 'draft' | 'send' | 'send_delivery'
  sale_type: 'local' | 'export'
  job_process_id: string | null
  delivery_address: string | null
  transporter_id: string | null
  vehicle_no: string | null
  driver_phone: string | null
  buyer_comm_basis: string | null
  buyer_comm_value: number | null
  supplier_comm_basis: string | null
  supplier_comm_value: number | null
  total_weight: number | null
  sc_value: number | null
  stage_changed_at: string | null
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
  bank_account_2: string | null
  email: string | null
  vehicle_type: string | null
  vehicle_no_1: string | null
  vehicle_no_2: string | null
  vehicle_no_3: string | null
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
  email_1: string | null
  email_2: string | null
  company_id: string | null
  info: string | null
  remarks: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/* ---- Tasks module -------------------------------------------------------- */

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'
export type PaymentMode = 'online' | 'cash' | 'cheque' | 'neft' | 'upi' | 'rtgs' | 'cards'

export interface TaskTypeRow {
  key: string
  label: string
  view_key: string
  requires_proof: boolean
  requires_gps: boolean
  auto_done_on_proof: boolean
  default_due_days: number
  sort_order: number
  is_active: boolean
}

/** Type-specific fields carried in `tasks.details` (all optional). */
export interface TaskDetails {
  delivery_mode?: 'hand' | 'courier'
  delivery_status?: 'not_delivered' | 'delivered'
  acknowledgement?: 'yes' | 'no'
  pending_payment?: boolean
  invoice_no?: string
  bill_no?: string
  load_reference?: string
  check_status?: 'outstanding' | 'cleared'
  sample_lot?: string
  sample_quality?: string
  sample_type?: string
  delivery_date?: string
  feedback_status?: 'pending' | 'approved' | 'rejected'
  visit_status?: 'planned' | 'visited' | 'completed' | 'missed'
  received?: 'yes' | 'no'
  invoice_date?: string
  visited_on?: string
  visit_summary?: string
  escalation?: boolean
  step_days?: number
  [key: string]: unknown
}

export interface Task {
  id: string
  task_no: string
  task_type: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string
  start_date: string
  assigned_to: string | null
  accounts_staff_id: string | null
  buyer_id: string | null
  supplier_id: string | null
  order_id: string | null
  dispatch_id: string | null
  commission_invoice_id: string | null
  transporter_id: string | null
  source_task_id: string | null
  amount: number
  amount_collected: number
  mode: PaymentMode | null
  notes: string | null
  check_in_at: string | null
  check_out_at: string | null
  lat: number | null
  lng: number | null
  accuracy_m: number | null
  completed_at: string | null
  completed_by: string | null
  details: TaskDetails
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TaskPayment {
  id: string
  task_id: string
  amount: number
  paid_on: string
  mode: PaymentMode | null
  reference: string | null
  notes: string | null
  order_payment_id: string | null
  created_by: string | null
  created_at: string
}

export type ChequeStatus = 'pending' | 'collected' | 'deposited' | 'cleared' | 'bounced'

export interface TaskCheque {
  id: string
  task_id: string | null
  order_id: string | null
  buyer_id: string | null
  invoice_no: string | null
  cheque_no: string
  bank_name: string | null
  cheque_date: string | null
  amount: number
  photo_path: string | null
  status: ChequeStatus
  collected_by: string | null
  collection_date: string
  deposited_on: string | null
  deposit_bank: string | null
  slip_no: string | null
  deposited_by: string | null
  cleared_on: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TaskAttachment {
  id: string
  task_id: string
  kind: 'proof' | 'photo' | 'document'
  file_name: string
  storage_path: string
  size_bytes: number | null
  content_type: string | null
  lat: number | null
  lng: number | null
  uploaded_by: string | null
  uploaded_at: string
}

export type TaskEventKind =
  | 'created' | 'assigned' | 'status' | 'comment' | 'check_in' | 'check_out'
  | 'payment' | 'proof' | 'message' | 'escalation' | 'reminder' | 'system'

export interface TaskEvent {
  id: number
  task_id: string
  kind: TaskEventKind
  from_value: string | null
  to_value: string | null
  note: string | null
  data: Record<string, unknown> | null
  created_by: string | null
  created_at: string
}

export interface TaskRule {
  rule_key: string
  label: string
  task_type: string | null
  kind: 'reminder' | 'escalation'
  config: { days?: number[]; after_days?: number; [key: string]: unknown }
  is_active: boolean
  updated_at: string
}

export interface AppNotification {
  id: string
  user_id: string
  kind: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  message: string | null
  href: string | null
  task_id: string | null
  read_at: string | null
  created_at: string
}

export interface MessageTemplate {
  key: string
  channel: 'whatsapp' | 'email'
  provider_template: string | null
  subject: string | null
  body: string
  variables: string[]
  is_active: boolean
  updated_at: string
}

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'replied' | 'manual'

export interface MessageRow {
  id: string
  direction: 'out' | 'in'
  channel: 'whatsapp' | 'email'
  template_key: string | null
  recipient: string
  buyer_id: string | null
  task_id: string | null
  subject: string | null
  body: string
  variables: Record<string, string>
  document_path: string | null
  status: MessageStatus
  provider_message_id: string | null
  error: string | null
  attempts: number
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  created_by: string | null
  created_at: string
}

export interface TaskCounts {
  open: number
  due_today: number
  overdue: number
  awaiting_proof: number
  payment_outstanding: number
  mine: number
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