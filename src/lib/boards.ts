/** The app's own copy of the monday boards (tables board_snapshots /
 *  board_items, migration 20261124120000). The Transporter Type Details and
 *  Transport Invoice screens read and write here (with the boards they link
 *  to: Transport Company, Business Units, Dispatch and Billing, ...);
 *  monday is no longer involved.
 *
 *  A board keeps monday's shape -- columns in monday's order, each row a map
 *  of column id -> { text, ids? } -- so the screens work as before. What
 *  monday used to work out itself is done here:
 *    - mirror (lookup) columns: read through the row's link to the linked
 *      board's row (falling back to the copied text);
 *    - the trip and invoice formulas (Total Weight, Total Amount, ...);
 *    - two-way links: linking A to B also links B back to A. */

import { supabase } from './supabase'
import type { BoardData, BoardKey, Cell, Column, Item, Linked } from '../components/MondayBoard'

export const BOARD_IDS: Record<BoardKey, string> = {
  ttd: '5026904637',
  transport_invoice: '5027015093',
}
export const TASK_BOARD_ID = '5027269319' // Kaarthika Transport Freight Invoice

/** Per screen: the link columns whose linked rows are its form's dropdown options. */
const OPTION_RELATIONS: Record<BoardKey, string[]> = {
  ttd: ['transports', 'transport invoice', 'dispatch and billing'],
  transport_invoice: ['transporter type details', 'business units', 'buyer/to', 'from alt.', 'sizing/delivery address', 'sales confirmation'],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

interface StoredBoard { board_id: string; board_key: string | null; name: string; columns: Column[] }
interface StoredItem { item_id: string; name: string; created_at: string; values: Record<string, Cell> }

async function readItems(boardId: string): Promise<StoredItem[]> {
  const out: StoredItem[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('board_items')
      .select('item_id, name, created_at, values')
      .eq('board_id', boardId)
      .order('created_at', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as StoredItem[]))
    if (!data || data.length < 1000) break
  }
  return out
}

/* ---- loading a screen ---- */

export interface Loaded extends BoardData {
  boardId: string
  /** every loaded row, any board: "<boardId>:<itemId>" -> row */
  rows: Map<string, { boardId: string; item: Item }>
  boards: Map<string, StoredBoard>
}

