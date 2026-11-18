/** The Documents column of a monday.com Business Unit: files kept against the
 *  business unit (up to 10; the database enforces the limit). Stored in the
 *  private `company-documents` bucket under <company id>/<uuid>-<file name>. */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/format'
import { errMessage } from '../lib/party'

const BUCKET = 'company-documents'
export const COMPANY_DOC_LIMIT = 10

interface CompanyDocument {
  id: string
  file_name: string
  storage_path: string
  size_bytes: number | null
  uploaded_at: string
}

function sizeText(n: number | null): string {
  if (!n) return ''
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

export function CompanyDocuments({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const [docs, setDocs] = useState<CompanyDocument[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('company_documents')
      .select('id,file_name,storage_path,size_bytes,uploaded_at')
      .eq('company_id', companyId)
      .order('uploaded_at', { ascending: false })
    if (error) setMsg(errMessage(error, 'Could not load documents'))
    setDocs((data ?? []) as CompanyDocument[])
  }, [companyId])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(file: File) {
    if ((docs?.length ?? 0) >= COMPANY_DOC_LIMIT) {
      setMsg(`A business unit can have at most ${COMPANY_DOC_LIMIT} documents.`)
      return
    }
    setBusy(true)
    setMsg(null)
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file'
    const path = `${companyId}/${crypto.randomUUID()}-${safe}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
    if (up.error) {
      setBusy(false)
      setMsg(up.error.message || 'Upload failed.')
      return
    }
    const { error } = await supabase.from('company_documents').insert({
      company_id: companyId,
      file_name: file.name,
      storage_path: path,
      size_bytes: file.size,
      mime_type: file.type || null,
    })
    if (error) {
      await supabase.storage.from(BUCKET).remove([path])
      setMsg(errMessage(error, 'Could not record the document'))
    }
    setBusy(false)
    await load()
  }

  async function open(doc: CompanyDocument) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60)
    if (error || !data) {
      setMsg('Could not open that file.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function remove(doc: CompanyDocument) {
    if (!window.confirm(`Delete ${doc.file_name}?`)) return
    setBusy(true)
    const { data, error } = await supabase.from('company_documents').delete().eq('id', doc.id).select('id')
    if (error || !data || data.length === 0) {
      setBusy(false)
      setMsg(error ? errMessage(error) : 'Your account cannot delete this document.')
      return
    }
    await supabase.storage.from(BUCKET).remove([doc.storage_path])
    setBusy(false)
    await load()
  }

  return (
    <>
      <h3 className="section-title">Documents</h3>
      <p className="muted small">Up to {COMPANY_DOC_LIMIT} files kept against this business unit.</p>
      {docs && docs.length === 0 && <p className="muted small">No documents yet.</p>}
      {docs && docs.length > 0 && (
        <div className="table-wrap">
          <table>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    <button className="btn ghost sm" type="button" onClick={() => void open(d)}>
                      {d.file_name}
                    </button>
                    <div className="muted small">
                      {sizeText(d.size_bytes)} {sizeText(d.size_bytes) && '·'} {formatDate(d.uploaded_at)}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
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
        <div className="drawer-actions" style={{ marginTop: 8, paddingTop: 0, borderTop: 'none' }}>
          <input
            type="file"
            aria-label="Choose a file to upload"
            disabled={busy || (docs?.length ?? 0) >= COMPANY_DOC_LIMIT}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void upload(f)
            }}
          />
        </div>
      )}
      {msg && <p className="field-warn">{msg}</p>}
    </>
  )
}
