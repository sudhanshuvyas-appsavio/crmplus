/** A lead's subitems under its row, as in monday: Owner, Count, Supplier, Rate, Last updated.
 *  They are the rows of the lead's quotation (Lead-Quotation tab), so changing them
 *  happens there; "Last updated" and "Owner" are when and by whom the rows were last saved. */

import { formatDateTime } from '../lib/format'
import { Avatar } from './board/Board'
import { useProfileNames } from './PartyExtras'

export type SubLine = { lead_id: string; line_no: number; count_id: string; supplier_id: string; rate: number; created_by: string | null; created_at: string }

export function LeadSubitems({
  lines,
  countName,
  supplierName,
  canEdit,
  onEdit,
}: {
  lines: SubLine[]
  countName: Map<string, string>
  supplierName: Map<string, string>
  canEdit: boolean
  onEdit: () => void
}) {
  const names = useProfileNames()
  return (
    <>
      {lines.length === 0 ? (
        <p className="muted small">No subitems yet.</p>
      ) : (
        <table className="sub-table">
          <thead>
            <tr>
              <th>Subitem</th>
              <th>Owner</th>
              <th>Count</th>
              <th>Suppliers</th>
              <th className="num">Rate</th>
              <th>Last updated</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((s) => {
              const count = countName.get(s.count_id) ?? '—'
              const supplier = supplierName.get(s.supplier_id) ?? '—'
              const owner = s.created_by ? names[s.created_by] : undefined
              return (
                <tr key={s.line_no}>
                  <td>{count} - {supplier}</td>
                  <td>{owner ? <><Avatar name={owner} /> {owner}</> : <span className="muted">—</span>}</td>
                  <td>{count}</td>
                  <td>{supplier}</td>
                  <td className="num">{s.rate.toFixed(2)}</td>
                  <td>{formatDateTime(s.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {canEdit && (
        <div className="sub-foot">
          <button type="button" className="btn sm" onClick={onEdit}>{lines.length === 0 ? '+ Add subitems' : 'Edit subitems'}</button>
          <span className="muted small">Subitems are the rows of the lead's quotation.</span>
        </div>
      )}
    </>
  )
}