export async function loadBoard(key: BoardKey): Promise<Loaded> {
  const { data: main, error } = await supabase.from('board_snapshots').select('board_id, board_key, name, columns').eq('board_key', key).maybeSingle()
  if (error) throw new Error(error.message)
  if (!main) throw new Error('This board is not set up in the app.')
  const mainBoard = main as StoredBoard

  // the boards this one links to, and the boards those link to (two levels:
  // Transport Invoice -> trip -> Dispatch and Billing, for From / To)
  const boards = new Map<string, StoredBoard>([[mainBoard.board_id, mainBoard]])
  let frontier = [mainBoard]
  for (let level = 0; level < 2; level++) {
    const ids = [...new Set(frontier.flatMap((b) => b.columns.flatMap((c) => (c.type === 'board_relation' ? c.boardIds ?? [] : []))))].filter((id) => !boards.has(id))
    if (!ids.length) break
    const { data: more } = await supabase.from('board_snapshots').select('board_id, board_key, name, columns').in('board_id', ids)
    frontier = (more ?? []) as StoredBoard[]
    for (const b of frontier) boards.set(b.board_id, b)
  }

  const itemsBy = new Map<string, StoredItem[]>()
  await Promise.all([...boards.keys()].map(async (id) => itemsBy.set(id, await readItems(id))))

  const rows = new Map<string, { boardId: string; item: Item }>()
  for (const [bid, list] of itemsBy) for (const it of list) rows.set(`${bid}:${it.item_id}`, { boardId: bid, item: { id: it.item_id, name: it.name, created_at: it.created_at, values: it.values ?? {} } })

  // the app's own Dispatch and Billing and Sales Confirmation records, shown
  // as rows of those boards (ids "ord-<uuid>" / "sc-<uuid>")
  const appRowsBy = new Map<string, Item[]>()
  await Promise.all(
    Object.entries(APP_SOURCES).map(async ([bid, loader]) => {
      const b = boards.get(bid)
      if (b) appRowsBy.set(bid, await loader(b))
    }),
  )
  for (const [bid, list] of appRowsBy) for (const r of list) rows.set(`${bid}:${r.id}`, { boardId: bid, item: r })
  const appOrders = appRowsBy.get(DNB_BOARD_ID) ?? []
  const appScs = appRowsBy.get(SC_BOARD_ID) ?? []

  // monday's own work: mirrors (twice, so a lookup of a lookup resolves), then formulas
  for (let pass = 0; pass < 2; pass++) {
    for (const { boardId, item } of rows.values()) {
      const b = boards.get(boardId)
      if (b) resolveMirrors(b, item, rows)
    }
  }
  for (const { boardId, item } of rows.values()) {
    const b = boards.get(boardId)
    if (b) resolveFormulas(b, item)
  }

  // the other end of the trips' links, on the app's own records
  const ttd = boards.get(BOARD_IDS.ttd)
  if (ttd) {
    const trips = [...rows.values()].filter((r) => r.boardId === BOARD_IDS.ttd).map((r) => r.item)
    const back = (boardId: string, list: Item[], ttdTitle: string, backTitle: string) => {
      const ttdCol = ttd.columns.find((c) => c.type === 'board_relation' && norm(c.title) === norm(ttdTitle))
      const backCol = boards.get(boardId)?.columns.find((c) => c.type === 'board_relation' && norm(c.title) === norm(backTitle))
      if (!ttdCol || !backCol) return
      for (const rec of list) {
        const hits = trips.filter((t) => (t.values[ttdCol.id]?.ids ?? []).includes(rec.id))
        rec.values[backCol.id] = hits.length ? { text: hits.map((t) => t.name).join(', '), ids: hits.map((t) => t.id) } : { text: '' }
      }
    }
    back(DNB_BOARD_ID, appOrders, 'Dispatch and Billing', 'Transporter Type Details')
    back(SC_BOARD_ID, appScs, 'Sales Confirmation', 'link to Transporter Type Details')
  }

  const items = (itemsBy.get(mainBoard.board_id) ?? []).map((it) => rows.get(`${mainBoard.board_id}:${it.item_id}`)!.item)

  // dropdown options: linked rows, with their values keyed by column title.
  // Dispatch and Billing and Sales Confirmation offer the app's own records.
  const linked: Record<string, Linked[]> = {}
  const wanted = OPTION_RELATIONS[key] ?? []
  const asOption = (tb: StoredBoard, r: Item): Linked => {
    const values: Record<string, Cell> = {}
    for (const c of tb.columns) {
      const v = r.values[c.id]
      if (!v) continue
      if (values[c.title]?.text && !v.text) continue
      values[c.title] = v
    }
    return { id: r.id, name: r.name, values }
  }
  for (const col of mainBoard.columns) {
    if (col.type !== 'board_relation' || !wanted.includes(col.title.trim().toLowerCase())) continue
    linked[col.id] = (col.boardIds ?? []).flatMap((tid) => {
      const tb = boards.get(tid)
      if (!tb) return []
      const app = appRowsBy.get(tid)
      if (app) return app.map((r) => asOption(tb, r))
      return (itemsBy.get(tid) ?? []).map((it) => asOption(tb, rows.get(`${tid}:${it.item_id}`)!.item))
    })
  }

  return { board: mainBoard.name, boardId: mainBoard.board_id, columns: mainBoard.columns, items, linked, rows, boards }
}

/* ---- the app's own Dispatch and Billing / Sales Confirmation records ---- */

export const DNB_BOARD_ID = '5026792171' // Dispatch and Billing
export const SC_BOARD_ID = '5026795662' // Sales Confirmation
export const TC_BOARD_ID = '5026540774' // Transport Company
export const BU_BOARD_ID = '5024662780' // Business Units

const txt = (v: string | number | null | undefined): Cell | undefined => (v === null || v === undefined || v === '' ? undefined : { text: String(v) })

/** A record's values under a board's column titles (column id -> cell). */
function underTitles(board: StoredBoard, byTitle: Record<string, Cell | undefined>): Record<string, Cell> {
  const colByTitle = new Map(board.columns.map((c) => [norm(c.title), c.id]))
  const values: Record<string, Cell> = {}
  for (const [title, cell] of Object.entries(byTitle)) {
    const id = colByTitle.get(norm(title))
    if (id && cell) values[id] = cell
  }
  return values
}

