/** A board shown as a table: every column, with search and refresh. Used by
 *  Transporter Type Details and Transport Invoice. The data lives in the
 *  app's own database (src/lib/boards.ts); there is no monday connection. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from './Loading'
import { supabase } from '../lib/supabase'
import { loadBoard } from '../lib/boards'

export interface Cell { text: string; ids?: string[] }
export interface Column { id: string; title: string; type: string; labels?: string[]; boardIds?: string[]; settings?: Record<string, unknown> }
export interface Item { id: string; name: string; created_at: string; values: Record<string, Cell> }
export interface Linked { id: string; name: string; values: Record<string, Cell> }
export interface BoardData { board: string; columns: Column[]; items: Item[]; linked: Record<string, Linked[]> }

/** The screen boards. */
export type BoardKey = 'ttd' | 'transport_invoice'

export function MondayBoardPage({
  board,
  title,
  subtitle,
  action,
  tabs,
  headers,
  arrange,
}: {
  board: BoardKey
  title: string
  subtitle: string
  /** Header button(s), given the loaded board and a reload function. */
  action?: (data: BoardData | null, reload: () => void) => ReactNode
  /** Extra views beside "Main table", as monday's board tabs. */
  tabs?: { label: string; render: (data: BoardData, reload: () => void) => ReactNode }[]
  /** Table header labels to show instead of the column titles ("Item" is the name column). */
  headers?: Record<string, string>
  /** The main table's columns, rearranged or trimmed (default: the board's own order). */
  arrange?: (columns: Column[]) => Column[]
}) {
  const { canAny } = useAuth()
  const allowed = canAny('order.read', 'order.manage')
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const [tab, setTab] = useState(0)

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
        </div>
      )}

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
          <BoardTable columns={arrange ? arrange(data.columns) : data.columns} items={rows} boardId={(data as BoardData & { boardId?: string }).boardId} headers={headers} />
        </>
      ) : null}
    </div>
  )
}

/** A file column cell: one file icon per file; clicking downloads it from
 *  the app's storage (bucket "board-files"). */
function FileCell({ cell, boardId, itemId }: { cell: Cell | undefined; boardId?: string; itemId: string }) {
  const [busy, setBusy] = useState(false)
  const files = (cell?.text ?? '').split(', ').map((f) => f.trim()).filter(Boolean)
  if (files.length === 0) return <span className="muted">—</span>

  async function open(entry: string) {
    setBusy(true)
    try {
      // the stored path of an app file: remembered at upload, or found in its folder
      let path = (cell?.ids ?? []).find((p) => p.endsWith(`-${entry}`))
      if (!path && boardId) {
        const folder = `${boardId}/${itemId}`
        const { data } = await supabase.storage.from('board-files').list(folder)
        const hit = (data ?? []).find((f) => f.name.endsWith(`-${entry}`) || f.name === entry)
        if (hit) path = `${folder}/${hit.name}`
      }
      if (!path) throw new Error('not found')
      // a link that downloads the file (Content-Disposition: attachment) under its own name
      const { data, error } = await supabase.storage.from('board-files').createSignedUrl(path, 300, { download: entry })
      if (error || !data) throw new Error('no link')
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = entry
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      window.alert(`Could not open ${entry}.`)
    } finally {
      setBusy(false)
    }
  }

  const label = (entry: string) => entry

  return (
    <span className="file-cell">
      {files.map((f, i) => (
        <button key={`${f}-${i}`} type="button" className="file-chip" title={label(f)} aria-label={`Download ${label(f)}`} disabled={busy} onClick={() => void open(f)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4" /><path d="M9.5 12h5M9.5 15h5M9.5 18h3" /></svg>
        </button>
      ))}
    </span>
  )
}

/** Board rows as a table: the given columns, in the given order. */
export function BoardTable({ columns, items, boardId, headers }: { columns: Column[]; items: Item[]; boardId?: string; headers?: Record<string, string> }) {
  const head = (c: Column) => {
    const t = c.type === 'name' ? 'Item' : c.title
    return headers?.[t] ?? t
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id}>{head(c)}</th>
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
                  <td key={c.id} className="ttd-cell">
                    {c.type === 'name' ? it.name : c.type === 'file' ? <FileCell cell={it.values[c.id]} boardId={boardId} itemId={it.id} /> : it.values[c.id]?.text || '—'}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
