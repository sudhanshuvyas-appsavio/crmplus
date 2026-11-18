/** The Documents question of a creation form: pick files now, and they are
 *  uploaded once the record has been saved (it has no id before that). */

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
  function add(list: FileList | null) {
    if (!list) return
    const next = [...files]
    for (const f of Array.from(list)) {
      if (next.length >= DOCUMENT_LIMIT || f.size > MAX_BYTES) continue
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue
      next.push(f)
    }
    onChange(next)
  }
  const tooBig = files.some((f) => f.size > MAX_BYTES)
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
      {tooBig && <p className="field-warn">A file is larger than 20 MB.</p>}
    </div>
  )
}
