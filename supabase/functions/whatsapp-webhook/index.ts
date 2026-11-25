// whatsapp-webhook
//
// Receives Meta's WhatsApp Cloud API callbacks: delivery receipts for the
// messages send-message sent, and inbound replies.
//
// DEPLOY WITH --no-verify-jwt:
//   npx supabase functions deploy whatsapp-webhook --no-verify-jwt
// Meta cannot send a Supabase JWT, so the platform's JWT check must be off for
// this one function. It is protected by (1) the verify token on the GET
// handshake and (2) the X-Hub-Signature-256 HMAC of the raw body, checked
// whenever WHATSAPP_APP_SECRET is set. Always set WHATSAPP_APP_SECRET in
// production: without it anyone who knows the URL can post fake receipts.
//
// Secrets: WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET.
// Never logs secrets or message bodies.

import { admin, logTaskMessageEvent, safeEqual } from '../_shared/common.ts'

const RANK: Record<string, number> = { queued: 0, sending: 1, manual: 1, sent: 2, delivered: 3, read: 4, replied: 5 }

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })

async function validSignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
  return safeEqual(expected, header.slice('sha256='.length).toLowerCase())
}

interface WaStatus {
  id?: string
  status?: string
  timestamp?: string
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[]
}

interface WaMessage {
  id?: string
  from?: string
  type?: string
  text?: { body?: string }
  [key: string]: unknown
}

function inboundBody(m: WaMessage): string {
  if (m.type === 'text') return m.text?.body ?? ''
  const media = m[m.type ?? ''] as { caption?: string } | undefined
  const label = `[${m.type ?? 'message'}]`
  return media?.caption ? `${label} ${media.caption}` : label
}

function toIso(seconds: string | undefined): string {
  const n = Number(seconds)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString()
}

async function handleStatus(s: WaStatus): Promise<void> {
  if (!s.id || !s.status) return
  const { data } = await admin.from('messages').select('id, status').eq('provider_message_id', s.id).limit(1)
  const row = data?.[0] as { id: string; status: string } | undefined
  if (!row) return

  const when = toIso(s.timestamp)
  const patch: Record<string, unknown> = {}

  if (s.status === 'failed') {
    const e = s.errors?.[0]
    const detail = e?.error_data?.details ? ` (${e.error_data.details})` : ''
    patch.status = 'failed'
    patch.error = `${e?.title ?? e?.message ?? 'WhatsApp could not deliver the message'}${detail}${e?.code ? ` [code ${e.code}]` : ''}`.slice(0, 500)
  } else if (s.status === 'sent' || s.status === 'delivered' || s.status === 'read') {
    // Receipts can arrive out of order; never step a message backwards.
    if ((RANK[s.status] ?? 0) <= (RANK[row.status] ?? 0)) return
    patch.status = s.status
    patch.error = null
    if (s.status === 'sent') patch.sent_at = when
    if (s.status === 'delivered') patch.delivered_at = when
    if (s.status === 'read') {
      patch.read_at = when
      patch.delivered_at = when
    }
  } else {
    return
  }

  const { error } = await admin.from('messages').update(patch).eq('id', row.id)
  if (error) console.error('status update failed:', row.id, error.code)
}

async function handleInbound(m: WaMessage): Promise<void> {
  if (!m.id || !m.from) return
  const from = m.from.replace(/\D/g, '')

  // The conversation this answers: the latest message we sent to that number.
  const { data: prior } = await admin
    .from('messages')
    .select('id, task_id, buyer_id')
    .eq('direction', 'out')
    .eq('channel', 'whatsapp')
    .eq('recipient', from)
    .order('created_at', { ascending: false })
    .limit(1)
  const last = prior?.[0] as { id: string; task_id: string | null; buyer_id: string | null } | undefined

  const { data: inserted, error } = await admin
    .from('messages')
    .insert({
      direction: 'in',
      channel: 'whatsapp',
      recipient: from,
      body: inboundBody(m),
      status: 'replied',
      provider_message_id: m.id,
      task_id: last?.task_id ?? null,
      buyer_id: last?.buyer_id ?? null,
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  // 23505 = Meta delivered the same reply twice; it is already stored.
  if (error) {
    if (error.code !== '23505') console.error('inbound insert failed:', error.code)
    return
  }

  if (last) {
    await admin.from('messages').update({ status: 'replied' }).eq('id', last.id)
    await logTaskMessageEvent(
      last.task_id,
      'WhatsApp reply received',
      { message_id: inserted?.id ?? null, in_reply_to: last.id },
      'replied',
      `reply:${m.id}`,
    )
  }
}

Deno.serve(async (req) => {
  // Meta's one-time verification handshake.
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const expected = Deno.env.get('WHATSAPP_VERIFY_TOKEN')
    const token = url.searchParams.get('hub.verify_token')
    if (
      expected && token && url.searchParams.get('hub.mode') === 'subscribe' && safeEqual(token, expected)
    ) {
      return text(url.searchParams.get('hub.challenge') ?? '')
    }
    return text('Forbidden', 403)
  }

  if (req.method !== 'POST') return text('Method not allowed', 405)

  const raw = await req.text()
  const secret = Deno.env.get('WHATSAPP_APP_SECRET')
  if (secret && !(await validSignature(raw, req.headers.get('x-hub-signature-256'), secret))) {
    return text('Invalid signature', 401)
  }

  try {
    const payload = JSON.parse(raw) as {
      entry?: { changes?: { value?: { statuses?: WaStatus[]; messages?: WaMessage[] } }[] }[]
    }
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const s of change.value?.statuses ?? []) await handleStatus(s)
        for (const m of change.value?.messages ?? []) await handleInbound(m)
      }
    }
  } catch (e) {
    // Answer 200 anyway: a retry storm from Meta would not fix a bad payload.
    console.error('webhook processing failed:', e instanceof Error ? e.name : 'error')
  }

  return text('ok')
})
