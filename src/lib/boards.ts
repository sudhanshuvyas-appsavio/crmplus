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
  transport_invoice: ['transporter type details', 'business units', 'buyer/to', 'sizing/delivery address'],
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
  if (!main) throw new Error('This board has not been copied into the app yet. An administrator can copy it from monday once (see Transporter Type Details).')
  const mainBoard = main as StoredBoard

  // the boards this one links to
  const linkedIds = [...new Set(mainBoard.columns.flatMap((c) => (c.type === 'board_relation' ? c.boardIds ?? [] : [])))]
  const { data: others } = linkedIds.length
    ? await supabase.from('board_snapshots').select('board_id, board_key, name, columns').in('board_id', linkedIds)
    : { data: [] as StoredBoard[] }
  const boards = new Map<string, StoredBoard>([[mainBoard.board_id, mainBoard], ...((others ?? []) as StoredBoard[]).map((b) => [b.board_id, b] as const)])

  const itemsBy = new Map<string, StoredItem[]>()
  await Promise.all([...boards.keys()].map(async (id) => itemsBy.set(id, await readItems(id))))

  const rows = new Map<string, { boardId: string; item: Item }>()
  for (const [bid, list] of itemsBy) for (const it of list) rows.set(`${bid}:${it.item_id}`, { boardId: bid, item: { id: it.item_id, name: it.name, created_at: it.created_at, values: it.values ?? {} } })

  // monday's own work: mirrors first (formulas read them), then formulas
  for (const [bid, b] of boards) {
    for (const it of itemsBy.get(bid) ?? []) {
      const row = rows.get(`${bid}:${it.item_id}`)!.item
      resolveMirrors(b, row, rows)
      resolveFormulas(b, row)
    }
  }

  const items = (itemsBy.get(mainBoard.board_id) ?? []).map((it) => rows.get(`${mainBoard.board_id}:${it.item_id}`)!.item)

  // dropdown options: linked rows, with their values keyed by column title
  const linked: Record<string, Linked[]> = {}
  const wanted = OPTION_RELATIONS[key] ?? []
  for (const col of mainBoard.columns) {
    if (col.type !== 'board_relation' || !wanted.includes(col.title.trim().toLowerCase())) continue
    linked[col.id] = (col.boardIds ?? []).flatMap((tid) => {
      const tb = boards.get(tid)
      if (!tb) return []
      return (itemsBy.get(tid) ?? []).map((it) => {
        const r = rows.get(`${tid}:${it.item_id}`)!.item
        const values: Record<string, Cell> = {}
        for (const c of tb.columns) {
          const v = r.values[c.id]
          if (!v) continue
          if (values[c.title]?.text && !v.text) continue
          values[c.title] = v
        }
        return { id: r.id, name: r.name, values }
      })
    })
  }

  return { board: mainBoard.name, boardId: mainBoard.board_id, columns: mainBoard.columns, items, linked, rows, boards }
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
  const cur = row.values?.[colId]?.text ?? ''
  const values = { ...(row.values ?? {}), [colId]: { text: cur ? `${cur}, ${safe}` : safe } }
  const { error } = await supabase.from('board_items').update({ values, updated_at: new Date().toISOString() }).eq('board_id', boardId).eq('item_id', itemId)
  if (error) throw new Error(error.message)
}
