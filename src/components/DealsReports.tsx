/** Reports tab of the Deals board. monday's Sales Report is mostly empty money widgets (it has no
 *  deal value); ours has the calculated value, so it shows the headline totals, how the deals are
 *  spread over the stages, and which buyers the approved value comes from. */

import type { Deal } from '../api/types'
import { DEAL_GROUPS, inr } from '../lib/deals'
import { ChartCard, RankedBars, StatTile, type BarDatum } from './board/RankedBars'

const money = (n: number) => `₹${inr(n, 0)}`
const sumValue = (list: Deal[]) => list.reduce((a, d) => a + (d.deal_value ?? 0), 0)

export function DealsReports({ deals, buyerName, onPick }: {
  deals: Deal[]
  buyerName: Map<string, string>
  onPick: (search: string) => void
}) {
  const approved = deals.filter((d) => d.status === 'approved')
  const open = deals.filter((d) => ['new_deal', 'manager_approval', 'reconsider'].includes(d.status))
  const lost = deals.filter((d) => d.status === 'closed_lost')

  const stageBars: BarDatum[] = DEAL_GROUPS.map((g) => ({ label: g.label, value: deals.filter((d) => d.status === g.value).length })).filter((b) => b.value > 0)

  const byBuyer = new Map<string, number>()
  for (const d of approved) {
    const name = (d.buyer_id && buyerName.get(d.buyer_id)) || 'No buyer'
    byBuyer.set(name, (byBuyer.get(name) ?? 0) + (d.deal_value ?? 0))
  }
  const buyerBars: BarDatum[] = [...byBuyer].map(([label, value]) => ({ label, value: Math.round(value), onPick: label === 'No buyer' ? undefined : () => onPick(label) }))

  return (
    <>
      <div className="stat-tiles">
        <StatTile label="Approved value" value={money(sumValue(approved))} note={`${approved.length} approved deal${approved.length === 1 ? '' : 's'}`} />
        <StatTile label="Open value" value={money(sumValue(open))} note={`${open.length} deal${open.length === 1 ? '' : 's'} not yet approved`} />
        <StatTile label="Deals" value={String(deals.length)} note={lost.length > 0 ? `${lost.length} closed lost` : 'none closed lost'} />
      </div>
      <div className="viz-grid">
        <ChartCard title="Deals stage distribution" subtitle={`${deals.length} deal${deals.length === 1 ? '' : 's'}`}>
          <RankedBars data={stageBars} unit="deal" emptyText="No deals yet." />
        </ChartCard>
        <ChartCard title="Approved value by buyer" subtitle="calculated deal value">
          <RankedBars data={buyerBars} unit="deal" format={money} emptyText="No approved deals yet." />
        </ChartCard>
      </div>
    </>
  )
}
