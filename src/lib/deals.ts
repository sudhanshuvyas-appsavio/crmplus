/** Deal pipeline, units and commission rules, as on the monday.com "Deals"
 *  board. The maths mirror the database functions trade_total_weight and
 *  trade_commission (migration 20261117150000), so a preview in the browser
 *  matches what is stored. */

export type DealStatus = 'new_deal' | 'manager_approval' | 'approved' | 'reconsider' | 'closed_lost'

/** `tone` picks the status colour token (see .status-pill in index.css). */
export const DEAL_STATUSES: { value: DealStatus; label: string; tone: string }[] = [
  { value: 'new_deal', label: 'Draft', tone: 'blue' },
  { value: 'manager_approval', label: 'Manager Approval', tone: 'orange' },
  { value: 'approved', label: 'Approved', tone: 'green' },
  { value: 'reconsider', label: 'Reconsider', tone: 'purple' },
  { value: 'closed_lost', label: 'Closed Lost', tone: 'red' },
]

export const dealStatus = (s: string) => DEAL_STATUSES.find((x) => x.value === s) ?? { value: s as DealStatus, label: s, tone: 'grey' }

export const UOMS: { value: string; label: string }[] = [
  { value: 'KG', label: 'KGs' },
  { value: 'BAGS', label: 'Bags' },
  { value: 'HANKS', label: 'Hanks' },
  { value: 'BALES', label: 'Bales' },
  { value: 'CARTON', label: 'Carton' },
  { value: 'CHIPPA', label: 'Chippa' },
  { value: 'METERS', label: 'Meters' },
  { value: 'TONS', label: 'Tons' },
]
export const uomLabel = (u: string) => UOMS.find((x) => x.value === u)?.label ?? u
/** Units whose weight comes from the per-unit (bag) weight. */
export const needsUnitWeight = (uom: string) => uom !== 'KG' && uom !== 'TONS'

export type CommBasis = 'pct' | 'per_kg' | 'per_bag'
export const COMM_BASES: { value: CommBasis; label: string; short: string }[] = [
  { value: 'pct', label: 'Percentage', short: '%' },
  { value: 'per_kg', label: 'KG', short: '/kg' },
  { value: 'per_bag', label: 'BAG', short: '/bag' },
]
export const commTerms = (basis: string | null, value: number | null) => {
  if (!basis || value === null) return '—'
  if (basis === 'pct') return `${value}%`
  return `₹${value}${basis === 'per_kg' ? '/kg' : '/bag'}`
}

/** Total Weight in kg. KG and Tons are weights already (Tons x 1000), so their bag weight is information only;
 *  other units (Bags, Hanks, Cartons ...) are Quantity x Bag Weight. Same rule as the database's trade_total_weight. */
export function totalWeight(uom: string, qty: number | null, unitWeight: number | null): number | null {
  if (qty === null) return null
  if (uom === 'KG') return qty
  if (uom === 'TONS') return qty * 1000
  if (unitWeight !== null) return qty * unitWeight
  return null
}

export function commission(basis: string | null, value: number | null, amount: number | null, uom: string,
  qty: number | null, weight: number | null, unitWeight: number | null): number | null {
  if (!basis || value === null) return null
  if (basis === 'pct') return amount === null ? null : (amount * value) / 100
  if (basis === 'per_kg') return weight === null ? null : value * weight
  if (basis === 'per_bag') {
    // KG / Tons rows count the bags (weight / bag weight); other units are already counted per unit
    if (uom === 'KG' || uom === 'TONS') return weight === null || !unitWeight || unitWeight <= 0 ? null : (value * weight) / unitWeight
    return qty === null ? null : value * qty
  }
  return null
}

/* ---- Sales Confirmation (monday "Sales Confirmation" board) ---- */
export const SC_STAGES: { value: string; label: string; tone: string }[] = [
  { value: 'draft', label: 'Draft', tone: 'grey' },
  { value: 'send', label: 'Send', tone: 'blue' },
  { value: 'send_delivery', label: 'Send with Delivery Info', tone: 'green' },
  { value: 'cancelled', label: 'Cancelled', tone: 'red' },
]
/** Board group of a confirmation: cancelled ones get their own group. */
export const scGroup = (sc: { status: string; stage: string }) => (sc.status === 'cancelled' ? 'cancelled' : sc.stage)
export const scStage = (v: string) => SC_STAGES.find((x) => x.value === v) ?? { value: v, label: v, tone: 'grey' }

export const SALE_TYPES = [
  { value: 'local', label: 'Local' },
  { value: 'export', label: 'Export' },
] as const
export const saleTypeLabel = (v: string | null | undefined) => (v === 'export' ? 'Export' : 'Local')

/* ---- Dispatch and Billing (monday "Dispatch and Billing" board) ---- */
export const DISPATCH_STATUSES: { value: string; label: string; tone: string }[] = [
  { value: 'draft', label: 'Draft', tone: 'grey' },
  { value: 'in_progress', label: 'In Progress', tone: 'purple' },
  { value: 'partially_dispatched', label: 'Partially Dispatch', tone: 'green' },
  { value: 'fully_dispatched', label: 'Fully Dispatch', tone: 'blue' },
  { value: 'returned', label: 'Return', tone: 'red' },
  { value: 'cancelled', label: 'Cancel', tone: 'orange' },
]
/* Board groups, named as on the monday boards. A row's status decides its group. */
export const DEAL_GROUPS = DEAL_STATUSES.map((g) => (g.value === 'new_deal' ? { ...g, label: 'Draft' } : g))
export const SC_GROUPS = [
  { value: 'draft', label: 'New', tone: 'grey' },
  { value: 'send', label: 'Send', tone: 'blue' },
  { value: 'send_delivery', label: 'Send with Delivery Info.', tone: 'green' },
  { value: 'cancelled', label: 'Cancelled', tone: 'red', optional: true },
]
export const DNB_GROUPS = [
  { value: 'draft', label: 'Draft', tone: 'grey' },
  { value: 'in_progress', label: 'In Progress', tone: 'purple' },
  { value: 'fully_dispatched', label: 'Fully Dispatch', tone: 'blue' },
  { value: 'returned', label: 'Return', tone: 'red', optional: true },
  { value: 'cancelled', label: 'Cancel', tone: 'orange', optional: true },
]
/** monday keeps partly dispatched items in its In Progress group. */
export const dnbGroup = (o: { dispatch_status: string }) => (o.dispatch_status === 'partially_dispatched' ? 'in_progress' : o.dispatch_status)
export const dispatchStatus = (v: string) => DISPATCH_STATUSES.find((x) => x.value === v) ?? { value: v, label: v, tone: 'grey' }

export const TRANSPORT_TYPES = [
  { value: 'own', label: 'Own Transport' },
  { value: 'agreed_third_party', label: 'Agreed Third Party' },
  { value: 'third_party_direct', label: 'Third Party (Direct Payment by Party)' },
] as const
export const transportTypeLabel = (v: string | null | undefined) => TRANSPORT_TYPES.find((x) => x.value === v)?.label ?? '—'

/** monday: Value + Value x CGST% + Value x Insurance% + Add - Deduct */
export function totalAmount(value: number | null, cgst: number | null, ins: number | null, add: number | null, deduct: number | null): number | null {
  if (value === null) return null
  return value + (value * (cgst ?? 0)) / 100 + (value * (ins ?? 0)) / 100 + (add ?? 0) - (deduct ?? 0)
}

/** A rate per kg: up to 4 decimals, so 1.221 is not shown as 1.22 (amounts use inr and 2). */
export const rateText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 4 }))
export const inr = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits })
