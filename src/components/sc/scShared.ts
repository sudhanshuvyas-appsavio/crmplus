/** Shared types and the confirmation message text for the sales confirmation screens. */

import type { SalesConfirmation } from '../../api/types'
import { formatDateTime } from '../../lib/format'

/** Columns added to sales_confirmations after the first release (see the T-042 migration). */
export interface ScExtra {
  company_id: string | null
  buyer_rate: number | null
  supplier_rate: number | null
  commission_type: string | null
  commission_value: number | null
  price_basis: 'ex_mill' | 'net' | null
  delivery_schedule: string | null
  special_instructions: string | null
  created_by: string | null
}
export type ScRow = SalesConfirmation & ScExtra

export interface ScNotification {
  id: string
  sc_id: string
  party: 'supplier' | 'buyer'
  channel: 'whatsapp' | 'email'
  recipient: string | null
  sent_by: string | null
  sent_at: string
  delivery_status: 'opened' | 'sent' | 'failed'
  batch_id: string | null
}

export type Party = { id: string; name: string; mobile: string | null; email: string | null; company_id: string | null; is_active: boolean }
export type Company = { id: string; name: string; is_active: boolean }


export const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 }))

export type Names = {
  supplier: string
  buyer: string
  supplierCompany: string
  buyerCompany: string
  count: string
  term: string
}

/** The confirmation text shared with a party. Same sheet for both, different opening line. */
export function messageFor(who: 'supplier' | 'buyer', sc: ScRow, n: Names): { subject: string; body: string } {
  const lines = [
    who === 'supplier'
      ? `Sales confirmation on behalf of ${n.buyer}${n.buyerCompany ? ` (${n.buyerCompany})` : ''}`
      : `Your purchase has been confirmed with ${n.supplier}${n.supplierCompany ? ` (${n.supplierCompany})` : ''}`,
    '',
    `Confirmation no.: ${sc.sc_no}`,
    `Date and time: ${formatDateTime(sc.confirmed_at)}`,
    `Supplier: ${n.supplier}${n.supplierCompany ? ` (${n.supplierCompany})` : ''}`,
    `Buyer: ${n.buyer}${n.buyerCompany ? ` (${n.buyerCompany})` : ''}`,
    `Count: ${n.count}`,
    `Ex-mill quantity: ${num(sc.quantity)} ${sc.uom}`,
    `Net quantity: ${num(sc.net_quantity)} ${sc.uom}`,
  ]
  if (sc.bag_weight) lines.push(`Bag weight: ${num(sc.bag_weight)} kg`)
  lines.push(`Freight: ${sc.freight === 'included' ? 'Included' : 'Excluded'}`)
  if (sc.price_basis) lines.push(`Basis: ${sc.price_basis === 'net' ? 'Net' : 'Ex-mill'}`)
  if (sc.rate !== null) lines.push(`Rate: ${num(sc.rate)} per ${sc.uom}`)
  if (n.term) lines.push(`Payment terms: ${n.term}`)
  if (sc.delivery_schedule) lines.push(`Delivery schedule: ${sc.delivery_schedule}`)
  if (sc.special_instructions) lines.push(`Special instructions: ${sc.special_instructions}`)
  if (sc.remarks) lines.push(`Remarks: ${sc.remarks}`)
  return { subject: `Sales confirmation ${sc.sc_no}`, body: lines.join('\n') }
}
