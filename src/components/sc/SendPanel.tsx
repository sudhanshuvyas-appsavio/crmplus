import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { errMessage } from '../../lib/party'
import { emailLink, whatsappLink } from '../../lib/integrations'
import { messageFor } from './scShared'
import type { Names, Party, ScRow } from './scShared'

/** The two quick actions. Each one targets a single party; Email and WhatsApp are optional tick boxes. */
export function SendPanel({
  sc, names, supplier, buyer, onSent,
}: {
  sc: ScRow
  names: Names
  supplier: Party | null
  buyer: Party | null
  onSent: (message: string) => void | Promise<void>
}) {
  const [target, setTarget] = useState<'supplier' | 'buyer' | null>(null)
  const [email, setEmail] = useState(true)
  const [whatsapp, setWhatsapp] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const party = target === 'supplier' ? supplier : target === 'buyer' ? buyer : null
  const msg = target ? messageFor(target, sc, names) : null

  async function send() {
    if (!target || !party || !msg) return
    setErr(null)
    const wa = whatsapp ? whatsappLink(party.mobile, msg.body) : null
    const mail = email ? emailLink(party.email, msg.subject, msg.body) : null
    if (!email && !whatsapp) return setErr('Tick Email, WhatsApp or both.')
    if (whatsapp && !wa && !(email && mail)) return setErr(`${party.name} has no valid mobile number on record for WhatsApp.`)
    if (email && !mail && !(whatsapp && wa)) return setErr(`${party.name} has no email address on record.`)

    // open the chats first, in the click itself, so the browser allows them
    if (wa) window.open(wa, '_blank', 'noopener')
    if (mail) {
      const a = document.createElement('a')
      a.href = mail
      a.click()
    }
    setBusy(true)
    const logs = [
      ...(wa ? [{ sc_id: sc.id, party: target, channel: 'whatsapp', recipient: party.mobile, message: msg.body }] : []),
      ...(mail ? [{ sc_id: sc.id, party: target, channel: 'email', recipient: party.email, message: msg.body }] : []),
    ]
    const { error } = await supabase.from('sales_confirmation_notifications').insert(logs)
    if (!error) {
      await supabase.from('sales_confirmations').update(target === 'supplier' ? { supplier_notified_at: new Date().toISOString() } : { buyer_notified_at: new Date().toISOString() }).eq('id', sc.id)
    }
    setBusy(false)
    if (error) return setErr(`Opened the message, but could not record it: ${errMessage(error)}`)
    const channels = [wa ? 'WhatsApp' : '', mail ? 'Email' : ''].filter(Boolean).join(' and ')
    await onSent(`${sc.sc_no}: ${channels} opened for the ${target} (${party.name}). Press Send in each to deliver it.`)
  }

  return (
    <>
      <h3 className="section-title">D · Send</h3>
      <p className="muted small">The supplier and the buyer are messaged separately.</p>
      <div className="drawer-actions">
        <button className={`btn${target === 'supplier' ? ' primary' : ''}`} type="button" onClick={() => setTarget('supplier')}>
          SMS Supplier{sc.supplier_notified_at ? ' (sent)' : ''}
        </button>
        <button className={`btn${target === 'buyer' ? ' primary' : ''}`} type="button" onClick={() => setTarget('buyer')}>
          SMS Buyer{sc.buyer_notified_at ? ' (sent)' : ''}
        </button>
      </div>

      {target && party && msg && (
        <div className="card pad" style={{ marginTop: 12 }}>
          <strong>To {target}: {party.name}</strong>
          <p className="muted small" style={{ margin: '4px 0 8px' }}>
            WhatsApp: {party.mobile || 'no number'} · Email: {party.email || 'no address'}
          </p>
          <label style={{ display: 'block' }}>
            <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} /> WhatsApp
          </label>
          <label style={{ display: 'block' }}>
            <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email
          </label>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: '10px 0' }}>{msg.body}</pre>
          {err && <div className="alert">{err}</div>}
          <button className="btn primary" type="button" onClick={() => void send()} disabled={busy || (!email && !whatsapp)}>
            {busy ? 'Recording…' : `Send to ${target}`}
          </button>
        </div>
      )}
    </>
  )
}