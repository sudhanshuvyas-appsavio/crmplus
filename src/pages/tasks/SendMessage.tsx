/** Send a WhatsApp or e-mail message about a task.
 *
 *  The person picks the channel and an active template, the recipient (the
 *  buyer's numbers or addresses, or anything typed) and the values filled into
 *  the template. Send queues the message and asks the send-message function to
 *  send it. With no provider connected the message comes back as `manual` and
 *  the dialog offers the prefilled WhatsApp / e-mail link instead. */

import { useEffect, useMemo, useState } from 'react'
import '../../styles/messaging.css'
import { supabase } from '../../lib/supabase'
import { errMessage } from '../../lib/party'
import type { MessageRow, MessageTemplate, Task } from '../../api/types'
import { Modal } from '../../components/Modal'
import { Field } from '../../components/PartyForms'
import { StatusPill } from '../../components/StatusPill'
import { pushToast } from '../../components/Toast'
import { balanceOf, formatMoney, MESSAGE_STATUS_TONE } from '../../lib/tasks'
import {
  dispatchMessages,
  fallbackLink,
  isEmailAddress,
  normalizePhone,
  queueMessage,
  renderTemplate,
  type DispatchResult,
  type MessageChannel,
} from '../../lib/messages'

interface BuyerContacts {
  name: string
  office_phone: string | null
  mobile: string | null
  contact_2_mobile: string | null
  contact_3_mobile: string | null
  email: string | null
  contact_1_email: string | null
  contact_2_email: string | null
}

interface RecipientOption {
  value: string
  label: string
}

const OTHER = '__other'