/** The app's Transport Company register as rows of that board ("tr-<uuid>"). */
async function appTransporterRows(tc: StoredBoard): Promise<Item[]> {
  const [t, c] = await Promise.all([
    supabase.from('transporters').select('*').order('name'),
    supabase.from('companies').select('id,name'),
  ])
  const units = new Map(((c.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]))
  type T = Record<string, string | number | boolean | null> & { id: string; name: string; created_at: string; company_id: string | null; is_active: boolean | null }
  return ((t.data ?? []) as T[])
    .filter((x) => x.is_active !== false)
    .map((x) => ({
      id: `tr-${x.id}`,
      name: x.name,
      created_at: x.created_at,
      values: underTitles(tc, {
        'Vehicle Type': txt(x.vehicle_type as string | null),
        Email: txt(x.email as string | null),
        'Office Address': txt(x.office_address as string | null),
        'Mill/Factory/Delivery Address': txt(x.delivery_address as string | null),
        'Office Phone': txt(x.office_phone as string | null),
        'Res Phone': txt(x.res_phone as string | null),
        CGST: txt(x.gst as string | null),
        State: txt(x.state as string | null),
        'State Code': txt(x.state_code as string | null),
        'Bank Account Number 1': txt(x.bank_account as string | null),
        'Bank Account Number 2': txt(x.bank_account_2 as string | null),
        'IT PAN': txt(x.pan as string | null),
        'Contact Person 1': txt(x.contact_person as string | null),
        'Contact Person 1 Phone': txt(x.mobile as string | null),
        'Contact Person 2': txt(x.contact_person_2 as string | null),
        'Contact Person 2 Phone': txt(x.mobile_2 as string | null),
        'Vehicle No 1': txt(x.vehicle_no_1 as string | null),
        'Vehicle No 2': txt(x.vehicle_no_2 as string | null),
        'Vehicle No 3': txt(x.vehicle_no_3 as string | null),
        Remarks: txt(x.remarks as string | null),
        'Business Units': x.company_id && units.get(x.company_id) ? { text: units.get(x.company_id)!, ids: [`co-${x.company_id}`] } : undefined,
      }),
    }))
}

/** The app's Business Units register as rows of that board ("co-<uuid>"). */
async function appUnitRows(bu: StoredBoard): Promise<Item[]> {
  const { data } = await supabase.from('companies').select('*').order('name')
  type C = Record<string, string | number | boolean | null> & { id: string; name: string; created_at: string; is_active: boolean | null }
  return ((data ?? []) as C[])
    .filter((x) => x.is_active !== false)
    .map((x) => ({
      id: `co-${x.id}`,
      name: x.name,
      created_at: x.created_at,
      values: underTitles(bu, {
        'Trade Name': txt(x.trade_name as string | null),
        'Legal Name': txt(x.legal_name as string | null),
        'GST Number': txt(x.tax_id as string | null),
        Email: txt(x.email as string | null),
        State: txt(x.state as string | null),
        Address: txt(x.address as string | null),
        Mobile: txt(x.mobile as string | null),
        'Phone 1': txt(x.phone_1 as string | null),
        'Phone 2': txt(x.phone_2 as string | null),
        'Phone 3': txt(x.phone_3 as string | null),
        'PAN Number': txt(x.pan_number as string | null),
        'Bank Account Details 1': txt(x.bank_account_1 as string | null),
        'Bank Account Details 2': txt(x.bank_account_2 as string | null),
        'Name Copy': txt(x.name),
      }),
    }))
}

interface OrderRow {
  id: string
  order_no: string | null
  created_at: string
  status: string
  sales_confirmation_id: string
  buyer_id: string
  supplier_id: string
  count_id: string
  quantity: number | null
  invoice_no: string | null
  invoice_date: string | null
  transporter_id: string | null
  vehicle_no: string | null
  driver_phone: string | null
  bag_weight: number | null
  final_rate: number | null
  total_weight: number | null
}

/** Each app order as a row of the Dispatch and Billing board, its values
 *  under that board's column titles, so lookups and automations read it
 *  exactly as they read monday's dispatches. */
