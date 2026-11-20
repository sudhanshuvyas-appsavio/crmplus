/** Sales Confirmation pop-up, arranged like monday's Sales Confirmation Creation Form and built
 *  like the Lead and Deal pop-ups (Pharama ERP conventions): titled group cards in monday's order,
 *  three fields per row, system values read-only ("Assigned on save"), `--None--` for dropdowns.
 *
 *  Groups, as on monday: Sales Confirmation Details, Buyer & Supplier Details, Product
 *  Configurations, Business Configuration, Sizing/Delivery Address Information, Transportation
 *  Company Details, Remarks. (Documents are attached from the details view once it exists.)
 *
 *  Create ("+ New confirmation"): the cards only; "Link to Deals" can instead create the
 *  confirmation from an Approved deal. Update (row Actions > Edit): monday's "Select Item to Update"
 *  card first. The status is changed from the row's Actions menu, not here. A confirmation that has
 *  become a Dispatch and Billing item, or been cancelled, can no longer be changed. One made from a
 *  deal keeps its parties, counts and terms locked (the database enforces it). Saving never insists on
 *  a complete form: an incomplete confirmation is a draft that cannot be sent yet. */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { CountRow, JobProcess, PaymentTerm, Transporter } from '../../api/types'
import { SALE_TYPES, scStage, scGroup } from '../../lib/deals'
import { errMessage, numOrNull } from '../../lib/party'
import { formatDateTime } from '../../lib/format'
import { Modal } from '../Modal'
import { Field, FieldErrorsProvider } from '../PartyForms'
import { ErrorBanner, FormSection, FullWidth } from '../FormKit'
import { CountLinesEditor, emptyLine, linesPayload, lineProblems, toLineForm, type LineForm } from '../CountLines'
import { ScDocuments, uploadScFiles } from './ScDocuments'
import type { Party, ScRow } from './scShared'

