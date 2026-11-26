/** The Sale Confirmation Letters (monday "PDF Generation and Merge" app): the Buyer and the Supplier letter.
 *  Layout as in monday's PDFs: the business unit's name on the left and its contact block on the right, a rule, the
 *  title, one line of text, the party block, a ruled table of the counts, the closing lines and a footer note.
 *  jsPDF is loaded only when a letter is made. */
import type { jsPDF } from 'jspdf'

export interface LetterUnit {
  name: string
  address: string | null
  gstin: string | null
  pan: string | null
  phone: string | null
  email: string | null
}

export interface LetterCol {
  h: string
  /** width in mm; the columns add up to the printable width (180 mm) */
  w: number
  a?: 'left' | 'center' | 'right'
}

export interface LetterSpec {
  unit: LetterUnit
  /** e.g. BUYER SALE CONFIRMATION LETTER */
  title: string
  /** BUYER or SUPPLIER */
  partyRole: string
  partyName: string
  /** lines under the party name (its unit, ...) */
  partyLines: string[]
  /** label / value pairs shown in two columns under the party */
  partyLeft: [string, string][]
  partyRight: [string, string][]
  cols: LetterCol[]
  rows: string[][]
  /** label / value lines under the table */
  closing: [string, string][]
  footer?: string
}

const L = 15
const R = 195
const BOTTOM = 285

const today = () => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export async function buildLetterPdf(spec: LetterSpec): Promise<Blob> {
  const { jsPDF: PDF } = await import('jspdf')
  const doc = new PDF({ unit: 'mm', format: 'a4' })
  draw(doc, spec)
  return doc.output('blob')
}

function draw(doc: jsPDF, s: LetterSpec) {
  let y = 18
  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(text || '', width) as string[]
  const need = (h: number) => { if (y + h > BOTTOM) { doc.addPage(); y = 18 } }

  // ---- header: the business unit
  doc.setFont('helvetica', 'bold')
  let size = 20
  doc.setFontSize(size)
  while (size > 12 && doc.getTextWidth(s.unit.name) > 105) { size -= 1; doc.setFontSize(size) }
  const nameLines = wrap(s.unit.name, 105)
  doc.text(nameLines, L, y + 4)
  const leftEnd = y + 4 + nameLines.length * size * 0.42

  const right: { t: string; bold: boolean }[] = []
  for (const t of wrap(s.unit.address ?? '', 70)) if (t) right.push({ t, bold: true })
  right.push({ t: `GSTIN: ${s.unit.gstin || '-'}`, bold: true })
  if (s.unit.pan) right.push({ t: `PAN: ${s.unit.pan}`, bold: true })
  if (s.unit.phone) right.push({ t: `Phone: ${s.unit.phone}`, bold: false })
  if (s.unit.email) right.push({ t: `Email: ${s.unit.email}`, bold: false })
  right.push({ t: `Date : ${today()}`, bold: false })
  doc.setFontSize(9)
  let ry = y
  for (const r of right) { doc.setFont('helvetica', r.bold ? 'bold' : 'normal'); doc.text(r.t, R, ry, { align: 'right' }); ry += 5 }
  y = Math.max(leftEnd, ry) + 3
  doc.setLineWidth(0.6); doc.line(L, y, R, y); doc.setLineWidth(0.2)
  y += 10

  // ---- title and opening line
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(s.title, (L + R) / 2, y, { align: 'center' })
  y += 9
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text('We hereby confirm the sale of yarn for and on behalf to the following parties:', L, y)
  y += 9

  // ---- party block
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text(s.partyRole, L, y); y += 6
  doc.setFontSize(9)
  for (const t of wrap(s.partyName, R - L)) { doc.text(t, L, y); y += 5 }
  doc.setFont('helvetica', 'normal')
  for (const line of s.partyLines) for (const t of wrap(line, R - L)) { if (t) { doc.text(t, L, y); y += 5 } }
  y += 2
  const pairRow = (pair: [string, string] | undefined, x: number, top: number, width: number): number => {
    if (!pair) return top
    doc.setFont('helvetica', 'bold'); doc.text(`${pair[0]} :`, x, top)
    doc.setFont('helvetica', 'normal')
    const lines = wrap(pair[1] || '-', width - 20)
    doc.text(lines, x + 20, top)
    return top + Math.max(1, lines.length) * 4.5 + 1.5
  }
  const n = Math.max(s.partyLeft.length, s.partyRight.length)
  for (let i = 0; i < n; i++) {
    const a = pairRow(s.partyLeft[i], L, y, 95)
    const b = pairRow(s.partyRight[i], L + 98, y, R - L - 98)
    y = Math.max(a, b)
  }
  y += 3
  doc.setLineWidth(0.4); doc.line(L, y, R, y); doc.setLineWidth(0.2)
  y += 8

  // ---- the table
  const xs: number[] = []
  s.cols.reduce((acc, c) => { xs.push(acc); return acc + c.w }, L)
  const tableW = s.cols.reduce((a, c) => a + c.w, 0)
  const tx = (i: number) => {
    const c = s.cols[i]!; const a = c.a ?? 'left'
    return a === 'center' ? xs[i]! + c.w / 2 : a === 'right' ? xs[i]! + c.w - 1.2 : xs[i]! + 1.2
  }
  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    const hs = s.cols.map((c) => wrap(c.h, c.w - 2))
    const h = Math.max(...hs.map((t) => t.length)) * 3 + 4
    need(h + 10)
    doc.rect(L, y, tableW, h)
    s.cols.forEach((c, i) => {
      if (i > 0) doc.line(xs[i]!, y, xs[i]!, y + h)
      const t = hs[i]!
      doc.text(t, xs[i]! + c.w / 2, y + (h - t.length * 3) / 2 + 2.4, { align: 'center' })
    })
    y += h
  }
  header()
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  for (const row of s.rows) {
    const cells = s.cols.map((c, i) => wrap(row[i] ?? '', c.w - 2.4))
    const h = Math.max(...cells.map((t) => t.length)) * 3.3 + 4
    if (y + h > BOTTOM) { doc.addPage(); y = 18; header(); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5) }
    doc.rect(L, y, tableW, h)
    s.cols.forEach((c, i) => {
      if (i > 0) doc.line(xs[i]!, y, xs[i]!, y + h)
      doc.text(cells[i]!, tx(i), y + 4, { align: c.a ?? 'left' })
    })
    y += h
  }
  y += 9

  // ---- closing lines and footer
  doc.setFontSize(9)
  for (const [k, v] of s.closing) {
    need(7)
    doc.setFont('helvetica', 'bold'); doc.text(`${k} :`, L, y)
    doc.setFont('helvetica', 'normal')
    const lines = wrap(v || '-', R - L - 40)
    doc.text(lines, L + 38, y)
    y += Math.max(1, lines.length) * 4.5 + 2
  }
  if (s.footer) {
    need(14)
    y += 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.text(s.footer, (L + R) / 2, y, { align: 'center' })
  }
}
