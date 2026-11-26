/** The "BROKERAGE BILL" PDF of a commission invoice, in the layout of monday's Commission Board app:
 *  header (business unit, PAN, address, phones, fax, e-mail), title, invoice no. and date, the party block,
 *  the "Being Commission for the goods despatched" line, the lines table with a total row, the net amount in
 *  words, round off, the terms, bank details and the signature row. jsPDF is loaded only when a PDF is made. */
import type { jsPDF } from 'jspdf'
import {
  BILL_TERMS, BILL_TERMS_HEADING, BILL_TITLE, amountInWords, invoiceRateSuffix, money, qtyText, quantityHeading,
} from './commissionInvoice'
import type { CommissionInvoiceRow, CommissionLineRow } from './commissionInvoice'

export interface BillUnit {
  name: string
  pan: string | null
  address: string | null
  phones: string[]
  fax: string | null
  email: string | null
  bank: string | null
}
export interface BillParty { name: string; address: string | null }

const L = 10          // left edge of the page border
const R = 200         // right edge
const TOP = 10
const BOTTOM = 287
const PAD = 3

const ddmmyyyy = (d: string | null): string => {
  if (!d) return ''
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

export async function buildCommissionInvoicePdf(inv: CommissionInvoiceRow, lines: CommissionLineRow[], unit: BillUnit, party: BillParty): Promise<Blob> {
  const { jsPDF: PDF } = await import('jspdf')
  const doc = new PDF({ unit: 'mm', format: 'a4' })
  draw(doc, inv, lines, unit, party)
  return doc.output('blob')
}

function draw(doc: jsPDF, inv: CommissionInvoiceRow, lines: CommissionLineRow[], unit: BillUnit, party: BillParty) {
  let y = TOP + PAD
  const need = (h: number) => { if (y + h > BOTTOM - PAD) { doc.addPage(); y = TOP + PAD } }
  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(text, width) as string[]

  // ---- header: business unit left, contact block right
  doc.setFont('helvetica', 'bold')
  let size = 18
  doc.setFontSize(size)
  while (size > 10 && doc.getTextWidth(unit.name) > 95) { size -= 1; doc.setFontSize(size) }
  const nameLines = wrap(unit.name, 95)
  doc.text(nameLines, L + PAD, y + 6)
  doc.setFontSize(9)
  const leftEnd = y + 6 + nameLines.length * (size * 0.4) + (unit.pan ? 5 : 0)
  if (unit.pan) doc.text(`PAN No: ${unit.pan}`, L + PAD, y + 6 + nameLines.length * (size * 0.4) + 1)

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  const right: string[] = []
  if (unit.address) right.push(...wrap(unit.address, 85))
  if (unit.phones.length) right.push(`Phone No : ${unit.phones.join(', ')}`)
  if (unit.fax) right.push(`Fax No : ${unit.fax}`)
  if (unit.email) right.push(`Email : ${unit.email}`)
  let ry = y + 4
  for (const t of right) { doc.text(t, R - PAD, ry, { align: 'right' }); ry += 4 }
  y = Math.max(leftEnd, ry) + 2
  doc.line(L, y, R, y)
  y += 8

  // ---- title, number and date
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text(BILL_TITLE, (L + R) / 2, y, { align: 'center' })
  y += 8
  doc.setFontSize(10)
  doc.text(`INVOICE NO. ${inv.invoice_no ?? ''}`, L + PAD, y)
  doc.setFont('helvetica', 'normal')
  doc.text(`Date: ${ddmmyyyy(inv.invoice_date)}`, R - PAD, y, { align: 'right' })
  y += 7

  // ---- party block
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('To,', L + PAD, y); y += 5
  doc.text(party.name, L + PAD, y); y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  for (const t of wrap(party.address ?? '', R - L - 2 * PAD)) { if (t) { doc.text(t, L + PAD, y); y += 4.2 } }
  if (inv.party_note) { for (const t of wrap(inv.party_note, R - L - 2 * PAD)) { need(5); doc.text(t, L + PAD, y); y += 4.2 } }
  y += 3

  // ---- the commission line
  const suffix = invoiceRateSuffix(inv, lines)
  const lead = 'Being Commission for the goods despatched from '
  const span = `${ddmmyyyy(inv.period_from)} to ${ddmmyyyy(inv.period_to)}${suffix}`
  doc.setFontSize(9.5)
  doc.setFont('helvetica', 'normal')
  doc.text(lead, L + PAD, y)
  const leadW = doc.getTextWidth(lead)
  doc.setFont('helvetica', 'bold')
  const first = wrap(span, R - L - 2 * PAD - leadW)
  doc.text(first[0] ?? '', L + PAD + leadW, y)
  for (const extra of first.slice(1)) { y += 4.5; doc.text(extra, L + PAD, y) }
  y += 7

  // ---- the table
  const mill = inv.party_type === 'supplier' ? 'Buyer' : 'Mill'
  const cols = [
    { h: 'SNo', w: 12, a: 'center' as const },
    { h: mill, w: 34, a: 'left' as const },
    { h: 'Count', w: 46, a: 'left' as const },
    { h: 'Invoice No.', w: 28, a: 'center' as const },
    { h: 'Invoice Date', w: 24, a: 'center' as const },
    { h: quantityHeading(lines), w: 22, a: 'right' as const },
    { h: 'Amount', w: 24, a: 'right' as const },
  ]
  const tableW = cols.reduce((a, c) => a + c.w, 0)
  const x0 = L + (R - L - tableW) / 2
  const xs: number[] = []
  cols.reduce((acc, c) => { xs.push(acc); return acc + c.w }, x0)
  const X = (i: number) => xs[i] ?? 0
  const W = (i: number) => cols[i]?.w ?? 0
  const A = (i: number): 'left' | 'center' | 'right' => cols[i]?.a ?? 'left'
  const textX = (i: number) => (A(i) === 'center' ? X(i) + W(i) / 2 : A(i) === 'right' ? X(i) + W(i) - 1.5 : X(i) + 1.5)
  const cell = (i: number, t: string[], top: number) => {
    doc.text(t, textX(i), top + 4, { align: A(i) })
  }
  const header = () => {
    need(16)
    doc.setFillColor(225, 225, 225)
    doc.rect(x0, y, tableW, 9, 'FD')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    cols.forEach((c, i) => {
      const t = wrap(c.h, c.w - 3)
      doc.text(t, textX(i), y + (t.length > 1 ? 3.6 : 5.6), { align: c.a })
      if (i > 0) doc.line(X(i), y, X(i), y + 9)
    })
    y += 9
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  }
  header()
  let bags = 0
  let total = 0
  for (const l of lines) {
    const countT = wrap(l.count_label ?? '', W(2) - 3)
    const millT = wrap(l.counterparty ?? '', W(1) - 3)
    const rows = Math.max(countT.length, millT.length, 1)
    const h = rows * 4 + 3
    if (y + h > BOTTOM - PAD - 12) { doc.addPage(); y = TOP + PAD; header() }
    doc.rect(x0, y, tableW, h)
    xs.forEach((x, i) => { if (i > 0) doc.line(x, y, x, y + h) })
    cell(0, [String(l.sr_no)], y)
    cell(1, millT, y)
    cell(2, countT, y)
    cell(3, [l.invoice_no ?? ''], y)
    cell(4, [ddmmyyyy(l.invoice_date)], y)
    cell(5, [qtyText(l.quantity)], y)
    cell(6, [money(l.amount)], y)
    bags += Number(l.quantity); total += Number(l.amount)
    y += h
  }
  // total row
  need(9)
  doc.setFont('helvetica', 'bold')
  doc.rect(x0, y, tableW, 8)
  doc.text('Total:', X(5) - 2, y + 5.4, { align: 'right' })
  doc.line(X(5), y, X(5), y + 8); doc.line(X(6), y, X(6), y + 8)
  doc.text(qtyText(bags), X(5) + W(5) - 1.5, y + 5.4, { align: 'right' })
  doc.text(money(total), X(6) + W(6) - 1.5, y + 5.4, { align: 'right' })
  y += 12

  // ---- net amount, words, round off
  const net = Number(inv.net_amount ?? inv.amount)
  need(48)
  doc.setFontSize(9.5)
  const words = wrap(`Net Amount : ${amountInWords(net)}`, R - L - 2 * PAD - 40)
  doc.text(words, L + PAD, y)
  doc.text(money(net), R - PAD, y, { align: 'right' })
  y += words.length * 4.6 + 2
  doc.setFont('helvetica', 'normal')
  doc.text(`Round Off : ${inv.round_off ? money(inv.round_off) : '0'}`, L + PAD, y)
  y += 8

  // ---- terms (left) and bank details (right)
  const termsW = (R - L) * 0.6 - 2 * PAD
  const termLines: string[] = []
  for (const t of BILL_TERMS) termLines.push(...wrap(t, termsW))
  const bankLines = wrap(unit.bank ?? '', (R - L) * 0.4 - 2 * PAD)
  const blockH = Math.max(6 + termLines.length * 3.6, 6 + bankLines.length * 4) + 2
  need(blockH + 24)
  doc.line(L, y - 3, R, y - 3)
  doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(8)
  doc.text(BILL_TERMS_HEADING, L + PAD, y + 1)
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5)
  doc.text(termLines, L + PAD, y + 5.5)
  const divX = L + (R - L) * 0.6
  doc.line(divX, y - 3, divX, y - 3 + blockH + 3)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('Bank Details', divX + PAD, y + 1)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  doc.text(bankLines, divX + PAD, y + 5.5)
  y += blockH + 3
  doc.line(L, y, R, y)
  y += 16

  // ---- signatures
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text('Prepared by', L + PAD + 8, y)
  doc.text('Checked by', (L + R) / 2, y, { align: 'center' })
  doc.setFont('helvetica', 'bold')
  doc.text(`For ${unit.name}`, R - PAD, y, { align: 'right' })

  // ---- the border, on every page
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setLineWidth(0.5)
    doc.rect(L, TOP, R - L, BOTTOM - TOP)
    doc.setLineWidth(0.2)
  }
}
