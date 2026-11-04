/** The sign-in page.
 *
 * The connection is what gets encrypted — serve this over HTTPS and the
 * password never crosses the network readable. Supabase Auth then hashes it
 * with bcrypt and stores it that way, so nobody, administrator included, can
 * read it back. The note at the foot of the panel says so in plain words,
 * because users ask. */

import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { PasswordField } from '../components/PasswordField'
import { BrandMark } from '../components/BrandMark'

export default function Login() {
  const { signIn, config } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)

  const from = (location.state as { from?: string } | null)?.from

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setLocked(false)
    setBusy(true)
    try {
      const me = await signIn(email.trim(), password)
      setPassword('')
      if (me.must_change_password) navigate('/change-password', { replace: true })
      else navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (caught) {
      const status = (caught as { status?: number } | null)?.status
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.')
      setLocked(status === 429)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <BrandMark org={config?.org} />
        <h1 className="auth-headline">
          One deal, from the buyer’s enquiry to the commission in the bank.
        </h1>
        <ol className="auth-flow" aria-label="What the system covers">
          <li>Enquiries and mill quotations</li>
          <li>Buyer approval and the confirmed order</li>
          <li>Production, QC and shipment</li>
          <li>Invoice, payment and commission recovery</li>
          <li>Audited close</li>
        </ol>
        <p className="auth-aside-foot small">
          Accounts are created by your administrator, with the permissions your role needs.
        </p>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <h2>Sign in</h2>
          <p className="muted">
            {config?.org.name ?? 'Commission Desk'} — use the email address your administrator
            set up.
          </p>

          {error && (
            <div className={locked ? 'alert warn' : 'alert'} role="alert">
              {error}
              {locked && (
                <>
                  {' '}
                  <Link to="/forgot-password">Reset your password</Link> to get straight back in.
                </>
              )}
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoFocus
                required
                spellCheck={false}
                disabled={busy}
              />
            </div>

            <PasswordField
              id="password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              disabled={busy}
            />

            <button className="btn primary block" type="submit" disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="auth-links">
            <Link to="/forgot-password">Forgotten your password?</Link>
          </div>

          <p className="auth-note small muted">
            Your password is hashed with bcrypt, never stored in a form anyone can read — an
            administrator can reset it, not look it up. Sign in over HTTPS and it is encrypted in
            transit too.
          </p>
        </div>
      </main>
    </div>
  )
}