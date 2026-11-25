/** "Freight Invoice" tab of the Transport Invoice board, as on monday:
 *  a list of the invoices, pick one, "Freight Invoice" -> preview the PDF ->
 *  "Confirm & Upload to Monday", which attaches the PDF to the invoice's
 *  Document column. An invoice with a file in Document counts as Uploaded.
 *
 *  The PDF is the monday Freight Invoice layout plus the two lines the client
 *  asked for (demo, 23 Mar 2026): "Bill To" (the buyer, name only) and
 *  "Delivered to" (the sizing / delivery address, name only). */

import { useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import { useAuth } from '../auth/AuthProvider'
import { type BoardData, type Column, type Item } from './MondayBoard'
import { BOARD_IDS, uploadFile } from '../lib/boards'
import { findColumn } from './mondayForm'

/* ---- reading an invoice off the board ---- */

const C = {
  kt: { t: ['KT INV. NO.', 'KT INV NO', 'KT Invoice No'], p: ['text', 'numbers'] },
  date: { t: ['Date'], p: ['date'] },
  from: { t: ['From'], p: ['mirror'] },
  to: { t: ['To'], p: ['mirror'] },
  billTo: { t: ['Buyer/to', 'Buyer / to', 'Bill To'], p: ['board_relation'] },
  delivery: { t: ['Sizing/Delivery Address', 'Sizing / Delivery Address', 'Delivery Address'], p: ['board_relation'] },
  vehicle: { t: ['Vehicle Number', 'Vehicle No'], p: ['mirror'] },
  millBill: { t: ['Mill Bill No.', 'Mill Bill No'], p: ['numbers', 'text'] },
  lr: { t: ['Lr. No./Date', 'Lr. No/Date', 'Lr No/Date'], p: ['date'] },
  remarks: { t: ['Remarks'], p: ['long_text'] },
  counts: { t: ['Counts'], p: ['mirror', 'numbers'] },
  bags: { t: ['No. Of Bags', 'No Of Bags'], p: ['mirror', 'numbers'] },
  bagWeight: { t: ['Bag Weight'], p: ['numbers'] },
  totalWeight: { t: ['Total Weight'], p: ['formula', 'numbers'] },
  type: { t: ['Type'], p: ['status'] },
  rate: { t: ['Rate'], p: ['numbers'] },
  amount: { t: ['Total Amount'], p: ['formula', 'numbers'] },
  buName: { t: ['Business Unit Name'], p: ['mirror'] },
  bu: { t: ['Business Units'], p: ['board_relation'] },
  buAccount: { t: ['Account Details'], p: ['mirror'] },
  buAddress: { t: ['Address'], p: ['mirror'] },
  buPhone: { t: ['Phone 1'], p: ['mirror'] },
  document: { t: ['Document', 'Documents'], p: ['file'] },
} as const
type Key = keyof typeof C

export interface Invoice {
  id: string
  name: string
  f: Record<Key, string>
  uploaded: boolean
}

const n = (t: string) => {
  const v = parseFloat(t.replace(/,/g, ''))
  return Number.isFinite(v) ? v : NaN
}
const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '')
const first = (t: string) => t.split(',')[0]?.trim() ?? ''

function readInvoices(data: BoardData): { list: Invoice[]; docCol: Column | undefined } {
  const cols = Object.fromEntries(
    (Object.keys(C) as Key[]).map((k) => [k, findColumn(data.columns, [...C[k].t], [...C[k].p])]),
  ) as Record<Key, Column | undefined>
  const list = data.items.map((it: Item) => {
    const f = Object.fromEntries((Object.keys(C) as Key[]).map((k) => [k, cols[k] ? it.values[cols[k]!.id]?.text ?? '' : ''])) as Record<Key, string>
    // the board's formulas, in case monday sends a formula back empty
    const bags = n(f.bags)
    if (!f.totalWeight) f.totalWeight = fmt(bags * n(f.bagWeight))
    if (!f.amount || f.amount === '0') {
      const type = f.type.toLowerCase()
      const amount = type === 'bag' ? n(f.rate) * bags : type === 'kg' ? n(f.rate) * n(f.totalWeight) : NaN
      if (Number.isFinite(amount)) f.amount = fmt(amount)
    }
    if (!f.buName) f.buName = first(f.bu)
    f.date = f.date.slice(0, 10)
    return { id: it.id, name: it.name, f, uploaded: !!f.document.trim() }
  })
  return { list, docCol: cols.document }
}

/* ---- the PDF ---- */

const NOTES = [
  '* All payments above Rs. 1000 needs to be done by cheque, rtgs, neft or DD only. In the Name of Kaarthika Transport',
  '* All Cash payments to be done with official cash receipt from Kaarthika',
]

