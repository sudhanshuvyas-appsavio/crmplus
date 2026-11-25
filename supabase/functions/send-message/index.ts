// send-message
//
// Sends queued rows of public.messages through WhatsApp (Meta Cloud API
// template messages) or e-mail (Resend). Two ways in:
//
//   (a) a signed-in user's JWT: the caller must be active and hold
//       `message.send` or `task.manage` (admins pass). They send the `ids`
//       they pass (only rows they may see: their own, or any with
//       `message.view` / `task.manage`). `retry: true` first puts failed rows
//       back in the queue with attempts = 0 (the browser has no UPDATE policy
//       on messages, so the reset has to happen here).
//   (b) a header `x-cron-secret` equal to the CRON_SECRET secret: process every
//       due queued message (status queued, next_attempt_at <= now,
//       attempts < 3, limit 25). Called every minute by pg_cron + pg_net.
//
// Secrets (supabase secrets set ...): WHATSAPP_TOKEN, WHATSAPP_PHONE_ID,
// EMAIL_API_KEY, EMAIL_FROM, CRON_SECRET. With the secrets for a channel
// missing, the message is set to `manual` (not an error): the screen then
// offers a prefilled wa.me / mailto link instead.
//
// Never log secrets or message bodies: only ids, statuses and provider error
// text are ever written to the logs or the database.

import { admin, ANON_KEY, CORS_HEADERS, json, logTaskMessageEvent, safeEqual, SUPABASE_URL } from '../_shared/common.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MAX_ATTEMPTS = 3
const CRON_LIMIT = 25
const USER_LIMIT = 50
const FETCH_TIMEOUT_MS = 20_000

interface Msg {
  id: string
  channel: 'whatsapp' | 'email'
  template_key: string | null
  recipient: string
  task_id: string | null
  subject: string | null
  body: string
  variables: Record<string, unknown> | null
  document_path: string | null
  status: string
  attempts: number
  created_by: string | null
}

interface Template {
  key: string
  provider_template: string | null
  variables: string[]
}

interface Result {
  id: string
  status: string
  error?: string
}

type Outcome =
  | { kind: 'sent'; providerId: string | null }
  | { kind: 'manual' }
  | { kind: 'fatal'; error: string }
  | { kind: 'retry'; error: string }

// ---------------------------------------------------------------------------
// Who is calling
// ---------------------------------------------------------------------------

interface Caller {
  id: string
  seeAll: boolean
}

async function callingUser(req: Request): Promise<Caller | 'forbidden' | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null

  const anon = createClient(SUPABASE_URL, ANON_KEY)
  const { data: userData, error } = await anon.auth.getUser(token)
  if (error || !userData.user) return null

  const { data: profile } = await admin
    .from('profiles')
    .select('id, is_admin, is_active')
    .eq('id', userData.user.id)
    .single()
  if (!profile || !profile.is_active) return null

  const { data: perms } = await admin.from('user_permissions').select('permission').eq('user_id', profile.id)
  const held = new Set((perms ?? []).map((p: { permission: string }) => p.permission))

  const canSend = profile.is_admin || held.has('message.send') || held.has('task.manage')
  if (!canSend) return 'forbidden'
  return { id: profile.id, seeAll: profile.is_admin || held.has('message.view') || held.has('task.manage') }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** Template parameters may not hold new lines, tabs or runs of 4+ spaces, and may not be empty. */
function cleanParam(value: unknown): string {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim()
  return text === '' ? '-' : text
}

function describeProviderError(body: unknown, status: number): string {
  const e = (body as { error?: { message?: string; code?: number; error_data?: { details?: string } } } | null)?.error
  if (e) {
    const detail = e.error_data?.details ? ` (${e.error_data.details})` : ''
    return `${e.message ?? 'Provider error'}${detail}${e.code ? ` [code ${e.code}]` : ''}`.slice(0, 500)
  }
  const m = (body as { message?: string; error?: string } | null)
  return (m?.message ?? (typeof m?.error === 'string' ? m.error : `Provider answered HTTP ${status}`)).slice(0, 500)
}

