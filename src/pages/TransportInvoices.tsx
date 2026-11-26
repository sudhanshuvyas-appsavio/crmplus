/** Transport Invoice, read live from the monday.com "Transport Invoice" board
 *  (5027015093): every column of the board, in monday's order.
 *
 *  "+ New entry" opens a pop-up laid out like the board's monday Creation
 *  Form: "Transport Invoice Details" (Name, the trip, Date, Business Unit,
 *  Type, Bag Weight, Lr. No./Date, Mill Bill No., Rate and the two calculated
 *  fields) and "Remarks". Total Weight and Total Amount are worked out as on
 *  monday:
 *    Total Weight = No. Of Bags (from the trip) x Bag Weight
 *    Total Amount = Rate x No. Of Bags (Type Bag) or Rate x Total Weight (Type Kg) */

import { useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { Drawer } from '../components/Drawer'
import { MondayBoardPage, type BoardData } from '../components/MondayBoard'
import { BOARD_IDS, createInvoiceTask, createItem, type Loaded } from '../lib/boards'
import { FieldInput, columnValue, findColumn, norm, type Value } from '../components/mondayForm'
import { FreightInvoiceView } from '../components/FreightInvoice'

/* ---- the creation form, as on monday ---- */

interface FieldDef { key: string; titles: string[]; prefer?: string[]; calc?: 'weight' | 'amount'; label?: string }
interface SectionDef { title: string; fields: FieldDef[]; startOpen?: boolean }

const fd = (key: string, prefer?: string[], titles?: string[]): FieldDef => ({ key, titles: titles ?? [key], prefer })
const N = ['numbers']
const TRIP_KEY = 'Transporter Type Details'

const SECTIONS: SectionDef[] = [
  {
    title: 'Transport Invoice Details',
    startOpen: true,
    fields: [
      // the invoice's name is its KT INV. NO., allocated automatically
      { ...fd('Name', ['name']), label: 'KT INV. NO.' },
      fd(TRIP_KEY, ['board_relation']),
      fd('Date', ['date']),
      fd('Business Units', ['board_relation']),
      fd('Type', ['status']),
      fd('Bag Weight', N),
      fd('Lr. No./Date', ['date'], ['Lr. No./Date', 'Lr. No/Date', 'Lr No/Date', 'LR No./Date']),
      { ...fd('Total Weight', ['formula', 'numbers']), calc: 'weight' },
      fd('Mill Bill No.', ['numbers', 'text'], ['Mill Bill No.', 'Mill Bill No']),
      fd('Rate', N),
      { ...fd('Total Amount', ['formula', 'numbers']), calc: 'amount' },
    ],
  },
  { title: 'Remarks', fields: [fd('Remarks', ['long_text'])] },
]

/** No. of bags of a trip, from the Transporter Type Details record. */
const BAGS_TITLES = ['No Of Bags', 'No. Of Bags', 'Number of Bags']

const num = (t: string | undefined) => {
  const n = parseFloat((t ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : NaN
}
const show = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '')

const KT_TITLES = ['KT INV. NO.', 'KT INV NO', 'KT Invoice No']

/** The next KT INV. NO.: one more than the highest number in use (in the
 *  KT INV. NO. column or the invoice names, e.g. "TI - 020"), as "TI - 021". */
function nextKt(data: BoardData): string {
  const kt = findColumn(data.columns, KT_TITLES, ['text', 'numbers'])
  let max = 0
  for (const it of data.items) {
    for (const t of [kt ? it.values[kt.id]?.text : '', it.name]) {
      const m = /(\d+)\s*$/.exec((t ?? '').trim())
      const n = m ? parseInt(m[1]!, 10) : NaN
      if (Number.isFinite(n) && n > max && n < 100000) max = n
    }
  }
  return `TI - ${String(max + 1).padStart(3, '0')}`
}

/* ---- screen ---- */

export default function TransportInvoices() {
  const { can } = useAuth()
  const [formOpen, setFormOpen] = useState(false)

  return (
    <MondayBoardPage
      board="transport_invoice"
      title="Transport Invoice"
      subtitle="Freight invoices raised for trips."
      headers={{ Item: 'KT INV. NO.', Date: 'Created Date' }}
      tabs={[
        { label: 'Freight Invoice', render: (data, reload) => <FreightInvoiceView data={data} reload={reload} /> },
      ]}
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

function CreationForm({ data, onClose, onSaved }: { data: BoardData; onClose: () => void; onSaved: () => void }) {
  return (
    <div className="ttd-modal">
      <Drawer title="New Transport Invoice" onClose={onClose}>
        <FormBody data={data} onSaved={onSaved} />
      </Drawer>
    </div>
  )
}

/* ---- the form itself ---- */

function FormBody({ data, onSaved }: { data: BoardData; onSaved: (name: string, note?: string) => void }) {
  const { columns, linked } = data
  const sections = useMemo(
    () => SECTIONS.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, col: findColumn(columns, f.titles, f.prefer) })) })),
    [columns],
  )
  const kt = useMemo(() => nextKt(data), [data])
  const ktCol = useMemo(() => findColumn(columns, KT_TITLES, ['text', 'numbers']), [columns])
  const [values, setValues] = useState<Record<string, Value>>(() => ({ Name: { text: kt } }))
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(SECTIONS.map((s) => [s.title, !!s.startOpen])))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string, v: Value) => setValues((p) => ({ ...p, [key]: { ...p[key], ...v } }))

  // No. of bags of the chosen trip
  const tripCol = sections[0]?.fields.find((f) => f.key === TRIP_KEY)?.col
  const trip = tripCol && values[TRIP_KEY]?.id ? (linked[tripCol.id] ?? []).find((l) => l.id === values[TRIP_KEY]?.id) : undefined
  const bagsTitle = trip ? Object.keys(trip.values).find((t) => BAGS_TITLES.map(norm).includes(norm(t))) : undefined
  const bags = trip && bagsTitle ? num(trip.values[bagsTitle]?.text) : NaN

  const bagWeight = num(values['Bag Weight']?.text)
  const rate = num(values.Rate?.text)
  const type = norm(values.Type?.text ?? '')
  const totalWeight = bags * bagWeight
  const totalAmount = type === 'bag' ? rate * bags : type === 'kg' ? rate * totalWeight : NaN

  const calcText = (c: 'weight' | 'amount') => show(c === 'weight' ? totalWeight : totalAmount)
  const calcHint = (c: 'weight' | 'amount') => {
    if (!trip) return 'Pick a Transporter Type Details to get its No. Of Bags'
    if (!Number.isFinite(bags)) return 'The chosen trip has no No. Of Bags'
    if (c === 'weight') return `No. Of Bags (${bags}) × Bag Weight`
    if (type === 'bag') return `Rate × No. Of Bags (${bags})`
    if (type === 'kg') return 'Rate × Total Weight'
    return 'Choose a Type (Kg or Bag)'
  }

  async function save() {
    const name = values.Name?.text?.trim() || kt
    if (!name) {
      setError('Name is required.')
      return
    }
    const cv: Record<string, unknown> = {}
    for (const s of sections) {
      for (const f of s.fields) {
        if (!f.col || f.col.type === 'name' || f.col.type === 'formula') continue
        // a calculated field stored as a plain number on monday: send the worked-out value
        const v = f.calc ? columnValue(f.col, { text: calcText(f.calc) }) : columnValue(f.col, values[f.key])
        if (v !== undefined) cv[f.col.id] = v
      }
    }
    // the KT INV. NO. column holds the same number as the name
    if (ktCol && ktCol.type !== 'name') cv[ktCol.id] = ktCol.type === 'numbers' ? name.replace(/\D/g, '') : name
    // the trip's side of the link: "link to Transporter Type Details" is the
    // two-way partner of the trip's "Transport Invoice" column, so the trip
    // gets this invoice too (and its Transport Invoice checkbox ticks on monday)
    const tripId = values[TRIP_KEY]?.id
    const backLink = columns.find((c) => c.type === 'board_relation' && norm(c.title) === 'linktotransportertypedetails')
    if (tripId && backLink) cv[backLink.id] = { item_ids: [tripId] }
    // the invoice's Sales Confirmation is its trip's (which is the trip's
    // dispatch's), so Driver Contact Phone, Vehicle Number and Transporter
    // Name read the app's own Sales Confirmation
    const scCol = columns.find((c) => c.type === 'board_relation' && norm(c.title) === 'salesconfirmation')
    const tripScIds = trip?.values['Sales Confirmation']?.ids ?? []
    if (scCol && tripScIds.length && !cv[scCol.id]) cv[scCol.id] = { item_ids: tripScIds }
    setBusy('Submitting…')
    setError(null)
    try {
      const { id } = await createItem(BOARD_IDS.transport_invoice, name, cv, data as Loaded)
      // monday's automation: the invoice's "Kaarthika Transport Freight Invoice" task
      setBusy('Submitting…')
      let note = ''
      try {
        note = (await createInvoiceTask(id, name)) ? ' Kaarthika Transport Freight Invoice task created.' : ''
      } catch {
        note = ' The Kaarthika Transport Freight Invoice task could not be created.'
      }
      onSaved(name, note)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      setBusy(null)
    }
  }

  return (
    <>
        {error && <div className="alert"><span>{error}</span></div>}

        {sections.map((s) => {
          const isOpen = !!open[s.title]
          return (
            <section key={s.title} className="ttd-acc">
              <button type="button" className="ttd-acc-head" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [s.title]: !isOpen }))}>
                {s.title}
                <svg viewBox="0 0 24 24" aria-hidden="true" className={isOpen ? 'ttd-acc-chev up' : 'ttd-acc-chev'}><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {isOpen && (
                <div className="ttd-grid ttd-acc-body">
                  {s.fields.map((f) => {
                    const id = `ti-f-${norm(f.key)}`
                    const label = f.label ?? f.col?.title ?? f.key
                    return (
                      <div className="field ttd-field" key={f.key}>
                        <label htmlFor={id}>{label}</label>
                        {f.calc ? (
                          <input id={id} value={calcText(f.calc)} placeholder="(Calculated field)" readOnly />
                        ) : (
                          <FieldInput
                            id={id}
                            fieldKey={label}
                            col={f.col}
                            value={values[f.key] ?? {}}
                            readOnly={f.key === 'Name'}
                            options={f.col ? linked[f.col.id] ?? [] : []}
                            onChange={(nv) => set(f.key, nv)}
                          />
                        )}
                        <p className="field-hint">
                          {f.calc ? calcHint(f.calc) : f.key === 'Name' ? 'Allocated automatically' : f.col ? `Type: ${f.col.type}` : 'Not on the board, not saved'}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}

        <div className="drawer-actions">
          <button className="btn primary" type="button" onClick={() => void save()} disabled={!!busy}>
            {busy ?? 'Submit'}
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setValues({ Name: { text: kt } })
              setError(null)
            }}
            disabled={!!busy}
          >
            Clear Form
          </button>
        </div>
    </>
  )
}

