/** A Dispatch and Billing item's details, read-only. Changing the item is Actions > Edit (the pop-up form);
 *  starting dispatch and cancelling are in the Actions menu too, so this view carries what the form
 *  does not: the dispatch records (transport, job processes, dispatch entries, payments), documents. */

import { Fragment, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { CountRow, JobProcess, Order, Transporter } from '../api/types'
import { Drawer } from './Drawer'
import { StatusPill } from './board/Board'
import { OrderExecution } from './OrderExecution'
import { OrderDocuments } from './OrderDocuments'
import { formatDateTime } from '../lib/format'
import { commTerms, dispatchStatus, inr, rateText, saleTypeLabel, transportTypeLabel, uomLabel } from '../lib/deals'

type Named = { id: string; name: string }

export function OrderDetails({
  order, canManage, scNo, names, count, jobs, transporters, people, onClose, onEdit, onRefresh,
}: {
  order: Order
  canManage: boolean
  scNo: string
  names: { buyer: string; supplier: string; company: string; term: string }
  count: CountRow | null
  jobs: JobProcess[]
  transporters: Transporter[]
  people: Named[]
  onClose: () => void
  onEdit: (order: Order) => void
  onRefresh: () => Promise<void>
}) {
  const st = dispatchStatus(order.dispatch_status)
  const cancelled = order.status === 'cancelled'
  const closed = order.status === 'closed'
  const started = order.status === 'open_for_execution' || closed
  const canChange = canManage && !cancelled && !closed
  const job = jobs.find((j) => j.id === order.job_process_id)
  const transporter = transporters.find((t) => t.id === order.transporter_id)
  const person = people.find((p) => p.id === order.person_id)
  const editBlock = !canManage ? 'You need the “Create and manage orders” permission.' : cancelled ? 'A cancelled item cannot be changed.' : closed ? 'A closed item cannot be changed.' : null

  const rows: [string, ReactNode][] = useMemo(() => [
    ['Buyer', names.buyer],
    ['Supplier', names.supplier],
    ['Counts', count?.display_name ?? null],
    ['Quantity', `${inr(order.quantity)} ${uomLabel(order.uom)}${order.bag_weight ? ` · ${inr(order.bag_weight)} kg each` : ''}`],
    ['Final Rate', `₹${rateText(order.final_rate)} per kg`],
    ['Commission', `Buyer ${commTerms(order.buyer_comm_basis, order.buyer_comm_value)} · Supplier ${commTerms(order.supplier_comm_basis, order.supplier_comm_value)}`],
    ['Sale Type', saleTypeLabel(order.sale_type)],
    ['Invoice No.', order.invoice_no],
    ['Invoice Date', order.invoice_date],
    ['CGST', order.cgst_pct],
    ['Insurance Tax', order.insurance_pct],
    ['Add', order.add_amount],
    ['Deduct', order.deduct_amount],
    ['Round off', order.round_off],
    ['Transporter Type Details', order.transport_type ? transportTypeLabel(order.transport_type) : null],
    ['Transporter Name', transporter?.name ?? null],
    ['Vehicle Number', order.vehicle_no],
    ['Driver Contact Phone', order.driver_phone],
    ['Person', person?.name ?? null],
    ['Dispatch Date', order.tentative_dispatch_date],
    ['Sizing/Delivery Address', job?.name ?? order.alt_delivery_address],
    ['Delivery Schedule', order.delivery_schedule],
    ['Remark 1', order.special_instructions],
    ['Created', formatDateTime(order.created_at)],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [order, names, count, job, transporter, person])

  return (
    <Drawer title={order.order_no} onClose={onClose}>
      <p className="small">
        <StatusPill label={st.label} tone={st.tone} />
        <span className="muted">
          {' '}· created {order.order_date} · from <Link className="mono" to={`/sales-confirmations?open=${order.sales_confirmation_id}`}>{scNo || 'its Sales Confirmation'}</Link>
          {order.execution_opened_at ? ` · dispatch started ${formatDateTime(order.execution_opened_at)}` : ''}
        </span>
      </p>
      {order.is_duplicate && <div className="alert">Duplicate invoice: {order.duplication_error}</div>}
      {cancelled && <div className="notice small">Cancelled{order.cancelled_at ? ` ${formatDateTime(order.cancelled_at)}` : ''}. Its Sales Confirmation can now be cancelled or used again.</div>}
      {closed && <div className="notice small">This item is closed and can no longer be edited.</div>}

      <dl className="kv">
        {rows.filter(([, v]) => v !== null && v !== '' && v !== undefined).map(([k, v]) => (
          <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
        ))}
      </dl>
      <div className="figures">
        <div><span>Total weight</span><strong className="mono">{order.total_weight === null ? '—' : `${inr(order.total_weight)} kg`}</strong></div>
        <div><span>Value</span><strong className="mono">₹{inr(order.order_value, 0)}</strong></div>
        <div><span>Buyer commission</span><strong className="mono">₹{inr(order.buyer_commission, 0)}</strong></div>
        <div><span>Supplier commission</span><strong className="mono">₹{inr(order.supplier_commission, 0)}</strong></div>
        <div><span>Total amount</span><strong className="mono">₹{inr(order.total_amount, 2)}</strong></div>
      </div>

      <div className="drawer-actions">
        <button className="btn" type="button" disabled={!!editBlock} title={editBlock ?? undefined} onClick={() => onEdit(order)}>Edit</button>
        <button className="btn ghost" type="button" onClick={onClose}>Close</button>
      </div>
      {!started && !cancelled && <p className="muted small">Start dispatch (row Actions) to record dispatch entries, transport, job processes and payments.</p>}

      <OrderDocuments orderId={order.id} canEdit={canChange} />
      {started && <OrderExecution order={order} canManage={canManage} jobs={jobs} onChanged={onRefresh} />}
    </Drawer>
  )
}
