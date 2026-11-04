/** Payment terms (T-005 base). The sheet points at layout screenshots that are
 *  not available, so this holds the fields a deal needs: a name, credit days,
 *  an advance percentage and a description. Reading needs deal/lead access;
 *  changing the list needs "Change system settings". */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PaymentTerm } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { errMessage, numOrNull } from '../lib/party'

type Form = { name: string; days: string; advance_pct: string; description: string; is_active: boolean }
const blank: Form = { name: '', days: '0', advance_pct: '0', description: '', is_active: true }

export default function PaymentTerms() {
  const { can } = useAuth()
  const canEdit = can('settings.manage')
  const [rows, setRows] = useState<PaymentTerm[] | null>(null)
  const [editing, setEditing] = useState<PaymentTerm | 'new' | null>(null)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('payment_terms').select('*').order('name')
    if (error) setBanner({ kind: 'bad', text: errMessage(error, 'Could not load payment terms') })
    setRows((data ?? []) as PaymentTerm[])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (!rows) return <Loading label="Loading payment terms" />
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Payment terms</h1>
          <p className="page-sub">Terms a deal can be agreed on, such as “30 days” or “50% advance, balance on delivery”.</p>
        </div>
        {canEdit && (
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
            Add a payment term
          </button>
        )}
      </header>
      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="card pad empty">No payment terms yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="right">Credit days</th>
                <th className="right">Advance %</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={canEdit ? 'clickable' : ''} onClick={() => canEdit && setEditing(r)}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td className="right mono">{r.days}</td>
                  <td className="right mono">{r.advance_pct}</td>
                  <td className="small">{r.description ?? '—'}</td>
                  <td>{r.is_active ? <span className="chip good">Active</span> : <span className="chip bad">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && canEdit && (
        <TermDrawer
          key={editing === 'new' ? 'new' : editing.id}
          term={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            await load()
          }}
        />
      )}
    </>
  )
}

function TermDrawer({ term, onClose, onDone }: { term: PaymentTerm | null; onClose: () => void; onDone: (m: string) => void | Promise<void> }) {
  const [f, setF] = useState<Form>(
    term ? { name: term.name, days: String(term.days), advance_pct: String(term.advance_pct), description: term.description ?? '', is_active: term.is_active } : blank,
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const days = numOrNull(f.days)
  const adv = numOrNull(f.advance_pct)
  const problems: string[] = []
  if (!f.name.trim()) problems.push('Name')
  if (days === null || days < 0 || days > 365 || !Number.isInteger(days)) problems.push('Credit days (0–365)')
  if (adv === null || adv < 0 || adv > 100) problems.push('Advance % (0–100)')

  async function save() {
    setBusy(true)
    setErr(null)
    const payload = { name: f.name.trim(), days, advance_pct: adv, description: f.description.trim() || null, is_active: f.is_active, updated_at: new Date().toISOString() }
    const { error } = term ? await supabase.from('payment_terms').update(payload).eq('id', term.id) : await supabase.from('payment_terms').insert(payload)
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this payment term'))
    await onDone(`${payload.name} ${term ? 'updated' : 'added'}.`)
  }

  async function remove() {
    if (!term) return
    setBusy(true)
    const { data, error } = await supabase.from('payment_terms').delete().eq('id', term.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Could not delete this term.')
    await onDone(`${term.name} deleted.`)
  }

  return (
    <Drawer title={term ? term.name : 'Add a payment term'} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <div className="form-grid">
        <Field id="pt-name" label="Name" required hint="Must be unique.">
          <input id="pt-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field id="pt-days" label="Credit days" required>
          <input id="pt-days" className="mono" inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
        </Field>
        <Field id="pt-adv" label="Advance %" required>
          <input id="pt-adv" className="mono" inputMode="decimal" value={f.advance_pct} onChange={(e) => setF({ ...f, advance_pct: e.target.value })} />
        </Field>
      </div>
      <Field id="pt-desc" label="Description">
        <textarea id="pt-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />
        <span className="check-body">
          <span className="check-label">Active</span>
        </span>
      </label>
      {problems.length > 0 && <p className="field-hint">Still needed: {problems.join(', ')}.</p>}
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy || problems.length > 0} onClick={() => void save()}>
          {busy ? 'Saving…' : term ? 'Save changes' : 'Add the term'}
        </button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {term && <DeleteControl label="Delete this term" name={term.name} busy={busy} onConfirm={() => void remove()} />}
      </div>
    </Drawer>
  )
}