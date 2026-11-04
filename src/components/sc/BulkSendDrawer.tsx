import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { CountRow, PaymentTerm } from '../../api/types'
import { Drawer } from '../Drawer'
import { errMessage } from '../../lib/party'
import { emailLink, whatsappLink } from '../../lib/integrations'
import { messageFor } from './scShared'
import type { Company, Names, Party, ScRow } from './scShared'

/** Send several confirmations at once. Browsers allow only one chat or mail window per click,
 *  so every message is queued here and opened with its own button; each open is logged. */
export function BulkSendDrawer({
  rows, suppliers, buyers, companies, counts, terms, onClose, onChanged,
}: {
  rows: ScRow[]
  suppliers: Party[]
  buyers: Party[]
  companies: Company[]
  counts: CountRow[]
  terms: PaymentTerm[]
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const [toSupplier, setToSupplier] = useState(true)
  const [toBuyer, setToBuyer] = useState(true)
  const [whatsapp, setWhatsapp] = useState(true)
  const [email, setEmail] = useState(true)
  const [batch] = useState(() => crypto.randomUUID())
  const [state, setState] = useState<Record<string, { logId?: string; status: 'opened' | 'sent' | 'failed' }>>({})
  const [err, setErr] = useState<string | null>(null)

  const sendable = rows.filter((x) => x.status === 'confirmed')
  const skipped = rows.filter((x) => x.status !== 'confirmed')
  const nameOf = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? ''

  type Item = { key: string; sc: ScRow; who: 'supplier' | 'buyer'; channel: 'whatsapp' | 'email'; party: Party | null; link: string | null; subject: string; body: string }
  const items: Item[] = []
  for (const sc of sendable) {
    const n: Names = {
      supplier: nameOf(suppliers, sc.supplier_id), buyer: nameOf(buyers, sc.buyer_id),
      supplierCompany: nameOf(companies, sc.supplier_company_id), buyerCompany: nameOf(companies, sc.buyer_company_id),
      count: counts.find((c) => c.id === sc.count_id)?.display_name ?? '', term: terms.find((t) => t.id === sc.payment_term_id)?.name ?? '',
    }
    for (const who of ['supplier', 'buyer'] as const) {
      if ((who === 'supplier' && !toSupplier) || (who === 'buyer' && !toBuyer)) continue
      const party = (who === 'supplier' ? suppliers : buyers).find((x) => x.id === (who === 'supplier' ? sc.supplier_id : sc.buyer_id)) ?? null
      const msg = messageFor(who, sc, n)
      for (const channel of ['whatsapp', 'email'] as const) {
        if ((channel === 'whatsapp' && !whatsapp) || (channel === 'email' && !email)) continue
        const link = channel === 'whatsapp' ? whatsappLink(party?.mobile, msg.body) : emailLink(party?.email, msg.subject, msg.body)
        items.push({ key: `${sc.id}:${who}:${channel}`, sc, who, channel, party, link, subject: msg.subject, body: msg.body })
      }
    }
  }

  async function open(it: Item) {
    if (!it.link || !it.party) return
    setErr(null)
    if (it.channel === 'whatsapp') window.open(it.link, '_blank', 'noopener')
    else { const a = document.createElement('a'); a.href = it.link; a.click() }
    const { data, error } = await supabase.from('sales_confirmation_notifications')
      .insert({ sc_id: it.sc.id, party: it.who, channel: it.channel, recipient: it.channel === 'whatsapp' ? it.party.mobile : it.party.email, message: it.body, batch_id: batch })
      .select('id').single()
    if (error) return setErr(`Opened the message, but could not record it: ${errMessage(error)}`)
    setState((p) => ({ ...p, [it.key]: { logId: (data as { id: string }).id, status: 'opened' } }))
    await supabase.from('sales_confirmations').update(it.who === 'supplier' ? { supplier_notified_at: new Date().toISOString() } : { buyer_notified_at: new Date().toISOString() }).eq('id', it.sc.id)
    await onChanged()
  }

  async function mark(it: Item, status: 'sent' | 'failed') {
    const id = state[it.key]?.logId
    if (!id) return
    const { error } = await supabase.from('sales_confirmation_notifications').update({ delivery_status: status }).eq('id', id)
    if (error) return setErr(errMessage(error, 'Could not update the status'))
    setState((p) => ({ ...p, [it.key]: { logId: id, status } }))
  }

  return (
    <Drawer title={`Send ${sendable.length} confirmation${sendable.length === 1 ? '' : 's'}`} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      {skipped.length > 0 && <div className="notice small">Not included (not confirmed or cancelled): {skipped.map((x) => x.sc_no).join(', ')}.</div>}
      <div className="drawer-actions" style={{ marginTop: 0, borderTop: 'none' }}>
        <label><input type="checkbox" checked={toSupplier} onChange={(e) => setToSupplier(e.target.checked)} /> Supplier</label>
        <label><input type="checkbox" checked={toBuyer} onChange={(e) => setToBuyer(e.target.checked)} /> Buyer</label>
        <label><input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} /> WhatsApp</label>
        <label><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Email</label>
      </div>
      <p className="muted small">No messaging service is connected, so each message opens in your own WhatsApp or mail app and you press Send there. Every open is logged with the time and your name; then mark it Sent or Failed.</p>
      {items.length === 0 ? (
        <div className="card pad empty">Choose at least one recipient and one channel.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Confirmation</th><th>To</th><th>Via</th><th>Status</th><th /></tr></thead>
            <tbody>
              {items.map((it) => {
                const st = state[it.key]
                return (
                  <tr key={it.key}>
                    <td className="mono">{it.sc.sc_no}</td>
                    <td className="small">{it.who === 'supplier' ? 'Supplier' : 'Buyer'}: {it.party?.name ?? '—'}</td>
                    <td className="small">{it.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</td>
                    <td>
                      {!it.link ? <span className="chip bad">{it.channel === 'whatsapp' ? 'No mobile' : 'No email'}</span>
                        : !st ? <span className="muted small">Not opened</span>
                        : <span className={`chip${st.status === 'sent' ? ' good' : st.status === 'failed' ? ' bad' : ' warn'}`}>{st.status === 'opened' ? 'Opened' : st.status === 'sent' ? 'Sent' : 'Failed'}</span>}
                    </td>
                    <td>
                      {it.link && !st && <button className="btn sm" type="button" onClick={() => void open(it)}>Open</button>}
                      {st && st.status === 'opened' && (<><button className="btn ghost sm" type="button" onClick={() => void mark(it, 'sent')}>Sent</button><button className="btn ghost sm" type="button" onClick={() => void mark(it, 'failed')}>Failed</button></>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="drawer-actions"><button className="btn" type="button" onClick={onClose}>Done</button></div>
    </Drawer>
  )
}