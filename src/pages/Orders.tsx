/** Orders.
 *
 *  An order is created from a confirmed deal (the deal already has its Sales
 *  Confirmation). The commercial fields are copied from the deal by the
 *  database and cannot be edited here. The user adds the logistics: tentative
 *  dispatch date, delivery schedule, special instructions and an optional
 *  alternate delivery address picked from the Job Process list.
 *  Draft -> Confirmed (logistics checked) -> Open for execution. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { COMMISSION_TYPES } from '../api/types'
import type { CountRow, JobProcess, Order, PaymentTerm } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { OrderExecution } from '../components/OrderExecution'
import { errMessage } from '../lib/party'
import { formatDateTime } from '../lib/format'

type Named = { id: string; name: string }

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', confirmed: 'Confirmed', open_for_execution: 'Open for Execution', closed: 'Closed' }
const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }))

export default function Orders() {
  const { can } = useAuth()
  const canManage = can('order.manage')
  const canRead = canManage || can('order.read')
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<Order[] | null>(null)
  const [buyers, setBuyers] = useState<Named[]>([])
  const [suppliers, setSuppliers] = useState<Named[]>([])
  const [companies, setCompanies] = useState<Named[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [jobs, setJobs] = useState<JobProcess[]>([])
  const [editing, setEditing] = useState<Order | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(async () => {
    const [o, b, s, c, k, t, j] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('buyer_master').select('id,name'),
      supabase.from('supplier_master').select('id,name'),
      supabase.from('companies').select('id,name'),
      supabase.from('count_master').select('*'),
      supabase.from('payment_terms').select('*'),
      supabase.from('job_processes').select('*').order('name'),
    ])
    if (o.error) setBanner({ kind: 'bad', text: errMessage(o.error, 'Could not load orders') })
    setRows((o.data ?? []) as Order[])
    setBuyers((b.data ?? []) as Named[])
    setSuppliers((s.data ?? []) as Named[])
    setCompanies((c.data ?? []) as Named[])
    setCounts((k.data ?? []) as CountRow[])
    setTerms((t.data ?? []) as PaymentTerm[])
    setJobs((j.data ?? []) as JobProcess[])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const nameOf = (list: Named[], id: string | null) => (id ? list.find((x) => x.id === id)?.name ?? '—' : '—')
  const countName = useMemo(() => new Map(counts.map((x) => [x.id, x.display_name])), [counts])

  const openId = params.get('open')
  useEffect(() => {
    if (openId && rows) {
      const hit = rows.find((x) => x.id === openId)
      if (hit) setEditing(hit)
      setParams({}, { replace: true })
    }
  }, [openId, rows, setParams])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(
      (x) =>
        (!statusFilter || x.status === statusFilter) &&
        (!q ||
          x.order_no.toLowerCase().includes(q) ||
          nameOf(buyers, x.buyer_id).toLowerCase().includes(q) ||
          nameOf(suppliers, x.supplier_id).toLowerCase().includes(q) ||
          (countName.get(x.count_id) ?? '').toLowerCase().includes(q)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, statusFilter, buyers, suppliers, countName])

  if (!canRead) return <div className="card pad narrow-card">Your account does not have access to orders.</div>
  if (!rows) return <Loading label="Loading orders" />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Orders</h1>
          <p className="page-sub">Created from confirmed deals. Add the logistics, confirm the order, then open it for execution.</p>
        </div>
      </header>

      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      <div className="form-grid" style={{ maxWidth: 560 }}>
        <div className="field">
          <input aria-label="Search orders" placeholder="Search by order no., buyer, supplier or count" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card pad empty">{rows.length === 0 ? 'No orders yet. Open a confirmed deal and choose “Create order”.' : 'No order matches.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order no.</th><th>Date</th><th>Status</th><th>Buyer</th><th>Supplier</th><th>Count</th>
                <th className="right">Quantity</th><th>Dispatch</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.id} className="clickable" onClick={() => setEditing(x)}>
                  <td className="mono">{x.order_no}</td>
                  <td className="mono small">{x.order_date}</td>
                  <td><span className={x.status === 'draft' ? 'chip warn' : 'chip good'}>{STATUS_LABEL[x.status] ?? x.status}</span></td>
                  <td>{nameOf(buyers, x.buyer_id)}</td>
                  <td>{nameOf(suppliers, x.supplier_id)}</td>
                  <td className="small">{countName.get(x.count_id) ?? '—'}</td>
                  <td className="right mono">{money(x.quantity)} {x.uom}</td>
                  <td className="mono small">{x.tentative_dispatch_date ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <OrderDrawer
          key={editing.id}
          order={editing}
          canManage={canManage}
          names={{ buyer: nameOf(buyers, editing.buyer_id), supplier: nameOf(suppliers, editing.supplier_id), company: nameOf(companies, editing.company_id), term: terms.find((t) => t.id === editing.payment_term_id)?.name ?? '—' }}
          count={counts.find((c) => c.id === editing.count_id) ?? null}
          jobs={jobs}
          onClose={() => setEditing(null)}
          onRefresh={async () => {
            const { data } = await supabase.from('orders').select('*').eq('id', editing.id).maybeSingle()
            if (data) setEditing(data as Order)
            await load()
          }}
          onDone={async (text) => {
            setBanner({ kind: 'ok', text })
            setEditing(null)
            await load()
          }}
        />
      )}
    </>
  )
}

function OrderDrawer({
  order, canManage, names, count, jobs, onClose, onDone, onRefresh,
}: {
  order: Order
  canManage: boolean
  names: { buyer: string; supplier: string; company: string; term: string }
  count: CountRow | null
  jobs: JobProcess[]
  onClose: () => void
  onDone: (text: string) => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const [dispatch, setDispatch] = useState(order.tentative_dispatch_date ?? '')
  const [schedule, setSchedule] = useState(order.delivery_schedule ?? '')
  const [instr, setInstr] = useState(order.special_instructions ?? '')
  const [jobId, setJobId] = useState(order.job_process_id ?? '')
  const [addr, setAddr] = useState(order.alt_delivery_address ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isDraft = order.status === 'draft'
  const editable = canManage && (order.status === 'draft' || order.status === 'confirmed')

  const missing: string[] = []
  if (!dispatch) missing.push('Tentative dispatch date')
  else if (dispatch < order.order_date) missing.push('Dispatch date on or after the order date')
  if (!schedule.trim()) missing.push('Delivery schedule')

  function pickJob(id: string) {
    setJobId(id)
    const j = jobs.find((x) => x.id === id)
    if (j) setAddr(j.delivery_address || j.office_address || '')
    else setAddr('')
  }

  const fields = () => ({
    tentative_dispatch_date: dispatch || null,
    delivery_schedule: schedule.trim() || null,
    special_instructions: instr.trim() || null,
    job_process_id: jobId || null,
    alt_delivery_address: addr.trim() || null,
  })

  async function run(extra: Record<string, unknown>, msg: string) {
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase.from('orders').update({ ...fields(), ...extra }).eq('id', order.id).select('id')
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this order'))
    if (!data || data.length === 0) return setErr('Your account cannot change this order.')
    await onDone(msg)
  }

  async function remove() {
    setBusy(true)
    const { data, error } = await supabase.from('orders').delete().eq('id', order.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Only draft orders can be deleted.')
    await onDone(`${order.order_no} deleted.`)
  }

  const commLabel = COMMISSION_TYPES.find((t) => t.value === order.commission_type)?.label ?? order.commission_type ?? '—'

  return (
    <Drawer title={`${order.order_no} · ${STATUS_LABEL[order.status] ?? order.status}`} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <h3 className="section-title">A · From the deal (read-only)</h3>
      <dl className="kv">
        <dt>Order number</dt><dd className="mono">{order.order_no}</dd>
        <dt>Order date</dt><dd className="mono">{order.order_date}</dd>
        <dt>Buyer</dt><dd>{names.buyer}</dd>
        <dt>Supplier</dt><dd>{names.supplier}</dd>
        <dt>Internal company</dt><dd>{names.company}</dd>
        <dt>Count</dt><dd>{count?.display_name ?? '—'}</dd>
        {count && (<>
          <dt>Product specs</dt>
          <dd>{[count.machine, `${count.composition} ${count.ratio}`, count.yarn_type, count.process, count.certification].filter(Boolean).join(' · ')}</dd>
        </>)}
        <dt>Quantity</dt><dd className="mono">{money(order.quantity)} {order.uom}</dd>
        <dt>Bag weight</dt><dd className="mono">{order.bag_weight ?? '—'}</dd>
        <dt>Buyer rate</dt><dd className="mono">{money(order.buyer_rate)}</dd>
        <dt>Supplier rate</dt><dd className="mono">{money(order.supplier_rate)}</dd>
        <dt>Commission</dt><dd>{commLabel}</dd>
        <dt>Ex-Mill / Net</dt><dd>{order.price_basis === 'net' ? 'Net' : 'Ex-mill'}</dd>
        <dt>Freight</dt><dd>{order.freight === 'included' ? 'Included' : 'Excluded'}</dd>
        <dt>Payment terms</dt><dd>{names.term}</dd>
      </dl>

      <h3 className="section-title">B · Logistics</h3>
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-grid">
          <Field id="o-dispatch" label="Tentative dispatch date" required>
            <input id="o-dispatch" type="date" value={dispatch} onChange={(e) => setDispatch(e.target.value)} />
          </Field>
          <Field id="o-sched" label="Delivery schedule" required hint="For example: 2 lots, first by 20th, second by month end.">
            <textarea id="o-sched" rows={2} value={schedule} onChange={(e) => setSchedule(e.target.value)} />
          </Field>
          <Field id="o-instr" label="Special instructions">
            <textarea id="o-instr" rows={2} value={instr} onChange={(e) => setInstr(e.target.value)} />
          </Field>
          <Field id="o-job" label="Alternate delivery (job processor)" hint="Optional. Picking one fills the address below.">
            <select id="o-job" value={jobId} onChange={(e) => pickJob(e.target.value)}>
              <option value="">Buyer’s own address</option>
              {jobs.filter((j) => j.is_active || j.id === jobId).map((j) => (<option key={j.id} value={j.id}>{j.name}</option>))}
            </select>
          </Field>
          <Field id="o-addr" label="Alternate delivery address">
            <textarea id="o-addr" rows={3} value={addr} onChange={(e) => setAddr(e.target.value)} />
          </Field>
        </div>
      </fieldset>

      {isDraft && missing.length > 0 && <p className="field-hint">Needed to confirm: {missing.join(', ')}.</p>}

      {order.status === 'confirmed' && order.confirmed_at && <p className="notice small">Confirmed {formatDateTime(order.confirmed_at)}. Commercial fields are locked.</p>}
      {(order.status === 'open_for_execution' || order.status === 'closed') && <OrderExecution order={order} canManage={canManage} jobs={jobs} onChanged={onRefresh} />}

      <div className="drawer-actions">
        {editable && (
          <button className="btn" type="button" disabled={busy} onClick={() => void run({}, `${order.order_no} saved.`)}>Save logistics</button>
        )}
        {canManage && isDraft && (
          <button className="btn primary" type="button" disabled={busy || missing.length > 0} onClick={() => void run({ status: 'confirmed' }, `${order.order_no} confirmed; commercial fields are locked.`)}>
            Confirm order
          </button>
        )}
        {canManage && order.status === 'confirmed' && (
          <button className="btn primary" type="button" disabled={busy} onClick={() => void run({ status: 'open_for_execution' }, `${order.order_no} is open for execution.`)}>
            Open for execution
          </button>
        )}
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
        {canManage && isDraft && <DeleteControl label="Delete this draft" name={order.order_no} busy={busy} onConfirm={() => void remove()} />}
      </div>
    </Drawer>
  )
}