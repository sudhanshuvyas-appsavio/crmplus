/** Proof photos and documents for a task: upload (with the phone camera when
 *  asked) and a gallery of what is already attached.
 *
 *  Files go to the private `task-proofs` bucket under <task id>/<uuid>-<name>;
 *  the database row in task_attachments is written second, and the file is
 *  removed again if that fails, so there is never a file without a record. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errMessage } from '../lib/party'
import { TASK_BUCKET, proofPath } from '../lib/tasks'
import { signedProofUrl } from '../lib/taskData'
import { formatDateTime } from '../lib/format'
import type { TaskAttachment } from '../api/types'
import { getPosition } from './GeoCapture'
import { pushToast } from './Toast'

const MAX_BYTES = 20 * 1024 * 1024
const ACCEPT = 'image/*,application/pdf'

export function ProofUpload({
  taskId,
  kind = 'proof',
  camera = false,
  withLocation = false,
  disabled,
  label,
  onUploaded,
}: {
  taskId: string
  kind?: 'proof' | 'photo' | 'document'
  /** Opens the phone camera directly (the capture attribute). */
  camera?: boolean
  /** Also records where the photo was taken, when the device allows it. */
  withLocation?: boolean
  disabled?: boolean
  label?: string
  onUploaded: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    if (file.size > MAX_BYTES) return pushToast('error', 'That file is over 20 MB.')
    setBusy(true)
    let lat: number | null = null
    let lng: number | null = null
    if (withLocation) {
      try {
        const pos = await getPosition(8000)
        lat = Math.round(pos.lat * 1e6) / 1e6
        lng = Math.round(pos.lng * 1e6) / 1e6
      } catch {
        /* the photo is still worth keeping without a location */
      }
    }
    const path = proofPath(taskId, file.name)
    const up = await supabase.storage.from(TASK_BUCKET).upload(path, file, { contentType: file.type || undefined })
    if (up.error) {
      setBusy(false)
      return pushToast('error', errMessage(up.error, 'Could not upload the file'))
    }
    const ins = await supabase.from('task_attachments').insert({
      task_id: taskId, kind, file_name: file.name, storage_path: path, size_bytes: file.size, content_type: file.type || null, lat, lng,
    })
    if (ins.error) {
      await supabase.storage.from(TASK_BUCKET).remove([path])
      setBusy(false)
      return pushToast('error', errMessage(ins.error, 'Could not save the proof'))
    }
    setBusy(false)
    pushToast('success', 'Proof uploaded.')
    onUploaded()
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        capture={camera ? 'environment' : undefined}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file)
        }}
      />
      <button type="button" className="btn" disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? 'Uploading…' : (label ?? (camera ? 'Take photo' : 'Upload proof'))}
      </button>
    </>
  )
}

/** What is attached to a task, with short-lived links (images show as thumbnails). */
export function ProofGallery({ taskId, refreshKey = 0 }: { taskId: string; refreshKey?: number }) {
  const [rows, setRows] = useState<(TaskAttachment & { url: string | null })[] | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('task_attachments').select('*').eq('task_id', taskId).order('uploaded_at', { ascending: false })
    const list = (data ?? []) as TaskAttachment[]
    setRows(await Promise.all(list.map(async (a) => ({ ...a, url: await signedProofUrl(a.storage_path) }))))
  }, [taskId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (rows === null) return <p className="muted small">Loading…</p>
  if (rows.length === 0) return <p className="muted small">No proof uploaded yet.</p>
  return (
    <div className="proof-grid">
      {rows.map((a) => (
        <a key={a.id} className="proof-item" href={a.url ?? undefined} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
          {a.content_type?.startsWith('image/') && a.url ? <img src={a.url} alt={a.file_name} /> : <div style={{ height: 110, display: 'grid', placeItems: 'center' }}>PDF</div>}
          <div className="proof-cap">
            {a.file_name}
            <div className="muted small">
              {formatDateTime(a.uploaded_at)}
              {a.lat != null && a.lng != null ? ` · ${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` : ''}
            </div>
          </div>
        </a>
      ))}
    </div>
  )
}
