/** Commission invoices (the monday "Commission Board" app, rebuilt): one invoice per Business Unit and party
 *  (Buyer or Supplier) for a date range. The database works out every amount; this file holds the types,
 *  the wording shared by the screen and the PDF, and the amount in words. */

export type PartyType = 'buyer' | 'supplier'

/** monday's Status column: Generated, then Sent (done) or Pending; a cancelled invoice is final. */
export type InvoiceStatus = 'generated' | 'sent' | 'pending' | 'cancelled'
export const INVOICE_STATUSES: { value: InvoiceStatus; label: string; chip: string }[] = [
  { value: 'generated', label: 'Generated', chip: '' },
  { value: 'sent', label: 'Sent', chip: ' good' },
  { value: 'pending', label: 'Pending', chip: ' warn' },
  { value: 'cancelled', label: 'Cancelled', chip: ' bad' },
]
export const statusInfo = (s: string) => INVOICE_STATUSES.find((x) => x.value === s) ?? { value: s as InvoiceStatus, label: s, chip: '' }

/** monday's Mode of Payment labels, plus Online and Cheque (the modes the Payment Collection follow-up already offers). */
export type PaymentMode = 'neft' | 'upi' | 'rtgs' | 'cash' | 'cards' | 'online' | 'cheque'
export const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'neft', label: 'NEFT' },
  { value: 'upi', label: 'UPI' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'cash', label: 'Cash' },
  { value: 'cards', label: 'Cards' },
  { value: 'online', label: 'Online' },
  { value: 'cheque', label: 'Cheque' },
]
export const modeLabel = (m: string | null) => PAYMENT_MODES.find((x) => x.value === m)?.label ?? ''

/** Where the money stands on an invoice: nothing collected, part paid (for example 40 of 100) or fully paid. */
export type PaymentState = 'unpaid' | 'part' | 'paid' | 'none'
export function paymentState(inv: Pick<CommissionInvoiceRow, 'status' | 'paid_amount' | 'payment_pending'>): PaymentState {
  if (inv.status === 'cancelled') return 'none'
  const paid = Number(inv.paid_amount ?? 0)
  if (Number(inv.payment_pending ?? 0) <= 0) return 'paid'
  return paid > 0 ? 'part' : 'unpaid'
}
export const PAYMENT_STATES: Record<PaymentState, { label: string; chip: string }> = {
  unpaid: { label: 'Unpaid', chip: '' },
  part: { label: 'Part paid', chip: ' warn' },
  paid: { label: 'Paid', chip: ' good' },
  none: { label: '', chip: '' },
}

/** One receipt against an invoice (`commission_invoice_payments`). */
export interface CommissionPaymentRow {
  id: string
  invoice_id: string
  amount: number
  paid_on: string
  mode: PaymentMode | null
  reference: string | null
  note: string | null
  created_at: string
}

export const PARTY_TYPES: { value: PartyType; label: string }[] = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'supplier', label: 'Supplier' },
]
export const partyLabel = (t: string | null) => PARTY_TYPES.find((p) => p.value === t)?.label ?? '—'

/** A row of `commission_invoices`. Old one-per-order invoices have `is_legacy` and no party. */
export interface CommissionInvoiceRow {
  id: string
  invoice_no: string | null
  invoice_date: string
  company_id: string
  buyer_id: string | null
  supplier_id: string | null
  order_id: string | null
  party_type: PartyType | null
  period_from: string | null
  period_to: string | null
  commission_basis: 'pct' | 'per_kg' | 'per_bag' | null
  commission_value: number | null
  total_bags: number | null
  commission_total: number | null
  add_amount: number
  deduct_amount: number
  tds_amount: number
  round_off: number
  net_amount: number | null
  amount: number
  party_note: string | null
  remarks: string | null
  document_no: string | null
  status: InvoiceStatus
  pdf_path: string | null
  sent_at: string | null
  payment_mode: PaymentMode | null
  paid_amount: number
  payment_pending: number
  cancelled_at: string | null
  cancel_reason: string | null
  is_legacy: boolean
  created_by: string | null
  created_at: string
}

export interface CommissionLineRow {
  id: string
  invoice_id: string
  dispatch_id: string
  order_id: string
  sr_no: number
  counterparty: string | null
  count_label: string | null
  invoice_no: string | null
  invoice_date: string | null
  quantity: number
  uom: string | null
  total_weight: number | null
  value: number | null
  basis: 'pct' | 'per_kg' | 'per_bag' | null
  rate: number | null
  amount: number
  active: boolean
}

