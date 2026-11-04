/** The Import / Export / Delete-selected bar and the row-selection state that
 *  the Counts, Suppliers, Buyers and Leads screens share. It mirrors what the
 *  Companies screen does, so all five lists behave the same way. */

import { useMemo, useRef, useState } from 'react'
import type { CsvRowResult } from '../lib/bulk'

/** Row selection over the rows currently shown. Only rows that are visible
 *  count as selected, so a search filter can never make a bulk delete reach
 *  records the person cannot see. */
export function useSelection(visibleIds: string[]) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const chosen = useMemo(() => visibleIds.filter((id) => picked.has(id)), [visibleIds, picked])
  const allSelected = visibleIds.length > 0 && chosen.length === visibleIds.length

  return {
    chosen,
    allSelected,
    isSelected: (id: string) => picked.has(id),
    toggle: (id: string) =>
      setPicked((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    toggleAll: () => setPicked(allSelected ? new Set() : new Set(visibleIds)),
    clear: () => setPicked(new Set()),
  }
}

export function ListTools({
  plural,
  canImport,
  canDelete,
  selectedCount,
  exportLabel,
  exportDisabled,
  busy,
  onImport,
  onExport,
  onDelete,
}: {
  plural: string
  canImport: boolean
  canDelete: boolean
  selectedCount: number
  exportLabel: string
  exportDisabled: boolean
  busy: boolean
  onImport: (file: File) => void
  onExport: () => void
  onDelete: () => void | Promise<void>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="page-head" style={{ marginBottom: 12 }}>
      <div className="drawer-actions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
        {canImport && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) onImport(file)
              }}
            />
            <button className="btn" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              Import CSV
            </button>
          </>
        )}
        <button className="btn" type="button" onClick={onExport} disabled={exportDisabled || busy}>
          {exportLabel}
        </button>
        {canDelete && selectedCount > 0 && (
          <>
            {!confirming ? (
              <button className="btn danger" type="button" onClick={() => setConfirming(true)} disabled={busy}>
                Delete {selectedCount} selected
              </button>
            ) : (
              <>
                <span className="field-warn">
                  Delete {selectedCount} {plural}? This can't be undone.
                </span>
                <button
                  className="btn danger"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await onDelete()
                    setConfirming(false)
                  }}
                >
                  {busy ? 'Deleting…' : 'Yes, delete them'}
                </button>
                <button className="btn ghost" type="button" onClick={() => setConfirming(false)} disabled={busy}>
                  Cancel
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function ImportIssues({ results }: { results: CsvRowResult[] | null }) {
  const errors = (results ?? []).filter((r) => r.status === 'error')
  if (errors.length === 0) return null
  return (
    <div className="card pad" style={{ marginBottom: 16 }}>
      <h2 className="card-title">Import issues</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>CSV row</th>
              <th>Record</th>
              <th>Problem</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((r) => (
              <tr key={r.row}>
                <td className="mono">{r.row}</td>
                <td>{r.name}</td>
                <td className="small">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}