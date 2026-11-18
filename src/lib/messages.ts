/** Queueing and sending WhatsApp / e-mail messages.
 *
 *  queueMessage writes a row to `messages` through the queue_message RPC (which
 *  checks the phone or address, renders the body and logs it on the task);
 *  dispatchMessages asks the send-message Edge Function to send it. With no
 *  provider secrets set up, the function marks the row `manual` and the screen
 *  offers fallbackLink (a prefilled wa.me / mailto link) instead. */

import { supabase, functionsUrl } from './supabase'
import { ApiError } from '../api/client'
import { emailLink, whatsappLink } from './integrations'
import type { MessageRow } from '../api/types'

export type MessageChannel = 'whatsapp' | 'email'

export interface QueueMessageInput {
  channel: MessageChannel
  template: string
  recipient: string
  vars?: Record<string, string>
  taskId?: string | null
  buyerId?: string | null
  documentPath?: string | null
}

export interface DispatchResult {
  id: string
  status: string
  error?: string
}

/** Mirrors the SQL normalize_phone: 10 digits get the Indian prefix, a leading 0
 *  with 11 digits too, 11 to 15 digits are kept, anything else is not a phone. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length === 10) return `91${d}`
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`
  if (d.length >= 11 && d.length <= 15) return d
  return null
}

export const isEmailAddress = (value: string | null | undefined): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value ?? '').trim())

/** Fills {{name}} placeholders the way queue_message does. */
export function renderTemplate(text: string | null | undefined, vars: Record<string, string>): string {
  let out = text ?? ''
  for (const [key, value] of Object.entries(vars)) out = out.split(`{{${key}}}`).join(value)
  return out
}

/** Queues a message and returns its id. Throws the Supabase error on refusal (use errMessage). */
export async function queueMessage(input: QueueMessageInput): Promise<string> {
  const { data, error } = await supabase.rpc('queue_message', {
    p_channel: input.channel,
    p_template: input.template,
    p_recipient: input.recipient,
    p_vars: input.vars ?? {},
    p_task: input.taskId ?? null,
    p_buyer: input.buyerId ?? null,
    p_document: input.documentPath ?? null,
  })
  if (error) throw error
  return data as string
}

/** Asks the send-message function to send these queued messages (or, with no ids,
 *  the caller's due ones). `retry` first puts failed messages back in the queue. */
export async function dispatchMessages(ids?: string[], options: { retry?: boolean } = {}): Promise<DispatchResult[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new ApiError(401, 'Not signed in')

  let response: Response
  try {
    response = await fetch(`${functionsUrl}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ ...(ids ? { ids } : {}), ...(options.retry ? { retry: true } : {}) }),
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.')
  }

  const body = (await response.json().catch(() => ({}))) as { results?: DispatchResult[]; error?: string }
  if (!response.ok) throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`)
  return body.results ?? []
}

/** A prefilled WhatsApp chat or e-mail for a message the server could not send itself. */
export function fallbackLink(message: Pick<MessageRow, 'channel' | 'recipient' | 'body' | 'subject'>): string | null {
  return message.channel === 'whatsapp'
    ? whatsappLink(message.recipient, message.body)
    : emailLink(message.recipient, message.subject ?? '', message.body)
}
