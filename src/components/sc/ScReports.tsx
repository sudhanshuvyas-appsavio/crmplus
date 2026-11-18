/** Reports tab of the Sales Confirmation board, as on monday.com: four charts of the confirmations
 *  that are still pending (Draft), counted by buyer, supplier, payment term and count. Clicking a
 *  bar filters the main table to that name. */

import type { ScRow } from './scShared'
import { scGroup } from '../../lib/deals'
import { ChartCard, RankedBars, tally, type BarDatum } from '../board/RankedBars'

type Line = { count_id: string }

export function ScReports({ rows, lines, buyerName, supplierName, countName, termName, onPick }: {
  rows: ScRow[]
  lines: Map<string, Line[]>
  buyerName: Map<string, string>
  supplierName: Map<string, string>
  countName: Map<string, string>
  termName: Map<string, string>
  /** Open the main table filtered to this name. */
  onPick: (search: string) => void
}) {
  // pending = still in Draft (not sent yet) and not cancelled
  const pending = rows.filter((x) => scGroup(x) === 'draft')

  const toBars = (counts: Map<string, number>, none: string): BarDatum[] =>
    [...counts].map(([label, value]) => ({ label, value, onPick: label === none ? undefined : () => onPick(label) }))

  const byBuyer = tally(pending, (x) => [(x.buyer_id && buyerName.get(x.buyer_id)) || 'No buyer'])
  const bySupplier = tally(pending, (x) => [(x.supplier_id && supplierName.get(x.supplier_id)) || 'No supplier'])
  const byTerm = tally(pending, (x) => [(x.payment_term_id && termName.get(x.payment_term_id)) || 'No payment term'])
  const byCount = tally(pending, (x) => {
    const own = lines.get(x.id) ?? []
    const ids = own.length > 0 ? own.map((l) => l.count_id) : x.count_id ? [x.count_id] : []
    const names = ids.map((id) => countName.get(id)).filter((n): n is string => !!n)
    return names.length > 0 ? names : ['No count']
  })

  const subtitle = `${pending.length} pending (Draft) confirmation${pending.length === 1 ? '' : 's'}`
  const empty = 'No pending confirmations: everything has been sent.'

  return (
    <div className="viz-grid">
      <ChartCard title="Buyer Wise Pending Sales" subtitle={subtitle}>
        <RankedBars data={toBars(byBuyer, 'No buyer')} unit="confirmation" emptyText={empty} />
      </ChartCard>
      <ChartCard title="Supplier Wise Pending Sales" subtitle={subtitle}>
        <RankedBars data={toBars(bySupplier, 'No supplier')} unit="confirmation" emptyText={empty} />
      </ChartCard>
      <ChartCard title="Payment Term Wise Pending Sales" subtitle={subtitle}>
        <RankedBars data={toBars(byTerm, 'No payment term')} unit="confirmation" emptyText={empty} />
      </ChartCard>
      <ChartCard title="Count Wise Pending Sales" subtitle="a confirmation with several counts is counted under each">
        <RankedBars data={toBars(byCount, 'No count')} unit="confirmation" emptyText={empty} />
      </ChartCard>
    </div>
  )
}
