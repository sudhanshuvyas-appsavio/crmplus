/** Commission Invoices: one invoice per Business Unit and party (Buyer or Supplier) for a date range,
 *  rebuilt from monday's Commission Board app.
 *
 *  Create: pick the Business Unit, party and dates; the dispatch lines that can still be billed to that party
 *  are listed (the database refuses a second invoice for the same line); tick the lines, add Add / Deduct /
 *  TDS / Round Off, and the database works out the amounts and the invoice number. The "Brokerage Bill" PDF is
 *  drawn in the browser, stored in the private commission-invoices bucket, and can be downloaded again.
 *  Cancel frees the lines so they can be billed again. Status (Generated / Sent / Pending) and payments
 *  (Mode of Payment, Payment Collected, Payment Pending) follow monday's Commission Invoices board. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Company } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Modal } from '../components/Modal'
import { RowActionMenu } from '../components/RowActionMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorBanner } from '../components/FormKit'
import { Field } from '../components/PartyForms'
import { GridPager, GridToolbar, usePaging, type FilterDef } from '../components/GridKit'
import { errMessage } from '../lib/party'
import { searchKey } from '../lib/validate'
import { formatDate } from '../lib/format'
import { downloadCSV, toCSV } from '../lib/csv'
import { todayIST } from '../lib/tasks'
import { useProfileNames } from '../components/PartyExtras'
import { COMM_BASES, commTerms } from '../lib/deals'
import { buildCommissionInvoicePdf, type BillParty, type BillUnit } from '../lib/commissionInvoicePdf'
import {
  INVOICE_STATUSES, PARTY_TYPES, PAYMENT_MODES, PAYMENT_STATES, amountInWords, modeLabel, money, partyLabel, paymentState, qtyText, statusInfo,
  type BillableParty, type CandidateLine, type CommissionInvoiceRow, type CommissionLineRow, type CommissionPaymentRow, type InvoiceStatus, type PartyType,
} from '../lib/commissionInvoice'

const BUCKET = 'commission-invoices'

type Named = { id: string; name: string; address: string | null }

interface Refs {
  companies: Company[]
  buyers: Named[]
  suppliers: Named[]
}

const num = (v: string): number | null => {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function partyName(inv: CommissionInvoiceRow, refs: Refs): string {
  if (inv.party_type === 'supplier') return refs.suppliers.find((s) => s.id === inv.supplier_id)?.name ?? '—'
  if (inv.party_type === 'buyer') return refs.buyers.find((b) => b.id === inv.buyer_id)?.name ?? '—'
  return refs.buyers.find((b) => b.id === inv.buyer_id)?.name ?? '—'
}

const CSV_COLUMNS = ['invoice_no', 'date', 'party_type', 'party', 'business_unit', 'invoice_from_date', 'invoice_to_date', 'commission_type', 'commission_value',
  'total_bags', 'total', 'add', 'deduct', 'tds', 'net_amount', 'round_off', 'payment_collected', 'payment_pending', 'payment_status', 'mode_of_payment',
  'document_no', 'person', 'status', 'text', 'remarks', 'cancel_reason'] as const

/** Everything the PDF needs for a saved invoice. */
async function billInputs(inv: CommissionInvoiceRow, refs: Refs): Promise<{ lines: CommissionLineRow[]; unit: BillUnit; party: BillParty }> {
  const { data, error } = await supabase.from('commission_invoice_lines').select('*').eq('invoice_id', inv.id).order('sr_no')
  if (error) throw error
  const c = refs.companies.find((x) => x.id === inv.company_id)
  const unit: BillUnit = {
    name: c?.name ?? '',
    pan: c?.pan_number ?? null,
    address: c?.address ?? null,
    phones: [c?.phone_1, c?.phone_2, c?.phone_3, c?.mobile].filter((p): p is string => !!p && p.trim() !== ''),
    fax: c?.fax ?? null,
    email: c?.email ?? null,
    bank: c?.bank_account_1 ?? null,
  }
  const list = inv.party_type === 'supplier' ? refs.suppliers : refs.buyers
  const id = inv.party_type === 'supplier' ? inv.supplier_id : inv.buyer_id
  const p = list.find((x) => x.id === id)
  return { lines: (data ?? []) as CommissionLineRow[], unit, party: { name: p?.name ?? '', address: p?.address ?? null } }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Draw the PDF, keep a copy in storage and record its path. A failure here never undoes the invoice. */
async function storePdf(inv: CommissionInvoiceRow, refs: Refs): Promise<{ blob: Blob; stored: boolean; problem?: string }> {
  const { lines, unit, party } = await billInputs(inv, refs)
  const blob = await buildCommissionInvoicePdf(inv, lines, unit, party)
  const path = `${inv.id}/invoice_${inv.invoice_no ?? inv.id}.pdf`
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: true })
  if (up.error) return { blob, stored: false, problem: up.error.message }
  const set = await supabase.rpc('set_commission_invoice_pdf', { p_id: inv.id, p_path: path })
  if (set.error) return { blob, stored: false, problem: set.error.message }
  return { blob, stored: true }
}

