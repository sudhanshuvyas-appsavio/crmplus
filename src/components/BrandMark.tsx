import type { Org } from '../api/types'

export function BrandMark({ org, compact = false }: { org?: Org | null; compact?: boolean }) {
  const short = org?.short_name ?? 'MRG'
  // The Home company (Business Units) names the app; without one it stays "Commission Desk".
  const title = org?.name?.trim() || 'Commission Desk'
  const subtitle = title === 'Commission Desk' ? 'Order to commission' : 'Commission Desk'
  return (
    <div className={compact ? 'brand compact' : 'brand'}>
      <span className="sigil" aria-hidden="true">
        {short}
      </span>
      <span className="brand-text">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </span>
    </div>
  )
}