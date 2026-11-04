/** The one place that calls the admin-users Edge Function -- the only server
 *  code left in this app, for the handful of actions that need the
 *  service_role key (see supabase/functions/admin-users/index.ts). Every
 *  other read/write goes straight through supabase-js against the database,
 *  RLS-checked, with no client of ours in between. */

import { supabase, functionsUrl } from '../lib/supabase'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  get isUnauthenticated() {
    return this.status === 401
  }
}

export async function adminAction<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new ApiError(401, 'Not signed in')

  let response: Response
  try {
    response = await fetch(`${functionsUrl}/admin-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, ...payload }),
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.')
  }

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(response.status, (body as { error?: string }).error ?? `Request failed (${response.status})`)
  }
  return body as T
}