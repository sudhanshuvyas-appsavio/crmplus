/** Reports tab of the Dispatch and Billing board, as on monday.com: items that are not fully
 *  dispatched yet, counted by buyer and by date. Clicking a bar filters the main table. */

import type { Order } from '../api/types'
import { ChartCard, RankedBars, type BarDatum } from './board/RankedBars'

export function DnbReports({ rows, buyerName, onPick }: {
  rows: Order[]
  buyerName: Map<string, string>
  onPick: (search: string) => void
}) {
  // pending = still to be dispatched: Draft, In Progress or Partially Dispatch (not Fully, Return or Cancel)
  const pending = rows.filter((x) => ['draft', 'in_progress', 'partially_dispatched'].includes(x.dispatch_status))

  const byBuyer = new Map<string, number>()
  for (const x of pending) {
    const name = buyerName.get(x.buyer_id) ?? 'No buyer'
    byBuyer.set(name, (byBuyer.get(name) ?? 0) + 1)
  }
  const buyerBars: BarDatum[] = [...byBuyer].map(([label, value]) => ({ label, value, onPick: label === 'No buyer' ? undefined : () => onPick(label) }))

  // by day the item was created, newest first
  const byDate = new Map<string, number>()
  for (const x of pending) byDate.set(x.order_date, (byDate.get(x.order_date) ?? 0) + 1)
  const dateBars: BarDatum[] = [...byDate].sort((a, b) => b[0].localeCompare(a[0])).map(([label, value]) => ({ label, value, onPick: () => onPick(label) }))

  const subtitle = `${pending.length} item${pending.length === 1 ? '' : 's'} not fully dispatched`
  const empty = 'Nothing pending: every item is fully dispatched.'
  return (
    <div className="viz-grid">
      <ChartCard title="Buyer Wise Pending Dispatches" subtitle={subtitle}>
        <RankedBars data={buyerBars} unit="item" emptyText={empty} />
      </ChartCard>
      <ChartCard title="Date Wise Pending Dispatches" subtitle="by the day the item was created">
        <RankedBars data={dateBars} unit="item" emptyText={empty} order="given" />
      </ChartCard>
    </div>
  )
}
