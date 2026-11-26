/** "PDF Generation and Merge" tab of the Sales Confirmation board (monday's app of the same name), in this app's
 *  board look: the same grouped table, toolbar and Columns menu as the Main table. Tick confirmations, then use
 *  Generate PDF in the toolbar (or a row's Actions for one confirmation): their Buyer / Supplier Sale Confirmation Letters (saved to the confirmation's Buyer
 *  Document / Supplier Document), or one Supplier letter per supplier for all of them. Confirmations that already
 *  have both documents are hidden until "Show uploaded" is on. Only confirmations in Send with Delivery Info are listed:
 *  letters and merging start from that stage. Merge to Dispatch records one dispatch (one truck, one mill invoice) across
 *  the items of ticked confirmations that have the same buyer and the same supplier. */
import { useMemo, useState } from 'react'
import type { ScRow } from './scShared'
import { ScDocIcons, type ScDocLite } from './ScDocIcons'
import { Board, StatusPill, type BoardColumn } from '../board/Board'
import { useSelection } from '../ListTools'
import { RowActionMenu } from '../RowActionMenu'
import { SC_GROUPS, scGroup, scStage, uomLabel, inr } from '../../lib/deals'
import { formatShortDate } from '../../lib/format'
import { makeLetters, type LetterKind } from '../../lib/scLetters'
import { MergeDispatchDialog } from './MergeDispatchDialog'

type Line = { sc_id: string; count_id: string; quantity: number; uom: string }

const dash = <span className="muted">—</span>
const text = (v: string | null | undefined, opts: { mono?: boolean; clip?: boolean } = {}) =>
  v ? <span className={[opts.mono ? 'mono' : '', opts.clip ? 'clip' : ''].filter(Boolean).join(' ') || undefined} title={opts.clip ? v : undefined}>{v}</span> : dash