async function appOrderRows(dnb: StoredBoard): Promise<Item[]> {
  const [o, b, s, k, t, sc, ct] = await Promise.all([
    supabase
      .from('orders')
      .select('id,order_no,created_at,status,sales_confirmation_id,buyer_id,supplier_id,count_id,quantity,invoice_no,invoice_date,transporter_id,vehicle_no,driver_phone,bag_weight,final_rate,total_weight')
      .neq('status', 'cancelled')
      .order('created_at'),
    supabase.from('buyer_master').select('id,name,mobile,email'),
    supabase.from('supplier_master').select('id,name'),
    supabase.from('count_master').select('id,name'),
    supabase.from('transporters').select('id,name'),
    supabase.from('sales_confirmations').select('id,sc_no'),
    supabase.from('party_md_contacts').select('party_id,name,mobile,email,created_at').eq('party_type', 'buyer').order('created_at'),
  ])
  const by = <T extends { id: string }>(r: { data: unknown }) => new Map(((r.data ?? []) as T[]).map((x) => [x.id, x]))
  const buyers = by<{ id: string; name: string; mobile: string | null; email: string | null }>(b)
  const suppliers = by<{ id: string; name: string }>(s)
  const counts = by<{ id: string; name: string }>(k)
  const transporters = by<{ id: string; name: string }>(t)
  const scs = by<{ id: string; sc_no: string | null }>(sc)
  const contacts = new Map<string, { name: string; mobile: string; email: string | null }[]>()
  for (const c of (ct.data ?? []) as { party_id: string; name: string; mobile: string; email: string | null }[]) {
    contacts.set(c.party_id, [...(contacts.get(c.party_id) ?? []), c])
  }
  const colByTitle = new Map(dnb.columns.map((c) => [norm(c.title), c.id]))
  return ((o.data ?? []) as OrderRow[]).map((x) => {
    const buyer = buyers.get(x.buyer_id)
    const supplier = suppliers.get(x.supplier_id)
    const count = counts.get(x.count_id)
    const cp = contacts.get(x.buyer_id) ?? []
    const sc = scs.get(x.sales_confirmation_id)
    const byTitle: Record<string, Cell | undefined> = {
      'Invoice No.': txt(x.invoice_no),
      'Invoice Date': txt(x.invoice_date),
      'Created Date': txt(x.created_at.slice(0, 10)),
      'Sales Confirmation': sc ? { text: sc.sc_no ?? '', ids: [`sc-${sc.id}`] } : undefined,
      Buyer: txt(buyer?.name),
      'Buyer Name': txt(buyer?.name),
      'Buyer Office Phone': txt(buyer?.mobile),
      'Buyer Email': txt(buyer?.email),
      'Buyer Contact Person 1': txt(cp[0]?.name),
      'Buyer Contact Person 1 Phone': txt(cp[0]?.mobile),
      'Buyer Contact Person 1 Email': txt(cp[0]?.email),
      'Buyer Contact Person 2 Phone': txt(cp[1]?.mobile),
      'Buyer Contact Person 2 Email': txt(cp[1]?.email),
      Supplier: txt(supplier?.name),
      'Supplier Name': txt(supplier?.name),
      Counts: txt(count?.name),
      'Counts Summary': txt(count?.name),
      Quantity: txt(x.quantity),
      'Transporter Name': txt(x.transporter_id ? transporters.get(x.transporter_id)?.name : null),
      'Vehicle Number': txt(x.vehicle_no),
      'Driver Contact Phone': txt(x.driver_phone),
      'Bags Weight': txt(x.bag_weight),
      'Final Rate': txt(x.final_rate),
      'Total Weight': txt(x.total_weight),
    }
    const values: Record<string, Cell> = {}
    for (const [title, cell] of Object.entries(byTitle)) {
      const id = colByTitle.get(norm(title))
      if (id && cell) values[id] = cell
    }
    return { id: `ord-${x.id}`, name: x.order_no ?? x.invoice_no ?? 'Dispatch', created_at: x.created_at, values }
  })
}

/** Each app Sales Confirmation as a row of the Sales Confirmation board
 *  ("sc-<uuid>"), with the values its lookups read (transporter, vehicle,
 *  driver for the Transport Invoice). */
