/** The one Supabase client for the whole app.
 *
 * There is no server of ours between the browser and the database anymore --
 * every table read/write goes through PostgREST with the anon key below, and
 * every request is checked by the RLS policies and triggers in
 * supabase/migrations/. This key is meant to be public: it identifies the
 * project, it does not grant access on its own. */

import { createClient } from '@supabase/supabase-js'

// Both are inlined at build time by vite.config.ts, which picks them out of
// the environment by name (never the whole SUPABASE_ prefix).
const url = import.meta.env.SUPABASE_URL as string | undefined
const anonKey = import.meta.env.SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error(
    'Missing SUPABASE_URL / SUPABASE_ANON_KEY. Set them as environment variables ' +
      '(the Supabase Vercel integration does this for production; add them to Preview too, ' +
      'or put VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env locally).',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/** The Edge Function base URL, for the handful of admin actions (creating a
 *  user, resetting someone else's password, listing/revoking sessions) that
 *  need the service_role key (so cannot run in the browser). */
export const functionsUrl = `${url}/functions/v1`