/** The Documents question of a creation form: pick files now, and they are
 *  uploaded once the record has been saved (it has no id before that). */

import { useState } from 'react'
import { DOCUMENT_LIMIT } from './DocumentList'

const MAX_BYTES = 20 * 1048576
const sizeText = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export function PendingDocuments({
  files,
  onChange,
  disabled = false,
}: {
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
}) {
  const [notes, setNotes] = useState<string[]>([])

  function add(list: FileList | null) {
    if (!list) return
    const next = [...files]
    const said: string[] = []
    for (const f of Array.from(list)) {
      if (f.size > MAX_BYTES) said.push(`${f.name} is larger than 20 MB and was not added.`)
      else if (next.some((x) => x.name === f.name && x.size === f.size)) said.push(`${f.name} is already in the list.`)
      else if (next.length >= DOCUMENT_LIMIT) said.push(`Only ${DOCUMENT_LIMIT} files can be attached; ${f.name} was not added.`)
      else next.push(f)
    }
    setNotes(said)
    onChange(next)
  }
  return (
    <div className="fs-upload">
      <label className="fs-drop">
        <input type="file" multiple disabled={disabled || files.length >= DOCUMENT_LIMIT} onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <span className="fs-drop-title">Choose files to attach</span>
        <span className="fs-drop-hint">Up to {DOCUMENT_LIMIT} files, 20 MB each. Uploaded when you save.</span>
      </label>
      {files.length > 0 && (
        <ul className="fs-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="fs-file-name">{f.name}</span>
              <span className="muted small">{sizeText(f.size)}</span>
              <button className="btn ghost sm" type="button" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {notes.map((n) => (
        <p key={n} className="field-warn">
          {n}
        </p>
      ))}
    </div>
  )
}
