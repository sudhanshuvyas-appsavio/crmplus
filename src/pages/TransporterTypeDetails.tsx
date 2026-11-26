/** Transporter Type Details: the app's own copy of the monday board of the same
 *  name (5026904637), in the CRM+ database (src/lib/boards.ts).
 *
 *  "+ New entry" opens a pop-up laid out like the board's monday "Creation
 *  Form", section by section: Transporter Type Details Information, Vehicle
 *  Charges, Other Charges, Remarks and Documents, each field typed as its
 *  monday column. The two charges sections only have fields when the Type is
 *  "Agreed Third Party"; for the other types they say there are no values.
 *  Below, the table shows every column of the board, in monday's order. */

import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Drawer } from '../components/Drawer'
import { MondayBoardPage, type BoardData, type Column } from '../components/MondayBoard'
import { BOARD_IDS, createItem, uploadFile, type Loaded } from '../lib/boards'

/* ---- the creation form, as on monday ---- */

interface FieldDef { key: string; titles: string[]; prefer?: string[]; label?: string }
interface SectionDef { title: string; fields: FieldDef[]; agreedOnly?: boolean; startOpen?: boolean }

const fd = (key: string, prefer?: string[], titles?: string[]): FieldDef => ({ key, titles: titles ?? [key], prefer })

/* monday's automations on this board, applied in the form:
 *  - "When Serial No changes, change item Name to Column Value": Name is the
 *    Serial No (the next number) and cannot be typed over;
 *  - "When Transport Invoice changes, change item Transport Invoice to Column
 *    Value": the Transport Invoice checkbox follows the Transport Invoice link. */
const LINK_KEY = 'Transport Invoice Link'
const CHECK_KEY = 'Transport Invoice'
const DB_KEY = 'Dispatch and Billing'
const N = ['numbers']

/* "When Dispatch and Billing changes" (and "When an item is created"): the
 * trip's contact columns take the buyer's details of the picked dispatch.
 * `from` are the titles those details may carry on the Dispatch and Billing
 * record (its buyer mirror columns). */
const CONTACTS: { key: string; prefer: string[]; from: string[] }[] = [
  { key: 'Office Phone', prefer: ['phone'], from: ['Buyer Office Phone', 'Office Phone'] },
  { key: 'Contact Person 1 Phone', prefer: ['phone'], from: ['Buyer Contact Person 1 Phone', 'Buyer CP1 Phone', 'Contact Person 1 Phone', 'CP1 Phone'] },
  { key: 'Contact Person 2 Phone', prefer: ['phone'], from: ['Buyer Contact Person 2 Phone', 'Buyer CP2 Phone', 'Contact Person 2 Phone', 'CP2 Phone'] },
  { key: 'Contact Person 1 Email', prefer: ['email'], from: ['Buyer Contact Person 1 Email', 'Buyer CP1 Email', 'Contact Person 1 Email', 'CP1 Email'] },
  { key: 'Contact Person 2 Email', prefer: ['email'], from: ['Buyer Contact Person 2 Email', 'Buyer CP2 Email', 'Contact Person 2 Email', 'CP2 Email'] },
  { key: 'Email', prefer: ['email'], from: ['Buyer Email', 'Email'] },
]

