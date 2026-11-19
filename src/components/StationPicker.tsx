import { useState } from 'react'
import type { Station } from '../api/types'

const NEW_STATION = '__new_station__'

export function StationPicker({ value, stations, onChange }: { value: string; stations: Station[]; onChange: (v: string) => void }) {
  const known = stations.some((st) => st.name.toLowerCase() === value.trim().toLowerCase())
  const [adding, setAdding] = useState(false)
  if (adding) {
    return (
      <span style={{ display: 'flex', gap: 8 }}>
        <input id="l-station" autoFocus placeholder="New station name" value={value} onChange={(e) => onChange(e.target.value)} />
        <button className="btn ghost sm" type="button" onClick={() => { setAdding(false); onChange('') }}>
          Use list
        </button>
      </span>
    )
  }
  return (
    <select
      id="l-station"
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW_STATION) {
          setAdding(true)
          onChange('')
        } else onChange(e.target.value)
      }}
    >
      <option value="">—</option>
      {value && !known && <option value={value}>{value} (new)</option>}
      {stations
        .filter((st) => st.is_active || st.name === value)
        .map((st) => (
          <option key={st.id} value={st.name}>
            {st.name}
          </option>
        ))}
      <option value={NEW_STATION}>+ Add new station…</option>
    </select>
  )
}