export function ScPdfTab({
  rows, lines, countName, transporterName, jobName, termName, buyerName, supplierName, docs, canManage, onDone,
}: {
  rows: ScRow[]
  lines: Map<string, Line[]>
  countName: Map<string, string>
  transporterName: Map<string, string>
  jobName: Map<string, string>
  termName: Map<string, string>
  buyerName: Map<string, string>
  supplierName: Map<string, string>
  docs: Map<string, ScDocLite[]>
  canManage: boolean
  onDone: () => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [showUploaded, setShowUploaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ done: string[]; problems: string[]; merge?: boolean } | null>(null)

  const docsOf = (id: string, kind: 'buyer' | 'supplier') => (docs.get(id) ?? []).filter((d) => d.kind === kind)
  const uploaded = (x: ScRow) => docsOf(x.id, 'buyer').length > 0 && docsOf(x.id, 'supplier').length > 0
  // letters and merging are only for confirmations in Send with Delivery Info
  const live = useMemo(() => rows.filter((x) => x.status !== 'cancelled' && x.stage === 'send_delivery'), [rows])
  const uploadedCount = live.filter(uploaded).length
  const countsOf = (x: ScRow) => (lines.get(x.id) ?? []).map((l) => countName.get(l.count_id) ?? '').filter(Boolean)
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return live.filter((x) =>
      (showUploaded || !uploaded(x)) &&
      (!q || [x.sc_no, buyerName.get(x.buyer_id ?? ''), supplierName.get(x.supplier_id ?? ''), x.vehicle_no, ...countsOf(x)]
        .some((v) => (v ?? '').toLowerCase().includes(q))))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, search, showUploaded, docs, buyerName, supplierName, lines, countName])
  const selection = useSelection(useMemo(() => shown.map((x) => x.id), [shown]))
  const chosen = selection.chosen.length
  const [merging, setMerging] = useState(false)
  const picked = rows.filter((x) => selection.chosen.includes(x.id))
  const sameParties = picked.length > 0 && picked.every((x) => x.buyer_id === picked[0]!.buyer_id && x.supplier_id === picked[0]!.supplier_id)
  const mergeBlock = busy ? 'Wait for the letters to finish.'
    : chosen < 2 ? 'Tick two or more confirmations with the same buyer and supplier.'
    : picked.some((x) => !x.buyer_id || !x.supplier_id) ? 'Every ticked confirmation needs a buyer and a supplier.'
    : !sameParties ? 'Ticked confirmations must have the same buyer and the same supplier.'
    : null

  async function run(kind: LetterKind | 'both', label: string, only?: string[]) {
    const ids = only ?? selection.chosen
    if (!ids.length) return
    setResult(null)
    setBusy(label)
    const kinds: LetterKind[] = kind === 'both' ? ['buyer', 'supplier'] : [kind]
    const all = { done: [] as string[], problems: [] as string[] }
    for (const k of kinds) {
      const r = await makeLetters(k, ids)
      all.done.push(...r.done); all.problems.push(...r.problems)
    }
    setBusy(null)
    setResult(all)
    if (!only) selection.clear()
    await onDone()
  }

  const summary = (x: ScRow) => (lines.get(x.id) ?? []).map((l) => `${inr(l.quantity)} ${uomLabel(l.uom)} ${countName.get(l.count_id) ?? ''}`.trim()).join('; ')
  const columns: BoardColumn<ScRow>[] = [
    { key: 'no', label: 'Item Name', width: 200, render: (x) => <span className="mono">{x.sc_no}</span> },
    { key: 'stage', label: 'Status', width: 190, render: (x) => { const st = scStage(scGroup(x)); return <StatusPill label={st.label} tone={st.tone} /> } },
    { key: 'created', label: 'Created Date', width: 120, render: (x) => text(formatShortDate(x.confirmed_at)) },
    { key: 'confirmed', label: 'Confirmation Date', width: 140, render: (x) => (x.stage !== 'draft' ? text(formatShortDate(x.stage_changed_at ?? x.confirmed_at)) : dash) },
    { key: 'buyer', label: 'Buyer', width: 170, render: (x) => text(x.buyer_id ? buyerName.get(x.buyer_id) : null, { clip: true }) },
    { key: 'supplier', label: 'Supplier', width: 170, render: (x) => <strong>{x.supplier_id ? supplierName.get(x.supplier_id) ?? '—' : '—'}</strong> },
    { key: 'counts', label: 'Counts', width: 220, render: (x) => text(countsOf(x).join(', '), { clip: true }) },
    { key: 'transporter', label: 'Transport Company', width: 170, render: (x) => text(x.transporter_id ? transporterName.get(x.transporter_id) : null, { clip: true }) },
    { key: 'vehicle', label: 'Vehicle Number', width: 140, render: (x) => text(x.vehicle_no, { mono: true }) },
    { key: 'delivery', hidden: true, label: 'Delivery', width: 180, render: (x) => text(x.job_process_id ? jobName.get(x.job_process_id) : x.delivery_address, { clip: true }) },
    { key: 'terms', hidden: true, label: 'Payment Terms', width: 150, render: (x) => text(x.payment_term_id ? termName.get(x.payment_term_id) : null) },
    { key: 'freight', hidden: true, label: 'Freight', width: 110, render: (x) => text(x.freight === 'included' ? 'Included' : 'Excluded') },
    { key: 'remarks', hidden: true, label: 'Remarks', width: 180, render: (x) => text(x.remarks, { clip: true }) },
    { key: 'summary', hidden: true, label: 'Summary', width: 260, render: (x) => text(summary(x), { clip: true }) },
    { key: 'bdoc', label: 'Buyer Document', width: 140, interactive: true, render: (x) => <ScDocIcons docs={docsOf(x.id, 'buyer')} /> },
    { key: 'sdoc', label: 'Supplier Document', width: 150, interactive: true, render: (x) => <ScDocIcons docs={docsOf(x.id, 'supplier')} /> },
    ...(canManage ? [{ key: 'action', label: 'Actions', interactive: true, pinRight: true, render: (x: ScRow) => (
      <RowActionMenu label={x.sc_no} busy={busy !== null} actions={[
        { label: 'Make buyer letter', onSelect: () => void run('buyer', `Making the Buyer letter of ${x.sc_no}`, [x.id]) },
        { label: 'Make supplier letter', onSelect: () => void run('supplier', `Making the Supplier letter of ${x.sc_no}`, [x.id]) },
        { label: 'Make both letters', onSelect: () => void run('both', `Making both letters of ${x.sc_no}`, [x.id]) },
      ]} />
    ) } as BoardColumn<ScRow>] : []),
  ]
  const groups = SC_GROUPS.filter((g) => g.value === 'send_delivery')

  return (
    <div className="pdf-tab">
      <div className="board-toolbar">
        <input className="toolbar-search" aria-label="Search confirmations" placeholder="Search no., buyer, supplier, count, vehicle" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="toggle-chip" title="Confirmations that already have both their Buyer and Supplier documents">
          <input type="checkbox" checked={showUploaded} onChange={(e) => setShowUploaded(e.target.checked)} />
          Show uploaded <span className="toggle-count">{uploadedCount}</span>
        </label>
        <span className="push" />
        {canManage && (
          <span className="pick-info" aria-live="polite">
            {chosen > 0
              ? <><strong>{chosen}</strong> selected<button className="link-btn" type="button" onClick={selection.clear}>Clear</button></>
              : shown.length > 0 && <button className="link-btn" type="button" onClick={selection.toggleAll}>Select all {shown.length}</button>}
          </span>
        )}
        {canManage && (
          <RowActionMenu
            label="Generate PDF"
            text={busy ? 'Making…' : 'Generate PDF'}
            buttonClass="btn primary menu-btn"
            below
            busy={busy !== null}
            disabledReason={chosen === 0 && !busy ? 'Tick one or more confirmations first.' : null}
            actions={[
              { label: 'Buyer letter', onSelect: () => void run('buyer', 'Making Buyer letters') },
              { label: 'Supplier letter', onSelect: () => void run('supplier', 'Making Supplier letters') },
              { label: 'Buyer and Supplier letters', onSelect: () => void run('both', 'Making Buyer and Supplier letters') },
              { label: 'Group by supplier', hint: 'One Supplier letter covering every ticked confirmation of the same supplier', onSelect: () => void run('group', 'Making one Supplier letter per supplier') },
            ]}
          />
        )}
        {canManage && (
          <button className="btn" type="button" disabled={mergeBlock !== null} title={mergeBlock ?? 'One dispatch for the items of the ticked confirmations'} onClick={() => setMerging(true)}>Merge to Dispatch</button>
        )}
        <div className="board-cols-slot" />
      </div>

      {busy && <div className="notice" role="status"><span className="spinner-inline" aria-hidden="true" />{busy}…</div>}
      {result && (
        <div className={result.problems.length ? 'alert' : 'notice'} role="status">
          {result.done.length > 0 && (result.merge
            ? <div>{result.done[0]}</div>
            : <div>{result.done.length} letter{result.done.length === 1 ? '' : 's'} saved: {result.done.join('; ')}.</div>)}
          {result.problems.length > 0 && <div>Not made: {result.problems.join('; ')}.</div>}
          <button className="btn ghost sm" type="button" onClick={() => setResult(null)}>Dismiss</button>
        </div>
      )}

      {merging && picked.length > 0 && (
        <MergeDispatchDialog
          scs={picked}
          countName={countName}
          buyer={buyerName.get(picked[0]!.buyer_id ?? '') ?? 'the buyer'}
          supplier={supplierName.get(picked[0]!.supplier_id ?? '') ?? 'the supplier'}
          onClose={() => setMerging(false)}
          onDone={async (text) => { setMerging(false); selection.clear(); setResult({ done: [text], problems: [], merge: true }); await onDone() }}
        />
      )}

      <Board
        rows={shown}
        groups={groups}
        groupOf={scGroup}
        columns={columns}
        rowKey={(x) => x.id}
        viewKey="sc-pdf"
        onOpen={() => {}}
        rowOpens={false}
        view="table"
        selection={canManage ? selection : undefined}
        emptyText={live.length === 0 ? 'No confirmation is in Send with Delivery Info yet. Letters and merging start from that stage.' : !showUploaded && uploadedCount > 0 && shown.length === 0 ? 'Every confirmation here has its Buyer and Supplier documents. Turn on Show uploaded to see them.' : 'No confirmation matches.'}
        card={() => null}
      />
    </div>
  )
}