async function sendWhatsapp(msg: Msg, tpl: Template | null): Promise<Outcome> {
  const token = Deno.env.get('WHATSAPP_TOKEN')
  const phoneId = Deno.env.get('WHATSAPP_PHONE_ID')
  if (!token || !phoneId) return { kind: 'manual' }

  if (!tpl?.provider_template) {
    return { kind: 'fatal', error: 'This template has no WhatsApp template name set (Tasks > Rules > Message templates).' }
  }

  const vars = msg.variables ?? {}
  const parameters = tpl.variables.map((name) => ({ type: 'text', text: cleanParam(vars[name]) }))
  const template: Record<string, unknown> = { name: tpl.provider_template, language: { code: 'en' } }
  if (parameters.length > 0) template.components = [{ type: 'body', parameters }]

  let res: Response
  try {
    res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: msg.recipient, type: 'template', template }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    return { kind: 'retry', error: 'Could not reach WhatsApp (network error or timeout).' }
  }

  const body = await res.json().catch(() => null)
  if (res.ok) {
    const id = (body as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id ?? null
    return { kind: 'sent', providerId: id }
  }
  return { kind: 'retry', error: describeProviderError(body, res.status) }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

async function sendEmail(msg: Msg): Promise<Outcome> {
  const apiKey = Deno.env.get('EMAIL_API_KEY')
  const from = Deno.env.get('EMAIL_FROM')
  if (!apiKey || !from) return { kind: 'manual' }

  const payload: Record<string, unknown> = {
    from,
    to: [msg.recipient],
    subject: msg.subject?.trim() || 'Message',
    text: msg.body,
  }

  if (msg.document_path) {
    const { data: file, error } = await admin.storage.from('task-proofs').download(msg.document_path)
    if (error || !file) return { kind: 'fatal', error: 'The attached document could not be read from storage.' }
    const filename = msg.document_path.split('/').pop()?.replace(/^[0-9a-fA-F-]{36}-/, '') || 'document'
    payload.attachments = [{ filename, content: toBase64(new Uint8Array(await file.arrayBuffer())) }]
  }

  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    return { kind: 'retry', error: 'Could not reach the e-mail provider (network error or timeout).' }
  }

  const body = await res.json().catch(() => null)
  if (res.ok) return { kind: 'sent', providerId: (body as { id?: string } | null)?.id ?? null }
  return { kind: 'retry', error: describeProviderError(body, res.status) }
}

// ---------------------------------------------------------------------------
// One message, start to finish
// ---------------------------------------------------------------------------

async function finish(msg: Msg, outcome: Outcome): Promise<Result> {
  let status: string
  let error: string | undefined
  const patch: Record<string, unknown> = {}

  if (outcome.kind === 'sent') {
    status = 'sent'
    Object.assign(patch, { status, provider_message_id: outcome.providerId, sent_at: new Date().toISOString(), error: null })
  } else if (outcome.kind === 'manual') {
    status = 'manual'
    Object.assign(patch, { status, error: null })
  } else {
    const attempts = msg.attempts + 1
    error = outcome.error
    // A fatal error (a template that cannot be sent) will not get better by retrying.
    const giveUp = outcome.kind === 'fatal' || attempts >= MAX_ATTEMPTS
    status = giveUp ? 'failed' : 'queued'
    Object.assign(patch, {
      status,
      attempts,
      error,
      next_attempt_at: new Date(Date.now() + attempts * 5 * 60_000).toISOString(),
    })
  }

  const { error: updateError } = await admin.from('messages').update(patch).eq('id', msg.id)
  if (updateError) console.error('messages update failed:', msg.id, updateError.code)

  const attemptTag = typeof patch.attempts === 'number' ? patch.attempts : msg.attempts
  await logTaskMessageEvent(
    msg.task_id,
    `${msg.template_key ?? msg.channel} ${status}`,
    { message_id: msg.id, status },
    status,
    `msg:${msg.id}:${status}:${attemptTag}`,
  )

  return error ? { id: msg.id, status, error } : { id: msg.id, status }
}

async function processMessage(msg: Msg, templates: Map<string, Template>): Promise<Result> {
  const tpl = msg.template_key ? (templates.get(msg.template_key) ?? null) : null
  let outcome: Outcome
  try {
    outcome = msg.channel === 'whatsapp' ? await sendWhatsapp(msg, tpl) : await sendEmail(msg)
  } catch (e) {
    outcome = { kind: 'retry', error: e instanceof Error ? e.message.slice(0, 300) : 'Unexpected error while sending.' }
  }
  return await finish(msg, outcome)
}