async function appScRows(sc: StoredBoard): Promise<Item[]> {
  const [r, b, sp, k, t] = await Promise.all([
    supabase.from('sales_confirmations').select('id,sc_no,created_at,buyer_id,supplier_id,count_id,quantity,bag_weight,rate,transporter_id,vehicle_no,driver_phone,delivery_schedule,remarks').order('created_at'),
    supabase.from('buyer_master').select('id,name'),
    supabase.from('supplier_master').select('id,name'),
    supabase.from('count_master').select('id,name'),
    supabase.from('transporters').select('id,name'),
  ])
  const names = (x: { data: unknown }) => new Map(((x.data ?? []) as { id: string; name: string }[]).map((y) => [y.id, y.name]))
  const buyers = names(b)
  const suppliers = names(sp)
  const counts = names(k)
  const transporters = names(t)
  type S = { id: string; sc_no: string | null; created_at: string; buyer_id: string | null; supplier_id: string | null; count_id: string | null; quantity: number | null; bag_weight: number | null; rate: number | null; transporter_id: string | null; vehicle_no: string | null; driver_phone: string | null; delivery_schedule: string | null; remarks: string | null }
  return ((r.data ?? []) as S[]).map((x) => ({
    id: `sc-${x.id}`,
    name: x.sc_no ?? 'Sales Confirmation',
    created_at: x.created_at,
    values: underTitles(sc, {
      'Created Date': txt(x.created_at.slice(0, 10)),
      'Confirmation No': txt(x.sc_no),
      Supplier: txt(x.supplier_id ? suppliers.get(x.supplier_id) : null),
      Buyer: txt(x.buyer_id ? buyers.get(x.buyer_id) : null),
      Counts: txt(x.count_id ? counts.get(x.count_id) : null),
      Quantity: txt(x.quantity),
      'Bag Weight': txt(x.bag_weight),
      'Final Rate': txt(x.rate),
      'Transporter Name': txt(x.transporter_id ? transporters.get(x.transporter_id) : null),
      'Vehicle Number': txt(x.vehicle_no),
      'Driver Contact Phone': txt(x.driver_phone),
      'Delivery Schedule': txt(x.delivery_schedule),
      Remarks: txt(x.remarks),
    }),
  }))
}

export const BS_BOARD_ID = '5024227503' // Buyers & Suppliers
export const SIZING_BOARD_ID = '5026819478' // Sizing/Delivery Address

/** The app's buyers ("by-<uuid>") and suppliers ("sp-<uuid>") as rows of the
 *  Buyers & Suppliers board. */
async function appPartyRows(bs: StoredBoard): Promise<Item[]> {
  const [b, sp] = await Promise.all([
    supabase.from('buyer_master').select('id,name,contact_person,mobile,email,address,gst,pan,state,created_at,is_active').order('name'),
    supabase.from('supplier_master').select('id,name,contact_person,mobile,email,address,gst,pan,state,office_phone,res_phone,mill_address,contact_1_email,contact_2_name,contact_2_mobile,contact_2_email,short_name,created_at,is_active').order('name'),
  ])
  type P = Record<string, string | boolean | null> & { id: string; name: string; created_at: string; is_active: boolean | null }
  const row = (x: P, prefix: string, type: string): Item => ({
    id: `${prefix}${x.id}`,
    name: x.name,
    created_at: x.created_at,
    values: underTitles(bs, {
      Type: txt(type),
      'Office Address': txt(x.address as string | null),
      State: txt(x.state as string | null),
      'GST No.': txt(x.gst as string | null),
      'IT Pan': txt(x.pan as string | null),
      'Contact Person 1': txt(x.contact_person as string | null),
      'Contact Person 1 Phone': txt(x.mobile as string | null),
      'Contact Person 1 Email': txt((x.contact_1_email as string | null) ?? null),
      'Contact Person 2': txt((x.contact_2_name as string | null) ?? null),
      'Contact Person 2 Phone': txt((x.contact_2_mobile as string | null) ?? null),
      'Contact Person 2 Email': txt((x.contact_2_email as string | null) ?? null),
      'Mill/Factory/Delivery Address': txt((x.mill_address as string | null) ?? null),
      'Office Phone': txt((x.office_phone as string | null) ?? null),
      'Res Phone': txt((x.res_phone as string | null) ?? null),
      Email: txt(x.email as string | null),
      'Short Name': txt((x.short_name as string | null) ?? null),
      'Name Copy': txt(x.name),
    }),
  })
  return [
    ...((b.data ?? []) as P[]).filter((x) => x.is_active !== false).map((x) => row(x, 'by-', 'Buyer')),
    ...((sp.data ?? []) as P[]).filter((x) => x.is_active !== false).map((x) => row(x, 'sp-', 'Supplier')),
  ]
}

