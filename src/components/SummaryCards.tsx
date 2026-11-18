import { Link } from 'react-router-dom'

export interface SummaryCard {
  key: string
  label: string
  value: number | string
  /** A warning tone tints the card and its figure. */
  tone?: 'default' | 'warn' | 'danger'
  href?: string
}

/** Count cards that double as links to the matching filtered list, so the
 *  number and the list behind it can never disagree. */
export function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  return (
    <div className="summary-cards">
      {cards.map((c) => {
        const zero = c.value === 0 || c.value === '0'
        const cls = `summary-card${c.tone && c.tone !== 'default' && !zero ? ` ${c.tone}` : ''}${zero ? ' zero' : ''}`
        const body = (
          <>
            <span className="summary-label">{c.label}</span>
            <span className="summary-value">{c.value}</span>
          </>
        )
        return c.href ? (
          <Link key={c.key} to={c.href} className={cls}>
            {body}
          </Link>
        ) : (
          <div key={c.key} className={cls}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
