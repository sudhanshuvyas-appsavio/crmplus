/** Opened from the emailed reset link. Supabase puts the visitor into a
 *  short-lived "recovery" session by parsing the link itself (a hash
 *  fragment, not a query param we read) -- this page just waits for that,
 *  then calls updateUser() to set the new password. */

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { BrandMark } from '../components/BrandMark'
import { PasswordField, checkPassword } from '../components/PasswordField'

export default function ResetPassword() {
  const { config } = useAuth()
  const navigate = useNavigate()

  const [recoveryReady, setRecoveryReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryReady(true)
        setChecking(false)
      }
    })
    // The event above fires only for a fresh link; if this page was
    // reloaded after Supabase already established the recovery session,
    // fall back to checking whether a session simply exists.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setRecoveryReady(true)
      setChecking(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!done) return undefined
    const timer = window.setTimeout(() => navigate('/login', { replace: true }), 1800)
    return () => window.clearTimeout(timer)
  }, [done, navigate])

  const requirements = useMemo(
    () => checkPassword(password, config?.password_policy ?? null),
    [password, config],
  )
  const ready = requirements.every((r) => r.met) && password === confirm && password.length > 0

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setDone(true)
      setPassword('')
      setConfirm('')
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
        <h2>Choose a new password</h2>

        {checking ? (
          <div className="notice" role="status">
            Checking your reset link…
          </div>
        ) : !recoveryReady ? (
          <>
            <div className="alert" role="alert">
              This link has expired or was already used. Request a new one.
            </div>
            <div className="auth-links">
              <Link to="/forgot-password">Request a new link</Link>
            </div>
          </>
        ) : done ? (
          <>
            <div className="notice" role="status">
              Password set. Taking you to the sign-in page…
            </div>
            <div className="auth-links">
              <Link to="/login">Sign in now</Link>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Pick something you do not use anywhere else. A passphrase of three or four unrelated
              words is both stronger and easier to remember than a short one with symbols in it.
            </p>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={onSubmit} noValidate>
              <PasswordField
                id="new-password"
                label="New password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                autoFocus
                requirements={requirements}
              />
              <PasswordField
                id="confirm-password"
                label="Type it again"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                hint={
                  confirm && confirm !== password ? 'These two do not match yet.' : undefined
                }
              />
              <button className="btn primary block" type="submit" disabled={busy || !ready}>
                {busy ? 'Saving…' : 'Set the password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}