/** The app's Sizing / Delivery Address register ("jp-<uuid>"). */
async function appSizingRows(sz: StoredBoard): Promise<Item[]> {
  const { data } = await supabase.from('job_processes').select('*').order('name')
  type J = Record<string, string | boolean | null> & { id: string; name: string; created_at: string; is_active: boolean | null }
  return ((data ?? []) as J[])
    .filter((x) => x.is_active !== false)
    .map((x) => ({
      id: `jp-${x.id}`,
      name: x.name,
      created_at: x.created_at,
      values: underTitles(sz, {
        'Office Address': txt((x.office_address as string | null) ?? (x.delivery_address as string | null)),
        'GST No.': txt(x.gst as string | null),
        State: txt(x.state as string | null),
        'Contact Person 1': txt(x.contact_person as string | null),
        'Contact Person 1 Phone': txt(x.mobile as string | null),
        'Contact Person 1 Email': txt(x.email_1 as string | null),
        'Contact Person 2': txt(x.contact_person_2 as string | null),
        'Contact Person 2 Phone': txt(x.mobile_2 as string | null),
        'Contact Person 2 Email': txt(x.email_2 as string | null),
        'Remarks 1': txt(x.remarks as string | null),
      }),
    }))
}

/** Boards whose rows come from the app's own tables instead of the copy. */
const APP_SOURCES: Record<string, (board: StoredBoard) => Promise<Item[]>> = {
  [DNB_BOARD_ID]: (b) => appOrderRows(b),
  [SC_BOARD_ID]: (b) => appScRows(b),
  [TC_BOARD_ID]: (b) => appTransporterRows(b),
  [BU_BOARD_ID]: (b) => appUnitRows(b),
  [BS_BOARD_ID]: (b) => appPartyRows(b),
  [SIZING_BOARD_ID]: (b) => appSizingRows(b),
}

/** For the app's Dispatch and Billing and Sales Confirmation pages: the trips
 *  (Transporter Type Details rows) linked to each record, by record id. */
export async function tripsLinkedToRecords(): Promise<{ byOrder: Map<string, string[]>; bySc: Map<string, string[]> }> {
  const byOrder = new Map<string, string[]>()
  const bySc = new Map<string, string[]>()
  const ttd = await readBoard(BOARD_IDS.ttd)
  if (!ttd) return { byOrder, bySc }
  const dnbCol = ttd.columns.find((c) => c.type === 'board_relation' && norm(c.title) === 'dispatchandbilling')
  const scCol = ttd.columns.find((c) => c.type === 'board_relation' && norm(c.title) === 'salesconfirmation')
  const add = (map: Map<string, string[]>, id: string, name: string) => map.set(id, [...(map.get(id) ?? []), name])
  for (const it of await readItems(BOARD_IDS.ttd)) {
    for (const id of dnbCol ? it.values?.[dnbCol.id]?.ids ?? [] : []) if (id.startsWith('ord-')) add(byOrder, id.slice(4), it.name)
    for (const id of scCol ? it.values?.[scCol.id]?.ids ?? [] : []) if (id.startsWith('sc-')) add(bySc, id.slice(3), it.name)
  }
  return { byOrder, bySc }
}

function resolveMirrors(board: StoredBoard, row: Item, rows: Loaded['rows']) {
  for (const col of board.columns) {
    if (col.type !== 'mirror') continue
    const s = (col.settings ?? {}) as { relation_column?: Record<string, boolean>; displayed_linked_columns?: Record<string, string[]>; displayed_column?: Record<string, boolean> }
    const relIds = Object.keys(s.relation_column ?? {})
    const shown = s.displayed_linked_columns ?? {}
    const parts: string[] = []
    let reached = false
    for (const rel of relIds) {
      for (const linkedId of row.values[rel]?.ids ?? []) {
        for (const [tb, colIds] of Object.entries(shown)) {
          const target = rows.get(`${tb}:${linkedId}`)
          if (!target) continue
          reached = true
          for (const cid of colIds) {
            const t = cid === 'name' ? target.item.name : target.item.values[cid]?.text
            if (t) parts.push(t)
          }
        }
      }
    }
    // only replace the copied text when the linked row is actually here
    if (reached) row.values[col.id] = { text: parts.join(', ') }
  }
}

