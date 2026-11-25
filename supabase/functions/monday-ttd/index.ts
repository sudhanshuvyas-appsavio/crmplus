// monday-ttd
//
// Reads and writes monday.com boards for the app's monday screens
// (Transporter Type Details, Transport Invoice, Commission Invoices). The
// monday API token cannot live in the browser bundle, so the screens call this
// function and the token stays in its secrets (MONDAY_API_TOKEN).
//
// Actions (POST JSON { action, ... }):
//   load    -> { board }: the board's columns (monday order), its items, and
//              the items of the boards behind its form's relation columns
//              (the dropdown options)
//   create  -> { board, name, column_values }: one item on TTD or Transport Invoice
//   upload  -> { item_id, column_id, filename, mime, content }: attach a file
//   ensure_task -> { invoice_id, name }: the invoice's freight-invoice task
//   monday_user -> the caller's monday user (by login email), or { id: null }
//   snapshot    -> (administrators) copy Transporter Type Details, Transport
//                  Invoice and the boards they link to into the app's tables;
//                  after that the screens no longer need monday at all
//
// The caller is identified from their own JWT and must hold order.read or
// order.manage (create needs order.manage); administrators hold everything.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const MONDAY_TOKEN = Deno.env.get('MONDAY_API_TOKEN') ?? ''

const BOARD_ID = '5026904637'
// Boards the app may read (load action, `board` key).
const BOARDS: Record<string, string> = {
  ttd: BOARD_ID,
  commission_invoices: '5026907737',
  transport_invoice: '5027015093',
}
const MONDAY_API = 'https://api.monday.com/v2'
const MONDAY_VERSION = '2025-04'
const TI_BOARD_ID = '5027015093'
// Boards the app may create items on and attach files to.
const WRITABLE_BOARDS: Record<string, string> = { ttd: BOARD_ID, transport_invoice: TI_BOARD_ID }
// Per board: relation columns whose linked boards give the form's dropdown options.
const OPTION_RELATIONS: Record<string, string[]> = {
  [BOARD_ID]: ['transports', 'transport invoice', 'dispatch and billing'],
  [TI_BOARD_ID]: ['transporter type details', 'business units', 'buyer/to', 'sizing/delivery address'],
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function monday<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: MONDAY_TOKEN, 'API-Version': MONDAY_VERSION },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.errors || body.error_message) {
    const msg = body.errors?.[0]?.message ?? body.error_message ?? `monday request failed (${res.status})`
    throw new Error(msg)
  }
  return body.data as T
}

const VALUE_FIELDS = `
  id type text value
  ... on MirrorValue { display_value }
  ... on BoardRelationValue { display_value linked_item_ids }
  ... on FormulaValue { display_value }
`

interface RawValue {
  id: string
  type: string
  text: string | null
  value: string | null
  display_value?: string | null
  linked_item_ids?: string[]
}
interface RawItem {
  id: string
  name: string
  created_at: string
  column_values: RawValue[]
}

/** Every item of a board, following the cursor. */
async function allItems(boardId: string, withTitles: boolean): Promise<RawItem[]> {
  const fields = `id name created_at column_values { ${VALUE_FIELDS} ${withTitles ? 'column { title }' : ''} }`
  const first = await monday<{ boards: { items_page: { cursor: string | null; items: RawItem[] } }[] }>(
    `query ($b: [ID!]) { boards(ids: $b) { items_page(limit: 500) { cursor items { ${fields} } } } }`,
    { b: [boardId] },
  )
  const page = first.boards[0]?.items_page
  const items = [...(page?.items ?? [])]
  let cursor = page?.cursor ?? null
  while (cursor && items.length < 5000) {
    const next = await monday<{ next_items_page: { cursor: string | null; items: RawItem[] } }>(
      `query ($c: String!) { next_items_page(limit: 500, cursor: $c) { cursor items { ${fields} } } }`,
      { c: cursor },
    )
    items.push(...next.next_items_page.items)
    cursor = next.next_items_page.cursor
  }
  return items
}

/** A value as monday shows it: mirrors, relations and formulas carry it in display_value. */
function shown(v: RawValue): string {
  return (v.display_value ?? v.text ?? '').trim()
}