function ddmmyyyy(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export function buildFreightPdf(inv: Invoice): jsPDF {
  const f = inv.f
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 12
  const R = 198
  const W = R - L
  const mid = L + W / 2
  let y = 12

  doc.setLineWidth(0.3)
  doc.setFont('helvetica', 'normal')

  // header: the business unit (left-centre) and invoice details (right)
  const headH = 30
  doc.rect(L, y, W, headH)
  doc.setFont('helvetica', 'bold').setFontSize(15)
  doc.text(f.buName || 'Kaarthika Transport', L + 70, y + 9, { align: 'center' })
  doc.setFont('helvetica', 'normal').setFontSize(8)
  const addr = doc.splitTextToSize(f.buAddress, 100) as string[]
  doc.text(addr.slice(0, 2), L + 70, y + 15, { align: 'center' })
  if (f.buPhone) doc.text(`Phone : ${f.buPhone}`, L + 70, y + 15 + Math.min(addr.length, 2) * 4, { align: 'center' })
  doc.setFontSize(9)
  const rows: [string, string][] = [
    ['KT INV. NO.', f.kt || '-'],
    ['DATE', f.date ? ddmmyyyy(f.date) : '-'],
    ['VEHICLE NO', f.vehicle || '-'],
  ]
  rows.forEach(([k, v], i) => {
    doc.setFont('helvetica', 'bold').text(k, R - 62, y + 8 + i * 7)
    doc.setFont('helvetica', 'normal').text(`:  ${v}`, R - 36, y + 8 + i * 7)
  })
  y += headH

  // title
  doc.rect(L, y, W, 9)
  doc.setFont('helvetica', 'bold').setFontSize(12).text('FREIGHT INVOICE', L + W / 2, y + 6.3, { align: 'center' })
  y += 9

  // consignor / consignee
  const boxH = 26
  doc.rect(L, y, W / 2, boxH)
  doc.rect(mid, y, W / 2, boxH)
  doc.setFontSize(9).text('Consignor / From', L + 3, y + 6)
  doc.text('Consignee / To', mid + 3, y + 6)
  doc.setFont('helvetica', 'normal').setFontSize(9.5)
  doc.text(doc.splitTextToSize(f.from || '-', W / 2 - 6), L + 3, y + 13)
  doc.text(doc.splitTextToSize(f.to || '-', W / 2 - 6), mid + 3, y + 13)
  y += boxH

  // new: Bill To, the buyer (name only)
  const line = (label: string, value: string, x: number, w: number, top: number) => {
    doc.rect(x, top, w, 9)
    doc.setFont('helvetica', 'bold').setFontSize(9).text(label, x + 3, top + 6)
    doc.setFont('helvetica', 'normal').text(doc.splitTextToSize(value || '', w - 38)[0] ?? '', x + 35, top + 6)
  }
  line('Bill To', first(f.billTo) || f.to, L, W, y)
  y += 9
  line('Mill bill no.', f.millBill, L, W / 2, y)
  line('Delivered to', first(f.delivery), mid, W / 2, y)
  y += 9
  line('Lr. No / Date', f.lr ? ddmmyyyy(f.lr) : '', L, W / 2, y)
  line('Remarks', f.remarks.replace(/\s+/g, ' '), mid, W / 2, y)
  y += 9

  // figures
  const heads = ['Counts', 'No. of Bags', 'Bag Weight', 'T. Weight', 'Rate / Bag / Kg', 'Total Amount (Rs)']
  const vals = [f.counts, f.bags, f.bagWeight, f.totalWeight, f.rate, f.amount]
  const widths = [24, 26, 26, 28, 30, W - 134]
  let x = L
  heads.forEach((h, i) => {
    const w = widths[i]!
    doc.rect(x, y, w, 14)
    doc.rect(x, y + 14, w, 16)
    doc.setFont('helvetica', 'bold').setFontSize(9).text(h, x + w / 2, y + 8.5, { align: 'center' })
    doc.setFont('helvetica', 'normal').setFontSize(10.5).text(first(vals[i] ?? '') || '-', x + w / 2, y + 24, { align: 'center' })
    x += w
  })
  y += 30

  // bank details / total freight
  const footH = 40
  doc.rect(L, y, W / 2, footH)
  doc.rect(mid, y, W / 2, footH)
  doc.setFont('helvetica', 'bold').setFontSize(9).text('BANK DETAILS', L + 3, y + 7)
  doc.setFont('helvetica', 'normal').setFontSize(8.5)
  doc.text((doc.splitTextToSize(f.buAccount || '-', W / 2 - 6) as string[]).slice(0, 6), L + 3, y + 14)
  doc.line(mid, y + 11, R, y + 11)
  doc.setFont('helvetica', 'bold').setFontSize(10).text('TOTAL FREIGHT', mid + 3, y + 7.5)
  doc.text(f.amount || '-', R - 3, y + 7.5, { align: 'right' })
  doc.setFontSize(9).text(`FOR ${(f.buName || 'Kaarthika Transport').toUpperCase()}`, mid + 3, y + footH - 4)
  y += footH

  // notes
  doc.rect(L, y, W, 13)
  doc.setFont('helvetica', 'normal').setFontSize(7.5)
  NOTES.forEach((t, i) => doc.text(t, L + 3, y + 5 + i * 5))

  return doc
}

const pdfName = (inv: Invoice) => `Freight Invoice - ${(inv.f.kt || inv.name).replace(/[\\/:*?"<>|]+/g, '-')}.pdf`

/* ---- the tab ---- */

export function FreightInvoiceView({ data, reload }: { data: BoardData; reload: () => void }) {
  const { can } = useAuth()
  const { list, docCol } = useMemo(() => readInvoices(data), [data])
  const [showUploaded, setShowUploaded] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [dialog, setDialog] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const uploadedCount = list.filter((i) => i.uploaded).length
  const rows = showUploaded ? list.filter((i) => i.uploaded) : list.filter((i) => !i.uploaded)
  const inv = list.find((i) => i.id === picked)

  function preview() {
    if (!inv) return
    const url = buildFreightPdf(inv).output('bloburl')
    window.open(String(url), '_blank', 'noopener')
  }

  async function upload() {
    if (!inv || !docCol) return
    setBusy(true)
    setError(null)
    try {
      const pdf = buildFreightPdf(inv).output('blob')
      await uploadFile(BOARD_IDS.transport_invoice, inv.id, docCol.id, pdf, pdfName(inv))
      setDone(`Freight invoice for ${inv.name} saved to its Document column.`)
      setDialog(false)
      setPicked(null)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fi-card">
      <div className="fi-head">
        <div>
          <h2>Kaarthika Transport — Freight Invoice</h2>
          <p className="small muted" style={{ margin: '2px 0 0' }}>Transport Invoice — {list.length} records loaded</p>
        </div>
        <div className="push">
          <button className="btn primary sm" type="button" disabled={!inv} onClick={() => { setError(null); setDialog(true) }}>
            Freight Invoice
          </button>
          <button className="btn ghost sm" type="button" onClick={() => { setShowUploaded((v) => !v); setPicked(null) }}>
            {showUploaded ? `Show Pending (${list.length - uploadedCount})` : `Show Uploaded (${uploadedCount})`}
          </button>
          <button className="btn ghost sm" type="button" onClick={reload}>Refresh</button>
        </div>
      </div>

      {done && <div className="notice small">{done}</div>}
      {!docCol && <div className="alert warn"><span>The board has no Document column, so PDFs cannot be saved.</span></div>}

      <div className="table-wrap">
        <table className="fi-table">
          <thead>
            <tr>
              <th aria-label="Select" />
              <th>Item Name</th>
              <th>Date</th>
              <th>From</th>
              <th>To</th>
              <th>Counts</th>
              <th>No. Of Bags</th>
              <th>Bag Weight</th>
              <th>Total Weight</th>
              <th>Rate</th>
              <th>Total Amount</th>
              <th>Vehicle Number</th>
              <th>Invoice</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="empty" colSpan={13}>{showUploaded ? 'No uploaded invoices yet.' : 'No pending invoices.'}</td></tr>
            ) : (
              rows.map((i) => (
                <tr key={i.id} className={i.id === picked ? 'clickable on' : 'clickable'} onClick={() => setPicked(i.id === picked ? null : i.id)}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${i.name}`} checked={i.id === picked} onChange={() => setPicked(i.id === picked ? null : i.id)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td><strong>{i.name}</strong></td>
                  <td>{i.f.date || '-'}</td>
                  <td>{first(i.f.from) || '-'}</td>
                  <td>{first(i.f.to) || '-'}</td>
                  <td>{first(i.f.counts) || '-'}</td>
                  <td>{first(i.f.bags) || '-'}</td>
                  <td>{i.f.bagWeight || '-'}</td>
                  <td>{i.f.totalWeight || '-'}</td>
                  <td>{i.f.rate || '-'}</td>
                  <td>{i.f.amount || '-'}</td>
                  <td>{i.f.vehicle || '-'}</td>
                  <td><span className={i.uploaded ? 'fi-badge uploaded' : 'fi-badge pending'}>{i.uploaded ? 'Uploaded' : 'Pending'}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {dialog && inv && (
        <>
          <button className="scrim" type="button" aria-label="Close" onClick={() => !busy && setDialog(false)} />
          <div className="fi-modal" role="dialog" aria-label="Freight Invoice Preview">
            <h3>Freight Invoice Preview</h3>
            <p className="fi-sub">Review the PDF before saving it to the invoice.</p>
            {error && <div className="alert" style={{ marginTop: 10 }}><span>{error}</span></div>}
            <button className="fi-preview" type="button" onClick={preview}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" /></svg>
              Open PDF Preview
            </button>
            <div className="fi-actions">
              <button className="fi-cancel" type="button" disabled={busy} onClick={() => setDialog(false)}>Cancel</button>
              {can('order.manage') && (
                <button className="fi-confirm" type="button" disabled={busy || !docCol} onClick={() => void upload()}>
                  <span className="fi-tick" aria-hidden="true">✓</span>
                  {busy ? 'Saving…' : 'Confirm & Save'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
