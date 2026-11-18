/** A ranked horizontal bar chart for "how many per ...": one bar per category, largest first,
 *  the count printed at the bar's tip. Used by the Reports tabs.
 *
 *  Form: ranked horizontal bars (long names, a magnitude to compare), one series, so one colour and
 *  no legend. Bars are thin (16px), rounded only at the data end, and grow from a single baseline.
 *  Every bar is a button: hover lifts it, keyboard focus shows the same detail, and clicking can
 *  filter the board. A "Table" toggle on each card gives the same numbers as text. */

import { useState } from 'react'

export interface BarDatum {
  label: string
  value: number
  /** Click handler (e.g. filter the board to this category). Omit for a plain bar. */
  onPick?: () => void
}

const MAX_BARS = 10

export function ChartCard({ title, subtitle, children, table }: { title: string; subtitle?: string; children: React.ReactNode; table?: React.ReactNode }) {
  return (
    <section className="viz-card" aria-label={title}>
      <header className="viz-card-head">
        <h3>{title}</h3>
        {subtitle && <span className="small muted">{subtitle}</span>}
      </header>
      <div className="viz-card-body">{children}</div>
      {table}
    </section>
  )
}

export function RankedBars({ data, unit, emptyText = 'Nothing to show.', order = 'value', format }: {
  data: BarDatum[]
  unit: string
  emptyText?: string
  /** 'value' ranks largest first; 'given' keeps the order of `data` (e.g. dates). */
  order?: 'value' | 'given'
  /** How a value is printed, e.g. money. Default: the plain number. */
  format?: (n: number) => string
}) {
  const fmt = format ?? ((n: number) => String(n))
  const sorted = order === 'given' ? [...data] : [...data].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
  // a long tail is folded into one muted "Others" bar instead of crowding the chart
  const shown = sorted.length > MAX_BARS + 1 ? sorted.slice(0, MAX_BARS) : sorted
  const rest = sorted.length > MAX_BARS + 1 ? sorted.slice(MAX_BARS) : []
  const restTotal = rest.reduce((a, d) => a + d.value, 0)
  const max = Math.max(1, ...shown.map((d) => d.value), restTotal)
  const [showTable, setShowTable] = useState(false)
  if (sorted.length === 0) return <p className="muted small viz-empty">{emptyText}</p>
  const plural = (n: number) => (format ? `${fmt(n)}` : `${n} ${unit}${n === 1 ? '' : 's'}`)

  return (
    <>
      <div className="rbars" role="list">
        {shown.map((d) => (
          <button
            key={d.label}
            type="button"
            role="listitem"
            className="rbar"
            disabled={!d.onPick}
            title={`${d.label}: ${plural(d.value)}`}
            aria-label={`${d.label}: ${plural(d.value)}`}
            onClick={d.onPick}
          >
            <span className="rbar-label">{d.label}</span>
            <span className="rbar-track">
              <span className="rbar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
              <span className="rbar-value">{fmt(d.value)}</span>
            </span>
          </button>
        ))}
        {rest.length > 0 && (
          <div className="rbar other" role="listitem" title={`${rest.length} more: ${plural(restTotal)}`} aria-label={`${rest.length} others: ${plural(restTotal)}`}>
            <span className="rbar-label">{rest.length} others</span>
            <span className="rbar-track">
              <span className="rbar-fill" style={{ width: `${(restTotal / max) * 100}%` }} />
              <span className="rbar-value">{fmt(restTotal)}</span>
            </span>
          </div>
        )}
      </div>
      <button type="button" className="btn ghost sm viz-table-toggle" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
        {showTable ? 'Hide table' : 'Table'}
      </button>
      {showTable && (
        <table className="viz-table">
          <tbody>
            {sorted.map((d) => (
              <tr key={d.label}><td>{d.label}</td><td className="right mono">{fmt(d.value)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

/** Count items per category. `keys` gives each item's categories (a confirmation with two counts lands in two). */
export function tally<T>(items: T[], keys: (item: T) => string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const it of items) for (const k of new Set(keys(it))) out.set(k, (out.get(k) ?? 0) + 1)
  return out
}

/** A headline number: label (sentence case), value, and an optional note. Used above the charts. */
export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {note && <span className="small muted">{note}</span>}
    </div>
  )
}
