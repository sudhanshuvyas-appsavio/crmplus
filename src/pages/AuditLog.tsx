import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AuditRow } from '../api/types'
import { Loading } from '../components/Loading'
import { formatDateTime } from '../lib/format'

export default function AuditLog() {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [entity, setEntity] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      let query = supabase
        .from('audit_log')
        .select('id, at, actor_name, entity, entity_id, action, detail, ip')
        .order('at', { ascending: false })
        .limit(300)
      if (entity) query = query.eq('entity', entity)
      const { data } = await query
      if (!cancelled) setRows(data ?? [])
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [entity])

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="page-sub">
            Append-only. Nothing in the application updates or deletes a row.
          </p>
        </div>
        <select value={entity} onChange={(event) => setEntity(event.target.value)} aria-label="Filter">
          <option value="">Everything</option>
          <option value="deal">Deals</option>
          <option value="buyer">Buyers</option>
          <option value="mill">Mills</option>
          <option value="article_spec">Article specs</option>
          <option value="company">Companies</option>
          <option value="document">Documents</option>
        </select>
      </header>

      {!rows ? (
        <Loading label="Loading the log" />
      ) : rows.length === 0 ? (
        <div className="card pad empty">Nothing recorded yet.</div>
      ) : (
        <div className="card">
          <ul className="timeline">
            {rows.map((row) => (
              <li key={row.id}>
                <time className="mono small">{formatDateTime(row.at)}</time>
                <div>
                  <strong>{row.action}</strong>
                  <span className="chip">{row.entity}</span>
                  {row.detail && <div className="small muted">{row.detail}</div>}
                  <div className="small muted">
                    {row.actor_name ?? 'system'}
                    {row.ip && <span className="mono"> · {row.ip}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}