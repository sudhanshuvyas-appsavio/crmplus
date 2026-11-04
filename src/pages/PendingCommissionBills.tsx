/** Pending commission bills report.
 *
 *  Orders (Confirmed or Open for Execution) for which no commission invoice has
 *  been raised yet, so Finance can see revenue that is waiting to be billed.
 *  Filters: party (buyer), mill (supplier), order date range and our company.
 *  The list comes from the pending_commission_bills() database function. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Loading } from '../components/Loading'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

type Named = { id: string; name: string }
interface Row {
  order_id: string
  order_no: string
  order_date: string
  status: string
  buyer_id: string
  supplier_id: string
  company_id: string
  quantity: number
  uom: string
  commission_type: string | null
  commission_value: number | null
  commission_amount: number | null
  days_pending: number
}

const CSV_COLUMNS = ['order_no', 'order_date', 'status', 'company', 'buyer', 'supplier', 'quantity', 'uom', 'commission_type', 'commission_value', 'commission_amount', 'days_pending'] as const
const STATUS: Record<string, string> = { confirmed: 'Confirmed', open_for_execution: 'Open for Execution' }
const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }))

export default function PendingCommissionBills() {
  const [data, setData] = useState<Row[] | null>(null)
  const [buyers, setBuyers] = useState<Named[]>([])
  const [suppliers, setSuppliers] = useState<Named[]>([])
  const [companies, setCompanies] = useState<Named[]>([])
  const [error, setError] = useState<string | null>(null)
  const [fBuyer, setFBuyer] = useState('')
  const [fSupplier, setFSupplier] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    void (async () => {
      const [r, b, s, c] = await Promise.all([
        supabase.rpc('pending_commission_bills'),
        supabase.from('buyer_master').select('id,name').order('name'),
        supabase.from('supplier_master').select('id,name').order('name'),
        supabase.from('companies').select('id,name').order('name'),
      ])
      if (r.error) setError(errMessage(r.error, 'Could not load the report'))
      setData((r.data ?? []) as Row[])
      setBuyers((b.data ?? []) as Named[])
      setSuppliers((s.data ?? []) as Named[])
      setCompanies((c.data ?? []) as Named[])
    })()
  }, [])

  const nm = (list: Named[], id: string) => list.find((x) => x.id === id)?.name ?? '—'

  const rows = useMemo(
    () =>
      (data ?? []).filter((x) => {
        if (fBuyer && x.buyer_id !== fBuyer) return false
        if (fSupplier && x.supplier_id !== fSupplier) return false
        if (fCompany && x.company_id !== fCompany) return false
        if (from && x.order_date < from) return false
        if (to && x.order_date > to) return false
        return true
      }),
    [data, fBuyer, fSupplier, fCompany, from, to],
  )
  const total = rows.reduce((a, x) => a + Number(x.commission_amount ?? 0), 0)

  function exportCSV() {
    const list = rows.map((x) => ({
      order_no: x.order_no, order_date: x.order_date, status: STATUS[x.status] ?? x.status, company: nm(companies, x.company_id),
      buyer: nm(buyers, x.buyer_id), supplier: nm(suppliers, x.supplier_id), quantity: x.quantity, uom: x.uom,
      commission_type: x.commission_type ?? '', commission_value: x.commission_value ?? '', commission_amount: x.commission_amount ?? '', days_pending: x.days_pending,
    }))
    downloadCSV(`pending-commission-bills-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  function clear() {
    setFBuyer(''); setFSupplier(''); setFCompany(''); setFrom(''); setTo('')
  }

  if (!data) return <Loading label="Loading pending commission bills" />
  const filtered = fBuyer || fSupplier || fCompany || from || to

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Pending commission bills</h1>
          <p className="page-sub">Orders with no commission invoice raised yet, oldest first.{rows.length > 0 ? ` ${rows.length} order${rows.length === 1 ? '' : 's'}, commission ₹${money(total)} yet to be billed.` : ''}</p>
        </div>
        <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
      </header>
      {error && <div className="alert">{error}</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><select aria-label="Party (buyer)" value={fBuyer} onChange={(e) => setFBuyer(e.target.value)}><option value="">All parties</option>{buyers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Mill (supplier)" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)}><option value="">All mills</option>{suppliers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><select aria-label="Company" value={fCompany} onChange={(e) => setFCompany(e.target.value)}><option value="">All companies</option>{companies.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select></div>
        <div className="field"><input aria-label="Order date from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Order date from" /></div>
        <div className="field"><input aria-label="Order date to" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Order date to" /></div>
        {filtered && <div className="field"><button className="btn ghost" type="button" onClick={clear}>Clear filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{data.length === 0 ? 'No commission bills are pending.' : 'No pending commission bill matches these filters.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order no.</th><th>Order date</th><th>Status</th><th>Company</th><th>Buyer</th><th>Supplier</th>
                <th className="right">Quantity</th><th>Commission</th><th className="right">Amount to bill</th><th className="right">Days pending</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.order_id}>
                  <td className="mono">{x.order_no}</td>
                  <td className="mono small">{x.order_date}</td>
                  <td><span className="chip">{STATUS[x.status] ?? x.status}</span></td>
                  <td>{nm(companies, x.company_id)}</td>
                  <td>{nm(buyers, x.buyer_id)}</td>
                  <td>{nm(suppliers, x.supplier_id)}</td>
                  <td className="right mono">{money(x.quantity)} {x.uom}</td>
                  <td className="small">{x.commission_type ? `${x.commission_type}${x.commission_value !== null ? ` · ${money(x.commission_value)}` : ''}` : '—'}</td>
                  <td className="right mono"><strong>{money(x.commission_amount)}</strong></td>
                  <td className="right mono">{x.days_pending > 0 ? <span className="chip bad">{x.days_pending}</span> : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}