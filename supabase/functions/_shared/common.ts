// Helpers shared by the messaging Edge Functions (send-message, whatsapp-webhook).
// Nothing here logs secrets or message bodies.

import { createClient } from 'jsr:@supabase/supabase-js@2'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
export const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

/** Service-role client: bypasses RLS, so every caller check happens in code. */
export const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/** Compares two strings without stopping at the first difference. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/** Adds a 'message' line to a task's timeline (service role, so no created_by). */
export async function logTaskMessageEvent(
  taskId: string | null,
  note: string,
  data: Record<string, unknown>,
  toValue: string | null,
  dedupeKey: string,
): Promise<void> {
  if (!taskId) return
  const { error } = await admin.from('task_events').insert({
    task_id: taskId,
    kind: 'message',
    to_value: toValue,
    note,
    data,
    dedupe_key: dedupeKey,
  })
  // A repeated key (23505) just means this exact event is already on the timeline.
  if (error && error.code !== '23505') console.error('task_events insert failed:', error.code)
}
