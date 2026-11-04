/** Sales follow-up dashboard.
 *
 *  Four tiles for the sales desk: pending leads, pending confirmations,
 *  pending dispatch and revenue this month. Each tile shows only when the
 *  signed-in user may see that data (the sales_followup_dashboard() function
 *  returns just the allowed parts) and links to the screen that lists the
 *  detail. Revenue is commission invoiced this month (India time). */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Loading } from '../components/Loading'
import { errMessage } from '../lib/party'

interface Dash {
  as_of: string
  leads?: { pending: number; overdue_follow_up: number; new: number; no_follow_up_date: number }
  confirmations?: { pending: number; older_than_7_days: number; by_stage: Record<string, number> }
  dispatch?: { pending: number; overdue: number; balance_qty: number }
  revenue?: { this_month: number; last_month: number; invoices: number }
}

const STAGE: Record<string, string> = { draft: 'Draft', rate_discussion: 'Rate Discussion', supplier_confirmed: 'Supplier Confirmed', buyer_confirmed: 'Buyer Confirmed', approved: 'Approved' }
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

export default function SalesDashboard() {
  const [d, setD] = useState<Dash | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await supabase.rpc('sales_followup_dashboard')
    if (r.error) setError(errMessage(r.error, 'Could not load the dashboard'))
    else { setError(null); setD(r.data as Dash) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (!d && !error) return <Loading label="Loading dashboard" />
  const L = d?.leads, C = d?.confirmations, P = d?.dispatch, R = d?.revenue
  const none = d && !L && !C && !P && !R
  let delta: ReactNode = null
  if (R) {
    if (R.last_month > 0) {
      const pct = ((R.this_month - R.last_month) / R.last_month) * 100
      delta = <>{pct >= 0 ? '+' : ''}{pct.toFixed(0)}% vs last month (₹{num(R.last_month)})</>
    } else delta = <>No commission invoiced last month</>
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Sales follow-up</h1>
          <p className="page-sub">What needs chasing today{d ? ` (${d.as_of})` : ''}.</p>
        </div>
        <button className="btn" type="button" onClick={() => void load()}>Refresh</button>
      </header>
      {error && <div className="alert">{error}</div>}
      {none && <div className="card pad empty">Your account does not have access to any of these figures.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {L && <Tile title="Pending leads" value={String(L.pending)} to="/leads" link="Open leads"
          flag={L.overdue_follow_up > 0 ? `${L.overdue_follow_up} follow-up overdue` : undefined}
          sub={`${L.new} new, ${L.pending - L.new} contacted. ${L.no_follow_up_date} without a follow-up date.`} />}
        {C && <Tile title="Pending confirmations" value={String(C.pending)} to="/pending-confirmations" link="Open pending confirmations"
          flag={C.older_than_7_days > 0 ? `${C.older_than_7_days} older than 7 days` : undefined}
          sub={Object.keys(C.by_stage).length === 0 ? 'Every deal is confirmed.' : Object.entries(C.by_stage).map(([k, v]) => `${STAGE[k] ?? k} ${v}`).join(' · ')} />}
        {P && <Tile title="Pending dispatch" value={String(P.pending)} to="/pending-dispatches" link="Open pending dispatches"
          flag={P.overdue > 0 ? `${P.overdue} past dispatch date` : undefined}
          sub={`Orders with quantity still to send. Balance ${num(P.balance_qty)} in total.`} />}
        {R && <Tile title="Revenue this month" value={`₹${num(R.this_month)}`} to="/pending-commission-bills" link="Open pending commission bills"
          sub={<>{R.invoices} commission invoice{R.invoices === 1 ? '' : 's'}. {delta}</>} />}
      </div>
    </>
  )
}