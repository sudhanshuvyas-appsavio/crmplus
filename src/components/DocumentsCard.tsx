/** One look for the Documents block on every CRM record (lead, deal, confirmation, dispatch item):
 *  a titled card with the count and the Attach button in its header, an empty state that says what to do,
 *  and a row per file with its size, who added it and when. The data and upload logic stay with each record's own component. */

import type { ReactNode } from 'react'
import { formatDate } from '../lib/format'
import { ConfirmDialog } from './ConfirmDialog'

export type DocItem = { id: string; file_name: string; size_bytes: number | null; uploaded_by: string | null; uploaded_at: string }

const sizeText = (n: number | null) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export function DocumentsCard<T extends DocItem>({
  title,
  hideTitle = false,
  docs,
  names,
  canEdit,
  full,
  max,
  busy,
  msg,
  onFiles,
  onOpen,
  removing,
  onAskRemove,
  onConfirmRemove,
  onCancelRemove,
  removeNote,
}: {
  title: string
  /** The form already shows the heading as the field label. */
  hideTitle?: boolean
  docs: T[] | null
  names: Record<string, string>
  canEdit: boolean
  full: boolean
  max: number
  busy: boolean
  msg: string | null
  onFiles: (files: FileList) => void
  onOpen: (d: T) => void
  removing: T | null
  onAskRemove: (d: T) => void
  onConfirmRemove: (d: T) => void
  onCancelRemove: () => void
  removeNote: ReactNode
}) {
  const attach = canEdit && !full && (
    <label className={`btn sm${busy ? ' disabled' : ''}`}>
      {busy ? 'Uploading…' : 'Attach files'}
      <input type="file" multiple hidden disabled={busy} onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = '' }} />
    </label>
  )
  return (
    <section className="docs-card">
      {hideTitle ? (
        attach && <div className="docs-bar">{attach}</div>
      ) : (
        <header className="docs-head">
          <h3>{title}</h3>
          {docs && <span className="docs-count">{docs.length}</span>}
          <span className="push" />
          {attach}
        </header>
      )}
      <div className="docs-body">
        {msg && <p className="field-warn">{msg}</p>}
        {docs && docs.length === 0 && (
          <div className="docs-empty">{canEdit ? `No documents yet. Attach up to ${max} files.` : 'No documents yet.'}</div>
        )}
        {docs && docs.length > 0 && (
          <ul className="docs-list">
            {docs.map((d) => (
              <li key={d.id}>
                <svg className="docs-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
                </svg>
                <div className="docs-main">
                  <button className="docs-name" type="button" onClick={() => onOpen(d)}>{d.file_name}</button>
                  <span className="docs-meta">{[sizeText(d.size_bytes), names[d.uploaded_by ?? ''] ?? 'someone', formatDate(d.uploaded_at)].filter(Boolean).join(' · ')}</span>
                </div>
                {canEdit && <button className="btn ghost sm" type="button" disabled={busy} onClick={() => onAskRemove(d)}>Remove</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {removing && (
        <ConfirmDialog title={`Remove ${removing.file_name}?`} confirmLabel="Remove" busy={busy} onConfirm={() => onConfirmRemove(removing)} onClose={onCancelRemove}>
          {removeNote}
        </ConfirmDialog>
      )}
    </section>
  )
}

/** The Documents block of a create form: the same card as a saved record's, holding the files
 *  chosen so far. They are uploaded when the record is created. */
export function PendingFilesCard({ files, onChange, max = 10, id, note }: { files: File[]; onChange: (files: File[]) => void; max?: number; id?: string; note: string }) {
  const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
  return (
    <section className="docs-card">
      {files.length < max && (
        <div className="docs-bar">
          <label className="btn sm" title={note}>
            Attach files
            <input id={id} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) onChange([...files, ...Array.from(e.target.files)].slice(0, max)); e.target.value = '' }} />
          </label>
        </div>
      )}
      <div className="docs-body">
        {files.length === 0 ? (
          <div className="docs-empty">{`No files yet. Attach up to ${max}; ${note.charAt(0).toLowerCase()}${note.slice(1)}`}</div>
        ) : (
          <ul className="docs-list">
            {files.map((file, i) => (
              <li key={`${file.name}-${i}`}>
                <svg className="docs-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
                </svg>
                <div className="docs-main">
                  <span className="docs-name plain">{file.name}</span>
                  <span className="docs-meta">{kb(file.size)} · {files.length}/{max} attached</span>
                </div>
                <button className="btn ghost sm" type="button" onClick={() => onChange(files.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
