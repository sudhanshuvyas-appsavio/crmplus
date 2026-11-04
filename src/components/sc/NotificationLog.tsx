import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfileNames } from '../PartyExtras'
import { errMessage } from '../../lib/party'
import { formatDateTime } from '../../lib/format'
import type { ScNotification, ScRow } from './scShared'

export function CancelControl({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false)
  if (!asking) return <button className="btn danger push" type="button" onClick={() => setAsking(true)} disabled={busy}>Cancel confirmation</button>
  return (
    <span className="push" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span className="field-warn">Cancel this confirmation? It cannot be undone.</span>
      <button className="btn danger" type="button" onClick={onConfirm} disabled={busy}>Yes, cancel it</button>
      <button className="btn ghost" type="button" onClick={() => setAsking(false)} disabled={busy}>Keep it</button>
    </span>
  )
}

/** Who was sent this confirmation, when, by whom and what happened to it. */
export function NotificationLog({ sc, canManage }: { sc: ScRow; canManage: boolean }) {
  const names = useProfileNames()
  const [rows, setRows] = useState<ScNotification[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('sales_confirmation_notifications').select('id,sc_id,party,channel,recipient,sent_by,sent_at,delivery_status,batch_id').eq('sc_id', sc.id).order('sent_at', { ascending: false })
    if (error) setErr(errMessage(error, 'Could not load the send history'))
    setRows((data ?? []) as ScNotification[])
  }, [sc.id])
  useEffect(() => { void load() }, [load, sc.updated_at])

  async function mark(id: string, status: 'sent' | 'failed') {
    const { error } = await supabase.from('sales_confirmation_notifications').update({ delivery_status: status }).eq('id', id)
    if (error) return setErr(errMessage(error, 'Could not update the status'))
    await load()
  }

  if (!rows || rows.length === 0) return null
  return (
    <>
      <h3 className="section-title">Send history</h3>
      {err && <div className="alert">{err}</div>}
      <ul className="small" style={{ paddingLeft: 18 }}>
        {rows.map((x) => (
          <li key={x.id}>
            {formatDateTime(x.sent_at)} · {x.party === 'supplier' ? 'Supplier' : 'Buyer'} · {x.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} {x.recipient ? `(${x.recipient})` : ''} · by {x.sent_by ? names[x.sent_by] ?? 'a user' : 'system'} ·{' '}
            <span className={`chip${x.delivery_status === 'sent' ? ' good' : x.delivery_status === 'failed' ? ' bad' : ' warn'}`}>{x.delivery_status === 'opened' ? 'Opened, not confirmed' : x.delivery_status === 'sent' ? 'Sent' : 'Failed'}</span>
            {canManage && x.delivery_status === 'opened' && (
              <>
                {' '}<button className="btn ghost sm" type="button" onClick={() => void mark(x.id, 'sent')}>Mark sent</button>
                <button className="btn ghost sm" type="button" onClick={() => void mark(x.id, 'failed')}>Mark failed</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">No WhatsApp or email service is connected, so a send opens the message in your own app. "Opened" becomes "Sent" when you confirm it.</p>
    </>
  )
}