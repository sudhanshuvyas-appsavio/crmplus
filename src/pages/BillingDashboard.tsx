/** Billing and dispatch dashboard.
 *
 *  Four tiles for the billing and transport desk: dispatch today, billing
 *  pending (mill invoice not recorded), commission pending (no commission
 *  invoice raised) and transport invoice pending (third-party freight bill not
 *  recorded). Each links to the screen that lists the detail. The figures come
 *  from billing_dispatch_dashboard(); dates use India time. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Loading } from '../components/Loading'
import { errMessage } from '../lib/party'

interface Dash {
  as_of: string
  dispatch_today: { dispatched_entries: number; dispatched_qty: number; scheduled_orders: number; scheduled_balance_qty: number }
  billing_pending: { pending: number; older_than_3_days: number; oldest_days: number }
  commission_pending: { pending: number; amount: number; older_than_7_days: number }
  transport_invoice_pending: { pending: number; freight_amount: number; older_than_7_days: number }
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

export default function BillingDashboard() {
  const [d, setD] = useState<Dash | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await supabase.rpc('billing_dispatch_dashboard')
    if (r.error) setError(errMessage(r.error, 'Could not load the dashboard'))
    else { setError(null); setD(r.data as Dash) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (!d && !error) return <Loading label="Loading dashboard" />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Billing and dispatch</h1>
          <p className="page-sub">What is moving and what is waiting to be billed{d ? ` (${d.as_of})` : ''}.</p>
        </div>
        <button className="btn" type="button" onClick={() => void load()}>Refresh</button>
      </header>
      {error && <div className="alert">{error}</div>}
      {d && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <Tile title="Dispatch today" value={String(d.dispatch_today.dispatched_entries)} to="/pending-dispatches" link="Open pending dispatches"
            sub={`${num(d.dispatch_today.dispatched_qty)} sent today. ${d.dispatch_today.scheduled_orders} order${d.dispatch_today.scheduled_orders === 1 ? '' : 's'} scheduled for today still have ${num(d.dispatch_today.scheduled_balance_qty)} to send.`} />
          <Tile title="Billing pending" value={String(d.billing_pending.pending)} to="/pending-documents" link="Open mill invoices and receipts"
            flag={d.billing_pending.older_than_3_days > 0 ? `${d.billing_pending.older_than_3_days} waiting over 3 days` : undefined}
            sub={d.billing_pending.pending === 0 ? 'Every dispatch has its mill invoice.' : `Dispatches with no mill invoice yet. Oldest waiting ${d.billing_pending.oldest_days} day${d.billing_pending.oldest_days === 1 ? '' : 's'}.`} />
          <Tile title="Commission pending" value={String(d.commission_pending.pending)} to="/pending-commission-bills" link="Open pending commission bills"
            flag={d.commission_pending.older_than_7_days > 0 ? `${d.commission_pending.older_than_7_days} older than 7 days` : undefined}
            sub={`Orders with no commission invoice. ₹${num(d.commission_pending.amount)} yet to be billed.`} />
          <Tile title="Transport invoice pending" value={String(d.transport_invoice_pending.pending)} to="/pending-transporter-invoices" link="Open transporter invoices"
            flag={d.transport_invoice_pending.older_than_7_days > 0 ? `${d.transport_invoice_pending.older_than_7_days} older than 7 days` : undefined}
            sub={`Third-party freight bills not received. Freight on these ₹${num(d.transport_invoice_pending.freight_amount)}.`} />
        </div>
      )}
    </>
  )
}