/** Makes the Buyer and Supplier Sale Confirmation Letters for chosen confirmations and saves each one to the
 *  confirmation's documents (Buyer Document / Supplier Document), as monday's "PDF Generation and Merge" app does.
 *  "Group by supplier" makes one Supplier letter per supplier (and business unit) with a row for every count of every
 *  chosen confirmation, saved to each of those confirmations. */
import { supabase } from './supabase'
import { uploadScFiles } from '../components/sc/ScDocuments'
import { uomLabel } from './deals'
import { buildLetterPdf, type LetterCol, type LetterSpec, type LetterUnit } from './scLetterPdf'

type Row = Record<string, unknown>
type Sc = {
  id: string; sc_no: string; status: string; stage: string; company_id: string | null; buyer_id: string | null; supplier_id: string | null
  buyer_company_id: string | null; supplier_company_id: string | null; payment_term_id: string | null; price_basis: string | null
  delivery_schedule: string | null; remarks: string | null; job_process_id: string | null; delivery_address: string | null
}
type Line = { sc_id: string; line_no: number; count_id: string | null; quantity: number | null; uom: string; bag_weight: number | null; rate: number | null; total_weight: number | null }

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const num = (v: number | null | undefined) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }))
const mod = (b: string | null) => (b === 'net' ? 'Net' : 'Ex-Mill')

export type LetterKind = 'buyer' | 'supplier' | 'group'

