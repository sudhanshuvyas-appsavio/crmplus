/** The four "Reports" charts of monday's Cheque Collection board: Date Wise Collection, Party Wise Collection,
 *  Date Wise Deposited and Staff Wise Deposited. Each counts the cheques (and adds their amounts) by one
 *  column. Built from the cheques on screen, so they follow the table's search and filters. The widget
 *  filters monday's own charts carry were not readable, so these count every cheque shown. */

import { useMemo } from 'react'
import { formatDate } from '../../lib/format'
import { formatMoney } from '../../lib/tasks'
import type { TaskCheque } from '../../api/types'

type Row = TaskCheque & { buyer: { name: string } | null }

interface Bucket {
  label: string
  count: number
  amount: number
}

function group(rows: Row[], keyOf: (c: Row) => string | null, labelOf: (key: string) => string, sort: 'key' | 'amount'): Bucket[] {
  const map = new Map<string, Bucket>()
  for (const c of rows) {
    const key = keyOf(c)
    if (!key) continue
    const b = map.get(key) ?? { label: labelOf(key), count: 0, amount: 0 }
    b.count += 1
    b.amount += Number(c.amount)
    map.set(key, b)
  }
  const entries = [...map.entries()]
  entries.sort((a, b) => (sort === 'key' ? b[0].localeCompare(a[0]) : b[1].amount - a[1].amount))
  return entries.map(([, b]) => b)
}

function Chart({ title, note, buckets }: { title: string; note: string; buckets: Bucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.amount))
  return (
    <div className="td-section" style={{ flex: '1 1 320px' }}>
      <h3>{title}</h3>
      <p className="muted small">{note}</p>
      {buckets.length === 0 ? (
        <p className="td-empty">No results.</p>
      ) : (
        buckets.slice(0, 12).map((b) => (
          <div key={b.label} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 150px', gap: 8, alignItems: 'center', margin: '5px 0' }}>
            <span className="small" title={b.label}>{b.label}</span>
            <div style={{ height: 14, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${(b.amount / max) * 100}%`, height: '100%', background: '#16a34a' }} />
            </div>
            <span className="small mono">{b.count} · {formatMoney(b.amount)}</span>
          </div>
        ))
      )}
    </div>
  )
}

export function ChequeReport({ rows, names }: { rows: Row[]; names: Record<string, string> }) {
  const charts = useMemo(
    () => ({
      collected: group(rows, (c) => c.collection_date, (k) => formatDate(k), 'key'),
      party: group(rows, (c) => c.buyer_id, (k) => rows.find((c) => c.buyer_id === k)?.buyer?.name ?? 'Unknown', 'amount'),
      deposited: group(rows, (c) => c.deposited_on, (k) => formatDate(k), 'key'),
      staff: group(rows, (c) => c.deposited_by, (k) => names[k] ?? 'Unknown user', 'amount'),
    }),
    [rows, names],
  )
  if (rows.length === 0) return null
  return (
    <section className="md-pane tk-card" aria-label="Cheque reports">
      <div className="gk-head">
        <div className="gk-title">
          <h2>Reports</h2>
          <p>Count and amount of the cheques shown, as monday's Reports view does.</p>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '0 16px 16px' }}>
        <Chart title="Date Wise Collection" note="By collection date" buckets={charts.collected} />
        <Chart title="Party Wise Collection" note="By buyer" buckets={charts.party} />
        <Chart title="Date Wise Deposited" note="By deposit date" buckets={charts.deposited} />
        <Chart title="Staff Wise Deposited" note="By who deposited" buckets={charts.staff} />
      </div>
    </section>
  )
}