type Form = {
  supplier_id: string
  supplier_company_id: string
  buyer_id: string
  buyer_company_id: string
  freight: 'included' | 'excluded'
  payment_term_id: string
  remarks: string
  price_basis: '' | 'ex_mill' | 'net'
  delivery_schedule: string
  special_instructions: string
  sale_type: 'local' | 'export'
  job_process_id: string
  delivery_address: string
  transporter_id: string
  vehicle_no: string
  driver_phone: string
  buyer_comm_basis: string
  buyer_comm_value: string
  supplier_comm_basis: string
  supplier_comm_value: string
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

function toForm(sc: ScRow | null): Form {
  return {
    supplier_id: sc?.supplier_id ?? '',
    supplier_company_id: sc?.supplier_company_id ?? '',
    buyer_id: sc?.buyer_id ?? '',
    buyer_company_id: sc?.buyer_company_id ?? '',
    freight: sc?.freight ?? 'excluded',
    payment_term_id: sc?.payment_term_id ?? '',
    remarks: sc?.remarks ?? '',
    price_basis: sc?.price_basis ?? '',
    delivery_schedule: sc?.delivery_schedule ?? '',
    special_instructions: sc?.special_instructions ?? '',
    sale_type: sc?.sale_type ?? 'local',
    job_process_id: sc?.job_process_id ?? '',
    delivery_address: sc?.delivery_address ?? '',
    transporter_id: sc?.transporter_id ?? '',
    vehicle_no: sc?.vehicle_no ?? '',
    driver_phone: sc?.driver_phone ?? '',
    buyer_comm_basis: sc?.buyer_comm_basis ?? '',
    buyer_comm_value: str(sc?.buyer_comm_value),
    supplier_comm_basis: sc?.supplier_comm_basis ?? '',
    supplier_comm_value: str(sc?.supplier_comm_value),
  }
}

/** The count rows of a confirmation; if it has none, its own (first) count stands in. */
async function loadLines(sc: ScRow): Promise<LineForm[]> {
  const { data } = await supabase.from('sc_lines').select('count_id,quantity,uom,bag_weight,rate').eq('sc_id', sc.id).order('line_no')
  const rows = (data ?? []) as { count_id: string; quantity: number; uom: string; bag_weight: number | null; rate: number | null }[]
  if (rows.length > 0) return rows.map(toLineForm)
  if (sc.count_id && sc.quantity !== null) return [toLineForm({ count_id: sc.count_id, quantity: sc.quantity, uom: sc.uom, bag_weight: sc.bag_weight, rate: sc.rate })]
  return [emptyLine()]
}

export function ScFormModal({
  suppliers, buyers, counts, terms, transporters, jobs, scs, lockedIds, dealNos, initialSc, onClose, onDone,
}: {
  suppliers: Party[]
  buyers: Party[]
  counts: CountRow[]
  terms: PaymentTerm[]
  transporters: Transporter[]
  jobs: JobProcess[]
  /** Every confirmation, for the Select Item to Update search. */
  scs: ScRow[]
  /** Confirmations that can no longer be changed (cancelled, or already a Dispatch and Billing item). */
  lockedIds: Set<string>
  dealNos: Map<string, string>
  /** Opened from a row's Actions > Edit. Absent for a new confirmation. */
  initialSc?: ScRow | null
  onClose: () => void
  onDone: (message: string, openId?: string) => void | Promise<void>
}) {
  const updating = Boolean(initialSc)
  const [recordId, setRecordId] = useState(initialSc?.id ?? '')
  const [recordText, setRecordText] = useState(initialSc ? initialSc.sc_no : '')
  const [f, setF] = useState<Form>(() => toForm(initialSc ?? null))
  const [lines, setLines] = useState<LineForm[]>(() => [emptyLine()])
  const [origLines, setOrigLines] = useState<LineForm[]>(() => [emptyLine()])
  const [dealPick, setDealPick] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [dealOptions, setDealOptions] = useState<{ id: string; deal_no: string }[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editable = useMemo(() => scs.filter((x) => !lockedIds.has(x.id)), [scs, lockedIds])
  const current = scs.find((x) => x.id === recordId) ?? initialSc ?? null
  const locked = !!current?.deal_id // made from a deal: parties, counts and terms are fixed

  useEffect(() => {
    if (updating) return
    void supabase.from('crm_deals').select('id,deal_no').eq('status', 'approved').is('sales_confirmation_id', null).order('deal_no')
      .then(({ data }) => setDealOptions((data ?? []) as { id: string; deal_no: string }[]))
  }, [updating])

  useEffect(() => {
    if (!current) return
    let alive = true
    void loadLines(current).then((l) => { if (alive) { setLines(l); setOrigLines(l) } })
    return () => { alive = false }
  }, [current])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  function chooseRecord(text: string) {
    setRecordText(text)
    const hit = editable.find((x) => x.sc_no === text)
    if (!hit) { setRecordId(''); return }
    setRecordId(hit.id)
    setF(toForm(hit))
    setSubmitted(false)
    setError(null)
  }

  function clearForm() {
    setF(toForm(null))
    setLines([emptyLine()])
    setDealPick('')
    setPendingFiles([])
    setSubmitted(false)
    setError(null)
  }

  // picking a party takes its business unit and commission terms from its master
  function pickParty(side: 'supplier' | 'buyer', id: string) {
    const party = (side === 'supplier' ? suppliers : buyers).find((x) => x.id === id)
    setF((p) => ({
      ...p,
      [`${side}_id`]: id,
      [`${side}_company_id`]: party?.company_id ?? '',
      [`${side}_comm_basis`]: party?.commission_basis ?? '',
      [`${side}_comm_value`]: party?.commission_value == null ? '' : String(party.commission_value),
    }) as Form)
  }
  function pickJob(id: string) {
    const j = jobs.find((x) => x.id === id)
    setF((p) => ({ ...p, job_process_id: id, delivery_address: j ? j.delivery_address || j.office_address || '' : p.delivery_address }))
  }

  const bVal = numOrNull(f.buyer_comm_value)
  const sVal = numOrNull(f.supplier_comm_value)
  const buyerTerms = { basis: f.buyer_comm_basis || null, value: bVal }
  const supplierTerms = { basis: f.supplier_comm_basis || null, value: sVal }

  // what is still missing before it can be sent (not a reason to refuse saving)
  const needed: string[] = []
  if (!f.supplier_id) needed.push('Supplier')
  if (f.supplier_id && !f.supplier_company_id) needed.push('Supplier Business Unit (set it on the supplier in Buyers & Suppliers)')
  if (!f.buyer_id) needed.push('Buyer')
  if (f.buyer_id && !f.buyer_company_id) needed.push('Buyer Business Unit (set it on the buyer in Buyers & Suppliers)')
  // a confirmation may be saved with no count rows yet; once any value is typed the row must be complete
  const noCounts = lines.every((l) => !l.count_id && !l.quantity.trim() && !l.rate.trim() && !l.bag_weight.trim())
  needed.push(...(noCounts ? ['Count and quantity'] : lineProblems(lines, true)))
  const partialRows = noCounts ? [] : lineProblems(lines).filter((x) => !x.startsWith('Final rate'))
  const phoneBad = f.driver_phone.trim() !== '' && !/^[0-9+ -]{6,20}$/.test(f.driver_phone.trim())
  const errors: Record<string, string> = {}
  if (updating && !recordId) errors['sc-record'] = 'Choose the confirmation to update.'
  if (phoneBad) errors['sc-drv'] = 'Digits only (6 to 20 characters).'
  // monday's required fields: Buyer, Supplier and the count rows. A confirmation made from a deal takes them from the deal.
  const enforce = !dealPick && !locked
  if (enforce && (!updating || recordId)) {
    if (!f.buyer_id) errors['sc-buyer'] = 'Choose a buyer.'
    if (!f.supplier_id) errors['sc-supplier'] = 'Choose a supplier.'
  }
  const countProblems = enforce && (!updating || recordId) ? lineProblems(lines, true).filter((x) => !x.startsWith('Final rate')) : []
  const visible = submitted || phoneBad ? errors : {}

  async function save() {
    setSubmitted(true)
    setError(null)
    if (Object.keys(errors).length > 0) {
      setError(`${Object.keys(errors).length === 1 ? 'One field needs' : `${Object.keys(errors).length} fields need`} attention. Check the fields marked in red.`)
      return
    }
    if (countProblems.length > 0) {
      setError(`Product Configurations is required: ${countProblems.join(', ')}.`)
      return
    }
    if (!dealPick && partialRows.length > 0 && !locked) {
      setError(`Finish the count rows first: ${partialRows.join(', ')}.`)
      return
    }
    // "Link to Deals": make it from the Approved deal instead of by hand
    if (!updating && dealPick) {
      setBusy(true)
      const made = await supabase.rpc('confirm_deal', { p_deal: dealPick })
      if (made.error) {
        setBusy(false)
        setError(errMessage(made.error, 'Could not create it from the deal'))
        return
      }
      const { data: row } = await supabase.from('sales_confirmations').select('sc_no').eq('id', made.data as string).maybeSingle()
      setBusy(false)
      await onDone(`${(row as { sc_no: string } | null)?.sc_no ?? 'Sales Confirmation'} created from the deal.`, made.data as string)
      return
    }
    setBusy(true)
    const sc = current
    const editableFields: Record<string, unknown> = {
      freight: f.freight,
      price_basis: f.price_basis || null,
      delivery_schedule: f.delivery_schedule.trim() || null,
      special_instructions: f.special_instructions.trim() || null,
      remarks: f.remarks.trim() || null,
      sale_type: f.sale_type,
      job_process_id: f.job_process_id || null,
      delivery_address: f.delivery_address.trim() || null,
      transporter_id: f.transporter_id || null,
      vehicle_no: f.vehicle_no.trim() || null,
      driver_phone: f.driver_phone.trim() || null,
    }
    const payload = locked ? editableFields : {
      ...editableFields,
      supplier_id: f.supplier_id || null,
      supplier_company_id: f.supplier_company_id || null,
      buyer_id: f.buyer_id || null,
      buyer_company_id: f.buyer_company_id || null,
      payment_term_id: f.payment_term_id || null,
      // blank on a new manual confirmation: the database takes each party's master terms
      ...(sc || f.buyer_comm_basis ? { buyer_comm_basis: f.buyer_comm_basis || null, buyer_comm_value: f.buyer_comm_basis ? bVal : null } : {}),
      ...(sc || f.supplier_comm_basis ? { supplier_comm_basis: f.supplier_comm_basis || null, supplier_comm_value: f.supplier_comm_basis ? sVal : null } : {}),
    }
    if (!sc && !noCounts) {
      // a new confirmation starts from its first row; save_sc_lines then stores every row
      const [first] = linesPayload(lines.slice(0, 1), 'rate')
      Object.assign(payload, first, { net_quantity: first?.quantity ?? null })
    }
    const { data, error: saveError } = sc
      ? await supabase.from('sales_confirmations').update(payload).eq('id', sc.id).select('id, sc_no, status')
      : await supabase.from('sales_confirmations').insert(payload).select('id, sc_no, status')
    if (saveError) {
      setBusy(false)
      setError(errMessage(saveError, 'Could not save this confirmation'))
      return
    }
    const row = data?.[0] as { id: string; sc_no: string; status: string } | undefined
    if (!row) {
      setBusy(false)
      setError('Your account cannot change this confirmation.')
      return
    }
    if (!locked && !noCounts && (!sc || JSON.stringify(lines) !== JSON.stringify(origLines))) {
      const ln = await supabase.rpc('save_sc_lines', { p_sc: row.id, p_lines: linesPayload(lines, 'rate') })
      if (ln.error) {
        setBusy(false)
        setError(errMessage(ln.error, 'Saved, but the counts could not be saved'))
        return
      }
      const again = await supabase.from('sales_confirmations').select('status').eq('id', row.id).maybeSingle()
      if (again.data) row.status = (again.data as { status: string }).status
    }
    // files chosen in the form are attached now that the confirmation exists
    const fileProblems = !sc && pendingFiles.length > 0 ? await uploadScFiles(row.id, 'buyer', pendingFiles) : []
    setBusy(false)
    const ready = row.status === 'confirmed'
    await onDone(
      `${row.sc_no} ${sc ? 'updated' : 'created'}.${ready ? '' : ' It is still incomplete: fill in every required field to send it.'}${fileProblems.length > 0 ? ` Not attached: ${fileProblems.join('; ')}.` : ''}`,
      row.id,
    )
  }

  const show = !updating || recordId
  const partyOptions = (list: Party[], cur: string) =>
    list.filter((x) => x.is_active || x.id === cur).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))
  const stage = current ? scStage(scGroup(current)).label : 'Draft'

  return (
    <Modal
      title={updating ? 'Update Sales Confirmation' : 'New Sales Confirmation'}
      description={updating ? 'Choose the confirmation, then change what you need. It keeps its number and creation date.' : 'Required fields are marked.'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Close</button>
          <span style={{ display: 'flex', gap: 10 }}>
            {!updating && <button className="btn ghost" type="button" onClick={clearForm} disabled={busy}>Clear Form</button>}
            <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : updating ? 'Update Confirmation' : dealPick ? 'Create from Deal' : 'Create Confirmation'}
            </button>
          </span>
        </>
      }
    >
      <ErrorBanner message={error} />

      {updating && (
        <FieldErrorsProvider value={visible}>
          <section className="fs-card" aria-label="Select Item to Update">
            <header className="fs-head"><div><h3>Select Item to Update:</h3></div></header>
            <div className="fs-body">
              <Field id="sc-record" label="Search for a record">
                <input id="sc-record" list="sc-record-list" placeholder="-- Search for a record --" value={recordText} onChange={(e) => chooseRecord(e.target.value)} style={{ maxWidth: 520 }} />
                <datalist id="sc-record-list">
                  {editable.map((x) => (<option key={x.id} value={x.sc_no} />))}
                </datalist>
              </Field>
            </div>
          </section>
        </FieldErrorsProvider>
      )}

      {show && (
        <FieldErrorsProvider value={visible}>
          {locked && (
            <div className="notice small" style={{ marginBottom: 12 }}>
              Created from a deal: parties, counts, payment terms and commission are locked. Freight, delivery, transport and remarks can change.
            </div>
          )}

          <FormSection title="Sales Confirmation Details" collapsible columns={3}>
            <Field id="sc-name" label="Name">
              <input id="sc-name" readOnly value={current?.sc_no ?? ''} placeholder="Assigned on save" title="The confirmation number is its name." />
            </Field>
            <Field id="sc-created" label="Created Date">
              <input id="sc-created" readOnly value={current ? formatDateTime(current.confirmed_at) : ''} placeholder="Assigned on save" />
            </Field>
            <Field id="sc-type" label="Type" required>
              <select id="sc-type" value={f.sale_type} onChange={(e) => set('sale_type', e.target.value as Form['sale_type'])}>
                {SALE_TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
              </select>
            </Field>
            <Field id="sc-status" label="Status">
              <input id="sc-status" readOnly value={stage} title="Change the status from the row's Actions menu." />
            </Field>
            <Field id="sc-link" label="Link to Deals">
              {updating ? (
                <input id="sc-link" readOnly value={current?.deal_id ? dealNos.get(current.deal_id) ?? '' : ''} placeholder="Not linked" />
              ) : (
                <select id="sc-link" value={dealPick} title="Fills everything from an Approved deal that has no confirmation yet." onChange={(e) => setDealPick(e.target.value)}>
                  <option value="">--None--</option>
                  {dealOptions.map((d) => (<option key={d.id} value={d.id}>{d.deal_no}</option>))}
                </select>
              )}
            </Field>
            <Field id="sc-freight" label="Freight">
              <select id="sc-freight" value={f.freight} onChange={(e) => set('freight', e.target.value as Form['freight'])}>
                <option value="excluded">Excluded</option>
                <option value="included">Included</option>
              </select>
            </Field>
            <FullWidth>
              <Field id="sc-sched" label="Delivery Schedule">
                <textarea id="sc-sched" rows={2} placeholder="Enter Delivery Schedule" value={f.delivery_schedule} onChange={(e) => set('delivery_schedule', e.target.value)} />
              </Field>
            </FullWidth>
          </FormSection>

          {!dealPick && (
            <>
              <FormSection title="Buyer & Supplier Details" collapsible columns={3}>
                <Field id="sc-buyer" label="Buyer" required>
                  <select id="sc-buyer" value={f.buyer_id} disabled={locked} onChange={(e) => pickParty('buyer', e.target.value)}>
                    <option value="">--None--</option>
                    {partyOptions(buyers, f.buyer_id)}
                  </select>
                </Field>
                <Field id="sc-supplier" label="Supplier" required>
                  <select id="sc-supplier" value={f.supplier_id} disabled={locked} onChange={(e) => pickParty('supplier', e.target.value)}>
                    <option value="">--None--</option>
                    {partyOptions(suppliers, f.supplier_id)}
                  </select>
                </Field>
              </FormSection>

              <FormSection title="Product Configurations" collapsible columns={3}>
                <FullWidth>
                  <CountLinesEditor lines={lines} onChange={setLines} counts={counts} disabled={locked} buyer={buyerTerms} supplier={supplierTerms} />
                </FullWidth>
              </FormSection>

              <FormSection title="Business Configuration" collapsible columns={3}>
                <Field id="sc-term" label="Payment Terms">
                  <select id="sc-term" value={f.payment_term_id} disabled={locked} onChange={(e) => set('payment_term_id', e.target.value)}>
                    <option value="">--None--</option>
                    {terms.filter((t) => t.is_active || t.id === f.payment_term_id).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                  </select>
                </Field>
              </FormSection>

              <FormSection title="Sizing/Delivery Address Information" collapsible columns={3}>
                <Field id="sc-job" label="Sizing/Delivery Address">
                  <select id="sc-job" value={f.job_process_id} title="--None-- means the buyer's own address." onChange={(e) => pickJob(e.target.value)}>
                    <option value="">--None--</option>
                    {jobs.filter((j) => j.is_active || j.id === f.job_process_id).map((j) => (<option key={j.id} value={j.id}>{j.name}</option>))}
                  </select>
                </Field>
              </FormSection>

              <FormSection title="Transportation Company Details" collapsible columns={3}>
                <Field id="sc-tr" label="Transporter Name">
                  <select id="sc-tr" value={f.transporter_id} onChange={(e) => set('transporter_id', e.target.value)}>
                    <option value="">--None--</option>
                    {transporters.filter((t) => t.is_active || t.id === f.transporter_id).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                  </select>
                </Field>
                <Field id="sc-drv" label="Driver Contact Phone">
                  <input id="sc-drv" inputMode="tel" placeholder="Driver Contact Phone number" value={f.driver_phone} onChange={(e) => set('driver_phone', e.target.value)} />
                </Field>
                <Field id="sc-veh" label="Vehicle Number">
                  <input id="sc-veh" className="mono" placeholder="Enter Vehicle Number" value={f.vehicle_no} onChange={(e) => set('vehicle_no', e.target.value.toUpperCase())} />
                </Field>
              </FormSection>

              <FormSection title="Remarks" collapsible columns={3}>
                <FullWidth>
                  <Field id="sc-remarks" label="Remarks">
                    <textarea id="sc-remarks" rows={2} placeholder="Enter Remarks" value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
                  </Field>
                </FullWidth>
              </FormSection>

              <FormSection title="Documents" collapsible columns={3}>
                <FullWidth>
                  <Field id="sc-docs" label="Buyer Document">
                    {updating ? (
                      recordId ? <ScDocuments scId={recordId} kind="buyer" canEdit /> : null
                    ) : (
                      <div>
                        {pendingFiles.length > 0 && (
                          <ul className="history">
                            {pendingFiles.map((file, i) => (
                              <li key={`${file.name}-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <span>{file.name}</span>
                                <span className="muted small">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                                <button className="btn ghost sm push" type="button" onClick={() => setPendingFiles(pendingFiles.filter((_, j) => j !== i))}>Remove</button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {pendingFiles.length < 10 && (
                          <label className="btn sm" title="The files are attached when the confirmation is created.">
                            Attach files <span className="muted">({pendingFiles.length}/10)</span>
                            <input id="sc-docs" type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) setPendingFiles([...pendingFiles, ...Array.from(e.target.files)].slice(0, 10)); e.target.value = '' }} />
                          </label>
                        )}
                      </div>
                    )}
                  </Field>
                </FullWidth>
              </FormSection>

              {needed.length > 0 && (
                <p className="field-hint">Still needed before it can be sent: {needed.join(', ')}.</p>
              )}
            </>
          )}
        </FieldErrorsProvider>
      )}
    </Modal>
  )
}
