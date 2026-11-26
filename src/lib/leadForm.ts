/** The lead form's shape and rules, shared by the Create Lead pop-up and the lead drawer. */

import type { Lead, LeadRole } from '../api/types'
import { isGst, isMobile, numOrNull } from './party'

export type LeadForm = {
  lead_type: 'existing' | 'new'
  lead_source: string
  party_role: LeadRole
  party_name: string
  contact_person: string
  mobile_cc: string
  mobile: string
  station: string
  office_address: string
  gst: string
  buyer_id: string
  supplier_id: string
  count_id: string
  quantity: string
  uom: string
  expected_rate: string
  notes: string
  timeline: string
  timeline_from: string
  timeline_to: string
  remarks: string
  sales_staff_id: string
  /** datetime-local value (browser time), e.g. 2026-11-20T15:30 */
  follow_up_at: string
  entry_weaves_yarn: '' | 'yes' | 'no'
  entry_payment_cycle: string
  entry_current_supplier: string
  entry_price_range: string
  entry_next_purchase: string
}

/** ISO timestamp -> value for <input type="datetime-local"> in the browser's time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function leadToForm(lead: Lead): LeadForm {
  return {
    lead_type: lead.lead_type ?? (lead.buyer_id || lead.supplier_id ? 'existing' : 'new'),
    lead_source: lead.lead_source ?? '',
    party_role: lead.party_role,
    party_name: lead.party_name,
    contact_person: lead.contact_person ?? '',
    mobile_cc: lead.mobile_cc ?? '+91',
    mobile: lead.mobile ?? '',
    station: lead.station ?? '',
    office_address: lead.office_address ?? '',
    gst: lead.gst ?? '',
    buyer_id: lead.buyer_id ?? '',
    supplier_id: lead.supplier_id ?? '',
    count_id: lead.count_id ?? '',
    quantity: lead.quantity === null ? '' : String(lead.quantity),
    uom: lead.uom ?? '',
    expected_rate: lead.expected_rate === null ? '' : String(lead.expected_rate),
    notes: lead.notes ?? '',
    timeline: lead.timeline ?? '',
    timeline_from: lead.timeline_from ?? '',
    timeline_to: lead.timeline_to ?? '',
    remarks: lead.remarks ?? '',
    sales_staff_id: lead.sales_staff_id ?? '',
    follow_up_at: lead.follow_up_at ? toLocalInput(lead.follow_up_at) : lead.follow_up_date ? `${lead.follow_up_date}T10:00` : '',
    entry_weaves_yarn: lead.entry_weaves_yarn ?? '',
    entry_payment_cycle: lead.entry_payment_cycle ?? '',
    entry_current_supplier: lead.entry_current_supplier ?? '',
    entry_price_range: lead.entry_price_range ?? '',
    entry_next_purchase: lead.entry_next_purchase ?? '',
  }
}

export const phoneOk = (cc: string, n: string) => (cc === '+91' ? isMobile(n) : /^[0-9]{6,14}$/.test(n))

export function leadProblems(f: LeadForm): string[] {
  const out: string[] = []
  if (!f.party_name.trim()) out.push('Party name')
  if (f.lead_type === 'existing' && (f.party_role === 'buyer' || f.party_role === 'both') && !f.buyer_id) out.push('Buyer from Buyers & Suppliers')
  if (f.lead_type === 'existing' && (f.party_role === 'supplier' || f.party_role === 'both') && !f.supplier_id) out.push('Supplier from Buyers & Suppliers')
  if (!/^\+[0-9]{1,4}$/.test(f.mobile_cc)) out.push('Country code (like +91)')
  if (f.mobile.trim() && !phoneOk(f.mobile_cc, f.mobile)) out.push(f.mobile_cc === '+91' ? 'Mobile (10 digits, or leave blank)' : 'Mobile (6 to 14 digits)')
  if (f.gst.trim() && !isGst(f.gst)) out.push('GST (15-character format, or leave blank)')
  if (f.quantity.trim()) {
    const q = numOrNull(f.quantity)
    if (q === null || q <= 0) out.push('Quantity (more than zero)')
  }
  if (f.quantity.trim() && !f.uom) out.push('Unit of measure')
  if (f.timeline_from && f.timeline_to && f.timeline_to < f.timeline_from) out.push('Timeline: "to" on or after "from"')
  return out
}

export function leadPayload(form: LeadForm) {
  const existing = form.lead_type === 'existing'
  return {
    lead_type: form.lead_type,
    lead_source: form.lead_source.trim() || null,
    party_role: form.party_role,
    party_name: form.party_name.trim(),
    contact_person: form.contact_person.trim() || null,
    mobile_cc: form.mobile_cc,
    mobile: form.mobile.trim() || null,
    station: form.station.trim() || null,
    office_address: form.office_address.trim() || null,
    gst: form.gst.trim().toUpperCase() || null,
    ...(existing
      ? {
          buyer_id: form.party_role !== 'supplier' ? form.buyer_id || null : null,
          supplier_id: form.party_role !== 'buyer' ? form.supplier_id || null : null,
        }
      : {}),
    count_id: form.count_id || null,
    quantity: numOrNull(form.quantity),
    uom: form.uom || null,
    expected_rate: numOrNull(form.expected_rate),
    notes: form.notes.trim() || null,
    timeline: form.timeline.trim() || null,
    timeline_from: form.timeline_from || null,
    timeline_to: form.timeline_to || null,
    remarks: form.remarks.trim() || null,
    sales_staff_id: form.sales_staff_id || null,
    follow_up_at: form.follow_up_at ? new Date(form.follow_up_at).toISOString() : null,
    entry_weaves_yarn: form.entry_weaves_yarn || null,
    entry_payment_cycle: form.entry_weaves_yarn === 'yes' ? form.entry_payment_cycle || null : null,
    entry_current_supplier: form.entry_weaves_yarn === 'yes' ? form.entry_current_supplier.trim() || null : null,
    entry_price_range: form.entry_weaves_yarn === 'yes' ? form.entry_price_range.trim() || null : null,
    entry_next_purchase: form.entry_weaves_yarn === 'yes' ? form.entry_next_purchase || null : null,
  }
}
