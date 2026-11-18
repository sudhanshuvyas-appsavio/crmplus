/** The signed-in frame: a sidebar of boards on the left, a top bar with search
 *  and notifications, and the current screen.
 *
 *  The sidebar follows the monday.com workspace: the CRM boards first, then
 *  dashboards, master data, the day-to-day task lists, and administration.
 *  Sections collapse, and the choice is remembered in this browser. Items are
 *  filtered by permission, so people only see what they can work on. */

import { useEffect, useRef, useState, type RefObject } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { BrandMark } from './BrandMark'

interface NavItem {
  to: string
  label: string
  icon: string
  permission?: string
  /** Shown when the user holds at least one of these. */
  anyOf?: string[]
  soon?: boolean
}

interface NavSection {
  id: string
  heading: string
  items: NavItem[]
  /** Collapsed unless the person opens it (or is on one of its screens). */
  startClosed?: boolean
}

const I = {
  deals: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z',
  sc: 'M5 4h10l4 4v12H5zM9 13l2 2 4-4',
  dispatch: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 1 0 0-.01M17 19a1.5 1.5 0 1 0 0-.01',
  leads: 'M5 4h14v4H5zM5 10h14v4H5zM5 16h9v4H5z',
  chart: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
  people: 'M12 4.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5',
  grid: 'M6 4v16M10 4v16M14 4v16M18 4v16M4 8h16',
  card: 'M4 7h16v10H4zM4 11h16M8 15h3',
  doc: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6',
  bill: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h4',
  cash: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6',
  task: 'M5 4h14v16H5zM8 9l2 2 3-3M8 15h8',
  bank: 'M4 10l8-5 8 5M6 10v7M10 10v7M14 10v7M18 10v7M4 19h16',
  cheque: 'M3 7h18v10H3zM6 11h6M6 14h4M16 11h2',
  clock: 'M12 7v5l3 2M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16',
  factory: 'M4 20h16V9l-5 3V9l-5 3V4L4 7z',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  users: 'M9 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6M3 20c1.2-3 3.4-4.5 6-4.5S13.8 17 15 20M16 5.5a3 3 0 0 1 0 5.8M18 20c-.3-1.5-.9-2.7-1.7-3.6',
  audit: 'M7 4h7l4 4v12H7zM14 4v5h4M10 13h5M10 16h5',
  truck: 'M5 17a2 2 0 1 0 0-.01M17 17a2 2 0 1 0 0-.01M3 17V8h11v9M14 11h4l3 3v3M7 12h4',
}

const ORDER = ['order.read', 'order.manage']

