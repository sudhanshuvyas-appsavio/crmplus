/** The message log (Tasks > Messages): everything the system has sent or
 *  received over WhatsApp and e-mail, newest first, with the delivery status
 *  the provider reported. Failed messages can be retried; messages the server
 *  could not send itself (no provider connected) offer the prefilled link. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import '../../styles/messaging.css'
import { supabase } from '../../lib/supabase'
import { errMessage } from '../../lib/party'
import { useAuth } from '../../auth/AuthProvider'
import type { MessageRow, MessageStatus } from '../../api/types'
import { GridPager, GridToolbar, usePaging } from '../../components/GridKit'
import { Modal } from '../../components/Modal'
import { StatusPill } from '../../components/StatusPill'
import { pushToast } from '../../components/Toast'
import { MESSAGE_STATUS_TONE, taskHref } from '../../lib/tasks'
import { dispatchMessages, fallbackLink } from '../../lib/messages'

const STATUSES: MessageStatus[] = ['queued', 'sending', 'sent', 'delivered', 'read', 'replied', 'failed', 'manual']
const STATUS_LABEL: Record<MessageStatus, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  replied: 'Replied',
  failed: 'Failed',
  manual: 'Open link',
}

const when = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export function MessagesPanel() {
  const { canAny } = useAuth()
  const allowed = canAny('message.view', 'task.manage')
  const [rows, setRows] = useState<MessageRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [viewing, setViewing] = useState<MessageRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [taskNos, setTaskNos] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(1000)
    if (loadError) {
      setError(errMessage(loadError, 'Could not load the message log'))
      setRows([])
      return
    }
    setError(null)
    setRows((data ?? []) as MessageRow[])
  }, [])

  useEffect(() => {
    if (allowed) void load()
  }, [allowed, load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter(
      (m) =>
        (!channel || m.channel === channel) &&
        (!status || m.status === status) &&
        (!q || [m.recipient, m.body, m.subject, m.template_key].some((v) => (v ?? '').toLowerCase().includes(q))),
    )
  }, [rows, query, channel, status])

  const paging = usePaging(shown, `${query}|${channel}|${status}`)

  // Task numbers for the rows on screen (a few dozen ids at most).
  const visibleTaskIds = useMemo(() => [...new Set(paging.visible.map((m) => m.task_id).filter((id): id is string => !!id))], [paging.visible])
  useEffect(() => {
    const missing = visibleTaskIds.filter((id) => !(id in taskNos))
    if (missing.length === 0) return
    let live = true
    void supabase
      .from('tasks')
      .select('id, task_no')
      .in('id', missing)
      .then(({ data }) => {
        if (!live) return
        const found = Object.fromEntries(((data ?? []) as { id: string; task_no: string }[]).map((t) => [t.id, t.task_no]))
        // Ids the person cannot see stay unnamed rather than being asked for again.
        setTaskNos((prev) => ({ ...prev, ...Object.fromEntries(missing.map((id) => [id, found[id] ?? ''])), ...found }))
      })
    return () => {
      live = false
    }
  }, [visibleTaskIds, taskNos])

  async function retry(m: MessageRow) {
    setBusyId(m.id)
    try {
      const result = (await dispatchMessages([m.id], { retry: true })).find((r) => r.id === m.id)
      if (!result || result.status === 'not_found') pushToast('error', 'That message could not be found.')
      else if (result.error) pushToast('error', result.error)
      else pushToast('success', result.status === 'manual' ? 'Provider not connected: use Open link.' : `Message ${result.status}.`)
    } catch (e) {
      pushToast('error', errMessage(e, 'Could not retry the message'))
    }
    setBusyId(null)
    await load()
  }

  if (!allowed) {
    return (
      <section className="md-pane tk-card">
        <div className="notice">Seeing the message log needs the “See the message log” or “Create and manage tasks” permission.</div>
      </section>
    )
  }
  if (!rows) return <p className="muted small">Loading messages…</p>

  return (
    <>
      {viewing && <MessageModal message={viewing} onClose={() => setViewing(null)} />}
      <section className="md-pane tk-card" aria-label="Message log">
        <GridToolbar
          title="Messages"
          total={rows.length}
          singular="message"
          plural="messages"
          query={query}
          onQuery={setQuery}
          searchPlaceholder="Search recipient or message"
          filters={[
            {
              name: 'channel',
              label: 'Channel',
              allLabel: 'All channels',
              options: [
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'email', label: 'E-mail' },
              ],
            },
            { name: 'status', label: 'Status', allLabel: 'All statuses', options: STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
          ]}
          values={{ channel, status }}
          onFilter={(name, value) => (name === 'channel' ? setChannel(value) : setStatus(value))}
          onClear={() => {
            setChannel('')
            setStatus('')
          }}
        >
          <button type="button" className="btn" onClick={() => void load()}>
            Refresh
          </button>
        </GridToolbar>

        {error && <div className="alert">{error}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th className="left">Recipient</th>
                <th className="left">Template</th>
                <th>Task</th>
                <th>Status</th>
                <th className="left">Error</th>
                <th>Sent</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paging.visible.map((m) => {
                const link = m.status === 'manual' ? fallbackLink(m) : null
                return (
                  <tr key={m.id}>
                    <td className="small">
                      {m.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
                      {m.direction === 'in' && <span className="msg-dir">in</span>}
                    </td>
                    <td className="left mono small">{m.recipient}</td>
                    <td className="left small">{m.template_key ?? (m.direction === 'in' ? 'Reply' : '—')}</td>
                    <td className="small">
                      {m.task_id ? <Link to={taskHref(m.task_id)}>{taskNos[m.task_id] || 'Open task'}</Link> : '—'}
                    </td>
                    <td>
                      <StatusPill tone={MESSAGE_STATUS_TONE[m.status]} title={m.error ?? undefined}>
                        {STATUS_LABEL[m.status]}
                      </StatusPill>
                    </td>
                    <td className="left">
                      {m.error ? (
                        <div className="msg-cell-err" title={m.error}>
                          {m.error}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="small">{when(m.sent_at)}</td>
                    <td>
                      <div className="msg-cell-actions">
                        {m.status === 'failed' && (
                          <button type="button" className="btn sm" disabled={busyId === m.id} onClick={() => void retry(m)}>
                            {busyId === m.id ? 'Retrying…' : 'Retry'}
                          </button>
                        )}
                        {link && (
                          <a className="btn sm" href={link} target="_blank" rel="noopener noreferrer">
                            Open link
                          </a>
                        )}
                        <button type="button" className="btn ghost sm" onClick={() => setViewing(m)}>
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {shown.length === 0 && (
                <tr>
                  <td className="empty" colSpan={8}>
                    {rows.length === 0 ? 'No messages yet.' : 'No message matches those filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <GridPager {...paging.pager} singular="message" plural="messages" />
      </section>
    </>
  )
}

function MessageModal({ message: m, onClose }: { message: MessageRow; onClose: () => void }) {
  return (
    <Modal
      title={m.subject || (m.channel === 'whatsapp' ? 'WhatsApp message' : 'E-mail message')}
      description={`${m.direction === 'in' ? 'From' : 'To'} ${m.recipient}`}
      size="md"
      onClose={onClose}
      footer={
        <button type="button" className="btn ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="msg-body-full">{m.body}</div>
      <dl className="detail-grid">
        <div>
          <dt>Status</dt>
          <dd>
            <StatusPill tone={MESSAGE_STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</StatusPill>
          </dd>
        </div>
        <div>
          <dt>Template</dt>
          <dd>{m.template_key ?? '—'}</dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd>{m.attempts}</dd>
        </div>
        <div>
          <dt>Queued</dt>
          <dd>{when(m.created_at)}</dd>
        </div>
        <div>
          <dt>Sent</dt>
          <dd>{when(m.sent_at)}</dd>
        </div>
        <div>
          <dt>Delivered</dt>
          <dd>{when(m.delivered_at)}</dd>
        </div>
        <div>
          <dt>Read</dt>
          <dd>{when(m.read_at)}</dd>
        </div>
        {m.provider_message_id && (
          <div>
            <dt>Provider id</dt>
            <dd className="mono small">{m.provider_message_id}</dd>
          </div>
        )}
      </dl>
      {m.error && (
        <div className="alert" role="alert">
          {m.error}
        </div>
      )}
    </Modal>
  )
}