/** What `commission_candidate_lines` returns: a dispatch line that can still be billed to the party. */
export interface CandidateLine {
  dispatch_id: string
  order_id: string
  order_no: string
  party_id: string
  party_name: string | null
  counterparty: string | null
  count_label: string | null
  invoice_no: string | null
  invoice_date: string | null
  quantity: number
  uom: string | null
  total_weight: number | null
  value: number | null
  basis: 'pct' | 'per_kg' | 'per_bag' | null
  rate: number | null
  amount: number
}

/** A party of the Business Unit that still has dispatch lines to bill (`commission_billable_parties`). */
export interface BillableParty {
  party_id: string
  party_name: string | null
  lines: number
  first_date: string | null
  last_date: string | null
}

/** Two decimals, Indian digit grouping: 1,23,456.50 */
export const money = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Quantities show whole numbers plain and keep up to 2 decimals otherwise. */
export const qtyText = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })

/** The rate wording after "Being Commission for the goods despatched from X to Y" (monday's suffix). */
export function rateSuffix(basis: string | null, value: number | null): string {
  if (!basis || value === null || value === undefined) return ''
  if (basis === 'pct') return ` @ ${value}%`
  if (basis === 'per_bag') return ` @ Rs. ${value}/Bags`
  if (basis === 'per_kg') return ` @ Rs. ${value}/KG`
  return ''
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
  'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function below100(n: number): string {
  if (n < 20) return ONES[n] ?? ''
  return (TENS[Math.floor(n / 10)] ?? '') + (n % 10 ? ' ' + (ONES[n % 10] ?? '') : '')
}
function below1000(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  return [h ? (ONES[h] ?? '') + ' Hundred' : '', r ? below100(r) : ''].filter(Boolean).join(' ')
}
/** Whole number in the Indian system (Crore, Lakh, Thousand, Hundred). */
function wholeInWords(n: number): string {
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 10000000); n %= 10000000
  const lakh = Math.floor(n / 100000); n %= 100000
  const thousand = Math.floor(n / 1000); n %= 1000
  if (crore) parts.push(wholeInWords(crore) + ' Crore')
  if (lakh) parts.push(below100(lakh) + ' Lakh')
  if (thousand) parts.push(below100(thousand) + ' Thousand')
  if (n) parts.push(below1000(n))
  return parts.join(' ')
}

/** 3005 -> "Three Thousand Five Rupees Only"; 1250.5 -> "One Thousand Two Hundred Fifty Rupees and Fifty Paise Only".
 *  The paise are taken from the amount in whole paise, so 9.999 can never print "100 Paise". */
export function amountInWords(amount: number): string {
  const paiseTotal = Math.round(Math.abs(amount) * 100)
  const rupees = Math.floor(paiseTotal / 100)
  const paise = paiseTotal % 100
  return `${wholeInWords(rupees)} Rupees${paise ? ` and ${below100(paise)} Paise` : ''} Only`
}

/** monday's static wording on the bill. */
export const BILL_TITLE = 'BROKERAGE BILL'
export const BILL_TERMS_HEADING = 'Terms and conditions on commission bills'
export const BILL_TERMS = [
  'i) Certified That The Particulars Given Above Are True And Correct. E & O.E',
  'ii) Subjected To Tirupur Jurisdiction',
  'iii) All Payments Above Rs 2000 Should Be Made By Ac Payee Cheque / Rtgs / Neft',
  'iv) Any Complaints With The Above Bill Should Be Made Within 15 Days From Date Of Invoice.',
  'v) After Payment Of Commission Amount - TDS Deducted Amount Should Notified To Our Office.',
]

/** "Quantity (Bags)" when every line is in bags, otherwise the unit that is shared, otherwise just "Quantity". */
export function quantityHeading(lines: { uom: string | null }[]): string {
  const units = [...new Set(lines.map((l) => (l.uom ?? '').toUpperCase()).filter(Boolean))]
  if (units.length !== 1) return 'Quantity'
  const u = units[0] ?? ''
  if (u === 'BAGS' || u === 'BAG') return 'Quantity (Bags)'
  if (u === 'KG') return 'Quantity (KG)'
  if (u === 'TONS') return 'Quantity (Tons)'
  return `Quantity (${u.charAt(0) + u.slice(1).toLowerCase()})`
}

/** The rate suffix for a saved invoice: the manual rate when there is one, otherwise the shared rate of all lines. */
export function invoiceRateSuffix(inv: Pick<CommissionInvoiceRow, 'commission_basis' | 'commission_value'>,
  lines: Pick<CommissionLineRow, 'basis' | 'rate'>[]): string {
  if (inv.commission_basis) return rateSuffix(inv.commission_basis, inv.commission_value)
  const first = lines[0]
  if (first && lines.every((l) => l.basis === first.basis && l.rate === first.rate)) return rateSuffix(first.basis, first.rate)
  return ''
}