/** Moves queued rows to `sending` one at a time; a row someone else already took is skipped. */
async function claim(ids: string[]): Promise<Msg[]> {
  const claimed: Msg[] = []
  for (const id of ids) {
    const { data } = await admin
      .from('messages')
      .update({ status: 'sending', next_attempt_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'queued')
      .eq('direction', 'out')
      .select('id, channel, template_key, recipient, task_id, subject, body, variables, document_path, status, attempts, created_by')
    if (data && data.length > 0) claimed.push(data[0] as Msg)
  }
  return claimed
}

async function loadTemplates(msgs: Msg[]): Promise<Map<string, Template>> {
  const keys = [...new Set(msgs.map((m) => m.template_key).filter((k): k is string => !!k))]
  const map = new Map<string, Template>()
  if (keys.length === 0) return map
  const { data } = await admin.from('message_templates').select('key, provider_template, variables').in('key', keys)
  for (const t of (data ?? []) as Template[]) map.set(t.key, t)
  return map
}

async function run(ids: string[]): Promise<Result[]> {
  const msgs = await claim(ids)
  const templates = await loadTemplates(msgs)
  const results: Result[] = []
  for (const msg of msgs) results.push(await processMessage(msg, templates))
  return results
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  // (b) the scheduler
  const cronHeader = req.headers.get('x-cron-secret')
  if (cronHeader !== null) {
    const secret = Deno.env.get('CRON_SECRET')
    if (!secret || !safeEqual(cronHeader, secret)) return json({ error: 'Not allowed' }, 401)

    // A row stuck in `sending` (the function died mid-send) goes back in the queue after 10 minutes.
    await admin
      .from('messages')
      .update({ status: 'queued' })
      .eq('status', 'sending')
      .eq('direction', 'out')
      .lt('next_attempt_at', new Date(Date.now() - 10 * 60_000).toISOString())

    const { data, error } = await admin
      .from('messages')
      .select('id, attempts, next_attempt_at')
      .eq('status', 'queued')
      .eq('direction', 'out')
      .lte('next_attempt_at', new Date().toISOString())
      .lt('attempts', MAX_ATTEMPTS)
      .order('next_attempt_at', { ascending: true })
      .limit(CRON_LIMIT)
    if (error) return json({ error: 'Could not read the queue' }, 500)
    return json({ results: await run((data ?? []).map((r: { id: string }) => r.id)) })
  }

  // (a) a signed-in user
  const caller = await callingUser(req)
  if (caller === 'forbidden') return json({ error: 'Your account does not have permission to send messages' }, 403)
  if (!caller) return json({ error: 'Not signed in' }, 401)

  const asked = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((v): v is string => typeof v === 'string') : null
  if (asked && asked.length > USER_LIMIT) return json({ error: `Send at most ${USER_LIMIT} messages at a time` }, 400)

  // Only rows this person may see.
  let query = admin.from('messages').select('id, status, created_by').eq('direction', 'out')
  if (asked) query = query.in('id', asked)
  else query = query.eq('status', 'queued').lte('next_attempt_at', new Date().toISOString()).lt('attempts', MAX_ATTEMPTS).limit(CRON_LIMIT)
  if (!caller.seeAll) query = query.eq('created_by', caller.id)
  const { data: visible, error: readError } = await query
  if (readError) return json({ error: 'Could not read the messages' }, 500)

  const rows = (visible ?? []) as { id: string; status: string }[]
  const results: Result[] = []

  if (asked) {
    const seen = new Set(rows.map((r) => r.id))
    for (const id of asked) if (!seen.has(id)) results.push({ id, status: 'not_found', error: 'Message not found' })
  }

  if (body.retry === true) {
    const failed = rows.filter((r) => r.status === 'failed').map((r) => r.id)
    if (failed.length > 0) {
      await admin
        .from('messages')
        .update({ status: 'queued', attempts: 0, error: null, next_attempt_at: new Date().toISOString() })
        .in('id', failed)
        .eq('status', 'failed')
    }
  }

  results.push(...(await run(rows.map((r) => r.id))))

  // Rows that were not queued (already sent, say) come back with their own status.
  const handled = new Set(results.map((r) => r.id))
  for (const r of rows) if (!handled.has(r.id)) results.push({ id: r.id, status: r.status })

  return json({ results })
})
