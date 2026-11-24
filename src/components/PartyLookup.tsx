import type { MirrorParty } from './board/mirrors'
import { commTerms } from '../lib/deals'

/** Read-only details from the party master (monday's mirror columns on the Deals board). */
export function PartyLookup({ title, p, unit }: { title: string; p: MirrorParty; unit?: string }) {
  return (
    <div className="lookup">
      <h4>{title}: {p.name}</h4>
      <dl className="kv">
        <dt>GST</dt><dd className="mono">{p.gst || '—'}</dd>
        <dt>PAN</dt><dd className="mono">{p.pan || '—'}</dd>
        <dt>Contact person 1</dt><dd>{[p.contact_person, p.mobile ? `+91 ${p.mobile}` : ''].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Office address</dt><dd>{p.address || '—'}</dd>
        <dt>Mill / delivery address</dt><dd>{p.mill_address || '—'}</dd>
        <dt>Business unit</dt><dd>{unit || '—'}</dd>
        <dt>Commission</dt><dd>{commTerms(p.commission_basis ?? null, p.commission_value ?? null)}</dd>
      </dl>
    </div>
  )
}
