/** The Lead-Quotation tab, arranged like monday's Lead Quotation page: a title card with
 *  Preview PDF and Generate, step 1 "Select Lead", step 2 "Quotation Lines" (Thread Count,
 *  Supplier, Rate, and + Add Row).
 *
 *  - The Supplier list for a row only holds suppliers that supply that count
 *    (Buyers & Suppliers > Counts), so a quote cannot name a supplier who does not
 *    carry the count.
 *  - Rows are kept on the lead ("Save rows"; Generate saves them first). Generate then freezes
 *    a copy into lead_quotations with the PDF (private lead-quotations bucket), numbered
 *    QT-yyyy-nnnn by the database.
 *  - No email is sent from here; the PDF is downloaded and kept on the lead. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errMessage, numOrNull } from '../lib/party'
import { formatDate, formatDateTime } from '../lib/format'
import type { CountRow, Lead } from '../api/types'
import { ConfirmDialog } from './ConfirmDialog'
import { ComboInput } from './ComboInput'

const BUCKET = 'lead-quotations'

type Row = { count_id: string; countText: string; supplier_id: string; rate: string }
type SupplierOpt = { id: string; name: string; is_active: boolean }
type Quotation = { id: string; quote_no: string; storage_path: string; generated_at: string; lines: { line_no: number; count: string; supplier: string; rate: number }[] }

const blank = (): Row => ({ count_id: '', countText: '', supplier_id: '', rate: '' })
const leadText = (l: Lead) => `${l.lead_no} · ${l.party_name}`

export function LeadQuotationPage({ leads, counts, canEdit, initialLeadId }: { leads: Lead[]; counts: CountRow[]; canEdit: boolean; initialLeadId?: string | null }) {
  const [leadId, setLeadId] = useState(initialLeadId ?? '')
  const lead = leads.find((l) => l.id === leadId) ?? null
  const [leadSearch, setLeadSearch] = useState(() => { const l = leads.find((x) => x.id === initialLeadId); return l ? leadText(l) : '' })
  const [rows, setRows] = useState<Row[]>([blank()])
  const [saved, setSaved] = useState('[]')
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([])
  const [carries, setCarries] = useState<Map<string, Set<string>>>(new Map()) // count_id -> supplier ids
  const [history, setHistory] = useState<Quotation[]>([])
  const [busy, setBusy] = useState<'' | 'save' | 'preview' | 'generate' | 'remove'>('')
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Quotation | null>(null)

  const countName = useMemo(() => new Map(counts.map((c) => [c.id, c.display_name])), [counts])
  const countByText = useMemo(() => new Map(counts.map((c) => [c.display_name, c.id])), [counts])
  const supplierName = useMemo(() => new Map(suppliers.map((x) => [x.id, x.name])), [suppliers])

  // suppliers and which counts they supply: once, for the whole tab
  useEffect(() => {
    void Promise.all([
      supabase.from('supplier_master').select('id, name, is_active').order('name'),
      supabase.from('party_counts').select('party_id, count_id').eq('party_type', 'supplier'),
    ]).then(([s, pc]) => {
      setSuppliers((s.data ?? []) as SupplierOpt[])
      const map = new Map<string, Set<string>>()
      for (const r of (pc.data ?? []) as { party_id: string; count_id: string }[]) {
        if (!map.has(r.count_id)) map.set(r.count_id, new Set())
        map.get(r.count_id)!.add(r.party_id)
      }
      setCarries(map)
    })
  }, [])

  const load = useCallback(async () => {
    if (!leadId) { setRows([blank()]); setSaved('[]'); setHistory([]); return }
    const [l, h] = await Promise.all([
      supabase.from('lead_quote_lines').select('count_id, supplier_id, rate').eq('lead_id', leadId).order('line_no'),
      supabase.from('lead_quotations').select('id, quote_no, storage_path, generated_at, lines').eq('lead_id', leadId).order('generated_at', { ascending: false }),
    ])
    const loaded = ((l.data ?? []) as { count_id: string; supplier_id: string; rate: number }[])
      .map((r) => ({ count_id: r.count_id, countText: countName.get(r.count_id) ?? '', supplier_id: r.supplier_id, rate: String(r.rate) }))
    setRows(loaded.length > 0 ? loaded : [blank()])
    setSaved(JSON.stringify(loaded))
    setHistory((h.data ?? []) as Quotation[])
    if (l.error) setErr(errMessage(l.error, 'Could not load the quotation rows'))
  }, [leadId, countName])
  useEffect(() => { void load() }, [load])

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const used = rows.filter((r) => r.countText.trim() || r.supplier_id || r.rate.trim())
  const dirty = JSON.stringify(used) !== saved

  function pickLead(text: string) {
    setLeadSearch(text)
    const hit = leads.find((l) => leadText(l) === text)
    setLeadId(hit?.id ?? '')
    setErr(null)
    setOk(null)
  }

  /** What is wrong with the rows, as sentences; empty when they can be saved or quoted. */
  function problems(): string[] {
    const out: string[] = []
    used.forEach((r, i) => {
      const n = i + 1
      if (!r.count_id) out.push(`Row ${n}: choose a thread count from the list`)
      else if (!r.supplier_id) out.push(`Row ${n}: choose a supplier`)
      const rate = numOrNull(r.rate)
      if (rate === null || rate < 0) out.push(`Row ${n}: enter a rate (a number, zero or more)`)
    })
    const seen = new Set<string>()
    used.forEach((r, i) => {
      const key = `${r.count_id}|${r.supplier_id}`
      if (r.count_id && r.supplier_id && seen.has(key)) out.push(`Row ${i + 1}: the same count and supplier is already quoted`)
      seen.add(key)
    })
    return out
  }

  async function saveRows(): Promise<boolean> {
    if (!lead) { setErr('Select a lead first.'); return false }
    const bad = problems()
    if (bad.length > 0) { setErr(bad.join('. ') + '.'); return false }
    setErr(null)
    const payload = used.map((r, i) => ({ lead_id: lead.id, line_no: i + 1, count_id: r.count_id, supplier_id: r.supplier_id, rate: numOrNull(r.rate) }))
    const del = await supabase.from('lead_quote_lines').delete().eq('lead_id', lead.id)
    if (del.error) { setErr(errMessage(del.error, 'Could not save the rows')); return false }
    if (payload.length > 0) {
      const ins = await supabase.from('lead_quote_lines').insert(payload)
      if (ins.error) { setErr(errMessage(ins.error, 'Could not save the rows')); await load(); return false }
    }
    setSaved(JSON.stringify(used))
    if (used.length === 0) setRows([blank()])
    return true
  }

  const linesNow = () => used.map((r, i) => ({ line_no: i + 1, count: countName.get(r.count_id) ?? '—', supplier: supplierName.get(r.supplier_id) ?? '—', rate: numOrNull(r.rate) ?? 0 }))

  async function preview() {
    if (!lead) { setErr('Select a lead first.'); return }
    const bad = problems()
    if (bad.length > 0 || used.length === 0) { setErr(bad.length ? bad.join('. ') + '.' : 'Add at least one row to quote.'); return }
    setBusy('preview'); setErr(null); setOk(null)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      drawQuotation(doc, lead, linesNow(), 'Preview')
      window.open(URL.createObjectURL(doc.output('blob')), '_blank', 'noopener')
    } catch (e) { setErr(errMessage(e, 'Could not build the PDF')) }
    setBusy('')
  }

  async function generate() {
    if (!lead) { setErr('Select a lead first.'); return }
    setBusy('generate'); setErr(null); setOk(null)
    try {
      if (!(await saveRows())) { setBusy(''); return }
      const lines = linesNow()
      if (lines.length === 0) { setErr('Add at least one row to quote.'); setBusy(''); return }
      // number first, so the number printed on the PDF is the number stored
      const path = `${lead.id}/${crypto.randomUUID()}.pdf`
      const created = await supabase.from('lead_quotations').insert({ lead_id: lead.id, lines, storage_path: path }).select('id, quote_no').single()
      if (created.error || !created.data) { setErr(errMessage(created.error, 'Could not create the quotation')); setBusy(''); return }
      const { id, quote_no } = created.data as { id: string; quote_no: string }
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      drawQuotation(doc, lead, lines, quote_no)
      const blob = doc.output('blob')
      const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'application/pdf' })
      if (up.error) {
        await supabase.from('lead_quotations').delete().eq('id', id)
        setErr(up.error.message || 'Could not store the PDF.'); setBusy(''); return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${quote_no}-${lead.lead_no}.pdf`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      setOk(`${quote_no} generated and saved on ${lead.lead_no}.`)
      await load()
    } catch (e) { setErr(errMessage(e, 'Could not generate the quotation')) }
    setBusy('')
  }

  async function open(q: Quotation) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(q.storage_path, 60)
    if (error || !data) return setErr('Could not open that quotation.')
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function reallyRemove(q: Quotation) {
    setBusy('remove')
    const { data, error } = await supabase.from('lead_quotations').delete().eq('id', q.id).select('id')
    if (error || !data || data.length === 0) { setErr(error ? errMessage(error) : 'Your account cannot remove this quotation.'); setRemoving(null); setBusy(''); return }
    await supabase.storage.from(BUCKET).remove([q.storage_path])
    setRemoving(null)
    setBusy('')
    setOk(`${q.quote_no} removed.`)
    await load()
  }

  const rowsOff = !canEdit || !lead
  return (
    <div className="lq-page">
      <section className="fs-card lq-title">
        <div>
          <h2>Lead Quotation</h2>
          <p>Commission Desk · thread count · supplier pricing</p>
        </div>
        <div className="lq-title-actions">
          <button className="btn" type="button" disabled={busy !== '' || !lead || used.length === 0} onClick={() => void preview()}>{busy === 'preview' ? 'Building…' : 'Preview PDF'}</button>
          {canEdit && <button className="btn primary" type="button" disabled={busy !== '' || !lead || used.length === 0} onClick={() => void generate()}>{busy === 'generate' ? 'Generating…' : 'Generate'}</button>}
        </div>
      </section>

      {err && <div className="alert" role="alert">{err}</div>}
      {ok && <div className="notice small" role="status">{ok}</div>}

      <section className="fs-card" aria-label="Select Lead">
        <header className="fs-head"><div className="lq-step"><span className="lq-num">1</span><h3>Select Lead</h3></div></header>
        <div className="fs-body">
          <div className="field">
            <label htmlFor="lq-lead" className="lq-cap">Lead / Opportunity</label>
            <ComboInput id="lq-lead" placeholder="Search lead…" value={leadSearch} onChange={pickLead} options={leads.map((l) => leadText(l))} />
          </div>
        </div>
      </section>

      <section className="fs-card" aria-label="Quotation Lines">
        <header className="fs-head"><div className="lq-step"><span className="lq-num">2</span><h3>Quotation Lines</h3></div></header>
        <div className="fs-body">
          <div className="lq-grid lq-grid-head"><span>Thread count</span><span>Supplier</span><span>Rate</span><span /></div>
          {rows.map((r, i) => {
            const carriers = r.count_id ? carries.get(r.count_id) ?? new Set<string>() : new Set<string>()
            const options = suppliers.filter((s) => carriers.has(s.id) && (s.is_active || s.id === r.supplier_id))
            return (
              <div className="lq-grid" key={i}>
                <ComboInput
                  ariaLabel={`Thread count, row ${i + 1}`}
                  placeholder="Search count…"
                  value={r.countText}
                  disabled={rowsOff}
                  options={counts.filter((c) => c.is_active).map((c) => c.display_name)}
                  onChange={(text) => { const id = countByText.get(text) ?? ''; set(i, { countText: text, count_id: id, supplier_id: id === r.count_id ? r.supplier_id : '' }) }}
                />
                <select aria-label={`Supplier, row ${i + 1}`} value={r.supplier_id} disabled={rowsOff || !r.count_id} onChange={(e) => set(i, { supplier_id: e.target.value })}>
                  <option value="">{r.count_id ? (options.length ? 'Choose a supplier…' : 'No supplier carries this count') : 'Select count first…'}</option>
                  {options.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
                <input aria-label={`Rate, row ${i + 1}`} className="mono" inputMode="decimal" placeholder="e.g. 250" value={r.rate} disabled={rowsOff} onChange={(e) => set(i, { rate: e.target.value })} />
                <button className="lq-x" type="button" aria-label={`Remove row ${i + 1}`} disabled={rowsOff} onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [blank()])}>×</button>
              </div>
            )
          })}
          <div className="lq-add">
            <button className="lq-add-btn" type="button" disabled={rowsOff} onClick={() => setRows([...rows, blank()])}>+ Add Row</button>
            {canEdit && lead && dirty && (
              <button className="btn sm" type="button" disabled={busy !== ''} onClick={async () => { setBusy('save'); setOk(null); if (await saveRows()) setOk('Quotation rows saved.'); setBusy('') }}>{busy === 'save' ? 'Saving…' : 'Save rows'}</button>
            )}
          </div>
        </div>
      </section>

      {history.length > 0 && (
        <section className="fs-card" aria-label="Generated quotations">
          <header className="fs-head"><div><h3>Generated quotations</h3><p>For {lead?.lead_no}</p></div></header>
          <div className="fs-body">
            <ul className="history">
              {history.map((q) => (
                <li key={q.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn ghost sm" type="button" onClick={() => void open(q)}>{q.quote_no}</button>
                  <span className="muted small">{q.lines.length} row{q.lines.length === 1 ? '' : 's'} · {formatDateTime(q.generated_at)}</span>
                  {canEdit && <button className="btn ghost sm push" type="button" onClick={() => setRemoving(q)}>Remove</button>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.quote_no}?`}
          confirmLabel="Remove quotation"
          busy={busy === 'remove'}
          onConfirm={() => void reallyRemove(removing)}
          onClose={() => setRemoving(null)}
        >
          The generated PDF is deleted from this lead. The quotation rows above are not changed.
        </ConfirmDialog>
      )}
    </div>
  )
}

