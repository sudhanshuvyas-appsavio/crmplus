/** The signed-in frame: navigation on the left, the current screen on the right.
 *
 * Navigation is filtered by permission, so people only see what they can work
 * on. The screens that are not built yet are listed with a "next" tag rather
 * than hidden, so the client can see the shape of what is coming. */

import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { BrandMark } from './BrandMark'

interface NavItem {
  to: string
  label: string
  icon: string
  permission?: string
  /** Shown when the user holds at least one of these. */
  anyOf?: string[]
  adminOnly?: boolean
  soon?: boolean
}

const NAV: (NavItem | { heading: string })[] = [
  { heading: 'Work' },
  { to: '/', label: 'Pipeline', icon: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z', permission: 'deal.read' },
  { to: '/sales-dashboard', label: 'Sales follow-up', icon: 'M4 19V9M10 19V5M16 19v-7M22 19H2', anyOf: ['lead.manage', 'lead.qualify', 'deal.read', 'order.read', 'order.manage'] },
  { to: '/billing-dashboard', label: 'Billing & dispatch', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h4', anyOf: ['order.read', 'order.manage'] },
  { to: '/collection-dashboard', label: 'Collection', icon: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6', anyOf: ['order.read', 'order.manage'] },
  { to: '/leads', label: 'Leads', icon: 'M5 4h14v4H5zM5 10h14v4H5zM5 16h9v4H5z', anyOf: ['lead.manage', 'lead.qualify'] },
  { to: '/deals', label: 'Deal register', icon: 'M4 6h16M4 12h16M4 18h16', permission: 'deal.read' },
  { to: '/pending-confirmations', label: 'Pending confirmations', icon: 'M12 7v5l3 2M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16', permission: 'deal.read' },
  { to: '/sales-confirmations', label: 'Sales confirmations', icon: 'M5 4h10l4 4v12H5zM9 13l2 2 4-4', anyOf: ['sc.read', 'sc.manage'] },
  { to: '/orders', label: 'Orders', icon: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4', anyOf: ['order.read', 'order.manage'] },
  { to: '/pending-dispatches', label: 'Pending dispatches', icon: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM12 3v3M9 4l1 2M15 4l-1 2', anyOf: ['order.read', 'order.manage'] },
  { to: '/pending-documents', label: 'Mill invoices & receipts', icon: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6', anyOf: ['order.read', 'order.manage'] },
  { to: '/pending-commission-bills', label: 'Pending commission bills', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', anyOf: ['order.read', 'order.manage'] },
  { to: '/pending-transporter-invoices', label: 'Transporter invoices', icon: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM6 10h5M6 13h3', anyOf: ['order.read', 'order.manage'] },
  { to: '/transporter-payments', label: 'Transporter payments', icon: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM6 11h5M6 13.5h3', anyOf: ['order.read', 'order.manage'] },
  { to: '/trip-sheets', label: 'Trip sheets', icon: 'M5 17a2 2 0 1 0 0-.01M17 17a2 2 0 1 0 0-.01M3 17V8h11v9M14 11h4l3 3v3M7 12h4', anyOf: ['order.read', 'order.manage'] },
  { to: '/staff-expenses', label: 'Staff expenses', icon: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6', anyOf: ['order.manage', 'report.view'] },
  { to: '/transportation', label: 'Transportation', icon: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 1 0 0-.01M17 19a1.5 1.5 0 1 0 0-.01', anyOf: ['transport.read', 'transport.manage'] },
  { to: '/job-process', label: 'Job process', icon: 'M4 20h16V9l-5 3V9l-5 3V4L4 7zM8 16h2M13 16h2', anyOf: ['jobprocess.read', 'jobprocess.manage'] },
  { heading: 'Money' },
  { to: '/staff-performance', label: 'Staff performance', icon: 'M4 19V9M10 19V5M16 19v-7M3 19h18M18 5l2 2-2 2', permission: 'report.view' },
  { to: '/cheque-collections', label: 'Cheque collection', icon: 'M3 7h18v10H3zM6 11h6M6 14h4M16 11h2', anyOf: ['order.read', 'order.manage'] },
  { to: '/cheque-deposits', label: 'Cheques deposited', icon: 'M4 10l8-5 8 5M6 10v7M10 10v7M14 10v7M18 10v7M4 19h16', anyOf: ['order.read', 'order.manage'] },
  { to: '/collection-activity', label: 'Collection activity', icon: 'M4 19V9M10 19V5M16 19v-7M3 19h18', anyOf: ['order.read', 'order.manage'] },
  { to: '/office-activity', label: 'Office activity', icon: 'M4 19V9M10 19V5M16 19v-7M3 19h18', anyOf: ['order.read', 'order.manage'] },
  { to: '/collection-tasks', label: 'Collection tasks', icon: 'M5 4h14v16H5zM8 9l2 2 3-3M8 15h8', anyOf: ['order.read', 'order.manage'] },
  { to: '/ledger', label: 'Commission ledger', icon: 'M12 4v16M8 8h6.5a2.5 2.5 0 0 1 0 5H9a2.5 2.5 0 0 0 0 5h7', permission: 'report.view', soon: true },
  { heading: 'Reference' },
  { to: '/contacts', label: 'Contacts', icon: 'M12 4.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5', anyOf: ['buyer.manage', 'mill.manage', 'lead.manage', 'lead.qualify'] },
  { to: '/counts', label: 'Count master', icon: 'M6 4v16M10 4v16M14 4v16M18 4v16M4 8h16', anyOf: ['article.manage', 'lead.manage', 'lead.qualify'] },
  { to: '/payment-terms', label: 'Payment terms', icon: 'M4 7h16v10H4zM4 11h16M8 15h3', anyOf: ['deal.read', 'lead.manage', 'settings.manage'] },
  { to: '/mailing-list', label: 'Mailing list', icon: 'M4 6h16v12H4zM4 7l8 6 8-6', anyOf: ['buyer.manage', 'mill.manage'] },
  { heading: 'Administration' },
  { to: '/companies', label: 'Companies', icon: 'M4 20h16V9l-5 3V9l-5 3V4L4 7z' },
  { to: '/staff-efficiency', label: 'Staff efficiency', icon: 'M4 19V9M10 19V5M16 19v-7M3 19h18', permission: 'user.manage' },
  { to: '/users', label: 'Users & permissions', icon: 'M9 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6M3 20c1.2-3 3.4-4.5 6-4.5S13.8 17 15 20M16 5.5a3 3 0 0 1 0 5.8M18 20c-.3-1.5-.9-2.7-1.7-3.6', permission: 'user.manage' },
  { to: '/audit', label: 'Audit log', icon: 'M7 4h7l4 4v12H7zM14 4v5h4M10 13h5M10 16h5', permission: 'audit.view' },
  { to: '/account', label: 'My account', icon: 'M12 4.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5' },
]

export function AppShell() {
  const { me, meta, can, canAny, signOut } = useAuth()
  const navigate = useNavigate()

  async function onSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const initials = (me?.name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-brand">
          <BrandMark org={meta?.org} />
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((item, index) => {
            if ('heading' in item) return <p className="nav-heading" key={`h${index}`}>{item.heading}</p>
            if (item.permission && !can(item.permission)) return null
            if (item.anyOf && !canAny(...item.anyOf)) return null
            return (
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
            )
          })}
        </nav>
        <div className="rail-foot">
          <div className="whoami">
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="whoami-text">
              <strong>{me?.name}</strong>
              <span className="small muted">
                {me?.is_admin ? 'Administrator' : me?.job_title || `${me?.permissions.length ?? 0} permissions`}
              </span>
            </span>
          </div>
          <button className="btn ghost sm" type="button" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}