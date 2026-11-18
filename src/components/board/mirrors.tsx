/** monday "mirror" columns: read-only details of a linked Buyer or Supplier
 *  (from the party master), shown as table columns the way the monday CRM
 *  boards show them. Each board picks the mirrors monday has, in monday's order. */

import type { ReactNode } from 'react'
import type { BoardColumn } from './Board'

/** Every party field a mirror can show. Pages select these from buyer_master / supplier_master. */
export const MIRROR_PARTY_COLS =
  'id,name,is_active,company_id,gst,pan,email,mobile,contact_person,contact_1_email,contact_2_name,contact_2_mobile,contact_2_email,address,mill_address,office_phone,messenger_id,commission_basis,commission_value'

export interface MirrorParty {
  id: string
  name: string
  is_active: boolean
  company_id: string | null
  gst?: string | null
  pan?: string | null
  email?: string | null
  mobile?: string | null
  contact_person?: string | null
  contact_1_email?: string | null
  contact_2_name?: string | null
  contact_2_mobile?: string | null
  contact_2_email?: string | null
  address?: string | null
  mill_address?: string | null
  office_phone?: string | null
  messenger_id?: string | null
  commission_basis?: string | null
  commission_value?: number | null
}

export type MirrorCompany = { id: string; name: string; phone_1?: string | null; mobile?: string | null }

export type MirrorField =
  | 'messenger' | 'cp1' | 'cp1Phone' | 'cp1Email' | 'cp2' | 'cp2Phone' | 'cp2Email'
  | 'officeAddress' | 'millAddress' | 'officePhone' | 'gst' | 'pan' | 'email' | 'unit' | 'unitPhone'

const LABELS: Record<MirrorField, string> = {
  messenger: 'Messenger',
  cp1: 'Contact Person 1',
  cp1Phone: 'Contact Person 1 Phone',
  cp1Email: 'Contact Person 1 Email',
  cp2: 'Contact Person 2',
  cp2Phone: 'Contact Person 2 Phone',
  cp2Email: 'Contact Person 2 Email',
  officeAddress: 'Office Address',
  millAddress: 'Mill/Factory/Delivery Address',
  officePhone: 'Office Phone',
  gst: 'GST No.',
  pan: 'IT PAN',
  email: 'Email',
  unit: 'Business Unit',
  unitPhone: 'Business Unit Phone',
}

/** A plain text cell; long text is clipped with the full value on hover. */
export function cell(v: string | number | null | undefined, opts: { mono?: boolean; clip?: boolean } = {}): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="muted small">—</span>
  const s = String(v)
  const cls = [opts.mono ? 'mono' : '', 'small', opts.clip ? 'cell-clip' : ''].filter(Boolean).join(' ')
  return <span className={cls} title={opts.clip ? s : undefined}>{s}</span>
}

export function partyMirrors<T>(
  who: 'Buyer' | 'Supplier',
  party: (row: T) => MirrorParty | undefined,
  fields: MirrorField[],
  ctx: { people: Map<string, string>; companies: Map<string, MirrorCompany> },
): BoardColumn<T>[] {
  const value = (p: MirrorParty | undefined, f: MirrorField): ReactNode => {
    if (!p) return cell(null)
    const unit = p.company_id ? ctx.companies.get(p.company_id) : undefined
    switch (f) {
      case 'messenger': return cell(p.messenger_id ? ctx.people.get(p.messenger_id) : null)
      case 'cp1': return cell(p.contact_person)
      case 'cp1Phone': return cell(p.mobile, { mono: true })
      case 'cp1Email': return cell(p.contact_1_email)
      case 'cp2': return cell(p.contact_2_name)
      case 'cp2Phone': return cell(p.contact_2_mobile, { mono: true })
      case 'cp2Email': return cell(p.contact_2_email)
      case 'officeAddress': return cell(p.address, { clip: true })
      case 'millAddress': return cell(p.mill_address, { clip: true })
      case 'officePhone': return cell(p.office_phone, { mono: true })
      case 'gst': return cell(p.gst, { mono: true })
      case 'pan': return cell(p.pan, { mono: true })
      case 'email': return cell(p.email)
      case 'unit': return cell(unit?.name)
      case 'unitPhone': return cell(unit ? unit.phone_1 || unit.mobile : null, { mono: true })
    }
  }
  return fields.map((f) => ({
    key: `${who}-${f}`,
    label: `${who} ${LABELS[f]}`,
    render: (row: T) => value(party(row), f),
  }))
}