const NAV: NavSection[] = [
  {
    id: 'crm',
    heading: 'CRM',
    items: [
      { to: '/deals', label: 'Deals', icon: I.deals, permission: 'deal.read' },
      { to: '/sales-confirmations', label: 'Sales Confirmation', icon: I.sc, anyOf: ['sc.read', 'sc.manage'] },
      { to: '/orders', label: 'Dispatch and Billing', icon: I.dispatch, anyOf: ORDER },
      { to: '/leads', label: 'Leads', icon: I.leads, anyOf: ['lead.manage', 'lead.qualify'] },
    ],
  },
  {
    id: 'dash',
    heading: 'Dashboards',
    items: [
      { to: '/', label: 'Overview', icon: I.chart, permission: 'deal.read' },
      { to: '/sales-dashboard', label: 'Sales follow-up', icon: I.chart, anyOf: ['lead.manage', 'lead.qualify', 'deal.read', ...ORDER] },
      { to: '/billing-dashboard', label: 'Billing & dispatch', icon: I.bill, anyOf: ORDER },
      { to: '/collection-dashboard', label: 'Collection', icon: I.cash, anyOf: ORDER },
      { to: '/staff-performance', label: 'Staff performance', icon: I.chart, permission: 'report.view' },
    ],
  },
  {
    id: 'mdm',
    heading: 'Master data',
    items: [
      // one hub for every MDM register (parties, business units, counts, transport, locations, delivery addresses, payment terms)
      { to: '/master-data', label: 'Master data', icon: 'M4 6c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2zM4 6v6c0 1.1 3.6 2 8 2s8-.9 8-2V6M4 12v6c0 1.1 3.6 2 8 2s8-.9 8-2v-6' },
      { to: '/mailing-list', label: 'Mailing list', icon: I.mail, anyOf: ['buyer.manage', 'mill.manage'] },
    ],
  },
  {
    id: 'tasks',
    heading: 'Tasks',
    startClosed: true,
    items: [
      { to: '/pending-confirmations', label: 'Pending confirmations', icon: I.clock, permission: 'deal.read' },
      { to: '/pending-dispatches', label: 'Pending dispatches', icon: I.dispatch, anyOf: ORDER },
      { to: '/pending-documents', label: 'Mill invoice delivery', icon: I.doc, anyOf: ORDER },
      { to: '/pending-commission-bills', label: 'Commission bills', icon: I.bill, anyOf: ORDER },
      { to: '/pending-transporter-invoices', label: 'Transport invoices', icon: I.truck, anyOf: ORDER },
      { to: '/transporter-payments', label: 'Transporter payments', icon: I.truck, anyOf: ORDER },
      { to: '/trip-sheets', label: 'Trip sheets', icon: I.truck, anyOf: ORDER },
      { to: '/collection-tasks', label: 'Payment collection', icon: I.task, anyOf: ORDER },
      { to: '/cheque-collections', label: 'Cheque collection', icon: I.cheque, anyOf: ORDER },
      { to: '/cheque-deposits', label: 'Cheques deposited', icon: I.bank, anyOf: ORDER },
      { to: '/collection-activity', label: 'Collection activity', icon: I.chart, anyOf: ORDER },
      { to: '/office-activity', label: 'Office activity', icon: I.chart, anyOf: ORDER },
      { to: '/staff-expenses', label: 'Staff expenses', icon: I.cash, anyOf: ['order.manage', 'report.view'] },
    ],
  },
  {
    id: 'admin',
    heading: 'Administration',
    startClosed: true,
    items: [
      { to: '/staff-efficiency', label: 'Staff efficiency', icon: I.chart, permission: 'user.manage' },
      { to: '/users', label: 'Users & permissions', icon: I.users, permission: 'user.manage' },
      { to: '/audit', label: 'Audit log', icon: I.audit, permission: 'audit.view' },
    ],
  },
]

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('nav.open') ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export function AppShell() {
  const { me, meta, can, canAny, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState<Record<string, boolean>>(() => readOpen())
  useEffect(() => {
    try {
      localStorage.setItem('nav.open', JSON.stringify(open))
    } catch {
      /* ignore */
    }
  }, [open])

  async function onSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const allowed = (item: NavItem) => (!item.permission || can(item.permission)) && (!item.anyOf || canAny(...item.anyOf))
  const isHere = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to))

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-brand">
          <BrandMark org={meta?.org} />
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((section) => {
            const items = section.items.filter(allowed)
            if (items.length === 0) return null
            const containsHere = items.some((i) => isHere(i.to))
            const isOpen = open[section.id] ?? (!section.startClosed || containsHere)
            return (
              <div className="nav-section" key={section.id}>
                <button
                  type="button"
                  className="nav-heading"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((p) => ({ ...p, [section.id]: !isOpen }))}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className={isOpen ? 'chev' : 'chev closed'}><path d="M6 9l6 6 6-6" /></svg>
                  {section.heading}
                </button>
                {isOpen &&
                  items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d={item.icon} />
                      </svg>
                      <span>{item.label}</span>
                      {item.soon && <em className="tag">next</em>}
                    </NavLink>
                  ))}
              </div>
            )
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <GlobalSearch />
          <span className="push" />
          <NotificationBell />
          <UserMenu
            name={me?.name ?? ''}
            sub={me?.is_admin ? 'Administrator' : me?.job_title || `${me?.permissions.length ?? 0} permissions`}
            onSignOut={() => void onSignOut()}
          />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function UserMenu({ name, sub, onSignOut }: { name: string; sub: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, open, () => setOpen(false))
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?'
  return (
    <div className="menu-anchor" ref={ref}>
      <button type="button" className="avatar as-button" aria-haspopup="menu" aria-expanded={open} aria-label="Account" onClick={() => setOpen((o) => !o)}>
        {initials}
      </button>
      {open && (
        <div className="pop-menu right" role="menu">
          <div className="pop-head">
            <strong>{name}</strong>
            <span className="small muted">{sub}</span>
          </div>
          <Link role="menuitem" className="pop-item" to="/account" onClick={() => setOpen(false)}>My account</Link>
          <button role="menuitem" type="button" className="pop-item" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  )
}

type Note = { id: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }

/** In-app notifications (monday "send notification" automations): a deal sent for
 *  Manager Approval tells the manager, a deal sent to Reconsider tells its owner. */
function NotificationBell() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const [notes, setNotes] = useState<Note[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, open, () => setOpen(false))

  useEffect(() => {
    if (!me) return
    let alive = true
    const load = async () => {
      const { data } = await supabase.from('notifications').select('id,title,body,link,created_at,read_at').order('created_at', { ascending: false }).limit(20)
      if (alive && data) setNotes(data as Note[])
    }
    void load()
    const t = setInterval(() => void load(), 60000)
    return () => { alive = false; clearInterval(t) }
  }, [me])

  const unread = notes.filter((n) => !n.read_at).length
  async function openNote(n: Note) {
    setOpen(false)
    if (!n.read_at) {
      setNotes((p) => p.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    }
    if (n.link) navigate(n.link)
  }
  async function readAll() {
    const now = new Date().toISOString()
    setNotes((p) => p.map((x) => (x.read_at ? x : { ...x, read_at: now })))
    await supabase.from('notifications').update({ read_at: now }).is('read_at', null)
  }
  return (
    <div className="menu-anchor" ref={ref}>
      <button type="button" className="bell" aria-haspopup="menu" aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0" /></svg>
        {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="pop-menu right notes-menu" role="menu">
          <div className="pop-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" className="btn ghost sm" onClick={() => void readAll()}>Mark all read</button>}
          </div>
          {notes.length === 0 && <p className="pop-empty muted small">Nothing yet.</p>}
          {notes.map((n) => (
            <button key={n.id} role="menuitem" type="button" className={n.read_at ? 'pop-item' : 'pop-item unread'} onClick={() => void openNote(n)}>
              <span className="note-text"><strong>{n.title}</strong><span className="small muted">{n.body}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type Hit = { key: string; kind: string; title: string; sub: string; to: string }

/** Search across deals, sales confirmations and buyers/suppliers by number or name. */
function GlobalSearch() {
  const { can, canAny } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(ref, open, () => setOpen(false))

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits(null)
      return
    }
    let alive = true
    const like = `%${term.replace(/[%_,()]/g, ' ')}%`
    const t = setTimeout(() => {
      void (async () => {
        const jobs: Promise<Hit[]>[] = []
        if (can('deal.read')) {
          jobs.push(
            Promise.resolve(supabase.from('crm_deals').select('id,deal_no,status').ilike('deal_no', like).limit(5)).then(({ data }) =>
              (data ?? []).map((d: { id: string; deal_no: string; status: string }) => ({ key: `d${d.id}`, kind: 'Deal', title: d.deal_no, sub: '', to: `/deals?open=${d.id}` })),
            ),
          )
        }
        if (canAny('sc.read', 'sc.manage')) {
          jobs.push(
            Promise.resolve(supabase.from('sales_confirmations').select('id,sc_no').ilike('sc_no', like).limit(5)).then(({ data }) =>
              (data ?? []).map((s: { id: string; sc_no: string | null }) => ({ key: `s${s.id}`, kind: 'Sales Confirmation', title: s.sc_no ?? '—', sub: '', to: `/sales-confirmations?open=${s.id}` })),
            ),
          )
        }
        if (canAny('buyer.manage', 'mill.manage', 'lead.manage', 'lead.qualify', 'deal.read')) {
          jobs.push(
            Promise.resolve(supabase.from('buyer_master').select('id,name').ilike('name', like).limit(5)).then(({ data }) =>
              (data ?? []).map((b: { id: string; name: string }) => ({ key: `b${b.id}`, kind: 'Buyer', title: b.name, sub: '', to: '/contacts' })),
            ),
            Promise.resolve(supabase.from('supplier_master').select('id,name').ilike('name', like).limit(5)).then(({ data }) =>
              (data ?? []).map((s: { id: string; name: string }) => ({ key: `p${s.id}`, kind: 'Supplier', title: s.name, sub: '', to: '/contacts' })),
            ),
          )
        }
        const all = (await Promise.all(jobs)).flat()
        if (alive) {
          setHits(all)
          setActive(0)
        }
      })()
    }, 200)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q, can, canAny])

  function go(h: Hit) {
    setOpen(false)
    setQ('')
    navigate(h.to)
  }

  return (
    <div className="gsearch" ref={ref}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14M20 20l-4-4" /></svg>
      <input
        type="search"
        aria-label="Search"
        placeholder="Search deals, confirmations, buyers, suppliers"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (!hits || hits.length === 0) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Enter') {
            e.preventDefault()
            const hit = hits[active]
            if (hit) go(hit)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && hits && (
        <div className="pop-menu gsearch-results" role="listbox">
          {hits.length === 0 ? (
            <p className="small muted pop-empty">Nothing found for “{q.trim()}”.</p>
          ) : (
            hits.map((h, i) => (
              <button key={h.key} type="button" role="option" aria-selected={i === active} className={i === active ? 'pop-item on' : 'pop-item'} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
                <span className="hit-kind">{h.kind}</span>
                <span className="hit-title">{h.title}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function useOutside(ref: RefObject<HTMLElement | null>, active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return
    function away(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    function esc(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [ref, active, close])
}