const num = (t: string | undefined) => {
  const n = parseFloat((t ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : NaN
}
const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '')

/** The formulas of the trip and invoice boards (as written on monday). A
 *  formula only fills an empty cell: copied rows keep monday's own result. */
function resolveFormulas(board: StoredBoard, row: Item) {
  const byTitle = (t: string) => board.columns.find((c) => norm(c.title) === norm(t))
  const v = (t: string) => {
    const c = byTitle(t)
    return c ? num(row.values[c.id]?.text) : NaN
  }
  const z = (n: number) => (Number.isFinite(n) ? n : 0)
  const put = (t: string, n: number) => {
    const c = byTitle(t)
    if (c && c.type === 'formula' && !row.values[c.id]?.text && Number.isFinite(n)) row.values[c.id] = { text: fmt(n) }
  }
  if (board.board_id === BOARD_IDS.ttd) {
    put('Actual KM', v('Ending KM') - v('Start KM'))
    const diesel = v('Consumed') * v('POD')
    put('Cost Of Diesel', diesel)
    const total = ['Driver Bata', 'Loading Charge', 'UnLoading Charge', 'Tiffen Charge', 'Others', 'LNT', 'PC'].reduce((s, t) => s + z(v(t)), z(diesel))
    if (Number.isFinite(diesel) || total) put('Total Cost', total)
  }
  if (board.board_id === BOARD_IDS.transport_invoice) {
    const bagsCol = board.columns.find((c) => ['noofbags'].includes(norm(c.title)))
    const bags = bagsCol ? num(row.values[bagsCol.id]?.text) : NaN
    const weight = bags * v('Bag Weight')
    put('Total Weight', weight)
    const typeCol = byTitle('Type')
    const type = norm(typeCol ? row.values[typeCol.id]?.text ?? '' : '')
    const amount = type === 'bag' ? v('Rate') * bags : type === 'kg' ? v('Rate') * weight : NaN
    put('Total Amount', amount)
    const amountCol = byTitle('Total Amount')
    const total = amountCol ? num(row.values[amountCol.id]?.text) : NaN
    const paid = board.columns.find((c) => norm(c.title).startsWith('partialpayment'))
    if (Number.isFinite(total)) put('Payment Pending', total - z(paid ? num(row.values[paid.id]?.text) : NaN))
  }
}

/* ---- writing ---- */

/** A form value in monday's create_item format, as the stored { text, ids }. */
function toCell(value: unknown, nameOf: (id: string) => string): Cell | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' || typeof value === 'number') return String(value) === '' ? undefined : { text: String(value) }
  const v = value as Record<string, unknown>
  if (Array.isArray(v.item_ids)) {
    const ids = (v.item_ids as (string | number)[]).map(String)
    return ids.length ? { text: ids.map(nameOf).filter(Boolean).join(', '), ids } : undefined
  }
  if (typeof v.date === 'string') return { text: `${v.date}${typeof v.time === 'string' && v.time ? ` ${v.time.slice(0, 5)}` : ''}` }
  if (typeof v.label === 'string') return { text: v.label }
  if (v.checked === 'true' || v.checked === true) return { text: 'v' }
  if (typeof v.phone === 'string') return { text: v.phone }
  if (typeof v.email === 'string') return { text: v.email }
  if (typeof v.text === 'string') return v.text ? { text: v.text } : undefined
  return undefined
}

/** Two-way links: [board, column title] <-> [board, column title]. Linking a
 *  row through one side also adds it on the other, as monday does. */
const TWO_WAY: [string, string, string, string][] = [
  [BOARD_IDS.transport_invoice, 'link to Transporter Type Details', BOARD_IDS.ttd, 'Transport Invoice'],
  [BOARD_IDS.transport_invoice, 'link to Kaarthika Transport Freight Invoice', TASK_BOARD_ID, 'Transport Invoice'],
]

async function readBoard(boardId: string): Promise<StoredBoard | null> {
  const { data } = await supabase.from('board_snapshots').select('board_id, board_key, name, columns').eq('board_id', boardId).maybeSingle()
  return (data as StoredBoard | null) ?? null
}

async function readRow(boardId: string, itemId: string): Promise<StoredItem | null> {
  const { data } = await supabase.from('board_items').select('item_id, name, created_at, values').eq('board_id', boardId).eq('item_id', itemId).maybeSingle()
  return (data as StoredItem | null) ?? null
}

/** Adds `linkId` to a row's link column (and the name to its text). */
async function addLink(boardId: string, itemId: string, colId: string, linkId: string, linkName: string, extra: Record<string, Cell> = {}) {
  const row = await readRow(boardId, itemId)
  if (!row) return
  const cur = row.values?.[colId] ?? { text: '' }
  const ids = [...new Set([...(cur.ids ?? []), linkId])]
  const names = cur.text ? cur.text.split(', ').filter(Boolean) : []
  if (!names.includes(linkName)) names.push(linkName)
  const values = { ...(row.values ?? {}), [colId]: { text: names.join(', '), ids }, ...extra }
  const { error } = await supabase.from('board_items').update({ values, updated_at: new Date().toISOString() }).eq('board_id', boardId).eq('item_id', itemId)
  if (error) throw new Error(error.message)
}