/** One A4 page: header, lead details, the rows as a table. Plain text only (no rupee glyph in the built-in font). */
function drawQuotation(doc: import('jspdf').jsPDF, lead: Lead, lines: { line_no: number; count: string; supplier: string; rate: number }[], quoteNo: string) {
  const left = 15
  const right = 195
  let y = 20
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Quotation', left, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(`No.: ${quoteNo}`, right, y - 6, { align: 'right' })
  doc.text(`Date: ${formatDate(new Date().toISOString())}`, right, y, { align: 'right' })
  y += 12
  doc.setFont('helvetica', 'bold'); doc.text('To', left, y)
  doc.setFont('helvetica', 'normal')
  y += 6; doc.text(lead.party_name, left, y)
  if (lead.contact_person) { y += 5; doc.text(`Attn: ${lead.contact_person}`, left, y) }
  if (lead.mobile) { y += 5; doc.text(`${lead.mobile_cc ?? '+91'} ${lead.mobile}`, left, y) }
  y += 5; doc.text(`Reference: ${lead.lead_no}`, left, y)
  y += 12
  const cols = { n: left, count: left + 12, supplier: left + 100, rate: right }
  doc.setFont('helvetica', 'bold')
  doc.text('#', cols.n, y); doc.text('Thread count', cols.count, y); doc.text('Supplier', cols.supplier, y); doc.text('Rate (INR)', cols.rate, y, { align: 'right' })
  y += 2; doc.line(left, y, right, y); y += 6
  doc.setFont('helvetica', 'normal')
  for (const l of lines) {
    if (y > 275) { doc.addPage(); y = 20 }
    const countLines = doc.splitTextToSize(l.count, 84) as string[]
    const supplierLines = doc.splitTextToSize(l.supplier, 58) as string[]
    doc.text(String(l.line_no), cols.n, y)
    doc.text(countLines, cols.count, y)
    doc.text(supplierLines, cols.supplier, y)
    doc.text(l.rate.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), cols.rate, y, { align: 'right' })
    y += Math.max(countLines.length, supplierLines.length) * 5 + 3
  }
  doc.line(left, y - 1, right, y - 1)
}