function simplify(item: RawItem) {
  const values: Record<string, { text: string; ids?: string[] }> = {}
  for (const v of item.column_values) {
    values[v.id] = { text: shown(v), ...(v.linked_item_ids?.length ? { ids: v.linked_item_ids } : {}) }
  }
  return { id: item.id, name: item.name, created_at: item.created_at, values }
}

async function load(boardId: string) {
  const data = await monday<{
    boards: { name: string; columns: { id: string; title: string; type: string; settings_str: string }[] }[]
  }>(`query ($b: [ID!]) { boards(ids: $b) { name columns { id title type settings_str } } }`, { b: [boardId] })
  const board = data.boards[0]
  if (!board) throw new Error('The board was not found on monday.')

  const columns = board.columns.map((c) => {
    let settings: Record<string, unknown> = {}
    try {
      settings = JSON.parse(c.settings_str || '{}')
    } catch {
      /* ignore */
    }
    const labels =
      c.type === 'status' && settings.labels && typeof settings.labels === 'object'
        ? Object.values(settings.labels as Record<string, string>).filter((l) => typeof l === 'string' && l.trim() !== '')
        : undefined
    const boardIds = c.type === 'board_relation' && Array.isArray(settings.boardIds) ? (settings.boardIds as (string | number)[]).map(String) : undefined
    return { id: c.id, title: c.title, type: c.type, ...(labels ? { labels } : {}), ...(boardIds ? { boardIds } : {}) }
  })

  const items = (await allItems(boardId, false)).map(simplify)

  // Items of the linked boards, keyed by the relation column id, with each
  // column of the linked item keyed by its title (used to fill the form).
  // Only boards with a form in the app need them.
  const linked: Record<string, { id: string; name: string; values: Record<string, { text: string; ids?: string[] }> }[]> = {}
  const relations = OPTION_RELATIONS[boardId] ?? []
  for (const col of columns) {
    if (col.type !== 'board_relation' || !relations.includes(col.title.trim().toLowerCase())) continue
    const out: { id: string; name: string; values: Record<string, { text: string; ids?: string[] }> }[] = []
    for (const target of col.boardIds ?? []) {
      const raw = await allItems(target, true)
      for (const it of raw) {
        const values: Record<string, { text: string; ids?: string[] }> = {}
        for (const v of it.column_values as (RawValue & { column?: { title: string } })[]) {
          const title = v.column?.title
          if (!title) continue
          // two columns may share a title (a number and a mirror): keep the one with a value
          if (values[title]?.text && !shown(v)) continue
          values[title] = { text: shown(v), ...(v.linked_item_ids?.length ? { ids: v.linked_item_ids } : {}) }
        }
        out.push({ id: it.id, name: it.name, values })
      }
    }
    linked[col.id] = out
  }

  return { board: board.name, columns, items, linked }
}

async function create(boardId: string, name: string, columnValues: Record<string, unknown>) {
  const data = await monday<{ create_item: { id: string } }>(
    `mutation ($b: ID!, $n: String!, $v: JSON) { create_item(board_id: $b, item_name: $n, column_values: $v, create_labels_if_missing: false) { id } }`,
    { b: boardId, n: name, v: JSON.stringify(columnValues) },
  )
  return { id: data.create_item.id }
}

/** Attaches one file to a file column of an item (monday's file endpoint
 *  takes a multipart request). The item must be on a board the app writes to. */
async function upload(itemId: string, columnId: string, filename: string, base64: string, mime: string) {
  const check = await monday<{ items: { board: { id: string } }[] }>(`query ($i: [ID!]) { items(ids: $i) { board { id } } }`, { i: [itemId] })
  if (!Object.values(WRITABLE_BOARDS).includes(check.items[0]?.board.id ?? '')) throw new Error('That item is not on a board this app writes to.')
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const form = new FormData()
  form.append('query', `mutation ($file: File!) { add_file_to_column (item_id: ${itemId}, column_id: ${JSON.stringify(columnId)}, file: $file) { id } }`)
  form.append('map', JSON.stringify({ file: 'variables.file' }))
  form.append('file', new Blob([bytes], { type: mime || 'application/octet-stream' }), filename)
  const res = await fetch(`${MONDAY_API}/file`, { method: 'POST', headers: { Authorization: MONDAY_TOKEN, 'API-Version': MONDAY_VERSION }, body: form })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.errors || body.error_message) {
    throw new Error(body.errors?.[0]?.message ?? body.error_message ?? `File upload failed (${res.status})`)
  }
  return { ok: true }
}