/** Makes and saves the letters. Returns one line per confirmation (or group) saying what happened. */
export async function makeLetters(kind: LetterKind, scIds: string[]): Promise<{ done: string[]; problems: string[] }> {
  const done: string[] = []
  const problems: string[] = []
  const sc = await supabase.from('sales_confirmations').select('*').in('id', scIds)
  if (sc.error) return { done, problems: [sc.error.message] }
  const scs = (sc.data ?? []) as Sc[]
  const ids = (k: keyof Sc) => [...new Set(scs.map((x) => x[k]).filter(Boolean) as string[])]
  const [ln, b, s, co, home, cm, pt, jp] = await Promise.all([
    supabase.from('sc_lines').select('sc_id,line_no,count_id,quantity,uom,bag_weight,rate,total_weight').in('sc_id', scIds).order('line_no'),
    supabase.from('buyer_master').select('*').in('id', ids('buyer_id')),
    supabase.from('supplier_master').select('*').in('id', ids('supplier_id')),
    supabase.from('companies').select('*').in('id', [...ids('company_id'), ...ids('buyer_company_id'), ...ids('supplier_company_id')]),
    supabase.from('companies').select('*').eq('is_home', true).eq('is_active', true).limit(1),
    supabase.from('count_master').select('id,display_name'),
    supabase.from('payment_terms').select('id,name'),
    supabase.from('job_processes').select('*').in('id', ids('job_process_id')),
  ])
  const byId = (r: { data: unknown }) => new Map(((r.data ?? []) as Row[]).map((x) => [str(x.id), x]))
  const buyers = byId(b); const suppliers = byId(s); const companies = byId(co); const jobs = byId(jp)
  const counts = new Map(((cm.data ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name]))
  const terms = new Map(((pt.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]))
  const homeCo = ((home.data ?? []) as Row[])[0]
  const lines = new Map<string, Line[]>()
  for (const l of (ln.data ?? []) as Line[]) lines.set(l.sc_id, [...(lines.get(l.sc_id) ?? []), l])

  const unitOf = (x: Sc): LetterUnit => {
    const c = (x.company_id && companies.get(x.company_id)) || homeCo || {}
    return {
      name: str(c.name) || 'Business Unit',
      address: str(c.address) || null,
      gstin: str(c.tax_id) || null,
      pan: str(c.pan_number) || null,
      phone: str(c.phone_1) || str(c.mobile) || null,
      email: str(c.email) || null,
    }
  }
  const unitName = (id: string | null) => (id ? str(companies.get(id)?.name) : '')
  const delivery = (x: Sc): string => {
    if (x.job_process_id) {
      const j = jobs.get(x.job_process_id)
      if (j) return [str(j.name), str(j.delivery_address), j.gst ? `GSTIN: ${str(j.gst)}` : ''].filter(Boolean).join('\n')
    }
    if (x.delivery_address) return x.delivery_address
    const bu = buyers.get(x.buyer_id ?? '')
    return [unitName(x.buyer_company_id) || str(bu?.name), bu?.gst ? `GSTIN: ${str(bu.gst)}` : ''].filter(Boolean).join('\n')
  }
  const scLines = (x: Sc) => lines.get(x.id) ?? []
  const countText = (l: Line) => (l.count_id ? counts.get(l.count_id) ?? '' : '')

  // ---- Buyer letter: one per confirmation, a row per count with the mill
  const buyerSpec = (x: Sc): LetterSpec | string => {
    const bu = buyers.get(x.buyer_id ?? ''); const su = suppliers.get(x.supplier_id ?? '')
    if (!bu) return 'it has no buyer'
    if (!scLines(x).length) return 'it has no counts'
    const cols: LetterCol[] = [
      { h: '#', w: 6, a: 'center' }, { h: 'Mill / Party', w: 32 }, { h: 'Count', w: 32 }, { h: 'Qty', w: 11, a: 'center' },
      { h: 'UOM', w: 11, a: 'center' }, { h: 'Bag Wt', w: 10, a: 'center' }, { h: 'Rate', w: 12, a: 'center' }, { h: 'MOD', w: 12, a: 'center' },
      { h: 'Delivery', w: 30 }, { h: 'Remarks', w: 24 },
    ]
    const mill = su ? [str(su.name), unitName(x.supplier_company_id) || str(su.mill_address) || str(su.address), su.gst ? `GST: ${str(su.gst)}` : ''].filter(Boolean).join('\n') : '-'
    return {
      unit: unitOf(x),
      title: 'BUYER SALE CONFIRMATION LETTER',
      partyRole: 'BUYER',
      partyName: str(bu.name),
      partyLines: [unitName(x.buyer_company_id)].filter(Boolean),
      partyLeft: [['GST No', str(bu.gst) || '-'], ['Contact', str(bu.contact_person) || '-']],
      partyRight: [['Phone', str(bu.mobile) || str(bu.office_phone) || '-'], ['Email', str(bu.email) || '-']],
      cols,
      rows: scLines(x).map((l, i) => [String(i + 1), mill, countText(l), num(l.quantity), uomLabel(l.uom), num(l.bag_weight), num(l.rate), mod(x.price_basis), delivery(x), x.remarks || '-']),
      closing: [['Payment Terms', x.payment_term_id ? terms.get(x.payment_term_id) ?? '-' : '-'], ['Delivery Schedule', x.delivery_schedule || '-']],
    }
  }

  // ---- Supplier letter: a row per count of each confirmation, with its buyer
  const supplierCols: LetterCol[] = [
    { h: '#', w: 6, a: 'center' }, { h: 'Buyer / Party', w: 25 }, { h: 'Count Description', w: 24 }, { h: 'Qty', w: 11, a: 'center' },
    { h: 'UOM', w: 9, a: 'center' }, { h: 'Bag Wt', w: 9, a: 'center' }, { h: 'Total Wt', w: 12, a: 'center' }, { h: 'Rate', w: 10, a: 'center' },
    { h: 'MOD', w: 12, a: 'center' }, { h: 'Delivery', w: 22 }, { h: 'Payment Terms', w: 14, a: 'center' }, { h: 'Del. Schedule', w: 13 },
    { h: 'Remarks', w: 13 },
  ]
  const supplierRows = (list: Sc[]): string[][] => {
    const out: string[][] = []
    for (const x of list) {
      const bu = buyers.get(x.buyer_id ?? '')
      const party = bu ? [str(bu.name), unitName(x.buyer_company_id), bu.gst ? `GST: ${str(bu.gst)}` : '', bu.pan ? `PAN: ${str(bu.pan)}` : ''].filter(Boolean).join('\n') : '-'
      for (const l of scLines(x)) {
        out.push([String(out.length + 1), party, countText(l), num(l.quantity), uomLabel(l.uom), num(l.bag_weight), num(l.total_weight), num(l.rate),
          mod(x.price_basis), delivery(x), x.payment_term_id ? terms.get(x.payment_term_id) ?? '-' : '-', x.delivery_schedule || '-', x.remarks || '-'])
      }
    }
    return out
  }
  const supplierSpec = (list: Sc[]): LetterSpec | string => {
    const x = list[0]!
    const su = suppliers.get(x.supplier_id ?? '')
    if (!su) return 'it has no supplier'
    const rows = supplierRows(list)
    if (!rows.length) return 'it has no counts'
    return {
      unit: unitOf(x),
      title: 'SUPPLIER SALE CONFIRMATION LETTER',
      partyRole: 'SUPPLIER',
      partyName: str(su.name),
      partyLines: [],
      partyLeft: [['GST No', str(su.gst) || '-'], ['PAN No', str(su.pan) || '-']],
      partyRight: [['Phone', str(su.mobile) || str(su.office_phone) || '-']],
      cols: supplierCols,
      rows,
      closing: [],
      footer: "THIS IS SYSTEM GENERATED AND DOESN'T REQUIRE SIGNATURE",
    }
  }

  const save = async (spec: LetterSpec, fileName: string, docKind: 'buyer' | 'supplier', targets: Sc[], label: string) => {
    const blob = await buildLetterPdf(spec)
    const file = new File([blob], fileName, { type: 'application/pdf' })
    for (const t of targets) {
      const errs = await uploadScFiles(t.id, docKind, [file])
      if (errs.length) problems.push(`${t.sc_no}: ${errs.join('; ')}`)
      else done.push(`${label} saved to ${t.sc_no}`)
    }
  }
  const stamp = new Date().toISOString().slice(0, 10)
  // letters are made only for confirmations in Send with Delivery Info
  const live = scs.filter((x) => x.status !== 'cancelled' && x.stage === 'send_delivery')
  for (const x of scs) {
    if (x.status === 'cancelled') problems.push(`${x.sc_no}: it is cancelled`)
    else if (x.stage !== 'send_delivery') problems.push(`${x.sc_no}: it is not in Send with Delivery Info yet`)
  }

  if (kind === 'buyer' || kind === 'supplier') {
    for (const x of live) {
      const spec = kind === 'buyer' ? buyerSpec(x) : supplierSpec([x])
      if (typeof spec === 'string') { problems.push(`${x.sc_no}: ${spec}`); continue }
      await save(spec, `${kind === 'buyer' ? 'Buyer' : 'Supplier'}-Confirmation-${x.sc_no}.pdf`, kind, [x], `${kind === 'buyer' ? 'Buyer' : 'Supplier'} letter`)
    }
  } else {
    // one letter per supplier and business unit
    const groups = new Map<string, Sc[]>()
    for (const x of live) {
      if (!x.supplier_id) { problems.push(`${x.sc_no}: it has no supplier`); continue }
      const k = `${x.supplier_id}|${x.company_id ?? ''}`
      groups.set(k, [...(groups.get(k) ?? []), x])
    }
    for (const list of groups.values()) {
      const spec = supplierSpec(list)
      const names = list.map((x) => x.sc_no).join(', ')
      if (typeof spec === 'string') { problems.push(`${names}: ${spec}`); continue }
      const sup = str(suppliers.get(list[0]!.supplier_id ?? '')?.name).replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)
      await save(spec, `Supplier-Confirmation-${sup}-${stamp}.pdf`, 'supplier', list, `Supplier letter (${list.length} confirmation${list.length === 1 ? '' : 's'})`)
    }
  }
  return { done, problems }
}
