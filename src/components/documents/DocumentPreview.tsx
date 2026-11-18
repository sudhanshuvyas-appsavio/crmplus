/** In-app preview of an uploaded document. Images, PDFs and plain-text files
 *  (txt, csv, json, log, md) open in a dialog; anything else (Word, Excel...)
 *  says so and offers a download instead. Files are read through a short-lived
 *  signed URL from the private bucket, so nothing becomes public. */

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../Modal'

export interface PreviewDoc {
  file_name: string
  storage_path: string
  mime_type?: string | null
}

type Kind = 'image' | 'pdf' | 'text' | 'none'

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
const TEXT_EXT = ['txt', 'csv', 'json', 'log', 'md', 'xml']
const TEXT_LIMIT = 512 * 1024

export function previewKind(name: string, mime?: string | null): Kind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const m = (mime ?? '').toLowerCase()
  if (m.startsWith('image/') || IMAGE_EXT.includes(ext)) return 'image'
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (m.startsWith('text/') || m === 'application/json' || TEXT_EXT.includes(ext)) return 'text'
  return 'none'
}

/** Whether a file can be shown in the preview dialog (used to label the button). */
export const canPreview = (name: string, mime?: string | null) => previewKind(name, mime) !== 'none'

/** Saves the file with its real name (a signed URL that forces a download). */
export async function downloadDocument(bucket: string, doc: PreviewDoc): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(doc.storage_path, 120, { download: doc.file_name })
  if (error || !data) return 'Could not download that file.'
  const a = document.createElement('a')
  a.href = data.signedUrl
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  return null
}

export function DocumentPreview({
  bucket,
  docs,
  index,
  onIndex,
  onClose,
}: {
  bucket: string
  docs: PreviewDoc[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const doc = docs[index]
  const kind = doc ? previewKind(doc.file_name, doc.mime_type) : 'none'
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!doc) return undefined
    let live = true
    setUrl(null)
    setText(null)
    setErr(null)
    if (kind === 'none') return undefined
    void (async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(doc.storage_path, 300)
      if (!live) return
      if (error || !data) return setErr('Could not open that file.')
      setUrl(data.signedUrl)
      if (kind === 'text') {
        try {
          const res = await fetch(data.signedUrl)
          const body = await res.text()
          if (live) setText(body.length > TEXT_LIMIT ? `${body.slice(0, TEXT_LIMIT)}\n\n… (file continues; download it to read the rest)` : body)
        } catch {
          if (live) setErr('Could not read that file.')
        }
      }
    })()
    return () => {
      live = false
    }
  }, [bucket, doc, kind])

  if (!doc) return null

  return (
    <Modal
      title={doc.file_name}
      description={docs.length > 1 ? `File ${index + 1} of ${docs.length}` : undefined}
      size="xl"
      portal
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {docs.length > 1 && (
              <>
                <button className="btn ghost" type="button" disabled={index === 0} onClick={() => onIndex(index - 1)}>
                  Previous
                </button>
                <button className="btn ghost" type="button" disabled={index >= docs.length - 1} onClick={() => onIndex(index + 1)}>
                  Next
                </button>
              </>
            )}
            <button
              className="btn primary"
              type="button"
              onClick={() => void downloadDocument(bucket, doc).then((m) => m && setErr(m))}
            >
              Download
            </button>
          </span>
        </>
      }
    >
      {err && <div className="alert">{err}</div>}
      {kind === 'none' && (
        <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>
          This file type cannot be previewed here. Use Download to open it on your computer.
        </p>
      )}
      {kind !== 'none' && !url && !err && <p className="muted small">Loading preview…</p>}
      {kind === 'image' && url && (
        <div className="doc-preview-frame doc-preview-image">
          <img src={url} alt={doc.file_name} />
        </div>
      )}
      {kind === 'pdf' && url && <iframe className="doc-preview-frame doc-preview-pdf" src={url} title={doc.file_name} />}
      {kind === 'text' && text !== null && <pre className="doc-preview-frame doc-preview-text">{text}</pre>}
    </Modal>
  )
}
