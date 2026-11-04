/** Change your own password. Doubles as the forced first-sign-in screen: a new
 *  account starts with a password the administrator knows, so it has to be
 *  replaced before anything else is reachable. */

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminAction } from '../api/client'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { BrandMark } from '../components/BrandMark'
import { PasswordField, checkPassword } from '../components/PasswordField'

export default function ChangePassword() {
  const { me, config, signOut } = useAuth()
  const navigate = useNavigate()
  const forced = me?.must_change_password ?? false

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Hand over to the sign-in page once the change has landed. The timer is
  // cleared on unmount — an orphaned one would navigate a later screen away.
  useEffect(() => {
    if (!done) return undefined
    const timer = window.setTimeout(() => navigate('/login', { replace: true }), 1600)
    return () => window.clearTimeout(timer)
  }, [done, navigate])

  const requirements = useMemo(
    () =>
      checkPassword(next, config?.password_policy ?? null, {
        email: me?.email,
        name: me?.name,
      }),
    [next, config, me],
  )
  const ready =
    requirements.every((r) => r.met) && next === confirm && next.length > 0 && current.length > 0

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (!me) throw new Error('Not signed in')
      // Re-prove the current password before changing it -- updateUser()
      // alone does not ask for it, since Supabase assumes an existing
      // session is already enough proof of identity.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: me.email,
        password: current,
      })
      if (reauthError) throw new Error('Current password is incorrect')

      const { error: updateError } = await supabase.auth.updateUser({
        password: next,
        data: { must_change_password: false },
      })
      if (updateError) throw updateError

      await supabase.from('profiles').update({ must_change_password: false }).eq('id', me.id)

      // Best-effort -- not having this only means other devices stay signed
      // in until their token naturally expires, not that the change failed.
      try {
        await adminAction('revoke_other_sessions')
      } catch {
        /* non-fatal */
      }

      setDone(true)
      setCurrent('')
      setNext('')
      setConfirm('')
      await signOut()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="auth-single">
        <div className="auth-card">
          <BrandMark org={config?.org} compact />
          <h2>Password changed</h2>
          <div className="notice" role="status">
            Signed out everywhere for safety. Taking you to the sign-in page…
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-single">
      <div className="auth-card">
        <BrandMark org={config?.org} compact />
        <h2>{forced ? 'Choose your own password' : 'Change your password'}</h2>

        {forced ? (
          <div className="notice" role="status">
            Your account was set up with a starting password that whoever created it can see.
            Replace it now and nobody but you will know it.
          </div>
        ) : (
          <p className="muted">
            You will be signed out on every device, including this one, and can sign back in with
            the new password.
          </p>
        )}

        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          <PasswordField
            id="current-password"
            label={forced ? 'The password you were given' : 'Current password'}
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            autoFocus
          />
          <PasswordField
            id="new-password"
            label="New password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            requirements={requirements}
          />
          <PasswordField
            id="confirm-password"
            label="Type it again"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            hint={confirm && confirm !== next ? 'These two do not match yet.' : undefined}
          />
          <button className="btn primary block" type="submit" disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Save the new password'}
          </button>
        </form>

        {forced && (
          <div className="auth-links">
            <button className="btn ghost sm" type="button" onClick={() => void signOut()}>
              Sign out instead
            </button>
          </div>
        )}
      </div>
    </div>
  )
}