/** Vehicle trip sheet and cost report (own transport).
 *
 *  One trip sheet per run of our own vehicle, linked to a dispatch that went on
 *  an own-transport record. Fields: Trip ID (automatic), mileage start and end,
 *  fuel used (litres), trip cost (fuel cost + other cost such as toll or driver
 *  allowance) and the linked dispatch. Distance and cost per km are worked out.
 *  Filters: trip date range and vehicle. Transport admins (order.manage) add
 *  and edit trips. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Order, OrderDispatch, OrderTransport, OrderTrip } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { downloadCSV, toCSV } from '../lib/csv'
import { errMessage } from '../lib/party'

const CSV_COLUMNS = ['trip_id', 'trip_date', 'vehicle_no', 'driver', 'mileage_start', 'mileage_end', 'distance_km', 'fuel_used_litres', 'fuel_cost', 'other_cost', 'trip_cost', 'cost_per_km', 'linked_dispatch', 'order_no'] as const
const num = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d }))
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const perKm = (t: OrderTrip) => (Number(t.distance_km) > 0 ? Number(t.trip_cost) / Number(t.distance_km) : null)

export default function TripSheets() {
  const { can } = useAuth()
  const canManage = can('order.manage')
  const [trips, setTrips] = useState<OrderTrip[] | null>(null)
  const [dispatches, setDispatches] = useState<OrderDispatch[]>([])
  const [transports, setTransports] = useState<OrderTransport[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [fVeh, setFVeh] = useState('')
  const [editing, setEditing] = useState<OrderTrip | 'new' | null>(null)

  async function load() {
    const [t, d, tr, o] = await Promise.all([
      supabase.from('order_trips').select('*').order('trip_date', { ascending: false }),
      supabase.from('order_dispatches').select('*'),
      supabase.from('order_transports').select('*'),
      supabase.from('orders').select('*'),
    ])
    if (t.error) setError(errMessage(t.error, 'Could not load the trip sheets'))
    setTrips((t.data ?? []) as OrderTrip[])
    setDispatches((d.data ?? []) as OrderDispatch[])
    setTransports((tr.data ?? []) as OrderTransport[])
    setOrders((o.data ?? []) as Order[])
  }
  useEffect(() => {
    void load()
  }, [])

  const dispatchOf = useMemo(() => new Map(dispatches.map((d) => [d.id, d])), [dispatches])
  const orderOf = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  // A dispatch qualifies when it is on an own-transport record, or when it has no transport
  // chosen yet and its order has an own-transport record.
  const ownTransportOf = (d: OrderDispatch) =>
    d.transport_id ? transports.find((t) => t.id === d.transport_id && t.kind === 'our') : transports.find((t) => t.order_id === d.order_id && t.kind === 'our')
  const ownDispatches = useMemo(
    () => dispatches.filter((d) => (d.transport_id ? transports.find((t) => t.id === d.transport_id)?.kind === 'our' : transports.some((t) => t.order_id === d.order_id && t.kind === 'our'))),
    [dispatches, transports],
  )
  const vehicles = useMemo(() => [...new Set((trips ?? []).map((t) => t.vehicle_no).filter((v): v is string => !!v))].sort(), [trips])
  const rows = useMemo(
    () => (trips ?? []).filter((t) => (!from || t.trip_date >= from) && (!to || t.trip_date <= to) && (!fVeh || t.vehicle_no === fVeh)),
    [trips, from, to, fVeh],
  )
  const totals = rows.reduce((a, t) => ({ km: a.km + Number(t.distance_km), fuel: a.fuel + Number(t.fuel_used), cost: a.cost + Number(t.trip_cost) }), { km: 0, fuel: 0, cost: 0 })

  function exportCSV() {
    const list = rows.map((t) => {
      const d = dispatchOf.get(t.dispatch_id)
      return {
        trip_id: t.trip_no, trip_date: t.trip_date, vehicle_no: t.vehicle_no ?? '', driver: t.driver_name ?? '', mileage_start: t.mileage_start, mileage_end: t.mileage_end,
        distance_km: t.distance_km, fuel_used_litres: t.fuel_used, fuel_cost: t.fuel_cost, other_cost: t.other_cost, trip_cost: t.trip_cost, cost_per_km: perKm(t)?.toFixed(2) ?? '',
        linked_dispatch: d?.dispatch_no ?? '', order_no: d ? orderOf.get(d.order_id)?.order_no ?? '' : '',
      }
    })
    downloadCSV(`trip-sheets-${iso(new Date())}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!trips) return <Loading label="Loading trip sheets" />
  const filtered = from || to || fVeh

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Trip sheets</h1>
          <p className="page-sub">
            Own-vehicle trips with mileage, fuel and cost.{rows.length > 0 ? ` ${rows.length} trip${rows.length === 1 ? '' : 's'}, ${num(totals.km, 1)} km, ${num(totals.fuel, 1)} L fuel, ₹${num(totals.cost)} cost${totals.km > 0 ? ` (₹${num(totals.cost / totals.km)} per km)` : ''}.` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canManage && <button className="btn primary" type="button" onClick={() => setEditing('new')}>New trip</button>}
          <button className="btn" type="button" disabled={rows.length === 0} onClick={exportCSV}>Export {rows.length} as CSV</button>
        </div>
      </header>
      {error && <div className="alert">{error}</div>}

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field"><input aria-label="Trips from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Trips from" /></div>
        <div className="field"><input aria-label="Trips to" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Trips to" /></div>
        <div className="field"><select aria-label="Vehicle" value={fVeh} onChange={(e) => setFVeh(e.target.value)}><option value="">All vehicles</option>{vehicles.map((v) => (<option key={v} value={v}>{v}</option>))}</select></div>
        {filtered && <div className="field"><button className="btn ghost" type="button" onClick={() => { setFrom(''); setTo(''); setFVeh('') }}>Clear filters</button></div>}
      </div>

      {rows.length === 0 ? (
        <div className="card pad empty">{trips.length === 0 ? 'No trip sheets yet.' : 'No trip matches these filters.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trip ID</th><th>Vehicle</th><th className="right">Mileage start → end</th><th className="right">Fuel used</th><th className="right">Trip cost</th><th>Linked dispatch</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const d = dispatchOf.get(t.dispatch_id)
                const pk = perKm(t)
                return (
                  <tr key={t.id}>
                    <td className="mono">{t.trip_no}<div className="small muted">{t.trip_date}</div></td>
                    <td>{t.vehicle_no ?? '—'}{t.driver_name && <div className="small muted">{t.driver_name}</div>}</td>
                    <td className="right mono">{num(t.mileage_start, 1)} → {num(t.mileage_end, 1)}<div className="small muted">{num(t.distance_km, 1)} km</div></td>
                    <td className="right mono">{num(t.fuel_used, 1)} L{t.fuel_cost > 0 && <div className="small muted">₹{num(t.fuel_cost)}</div>}</td>
                    <td className="right mono"><strong>{num(t.trip_cost)}</strong>{pk !== null && <div className="small muted">₹{num(pk)}/km</div>}</td>
                    <td className="mono small">{d?.dispatch_no ?? '—'}<div className="muted">{d ? orderOf.get(d.order_id)?.order_no : ''}</div></td>
                    {canManage && <td><button className="btn ghost sm" type="button" onClick={() => setEditing(t)}>Edit</button></td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TripDrawer
          key={editing === 'new' ? 'new' : editing.id}
          trip={editing === 'new' ? null : editing}
          dispatches={ownDispatches}
          label={(d) => `${d.dispatch_no} · ${orderOf.get(d.order_id)?.order_no ?? ''} · ${d.dispatch_date}`}
          vehicleOf={(d) => d.vehicle_no ?? ownTransportOf(d)?.vehicle_no ?? ''}
          driverOf={(d) => ownTransportOf(d)?.driver_name ?? ''}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
    </>
  )
}

function TripDrawer({ trip, dispatches, label, vehicleOf, driverOf, onClose, onDone }: {
  trip: OrderTrip | null
  dispatches: OrderDispatch[]
  label: (d: OrderDispatch) => string
  vehicleOf: (d: OrderDispatch) => string
  driverOf: (d: OrderDispatch) => string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [dispatchId, setDispatchId] = useState(trip?.dispatch_id ?? '')
  const [date, setDate] = useState(trip?.trip_date ?? iso(new Date()))
  const [veh, setVeh] = useState(trip?.vehicle_no ?? '')
  const [driver, setDriver] = useState(trip?.driver_name ?? '')
  const [start, setStart] = useState(trip ? String(trip.mileage_start) : '')
  const [end, setEnd] = useState(trip ? String(trip.mileage_end) : '')
  const [fuel, setFuel] = useState(trip ? String(trip.fuel_used) : '')
  const [fuelCost, setFuelCost] = useState(trip ? String(trip.fuel_cost) : '')
  const [other, setOther] = useState(trip ? String(trip.other_cost) : '')
  const [notes, setNotes] = useState(trip?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function pick(id: string) {
    setDispatchId(id)
    const d = dispatches.find((x) => x.id === id)
    if (d && !trip) {
      setVeh(vehicleOf(d))
      setDriver(driverOf(d))
    }
  }

  async function save() {
    setErr(null)
    if (!dispatchId) return setErr('Choose the linked dispatch.')
    const s = Number(start), e = Number(end)
    if (start.trim() === '' || end.trim() === '' || !Number.isFinite(s) || !Number.isFinite(e) || s < 0) return setErr('Enter the start and end mileage.')
    if (e < s) return setErr('The end mileage cannot be less than the start mileage.')
    const f = fuel.trim() === '' ? 0 : Number(fuel), fc = fuelCost.trim() === '' ? 0 : Number(fuelCost), oc = other.trim() === '' ? 0 : Number(other)
    if (![f, fc, oc].every((v) => Number.isFinite(v) && v >= 0)) return setErr('Fuel and cost amounts must be zero or more.')
    setBusy(true)
    const body = { dispatch_id: dispatchId, trip_date: date, vehicle_no: veh.trim() || null, driver_name: driver.trim() || null, mileage_start: s, mileage_end: e, fuel_used: f, fuel_cost: fc, other_cost: oc, notes: notes.trim() || null }
    const res = trip
      ? await supabase.from('order_trips').update(body).eq('id', trip.id).select('id')
      : await supabase.from('order_trips').insert(body).select('id')
    setBusy(false)
    if (res.error) return setErr(errMessage(res.error, 'Could not save the trip.'))
    if (!res.data || res.data.length === 0) return setErr('Your account cannot change trip sheets.')
    await onDone()
  }

  return (
    <Drawer title={trip ? `${trip.trip_no} · edit trip` : 'New trip'} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <div className="form-grid">
        <Field id="tr-d" label="Linked dispatch">
          <select id="tr-d" value={dispatchId} disabled={!!trip} onChange={(e) => pick(e.target.value)}>
            <option value="">Choose a dispatch</option>
            {dispatches.map((d) => (<option key={d.id} value={d.id}>{label(d)}</option>))}
          </select>
        </Field>
        <Field id="tr-date" label="Trip date"><input id="tr-date" type="date" max={iso(new Date())} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field id="tr-veh" label="Vehicle no."><input id="tr-veh" value={veh} onChange={(e) => setVeh(e.target.value)} /></Field>
        <Field id="tr-drv" label="Driver"><input id="tr-drv" value={driver} onChange={(e) => setDriver(e.target.value)} /></Field>
        <Field id="tr-s" label="Mileage start"><input id="tr-s" type="number" min="0" step="0.1" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field id="tr-e" label="Mileage end"><input id="tr-e" type="number" min="0" step="0.1" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field id="tr-f" label="Fuel used (litres)"><input id="tr-f" type="number" min="0" step="0.1" value={fuel} onChange={(e) => setFuel(e.target.value)} /></Field>
        <Field id="tr-fc" label="Fuel cost"><input id="tr-fc" type="number" min="0" step="0.01" value={fuelCost} onChange={(e) => setFuelCost(e.target.value)} /></Field>
        <Field id="tr-oc" label="Other cost (toll, driver, etc.)"><input id="tr-oc" type="number" min="0" step="0.01" value={other} onChange={(e) => setOther(e.target.value)} /></Field>
        <Field id="tr-n" label="Notes"><input id="tr-n" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {dispatches.length === 0 && !trip && <p className="muted small">No dispatch qualifies yet. A trip can be linked to a dispatch whose order has an "Our" transportation record (and whose dispatch is not on another transport).</p>}
      <p className="muted small">Trip cost is fuel cost plus other cost. Distance is end minus start mileage.</p>
      <div className="drawer-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
      </div>
    </Drawer>
  )
}