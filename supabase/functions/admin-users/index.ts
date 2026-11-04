// admin-users
//
// The one place in this app that still needs the service_role key, because
// three things are impossible from the browser no matter what RLS allows:
//   - creating a new auth.users row with a temporary password (the
//     old POST /api/users, which handed back a starting password to pass
//     on by hand)
//   - resetting someone ELSE's password (the old POST /api/users/:id/password)
//   - signing out a user's other sessions (the old
//     POST /api/auth/sessions/revoke-others)
//
// Every action here re-derives who is calling from their own JWT (never
// trusts a client-supplied user id for "who am I"), then checks permissions
// against the same public.profiles the rest of the app relies on -- using
// the service-role client only for the one privileged step each action
// actually needs.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// The app runs on another origin (Vercel, localhost), so the browser sends a
// CORS preflight before every call. A wildcard origin is safe here: callers
// authenticate with a bearer token, not cookies, and every action re-checks
// that token below.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function randomPassword(): string {
  const words = ['harbor', 'violet', 'cactus', 'meadow', 'granite', 'ember', 'willow', 'copper',
    'quartz', 'plume', 'basil', 'cedar', 'orbit', 'tundra', 'flint', 'lagoon']
  const pick = () => words[Math.floor(Math.random() * words.length)]
  return `${pick()}-${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`
}

async function callingProfile(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) return null

  const anon = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error } = await anon.auth.getUser(token)
  if (error || !userData.user) return null

  const { data: profile } = await admin
    .from('profiles')
    .select('id, is_admin, is_active')
    .eq('id', userData.user.id)
    .single()

  return profile ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const action = body.action as string | undefined
  const caller = await callingProfile(req)
  if (!caller || !caller.is_active) return json({ error: 'Not signed in' }, 401)

  if (action === 'create_user') {
    if (!caller.is_admin) return json({ error: 'Only an administrator can create accounts' }, 403)

    const email = String(body.email ?? '').trim().toLowerCase()
    const name = String(body.name ?? '').trim()
    if (!email || !name) return json({ error: 'name and email are required' }, 400)

    const initialPassword = randomPassword()
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: initialPassword,
      email_confirm: true,
      user_metadata: { name },
    })
    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? 'Could not create the account' }, 400)
    }

    await admin
      .from('profiles')
      .update({
        name,
        job_title: (body.job_title as string | null) ?? null,
        is_admin: Boolean(body.is_admin),
        profile_template: (body.profile_template as string | null) ?? null,
        must_change_password: true,
      })
      .eq('id', created.user.id)

    const permissions = Array.isArray(body.permissions) ? (body.permissions as string[]) : []
    if (permissions.length) {
      await admin.from('user_permissions').insert(
        permissions.map((key) => ({ user_id: created.user!.id, permission: key, granted_by: caller.id })),
      )
    }

    return json({
      id: created.user.id,
      email,
      name,
      initial_password: initialPassword,
    })
  }

  if (action === 'reset_password') {
    if (!caller.is_admin) return json({ error: 'Only an administrator can reset another password' }, 403)
    const userId = String(body.user_id ?? '')
    if (!userId) return json({ error: 'user_id is required' }, 400)

    const newPassword = randomPassword()
    const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
    if (error) return json({ error: error.message }, 400)

    await admin.from('profiles').update({ must_change_password: true }).eq('id', userId)

    return json({ message: 'Password reset. Pass on the new one shown here.', initial_password: newPassword })
  }

  if (action === 'revoke_other_sessions') {
    const { error } = await admin.auth.admin.signOut(caller.id, 'others')
    if (error) return json({ error: error.message }, 400)
    return json({ message: 'Signed out everywhere else.' })
  }

  return json({ error: `Unknown action: ${action}` }, 400)
})
