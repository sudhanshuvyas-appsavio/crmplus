/** Documents on a Lead (monday "Documents" column): attach, open and remove.
 *  At most 10 files per lead; files live in the private lead-documents
 *  bucket and the database refuses an 11th. */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errMessage } from '../lib/party'
import { useProfileNames } from './PartyExtras'
import { DocumentsCard } from './DocumentsCard'

const BUCKET = 'lead-documents'
const MAX = 10

type LeadDoc = { id: string; file_name: string; storage_path: string; size_bytes: number | null; uploaded_by: string | null; uploaded_at: string }


export function LeadDocuments({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const names = useProfileNames()
  const [docs, setDocs] = useState<LeadDoc[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [removing, setRemoving] = useState<LeadDoc | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('lead_documents').select('*').eq('lead_id', leadId).order('uploaded_at', { ascending: false })
    if (error) setMsg(errMessage(error, 'Could not load the documents'))
    setDocs((data ?? []) as LeadDoc[])
  }, [leadId])
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
      const path = `${leadId}/${crypto.randomUUID()}-${safe}`
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
      if (up.error) {
        setMsg(up.error.message || 'Upload failed.')
        continue
      }
      const { error } = await supabase.from('lead_documents').insert({ lead_id: leadId, file_name: file.name, storage_path: path, size_bytes: file.size, mime_type: file.type || null })
      if (error) {
        await supabase.storage.from(BUCKET).remove([path])
        setMsg(errMessage(error, 'Could not record the document'))
      }
    }
    setBusy(false)
    await load()
  }

  async function open(d: LeadDoc) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path, 60)
    if (error || !data) return setMsg('Could not open that file.')
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function remove(d: LeadDoc) {
    setBusy(true)
    const { data, error } = await supabase.from('lead_documents').delete().eq('id', d.id).select('id')
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
    <DocumentsCard
      title={'Documents'}
      docs={docs} names={names} canEdit={canEdit} full={full} max={MAX} busy={busy} msg={msg}
      onFiles={(files) => void upload(files)} onOpen={(d) => void open(d)}
      removing={removing} onAskRemove={setRemoving} onConfirmRemove={(d) => void remove(d)} onCancelRemove={() => setRemoving(null)}
      removeNote="The file is deleted from the lead."
    />
  )
}
