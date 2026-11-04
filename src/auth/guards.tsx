/** Route guards.
 *
 * These keep the wrong screen off the page; they are not the security boundary.
 * The API checks every permission again on every request, because anything the
 * browser decides can be bypassed by anyone willing to open the console. */

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { Loading } from '../components/Loading'

export function RequireAuth() {
  const { me, ready } = useAuth()
  const location = useLocation()

  if (!ready) return <Loading label="Checking your session" />
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  // Everything is out of reach until a forced password change is done.
  if (me.must_change_password) return <Navigate to="/change-password" replace />
  return <Outlet />
}

export function RequireGuest() {
  const { me, ready } = useAuth()
  if (!ready) return <Loading label="Loading" />
  if (me?.must_change_password) return <Navigate to="/change-password" replace />
  if (me) return <Navigate to="/" replace />
  return <Outlet />
}

export function RequirePermission({ permission }: { permission: string }) {
  const { can, meta } = useAuth()
  if (can(permission)) return <Outlet />

  const label = meta?.permission_catalogue.find((p) => p.key === permission)?.label
  return (
    <div className="card pad narrow-card">
      <h2 className="card-title">Not available to your account</h2>
      <p className="muted">
        This screen needs the “{label ?? permission}” permission. An administrator can grant it
        under Users.
      </p>
    </div>
  )
}