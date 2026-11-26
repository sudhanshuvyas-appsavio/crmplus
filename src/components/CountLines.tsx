/** Count lines on a deal or Sales Confirmation ("Commissioning Business -
 *  Changes needed"): one row per count with Count, Quantity, Unit, Bag Weight and
 *  Final Rate. Buyer and supplier commission are per party (from the master) and
 *  worked out per row with the same rules as the database (lib/deals.ts).
 *  Rows are saved in one call (save_deal_lines / save_sc_lines). */

import type { CountRow } from '../api/types'
import { numOrNull } from '../lib/party'
import { UOMS, commission, inr, needsUnitWeight, rateText, totalWeight, uomLabel } from '../lib/deals'

export type LineForm = { count_id: string; quantity: string; uom: string; bag_weight: string; rate: string }
export type LineRow = { count_id: string | null; quantity: number | null; uom: string; bag_weight: number | null; rate: number | null }
export type CommTerms = { basis: string | null; value: number | null }

const s = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))
export const emptyLine = (): LineForm => ({ count_id: '', quantity: '', uom: 'KG', bag_weight: '', rate: '' })
export const toLineForm = (r: LineRow): LineForm => ({ count_id: r.count_id ?? '', quantity: s(r.quantity), uom: r.uom, bag_weight: s(r.bag_weight), rate: s(r.rate) })

/** What is still missing, with the row number when there are several rows.
 *  `strictUnit`: every count not sold by KG or TONS also needs its weight per unit
 *  (without it weight, value and commissions stay blank); needed before approval. */
export function lineProblems(lines: LineForm[], strictUnit = false): string[] {
  const out: string[] = []
  if (lines.length === 0) out.push('At least one count')
  lines.forEach((l, i) => {
    const at = lines.length > 1 ? ` (row ${i + 1})` : ''
    const q = numOrNull(l.quantity)
    const w = numOrNull(l.bag_weight)
    const r = numOrNull(l.rate)
    if (!l.count_id) out.push(`Count${at}`)
    if (q === null || q <= 0) out.push(`Quantity above zero${at}`)
    if (l.uom === 'BAGS' && (w === null || w <= 0)) out.push(`Bag weight${at}`)
    else if (strictUnit && needsUnitWeight(l.uom) && (w === null || w <= 0)) out.push(`Weight per unit${at}`)
    if (l.bag_weight && (w === null || w <= 0)) out.push(`Bag weight a number above zero${at}`)
    if (l.rate && (r === null || r < 0)) out.push(`Final rate a number${at}`)
  })
  return out
}

/** The rows as the save functions take them. */
export function linesPayload(lines: LineForm[], rateKey: 'final_rate' | 'rate') {
  return lines.map((l) => ({
    count_id: l.count_id,
    quantity: numOrNull(l.quantity),
    uom: l.uom,
    bag_weight: numOrNull(l.bag_weight),
    [rateKey]: numOrNull(l.rate),
  }))
}

export function lineFigures(l: LineForm, buyer: CommTerms, supplier: CommTerms) {
  const q = numOrNull(l.quantity)
  const w = numOrNull(l.bag_weight)
  const r = numOrNull(l.rate)
  const weight = totalWeight(l.uom, q, w)
  const value = weight !== null && r !== null ? weight * r : null
  return {
    weight,
    value,
    buyer: commission(buyer.basis, buyer.value, value, l.uom, q, weight, w),
    supplier: commission(supplier.basis, supplier.value, value, l.uom, q, weight, w),
  }
}