function recipientOptions(buyer: BuyerContacts | null, channel: MessageChannel): RecipientOption[] {
  if (!buyer) return []
  const sources: [string, string | null][] =
    channel === 'whatsapp'
      ? [
          ['Mobile', buyer.mobile],
          ['Office phone', buyer.office_phone],
          ['Contact 2 mobile', buyer.contact_2_mobile],
          ['Contact 3 mobile', buyer.contact_3_mobile],
        ]
      : [
          ['E-mail', buyer.email],
          ['Contact 1 e-mail', buyer.contact_1_email],
          ['Contact 2 e-mail', buyer.contact_2_email],
        ]
  const seen = new Set<string>()
  const out: RecipientOption[] = []
  for (const [label, raw] of sources) {
    const value = (raw ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push({ value, label: `${label} - ${value}` })
  }
  return out
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface Outcome {
  status: string
  error?: string
  link: string | null
  channel: MessageChannel
  note?: string
}

export function SendMessageDialog({ task, onClose, onSent }: { task: Task; onClose: () => void; onSent: () => void }) {
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null)
  const [buyer, setBuyer] = useState<BuyerContacts | null>(null)
  const [buyerLoaded, setBuyerLoaded] = useState(false)
  const [channel, setChannel] = useState<MessageChannel>('whatsapp')
  const [templateKey, setTemplateKey] = useState('')
  const [choice, setChoice] = useState('')
  const [custom, setCustom] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  useEffect(() => {
    let live = true
    void supabase
      .from('message_templates')
      .select('*')
      .eq('is_active', true)
      .order('key')
      .then(({ data, error }) => {
        if (!live) return
        if (error) setErr(errMessage(error, 'Could not load the message templates'))
        setTemplates((data ?? []) as MessageTemplate[])
      })
    if (task.buyer_id) {
      void supabase
        .from('buyer_master')
        .select('name, office_phone, mobile, contact_2_mobile, contact_3_mobile, email, contact_1_email, contact_2_email')
        .eq('id', task.buyer_id)
        .maybeSingle()
        .then(({ data }) => {
          if (!live) return
          setBuyer((data as BuyerContacts | null) ?? null)
          setBuyerLoaded(true)
        })
    } else {
      setBuyerLoaded(true)
    }
    return () => {
      live = false
    }
  }, [task.buyer_id])

  const forChannel = useMemo(() => (templates ?? []).filter((t) => t.channel === channel), [templates, channel])
  const template = forChannel.find((t) => t.key === templateKey) ?? forChannel[0] ?? null
  const options = useMemo(() => recipientOptions(buyer, channel), [buyer, channel])
  const selected = choice === OTHER ? OTHER : options.some((o) => o.value === choice) ? choice : (options[0]?.value ?? OTHER)
  const recipient = (selected === OTHER ? custom : selected).trim()

  const defaults = useMemo<Record<string, string>>(() => {
    const balance = balanceOf(task)
    const amount = balance > 0 ? balance : Number(task.amount)
    return {
      buyer: buyer?.name ?? '',
      amount: amount > 0 ? formatMoney(amount) : '',
      reference: task.title,
      date: formatDate(task.due_date),
    }
  }, [task, buyer])

  const names = template?.variables ?? []
  const vars = useMemo(() => {
    const out: Record<string, string> = {}
    for (const n of names) out[n] = edits[n] ?? defaults[n] ?? ''
    return out
  }, [names, edits, defaults])

  const preview = template ? renderTemplate(template.body, vars) : ''
  const previewSubject = template?.subject ? renderTemplate(template.subject, vars) : ''

  const missing: string[] = []
  if (!template) missing.push('a template')
  if (!recipient) missing.push(channel === 'whatsapp' ? 'a phone number' : 'an e-mail address')
  else if (channel === 'whatsapp' && !normalizePhone(recipient)) missing.push('a valid phone number (10 digits, or with country code)')
  else if (channel === 'email' && !isEmailAddress(recipient)) missing.push('a valid e-mail address')
  const blankVars = names.filter((n) => !(vars[n] ?? '').trim())
  if (blankVars.length > 0) missing.push(`values for ${blankVars.join(', ')}`)

  function changeChannel(next: MessageChannel) {
    setChannel(next)
    setTemplateKey('')
    setChoice('')
    setCustom('')
    setErr(null)
  }

  async function send() {
    if (!template || missing.length > 0) return
    setBusy(true)
    setErr(null)

    let id: string
    try {
      id = await queueMessage({
        channel,
        template: template.key,
        recipient,
        vars,
        taskId: task.id,
        buyerId: task.buyer_id,
      })
    } catch (e) {
      setBusy(false)
      setErr(errMessage(e, 'Could not queue the message'))
      return
    }
    onSent()

    let result: DispatchResult | undefined
    let note: string | undefined
    try {
      result = (await dispatchMessages([id])).find((r) => r.id === id)
    } catch (e) {
      note = errMessage(e, 'Sending could not be started')
    }

    const status = result?.status ?? 'queued'
    let link: string | null = null
    if (status === 'manual') {
      const { data } = await supabase.from('messages').select('channel, recipient, body, subject').eq('id', id).maybeSingle()
      const row = (data as Pick<MessageRow, 'channel' | 'recipient' | 'body' | 'subject'> | null) ?? {
        channel,
        recipient,
        body: preview,
        subject: previewSubject || null,
      }
      link = fallbackLink(row)
    }

    setBusy(false)
    setOutcome({ status, error: result?.error, link, channel, note })
    if (status === 'sent' || status === 'delivered' || status === 'read') pushToast('success', 'Message sent.')
  }

  const loading = templates === null || !buyerLoaded

  return (
    <Modal
      title="Send a message"
      description={task.title}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            {outcome ? 'Close' : 'Cancel'}
          </button>
          {!outcome && (
            <button type="button" className="btn primary" disabled={busy || loading || missing.length > 0} onClick={() => void send()}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          )}
        </>
      }
    >
      {err && (
        <div className="alert" role="alert">
          {err}
        </div>
      )}

      {outcome ? (
        <OutcomeView outcome={outcome} />
      ) : loading ? (
        <p className="muted small">Loading…</p>
      ) : (
        <>
          <div className="msg-form">
            <Field id="msg-channel" label="Channel" required>
              <select id="msg-channel" value={channel} onChange={(e) => changeChannel(e.target.value as MessageChannel)}>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">E-mail</option>
              </select>
            </Field>
            <Field id="msg-template" label="Template" required>
              <select id="msg-template" value={template?.key ?? ''} onChange={(e) => setTemplateKey(e.target.value)} disabled={forChannel.length === 0}>
                {forChannel.length === 0 && <option value="">No active template</option>}
                {forChannel.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.key.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="msg-recipient" label={channel === 'whatsapp' ? 'Send to (phone)' : 'Send to (e-mail)'} required>
              <select id="msg-recipient" value={selected} onChange={(e) => setChoice(e.target.value)}>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                <option value={OTHER}>Another {channel === 'whatsapp' ? 'number' : 'address'}…</option>
              </select>
            </Field>
            {selected === OTHER ? (
              <Field id="msg-custom" label={channel === 'whatsapp' ? 'Phone number' : 'E-mail address'} required>
                <input
                  id="msg-custom"
                  type={channel === 'whatsapp' ? 'tel' : 'email'}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder={channel === 'whatsapp' ? '9876543210' : 'name@example.com'}
                  autoFocus
                />
              </Field>
            ) : (
              <div />
            )}
          </div>

          {names.length > 0 && (
            <div className="msg-vars">
              {names.map((n) => (
                <Field key={n} id={`msg-var-${n}`} label={n.charAt(0).toUpperCase() + n.slice(1)} required>
                  <input id={`msg-var-${n}`} value={vars[n] ?? ''} onChange={(e) => setEdits((prev) => ({ ...prev, [n]: e.target.value }))} />
                </Field>
              ))}
            </div>
          )}

          <p className="msg-preview-label">Preview</p>
          <div className="msg-preview" aria-live="polite">
            {previewSubject && <span className="msg-subject">{previewSubject}</span>}
            {preview || 'Pick a template to see the message.'}
          </div>

          {missing.length > 0 && <p className="field-hint">Still needed: {missing.join('; ')}.</p>}
        </>
      )}
    </Modal>
  )
}

function OutcomeView({ outcome }: { outcome: Outcome }) {
  const { status, error, link, channel, note } = outcome
  const sentOk = status === 'sent' || status === 'delivered' || status === 'read'
  return (
    <div className="msg-outcome">
      <div className="msg-status-line">
        <StatusPill tone={MESSAGE_STATUS_TONE[status as keyof typeof MESSAGE_STATUS_TONE] ?? 'neutral'}>{status}</StatusPill>
        {sentOk && <span>Message sent.</span>}
        {status === 'queued' && <span>Queued. It will be sent shortly and retried if the first attempt fails.</span>}
        {status === 'failed' && <span>The message could not be sent.</span>}
      </div>

      {status === 'manual' && (
        <>
          <div className="notice">
            Provider not connected: open {channel === 'whatsapp' ? 'WhatsApp' : 'your e-mail'} with the message ready, then press Send there.
          </div>
          {link ? (
            <a className="btn primary" href={link} target="_blank" rel="noopener noreferrer">
              Open {channel === 'whatsapp' ? 'WhatsApp' : 'e-mail'}
            </a>
          ) : (
            <div className="alert">A ready-made link could not be built for this recipient.</div>
          )}
        </>
      )}

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {note && (
        <div className="alert warn" role="alert">
          The message is saved in the queue, but sending could not be started: {note}
        </div>
      )}
    </div>
  )
}
