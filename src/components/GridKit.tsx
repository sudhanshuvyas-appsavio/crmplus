/** The pieces every Master Data register grid shares, in the layout of the
 *  Pharma ERP's registers: a header with the title and record count on the left
 *  and the search, a Filter button and the register's own button on the right;
 *  an optional filter panel; the table; and a footer that says which rows are
 *  on screen and lets the person move between pages.
 *
 *  They carry no data of their own. A screen keeps its rows and its filtering
 *  and hands the rows to `usePaging`. */

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'

export const PAGE_SIZES = [10, 25, 50, 100] as const

export interface FilterDef {
  name: string
  label: string
  options: readonly { value: string; label: string }[]
  /** The "no filter" entry, e.g. "All zones". */
  allLabel?: string
}

/* ---- toolbar ------------------------------------------------------------- */

export function GridToolbar({
  title,
  subtitle,
  total,
  singular,
  plural,
  query,
  onQuery,
  searchPlaceholder,
  filters = [],
  values = {},
  onFilter,
  onClear,
  children,
}: {
  title: string
  /** One line under the title in place of the record count, when it says more. */
  subtitle?: string
  total: number
  singular: string
  plural: string
  query: string
  onQuery: (value: string) => void
  searchPlaceholder?: string
  filters?: readonly FilterDef[]
  values?: Record<string, string>
  onFilter?: (name: string, value: string) => void
  onClear?: () => void
  /** The register's own button (New …), placed after Filter. */
  children?: ReactNode
}) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const active = filters.filter((f) => (values[f.name] ?? '') !== '').length

  // A filter that is set must stay visible, or it narrows the list invisibly.
  useEffect(() => {
    if (active > 0) setOpen(true)
  }, [active])

  const placeholder = searchPlaceholder ?? `Search ${plural}…`

  return (
    <>
      <div className="gk-head">
        <div className="gk-title">
          <h2>{title}</h2>
          <p>{subtitle ?? `${total} ${total === 1 ? singular : plural}`}</p>
        </div>
        <div className="gk-controls">
          <input
            type="search"
            className="gk-search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={placeholder}
            title={placeholder}
            aria-label={`Search ${plural}`}
          />
          {filters.length > 0 && (
            <button
              type="button"
              className={`gk-filter${active > 0 ? ' on' : ''}`}
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={panelId}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h12l-4.5 5.5V13L6.5 11.5V8.5L2 3Z" />
              </svg>
              Filter
              {active > 0 && <span className="gk-count">{active}</span>}
            </button>
          )}
          {children}
        </div>
      </div>

      {filters.length > 0 && (
        <div id={panelId} className="gk-panel" hidden={!open}>
          <div className="gk-panel-grid">
            {filters.map((f) => (
              <label key={f.name} className="gk-filter-field">
                <span>{f.label}</span>
                <select value={values[f.name] ?? ''} onChange={(e) => onFilter?.(f.name, e.target.value)}>
                  <option value="">{f.allLabel ?? 'Any'}</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {active > 0 && onClear && (
            <div className="gk-panel-foot">
              <button type="button" className="gk-link" onClick={onClear}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/* ---- paging -------------------------------------------------------------- */

export interface PagingState<T> {
  /** The rows to draw on this page. */
  visible: T[]
  /** Spread onto <GridPager />. */
  pager: {
    page: number
    pageCount: number
    pageSize: number
    first: number
    last: number
    total: number
    onPage: (page: number) => void
    onPageSize: (size: number) => void
  }
}

/** Splits `rows` into pages. `resetKey` changes whenever the list is narrowed
 *  (search text, filters), which sends the reader back to page 1 instead of
 *  leaving them on a page that no longer exists. */
export function usePaging<T>(rows: readonly T[], resetKey = ''): PagingState<T> {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])

  useEffect(() => setPage(1), [resetKey])

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  // Clamped when read: deleting the last row of the last page shrinks the list
  // under the current page, and a page past the end looks like "nothing here".
  const current = Math.min(page, pageCount)
  const start = (current - 1) * pageSize
  const visible = useMemo(() => rows.slice(start, start + pageSize), [rows, start, pageSize])

  return {
    visible,
    pager: {
      page: current,
      pageCount,
      pageSize,
      first: rows.length === 0 ? 0 : start + 1,
      last: start + visible.length,
      total: rows.length,
      onPage: (next) => setPage(Math.min(Math.max(1, next), pageCount)),
      onPageSize: (size) => {
        setPageSize(size)
        setPage(1)
      },
    },
  }
}

/** The page numbers to show: the ends, the current page and its neighbours,
 *  with a gap marker (null) where pages are skipped. */
function pageNumbers(page: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const keep = new Set([1, 2, count - 1, count, page - 1, page, page + 1])
  const sorted = [...keep].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b)
  const out: (number | null)[] = []
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1]
    if (prev !== undefined && n - prev > 1) out.push(null)
    out.push(n)
  })
  return out
}

export function GridPager({
  page,
  pageCount,
  pageSize,
  first,
  last,
  total,
  singular,
  plural,
  onPage,
  onPageSize,
}: PagingState<unknown>['pager'] & { singular: string; plural: string }) {
  const sizeId = useId()
  return (
    <div className="gk-pager">
      <p aria-live="polite" className="gk-showing">
        {total === 0 ? (
          <>No {plural}</>
        ) : (
          <>
            Showing <b>{first}</b> to <b>{last}</b> of <b>{total}</b> {total === 1 ? singular : plural}
          </>
        )}
      </p>
      <div className="gk-pager-right">
        <label htmlFor={sizeId} className="gk-size">
          <span>Rows per page</span>
          <select id={sizeId} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {total > 0 && (
          <nav aria-label="Pagination" className="gk-pages">
            <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              Previous
            </button>
            {pageNumbers(page, pageCount).map((entry, i) =>
              entry === null ? (
                <span key={`gap-${i}`} aria-hidden="true" className="gk-gap">
                  …
                </span>
              ) : (
                <button
                  key={entry}
                  type="button"
                  onClick={() => onPage(entry)}
                  aria-current={entry === page ? 'page' : undefined}
                  className={entry === page ? 'cur' : undefined}
                >
                  {entry}
                </button>
              ),
            )}
            <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
              Next
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
