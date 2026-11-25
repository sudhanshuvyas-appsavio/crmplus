/** Read-only pieces shown inside the Sales Confirmation form: a party's contact card and the
 *  "no longer matches its Deal" check. */

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfileNames } from '../PartyExtras'
import { PartyCard } from '../PartyLookup'
import type { Party, ScRow } from './scShared'

/** A party's contact details, as monday's Sales Confirmation board mirrors them from Buyers & Suppliers. */
export function ScParty({ title, p, unit }: { title: string; p: Party; unit: { phone_1?: string | null; mobile?: string | null } | undefined }) {
  const unitPhone = unit?.phone_1 || unit?.mobile
  const names = useProfileNames()
  return (
    <PartyCard title={title} name={p.name} rows={[
      ['Messenger', p.messenger_id ? names[p.messenger_id] ?? null : null],
      ['Office address', p.address],
      ['Office phone', p.office_phone ? `+91 ${p.office_phone}` : null],
      ['GST', p.gst ? <span className="mono">{p.gst}</span> : null],
      ['Business unit phone', unitPhone ? (unitPhone.startsWith('+') ? unitPhone : `+91 ${unitPhone}`) : null],
    ]} />
  )
}

type LineKey = { count_id: string; quantity: number; uom: string; bag_weight: number | null; rate: number | null }

/** The deal a confirmation was copied from, and which terms no longer match it. */
export function useDealDiff(sc: ScRow | null): { dealNo: string | null; dealDiff: string[] } {
  const [state, setState] = useState<{ dealNo: string | null; dealDiff: string[] }>({ dealNo: null, dealDiff: [] })
  const id = sc?.id
  const dealId = sc?.deal_id
  useEffect(() => {
    if (!sc || !dealId) { setState({ dealNo: null, dealDiff: [] }); return }
    let alive = true
    void Promise.all([
      supabase.from('crm_deals').select('deal_no,buyer_id,supplier_id,payment_term_id,freight').eq('id', dealId).maybeSingle(),
      supabase.from('crm_deal_lines').select('count_id,quantity,uom,bag_weight,final_rate').eq('deal_id', dealId).order('line_no'),
      supabase.from('sc_lines').select('count_id,quantity,uom,bag_weight,rate').eq('sc_id', sc.id).order('line_no'),
    ]).then(([d, dl, sl]) => {
      if (!alive) return
      const deal = d.data as { deal_no: string; buyer_id: string | null; supplier_id: string | null; payment_term_id: string | null; freight: string | null } | null
      if (!deal) return setState({ dealNo: null, dealDiff: [] })
      // The confirmation is a copy taken when the deal was approved. Say which terms no longer match the deal.
      const diff: string[] = []
      if ((deal.buyer_id ?? null) !== (sc.buyer_id ?? null)) diff.push('Buyer')
      if ((deal.supplier_id ?? null) !== (sc.supplier_id ?? null)) diff.push('Supplier')
      if ((deal.payment_term_id ?? null) !== (sc.payment_term_id ?? null)) diff.push('Payment Terms')
      if ((deal.freight ?? null) !== (sc.freight ?? null)) diff.push('Freight')
      const key = (r: LineKey) =>
        `${r.count_id}|${Number(r.quantity)}|${r.uom}|${r.bag_weight === null ? '' : Number(r.bag_weight)}|${r.rate === null ? '' : Number(r.rate)}`
      const dealLines = ((dl.data ?? []) as (Omit<LineKey, 'rate'> & { final_rate: number | null })[]).map((r) => key({ ...r, rate: r.final_rate }))
      const scLines = ((sl.data ?? []) as LineKey[]).map(key)
      if (dealLines.length > 0 && scLines.length > 0 && dealLines.join(';') !== scLines.join(';')) diff.push('Counts, quantity or rate')
      setState({ dealNo: deal.deal_no, dealDiff: diff })
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, dealId, sc?.updated_at, sc?.buyer_id, sc?.supplier_id, sc?.payment_term_id, sc?.freight])
  return state
}
