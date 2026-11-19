/** Documents on a Dispatch and Billing item (monday "Documents" column): attach, open and remove.
 *  At most 10 files per item; files live in the private order-documents
 *  bucket and the database refuses an 11th. */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errMessage } from '../lib/party'
import { formatDate } from '../lib/format'
import { useProfileNames } from './PartyExtras'
import { ConfirmDialog } from './ConfirmDialog'

const BUCKET = 'order-documents'
const MAX = 10

type OrderDoc = { id: string; file_name: string; storage_path: string; size_bytes: number | null; uploaded_by: string | null; uploaded_at: string }

const sizeText = (n: number | null) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Uploads files to an item (used by the creation pop-up once the item exists). Returns what went wrong, one sentence per file. */
export async function uploadOrderFiles(orderId: string, files: File[]): Promise<string[]> {
  const problems: string[] = []
  for (const file of files.slice(0, MAX)) {
    if (file.size > 10 * 1048576) { problems.push(`${file.name} is larger than 10 MB`); continue }
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_')
    const path = `${orderId}/${crypto.randomUUID()}-${safe}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
    if (up.error) { problems.push(`${file.name}: ${up.error.message || 'upload failed'}`); continue }
    const { error } = await supabase.from('order_documents').insert({ order_id: orderId, file_name: file.name, storage_path: path, size_bytes: file.size, mime_type: file.type || null })
    if (error) {
      await supabase.storage.from(BUCKET).remove([path])
      problems.push(`${file.name}: ${errMessage(error, 'could not be recorded')}`)
    }
  }
  return problems
}

export function OrderDocuments({ orderId, canEdit }: { orderId: string; canEdit: boolean }) {
  const names = useProfileNames()
  const [docs, setDocs] = useState<OrderDoc[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [removing, setRemoving] = useState<OrderDoc | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('order_documents').select('*').eq('order_id', orderId).order('uploaded_at', { ascending: false })
    if (error) setMsg(errMessage(error, 'Could not load the documents'))
    setDocs((data ?? []) as OrderDoc[])
  }, [orderId])
  useEffect(() => {
    void load()
  }, [load])

  async function upload(files: FileList) {
    const room = MAX - (docs?.length ?? 0)
    const list = Array.from(files).slice(0, room)
    if (files.length > room) setMsg(`Only ${room} more file${room === 1 ? '' : 's'} can be added (at most ${MAX}).`)
    else setMsg(null)
    setBusy(true)
    for (const file of list) {
      if (file.size > 10 * 1048576) {
        setMsg(`${file.name} is larger than 10 MB.`)
        continue
      }
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_')
      const path = `${orderId}/${crypto.randomUUID()}-${safe}`
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
      if (up.error) {
        setMsg(up.error.message || 'Upload failed.')
        continue
      }
      const { error } = await supabase.from('order_documents').insert({ order_id: orderId, file_name: file.name, storage_path: path, size_bytes: file.size, mime_type: file.type || null })
      if (error) {
        await supabase.storage.from(BUCKET).remove([path])
        setMsg(errMessage(error, 'Could not record the document'))
      }
    }
    setBusy(false)
    await load()
  }

  async function open(d: OrderDoc) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path, 60)
    if (error || !data) return setMsg('Could not open that file.')
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function remove(d: OrderDoc) {
    setBusy(true)
    const { data, error } = await supabase.from('order_documents').delete().eq('id', d.id).select('id')
    if (error || !data || data.length === 0) {
      setBusy(false)
      setRemoving(null)
      return setMsg(error ? errMessage(error) : 'Your account cannot remove this document.')
    }
    await supabase.storage.from(BUCKET).remove([d.storage_path])
    setBusy(false)
    setRemoving(null)
    await load()
  }

  const full = (docs?.length ?? 0) >= MAX
  return (
    <>
      <h3 className="section-title">Documents {docs ? <span className="muted small">({docs.length})</span> : null}</h3>
      {msg && <p className="field-warn">{msg}</p>}
      {docs && docs.length === 0 && <p className="muted small">No documents yet.</p>}
      {docs && docs.length > 0 && (
        <ul className="history">
          {docs.map((d) => (
            <li key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn ghost sm" type="button" onClick={() => void open(d)}>{d.file_name}</button>
              <span className="muted small">{sizeText(d.size_bytes)} · {names[d.uploaded_by ?? ''] ?? 'someone'} · {formatDate(d.uploaded_at)}</span>
              {canEdit && <button className="btn ghost sm push" type="button" disabled={busy} onClick={() => setRemoving(d)}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !full && (
        <label className="btn sm" style={{ marginTop: 8 }}>
          {busy ? 'Uploading…' : 'Attach files'}
          <input type="file" multiple hidden disabled={busy} onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = '' }} />
        </label>
      )}
      {removing && (
        <ConfirmDialog title={`Remove ${removing.file_name}?`} confirmLabel="Remove" busy={busy} onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)}>
          The file is deleted from this item.
        </ConfirmDialog>
      )}
    </>
  )
}