/** Copies Transporter Type Details and Transport Invoice, and the boards
 *  their link columns point to (what their forms' dropdowns and lookups
 *  need), into public.board_snapshots / public.board_items (migration
 *  20261124120000), as the caller (RLS: order.manage). Rows made in the app
 *  ("app-<n>") are kept; monday rows are replaced. */
async function snapshot(db: ReturnType<typeof createClient>) {
  type Col = { id: string; title: string; type: string; settings_str: string }
  const read = async (boardId: string) => {
    const d = await monday<{ boards: { name: string; columns: Col[] }[] }>(
      `query ($b: [ID!]) { boards(ids: $b) { name columns { id title type settings_str } } }`,
      { b: [boardId] },
    )
    const b = d.boards[0]
    if (!b) return null
    const columns = b.columns.map((c) => {
      let settings: Record<string, unknown> = {}
      try {
        settings = JSON.parse(c.settings_str || '{}')
      } catch {
        /* ignore */
      }
      const labels =
        c.type === 'status' && settings.labels && typeof settings.labels === 'object'
          ? Object.values(settings.labels as Record<string, string>).filter((l) => typeof l === 'string' && l.trim() !== '')
          : undefined
      const boardIds = c.type === 'board_relation' && Array.isArray(settings.boardIds) ? (settings.boardIds as (string | number)[]).map(String) : undefined
      return { id: c.id, title: c.title, type: c.type, settings, ...(labels ? { labels } : {}), ...(boardIds ? { boardIds } : {}) }
    })
    const items = (await allItems(boardId, false)).map(simplify)
    return { name: b.name, columns, items }
  }

  // only these two screens moved off monday; Commission Invoices is not copied
  const keyOf: Record<string, string> = { [BOARD_ID]: 'ttd', [TI_BOARD_ID]: 'transport_invoice' }
  const queue = Object.keys(keyOf)
  const done = new Set<string>()
  const report: { board: string; items: number }[] = []
  while (queue.length) {
    const id = queue.shift()!
    if (done.has(id)) continue
    done.add(id)
    const b = await read(id)
    if (!b) continue
    // the screen boards bring in the boards they link to (one level)
    if (keyOf[id]) for (const c of b.columns) for (const t of c.boardIds ?? []) if (!done.has(t)) queue.push(t)

    const up = await db.from('board_snapshots').upsert(
      { board_id: id, board_key: keyOf[id] ?? null, name: b.name, columns: b.columns, synced_at: new Date().toISOString() },
      { onConflict: 'board_id' },
    )
    if (up.error) throw new Error(`Saving board ${b.name}: ${up.error.message}`)
    const del = await db.from('board_items').delete().eq('board_id', id).not('item_id', 'like', 'app-%')
    if (del.error) throw new Error(`Clearing board ${b.name}: ${del.error.message}`)
    for (let i = 0; i < b.items.length; i += 500) {
      const rows = b.items.slice(i, i + 500).map((it) => ({ board_id: id, item_id: it.id, name: it.name, created_at: it.created_at, values: it.values, created_by: null }))
      const ins = await db.from('board_items').insert(rows)
      if (ins.error) throw new Error(`Saving rows of ${b.name}: ${ins.error.message}`)
    }
    report.push({ board: b.name, items: b.items.length })
  }
  return { boards: report }
}

const TASK_BOARD_ID = '5027269319' // Kaarthika Transport Freight Invoice (Tasks)
const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Makes sure a transport invoice has its "Kaarthika Transport Freight
 *  Invoice" task, as monday's automation does: wait up to ~10 s for the
 *  automation's link to appear; if none does, create "<name> - Transport Task"
 *  on the task board, linked to the invoice (a two-way link, so the invoice's
 *  "link to Kaarthika Transport Freight Invoice" fills too). */
