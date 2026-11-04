/** The contacts (buyers and suppliers) that belong to a company, shown inside
 *  the company's drawer. A contact is a buyer record, a supplier record, or a
 *  pair of them sharing a PAN (role Both), exactly as on the Contacts screen. */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { errMessage } from '../lib/party'

type Row = { id: string; name: string; contact_person: string | null; mobile: string | null; email: string | null; pan: string; is_active: boolean }
type Entry = { key: string; name: string; role: 'Buyer' | 'Supplier' | 'Both'; person: string; mobile: string; email: string; active: boolean }

export function CompanyContacts({ companyId }: { companyId: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const cols = 'id,name,contact_person,mobile,email,pan,is_active'
      const [s, b] = await Promise.all([
        supabase.from('supplier_master').select(cols).eq('company_id', companyId),
        supabase.from('buyer_master').select(cols).eq('company_id', companyId),
      ])
      if (!live) return
      const err = s.error ?? b.error
      if (err) setError(errMessage(err, 'Could not load the contacts'))
      const sup = (s.data ?? []) as Row[]
      const buy = (b.data ?? []) as Row[]
      const usedBuyer = new Set<string>()
      const out: Entry[] = []
      for (const x of sup) {
        const pair = buy.find((y) => (x.pan ?? '') !== '' && (y.pan ?? '').toUpperCase() === (x.pan ?? '').toUpperCase())
        if (pair) usedBuyer.add(pair.id)
        out.push({
          key: x.id, name: x.name, role: pair ? 'Both' : 'Supplier', person: x.contact_person ?? '',
          mobile: x.mobile ?? pair?.mobile ?? '', email: x.email ?? pair?.email ?? '', active: x.is_active || Boolean(pair?.is_active),
        })
      }
      for (const y of buy) {
        if (usedBuyer.has(y.id)) continue
        out.push({ key: y.id, name: y.name, role: 'Buyer', person: y.contact_person ?? '', mobile: y.mobile ?? '', email: y.email ?? '', active: y.is_active })
      }
      setEntries(out.sort((p, q) => p.name.localeCompare(q.name)))
    })()
    return () => {
      live = false
    }
  }, [companyId])

  return (
    <section className="card pad" style={{ marginTop: 16 }}>
      <h3 className="card-title" style={{ marginTop: 0 }}>
        Contacts{entries ? ` (${entries.length})` : ''}
      </h3>
      {error && <p className="field-warn">{error}</p>}
      {entries && entries.length === 0 && (
        <p className="muted small">No contacts are linked to this company yet. Pick it in the Company field of a contact.</p>
      )}
      {entries && entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Role</th>
                <th>Person</th>
                <th>Mobile</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.key}>
                  <td>
                    <Link to={`/contacts?q=${encodeURIComponent(e.name)}`}>
                      <strong>{e.name}</strong>
                    </Link>
                    {e.email && <div className="small muted">{e.email}</div>}
                  </td>
                  <td>
                    <span className={e.role === 'Both' ? 'chip brand' : 'chip'}>{e.role}</span>
                  </td>
                  <td className="small">{e.person || '—'}</td>
                  <td className="mono small">{e.mobile || '—'}</td>
                  <td>{e.active ? <span className="chip good">Active</span> : <span className="chip bad">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}