const SECTIONS: SectionDef[] = [
  {
    title: 'Transporter Type Details Information',
    startOpen: true,
    fields: [
      // the item name, shown as Serial No.: the next number, allocated automatically
      { ...fd('Name', ['name']), label: 'Serial No.' },
      fd('Transport Invoice', ['checkbox']),
      // the link column of the same name; picking one ticks the checkbox above
      { ...fd(LINK_KEY, ['board_relation'], ['Transport Invoice']), label: 'Transport Invoice' },
      fd('Created Date', ['date']),
      fd('Type', ['status']),
      fd('Transports', ['board_relation']),
      fd('No Of Bags', N, ['No Of Bags', 'No. Of Bags']),
      fd('KT Invoice No', ['numbers', 'text'], ['KT Invoice No', 'KT Invoice No.']),
      fd('KA Invoice Amount', N),
      fd('Counts', N),
      fd(DB_KEY, ['board_relation']),
      ...CONTACTS.map((c) => fd(c.key, c.prefer)),
    ],
  },
  {
    title: 'Vehicle Charges',
    agreedOnly: true,
    fields: [fd('Start KM', N), fd('Ending KM', N), fd('Consumed', N), fd('POD', N), fd('Difference', N)],
  },
  {
    title: 'Other Charges',
    agreedOnly: true,
    fields: [
      fd('Driver Bata', N),
      fd('Loading Charge', N),
      fd('UnLoading Charge', N, ['UnLoading Charge', 'Unloading Charge']),
      fd('Tiffen Charge', N, ['Tiffen Charge', 'Tiffin Charge']),
      fd('Others', N),
      fd('LNT', N),
      fd('PC', N),
    ],
  },
  { title: 'Remarks', fields: [fd('Remarks', ['long_text'])] },
  { title: 'Documents', fields: [fd('Documents', ['file'], ['Documents', 'Document'])] },
]

/** The Type that gives the charges sections their fields. */
const AGREED = 'agreedthirdparty'
const MAX_FILES = 10
const MAX_FILE_BYTES = 5 * 1024 * 1024

const SERIAL_TITLES = ['Serial No', 'Serial Number', 'Serial No.']

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function findColumn(columns: Column[], titles: string[], prefer: string[] = []): Column | undefined {
  const wanted = titles.map(norm)
  const hits = columns.filter((c) => wanted.includes(norm(c.title)))
  if (hits.length <= 1) return hits[0]
  for (const type of prefer) {
    const hit = hits.find((c) => c.type === type)
    if (hit) return hit
  }
  return hits[0]
}

/** Next serial number: one more than the highest number already used on the
 *  board (in the Serial No column or the item name). */
function nextSerial(data: BoardData, serialCol: Column | undefined): string {
  let max = 0
  for (const it of data.items) {
    for (const t of [serialCol ? it.values[serialCol.id]?.text : '', it.name]) {
      const n = parseInt((t ?? '').replace(/[^\d]/g, ''), 10)
      if (Number.isFinite(n) && n > max && n < 1e9) max = n
    }
  }
  return String(max + 1)
}

/* ---- screen ---- */

export default function TransporterTypeDetails() {
  const { can } = useAuth()
  const [formOpen, setFormOpen] = useState(false)

  return (
    <MondayBoardPage
      board="ttd"
      title="Transporter Type Details"
      subtitle="One row per trip: transport type, vehicle and trip costing."
      arrange={(cols) => {
        // no Item column (it repeats Serial No); Serial No first, then Person, then the rest
        const isSerial = (c: Column) => ['serialno', 'serialnumber'].includes(c.title.toLowerCase().replace(/[^a-z0-9]/g, ''))
        const isPerson = (c: Column) => c.type === 'people' && c.title.toLowerCase().trim() === 'person'
        const rest = cols.filter((c) => c.type !== 'name' && !isSerial(c) && !isPerson(c))
        return [...cols.filter(isSerial), ...cols.filter(isPerson), ...rest]
      }}
      action={(data, reload) => (
        <>
          {can('order.manage') && (
            <button className="btn primary" type="button" onClick={() => setFormOpen(true)} disabled={!data}>
              + New entry
            </button>
          )}
          {formOpen && data && (
            <CreationForm
              data={data}
              onClose={() => setFormOpen(false)}
              onSaved={() => {
                setFormOpen(false)
                reload()
              }}
            />
          )}
        </>
      )}
    />
  )
}

/* ---- the pop-up ---- */

interface Value { text?: string; time?: string; checked?: boolean; id?: string }