export default function CommissionInvoices() {
  const { can } = useAuth()
  const canManage = can('order.manage')
  const people = useProfileNames()
  const [rows, setRows] = useState<CommissionInvoiceRow[] | null>(null)
  const [refs, setRefs] = useState<Refs>({ companies: [], buyers: [], suppliers: [] })
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [query, setQuery] = useState('')
  const [fParty, setFParty] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fPayment, setFPayment] = useState('')
  const [creating, setCreating] = useState(false)
  const [paying, setPaying] = useState<CommissionInvoiceRow | null>(null)
  const [editing, setEditing] = useState<CommissionInvoiceRow | null>(null)
  const [viewing, setViewing] = useState<CommissionInvoiceRow | null>(null)
  const [cancelling, setCancelling] = useState<CommissionInvoiceRow | null>(null)
  const [reason, setReason] = useState('')
  const [cancelErr, setCancelErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [inv, c, b, s] = await Promise.all([
      supabase.from('commission_invoices').select('*').order('created_at', { ascending: false }),
      supabase.from('companies').select('*').order('name'),
      supabase.from('buyer_master').select('id,name,address').order('name'),
      supabase.from('supplier_master').select('id,name,address').order('name'),
    ])
    if (inv.error) setError(errMessage(inv.error, 'Could not load the commission invoices'))
    setRows((inv.data ?? []) as CommissionInvoiceRow[])
    setRefs({ companies: (c.data ?? []) as Company[], buyers: (b.data ?? []) as Named[], suppliers: (s.data ?? []) as Named[] })
  }, [])

  useEffect(() => { void load() }, [load])
  // an open invoice follows the reloaded list (after a payment is removed, for instance)
  useEffect(() => {
    if (!viewing || !rows) return
    const fresh = rows.find((r) => r.id === viewing.id)
    if (fresh && fresh !== viewing) setViewing(fresh)
  }, [rows, viewing])

  const filtered = useMemo(() => {
    const q = searchKey(query)
    return (rows ?? []).filter((x) => {
      if (fParty && (x.party_type ?? 'legacy') !== fParty) return false
      if (fStatus && x.status !== fStatus) return false
      if (fCompany && x.company_id !== fCompany) return false
      if (fPayment) {
        const paid = Number(x.paid_amount ?? 0)
        const pending = Number(x.payment_pending ?? 0)
        if (x.status === 'cancelled') return false
        if (fPayment === 'unpaid' && paid > 0) return false
        if (fPayment === 'part' && !(paid > 0 && pending > 0)) return false
        if (fPayment === 'paid' && pending > 0) return false
      }
      if (!q) return true
      const text = [
        x.invoice_no, x.invoice_date, partyLabel(x.party_type), partyName(x, refs), refs.companies.find((c) => c.id === x.company_id)?.name,
        x.period_from, x.period_to, x.net_amount, x.commission_total, x.remarks, x.party_note, x.document_no, x.status, x.is_legacy ? 'legacy one per order' : '', modeLabel(x.payment_mode), x.payment_pending,
      ].join(' ')
      return searchKey(text).includes(q)
    })
  }, [rows, query, fParty, fStatus, fCompany, fPayment, refs])
  const paging = usePaging(filtered, `${query}|${fParty}|${fStatus}|${fCompany}|${fPayment}`)

  const filterDefs: FilterDef[] = [
    { name: 'party', label: 'Party Type', allLabel: 'All party types', options: [...PARTY_TYPES.map((p) => ({ value: p.value, label: p.label })), { value: 'legacy', label: 'Old (one per order)' }] },
    { name: 'status', label: 'Status', allLabel: 'All statuses', options: INVOICE_STATUSES.map((x) => ({ value: x.value, label: x.label })) },
    { name: 'payment', label: 'Payment', allLabel: 'All payments', options: [{ value: 'unpaid', label: 'Nothing collected' }, { value: 'part', label: 'Part paid' }, { value: 'paid', label: 'Fully paid' }] },
    { name: 'company', label: 'Business Unit', allLabel: 'All business units', options: refs.companies.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name })) },
  ]

  async function download(inv: CommissionInvoiceRow) {
    setBanner(null)
    setBusy(true)
    try {
      if (inv.is_legacy) throw new Error('Old one-per-order invoices have no PDF. Their bill was printed from the order.')
      if (inv.pdf_path) {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrl(inv.pdf_path, 60, { download: `invoice_${inv.invoice_no}.pdf` })
        if (data?.signedUrl) { window.open(data.signedUrl, '_blank', 'noopener'); return }
      }
      // no stored copy (or it could not be opened): draw it again
      if (canManage) {
        const made = await storePdf(inv, refs)
        saveBlob(made.blob, `invoice_${inv.invoice_no}.pdf`)
        if (made.stored) await load()
      } else {
        const { lines, unit, party } = await billInputs(inv, refs)
        saveBlob(await buildCommissionInvoicePdf(inv, lines, unit, party), `invoice_${inv.invoice_no}.pdf`)
      }
    } catch (e) {
      setBanner({ kind: 'bad', text: errMessage(e, 'Could not make the PDF') })
    } finally {
      setBusy(false)
    }
  }

  async function confirmCancel() {
    if (!cancelling) return
    setBusy(true)
    setCancelErr(null)
    const { error: e } = await supabase.rpc('cancel_commission_invoice', { p_id: cancelling.id, p_reason: reason })
    setBusy(false)
    if (e) { setCancelErr(errMessage(e, 'Could not cancel the invoice')); return }
    setBanner({ kind: 'ok', text: `Invoice ${cancelling.invoice_no} is cancelled. Its lines can be billed again.` })
    setCancelling(null)
    setReason('')
    setViewing(null)
    await load()
  }

  async function setStatus(inv: CommissionInvoiceRow, status: InvoiceStatus) {
    setBanner(null)
    setBusy(true)
    const { error: e } = await supabase.rpc('set_commission_invoice_status', { p_id: inv.id, p_status: status })
    setBusy(false)
    if (e) { setBanner({ kind: 'bad', text: errMessage(e, 'Could not change the status') }); return }
    setBanner({ kind: 'ok', text: `Invoice ${inv.invoice_no} is now ${statusInfo(status).label}.` })
    await load()
  }

  function exportCsv() {
    const list = filtered.map((x) => ({
      invoice_no: x.invoice_no ?? '', date: x.invoice_date, party_type: x.is_legacy ? 'Old (one per order)' : partyLabel(x.party_type), party: partyName(x, refs),
      business_unit: refs.companies.find((c) => c.id === x.company_id)?.name ?? '', invoice_from_date: x.period_from ?? '', invoice_to_date: x.period_to ?? '',
      commission_type: x.commission_basis ? COMM_BASES.find((b) => b.value === x.commission_basis)?.label ?? x.commission_basis : '', commission_value: x.commission_value ?? '',
      total_bags: x.total_bags ?? '', total: x.commission_total ?? x.amount, add: x.is_legacy ? '' : x.add_amount, deduct: x.is_legacy ? '' : x.deduct_amount, tds: x.is_legacy ? '' : x.tds_amount,
      net_amount: x.net_amount ?? x.amount, round_off: x.is_legacy ? '' : x.round_off, payment_collected: x.paid_amount, payment_pending: x.status === 'cancelled' ? '' : x.payment_pending,
      payment_status: paymentState(x) === 'none' ? '' : PAYMENT_STATES[paymentState(x)].label, mode_of_payment: modeLabel(x.payment_mode), document_no: x.document_no ?? '',
      person: x.created_by ? people[x.created_by] ?? '' : '', status: statusInfo(x.status).label, text: x.party_note ?? '', remarks: x.remarks ?? '', cancel_reason: x.cancel_reason ?? '',
    }))
    downloadCSV(`commission-invoices-${todayIST()}.csv`, toCSV(CSV_COLUMNS, list))
  }

  if (!rows) return <Loading label="Loading commission invoices" />

  return (
    <>
      <GridToolbar
        title="Commission Invoices"
        total={filtered.length}
        singular="invoice"
        plural="invoices"
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search invoice no., party, business unit, dates, amount or remarks"
        filters={filterDefs}
        values={{ party: fParty, status: fStatus, payment: fPayment, company: fCompany }}
        onFilter={(name, value) => { if (name === 'party') setFParty(value); else if (name === 'status') setFStatus(value); else if (name === 'payment') setFPayment(value); else setFCompany(value) }}
        onClear={() => { setFParty(''); setFStatus(''); setFPayment(''); setFCompany('') }}
      >
        <button className="btn" type="button" disabled={filtered.length === 0} onClick={exportCsv}>Export {filtered.length} as CSV</button>
        {canManage && <button className="btn primary" type="button" onClick={() => setCreating(true)}>New commission invoice</button>}
      </GridToolbar>

      <ErrorBanner message={error} />
      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="left md-sticky">Invoice No</th>
              <th>Date</th>
              <th>Party Type</th>
              <th>Party</th>
              <th>Business Unit</th>
              <th>Invoice From Date</th>
              <th>Invoice To Date</th>
              <th>Commission</th>
              <th className="right">Total Bags</th>
              <th className="right">Total</th>
              <th className="right">Add</th>
              <th className="right">Deduct</th>
              <th className="right">TDS</th>
              <th className="right">Net Amount</th>
              <th className="right">Round Off</th>
              <th className="right">Payment Collected</th>
              <th className="right">Payment Pending</th>
              <th>Payment Status</th>
              <th>Mode of Payment</th>
              <th>Document No</th>
              <th>Person</th>
              <th>Status</th>
              <th className="md-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paging.visible.length === 0 ? (
              <tr><td colSpan={23} className="empty">{rows.length === 0 ? 'No commission invoices yet.' : 'No commission invoice matches this search.'}</td></tr>
            ) : (
              paging.visible.map((x) => (
                <tr key={x.id} className={x.status === 'cancelled' ? 'is-inactive' : undefined}>
                  <td className="left md-sticky mono"><strong>{x.invoice_no}</strong></td>
                  <td className="mono small">{formatDate(x.invoice_date)}</td>
                  <td>{x.is_legacy ? <span className="chip">Old, per order</span> : partyLabel(x.party_type)}</td>
                  <td>{partyName(x, refs)}</td>
                  <td>{refs.companies.find((c) => c.id === x.company_id)?.name ?? '—'}</td>
                  <td className="mono small">{x.period_from ? formatDate(x.period_from) : '—'}</td>
                  <td className="mono small">{x.period_to ? formatDate(x.period_to) : '—'}</td>
                  <td className="small">{x.commission_basis ? commTerms(x.commission_basis, x.commission_value) : '—'}</td>
                  <td className="right mono">{x.total_bags === null ? '—' : qtyText(x.total_bags)}</td>
                  <td className="right mono">{x.commission_total === null ? money(x.amount) : money(x.commission_total)}</td>
                  <td className="right mono">{x.is_legacy ? '—' : money(x.add_amount)}</td>
                  <td className="right mono">{x.is_legacy ? '—' : money(x.deduct_amount)}</td>
                  <td className="right mono">{x.is_legacy ? '—' : money(x.tds_amount)}</td>
                  <td className="right mono"><strong>{money(x.net_amount ?? x.amount)}</strong></td>
                  <td className="right mono">{x.is_legacy ? '—' : money(x.round_off)}</td>
                  <td className="right mono">{money(x.paid_amount)}</td>
                  <td className="right mono">{x.status === 'cancelled' ? '—' : <strong>{money(x.payment_pending)}</strong>}</td>
                  <td>{paymentState(x) === 'none' ? '—' : <span className={`chip${PAYMENT_STATES[paymentState(x)].chip}`}>{PAYMENT_STATES[paymentState(x)].label}</span>}</td>
                  <td>{modeLabel(x.payment_mode) || '—'}</td>
                  <td>{x.document_no ?? '—'}</td>
                  <td>{x.created_by ? people[x.created_by] ?? '—' : '—'}</td>
                  <td><span className={`chip${statusInfo(x.status).chip}`}>{statusInfo(x.status).label}</span></td>
                  <td className="md-actions">
                    <RowActionMenu
                      label={`invoice ${x.invoice_no}`}
                      busy={busy}
                      actions={[
                        { label: 'Open', onSelect: () => setViewing(x) },
                        ...(canManage ? [{
                          label: 'Edit details', onSelect: () => setEditing(x),
                          disabledReason: x.is_legacy ? 'Old invoices cannot be edited here' : x.status === 'cancelled' ? 'This invoice is cancelled' : null,
                        }, {
                          label: 'Record payment', onSelect: () => setPaying(x),
                          disabledReason: x.status === 'cancelled' ? 'This invoice is cancelled' : Number(x.payment_pending) <= 0 ? 'Fully paid' : null,
                        }, {
                          label: 'Mark as sent', onSelect: () => void setStatus(x, 'sent'),
                          disabledReason: x.status === 'cancelled' ? 'This invoice is cancelled' : x.status === 'sent' ? 'Already sent' : null,
                        }, {
                          label: 'Mark as pending', onSelect: () => void setStatus(x, 'pending'),
                          disabledReason: x.status === 'cancelled' ? 'This invoice is cancelled' : x.status === 'pending' ? 'Already pending' : null,
                        }] : []),
                        { label: 'Download PDF', onSelect: () => void download(x), disabledReason: x.is_legacy ? 'Old invoices have no PDF' : null },
                        ...(canManage ? [{
                          label: 'Cancel invoice', tone: 'danger' as const,
                          onSelect: () => { setCancelErr(null); setReason(''); setCancelling(x) },
                          disabledReason: x.is_legacy ? 'Old invoices cannot be cancelled here' : x.status === 'cancelled' ? 'Already cancelled' : null,
                        }] : []),
                      ]}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <GridPager {...paging.pager} singular="invoice" plural="invoices" />

      {creating && (
        <NewInvoice
          refs={refs}
          onClose={() => setCreating(false)}
          onCreated={async (text, ok) => { setCreating(false); setBanner({ kind: ok ? 'ok' : 'bad', text }); await load() }}
        />
      )}
      {editing && (
        <EditDetails
          inv={editing}
          refs={refs}
          onClose={() => setEditing(null)}
          onSaved={async (text, ok) => { setEditing(null); setBanner({ kind: ok ? 'ok' : 'bad', text }); await load() }}
        />
      )}
      {paying && (
        <RecordPayment
          inv={paying}
          onClose={() => setPaying(null)}
          onDone={async (text) => { setPaying(null); setBanner({ kind: 'ok', text }); await load() }}
        />
      )}
      {viewing && (
        <InvoiceView
          inv={viewing}
          refs={refs}
          canManage={canManage}
          busy={busy}
          onClose={() => setViewing(null)}
          onDownload={() => void download(viewing)}
          onPay={() => { const v = viewing; setViewing(null); setPaying(v) }}
          onEdit={() => { const v = viewing; setViewing(null); setEditing(v) }}
          onChanged={load}
          onCancel={() => { setCancelErr(null); setReason(''); setCancelling(viewing) }}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title={`Cancel invoice ${cancelling.invoice_no}`}
          confirmLabel="Cancel invoice"
          busy={busy}
          error={cancelErr}
          onConfirm={() => void confirmCancel()}
          onClose={() => setCancelling(null)}
        >
          <p>Its dispatch lines go back to the list and can be billed again. The invoice number is not reused. An invoice with a payment already recorded cannot be cancelled.</p>
          <Field id="ci-reason" label="Reason" required>
            <textarea id="ci-reason" rows={3} value={reason} placeholder="Why is this invoice cancelled?" onChange={(e) => setReason(e.target.value)} />
          </Field>
        </ConfirmDialog>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ view */

function InvoiceView({ inv, refs, canManage, busy, onClose, onDownload, onCancel, onPay, onEdit, onChanged }: {
  inv: CommissionInvoiceRow; refs: Refs; canManage: boolean; busy: boolean
  onClose: () => void; onDownload: () => void; onCancel: () => void; onPay: () => void; onEdit: () => void; onChanged: () => Promise<void>
}) {
  const [lines, setLines] = useState<CommissionLineRow[] | null>(null)
  const [pays, setPays] = useState<CommissionPaymentRow[] | null>(null)
  const [payErr, setPayErr] = useState<string | null>(null)
  const loadPays = useCallback(async () => {
    const { data } = await supabase.from('commission_invoice_payments').select('*').eq('invoice_id', inv.id).order('paid_on').order('created_at')
    setPays((data ?? []) as CommissionPaymentRow[])
  }, [inv.id])
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('commission_invoice_lines').select('*').eq('invoice_id', inv.id).order('sr_no')
      setLines((data ?? []) as CommissionLineRow[])
    })()
    void loadPays()
  }, [inv.id, loadPays])
  async function removePay(id: string) {
    setPayErr(null)
    const { error: e } = await supabase.rpc('delete_commission_payment', { p_payment: id })
    if (e) { setPayErr(errMessage(e, 'Could not delete the payment')); return }
    await loadPays()
    await onChanged()
    setPayErr('Payment removed.')
  }
  const net = Number(inv.net_amount ?? inv.amount)
  return (
    <Modal
      title={`Commission invoice ${inv.invoice_no}`}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
          {!inv.is_legacy && <button className="btn" type="button" onClick={onDownload} disabled={busy}>Download PDF</button>}
          {canManage && !inv.is_legacy && inv.status !== 'cancelled' && <button className="btn" type="button" onClick={onEdit} disabled={busy}>Edit details</button>}
          {canManage && inv.status !== 'cancelled' && Number(inv.payment_pending) > 0 && <button className="btn" type="button" onClick={onPay} disabled={busy}>Record payment</button>}
          {canManage && !inv.is_legacy && inv.status !== 'cancelled' && <button className="btn danger" type="button" onClick={onCancel} disabled={busy}>Cancel invoice</button>}
        </>
      }
    >
      <div className="form-grid">
        <ReadOnly label="Invoice No" value={inv.invoice_no ?? ''} />
        <ReadOnly label="Date" value={formatDate(inv.invoice_date)} />
        <ReadOnly label="Status" value={inv.status === 'cancelled' ? `Cancelled${inv.cancel_reason ? `: ${inv.cancel_reason}` : ''}` : `${statusInfo(inv.status).label}${inv.status === 'sent' && inv.sent_at ? ` on ${formatDate(inv.sent_at)}` : ''}`} />
        <ReadOnly label="Party Type" value={inv.is_legacy ? 'Old, one invoice per order' : partyLabel(inv.party_type)} />
        <ReadOnly label="Party" value={partyName(inv, refs)} />
        <ReadOnly label="Business Unit" value={refs.companies.find((c) => c.id === inv.company_id)?.name ?? '—'} />
        {inv.document_no && <ReadOnly label="Document No" value={inv.document_no} />}
        {!inv.is_legacy && <ReadOnly label="Invoice From" value={inv.period_from ? formatDate(inv.period_from) : ''} />}
        {!inv.is_legacy && <ReadOnly label="Invoice To" value={inv.period_to ? formatDate(inv.period_to) : ''} />}
        {inv.commission_basis && <ReadOnly label="Commission (manual rate)" value={commTerms(inv.commission_basis, inv.commission_value)} />}
      </div>
      {inv.is_legacy ? (
        <p className="muted small">An invoice made before the register existed: one amount for the whole order ({money(inv.amount)}).</p>
      ) : (
        <>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr><th>SNo</th><th>{inv.party_type === 'supplier' ? 'Buyer' : 'Mill'}</th><th>Count</th><th>Invoice No.</th><th>Invoice Date</th><th className="right">Quantity</th><th className="right">Amount</th></tr>
              </thead>
              <tbody>
                {!lines ? <tr><td colSpan={7} className="empty">Loading…</td></tr> : lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.sr_no}</td><td>{l.counterparty ?? ''}</td><td>{l.count_label ?? ''}</td><td className="mono">{l.invoice_no ?? ''}</td>
                    <td className="mono small">{l.invoice_date ? formatDate(l.invoice_date) : ''}</td>
                    <td className="right mono">{qtyText(l.quantity)} {l.uom ?? ''}</td><td className="right mono">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <ReadOnly label="Total" value={money(inv.commission_total)} />
            <ReadOnly label="Add" value={money(inv.add_amount)} />
            <ReadOnly label="Deduct" value={money(inv.deduct_amount)} />
            <ReadOnly label="Net Amount" value={money(net)} />
            <ReadOnly label="TDS" value={money(inv.tds_amount)} />
            <ReadOnly label="Round Off" value={money(inv.round_off)} />
            <ReadOnly label="Total Bags" value={qtyText(inv.total_bags)} />
          </div>
          <p className="small"><strong>{amountInWords(net)}</strong></p>
          {inv.remarks && <p className="small muted">Remarks: {inv.remarks}</p>}
        </>
      )}
      <h3 style={{ margin: '16px 0 6px' }}>Payments</h3>
      <div className="form-grid">
        <ReadOnly label="Payment Collected" value={money(inv.paid_amount)} />
        <ReadOnly label="Payment Pending" value={inv.status === 'cancelled' ? '' : money(inv.payment_pending)} />
        <ReadOnly label="Payment Status" value={PAYMENT_STATES[paymentState(inv)].label} />
        <ReadOnly label="Mode of Payment" value={modeLabel(inv.payment_mode)} />
      </div>
      {payErr && <div className="notice">{payErr}</div>}
      {pays && pays.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>Date</th><th>Mode</th><th className="right">Amount</th><th>Reference</th><th>Note</th>{canManage && <th />}</tr></thead>
            <tbody>
              {pays.map((p) => (
                <tr key={p.id}>
                  <td className="mono small">{formatDate(p.paid_on)}</td><td>{modeLabel(p.mode)}</td><td className="right mono">{money(p.amount)}</td><td>{p.reference ?? ''}</td><td>{p.note ?? ''}</td>
                  {canManage && <td><button className="btn ghost sm" type="button" onClick={() => void removePay(p.id)}>Remove</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pays && pays.length === 0 && <p className="muted small">No payment recorded yet.</p>}
    </Modal>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input readOnly value={value} style={{ background: 'var(--surface-3)' }} />
    </div>
  )
}

/* ---------------------------------------------------------------- details */

function EditDetails({ inv, refs, onClose, onSaved }: {
  inv: CommissionInvoiceRow
  refs: Refs
  onClose: () => void
  onSaved: (text: string, ok: boolean) => Promise<void> | void
}) {
  const [docNo, setDocNo] = useState(inv.document_no ?? '')
  const [note, setNote] = useState(inv.party_note ?? '')
  const [remarks, setRemarks] = useState(inv.remarks ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setErr(null)
    setBusy(true)
    const { error } = await supabase.rpc('update_commission_invoice_details', { p_id: inv.id, p_document_no: docNo, p_party_note: note, p_remarks: remarks })
    if (error) { setBusy(false); setErr(errMessage(error, 'Could not save the details')); return }
    if (note.trim() === (inv.party_note ?? '').trim()) {
      setBusy(false)
      await onSaved(`Details of invoice ${inv.invoice_no} saved.`, true)
      return
    }
    // the Text is printed on the bill, so the stored PDF is drawn again
    try {
      const { data: row } = await supabase.from('commission_invoices').select('*').eq('id', inv.id).single()
      const made = await storePdf(row as CommissionInvoiceRow, refs)
      setBusy(false)
      await onSaved(made.stored ? `Details of invoice ${inv.invoice_no} saved and its PDF updated.` : `Details saved. The PDF could not be refreshed (${made.problem}); use Download PDF.`, made.stored)
    } catch (e) {
      setBusy(false)
      await onSaved(`Details saved, but the PDF could not be refreshed (${errMessage(e, 'unknown error')}). Use Download PDF.`, false)
    }
  }

  return (
    <Modal
      title={`Edit details · invoice ${inv.invoice_no}`}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : '✓ Save details'}</button>
        </>
      }
    >
      <ErrorBanner message={err} />
      <p className="muted small">Amounts, dates, party and lines stay as generated. To change those, cancel the invoice and make a new one.</p>
      <div className="form-grid">
        <Field id="ed-doc" label="Document No"><input id="ed-doc" value={docNo} placeholder="Enter Document No" onChange={(e) => setDocNo(e.target.value)} /></Field>
        <Field id="ed-note" label="Text" hint="Printed under the party's address; the PDF is drawn again when it changes.">
          <textarea id="ed-note" rows={2} value={note} placeholder="Enter Text" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field id="ed-remarks" label="Remarks"><textarea id="ed-remarks" rows={2} value={remarks} placeholder="Enter Remarks" onChange={(e) => setRemarks(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- payment */

function RecordPayment({ inv, onClose, onDone }: {
  inv: CommissionInvoiceRow
  onClose: () => void
  onDone: (text: string) => Promise<void> | void
}) {
  const pending = Number(inv.payment_pending)
  const [amount, setAmount] = useState(String(pending))
  const [mode, setMode] = useState<string>(inv.payment_mode ?? '')
  const [paidOn, setPaidOn] = useState(todayIST())
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)

  const amt = num(amount)
  const errors: Record<string, string> = {}
  if (amt === null || amt <= 0) errors.amount = 'Enter an amount above 0.'
  else if (Math.round(amt * 100) !== amt * 100 && Math.abs(Math.round(amt * 100) - amt * 100) > 1e-6) errors.amount = 'At most 2 decimals.'
  else if (amt > pending + 1e-9) errors.amount = `More than the ${money(pending)} pending.`
  if (!mode) errors.mode = 'Choose the mode of payment.'
  if (!paidOn) errors.date = 'The payment date is required.'
  else if (paidOn > todayIST()) errors.date = 'The date cannot be in the future.'
  const show = (k: string) => (submitted ? errors[k] : undefined)

  async function save() {
    setSubmitted(true)
    setErr(null)
    if (Object.keys(errors).length > 0) return setErr('Fix the fields marked in red.')
    setBusy(true)
    const { error } = await supabase.rpc('record_commission_payment', {
      p_invoice: inv.id, p_amount: amt, p_mode: mode, p_paid_on: paidOn, p_reference: reference.trim() || null, p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) { setErr(errMessage(error, 'Could not record the payment')); return }
    await onDone(`Payment of ${money(amt)} recorded against invoice ${inv.invoice_no}.`)
  }

  return (
    <Modal
      title={`Record payment · invoice ${inv.invoice_no}`}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : '✓ Record payment'}</button>
        </>
      }
    >
      <ErrorBanner message={err} />
      <div className="form-grid">
        <ReadOnly label="Net Amount" value={money(inv.net_amount ?? inv.amount)} />
        <ReadOnly label="Payment Collected" value={money(inv.paid_amount)} />
        <ReadOnly label="Payment Pending" value={money(pending)} />
        <Field id="cp-amount" label="Amount received" required error={show('amount')}>
          <input id="cp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="cp-mode" label="Mode of Payment" required error={show('mode')}>
          <select id="cp-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">Select Mode of Payment</option>
            {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field id="cp-date" label="Date received" required error={show('date')}>
          <input id="cp-date" type="date" value={paidOn} max={todayIST()} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field id="cp-ref" label="Reference" hint="UTR, UPI id, cash receipt no.">
          <input id="cp-ref" value={reference} placeholder="Enter Reference" onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field id="cp-note" label="Note">
          <textarea id="cp-note" rows={2} value={note} placeholder="Enter Note" onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

/* ---------------------------------------------------------------- create */

function NewInvoice({ refs, onClose, onCreated }: {
  refs: Refs
  onClose: () => void
  onCreated: (text: string, ok: boolean) => Promise<void> | void
}) {
  const [companyId, setCompanyId] = useState('')
  const [partyType, setPartyType] = useState<PartyType | ''>('')
  const [partyId, setPartyId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [invDate, setInvDate] = useState(todayIST())
  const [basis, setBasis] = useState('')
  const [rate, setRate] = useState('')
  const [lines, setLines] = useState<CandidateLine[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [add, setAdd] = useState('')
  const [deduct, setDeduct] = useState('')
  const [tds, setTds] = useState('')
  const [roundOff, setRoundOff] = useState('')
  const [note, setNote] = useState('')
  const [remarks, setRemarks] = useState('')
  const [docNo, setDocNo] = useState('')
  const [partyOpts, setPartyOpts] = useState<BillableParty[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)

  const parties = partyType === 'supplier' ? refs.suppliers : partyType === 'buyer' ? refs.buyers : []
  const party = parties.find((p) => p.id === partyId)
  const rateNum = num(rate)
  const overrideOk = (basis === '' && rate.trim() === '') || (basis !== '' && rateNum !== null && rateNum >= 0)
  const ready = !!companyId && !!partyType && !!partyId && !!from && !!to && from <= to && overrideOk

  // monday loads the Company list per Business Unit: only parties that still have dispatch lines to bill are offered
  useEffect(() => {
    setPartyOpts(null)
    if (!companyId || !partyType) return
    let stale = false
    void (async () => {
      const manual = basis !== '' && rateNum !== null && rateNum >= 0
      let res = await supabase.rpc('commission_billable_parties', { p_company: companyId, p_party_type: partyType, p_basis: manual ? basis : null, p_value: manual ? rateNum : null })
      // a database that has not been updated yet only knows the two-argument form
      if (res.error && /schema cache|could not find the function/i.test(res.error.message)) res = await supabase.rpc('commission_billable_parties', { p_company: companyId, p_party_type: partyType })
      const { data, error } = res
      if (stale) return
      if (error) { setLoadErr(errMessage(error, 'Could not load the parties')); setPartyOpts([]); return }
      const list = ((data ?? []) as BillableParty[]).map((x) => ({ ...x, lines: Number(x.lines) }))
      setPartyOpts(list)
      setPartyId((cur) => (list.some((x) => x.party_id === cur) ? cur : ''))
    })()
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, partyType, basis, rate])

  // the list follows the filters
  useEffect(() => {
    setLines(null)
    setPicked(new Set())
    setLoadErr(null)
    if (!ready) return
    let stale = false
    void (async () => {
      const { data, error } = await supabase.rpc('commission_candidate_lines', {
        p_company: companyId, p_party_type: partyType, p_party: partyId, p_from: from, p_to: to,
        p_basis: basis === '' ? null : basis, p_value: basis === '' ? null : rateNum,
      })
      if (stale) return
      if (error) { setLoadErr(errMessage(error, 'Could not load the dispatch lines')); setLines([]); return }
      const list = ((data ?? []) as CandidateLine[]).map((x) => ({ ...x, quantity: Number(x.quantity), amount: Number(x.amount) }))
      setLines(list)
      setPicked(new Set(list.map((x) => x.dispatch_id)))
    })()
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, companyId, partyType, partyId, from, to, basis, rate])

  const chosen = (lines ?? []).filter((l) => picked.has(l.dispatch_id))
  const total = chosen.reduce((a, l) => a + l.amount, 0)
  const bags = chosen.reduce((a, l) => a + l.quantity, 0)
  const addN = num(add) ?? 0
  const deductN = num(deduct) ?? 0
  const net = total + addN - deductN

  const errors: Record<string, string> = {}
  if (!companyId) errors.company = 'Choose a Business Unit.'
  if (!partyType) errors.type = 'Choose Buyer or Supplier.'
  if (!partyId) errors.party = `Choose the ${partyType === 'supplier' ? 'supplier' : 'buyer'}.`
  if (!from) errors.from = 'Invoice From date is required.'
  if (!to) errors.to = 'Invoice To date is required.'
  if (from && to && from > to) errors.to = 'The To date cannot be before the From date.'
  if (!overrideOk) errors.rate = basis === '' ? 'Choose the commission type too, or clear the value.' : 'Give a commission value of 0 or more.'
  if (add.trim() !== '' && (num(add) === null || addN < 0)) errors.add = 'Add must be 0 or more.'
  if (deduct.trim() !== '' && (num(deduct) === null || deductN < 0)) errors.deduct = 'Deduct must be 0 or more.'
  if (tds.trim() !== '' && (num(tds) === null || (num(tds) ?? 0) < 0)) errors.tds = 'TDS must be 0 or more.'
  if (roundOff.trim() !== '' && num(roundOff) === null) errors.round = 'Round Off must be a number.'
  const show = (k: string) => (submitted ? errors[k] : undefined)

  function toggle(id: string) {
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  async function create() {
    setSubmitted(true)
    setFormErr(null)
    if (Object.keys(errors).length > 0) return setFormErr('Fix the fields marked in red.')
    if (chosen.length === 0) return setFormErr('Select at least one dispatch line.')
    if (net < 0) return setFormErr('The net amount cannot be negative.')
    setBusy(true)
    const payload = {
      company_id: companyId, party_type: partyType, party_id: partyId, period_from: from, period_to: to, invoice_date: invDate,
      commission_basis: basis === '' ? null : basis, commission_value: basis === '' ? null : rateNum,
      dispatch_ids: chosen.map((l) => l.dispatch_id), add_amount: addN, deduct_amount: deductN, tds_amount: num(tds) ?? 0,
      round_off: num(roundOff) ?? 0, party_note: note.trim() || null, remarks: remarks.trim() || null, document_no: docNo.trim() || null,
    }
    const { data, error } = await supabase.rpc('create_commission_invoice', { p: payload })
    if (error) { setBusy(false); setFormErr(errMessage(error, 'Could not create the invoice')); return }
    const id = data as string
    // the PDF: drawn and stored now; if that fails the invoice still stands and Download PDF tries again
    try {
      const { data: row } = await supabase.from('commission_invoices').select('*').eq('id', id).single()
      const inv = row as CommissionInvoiceRow
      const made = await storePdf(inv, refs)
      saveBlob(made.blob, `invoice_${inv.invoice_no}.pdf`)
      setBusy(false)
      await onCreated(
        made.stored ? `Invoice ${inv.invoice_no} created and its PDF saved.` : `Invoice ${inv.invoice_no} created. The PDF could not be stored (${made.problem}); use Download PDF to make it again.`,
        made.stored,
      )
    } catch (e) {
      setBusy(false)
      await onCreated(`The invoice was created, but its PDF could not be made (${errMessage(e, 'unknown error')}). Use Download PDF from the list.`, false)
    }
  }

  return (
    <Modal
      title="Commission Invoice Creation Form"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" type="button" onClick={() => void create()} disabled={busy}>{busy ? 'Creating…' : '✓ Generate invoice'}</button>
        </>
      }
    >
      <ErrorBanner message={formErr} />
      <div className="form-grid">
        <Field id="ci-date" label="Date" required><input id="ci-date" type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></Field>
        <Field id="ci-from" label="Invoice From Date" required error={show('from')}><input id="ci-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field id="ci-to" label="Invoice To Date" required error={show('to')}><input id="ci-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field id="ci-type" label="Party Type" required error={show('type')}>
          <select id="ci-type" value={partyType} onChange={(e) => { setPartyType(e.target.value as PartyType | ''); setPartyId('') }}>
            <option value="">Select Party Type</option>
            {PARTY_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field id="ci-company" label="Business Unit" required error={show('company')}>
          <select id="ci-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">Select Business Unit</option>
            {refs.companies.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field id="ci-party" label={partyType === 'supplier' ? 'Supplier' : partyType === 'buyer' ? 'Buyer' : 'Company'} required error={show('party')}>
          <select id="ci-party" value={partyId} disabled={!partyType || !companyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">{!partyType ? 'Choose the party type first' : !companyId ? 'Choose the Business Unit first' : partyOpts === null ? 'Loading…' : partyOpts.length === 0 ? 'Nothing left to bill' : `Select ${partyLabel(partyType)}`}</option>
            {(partyOpts ?? []).map((p) => <option key={p.party_id} value={p.party_id}>{p.party_name} ({p.lines} line{p.lines === 1 ? '' : 's'})</option>)}
          </select>
        </Field>
        <ReadOnly label="Address" value={party?.address ?? ''} />
        <Field id="ci-basis" label="Commission Type (manual)" hint="Leave empty to use each line's own commission.">
          <select id="ci-basis" value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option value="">Use the order's terms</option>
            {COMM_BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </Field>
        <Field id="ci-rate" label="Commission Value (manual)" error={show('rate')}>
          <input id="ci-rate" inputMode="decimal" value={rate} placeholder="Enter Commission Value" onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field id="ci-note" label="Text" hint="Printed under the party's address.">
          <textarea id="ci-note" rows={2} value={note} placeholder="Enter Text" onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <h3 style={{ margin: '16px 0 6px' }}>Dispatch lines</h3>
      {loadErr && <div className="alert">{loadErr}</div>}
      {!ready ? (
        <p className="muted small">Choose the Business Unit, party type, party and both dates to list the dispatch lines that can be billed.</p>
      ) : !lines ? (
        <Loading label="Loading dispatch lines" />
      ) : lines.length === 0 ? (
        <p className="muted small">Nothing to bill: no dispatch line of this party in these dates is left without an invoice.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" aria-label="Select all lines" checked={picked.size === lines.length} onChange={() => setPicked(picked.size === lines.length ? new Set() : new Set(lines.map((l) => l.dispatch_id)))} />
                </th>
                <th>SNo</th><th>Order</th><th>{partyType === 'supplier' ? 'Buyer' : 'Mill'}</th><th>Count</th><th>Invoice No.</th><th>Invoice Date</th>
                <th className="right">Quantity</th><th>Commission</th><th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.dispatch_id}>
                  <td><input type="checkbox" aria-label={`Select line ${i + 1}`} checked={picked.has(l.dispatch_id)} onChange={() => toggle(l.dispatch_id)} /></td>
                  <td>{i + 1}</td><td className="mono small">{l.order_no}</td><td>{l.counterparty ?? ''}</td><td>{l.count_label ?? ''}</td>
                  <td className="mono">{l.invoice_no ?? ''}</td><td className="mono small">{l.invoice_date ? formatDate(l.invoice_date) : ''}</td>
                  <td className="right mono">{qtyText(l.quantity)} {l.uom ?? ''}</td><td className="small">{commTerms(l.basis, l.rate)}</td>
                  <td className="right mono">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lines && lines.length > 0 && (
        <>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field id="ci-add" label="Add" error={show('add')}><input id="ci-add" inputMode="decimal" value={add} placeholder="0" onChange={(e) => setAdd(e.target.value)} /></Field>
            <Field id="ci-deduct" label="Deduct" error={show('deduct')}><input id="ci-deduct" inputMode="decimal" value={deduct} placeholder="0" onChange={(e) => setDeduct(e.target.value)} /></Field>
            <ReadOnly label="Total" value={money(total)} />
            <ReadOnly label="Net Amount" value={money(net)} />
            <ReadOnly label="Total Bags" value={qtyText(bags)} />
            <Field id="ci-tds" label="TDS" hint="Recorded and printed; not taken off the net." error={show('tds')}><input id="ci-tds" inputMode="decimal" value={tds} placeholder="0" onChange={(e) => setTds(e.target.value)} /></Field>
            <Field id="ci-round" label="Round Off" error={show('round')}><input id="ci-round" inputMode="decimal" value={roundOff} placeholder="0" onChange={(e) => setRoundOff(e.target.value)} /></Field>
            <Field id="ci-docno" label="Document No"><input id="ci-docno" value={docNo} placeholder="Enter Document No" onChange={(e) => setDocNo(e.target.value)} /></Field>
            <Field id="ci-remarks" label="Remarks"><textarea id="ci-remarks" rows={2} value={remarks} placeholder="Enter Remarks" onChange={(e) => setRemarks(e.target.value)} /></Field>
          </div>
          <p className="small"><strong>{net >= 0 ? amountInWords(net) : ''}</strong></p>
        </>
      )}
    </Modal>
  )
}
