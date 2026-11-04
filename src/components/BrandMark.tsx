import type { Org } from '../api/types'

export function BrandMark({ org, compact = false }: { org?: Org | null; compact?: boolean }) {
  const short = org?.short_name ?? 'MRG'
  return (
    <div className={compact ? 'brand compact' : 'brand'}>
      <span className="sigil" aria-hidden="true">
        {short}
      </span>
      <span className="brand-text">
        <strong>Commission Desk</strong>
        <span>{org?.name ?? 'Order to commission'}</span>
      </span>
    </div>
  )
}