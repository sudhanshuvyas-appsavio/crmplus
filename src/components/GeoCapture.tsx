/** Location for field work: one call that asks the browser for a position, and
 *  the Check in / Check out buttons built on it. */

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { errMessage } from '../lib/party'
import { pushToast } from './Toast'

export interface Position {
  lat: number
  lng: number
  accuracy: number
}

/** Rejects with a sentence a person can act on (denied, unavailable, timed out). */
export function getPosition(timeoutMs = 15000): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This device cannot share its location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Location is switched off for this site. Allow it in the browser settings and try again.'
              : e.code === e.TIMEOUT
                ? 'Could not get a location fix in time. Move to an open area and try again.'
                : 'Could not work out the location.',
          ),
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    )
  })
}

/** Check in (records time and place and starts the task) and check out. */
export function CheckInButtons({
  taskId,
  checkedIn,
  checkedOut,
  disabled,
  big,
  onDone,
}: {
  taskId: string
  checkedIn: boolean
  checkedOut: boolean
  disabled?: boolean
  big?: boolean
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState('')

  async function checkIn() {
    setBusy(true)
    try {
      const pos = await getPosition()
      const { error } = await supabase.rpc('task_check_in', {
        p_task: taskId, p_lat: pos.lat, p_lng: pos.lng, p_accuracy: Math.round(pos.accuracy * 10) / 10,
      })
      if (error) throw error
      pushToast('success', 'Checked in.')
      onDone()
    } catch (caught) {
      pushToast('error', errMessage(caught, 'Could not check in'))
    }
    setBusy(false)
  }

  async function checkOut() {
    setBusy(true)
    const { error } = await supabase.rpc('task_check_out', { p_task: taskId, p_summary: summary.trim() || null })
    setBusy(false)
    if (error) return pushToast('error', errMessage(error, 'Could not check out'))
    pushToast('success', 'Checked out.')
    setSummary('')
    onDone()
  }

  const cls = big ? 'btn primary big' : 'btn'
  if (!checkedIn) {
    return (
      <button type="button" className={cls} disabled={disabled || busy} onClick={() => void checkIn()}>
        {busy ? 'Finding location…' : 'Check in'}
      </button>
    )
  }
  if (checkedOut) return <span className="muted small">Checked out</span>
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <input
        aria-label="Visit summary"
        placeholder="Visit summary (optional)"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        disabled={disabled || busy}
      />
      <button type="button" className={cls} disabled={disabled || busy} onClick={() => void checkOut()}>
        {busy ? 'Saving…' : 'Check out'}
      </button>
    </div>
  )
}