async function ensureTask(invoiceId: string, name: string) {
  type Rel = { id: string; linked_item_ids?: string[]; column?: { title: string } }
  for (let i = 0; i < 5; i++) {
    const d = await monday<{ items: { board: { id: string }; column_values: Rel[] }[] }>(
      `query ($i: [ID!]) { items(ids: $i) { board { id } column_values(types: [board_relation]) { id column { title } ... on BoardRelationValue { linked_item_ids } } } }`,
      { i: [invoiceId] },
    )
    const item = d.items[0]
    if (!item || item.board.id !== TI_BOARD_ID) throw new Error('That item is not a transport invoice.')
    const link = item.column_values.find((v) => normTitle(v.column?.title ?? '').startsWith('linktokaarthika'))
    if (link?.linked_item_ids?.length) return { created: false, task_ids: link.linked_item_ids }
    await new Promise((r) => setTimeout(r, 2000))
  }
  const cols = await monday<{ boards: { columns: { id: string; title: string; type: string }[] }[] }>(
    `query ($b: [ID!]) { boards(ids: $b) { columns { id title type } } }`,
    { b: [TASK_BOARD_ID] },
  )
  const rel = cols.boards[0]?.columns.find((c) => c.type === 'board_relation' && normTitle(c.title) === 'transportinvoice')
  if (!rel) throw new Error('The task board has no "Transport Invoice" link column.')
  const made = await create(TASK_BOARD_ID, `${name} - Transport Task`, { [rel.id]: { item_ids: [Number(invoiceId)] } })
  return { created: true, task_ids: [made.id] }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401)
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await asUser.auth.getUser(authHeader.replace('Bearer ', ''))
  if (userErr || !userData.user) return json({ error: 'Not signed in' }, 401)

  const has = async (perm: string) => {
    const { data } = await asUser.rpc('has_permission', { perm })
    return data === true
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (!MONDAY_TOKEN) return json({ error: 'monday.com is not connected: the MONDAY_API_TOKEN secret is not set on the monday-ttd function.' }, 503)

  try {
    if (body.action === 'load') {
      if (!(await has('order.read')) && !(await has('order.manage'))) return json({ error: 'You need an order permission to see this board' }, 403)
      const boardId = BOARDS[String(body.board ?? 'ttd')]
      if (!boardId) return json({ error: 'Unknown board' }, 400)
      return json(await load(boardId))
    }
    if (body.action === 'create') {
      if (!(await has('order.manage'))) return json({ error: 'You need the "Create and manage orders" permission' }, 403)
      const boardId = WRITABLE_BOARDS[String(body.board ?? 'ttd')]
      if (!boardId) return json({ error: 'Items cannot be created on that board' }, 400)
      const name = String(body.name ?? '').trim()
      if (!name) return json({ error: 'Name is required' }, 400)
      const values = body.column_values && typeof body.column_values === 'object' ? (body.column_values as Record<string, unknown>) : {}
      return json(await create(boardId, name, values))
    }
    if (body.action === 'snapshot') {
      const { data: admin } = await asUser.rpc('is_admin')
      if (admin !== true) return json({ error: 'Only an administrator can copy the boards from monday' }, 403)
      return json(await snapshot(asUser))
    }
    if (body.action === 'monday_user') {
      // the caller's own monday account, matched on their login email, for the
      // "assign item creator as Person" rule; null when they have none
      const email = (userData.user.email ?? '').trim().toLowerCase()
      if (!email) return json({ id: null })
      const d = await monday<{ users: { id: string; name: string }[] }>(`query ($e: [String]) { users(emails: $e) { id name } }`, { e: [email] })
      const u = d.users?.[0]
      return json(u ? { id: u.id, name: u.name } : { id: null })
    }
    if (body.action === 'ensure_task') {
      if (!(await has('order.manage'))) return json({ error: 'You need the "Create and manage orders" permission' }, 403)
      const invoiceId = String(body.invoice_id ?? '')
      const name = String(body.name ?? '').trim().slice(0, 200)
      if (!/^\d+$/.test(invoiceId) || !name) return json({ error: 'Bad request' }, 400)
      return json(await ensureTask(invoiceId, name))
    }
    if (body.action === 'upload') {
      if (!(await has('order.manage'))) return json({ error: 'You need the "Create and manage orders" permission' }, 403)
      const itemId = String(body.item_id ?? '')
      const columnId = String(body.column_id ?? '')
      const content = String(body.content ?? '')
      if (!/^\d+$/.test(itemId) || !/^[a-z0-9_]+$/i.test(columnId) || !content) return json({ error: 'Bad upload request' }, 400)
      if (content.length > 8_000_000) return json({ error: 'File is too large (5 MB at most)' }, 413)
      return json(await upload(itemId, columnId, String(body.filename ?? 'file').slice(0, 200), content, String(body.mime ?? '')))
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'monday request failed' }, 502)
  }
})
