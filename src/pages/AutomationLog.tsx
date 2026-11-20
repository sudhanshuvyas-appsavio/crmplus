/** Administration > Automation log: every run of the CRM automations (monday's automation run history),
 *  newest first, with what ran, on which record, and whether it was done, skipped or failed.
 *  Written by the database (automation_log); read-only here. */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Loading } from '../components/Loading'
import { StatusPill } from '../components/board/Board'
import { formatDateTime } from '../lib/format'
import { errMessage } from '../lib/party'

type Run = {
  id: number
  board: string
  rule: string
  entity_type: string | null
  entity_id: string | null
  entity_label: string | null
  state: 'done' | 'skipped' | 'failed'
  detail: string | null
  ran_at: string
}

const STATE_TONE: Record<Run['state'], string> = { done: 'green', skipped: 'grey', failed: 'red' }
const STATE_LABEL: Record<Run['state'], string> = { done: 'Done', skipped: 'Skipped', failed: 'Failed' }
const LINK: Record<string, string> = { lead: '/leads', deal: '/deals', sales_confirmation: '/sales-confirmations', order: '/orders' }

export default function AutomationLog() {
  const [rows, setRows] = useState<Run[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [board, setBoard] = useState('')
  const [state, setState] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let alive = true
    void supabase.from('automation_log').select('id,board,rule,entity_type,entity_id,entity_label,state,detail,ran_at')
      .order('ran_at', { ascending: false }).limit(500)
      .then(({ data, error: e }) => {
        if (!alive) return
        if (e) setError(errMessage(e, 'Could not load the automation log'))
        setRows((data ?? []) as Run[])
      })
    return () => { alive = false }
  }, [])

  const boards = useMemo(() => [...new Set((rows ?? []).map((r) => r.board))].sort(), [rows])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter((r) =>
      (!board || r.board === board) && (!state || r.state === state) &&
      (!q || r.rule.toLowerCase().includes(q) || (r.entity_label ?? '').toLowerCase().includes(q) || (r.detail ?? '').toLowerCase().includes(q)))
  }, [rows, board, state, search])

  if (!rows) return <Loading label="Loading the automation log" />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Automation log</h1>
          <p className="page-sub">Every run of the CRM automations: what ran, on which record, and how it went. The newest 500 runs.</p>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}
      <div className="board-toolbar">
        <input className="toolbar-search" aria-label="Search the log" placeholder="Search rule, record or detail" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Board" value={board} onChange={(e) => setBoard(e.target.value)}>
          <option value="">All boards</option>
          {boards.map((b) => (<option key={b} value={b}>{b}</option>))}
        </select>
        <select aria-label="Result" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">All results</option>
          <option value="done">Done</option>
          <option value="skipped">Skipped</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      {shown.length === 0 ? (
        <div className="card pad empty">{rows.length === 0 ? 'No automation has run yet.' : 'No run matches.'}</div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Board</th><th>Automation</th><th>Record</th><th>Result</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="small mono">{formatDateTime(r.ran_at)}</td>
                  <td className="small">{r.board}</td>
                  <td className="small">{r.rule}</td>
                  <td className="small">
                    {r.entity_id && r.entity_type && LINK[r.entity_type]
                      ? <Link className="mono" to={`${LINK[r.entity_type]}?open=${r.entity_id}`}>{r.entity_label ?? 'open'}</Link>
                      : <span className="mono">{r.entity_label ?? '—'}</span>}
                  </td>
                  <td><StatusPill label={STATE_LABEL[r.state]} tone={STATE_TONE[r.state]} /></td>
                  <td className="small muted">{r.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
