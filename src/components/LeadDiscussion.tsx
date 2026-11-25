/** T-010: the discussion log of a lead, in the lead's Edit form. */

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Lead } from '../api/types'
import { errMessage, numOrNull } from '../lib/party'

/** T-010: record what was discussed with the party. One database function
 *  stores the note with the user and time, applies any new quantity / rate /
 *  timeline, moves a New lead to Contacted and can create a follow-up task. */
export function DiscussionPanel({ lead, onLogged }: { lead: Lead; onLogged: () => Promise<void> }) {
  const [note, setNote] = useState('')
  const [qty, setQty] = useState('')
  const [rate, setRate] = useState('')
  const [timeline, setTimeline] = useState('')
  const [task, setTask] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function log() {
    setMsg(null)
    if (!note.trim()) return setMsg('Write what was discussed.')
    if (qty && (numOrNull(qty) === null || Number(qty) <= 0)) return setMsg('Quantity must be a number above zero.')
    if (rate && (numOrNull(rate) === null || Number(rate) < 0)) return setMsg('Rate must be a number.')
    if (task.trim() && !due) return setMsg('Pick a due date for the follow-up task.')
    setBusy(true)
    const { error } = await supabase.rpc('log_lead_discussion', {
      p_lead: lead.id,
      p_note: note.trim(),
      p_quantity: numOrNull(qty),
      p_rate: numOrNull(rate),
      p_timeline: timeline.trim() || null,
      p_task_note: task.trim() || null,
      p_task_due: task.trim() ? due : null,
    })
    setBusy(false)
    if (error) return setMsg(errMessage(error, 'Could not save the discussion'))
    setNote(''); setQty(''); setRate(''); setTimeline(''); setTask(''); setDue('')
    await onLogged()
  }

  return (
    <section className="fs-flat">
      <div className="fs-body">
        <p className="muted small" style={{ marginTop: 0 }}>
          Saving moves a New lead to Contacted. Fill in quantity, rate or timeline only if they changed.
        </p>
        <div className="field">
          <label htmlFor="ld-note">What was discussed</label>
          <textarea id="ld-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <div className="field">
            <label htmlFor="ld-qty">New quantity</label>
            <input id="ld-qty" inputMode="decimal" className="mono" placeholder={`now ${lead.quantity ?? '—'}`} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ld-rate">New rate</label>
            <input id="ld-rate" inputMode="decimal" className="mono" placeholder={`now ${lead.expected_rate ?? '—'}`} value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ld-timeline">New timeline</label>
            <input id="ld-timeline" placeholder={`now ${lead.timeline || '—'}`} value={timeline} onChange={(e) => setTimeline(e.target.value)} />
          </div>
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div className="field">
            <label htmlFor="ld-task">Follow-up task (optional)</label>
            <input id="ld-task" value={task} onChange={(e) => setTask(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ld-due">Due date</label>
            <input id="ld-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
        <button className="btn primary" type="button" disabled={busy} onClick={() => void log()}>
          {busy ? 'Saving…' : 'Save discussion'}
        </button>
        {msg && <p className="field-warn">{msg}</p>}
      </div>
    </section>
  )
}
