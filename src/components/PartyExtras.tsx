/** Extra panels shown inside the Supplier and Buyer drawers once a record
 *  exists (T-003 / T-004): GST verification, documents, MD contact numbers and
 *  the communication history with reminders. `ActivityPanel` is also used by
 *  the Lead drawer. */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { errMessage } from '../lib/party'
import { formatDate, formatDateTime } from '../lib/format'
import { GST_PORTAL_URL, lookupGst } from '../lib/integrations'
import { DOC_TYPES, type Activity, type ActivityKind, type MdContact, type PartyDocument } from '../api/types'

export type PartyType = 'supplier' | 'buyer'

/** id -> name for the people who wrote history entries. */
export function useProfileNames(): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    void supabase
      .from('profiles')
      .select('id,name')
      .then(({ data }) => {
        if (!live || !data) return
        setNames(Object.fromEntries((data as { id: string; name: string }[]).map((p) => [p.id, p.name])))
      })
    return () => {
      live = false
    }
  }, [])
  return names
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card pad" style={{ marginTop: 16 }}>
      <h3 className="card-title" style={{ marginTop: 0 }}>
        {title}
      </h3>
      {children}
    </section>
  )
}

/* ---- GST verification ------------------------------------------------------ */

export function GstPanel({
  table,
  id,
  gst,
  status: initial,
  verifiedAt,
  note: initialNote,
  canEdit,
  mirror,
}: {
  /** The same person's record in the other master, when there is one: the GST number is the same, so the result is recorded on both. */
  mirror?: { table: 'supplier_master' | 'buyer_master'; id: string } | null
  table: 'supplier_master' | 'buyer_master'
  id: string
  gst: string
  status: 'unverified' | 'verified' | 'failed'
  verifiedAt: string | null
  note: string | null
  canEdit: boolean
}) {
  const [status, setStatus] = useState(initial)
  const [at, setAt] = useState(verifiedAt)
  const [note, setNote] = useState(initialNote ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [autoMsg, setAutoMsg] = useState<string | null>(null)

  async function record(next: 'verified' | 'failed' | 'unverified') {
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase
      .from(table)
      .update({ gst_status: next, gst_verify_note: note.trim() || null })
      .eq('id', id)
      .select('gst_status,gst_verified_at')
    setBusy(false)
    if (error || !data || data.length === 0) {
      setMsg(error ? errMessage(error) : 'Your account cannot change this record.')
      return
    }
    if (mirror) {
      const other = await supabase.from(mirror.table).update({ gst_status: next, gst_verify_note: note.trim() || null }).eq('id', mirror.id)
      if (other.error) setMsg(`Saved here, but not on the other record: ${errMessage(other.error)}`)
    }
    const row = data[0] as { gst_status: 'unverified' | 'verified' | 'failed'; gst_verified_at: string | null }
    setStatus(row.gst_status)
    setAt(row.gst_verified_at)
  }

  async function tryAutomatic() {
    const res = await lookupGst(gst)
    setAutoMsg(
      res.available
        ? `Portal says: ${res.legalName} (${res.status}, ${res.state}).`
        : 'Automatic lookup is not connected yet. Check the number on the GST portal and record the result below.',
    )
  }

  const chip = status === 'verified' ? 'chip good' : status === 'failed' ? 'chip bad' : 'chip warn'
  return (
    <Section title="GST verification">
      <p style={{ margin: 0 }}>
        <span className="mono">{gst}</span> <span className={chip}>{status === 'unverified' ? 'Not verified' : status === 'verified' ? 'Verified' : 'Check failed'}</span>
        {at && status !== 'unverified' && <span className="muted small"> · {formatDateTime(at)}</span>}
      </p>
      <p className="muted small">
        Changing the GST number resets this to “Not verified”.{' '}
        <a href={GST_PORTAL_URL} target="_blank" rel="noreferrer">
          Open the GST portal search
        </a>
      </p>
      {canEdit && (
        <>
          <div className="field">
            <input aria-label="Verification note" placeholder="Note (optional), e.g. legal name matches" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="drawer-actions" style={{ marginTop: 8, paddingTop: 0, borderTop: 'none' }}>
            <button className="btn sm" type="button" disabled={busy} onClick={() => void record('verified')}>
              Mark verified
            </button>
            <button className="btn sm" type="button" disabled={busy} onClick={() => void record('failed')}>
              Mark check failed
            </button>
            <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void record('unverified')}>
              Reset
            </button>
            <button className="btn ghost sm" type="button" onClick={() => void tryAutomatic()}>
              Look up automatically
            </button>
          </div>
        </>
      )}
      {autoMsg && <p className="muted small">{autoMsg}</p>}
      {msg && <p className="field-warn">{msg}</p>}
    </Section>
  )
}

/* ---- documents ------------------------------------------------------------- */

const BUCKET = 'party-documents'

