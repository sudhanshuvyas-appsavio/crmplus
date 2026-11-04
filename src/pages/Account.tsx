/** My account: where I am signed in, and how to change my password.
 *
 * The old screen listed every active session (device, IP, last used) by
 * reading the app's own sessions table. Supabase Auth does not expose a
 * per-device session list to the browser -- only its admin API can see
 * that, and that lives in the Edge Function now -- so this screen offers
 * "sign out everywhere else" as a single action rather than a list to pick
 * from. */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, adminAction } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { formatDate } from '../lib/format'

export default function Account() {
  const { me, meta } = useAuth()
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function revokeOthers() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await adminAction<{ message: string }>('revoke_other_sessions')
      setMessage(result.message)
    } catch (caught) {
      setMessage(caught instanceof ApiError ? caught.message : 'Could not sign out the others')
    } finally {
      setBusy(false)
    }
  }

  if (!me) return <Loading />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>My account</h1>
          <p className="page-sub">{me.email}</p>
        </div>
      </header>

      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}

      <div className="two-col">
        <section className="card pad">
          <h2 className="card-title">Details</h2>
          <dl className="kv">
            <dt>Name</dt>
            <dd>{me.name}</dd>
            <dt>Job title</dt>
            <dd>{me.job_title ?? '—'}</dd>
            <dt>Account type</dt>
            <dd>
              {me.is_admin
                ? 'Administrator — every permission'
                : `${me.permissions.length} permissions`}
            </dd>
            <dt>Profile it started from</dt>
            <dd>
              {meta?.profile_templates.find((t) => t.id === me.profile_template)?.label ?? 'Custom'}
            </dd>
            <dt>Account created</dt>
            <dd>{formatDate(me.created_at)}</dd>
          </dl>
          <p className="small">
            <Link to="/change-password">Change my password →</Link>
          </p>
          <p className="small muted">
            Changing it signs you out on every device. Nobody, including an administrator, can read
            your current password — it is hashed, not encrypted.
          </p>
        </section>

        <section className="card pad">
          <h2 className="card-title">Other devices</h2>
          <p className="muted small">
            If you signed in somewhere you no longer recognise, use this to end every session
            except this one. It takes effect immediately.
          </p>
          <button className="btn" type="button" onClick={() => void revokeOthers()} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out every other device'}
          </button>
        </section>
      </div>

      <section className="card pad">
        <h2 className="card-title">Your permissions</h2>
        {me.is_admin && (
          <p className="muted small">
            You are an administrator, so you hold everything in the catalogue — including
            permissions added in a future release.
          </p>
        )}
        <div className="matrix-readonly">
          {(meta?.permission_groups ?? []).map((group) => {
            const items = (meta?.permission_catalogue ?? []).filter((p) => p.group === group)
            const held = items.filter((p) => me.permissions.includes(p.key))
            if (!held.length) return null
            return (
              <div key={group}>
                <h3>{group}</h3>
                <ul>
                  {held.map((permission) => (
                    <li key={permission.key}>{permission.label}</li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}