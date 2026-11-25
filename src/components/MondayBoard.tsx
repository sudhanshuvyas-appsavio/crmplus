/** A board shown as a table: every column, in monday's order, with search and
 *  refresh. Used by Transporter Type Details and Transport Invoice. The boards are the app's own copy of the monday boards
 *  (src/lib/boards.ts); monday itself is not connected. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from './Loading'
import { supabase, functionsUrl } from '../lib/supabase'
import { loadBoard } from '../lib/boards'

export interface Cell { text: string; ids?: string[] }
export interface Column { id: string; title: string; type: string; labels?: string[]; boardIds?: string[]; settings?: Record<string, unknown> }
export interface Item { id: string; name: string; created_at: string; values: Record<string, Cell> }
export interface Linked { id: string; name: string; values: Record<string, Cell> }
export interface BoardData { board: string; columns: Column[]; items: Item[]; linked: Record<string, Linked[]> }

/** The screen boards. */
export type BoardKey = 'ttd' | 'transport_invoice'

/** The monday-ttd Edge Function: only used now for the one-time copy of the
 *  boards from monday (action "snapshot", while a monday token is set). */
export async function mondayCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  let res: Response
  try {
    res = await fetch(`${functionsUrl}/monday-ttd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, ...payload }),
    })
  } catch {
    throw new Error('Cannot reach the server. Check your connection.')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export function MondayBoardPage({
  board,
  title,
  subtitle,
  action,
  tabs,
}: {
  board: BoardKey
  title: string
  subtitle: string
  /** Header button(s), given the loaded board and a reload function. */
  action?: (data: BoardData | null, reload: () => void) => ReactNode
  /** Extra views beside "Main table", as monday's board tabs. */
  tabs?: { label: string; render: (data: BoardData, reload: () => void) => ReactNode }[]
}) {
  const { canAny, me } = useAuth()
  const allowed = canAny('order.read', 'order.manage')
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const [tab, setTab] = useState(0)
  const [copying, setCopying] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      setData(await loadBoard(board))
      setLoadedAt(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the board')
    } finally {
      setLoading(false)
    }
  }, [board])

  /** One-time copy of the boards from monday (administrators, token set). */
  async function copyFromMonday() {
    setCopying('Copying the boards from monday… this can take a minute')
    try {
      const r = await mondayCall<{ boards: { board: string; items: number }[] }>('snapshot')
      setCopying(`Copied ${r.boards.length} boards: ${r.boards.map((b) => `${b.board} (${b.items})`).join(', ')}`)
      void load()
    } catch (e) {
      setCopying(e instanceof Error ? e.message : 'Copy failed')
    }
  }
  const notCopied = !!error && error.includes('has not been copied')

  useEffect(() => {
    if (allowed) void load()
  }, [load, allowed])

  if (!allowed) {
    return (
      <div className="card pad narrow-card">
        <h2 className="card-title">Not available to your account</h2>
        <p className="muted">This screen needs an order permission. An administrator can grant it under Users.</p>
      </div>
    )
  }

  const term = search.trim().toLowerCase()
  const rows = (data?.items ?? []).filter(
    (it) => !term || it.name.toLowerCase().includes(term) || Object.values(it.values).some((v) => v.text.toLowerCase().includes(term)),
  )

  return (
    <div className="ttd-page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="page-sub">{subtitle}</p>
        </div>
        {action?.(data, () => void load())}
      </header>

      {tabs && tabs.length > 0 && (
        <nav className="mb-tabs" aria-label="Views">
          {['Main table', ...tabs.map((t) => t.label)].map((label, i) => (
            <button key={label} type="button" className={i === tab ? 'mb-tab on' : 'mb-tab'} aria-current={i === tab} onClick={() => setTab(i)}>
              {label}
            </button>
          ))}
        </nav>
      )}

      {error && (
        <div className="alert">
          <span>{error}</span>
          <button className="btn ghost sm" type="button" onClick={() => void load()}>Try again</button>
          {notCopied && me?.is_admin && (
            <button className="btn primary sm" type="button" disabled={!!copying && copying.startsWith('Copying')} onClick={() => void copyFromMonday()}>
              Copy from monday
            </button>
          )}
        </div>
      )}
      {copying && <div className="notice small">{copying}</div>}

      {!data && !error ? (
        <Loading label="Loading" />
      ) : data && tab > 0 && tabs?.[tab - 1] ? (
        tabs[tab - 1]!.render(data, () => void load())
      ) : data ? (
        <>
          <div className="ttd-tools">
            <input
              className="toolbar-search"
              type="search"
              placeholder="Search rows"
              aria-label="Search rows"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="small muted">{rows.length} of {data.items.length} rows</span>
            <button className="btn ghost sm" type="button" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            {loadedAt && !loading && <span className="small muted">Updated {loadedAt.toLocaleTimeString()}</span>}
          </div>
          <BoardTable columns={data.columns} items={rows} />
        </>
      ) : null}
    </div>
  )
}

/** Board rows as a table: the given columns, in the given order. */
export function BoardTable({ columns, items }: { columns: Column[]; items: Item[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id}>{c.type === 'name' ? 'Item' : c.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td className="empty" colSpan={Math.max(columns.length, 1)}>No rows.</td>
            </tr>
          ) : (
            items.map((it) => (
              <tr key={it.id}>
                {columns.map((c) => (
                  <td key={c.id} className="ttd-cell">{c.type === 'name' ? it.name : it.values[c.id]?.text || '—'}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
