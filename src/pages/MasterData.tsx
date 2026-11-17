/** Master Data -- the one place the business keeps its reference records
 *  (MDM plan, replacing the monday.com "MDM" folder of boards).
 *
 *  The layout follows the Pharma ERP's Master Data section: a register list
 *  down the left, the selected register's grid beside it, and each record's
 *  form opening as a centred modal over the grid. The registers themselves are
 *  the existing screens -- each keeps its own route, rules and permissions --
 *  so this page only frames them and decides which ones the signed-in person
 *  may open. Hiding a register is a courtesy; the database policies are what
 *  actually refuse a read or write.
 *
 *  The registers are the seven of the monday MDM folder, in the same order:
 *  Business Units, Buyers & Suppliers, Counts, Transport Company, Locations,
 *  Sizing / Delivery Address and Payment Terms. */

import { useMemo, type ComponentType } from 'react'
import { Navigate, NavLink, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import Companies from './Companies'
import Contacts from './Contacts'
import Counts from './Counts'
import JobProcesses from './JobProcesses'
import Locations from './Locations'
import PaymentTerms from './PaymentTerms'
import Transporters from './Transporters'

interface Register {
  key: string
  label: string
  title: string
  /** One line under the heading, saying what the register is for. */
  purpose: string
  Component: ComponentType
  /** Offered when the person holds at least one of these. Empty means everyone. */
  anyOf: string[]
}

export const REGISTERS: Register[] = [
  {
    key: 'business-units',
    label: 'Business Units',
    title: 'Business Units',
    purpose: 'The companies the agency trades through, with GST, state, phones and bank accounts.',
    Component: Companies,
    anyOf: [],
  },
  {
    key: 'buyers-suppliers',
    label: 'Buyers & Suppliers',
    title: 'Buyers & Suppliers',
    purpose: 'Every mill and buyer: GST, PAN, three contacts, addresses, bank details, commission, team and linked locations and counts.',
    Component: Contacts,
    anyOf: ['buyer.manage', 'mill.manage', 'lead.manage', 'lead.qualify'],
  },
  {
    key: 'counts',
    label: 'Counts',
    title: 'Counts',
    purpose: 'Yarn specifications: count, machine, composition, process, certification and type.',
    Component: Counts,
    anyOf: ['article.manage', 'lead.manage', 'lead.qualify', 'deal.read'],
  },
  {
    key: 'transport',
    label: 'Transport Company',
    title: 'Transport Company',
    purpose: 'Transporters: vehicle type and numbers, contacts, GST, PAN, bank accounts and locations served.',
    Component: Transporters,
    anyOf: ['transport.read', 'transport.manage'],
  },
  {
    key: 'delivery-address',
    label: 'Sizing / Delivery Address',
    title: 'Sizing / Delivery Address',
    purpose: 'Sizing units and other job-process addresses a consignment can be sent to.',
    Component: JobProcesses,
    anyOf: ['jobprocess.read', 'jobprocess.manage'],
  },
  {
    key: 'locations',
    label: 'Locations',
    title: 'Locations',
    purpose: 'Delivery sites: address, GST, contacts, zone and the parties that use them.',
    Component: Locations,
    anyOf: ['settings.manage', 'lead.manage', 'lead.qualify', 'deal.read'],
  },
  {
    key: 'payment-terms',
    label: 'Payment Terms',
    title: 'Payment Terms',
    purpose: 'Credit days and advance a deal can be agreed on.',
    Component: PaymentTerms,
    anyOf: ['deal.read', 'lead.manage', 'settings.manage'],
  },
]

export default function MasterData() {
  const { canAny } = useAuth()
  const { register } = useParams()

  const visible = useMemo(() => REGISTERS.filter((r) => r.anyOf.length === 0 || canAny(...r.anyOf)), [canAny])

  const active = REGISTERS.find((r) => r.key === register)
  // No register in the URL, or one that does not exist: open the first one
  // this person can see rather than showing a blank frame.
  if (!active) {
    const first = visible[0]
    return first ? <Navigate to={`/master-data/${first.key}`} replace /> : <NoAccess />
  }
  if (!visible.includes(active)) return <NoAccess register={active.title} />

  const Active = active.Component

  return (
    <div className="md-page">
      <header className="md-head">
        <h1>Master Data</h1>
        <p className="page-sub">The registers the rest of the system refers to.</p>
      </header>

      <div className="md-frame">
        <nav className="md-rail" aria-label="Registers">
          <ul>
            {visible.map((r) => (
              <li key={r.key}>
                <NavLink
                  to={`/master-data/${r.key}`}
                  title={r.purpose}
                  className={({ isActive }) => (isActive ? 'md-link active' : 'md-link')}
                >
                  {r.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Keyed so switching register starts the next screen clean -- its own
            search, selection and open form must not carry over. */}
        <section className="md-pane" key={active.key} aria-label={active.title}>
          <Active />
        </section>
      </div>
    </div>
  )
}

function NoAccess({ register }: { register?: string }) {
  return (
    <div className="card pad narrow-card">
      <h2 className="card-title">{register ? `${register} is not available to you` : 'No registers available'}</h2>
      <p className="muted">
        Your account does not have access to this register. An administrator can grant it under Users &amp;
        permissions.
      </p>
    </div>
  )
}
