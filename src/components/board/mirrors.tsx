/** Party fields the CRM screens read from the Buyers & Suppliers master for
 *  their read-only lookups, and a small text cell for board tables. */

import type { ReactNode } from 'react'

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

/** A plain text cell; long text is clipped with the full value on hover. */
export function cell(v: string | number | null | undefined, opts: { mono?: boolean; clip?: boolean } = {}): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="muted small">—</span>
  const s = String(v)
  const cls = [opts.mono ? 'mono' : '', 'small', opts.clip ? 'cell-clip' : ''].filter(Boolean).join(' ')
  return <span className={cls} title={opts.clip ? s : undefined}>{s}</span>
}
