/** Festival / greeting mailing list (T-003 / T-004 "summary of names and
 *  addresses"). Suppliers and buyers in one table with type, state and category
 *  filters, exportable as CSV for a mail merge. It deliberately carries no
 *  MD contact numbers -- those sit behind their own permission. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Loading } from '../components/Loading'
import { errMessage } from '../lib/party'
import { downloadCSV, toCSV } from '../lib/csv'
import { CATEGORIES } from '../api/types'

type Row = { type: 'Supplier' | 'Buyer'; code: string; name: string; contact_person: string; address: string; state: string; category: string; is_active: boolean }

const COLUMNS = ['type', 'code', 'name', 'contact_person', 'address', 'state', 'category'] as const

export default function MailingList() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState('')
  const [state, setState] = useState('')
  const [category, setCategory] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)

  useEffect(() => {
    let live = true
    void (async () => {
      const [s, b] = await Promise.all([
        supabase.from('supplier_master').select('supplier_code,name,contact_person,address,state,category,is_active'),
        supabase.from('buyer_master').select('buyer_code,name,contact_person,address,state,category,is_active'),
      ])
      if (!live) return
      if (s.error && b.error) setError(errMessage(s.error, 'Could not load the lists'))
      const out: Row[] = []
      for (const r of (s.data ?? []) as Record<string, string | boolean | null>[]) {
        out.push({ type: 'Supplier', code: String(r.supplier_code), name: String(r.name), contact_person: String(r.contact_person ?? ''), address: String(r.address ?? ''), state: String(r.state ?? ''), category: String(r.category ?? ''), is_active: Boolean(r.is_active) })
      }
      for (const r of (b.data ?? []) as Record<string, string | boolean | null>[]) {
        out.push({ type: 'Buyer', code: String(r.buyer_code), name: String(r.name), contact_person: String(r.contact_person ?? ''), address: String(r.address ?? ''), state: String(r.state ?? ''), category: String(r.category ?? ''), is_active: Boolean(r.is_active) })
      }
      out.sort((x, y) => x.name.localeCompare(y.name))
      setRows(out)
    })()
    return () => {
      live = false
    }
  }, [])

  const states = useMemo(() => [...new Set((rows ?? []).map((r) => r.state).filter(Boolean))].sort(), [rows])
  const shown = useMemo(
    () =>
      (rows ?? []).filter(
        (r) => (!type || r.type === type) && (!state || r.state === state) && (!category || r.category === category) && (!activeOnly || r.is_active),
      ),
    [rows, type, state, category, activeOnly],
  )

  if (!rows) return <Loading label="Loading mailing list" />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Mailing list</h1>
          <p className="page-sub">Names and addresses of suppliers and buyers, for festival greetings and other mailings.</p>
        </div>
        <button className="btn primary" type="button" disabled={shown.length === 0} onClick={() => downloadCSV(`mailing-list-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(COLUMNS, shown))}>
          Export {shown.length} as CSV
        </button>
      </header>
      {error && <div className="alert">{error}</div>}
      <div className="drawer-actions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none', marginBottom: 12 }}>
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Suppliers and buyers</option>
          <option value="Supplier">Suppliers only</option>
          <option value="Buyer">Buyers only</option>
        </select>
        <select aria-label="State" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              Category {c}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          <span className="check-body">
            <span className="check-label">Active only</span>
          </span>
        </label>
      </div>
      {shown.length === 0 ? (
        <div className="card pad empty">Nobody matches those filters.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Name</th>
                <th>Contact person</th>
                <th>Address</th>
                <th>State</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.type}-${r.code}`}>
                  <td className="small">{r.type}</td>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td className="small">{r.contact_person}</td>
                  <td className="small">{r.address || '—'}</td>
                  <td className="small">{r.state}</td>
                  <td className="small">{r.category || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}