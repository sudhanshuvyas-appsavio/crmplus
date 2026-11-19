/** The tab strip across the top of a board, as on monday.com: "Main table" and the
 *  board's other views (its creation form, filtered tables). Rendered under the
 *  page heading; the page decides what each tab shows. */

export interface BoardTab {
  key: string
  label: string
}

export function BoardTabs({ tabs, active, onChange }: { tabs: BoardTab[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="board-tabs" role="tablist" aria-label="Views">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          className={t.key === active ? 'board-tab on' : 'board-tab'}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