function sizeText(n: number | null): string {
  if (!n) return ''
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

export function DocumentsPanel({ partyType, partyId, canEdit }: { partyType: PartyType; partyId: string; canEdit: boolean }) {
  const names = useProfileNames()
  const [docs, setDocs] = useState<PartyDocument[] | null>(null)
  const [docType, setDocType] = useState('gst_copy')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('party_documents')
      .select('*')
      .eq('party_type', partyType)
      .eq('party_id', partyId)
      .order('uploaded_at', { ascending: false })
    if (error) setMsg(errMessage(error, 'Could not load documents'))
    setDocs((data ?? []) as PartyDocument[])
  }, [partyType, partyId])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(file: File) {
    setBusy(true)
    setMsg(null)
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_')
    const path = `${partyType}/${partyId}/${crypto.randomUUID()}-${safe}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
    if (up.error) {
      setBusy(false)
      setMsg(up.error.message || 'Upload failed. PDFs, images, Word, Excel and CSV files up to 10 MB are accepted.')
      return
    }
    const { error } = await supabase.from('party_documents').insert({
      party_type: partyType,
      party_id: partyId,
      doc_type: docType,
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

  async function open(doc: PartyDocument) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60)
    if (error || !data) {
      setMsg('Could not open that file.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function remove(doc: PartyDocument) {
    if (!window.confirm(`Delete ${doc.file_name}?`)) return
    setBusy(true)
    const { data, error } = await supabase.from('party_documents').delete().eq('id', doc.id).select('id')
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
    <Section title="Documents">
      <p className="muted small">GST copy, cancelled cheque and KYC forms. Several files of the same kind are fine.</p>
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
                      {DOC_TYPES.find((t) => t.value === d.doc_type)?.label ?? d.doc_type} · {sizeText(d.size_bytes)} ·{' '}
                      {names[d.uploaded_by ?? ''] ?? 'someone'} · {formatDate(d.uploaded_at)}
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
          <select aria-label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)}>
            {DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            type="file"
            aria-label="Choose a file to upload"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void upload(f)
            }}
          />
        </div>
      )}
      {msg && <p className="field-warn">{msg}</p>}
    </Section>
  )
}

/* ---- MD contacts ----------------------------------------------------------- */

export function MdContactsPanel({ partyType, partyId }: { partyType: PartyType; partyId: string }) {
  const [rows, setRows] = useState<MdContact[] | null>(null)
  const [f, setF] = useState({ name: '', mobile: '', email: '', designation: '' })
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('party_md_contacts')
      .select('*')
      .eq('party_type', partyType)
      .eq('party_id', partyId)
      .order('created_at')
    if (error) setMsg(errMessage(error, 'Could not load MD contacts'))
    setRows((data ?? []) as MdContact[])
  }, [partyType, partyId])

  useEffect(() => {
    void load()
  }, [load])

  async function add() {
    setMsg(null)
    if (!f.name.trim()) return setMsg('Enter a name.')
    if (!/^[0-9]{10}$/.test(f.mobile)) return setMsg('Mobile must be exactly 10 digits.')
    const { error } = await supabase.from('party_md_contacts').insert({
      party_type: partyType,
      party_id: partyId,
      name: f.name.trim(),
      mobile: f.mobile,
      email: f.email.trim() || null,
      designation: f.designation.trim() || null,
    })
    if (error) return setMsg(/duplicate/i.test(error.message) ? 'That mobile number is already listed.' : errMessage(error))
    setF({ name: '', mobile: '', email: '', designation: '' })
    await load()
  }

  async function remove(c: MdContact) {
    if (!window.confirm(`Remove ${c.name}?`)) return
    const { data, error } = await supabase.from('party_md_contacts').delete().eq('id', c.id).select('id')
    if (error || !data || data.length === 0) return setMsg(error ? errMessage(error) : 'Could not remove that contact.')
    await load()
  }

  return (
    <Section title="MD contact numbers">
      <p className="muted small">Visible only to people with the “View and edit MD contact numbers” permission.</p>
      {rows && rows.length === 0 && <p className="muted small">None recorded.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong> {c.designation && <span className="muted small">({c.designation})</span>}
                    <div className="mono small">
                      {c.mobile} {c.email && <span className="muted">· {c.email}</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn danger sm" type="button" onClick={() => void remove(c)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="form-grid" style={{ marginTop: 8 }}>
        <input aria-label="MD name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input aria-label="MD mobile" placeholder="Mobile (10 digits)" className="mono" maxLength={10} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, '') })} />
        <input aria-label="MD email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input aria-label="MD designation" placeholder="Designation" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
      </div>
      <button className="btn sm" type="button" style={{ marginTop: 8 }} onClick={() => void add()}>
        Add contact
      </button>
      {msg && <p className="field-warn">{msg}</p>}
    </Section>
  )
}

/* ---- history, quotations, reminders, tasks ---------------------------------- */

const KIND_LABEL: Record<ActivityKind, string> = {
  note: 'Note',
  call: 'Call',
  quotation: 'Quotation',
  reminder: 'Reminder',
  task: 'Task',
  discussion: 'Discussion',
  email: 'Email',
  whatsapp: 'WhatsApp',
  meeting: 'Meeting',
}

export function ActivityPanel({
  entityType,
  entityId,
  canWrite,
  kinds = ['note', 'call', 'quotation', 'reminder', 'task'],
  title = 'History and reminders',
  refreshKey = 0,
}: {
  entityType: 'lead' | 'supplier' | 'buyer' | 'deal'
  entityId: string
  canWrite: boolean
  kinds?: ActivityKind[]
  title?: string
  refreshKey?: number
}) {
  const { me } = useAuth()
  const names = useProfileNames()
  const [rows, setRows] = useState<Activity[] | null>(null)
  const [kind, setKind] = useState<ActivityKind>(kinds[0] ?? 'note')
  const [note, setNote] = useState('')
  const [quote, setQuote] = useState('')
  const [due, setDue] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
    if (error) setMsg(errMessage(error, 'Could not load history'))
    setRows((data ?? []) as Activity[])
  }, [entityType, entityId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const needsDue = kind === 'reminder' || kind === 'task'
  async function add() {
    setMsg(null)
    if (!note.trim() && !quote.trim()) return setMsg('Write a note first.')
    if (needsDue && !due) return setMsg('Pick a due date.')
    const { error } = await supabase.from('activity_log').insert({
      entity_type: entityType,
      entity_id: entityId,
      kind,
      note: note.trim() || null,
      quotation_ref: quote.trim() || null,
      due_date: needsDue ? due : null,
    })
    if (error) return setMsg(errMessage(error))
    setNote('')
    setQuote('')
    setDue('')
    await load()
  }

  async function toggleDone(a: Activity) {
    const { data, error } = await supabase
      .from('activity_log')
      .update({ is_done: !a.is_done, done_at: a.is_done ? null : new Date().toISOString(), done_by: a.is_done ? null : me?.id ?? null })
      .eq('id', a.id)
      .select('id')
    if (error || !data || data.length === 0) return setMsg(error ? errMessage(error) : 'Could not update that item.')
    await load()
  }

  const today = new Date().toISOString().slice(0, 10)
  return (
    <Section title={title}>
      {canWrite && (
        <div style={{ marginBottom: 12 }}>
          <div className="form-grid">
            <select aria-label="Entry type" value={kind} onChange={(e) => setKind(e.target.value as ActivityKind)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {needsDue ? (
              <input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            ) : (
              (kind === 'quotation' || kind === 'call') && (
                <input aria-label="Quotation reference" placeholder="Quotation sent (ref / amount)" value={quote} onChange={(e) => setQuote(e.target.value)} />
              )
            )}
          </div>
          <textarea aria-label="Note" rows={2} placeholder="What happened or what needs doing" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 8 }} />
          <button className="btn sm" type="button" style={{ marginTop: 8 }} onClick={() => void add()}>
            Add to history
          </button>
        </div>
      )}
      {msg && <p className="field-warn">{msg}</p>}
      {rows && rows.length === 0 && <p className="muted small">Nothing recorded yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="timeline" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((a) => {
            const open = (a.kind === 'task' || a.kind === 'reminder') && !a.is_done
            const overdue = open && a.due_date !== null && a.due_date < today
            return (
              <li key={a.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line, #e5e5e5)' }}>
                <span className="chip">{KIND_LABEL[a.kind]}</span>
                {a.due_date && (
                  <span className={`chip ${a.is_done ? 'good' : overdue ? 'bad' : 'warn'}`}>
                    {a.is_done ? 'Done' : overdue ? 'Overdue' : 'Due'} {formatDate(a.due_date)}
                  </span>
                )}
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{a.note}</div>
                {a.quotation_ref && <div className="small">Quotation: {a.quotation_ref}</div>}
                <div className="muted small">
                  {names[a.created_by ?? ''] ?? 'Someone'} · {formatDateTime(a.created_at)}
                </div>
                {canWrite && (a.kind === 'task' || a.kind === 'reminder') && (
                  <button className="btn ghost sm" type="button" onClick={() => void toggleDone(a)}>
                    {a.is_done ? 'Re-open' : 'Mark done'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

/** All four panels for a saved supplier or buyer. */
export function PartyExtras({
  partyType,
  partyId,
  gst,
  gstStatus,
  gstVerifiedAt,
  gstNote,
  mirror,
}: {
  mirror?: { table: 'supplier_master' | 'buyer_master'; id: string } | null
  partyType: PartyType
  partyId: string
  gst: string
  gstStatus: 'unverified' | 'verified' | 'failed'
  gstVerifiedAt: string | null
  gstNote: string | null
}) {
  const { can } = useAuth()
  const canEdit = can(partyType === 'supplier' ? 'mill.manage' : 'buyer.manage')
  return (
    <>
      <GstPanel
        table={partyType === 'supplier' ? 'supplier_master' : 'buyer_master'}
        id={partyId}
        gst={gst}
        status={gstStatus}
        verifiedAt={gstVerifiedAt}
        note={gstNote}
        canEdit={canEdit}
        mirror={mirror}
      />
      <DocumentsPanel partyType={partyType} partyId={partyId} canEdit={canEdit} />
      {can('md_contact.view') && <MdContactsPanel partyType={partyType} partyId={partyId} />}
      <ActivityPanel entityType={partyType} entityId={partyId} canWrite={canEdit} />
    </>
  )
}