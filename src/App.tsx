import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAuth, RequireGuest, RequirePermission } from './auth/guards'
import { useAuth } from './auth/AuthProvider'
import { Loading } from './components/Loading'
import Account from './pages/Account'
import AuditLog from './pages/AuditLog'
import ChangePassword from './pages/ChangePassword'
import ForgotPassword from './pages/ForgotPassword'
import Home from './pages/Home'
import Login from './pages/Login'
import Companies from './pages/Companies'
import Contacts from './pages/Contacts'
import Counts from './pages/Counts'
import JobProcesses from './pages/JobProcesses'
import PendingConfirmations from './pages/PendingConfirmations'
import PendingDispatches from './pages/PendingDispatches'
import PendingDocuments from './pages/PendingDocuments'
import Orders from './pages/Orders'
import Transporters from './pages/Transporters'
import SalesConfirmations from './pages/SalesConfirmations'
import Deals from './pages/Deals'
import MailingList from './pages/MailingList'
import PendingCommissionBills from './pages/PendingCommissionBills'
import PendingTransporterInvoices from './pages/PendingTransporterInvoices'
import StaffEfficiency from './pages/StaffEfficiency'
import CollectionTasks from './pages/CollectionTasks'
import StaffPerformance from './pages/StaffPerformance'
import ChequeCollections from './pages/ChequeCollections'
import ChequeDeposits from './pages/ChequeDeposits'
import CollectionActivity from './pages/CollectionActivity'
import OfficeActivity from './pages/OfficeActivity'
import TransporterPayments from './pages/TransporterPayments'
import TripSheets from './pages/TripSheets'
import StaffExpenses from './pages/StaffExpenses'
import SalesDashboard from './pages/SalesDashboard'
import BillingDashboard from './pages/BillingDashboard'
import CollectionDashboard from './pages/CollectionDashboard'
import PaymentTerms from './pages/PaymentTerms'
import Leads from './pages/Leads'
import ResetPassword from './pages/ResetPassword'
import Users from './pages/Users'

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
          </Route>
          <Route path="/companies" element={<Companies />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/buyers" element={<Navigate to="/contacts" replace />} />
          <Route path="/suppliers" element={<Navigate to="/contacts" replace />} />
          <Route path="/counts" element={<Counts />} />
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
          <Route element={<RequirePermission permission="report.view" />}>
            <Route path="/staff-performance" element={<StaffPerformance />} />
          </Route>
          <Route path="/cheque-collections" element={<ChequeCollections />} />
          <Route path="/cheque-deposits" element={<ChequeDeposits />} />
          <Route path="/collection-activity" element={<CollectionActivity />} />
          <Route path="/office-activity" element={<OfficeActivity />} />
          <Route path="/transporter-payments" element={<TransporterPayments />} />
          <Route path="/trip-sheets" element={<TripSheets />} />
          <Route path="/staff-expenses" element={<StaffExpenses />} />
          <Route path="/sales-dashboard" element={<SalesDashboard />} />
          <Route path="/billing-dashboard" element={<BillingDashboard />} />
          <Route path="/collection-dashboard" element={<CollectionDashboard />} />
          <Route path="/collection-tasks" element={<CollectionTasks />} />
          <Route path="/pending-transporter-invoices" element={<PendingTransporterInvoices />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/transportation" element={<Transporters />} />
          <Route path="/job-process" element={<JobProcesses />} />
          <Route path="/payment-terms" element={<PaymentTerms />} />
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