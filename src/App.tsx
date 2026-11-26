import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAuth, RequireGuest, RequirePermission } from './auth/guards'
import { useAuth } from './auth/AuthProvider'
import { Loading } from './components/Loading'
import Account from './pages/Account'
import AuditLog from './pages/AuditLog'
import AutomationLog from './pages/AutomationLog'
import ChangePassword from './pages/ChangePassword'
import ForgotPassword from './pages/ForgotPassword'
import Home from './pages/Home'
import Login from './pages/Login'
import MasterData from './pages/MasterData'
import PendingConfirmations from './pages/PendingConfirmations'
import PendingDispatches from './pages/PendingDispatches'
import PendingDocuments from './pages/PendingDocuments'
import Orders from './pages/Orders'
import SalesConfirmations from './pages/SalesConfirmations'
import Deals from './pages/Deals'
import MailingList from './pages/MailingList'
import PendingCommissionBills from './pages/PendingCommissionBills'
import CommissionInvoices from './pages/CommissionInvoices'
import PendingTransporterInvoices from './pages/PendingTransporterInvoices'
import StaffEfficiency from './pages/StaffEfficiency'
import StaffPerformance from './pages/StaffPerformance'
import CollectionActivity from './pages/CollectionActivity'
import OfficeActivity from './pages/OfficeActivity'
import TransporterPayments from './pages/TransporterPayments'
import TripSheets from './pages/TripSheets'
import TransporterTypeDetails from './pages/TransporterTypeDetails'
import TransportInvoices from './pages/TransportInvoices'
import StaffExpenses from './pages/StaffExpenses'
import SalesDashboard from './pages/SalesDashboard'
import BillingDashboard from './pages/BillingDashboard'
import CollectionDashboard from './pages/CollectionDashboard'
import Leads from './pages/Leads'
import MyTasks from './pages/MyTasks'
import Tasks from './pages/Tasks'
import ResetPassword from './pages/ResetPassword'
import Users from './pages/Users'

/** The old stand-alone register routes now open inside Master Data, so every
 *  register looks and behaves the same. The query string is kept: a link such
 *  as /contacts?search=... still opens the register already narrowed. */
function ToRegister({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={`/master-data/${to}${search}`} replace />
}

/** The old collection-task and cheque screens now live inside the Tasks module. */
function ToTasks({ view }: { view: string }) {
  return <Navigate to={`/tasks?view=${view}`} replace />
}

/** The forced password change sits outside the shell: a user who has to set a
 *  password cannot reach anything else, so there is no navigation to show. */
function ChangePasswordRoute() {
  const { me, ready } = useAuth()
  if (!ready) return <Loading />
  if (!me) return <Navigate to="/login" replace />
  return <ChangePassword />
}

export default function App() {
  return (
    <Routes>
      <Route element={<RequireGuest />}>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>

      {/* A reset link is opened from an email, signed in or not. */}
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/change-password" element={<ChangePasswordRoute />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="/account" element={<Account />} />
          <Route element={<RequirePermission permission="user.manage" />}>
            <Route path="/users" element={<Users />} />
            <Route path="/staff-efficiency" element={<StaffEfficiency />} />
          </Route>
          <Route element={<RequirePermission permission="audit.view" />}>
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/automation-log" element={<AutomationLog />} />
          </Route>
          <Route path="/master-data" element={<MasterData />} />
          <Route path="/master-data/:register" element={<MasterData />} />
          <Route path="/locations" element={<ToRegister to="locations" />} />
          <Route path="/companies" element={<ToRegister to="business-units" />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/contacts" element={<ToRegister to="buyers-suppliers" />} />
          <Route path="/buyers" element={<ToRegister to="buyers-suppliers" />} />
          <Route path="/suppliers" element={<ToRegister to="buyers-suppliers" />} />
          <Route path="/counts" element={<ToRegister to="counts" />} />
          <Route element={<RequirePermission permission="deal.read" />}>
            <Route path="/deals" element={<Deals />} />
          </Route>
          <Route path="/sales-confirmations" element={<SalesConfirmations />} />
          <Route element={<RequirePermission permission="deal.read" />}>
            <Route path="/pending-confirmations" element={<PendingConfirmations />} />
          </Route>
          <Route path="/pending-dispatches" element={<PendingDispatches />} />
          <Route path="/pending-documents" element={<PendingDocuments />} />
          <Route path="/pending-commission-bills" element={<PendingCommissionBills />} />
          <Route path="/commission-invoices" element={<CommissionInvoices />} />
          <Route element={<RequirePermission permission="report.view" />}>
            <Route path="/staff-performance" element={<StaffPerformance />} />
          </Route>
          <Route path="/cheque-collections" element={<ToTasks view="cheques" />} />
          <Route path="/cheque-deposits" element={<ToTasks view="cheques" />} />
          <Route path="/collection-activity" element={<CollectionActivity />} />
          <Route path="/office-activity" element={<OfficeActivity />} />
          <Route path="/transporter-payments" element={<TransporterPayments />} />
          <Route path="/trip-sheets" element={<TripSheets />} />
          <Route path="/transporter-type-details" element={<TransporterTypeDetails />} />
          <Route path="/transport-invoices" element={<TransportInvoices />} />
          <Route path="/staff-expenses" element={<StaffExpenses />} />
          <Route path="/sales-dashboard" element={<SalesDashboard />} />
          <Route path="/billing-dashboard" element={<BillingDashboard />} />
          <Route path="/collection-dashboard" element={<CollectionDashboard />} />
          <Route path="/collection-tasks" element={<ToTasks view="payments" />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/my" element={<MyTasks />} />
          <Route path="/pending-transporter-invoices" element={<PendingTransporterInvoices />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/transportation" element={<ToRegister to="transport" />} />
          <Route path="/job-process" element={<ToRegister to="delivery-address" />} />
          <Route path="/payment-terms" element={<ToRegister to="payment-terms" />} />
          <Route path="/mailing-list" element={<MailingList />} />
          <Route path="*" element={<NotBuiltYet />} />
        </Route>
      </Route>
    </Routes>
  )
}

function NotBuiltYet() {
  return (
    <div className="card pad narrow-card">
      <h2 className="card-title">Not built yet</h2>
      <p className="muted">
        This screen arrives with the deal tables in the next build step. The identity and
        permission layer it will sit on is already in place.
      </p>
    </div>
  )
}