/** Who is signed in, and what they may do.
 *
 * Supabase Auth holds the session (a JWT in localStorage, refreshed
 * automatically) -- this provider layers the app's own idea of "me" on top:
 * the profiles row, the permission grants, and the org/catalogue data the
 * rest of the app reads via `meta`/`config`, the same shape the old
 * /api/meta and /api/config endpoints returned. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '../lib/supabase'
import { PASSWORD_POLICY, PROFILE_TEMPLATES } from '../api/types'
import type { Me, Meta, PermissionDef, PublicConfig } from '../api/types'

interface AuthValue {
  /** null once we know nobody is signed in; undefined while we are still asking. */
  me: Me | null | undefined
  meta: Meta | null
  config: PublicConfig | null
  ready: boolean
  signIn: (email: string, password: string) => Promise<Me>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  /** True when this user holds the permission. Administrators hold all of them. */
  can: (...permissions: string[]) => boolean
  canAny: (...permissions: string[]) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

async function loadOrg(): Promise<PublicConfig['org']> {
  // Branding comes from whichever row in `companies` is flagged is_home --
  // the multi-record Companies object replaced the old org_settings
  // singleton, but exactly one company can still stand in for "us".
  const { data } = await supabase
    .from('companies')
    .select('name, short_name, currency')
    .eq('is_home', true)
    .maybeSingle()
  return data ?? { name: 'Commission Desk', short_name: 'CD', currency: 'USD' }
}

async function loadMe(userId: string, email: string): Promise<Me | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, name, job_title, is_admin, is_active, must_change_password, profile_template, last_login_at, created_at')
    .eq('id', userId)
    .maybeSingle()
  if (!profile) return null

  const { data: grants } = await supabase.from('user_permissions').select('permission').eq('user_id', userId)
  const granted = (grants ?? []).map((g) => g.permission as string)

  let permissions = granted
  if (profile.is_admin) {
    const { data: catalogue } = await supabase.from('permission_catalogue').select('key')
    permissions = (catalogue ?? []).map((c) => c.key as string)
  }

  return {
    id: profile.id,
    email: profile.email ?? email,
    name: profile.name,
    job_title: profile.job_title,
    is_admin: profile.is_admin,
    is_active: profile.is_active,
    must_change_password: profile.must_change_password,
    profile_template: profile.profile_template,
    last_login_at: profile.last_login_at,
    created_at: profile.created_at,
    permissions,
    granted_permissions: granted,
  }
}

async function loadCatalogue(): Promise<{ catalogue: PermissionDef[]; groups: string[] }> {
  const { data } = await supabase
    .from('permission_catalogue')
    .select('key, label, group_name, hint, dangerous')
    .order('sort_order')
  const catalogue: PermissionDef[] = (data ?? []).map((row) => ({
    key: row.key,
    label: row.label,
    group: row.group_name,
    hint: row.hint,
    dangerous: row.dangerous,
  }))
  const groups = Array.from(new Set(catalogue.map((p) => p.group)))
  return { catalogue, groups }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [ready, setReady] = useState(false)

  const loadMeta = useCallback(async (user: Me, org: PublicConfig['org']) => {
    if (user.must_change_password) {
      setMeta(null)
      return
    }
    try {
      const { catalogue, groups } = await loadCatalogue()
      setMeta({
        org,
        user,
        permission_catalogue: catalogue,
        permission_groups: groups,
        profile_templates: PROFILE_TEMPLATES,
        password_policy: PASSWORD_POLICY,
        mail_enabled: true,
      })
    } catch {
      setMeta(null)
    }
  }, [])

  const loadAll = useCallback(async () => {
    const org = await loadOrg()
    setConfig({ org, mail_enabled: true, password_policy: PASSWORD_POLICY, needs_bootstrap: false })

    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      setMe(null)
      setReady(true)
      return
    }

    const user = await loadMe(session.user.id, session.user.email ?? '')
    setMe(user)
    if (user) await loadMeta(user, org)
    setReady(true)
  }, [loadMeta])

  useEffect(() => {
    void loadAll()
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setMe(null)
        setMeta(null)
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void loadAll()
      }
    })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const user = await loadMe(data.user.id, data.user.email ?? email)
    if (!user) throw new Error('Signed in, but no profile was found for this account.')

    // Best-effort -- last_login_at is a courtesy field, not something a
    // failed write here should block sign-in over.
    void supabase.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', user.id)

    setMe(user)
    const org = await loadOrg()
    await loadMeta(user, org)
    return user
  }, [loadMeta])

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } finally {
      setMe(null)
      setMeta(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      setMe(null)
      return
    }
    const user = await loadMe(session.user.id, session.user.email ?? '')
    setMe(user)
    if (user) {
      const org = await loadOrg()
      await loadMeta(user, org)
    }
  }, [loadMeta])

  const value = useMemo<AuthValue>(() => {
    const held = new Set(me?.permissions ?? [])
    return {
      me,
      meta,
      config,
      ready,
      signIn,
      signOut,
      refresh,
      can: (...permissions: string[]) => permissions.every((p) => held.has(p)),
      canAny: (...permissions: string[]) => permissions.some((p) => held.has(p)),
    }
  }, [me, meta, config, ready, signIn, signOut, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}