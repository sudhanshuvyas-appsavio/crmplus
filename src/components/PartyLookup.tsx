import type { ReactNode } from 'react'
import type { MirrorParty } from './board/mirrors'
import { commTerms } from '../lib/deals'
import { useProfileNames } from './PartyExtras'

/** A party's details as a small card: the name as its title, then only the details that are on file. */
export function PartyCard({ title, name, rows }: { title: string; name: string; rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== '—')
  return (
    <section className="pcard">
      <header>
        <span>{title}</span>
        <strong>{name}</strong>
      </header>
      {shown.length === 0 ? (
        <p className="muted small">Nothing on file yet. Add it in Buyers &amp; Suppliers.</p>
      ) : (
        <dl>
          {shown.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      )}
    </section>
  )
}

/** Read-only details from the party master (monday's mirror columns on the Deals board). */
export function PartyLookup({ title, p, unit }: { title: string; p: MirrorParty; unit?: string }) {
  const comm = commTerms(p.commission_basis ?? null, p.commission_value ?? null)
  const names = useProfileNames()
  return (
    <PartyCard title={title} name={p.name} rows={[
      ['GST', p.gst ? <span className="mono">{p.gst}</span> : null],
      ['PAN', p.pan ? <span className="mono">{p.pan}</span> : null],
      ['Contact person 1', [p.contact_person, p.mobile ? `+91 ${p.mobile}` : ''].filter(Boolean).join(' · ') || null],
      ['Contact person 2', [p.contact_2_name, p.contact_2_mobile ? `+91 ${p.contact_2_mobile}` : ''].filter(Boolean).join(' · ') || null],
      ['Messenger', p.messenger_id ? names[p.messenger_id] ?? null : null],
      ['Office address', p.address],
      ['Mill / delivery address', p.mill_address],
      ['Business unit', unit ?? null],
      ['Commission', comm],
    ]} />
  )
}
