/** Monthly cheque deposited report.
 *
 *  Cheques that have been deposited, one row each: deposit date, the bank they
 *  were deposited into, the deposit slip number, the amount and the linked order.
 *  Defaults to the current month. Deposits are recorded on the Cheque collection
 *  screen ("Mark deposited"). Filters: deposit date range and deposit bank. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ChequeCollection, Order } from '../api/types'
import { Loading } from '../components/Loading'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

type Named = { id: string; name: string }

const CSV_COLUMNS = ['deposit_date', 'bank_name', 'slip_no', 'amount', 'linked_order', 'cheque_no', 'party'] as const
const money = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)) }

export default function ChequeDeposits() {
  const today = iso(new Date())
  const [cheques, setCheques] = useState<ChequeCollection[] | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [buyers, setBuyers] = useState<Named[]>([])
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today)
  const [fBank, setFBank] = useState('')

  useEffect(() => {
    void (async () => {
      const [c, o, b] = await Promise.all([
        supabase.from('cheque_collections').select('*').not('deposited_on', 'is', null).order('deposited_on', { ascending: false }),
        supabase.from('orders').select('*'),
        supabase.from('buyer_master').select('id,name'),
      ])
      if (c.error) setError(errMessage(c.error, 'Could not load the deposits'))
      setCheques((c.data ?? []) as ChequeCollection[])
      setOrders((o.data ?? []) as Order[])
      setBuyers((b.data ?? []) as Named[])
    })()
  }, [])

  const orderOf = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const banks = useMemo(() => [...new Set((cheques ?? []).map((x) => x.deposit_bank).filter((x): x is string => !!x))].sort(), [cheques])
  const rows = useMemo(
    () =>
      (cheques ?? []).filter((x) => {
        if (!x.deposited_on) return false
        if (from && x.deposited_on < from) return false
        if (to && x.deposited_on > to) return false
        if (fBank && x.deposit_bank !== fBank) return false
        return true
      }),
    [cheques, from, to, fBank],
  )
  const total = rows.reduce((a, x) => a + Number(x.amount), 0)
  const slips = new Set(rows.map((x) => `${x.deposit_bank}|${x.slip_no}`)).size
  const party = (x: ChequeCollection) => { const o = orderOf.get(x.order_id); return o ? buyers.find((b) => b.id === o.buyer_id)?.name ?? '' : '' }

  function exportCSV() {
    const list = rows.map((x) => ({
      deposit_date: x.deposited_on ?? '', bank_name: x.deposit_bank ?? '', slip_no: x.slip_no ?? '', amount: x.amount,
      linked_order: orderOf.get(x.order_id)?.order_no ?? '', cheque_no: x.cheque_no, party: party(x),
    }))
    downloadCSV(`cheque-deposited-${from}-to-${to}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!cheques) return <Loading label="Loading cheque deposits" />
  const changed = from !== monthStart() || to !== today || fBank

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Cheques deposited</h1>
          <p className="page-sub">
            Cheques deposited in the chosen dates (this month by default).{rows.length > 0 ? ` ${rows.length} cheque${rows.length === 1 ? '' : 's'} on ${slips} slip${slips === 1 ? '' : 's'}, ₹${money(total)}.` : ''}
          </p>
        </div>
        <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
      </header>
      {error && <div className="alert">{error}</div>}
      {from && to && from > to && <div className="alert">The start date must be on or before the end date.</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><input aria-label="Deposited from" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} title="Deposited from" /></div>
        <div className="field"><input aria-label="Deposited to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} title="Deposited to" /></div>
        <div className="field"><select aria-label="Bank" value={fBank} onChange={(e) => setFBank(e.target.value)}><option value="">All banks</option>{banks.map((b) => (<option key={b} value={b}>{b}</option>))}</select></div>
        {changed && <div className="field"><button className="btn ghost" type="button" onClick={() => { setFrom(monthStart()); setTo(today); setFBank('') }}>Reset filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{cheques.length === 0 ? 'No cheque has been deposited yet. Record deposits on the Cheque collection screen.' : 'No deposit matches these dates.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Deposit date</th><th>Bank name</th><th>Slip no.</th><th className="right">Amount</th><th>Linked order</th><th>Cheque no.</th><th>Party</th></tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td className="mono small">{x.deposited_on}</td>
                  <td>{x.deposit_bank ?? '—'}</td>
                  <td className="mono">{x.slip_no ?? '—'}</td>
                  <td className="right mono"><strong>{money(Number(x.amount))}</strong></td>
                  <td className="mono small">{orderOf.get(x.order_id)?.order_no ?? '—'}</td>
                  <td className="mono small">{x.cheque_no}</td>
                  <td>{party(x) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}