export function CountLinesEditor({ lines, onChange, counts, disabled, buyer, supplier, weightRequired = false }: {
  /** Sales Confirmation: monday requires Bag Weight on every row, whatever the unit. */
  weightRequired?: boolean
  lines: LineForm[]
  onChange: (lines: LineForm[]) => void
  counts: CountRow[]
  disabled: boolean
  buyer: CommTerms
  supplier: CommTerms
}) {
  const set = (i: number, k: keyof LineForm, v: string) => onChange(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const figs = lines.map((l) => lineFigures(l, buyer, supplier))
  const total = (pick: (f: ReturnType<typeof lineFigures>) => number | null) =>
    figs.some((f) => pick(f) !== null) ? figs.reduce((a, f) => a + (pick(f) ?? 0), 0) : null
  return (
    <div className="table-wrap lines-wrap">
      <table className="lines-table">
        <thead>
          <tr>
            <th>#</th><th>Count</th><th className="right">Quantity</th><th>Unit</th><th className="right">Bag Weight (kg){weightRequired ? ' *' : ''}</th>
            <th className="right">Final Rate (₹/kg)</th><th className="right">Buyer Commission</th><th className="right">Supplier Commission</th>
            {!disabled && <th />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="muted small">{i + 1}</td>
              <td>
                <select aria-label={`Count, row ${i + 1}`} value={l.count_id} disabled={disabled} onChange={(e) => set(i, 'count_id', e.target.value)}>
                  <option value="">Choose…</option>
                  {counts.filter((c) => c.is_active || c.id === l.count_id).map((c) => (<option key={c.id} value={c.id}>{c.display_name}</option>))}
                </select>
              </td>
              <td><input aria-label={`Quantity, row ${i + 1}`} className="mono num-in" inputMode="decimal" value={l.quantity} disabled={disabled} onChange={(e) => set(i, 'quantity', e.target.value)} /></td>
              <td>
                <select aria-label={`Unit, row ${i + 1}`} value={l.uom} disabled={disabled} onChange={(e) => set(i, 'uom', e.target.value)}>
                  {UOMS.map((u) => (<option key={u.value} value={u.value}>{u.label}</option>))}
                </select>
              </td>
              <td>
                <input aria-label={`Bag weight, row ${i + 1}`} className="mono num-in" inputMode="decimal" value={l.bag_weight} disabled={disabled}
                  placeholder={weightRequired ? 'required' : needsUnitWeight(l.uom) ? (l.uom === 'BAGS' ? 'required' : 'kg per unit') : ''} onChange={(e) => set(i, 'bag_weight', e.target.value)} />
              </td>
              <td><input aria-label={`Final rate, row ${i + 1}`} className="mono num-in" inputMode="decimal" value={l.rate} disabled={disabled} onChange={(e) => set(i, 'rate', e.target.value)} /></td>
              <td className="right mono small">{inr(figs[i]?.buyer, 0)}</td>
              <td className="right mono small">{inr(figs[i]?.supplier, 0)}</td>
              {!disabled && (
                <td>
                  {lines.length > 1 && (
                    <button className="btn ghost sm" type="button" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}>Remove</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {(!disabled || total((f) => f.buyer) !== null || total((f) => f.supplier) !== null) && (
        <tfoot>
          <tr>
            <td colSpan={6} className="small muted">
              {!disabled && <button className="btn sm" type="button" onClick={() => onChange([...lines, { ...emptyLine(), uom: lines[lines.length - 1]?.uom ?? 'KG' }])}>+ Add count</button>}
            </td>
            <td className="right mono small strong">{inr(total((f) => f.buyer), 0)}</td>
            <td className="right mono small strong">{inr(total((f) => f.supplier), 0)}</td>
            {!disabled && <td />}
          </tr>
        </tfoot>
        )}
      </table>
    </div>
  )
}

/** The count rows as plain read-only text in a table (the details views), same columns as the editor. */
export function CountLinesView({ lines, counts, buyer, supplier }: { lines: LineForm[]; counts: CountRow[]; buyer: CommTerms; supplier: CommTerms }) {
  const rows = lines.filter((l) => l.count_id || l.quantity)
  if (rows.length === 0) return <p className="muted small">No counts yet.</p>
  const figs = rows.map((l) => lineFigures(l, buyer, supplier))
  // commission columns only when at least one row has an amount: all dashes tell nothing
  const showComm = figs.some((f) => f?.buyer || f?.supplier)
  return (
    <div className="table-wrap lines-wrap">
      <table className="lines-table lines-view">
        <thead>
          <tr>
            <th>#</th><th>Count</th><th className="right">Quantity</th><th>Unit</th><th className="right">Bag Weight (kg)</th>
            <th className="right">Final Rate (₹/kg)</th>
            {showComm && <><th className="right">Buyer Commission</th><th className="right">Supplier Commission</th></>}
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i}>
              <td className="muted small">{i + 1}</td>
              <td>{counts.find((c) => c.id === l.count_id)?.display_name ?? '—'}</td>
              <td className="right mono">{l.quantity || '—'}</td>
              <td>{uomLabel(l.uom)}</td>
              <td className="right mono">{l.bag_weight || '—'}</td>
              <td className="right mono">{l.rate ? rateText(numOrNull(l.rate)) : '—'}</td>
              {showComm && <><td className="right mono small">{inr(figs[i]?.buyer, 0)}</td><td className="right mono small">{inr(figs[i]?.supplier, 0)}</td></>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Read-only text of the rows, one per line, for tables and messages. */
export function linesText(rows: LineRow[], countName: (id: string) => string) {
  return rows.map((r) => `${r.count_id ? countName(r.count_id) : '—'}: ${inr(r.quantity)} ${uomLabel(r.uom)}${r.bag_weight && needsUnitWeight(r.uom) ? ` × ${inr(r.bag_weight)} kg` : ''}${r.rate !== null ? ` @ ₹${rateText(r.rate)}/kg` : ''}`)
}
