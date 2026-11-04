import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { BrandMark } from '../components/BrandMark'

export default function ForgotPassword() {
  const { config } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (sendError) throw sendError
      setSent(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-single">
      <div className="auth-card">
        <BrandMark org={config?.org} compact />
        <h2>Reset your password</h2>

        {sent ? (
          <>
            <div className="notice" role="status">
              If that email has an account, a reset link is on its way. It works once, and expires
              in an hour.
            </div>
            <div className="auth-links">
              <Link to="/login">Back to sign in</Link>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Enter the email address on your account and we will send you a link to choose a new
              password.
            </p>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={onSubmit} noValidate>
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
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
              <button className="btn primary block" type="submit" disabled={busy || !email}>
                {busy ? 'Sending…' : 'Send the reset link'}
              </button>
            </form>
            <div className="auth-links">
              <Link to="/login">Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}