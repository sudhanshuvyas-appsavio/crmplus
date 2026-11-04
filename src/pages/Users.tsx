/** Users and permissions — the administrator's screen.
 *
 * Creating an account calls the admin-users Edge Function (the one place
 * that still needs the service_role key) and gets back a starting password
 * shown once, same as before — nobody stores it anywhere readable, and the
 * person has to replace it before they can use the app. Editing an existing
 * user's name, profile or permissions is a plain table write straight
 * through Supabase, checked by the same RLS policy an admin action always
 * was: `is_admin()`. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, adminAction } from '../api/client'
import { supabase } from '../lib/supabase'
import { PROFILE_TEMPLATES } from '../api/types'
import type { ProfileTemplate, UserDetail } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { PermissionMatrix } from '../components/PermissionMatrix'
import { formatDateTime } from '../lib/format'

type Editing =
  | { mode: 'create' }
  | { mode: 'edit'; user: UserDetail }
  | null

async function loadUsers(): Promise<UserDetail[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      // user_permissions points at profiles twice (user_id and granted_by), so
      // the embed must name which foreign key to follow or PostgREST refuses it.
      'id, email, name, job_title, is_admin, is_active, must_change_password, profile_template, last_login_at, created_at, user_permissions!user_permissions_user_id_fkey(permission)',
    )
    .order('name')
  if (error) throw error

  return (data ?? []).map((row) => {
    const granted = (row.user_permissions ?? []).map((p: { permission: string }) => p.permission)
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      job_title: row.job_title,
      is_admin: row.is_admin,
      is_active: row.is_active,
      must_change_password: row.must_change_password,
      profile_template: row.profile_template,
      last_login_at: row.last_login_at,
      created_at: row.created_at,
      permissions: granted,
      granted_permissions: granted,
      created_by_name: null,
      active_sessions: 0,
    }
  })
}

export default function Users() {
  const { meta, me, refresh } = useAuth()
  const [users, setUsers] = useState<UserDetail[] | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setUsers(await loadUsers())
    } catch (caught) {
      setBanner({ kind: 'bad', text: caught instanceof Error ? caught.message : 'Could not load users' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!meta) return <Loading label="Loading" />
  if (!users && banner?.kind === 'bad') {
    return (
      <div className="card pad narrow-card">
        <h2 className="card-title">Could not load users</h2>
        <p className="muted">{banner.text}</p>
        <button className="btn" type="button" onClick={() => { setBanner(null); void load() }}>
          Try again
        </button>
      </div>
    )
  }
  if (!users) return <Loading label="Loading users" />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Users &amp; permissions</h1>
          <p className="page-sub">
            Each person holds their own set of permissions. Administrators hold all of them.
          </p>
        </div>
        <button className="btn primary" type="button" onClick={() => setEditing({ mode: 'create' })}>
          Add a user
        </button>
      </header>

      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="notice small">
        The starting password is shown here once when you create an account or reset someone's
        password — pass it on by a route you trust.
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Profile</th>
              <th className="right">Permissions</th>
              <th>Status</th>
              <th>Last signed in</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="clickable"
                onClick={() => setEditing({ mode: 'edit', user })}
              >
                <td>
                  <strong>{user.name}</strong>
                  {user.job_title && <div className="small muted">{user.job_title}</div>}
                </td>
                <td className="mono">{user.email}</td>
                <td>
                  {user.is_admin ? (
                    <span className="chip brand">Administrator</span>
                  ) : (
                    <span className="chip">
                      {PROFILE_TEMPLATES.find((t) => t.id === user.profile_template)?.label ??
                        'Custom'}
                    </span>
                  )}
                </td>
                <td className="right mono">
                  {user.is_admin ? 'all' : user.granted_permissions.length}
                </td>
                <td>
                  {!user.is_active ? (
                    <span className="chip bad">Disabled</span>
                  ) : user.must_change_password ? (
                    <span className="chip warn">Must set a password</span>
                  ) : (
                    <span className="chip good">Active</span>
                  )}
                </td>
                <td className="mono small">
                  {user.last_login_at ? formatDateTime(user.last_login_at) : 'never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserDrawer
          key={editing.mode === 'edit' ? editing.user.id : 'create'}
          editing={editing}
          templates={meta.profile_templates}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setBanner({ kind: 'ok', text: message })
            setEditing(null)
            await load()
            // If the administrator edited their own account, refresh our own
            // permissions so the navigation reflects it immediately.
            if (editing.mode === 'edit' && editing.user.id === me?.id) await refresh()
          }}
          onError={(message) => setBanner({ kind: 'bad', text: message })}
        />
      )}
    </>
  )
}

interface DrawerProps {
  editing: NonNullable<Editing>
  templates: ProfileTemplate[]
  onClose: () => void
  onSaved: (message: string) => void | Promise<void>
  onError: (message: string) => void
}

function UserDrawer({ editing, templates, onClose, onSaved, onError }: DrawerProps) {
  const { meta, me } = useAuth()
  const creating = editing.mode === 'create'
  const existing = editing.mode === 'edit' ? editing.user : null

  const [name, setName] = useState(existing?.name ?? '')
  const [email, setEmail] = useState(existing?.email ?? '')
  const [jobTitle, setJobTitle] = useState(existing?.job_title ?? '')
  const [templateId, setTemplateId] = useState(existing?.profile_template ?? 'sales')
  const [isAdmin, setIsAdmin] = useState(existing?.is_admin ?? false)
  const [isActive, setIsActive] = useState(existing?.is_active ?? true)
  const [permissions, setPermissions] = useState<string[]>(
    existing?.granted_permissions ?? templates.find((t) => t.id === 'sales')?.permissions ?? [],
  )
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ name: string; email: string; initial_password: string } | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState<string | null>(null)

  const template = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId])

  function applyTemplate(id: string) {
    setTemplateId(id)
    const next = templates.find((t) => t.id === id)
    if (next) setPermissions(next.permissions)
  }

  async function save() {
    setBusy(true)
    try {
      if (creating) {
        const result = await adminAction<{ id: string; name: string; email: string; initial_password: string }>(
          'create_user',
          {
            email: email.trim(),
            name: name.trim(),
            job_title: jobTitle.trim() || null,
            profile_template: templateId,
            permissions,
            is_admin: isAdmin,
          },
        )
        setCreated(result) // show the starting password once, then the administrator passes it on
      } else if (existing) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            name: name.trim(),
            job_title: jobTitle.trim() || null,
            profile_template: templateId,
            is_admin: isAdmin,
            is_active: isActive,
          })
          .eq('id', existing.id)
        if (profileError) throw profileError

        const before = new Set(existing.granted_permissions)
        const after = new Set(permissions)
        const toAdd = permissions.filter((p) => !before.has(p))
        const toRemove = existing.granted_permissions.filter((p) => !after.has(p))

        if (toRemove.length) {
          const { error } = await supabase
            .from('user_permissions')
            .delete()
            .eq('user_id', existing.id)
            .in('permission', toRemove)
          if (error) throw error
        }
        if (toAdd.length) {
          const { error } = await supabase
            .from('user_permissions')
            .insert(toAdd.map((permission) => ({ user_id: existing.id, permission, granted_by: me?.id })))
          if (error) throw error
        }

        await onSaved(`${name} updated.`)
      }
    } catch (caught) {
      onError(caught instanceof ApiError || caught instanceof Error ? caught.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword() {
    if (!existing) return
    setBusy(true)
    try {
      const result = await adminAction<{ message: string; initial_password: string }>('reset_password', {
        user_id: existing.id,
      })
      setResetPasswordValue(result.initial_password)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not reset the password')
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <Drawer title="Account created" onClose={() => void onSaved(`${created.name} added.`)}>
        <div className="notice">
          <p>
            <strong>{created.name}</strong> can sign in with the email <code>{created.email}</code>{' '}
            and this starting password. Pass it on by a route you trust — it is shown once and is
            not stored anywhere readable.
          </p>
          <p className="password-reveal mono">{created.initial_password}</p>
          <p className="small">
            They will be asked to choose their own password before they can use the system.
          </p>
        </div>
        <div className="drawer-actions">
          <button className="btn primary" type="button" onClick={() => void onSaved(`${created.name} added.`)}>
            Done
          </button>
        </div>
      </Drawer>
    )
  }

  if (resetPasswordValue) {
    return (
      <Drawer title="Password reset" onClose={() => void onSaved('Password reset.')}>
        <div className="notice">
          <p>
            New starting password for <strong>{existing?.name}</strong>. Pass it on by a route you
            trust — it is shown once.
          </p>
          <p className="password-reveal mono">{resetPasswordValue}</p>
        </div>
        <div className="drawer-actions">
          <button className="btn primary" type="button" onClick={() => void onSaved('Password reset.')}>
            Done
          </button>
        </div>
      </Drawer>
    )
  }

  const editingSelf = existing?.id === me?.id

  return (
    <Drawer title={creating ? 'Add a user' : existing?.name ?? 'Edit user'} onClose={onClose}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="u-name">Full name</label>
          <input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="u-email">Email address</label>
          <input
            id="u-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!creating}
            spellCheck={false}
          />
          {!creating && <p className="field-hint">The sign-in address cannot be changed.</p>}
        </div>
        <div className="field">
          <label htmlFor="u-title">Job title</label>
          <input id="u-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="u-template">Start from a profile</label>
          <select id="u-template" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {template && <p className="field-hint">{template.description}</p>}
        </div>
      </div>

      <div className="switch-row">
        <label className="check">
          <input
            type="checkbox"
            checked={isAdmin}
            disabled={!me?.is_admin || (editingSelf && existing?.is_admin)}
            onChange={(e) => setIsAdmin(e.target.checked)}
          />
          <span className="check-body">
            <span className="check-label">
              Administrator
              <em className="tag warn">full access</em>
            </span>
            <span className="check-hint">
              Holds every permission, including any added later, and can manage users.
              {editingSelf && existing?.is_admin && ' You cannot remove your own administrator flag here.'}
            </span>
          </span>
        </label>

        {!creating && (
          <label className="check">
            <input
              type="checkbox"
              checked={isActive}
              disabled={editingSelf}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span className="check-body">
              <span className="check-label">Account enabled</span>
              <span className="check-hint">
                Switching this off blocks sign-in immediately.
                {editingSelf && ' You cannot disable your own account.'}
              </span>
            </span>
          </label>
        )}
      </div>

      <h3 className="section-title">Permissions</h3>
      <p className="muted small">
        The profile above is only a starting point. Tick exactly what this person needs — every
        table's row-level security policy checks these on every request.
      </p>
      <PermissionMatrix
        catalogue={meta?.permission_catalogue ?? []}
        groups={meta?.permission_groups ?? []}
        selected={permissions}
        onChange={setPermissions}
        impliedAll={isAdmin}
        disabled={busy}
      />

      <div className="drawer-actions">
        <button className="btn primary" type="button" onClick={() => void save()} disabled={busy || !name || !email}>
          {busy ? 'Saving…' : creating ? 'Create the account' : 'Save changes'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {!creating && (
          <button className="btn danger push" type="button" onClick={() => void resetPassword()} disabled={busy}>
            Reset their password
          </button>
        )}
      </div>
    </Drawer>
  )
}

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <button className="scrim" type="button" aria-label="Close" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  )
}