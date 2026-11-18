/** The monday "Documents" file column for a master-data record: a list of the
 *  files kept against it, with upload, preview, download and delete. Works for
 *  any one-table-per-register layout (company_documents, transporter_documents,
 *  location_documents, job_process_documents). Files live in a private bucket
 *  under <pathPrefix>/<uuid>-<name>; the database enforces the file limit. */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/format'
import { errMessage } from '../../lib/party'
import { canPreview, downloadDocument, DocumentPreview } from './DocumentPreview'

export interface DocumentStore {
  table: string
  bucket: string
  /** The column that points at the owning record (company_id, station_id...). */
  parentColumn: string
  /** Folder inside the bucket: "<register>/<record id>" or just "<record id>". */
  pathPrefix: string
  /** What the record is, for messages: "business unit", "transporter"... */
  noun: string
}

interface Doc {
  id: string
  file_name: string
  storage_path: string
  size_bytes: number | null
  mime_type: string | null
  uploaded_at: string
}

export const DOCUMENT_LIMIT = 10
const MAX_BYTES = 20 * 1048576

const sizeText = (n: number | null) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Reads how many documents each record holds (for a "Documents" grid column).
 *  People without read access to the table simply get zeros. */
export async function countDocuments(table: string, parentColumn: string, ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {}
  const { data } = await supabase.from(table).select(parentColumn).in(parentColumn, ids)
  const out: Record<string, number> = {}
  for (const r of (data ?? []) as unknown as Record<string, string>[]) {
    const id = r[parentColumn]
    if (id) out[id] = (out[id] ?? 0) + 1
  }
  return out
}

/** Uploads one file and records it. Returns a message when it failed, else null. */
export async function uploadDocument(store: DocumentStore, parentId: string, file: File): Promise<string | null> {
  if (file.size > MAX_BYTES) return `${file.name} is larger than 20 MB.`
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file'
  const path = `${store.pathPrefix}/${crypto.randomUUID()}-${safe}`
  const up = await supabase.storage.from(store.bucket).upload(path, file, { contentType: file.type || undefined })
  if (up.error) return `${file.name}: ${up.error.message || 'upload failed.'}`
  const { error } = await supabase.from(store.table).insert({
    [store.parentColumn]: parentId,
    file_name: file.name,
    storage_path: path,
    size_bytes: file.size,
    mime_type: file.type || null,
  })
  if (error) {
    await supabase.storage.from(store.bucket).remove([path])
    return `${file.name}: ${errMessage(error, 'could not record the document')}`
  }
  return null
}

/** Uploads files picked on a creation form once the record exists; returns what failed. */
export async function uploadDocuments(store: DocumentStore, parentId: string, files: File[]): Promise<string[]> {
  const failures: string[] = []
  for (const f of files) {
    const problem = await uploadDocument(store, parentId, f)
    if (problem) failures.push(problem)
  }
  return failures
}

export function DocumentList({
  store,
  parentId,
  canEdit,
  onChanged,
}: {
  store: DocumentStore
  parentId: string
  canEdit: boolean
  onChanged?: () => void
}) {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [preview, setPreview] = useState<number | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from(store.table)
      .select('id,file_name,storage_path,size_bytes,mime_type,uploaded_at')
      .eq(store.parentColumn, parentId)
      .order('uploaded_at', { ascending: false })
    if (error) setMsg(errMessage(error, 'Could not load documents'))
    setDocs((data ?? []) as unknown as Doc[])
  }, [store.table, store.parentColumn, parentId])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(files: FileList) {
    const room = DOCUMENT_LIMIT - (docs?.length ?? 0)
    const list = Array.from(files).slice(0, Math.max(room, 0))
    setMsg(files.length > room ? `Only ${Math.max(room, 0)} more file${room === 1 ? '' : 's'} can be added (at most ${DOCUMENT_LIMIT} per ${store.noun}).` : null)
    setBusy(true)
    for (const file of list) {
      const problem = await uploadDocument(store, parentId, file)
      if (problem) setMsg(problem)
    }
    setBusy(false)
    await load()
    onChanged?.()
  }

  async function remove(doc: Doc) {
    if (!window.confirm(`Delete ${doc.file_name}?`)) return
    setBusy(true)
    const { data, error } = await supabase.from(store.table).delete().eq('id', doc.id).select('id')
    if (error || !data || data.length === 0) {
      setBusy(false)
      setMsg(error ? errMessage(error) : 'Your account cannot delete this document.')
      return
    }
    await supabase.storage.from(store.bucket).remove([doc.storage_path])
    setBusy(false)
    await load()
    onChanged?.()
  }

  return (
    <div className="doc-list">
      <p className="muted small">
        Up to {DOCUMENT_LIMIT} files kept against this {store.noun}. Images, PDFs and text files open in a preview; other files download.
      </p>
      {docs && docs.length === 0 && <p className="muted small">No documents yet.</p>}
      {docs && docs.length > 0 && (
        <div className="table-wrap">
          <table>
            <tbody>
              {docs.map((d, i) => (
                <tr key={d.id}>
                  <td className="left">
                    <strong>{d.file_name}</strong>
                    <div className="muted small">
                      {sizeText(d.size_bytes)} {sizeText(d.size_bytes) && '·'} {formatDate(d.uploaded_at)}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canPreview(d.file_name, d.mime_type) && (
                      <button className="btn ghost sm" type="button" onClick={() => setPreview(i)}>
                        Preview
                      </button>
                    )}{' '}
                    <button
                      className="btn ghost sm"
                      type="button"
                      onClick={() => void downloadDocument(store.bucket, d).then((m) => m && setMsg(m))}
                    >
                      Download
                    </button>{' '}
                    {canEdit && (
                      <button className="btn danger sm" type="button" disabled={busy} onClick={() => void remove(d)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <div style={{ marginTop: 8 }}>
          <input
            type="file"
            multiple
            aria-label="Choose files to upload"
            disabled={busy || (docs?.length ?? 0) >= DOCUMENT_LIMIT}
            onChange={(e) => {
              const f = e.target.files
              if (f && f.length > 0) void upload(f)
              e.target.value = ''
            }}
          />
        </div>
      )}
      {msg && <p className="field-warn">{msg}</p>}
      {preview !== null && docs && (
        <DocumentPreview bucket={store.bucket} docs={docs} index={Math.min(preview, docs.length - 1)} onIndex={setPreview} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}
