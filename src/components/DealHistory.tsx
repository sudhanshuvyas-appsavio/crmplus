/** A deal's change history, read-only. */
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { COMMISSION_TYPES, type DealChange } from '../api/types'
import { useProfileNames } from './PartyExtras'
import { formatDateTime } from '../lib/format'
import { commTerms, dealStatus } from '../lib/deals'

const CHANGE_LABEL: Record<string, string> = {
  final_rate: 'Final rate',
  buyer_commission: 'Buyer commission',
  supplier_commission: 'Supplier commission',
  freight: 'Freight',
  price_basis: 'Mode',
  location_text: 'Location',
  status: 'Status',
  // older entries
  buyer_rate: 'Buyer rate',
  supplier_rate: 'Supplier rate',
  commission_type: 'Commission type',
}

const OLD_STATUS: Record<string, string> = {
  draft: 'Draft', rate_discussion: 'Rate Discussion', supplier_confirmed: 'Supplier Confirmed', buyer_confirmed: 'Buyer Confirmed', confirmed: 'Confirmed',
}

function changeValue(field: string, v: string | null): string {
  if (v === null || v === '') return '—'
  if (field === 'status') return OLD_STATUS[v] ?? dealStatus(v).label
  if (field === 'price_basis') return v === 'ex_mill' ? 'Ex-Mill' : v === 'net' ? 'Net' : v
  if (field === 'freight') return v === 'included' ? 'Included' : v === 'excluded' ? 'Excluded' : v
  if (field === 'buyer_commission' || field === 'supplier_commission') {
    const [num, basis] = v.split(' ')
    return commTerms(basis ?? null, num ? Number(num) : null)
  }
  if (field === 'commission_type') return COMMISSION_TYPES.find((c) => c.value === v)?.label ?? v.replace(/_/g, ' ')
  return v
}

const HISTORY_SHOWN = 8

export function DealHistory({ dealId, refreshKey }: { dealId: string; refreshKey: string }) {
  const names = useProfileNames()
  const [rows, setRows] = useState<DealChange[] | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    let alive = true
    void supabase.from('deal_changes').select('*').eq('deal_id', dealId).order('changed_at', { ascending: false })
      .then(({ data }) => { if (alive) setRows((data ?? []) as DealChange[]) })
    return () => { alive = false }
  }, [dealId, refreshKey])
  return (
    <>
      <h3 className="section-title">History</h3>
      {rows === null ? (
        <p className="muted small">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">No changes recorded yet.</p>
      ) : (
        <ul className="history">
          {(all ? rows : rows.slice(0, HISTORY_SHOWN)).map((r) => (
            <li key={r.id}>
              <strong>{CHANGE_LABEL[r.field] ?? r.field}</strong>: {changeValue(r.field, r.old_value)} → {changeValue(r.field, r.new_value)}
              <div className="muted small">
                {formatDateTime(r.changed_at)}
                {r.changed_by ? ` · ${names[r.changed_by] ?? 'a user'}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length > HISTORY_SHOWN && (
        <button className="btn ghost sm" type="button" onClick={() => setAll(!all)}>
          {all ? 'Show the latest only' : `Show all ${rows.length} changes`}
        </button>
      )}
    </>
  )
}
