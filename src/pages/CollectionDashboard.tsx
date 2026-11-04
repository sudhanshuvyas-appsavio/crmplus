/** Collection dashboard.
 *
 *  Four views for the collection desk: total outstanding from buyers, today's
 *  collection, cheques collected but not yet deposited, and credit-days aging.
 *  Outstanding per order = goods dispatched at the buyer rate less buyer
 *  receipts. An order falls due its first dispatch date plus the credit days of
 *  its payment term; aging counts days past that date. Figures come from
 *  collection_dashboard(); dates use India time. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Loading } from '../components/Loading'
import { errMessage } from '../lib/party'

interface Dash {
  as_of: string
  outstanding: { orders: number; amount: number; overdue_amount: number }
  today: { receipts: number; receipts_amount: number; cheques_collected: number; cheques_amount: number }
  cheques_pending: { count: number; amount: number; oldest_days: number; older_than_3_days: number }
  aging: { label: string; orders: number; amount: number }[]
}

const num = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })

function Tile({ title, value, sub, to, link, flag }: { title: string; value: string; sub: ReactNode; to: string; link: string; flag?: string }) {
  return (
    <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="card-title" style={{ marginBottom: 0 }}>{title}</div>
      <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      {flag && <div><span className="chip bad">{flag}</span></div>}
      <div className="muted small">{sub}</div>
      <Link to={to} className="small">{link} →</Link>
    </div>
  )
}

export default function CollectionDashboard() {
  const [d, setD] = useState<Dash | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await supabase.rpc('collection_dashboard')
    if (r.error) setError(errMessage(r.error, 'Could not load the dashboard'))
    else { setError(null); setD(r.data as Dash) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (!d && !error) return <Loading label="Loading dashboard" />
  const max = d ? Math.max(1, ...d.aging.map((x) => x.amount)) : 1

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Collection</h1>
          <p className="page-sub">What buyers owe and what came in{d ? ` (${d.as_of})` : ''}.</p>
        </div>
        <button className="btn" type="button" onClick={() => void load()}>Refresh</button>
      </header>
      {error && <div className="alert">{error}</div>}
      {d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            <Tile title="Total outstanding" value={`₹${num(d.outstanding.amount)}`} to="/collection-tasks" link="Open collection tasks"
              flag={d.outstanding.overdue_amount > 0 ? `₹${num(d.outstanding.overdue_amount)} overdue` : undefined}
              sub={d.outstanding.orders === 0 ? 'Nothing is owed on dispatched goods.' : `Across ${d.outstanding.orders} order${d.outstanding.orders === 1 ? '' : 's'}, after buyer receipts.`} />
            <Tile title="Today's collection" value={`₹${num(d.today.receipts_amount)}`} to="/collection-activity" link="Open collection activity"
              sub={`${d.today.receipts} receipt${d.today.receipts === 1 ? '' : 's'} recorded. Cheques collected today: ${d.today.cheques_collected} (₹${num(d.today.cheques_amount)}).`} />
            <Tile title="Cheques pending deposit" value={String(d.cheques_pending.count)} to="/cheque-collections" link="Open cheque collection"
              flag={d.cheques_pending.older_than_3_days > 0 ? `${d.cheques_pending.older_than_3_days} held over 3 days` : undefined}
              sub={d.cheques_pending.count === 0 ? 'Every collected cheque is deposited.' : `₹${num(d.cheques_pending.amount)} in hand. Oldest ${d.cheques_pending.oldest_days} day${d.cheques_pending.oldest_days === 1 ? '' : 's'}.`} />
          </div>

          <div className="card pad" style={{ marginTop: 16 }}>
            <div className="card-title">Credit days aging</div>
            <div className="table-wrap"><table>
              <thead><tr><th>Bucket</th><th className="right">Orders</th><th className="right">Outstanding</th><th style={{ width: '40%' }} /></tr></thead>
              <tbody>{d.aging.map((x, i) => (
                <tr key={x.label}>
                  <td>{x.label}</td><td className="right mono">{x.orders}</td><td className="right mono">₹{num(x.amount)}</td>
                  <td><div style={{ height: 10, borderRadius: 5, width: `${(x.amount / max) * 100}%`, minWidth: x.amount > 0 ? 4 : 0, background: i === 0 ? 'var(--good, #2e7d32)' : i < 3 ? 'var(--warn, #b26a00)' : 'var(--bad, #c62828)' }} /></td>
                </tr>
              ))}</tbody>
            </table></div>
            <p className="muted small">Days are counted past the due date: first dispatch date plus the order's credit days.</p>
          </div>
        </>
      )}
    </>
  )
}