function CreationForm({ data, onClose, onSaved }: { data: BoardData; onClose: () => void; onSaved: () => void }) {
  const { columns, linked } = data
  const serialCol = useMemo(() => findColumn(columns, SERIAL_TITLES, ['text']), [columns])
  const sections = useMemo(
    () => SECTIONS.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, col: findColumn(columns, f.titles, f.prefer) })) })),
    [columns],
  )
  // KT Invoice No: one more than the highest on the board, allocated automatically
  const ktCol = useMemo(() => findColumn(columns, ['KT Invoice No', 'KT Invoice No.'], ['numbers', 'text']), [columns])
  const nextKt = useMemo(() => {
    let max = 0
    if (ktCol) for (const it of data.items) {
      const n = parseInt((it.values[ktCol.id]?.text ?? '').replace(/[^\d]/g, ''), 10)
      if (Number.isFinite(n) && n > max) max = n
    }
    return String(max + 1)
  }, [data.items, ktCol])
  const blank = (): Record<string, Value> => ({ Name: { text: nextSerial(data, serialCol) }, 'KT Invoice No': { text: nextKt } })
  const [values, setValues] = useState<Record<string, Value>>(blank)
  const [files, setFiles] = useState<File[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(SECTIONS.map((s) => [s.title, !!s.startOpen])))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string, v: Value) => setValues((p) => ({ ...p, [key]: { ...p[key], ...v } }))
  // The buyer's contacts of the picked dispatch: from the Dispatch and Billing
  // record itself, otherwise from the newest trip already linked to it.
  const dbId = values[DB_KEY]?.id
  const contacts = useMemo(() => {
    const out: Record<string, string> = {}
    if (!dbId) return out
    const dbCol = findColumn(columns, [DB_KEY], ['board_relation'])
    const record = dbCol ? (linked[dbCol.id] ?? []).find((l) => l.id === dbId) : undefined
    const sameTrip = dbCol
      ? [...data.items].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((it) => (it.values[dbCol.id]?.ids ?? []).includes(dbId))
      : undefined
    for (const c of CONTACTS) {
      const wanted = c.from.map(norm)
      const title = record ? Object.keys(record.values).find((t) => wanted.includes(norm(t)) && record.values[t]?.text) : undefined
      let text = title && record ? record.values[title]!.text : ''
      const target = findColumn(columns, [c.key], c.prefer)
      if (!text && sameTrip && target) text = sameTrip.values[target.id]?.text ?? ''
      out[c.key] = text
    }
    return out
  }, [dbId, columns, linked, data.items])

  /** A field's value after the board's automations. */
  const valueOf = (key: string): Value => {
    if (key === CHECK_KEY) return { checked: !!values[LINK_KEY]?.id }
    if (key in contacts || CONTACTS.some((c) => c.key === key)) return { text: contacts[key] ?? '' }
    return values[key] ?? {}
  }
  const automatic: Record<string, string> = {
    [CHECK_KEY]: 'Set from the Transport Invoice link',
    ...Object.fromEntries(CONTACTS.map((c) => [c.key, 'Set from Dispatch and Billing'])),
  }
  const agreed = norm(values.Type?.text ?? '') === AGREED

  function clearForm() {
    setValues(blank())
    setFiles([])
    setError(null)
  }

  function addFiles(list: FileList | null) {
    if (!list) return
    const picked = Array.from(list)
    const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES)
    if (tooBig) setError(`${tooBig.name} is larger than 5 MB.`)
    setFiles((prev) => [...prev, ...picked.filter((f) => f.size <= MAX_FILE_BYTES)].slice(0, MAX_FILES))
  }

  function columnValue(col: Column, v: Value | undefined): unknown {
    if (!v) return undefined
    switch (col.type) {
      case 'text': return v.text?.trim() || undefined
      case 'numbers': return v.text && Number.isFinite(parseFloat(v.text)) ? String(parseFloat(v.text)) : undefined
      case 'date': return v.text ? { date: v.text, ...(v.time ? { time: `${v.time}:00` } : {}) } : undefined
      case 'status': return v.text ? { label: v.text } : undefined
      case 'checkbox': return v.checked ? { checked: 'true' } : undefined
      case 'board_relation': return v.id ? { item_ids: [v.id] } : undefined
      case 'long_text': return v.text?.trim() ? { text: v.text } : undefined
      case 'phone': {
        let phone = (v.text ?? '').replace(/[^\d+]/g, '')
        if (phone && !phone.startsWith('+') && phone.length > 10) phone = `+${phone}`
        return phone ? { phone, countryShortName: 'IN' } : undefined
      }
      case 'email': {
        const email = (v.text ?? '').trim()
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email, text: email } : undefined
      }
      default: return undefined
    }
  }

  async function save() {
    const name = values.Name?.text?.trim() ?? ''
    if (!name) {
      setError('Serial No. is required.')
      return
    }
    const cv: Record<string, unknown> = {}
    for (const s of sections) {
      if (s.agreedOnly && !agreed) continue
      for (const f of s.fields) {
        if (!f.col || f.col.type === 'name' || f.col.type === 'file') continue
        const v = columnValue(f.col, valueOf(f.key))
        if (v !== undefined) cv[f.col.id] = v
      }
    }
    // a trip's Sales Confirmation is its dispatch's: picking a Dispatch and
    // Billing record links the trip to that record's Sales Confirmation too
    const dnbCol = columns.find((c) => c.type === 'board_relation' && norm(c.title) === norm(DB_KEY))
    const scCol = columns.find((c) => c.type === 'board_relation' && norm(c.title) === 'salesconfirmation')
    const dnbPick = dnbCol && values[DB_KEY]?.id ? (linked[dnbCol.id] ?? []).find((l) => l.id === values[DB_KEY]?.id) : undefined
    const scIds = dnbPick?.values['Sales Confirmation']?.ids ?? []
    if (scCol && scIds.length && !cv[scCol.id]) cv[scCol.id] = { item_ids: scIds }
    // monday's rows carry the item number in Serial No as well
    if (serialCol && !cv[serialCol.id]) cv[serialCol.id] = name

    setError(null)
    setBusy('Creating the item…')
    let itemId: string
    try {
      itemId = (await createItem(BOARD_IDS.ttd, name, cv, data as Loaded)).id
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      setBusy(null)
      return
    }
    const fileCol = sections.flatMap((s) => s.fields).find((f) => f.key === 'Documents')?.col
    if (files.length && fileCol?.type === 'file') {
      const failed: string[] = []
      for (const [i, file] of files.entries()) {
        setBusy(`Attaching files (${i + 1}/${files.length})…`)
        try {
          await uploadFile(BOARD_IDS.ttd, itemId, fileCol.id, file, file.name)
        } catch {
          failed.push(file.name)
        }
      }
      if (failed.length) {
        setBusy(null)
        setError(`The item was created, but these files could not be attached: ${failed.join(', ')}. Add them again later, or close this form.`)
        return
      }
    }
    onSaved()
  }

  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className="ttd-modal">
      <Drawer title="New Transporter Type Details" onClose={onClose}>
        {error && <div className="alert"><span>{error}</span></div>}

        {sections.map((s) => {
          const isOpen = !!open[s.title]
          const empty = s.agreedOnly && !agreed
          return (
            <section key={s.title} className="ttd-acc">
              <button type="button" className="ttd-acc-head" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [s.title]: !isOpen }))}>
                {s.title}
                <svg viewBox="0 0 24 24" aria-hidden="true" className={isOpen ? 'ttd-acc-chev up' : 'ttd-acc-chev'}><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {isOpen &&
                (empty ? (
                  <p className="ttd-acc-empty">No values</p>
                ) : (
                  <div className="ttd-grid ttd-acc-body">
                    {s.fields.map((f) => {
                      const id = `ttd-f-${norm(f.key)}`
                      return (
                        <div className="field ttd-field" key={f.key}>
                          <label htmlFor={id}>{f.label ?? f.col?.title ?? f.key}</label>
                          {f.col?.type === 'file' ? (
                            <div className="ttd-files">
                              <input
                                ref={fileInput}
                                id={id}
                                type="file"
                                multiple
                                hidden
                                onChange={(e) => {
                                  addFiles(e.target.files)
                                  e.target.value = ''
                                }}
                              />
                              <button type="button" className="ttd-attach" onClick={() => fileInput.current?.click()} disabled={files.length >= MAX_FILES}>
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5l5.5-5.5a2.5 2.5 0 0 1 3.5 3.5L10 17.5a4 4 0 0 1-5.7-5.7L11 5" /></svg>
                                Attach files <span className="small muted">({files.length}/{MAX_FILES})</span>
                              </button>
                              {files.map((file, i) => (
                                <span className="ttd-file" key={`${file.name}-${i}`}>
                                  {file.name}
                                  <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>×</button>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <FieldInput
                              id={id}
                              fieldKey={f.label ?? f.key}
                              col={f.col}
                              value={valueOf(f.key)}
                              readOnly={!!automatic[f.key] || f.key === 'Name' || f.key === 'KT Invoice No'}
                              options={f.col ? linked[f.col.id] ?? [] : []}
                              onChange={(nv) => set(f.key, nv)}
                            />
                          )}
                          <p className="field-hint">
                            {!f.col ? 'Not on the board, not saved' : f.key === 'KT Invoice No' ? `Allocated automatically · Type: ${f.col.type}` : automatic[f.key] ? `${automatic[f.key]} · Type: ${f.col.type}` : `Type: ${f.col.type}`}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                ))}
            </section>
          )
        })}

        <div className="drawer-actions">
          <button className="btn primary" type="button" onClick={() => void save()} disabled={!!busy}>
            {busy ?? '✓ Create Item'}
          </button>
          <button className="btn ghost" type="button" onClick={clearForm} disabled={!!busy}>Clear Form</button>
        </div>
      </Drawer>
    </div>
  )
}

function FieldInput({
  id,
  fieldKey,
  col,
  value,
  options,
  onChange,
  readOnly = false,
}: {
  id: string
  fieldKey: string
  col: Column | undefined
  value: Value
  options: { id: string; name: string }[]
  onChange: (v: Value) => void
  readOnly?: boolean
}) {
  if (readOnly && col?.type !== 'checkbox') return <input id={id} value={value.text ?? ''} readOnly />
  switch (col?.type) {
    case 'checkbox':
      return (
        <label className="ttd-check">
          <input id={id} type="checkbox" checked={!!value.checked} disabled={readOnly} onChange={(e) => onChange({ checked: e.target.checked })} />
          Yes
        </label>
      )
    case 'date':
      return (
        <div className="ttd-datetime">
          <input id={id} type="date" value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
          <input type="time" aria-label={`${fieldKey} time`} value={value.time ?? ''} onChange={(e) => onChange({ time: e.target.value })} />
        </div>
      )
    case 'status':
      return (
        <select id={id} className={value.text ? 'ttd-status on' : 'ttd-status'} value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })}>
          <option value="">-- Select {fieldKey} --</option>
          {(col.labels ?? []).map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      )
    case 'board_relation':
      return (
        <select id={id} value={value.id ?? ''} onChange={(e) => onChange({ id: e.target.value })} disabled={options.length === 0}>
          <option value="">{options.length === 0 ? 'No values' : `-- Select ${fieldKey} --`}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      )
    case 'long_text':
      return <textarea id={id} rows={4} placeholder={`Enter ${fieldKey}`} value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
    case 'numbers':
      return <input id={id} type="number" step="any" placeholder={`Enter ${fieldKey}`} value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
    default:
      return <input id={id} placeholder={`Enter ${fieldKey}`} value={value.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
  }
}
