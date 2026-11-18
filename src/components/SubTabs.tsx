import { Link } from 'react-router-dom'

export interface SubTab {
  key: string
  label: string
  /** A count shown in a small badge beside the label. */
  count?: number
}

/** The underline tab row under a module header. Each tab is a real link, so the
 *  open view lives in the URL and Back / copy-link work. */
export function SubTabs({
  tabs,
  active,
  hrefFor,
  label = 'Views',
}: {
  tabs: SubTab[]
  active: string
  hrefFor: (key: string) => string
  label?: string
}) {
  return (
    <nav className="sub-tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          to={hrefFor(t.key)}
          className={t.key === active ? 'sub-tab active' : 'sub-tab'}
          aria-current={t.key === active ? 'page' : undefined}
          replace
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="sub-tab-count">{t.count}</span>}
        </Link>
      ))}
    </nav>
  )
}
