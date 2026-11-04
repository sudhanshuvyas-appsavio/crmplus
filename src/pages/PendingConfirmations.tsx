/** Pending confirmations report.
 *
 *  Every deal that has not reached Confirmed yet, so a sales manager can chase
 *  it. Filters: buyer, supplier, date range (deal created), our company,
 *  count, and payment terms (Cash = 0 credit days, Credit = more than 0).
 *  Days pending = whole days since the deal was created. */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { CountRow, Deal, PaymentTerm } from '../api/types'
import { Loading } from '../components/Loading'
import { useProfileNames } from '../components/PartyExtras'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

type Named = { id: string; name: string }

const STAGE: Record<string, string> = {
  draft: 'Draft',
  rate_discussion: 'Rate Discussion',
  supplier_confirmed: 'Supplier Confirmed',
  buyer_confirmed: 'Buyer Confirmed',
  approved: 'Approved',
}

const CSV_COLUMNS = ['deal_no', 'stage', 'buyer', 'supplier', 'count', 'quantity', 'uom', 'buyer_rate', 'supplier_rate', 'payment_terms', 'payment_type', 'sales_staff', 'created', 'days_pending'] as const

const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }))
const termType = (t: PaymentTerm | undefined) => (!t ? 'Not set' : t.days > 0 ? 'Credit' : 'Cash')
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))

export default function PendingConfirmations() {
  const names = useProfileNames()
  const [deals, setDeals] = useState<Deal[] | null>(null)
  const [buyers, setBuyers] = useState<Named[]>([])
  const [suppliers, setSuppliers] = useState<Named[]>([])
  const [companies, setCompanies] = useState<Named[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fBuyer, setFBuyer] = useState('')
  const [fSupplier, setFSupplier] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fCount, setFCount] = useState('')
  const [fTerms, setFTerms] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    void (async () => {
      const [d, b, s, c, k, t] = await Promise.all([
        supabase.from('crm_deals').select('*').neq('status', 'confirmed').order('created_at'),
        supabase.from('buyer_master').select('id,name').order('name'),
        supabase.from('supplier_master').select('id,name').order('name'),
        supabase.from('companies').select('id,name').order('name'),
        supabase.from('count_master').select('*'),
        supabase.from('payment_terms').select('*'),
      ])
      if (d.error) setError(errMessage(d.error, 'Could not load the report'))
      setDeals((d.data ?? []) as Deal[])
      setBuyers((b.data ?? []) as Named[])
      setSuppliers((s.data ?? []) as Named[])
      setCompanies((c.data ?? []) as Named[])
      setCounts((k.data ?? []) as CountRow[])
      setTerms((t.data ?? []) as PaymentTerm[])
    })()
  }, [])

  const nm = (list: Named[], id: string | null) => (id ? list.find((x) => x.id === id)?.name ?? '—' : '—')
  const countName = useMemo(() => new Map(counts.map((x) => [x.id, x.display_name])), [counts])
  const termOf = (id: string | null) => terms.find((t) => t.id === id)

  const rows = useMemo(() => {
    return (deals ?? [])
      .filter((x) => {
        if (fBuyer && x.buyer_id !== fBuyer) return false
        if (fSupplier && x.supplier_id !== fSupplier) return false
        if (fCompany && x.company_id !== fCompany) return false
        if (fCount && x.count_id !== fCount) return false
        if (fTerms && termType(termOf(x.payment_term_id)) !== fTerms) return false
        const day = x.created_at.slice(0, 10)
        if (from && day < from) return false
        if (to && day > to) return false
        return true
      })
      .map((x) => ({ deal: x, days: daysSince(x.created_at) }))
      .sort((a, b) => b.days - a.days)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, fBuyer, fSupplier, fCompany, fCount, fTerms, from, to, terms])

  function exportCSV() {
    const list = rows.map(({ deal: x, days }) => {
      const t = termOf(x.payment_term_id)
      return {
        deal_no: x.deal_no, stage: STAGE[x.status] ?? x.status, buyer: nm(buyers, x.buyer_id), supplier: nm(suppliers, x.supplier_id),
        count: countName.get(x.count_id) ?? '', quantity: x.quantity, uom: x.uom, buyer_rate: x.buyer_rate ?? '', supplier_rate: x.supplier_rate ?? '',
        payment_terms: t?.name ?? '', payment_type: termType(t), sales_staff: (x.owner_id && names[x.owner_id]) || '',
        created: x.created_at.slice(0, 10), days_pending: days,
      }
    })
    downloadCSV(`pending-confirmations-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  function clear() {
    setFBuyer(''); setFSupplier(''); setFCompany(''); setFCount(''); setFTerms(''); setFrom(''); setTo('')
  }

  if (!deals) return <Loading label="Loading pending confirmations" />
  const filtered = fBuyer || fSupplier || fCompany || fCount || fTerms || from || to

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Pending confirmations</h1>
          <p className="page-sub">Deals that are not confirmed yet, oldest first. Open a deal to follow it up.</p>
        </div>
        <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
      </header>
      {error && <div className="alert">{error}</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><select aria-label="Buyer" value={fBuyer} onChange={(e) => setFBuyer(e.target.value)}><option value="">All buyers</option>{buyers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Supplier" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}><option value="">All suppliers</option>{suppliers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Company" value={fCompany} onChange={(e) => setFCompany(e.target.value)}><option value="">All companies</option>{companies.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Count" value={fCount} onChange={(e) => setFCount(e.target.value)}><option value="">All counts</option>{counts.map((x) => (<option key={x.id} value={x.id}>{x.display_name}</option>))}</select></div>
        <div className="field"><select aria-label="Payment terms" value={fTerms} onChange={(e) => setFTerms(e.target.value)}><option value="">Cash and credit</option><option value="Cash">Cash</option><option value="Credit">Credit</option></select></div>
        <div className="field"><input aria-label="Created from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Deal created from" /></div>
        <div className="field"><input aria-label="Created to" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Deal created to" /></div>
        {filtered && <div className="field"><button className="btn ghost" type="button" onClick={clear}>Clear filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{deals.length === 0 ? 'Nothing is pending: every deal is confirmed.' : 'No pending deal matches these filters.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Deal no.</th><th>Stage</th><th>Buyer</th><th>Supplier</th><th>Count</th><th className="right">Quantity</th>
                <th className="right">Buyer rate</th><th className="right">Supplier rate</th><th>Payment terms</th><th>Sales staff</th><th className="right">Days pending</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ deal: x, days }) => {
                const t = termOf(x.payment_term_id)
                return (
                  <tr key={x.id}>
                    <td className="mono"><Link to={`/deals?open=${x.id}`}>{x.deal_no}</Link></td>
                    <td><span className="chip warn">{STAGE[x.status] ?? x.status}</span></td>
                    <td>{nm(buyers, x.buyer_id)}</td>
                    <td>{nm(suppliers, x.supplier_id)}</td>
                    <td className="small">{countName.get(x.count_id) ?? '—'}</td>
                    <td className="right mono">{money(x.quantity)} {x.uom}</td>
                    <td className="right mono">{money(x.buyer_rate)}</td>
                    <td className="right mono">{money(x.supplier_rate)}</td>
                    <td className="small">{t ? `${t.name} · ${termType(t)}` : '—'}</td>
                    <td className="small">{(x.owner_id && names[x.owner_id]) || '—'}</td>
                    <td className="right mono"><strong>{days}</strong></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}