/** Creates a row. `columnValues` are in monday's create_item format (what
 *  the forms build); links are mirrored onto the other side. */
export async function createItem(boardId: string, name: string, columnValues: Record<string, unknown>, data?: Loaded): Promise<{ id: string }> {
  const board = data?.boards.get(boardId) ?? (await readBoard(boardId))
  if (!board) throw new Error('That board has not been copied into the app.')
  const nameOf = (id: string) => {
    if (data) for (const [k, r] of data.rows) if (k.endsWith(`:${id}`)) return r.item.name
    return id
  }
  const values: Record<string, Cell> = {}
  for (const [colId, v] of Object.entries(columnValues)) {
    const cell = toCell(v, nameOf)
    if (cell) values[colId] = cell
  }
  const { data: idData, error: idErr } = await supabase.rpc('next_board_item_id')
  if (idErr || typeof idData !== 'string') throw new Error(idErr?.message ?? 'Could not number the new row')
  const { error } = await supabase.from('board_items').insert({ board_id: boardId, item_id: idData, name, values })
  if (error) throw new Error(error.message)

  // the other side of two-way links
  for (const [aBoard, aTitle, bBoard, bTitle] of TWO_WAY) {
    for (const [from, fromTitle, to, toTitle] of [
      [aBoard, aTitle, bBoard, bTitle],
      [bBoard, bTitle, aBoard, aTitle],
    ] as const) {
      if (from !== boardId) continue
      const col = board.columns.find((c) => c.type === 'board_relation' && norm(c.title) === norm(fromTitle))
      const ids = col ? values[col.id]?.ids ?? [] : []
      if (!ids.length) continue
      const other = data?.boards.get(to) ?? (await readBoard(to))
      const back = other?.columns.find((c) => c.type === 'board_relation' && norm(c.title) === norm(toTitle))
      if (!back) continue
      // monday's TTD rule: "When Transport Invoice changes, tick the Transport Invoice checkbox"
      const tick = to === BOARD_IDS.ttd ? other?.columns.find((c) => c.type === 'checkbox' && norm(c.title) === 'transportinvoice') : undefined
      for (const id of ids) await addLink(to, id, back.id, idData, name, tick ? { [tick.id]: { text: 'v' } } : {})
    }
  }
  return { id: idData }
}

/** The invoice's "Kaarthika Transport Freight Invoice" task, as monday's
 *  automation made it: "<name> - Transport Task", linked both ways. */
export async function createInvoiceTask(invoiceId: string, name: string): Promise<boolean> {
  const tasks = await readBoard(TASK_BOARD_ID)
  const rel = tasks?.columns.find((c) => c.type === 'board_relation' && norm(c.title) === 'transportinvoice')
  if (!tasks || !rel) return false
  await createItem(TASK_BOARD_ID, `${name} - Transport Task`, { [rel.id]: { item_ids: [invoiceId] } })
  return true
}

/** Stores a file for a row's file column (Supabase Storage, bucket
 *  "board-files") and adds its name to the column. */
export async function uploadFile(boardId: string, itemId: string, colId: string, file: Blob, fileName: string) {
  const safe = fileName.replace(/[\\/:*?"<>|]+/g, '-')
  const path = `${boardId}/${itemId}/${Date.now()}-${safe}`
  const up = await supabase.storage.from('board-files').upload(path, file, { contentType: file.type || 'application/octet-stream' })
  if (up.error) throw new Error(up.error.message)
  const row = await readRow(boardId, itemId)
  if (!row) throw new Error('That row no longer exists.')
  const cur = row.values?.[colId]
  const text = cur?.text ? `${cur.text}, ${safe}` : safe
  // ids hold the storage paths of the files saved in the app (to open them)
  const values = { ...(row.values ?? {}), [colId]: { text, ids: [...(cur?.ids ?? []), path] } }
  const { error } = await supabase.from('board_items').update({ values, updated_at: new Date().toISOString() }).eq('board_id', boardId).eq('item_id', itemId)
  if (error) throw new Error(error.message)
}
