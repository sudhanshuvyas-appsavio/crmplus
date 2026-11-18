/** Register of cheques collected by the field team: who has them, which are
 *  waiting to be banked, and how each one ended (cleared or bounced).
 *
 *  The database guard decides the status rules (a deposit needs a bank and a
 *  slip number, a photo marks a cheque collected); this screen shows its
 *  refusals as they are. */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { Loading } from '../../components/Loading'
import { GridPager, GridToolbar, usePaging } from '../../components/GridKit'
import { Modal } from '../../components/Modal'
import { Field } from '../../components/PartyForms'
import { RowActionMenu, type RowAction } from '../../components/RowActionMenu'
import { StatusPill } from '../../components/StatusPill'
import { pushToast } from '../../components/Toast'
import { downloadCSV, toCSV } from '../../lib/csv'
import { formatDate } from '../../lib/format'
import { errMessage } from '../../lib/party'
import { CHEQUE_STATUS_OPTIONS, CHEQUE_STATUS_TONE, formatMoney, todayIST } from '../../lib/tasks'
import { boardFor } from '../../lib/taskBoards'
import { signedProofUrl, useProfileNameMap } from '../../lib/taskData'
import type { TaskCheque } from '../../api/types'
import { ChequeForm } from './ChequeForm'
import '../../styles/tasks-detail.css'
import '../../styles/cheque-board.css'

type ChequeRow = TaskCheque & { buyer: { name: string } | null }

const BOARD = boardFor('cheques')
const COLUMNS = BOARD?.columns ?? []
const GROUPS = BOARD?.groups ?? [
  { key: 'to_collect', label: 'To Collect' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'collected', label: 'Collected' },
]

/** Monday's group for a cheque: pending / collected, deposited or bounced / cleared. */
function groupOf(c: TaskCheque): number {
  if (c.status === 'pending') return 0
  if (c.status === 'cleared') return 2
  return 1
}

interface LinkedTask {
  id: string
  lat: number | null
  lng: number | null
  accounts_staff_id: string | null
}

const mapUrl = (t: LinkedTask | undefined) => (t && t.lat != null && t.lng != null ? `https://www.google.com/maps?q=${t.lat},${t.lng}` : null)

type Dialog =
  | { kind: 'form'; cheque: TaskCheque | null }
  | { kind: 'deposit'; cheque: ChequeRow }
  | { kind: 'confirm'; cheque: ChequeRow; action: 'bounced' | 'delete' }
  | null

const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000))

export function ChequeQueue() {
  const { me, can } = useAuth()
  const canManage = can('task.manage')
  const canWork = can('task.work')
  const names = useProfileNameMap()
  const today = todayIST()

  const [rows, setRows] = useState<ChequeRow[] | null>(null)
  const [linked, setLinked] = useState<Record<string, LinkedTask>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({ status: '', by: '', buyer: '' })

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('task_cheques')
      .select('*, buyer:buyer_master(name)')
      .order('collection_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) {
      setLoadError(errMessage(error, 'Could not load cheques'))
      setRows([])
      return
    }
    setLoadError(null)
    setRows((data ?? []) as ChequeRow[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const closeDialog = useCallback(() => setDialog(null), [])

  const canChange = useCallback(
    (c: TaskCheque) => canManage || (canWork && c.collected_by === me?.id),
    [canManage, canWork, me?.id],
  )

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? [])
      .filter(
        (c) =>
          (!q ||
            [c.cheque_no, c.invoice_no, c.bank_name, c.buyer?.name, c.slip_no, c.deposit_bank, c.notes].some((v) =>
              (v ?? '').toLowerCase().includes(q),
            )) &&
          (!filters.status || c.status === filters.status) &&
          (!filters.by || c.collected_by === filters.by) &&
          (!filters.buyer || c.buyer_id === filters.buyer),
      )
      .sort((a, b) => groupOf(a) - groupOf(b))
  }, [rows, search, filters])

  const paging = usePaging(shown, `${search}|${filters.status}|${filters.by}|${filters.buyer}`)

  // The linked tasks' accounts person and check-in position, for the visible page only.
  const visibleKey = paging.visible
    .map((c) => c.task_id)
    .filter((v): v is string => Boolean(v))
    .join(',')
  useEffect(() => {
    if (!visibleKey) return
    let live = true
    void supabase
      .from('tasks')
      .select('id,lat,lng,accounts_staff_id')
      .in('id', visibleKey.split(','))
      .then(({ data }) => {
        if (!live || !data) return
        setLinked((prev) => ({ ...prev, ...Object.fromEntries((data as LinkedTask[]).map((t) => [t.id, t])) }))
      })
    return () => {
      live = false
    }
  }, [visibleKey, rows])

  async function openPhoto(path: string) {
    const url = await signedProofUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
    else pushToast('error', 'Could not open the photo.')
  }

  const subtitle = useMemo(() => {
    const waiting = (rows ?? []).filter((c) => c.status === 'pending' || c.status === 'collected')
    if (waiting.length === 0) return 'No cheques waiting to be deposited'
    const total = waiting.reduce((sum, c) => sum + Number(c.amount), 0)
    const oldest = Math.max(...waiting.map((c) => daysBetween(c.collection_date, today)))
    return `${waiting.length} awaiting deposit · ${formatMoney(total)} · oldest ${oldest} ${oldest === 1 ? 'day' : 'days'}`
  }, [rows, today])

  const filterDefs = useMemo(() => {
    const byIds = [...new Set((rows ?? []).map((c) => c.collected_by).filter((v): v is string => Boolean(v)))]
    const buyers = new Map<string, string>()
    for (const c of rows ?? []) if (c.buyer_id && c.buyer) buyers.set(c.buyer_id, c.buyer.name)
    return [
      { name: 'status', label: 'Status', allLabel: 'All statuses', options: CHEQUE_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })) },
      {
        name: 'by',
        label: 'Collected by',
        allLabel: 'Anyone',
        options: byIds.map((id) => ({ value: id, label: names[id] ?? 'Unknown' })).sort((a, b) => a.label.localeCompare(b.label)),
      },
      {
        name: 'buyer',
        label: 'Buyer',
        allLabel: 'All buyers',
        options: [...buyers].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
      },
    ]
  }, [rows, names])

  /** Applies a change to one cheque; the database says whether it is allowed. */
  async function change(c: ChequeRow, patch: Record<string, unknown>, done: string): Promise<boolean> {
    setBusyId(c.id)
    const { data, error } = await supabase.from('task_cheques').update(patch).eq('id', c.id).select('id')
    setBusyId(null)
    if (error) {
      pushToast('error', errMessage(error, 'Could not update the cheque'))
      return false
    }
    if (!data || data.length === 0) {
      pushToast('error', 'Your account cannot change this cheque.')
      return false
    }
    pushToast('success', done)
    await load()
    return true
  }

  async function remove(c: ChequeRow) {
    setBusyId(c.id)
    const { data, error } = await supabase.from('task_cheques').delete().eq('id', c.id).select('id')
    setBusyId(null)
    if (error) return pushToast('error', errMessage(error, 'Could not delete the cheque'))
    if (!data || data.length === 0) return pushToast('error', 'Your account cannot delete this cheque.')
    pushToast('success', `Cheque ${c.cheque_no} deleted.`)
    await load()
  }

  function exportCSV() {
    const cols = COLUMNS.filter((col) => col.key !== 'actions')
    const flat = shown.map((c) => {
      const t = c.task_id ? linked[c.task_id] : undefined
      const cells: Record<string, string> = {
        name: `${c.cheque_no}${c.buyer?.name ? ` - ${c.buyer.name}` : ''}`,
        accounts: t?.accounts_staff_id ? (names[t.accounts_staff_id] ?? '') : '',
        person: c.collected_by ? (names[c.collected_by] ?? '') : '',
        buyer: c.buyer?.name ?? '',
        invoice_no: c.invoice_no ?? '',
        cheque_no: c.cheque_no,
        cheque_bank: c.bank_name ?? '',
        cheque_date: c.cheque_date ?? '',
        cheque_amount: String(c.amount),
        proof: c.photo_path ? 'yes' : 'no',
        deposit_status: CHEQUE_STATUS_OPTIONS.find((o) => o.value === c.status)?.label ?? c.status,
        cheque_notes: c.notes ?? '',
        gps: mapUrl(t) ?? '',
      }
      return Object.fromEntries(cols.map((col) => [col.label, cells[col.key] ?? '']))
    })
    downloadCSV(`cheques-${today}.csv`, toCSV(cols.map((col) => col.label), flat))
  }

  function actionsFor(c: ChequeRow): RowAction[] {
    const editable = canChange(c)
    const reason = editable ? null : 'Not your cheque'
    const notDeposited = c.status === 'pending' || c.status === 'collected'
    const list: RowAction[] = [
      { label: 'Edit', onSelect: () => setDialog({ kind: 'form', cheque: c }), disabledReason: reason },
      {
        label: 'Mark deposited',
        onSelect: () => setDialog({ kind: 'deposit', cheque: c }),
        disabledReason: reason ?? (notDeposited ? null : 'Already deposited'),
      },
      {
        label: 'Mark cleared',
        onSelect: () => void change(c, { status: 'cleared' }, `Cheque ${c.cheque_no} cleared.`),
        disabledReason: reason ?? (c.status === 'deposited' ? null : c.status === 'cleared' ? 'Already cleared' : 'Deposit it first'),
      },
      {
        label: 'Mark bounced',
        onSelect: () => setDialog({ kind: 'confirm', cheque: c, action: 'bounced' }),
        tone: 'danger',
        disabledReason: reason ?? (c.status === 'deposited' || c.status === 'cleared' ? null : c.status === 'bounced' ? 'Already bounced' : 'Deposit it first'),
      },
    ]
    if (canManage) list.push({ label: 'Delete', onSelect: () => setDialog({ kind: 'confirm', cheque: c, action: 'delete' }), tone: 'danger' })
    return list
  }

  const dash = <span className="muted">—</span>

  function cell(key: string, c: ChequeRow) {
    const t = c.task_id ? linked[c.task_id] : undefined
    switch (key) {
      case 'name':
        return (
          <td key={key} className="left">
            <strong className="mono">{c.cheque_no}</strong>
            {c.buyer?.name && <span className="cq-sub">{c.buyer.name}</span>}
          </td>
        )
      case 'accounts':
        return <td key={key}>{t?.accounts_staff_id ? (names[t.accounts_staff_id] ?? '—') : dash}</td>
      case 'person':
        return <td key={key}>{c.collected_by ? (names[c.collected_by] ?? '—') : dash}</td>
      case 'buyer':
        return (
          <td key={key} className="left">
            {c.buyer?.name ?? dash}
          </td>
        )
      case 'invoice_no':
        return <td key={key}>{c.invoice_no || dash}</td>
      case 'cheque_no':
        return (
          <td key={key} className="mono">
            {c.cheque_no}
          </td>
        )
      case 'cheque_bank':
        return <td key={key}>{c.bank_name ?? dash}</td>
      case 'cheque_date':
        return <td key={key}>{c.cheque_date ? formatDate(c.cheque_date) : dash}</td>
      case 'cheque_amount':
        return <td key={key}>{formatMoney(c.amount)}</td>
      case 'proof':
        return (
          <td key={key} onClick={(e) => e.stopPropagation()}>
            {c.photo_path ? (
              <a
                href="#"
                className="cq-link"
                onClick={(e) => {
                  e.preventDefault()
                  void openPhoto(c.photo_path as string)
                }}
              >
                Photo
              </a>
            ) : (
              dash
            )}
          </td>
        )
      case 'deposit_status':
        return (
          <td key={key}>
            <StatusPill tone={CHEQUE_STATUS_TONE[c.status]}>{CHEQUE_STATUS_OPTIONS.find((o) => o.value === c.status)?.label ?? c.status}</StatusPill>
          </td>
        )
      case 'cheque_notes':
        return (
          <td key={key} className="left">
            {c.notes || dash}
          </td>
        )
      case 'gps': {
        const url = mapUrl(t)
        return (
          <td key={key} onClick={(e) => e.stopPropagation()}>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className="cq-link">
                Map
              </a>
            ) : (
              dash
            )}
          </td>
        )
      }
      case 'actions':
        return (
          <td key={key} className="cq-actions-cell" onClick={(e) => e.stopPropagation()}>
            <RowActionMenu label={`cheque ${c.cheque_no}`} actions={actionsFor(c)} busy={busyId === c.id} />
          </td>
        )
      default:
        return <td key={key} />
    }
  }

  const groupCounts = GROUPS.map((_, i) => shown.filter((c) => groupOf(c) === i).length)

  return (
    <section className="md-pane tk-card">
      {dialog?.kind === 'form' && (
        <ChequeForm
          cheque={dialog.cheque}
          onClose={closeDialog}
          onSaved={() => void load()}
        />
      )}
      {dialog?.kind === 'deposit' && (
        <DepositDialog
          cheque={dialog.cheque}
          onClose={closeDialog}
          onSubmit={async (values) => {
            const ok = await change(
              dialog.cheque,
              { status: 'deposited', deposit_bank: values.bank, slip_no: values.slip, deposited_on: values.date },
              `Cheque ${dialog.cheque.cheque_no} marked deposited.`,
            )
            if (ok) setDialog(null)
          }}
        />
      )}
      {dialog?.kind === 'confirm' && (
        <Modal
          size="sm"
          title={dialog.action === 'delete' ? 'Delete this cheque?' : 'Mark as bounced?'}
          description={`Cheque ${dialog.cheque.cheque_no} · ${formatMoney(dialog.cheque.amount)}`}
          onClose={closeDialog}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={closeDialog}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const d = dialog
                  setDialog(null)
                  if (d.action === 'delete') void remove(d.cheque)
                  else void change(d.cheque, { status: 'bounced' }, `Cheque ${d.cheque.cheque_no} marked bounced.`)
                }}
              >
                {dialog.action === 'delete' ? 'Delete cheque' : 'Mark bounced'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 14 }}>
            {dialog.action === 'delete'
              ? 'The cheque record is removed. Its collection task and any photo stay on the task.'
              : 'Use this when the bank returned the cheque. It cannot be set back to deposited from here.'}
          </p>
        </Modal>
      )}

      <GridToolbar
        title={BOARD?.title ?? 'Cheque Collection'}
        subtitle={BOARD ? `${BOARD.purpose} ${subtitle}.` : subtitle}
        total={shown.length}
        singular="cheque"
        plural="cheques"
        query={search}
        onQuery={setSearch}
        searchPlaceholder="Search cheque no, bank, buyer or slip"
        filters={filterDefs}
        values={filters}
        onFilter={(name, value) => setFilters((prev) => ({ ...prev, [name]: value }))}
        onClear={() => setFilters({ status: '', by: '', buyer: '' })}
      >
        <button type="button" className="btn" disabled={shown.length === 0} onClick={exportCSV}>
          Export CSV
        </button>
        {(canManage || canWork) && (
          <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'form', cheque: null })}>
            New cheque
          </button>
        )}
      </GridToolbar>

      {loadError && (
        <div className="alert" role="alert">
          {loadError}
        </div>
      )}

      {rows === null ? (
        <Loading label="Loading cheques" />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col.key} className={col.left ? 'left' : undefined}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paging.visible.map((c, idx) => {
                  const g = groupOf(c)
                  const prev = paging.visible[idx - 1]
                  const newGroup = !prev || groupOf(prev) !== g
                  return (
                    <Fragment key={c.id}>
                      {newGroup && (
                        <tr className="group-row">
                          <td colSpan={COLUMNS.length}>
                            {GROUPS[g]?.label}
                            <span className="group-count">{groupCounts[g]}</span>
                          </td>
                        </tr>
                      )}
                      <tr className={canChange(c) ? 'clickable' : ''} onClick={() => canChange(c) && setDialog({ kind: 'form', cheque: c })}>
                        {COLUMNS.map((col) => cell(col.key, c))}
                      </tr>
                    </Fragment>
                  )
                })}
                {shown.length === 0 && (
                  <tr>
                    <td className="empty" colSpan={COLUMNS.length}>
                      {rows.length === 0 ? 'No cheques recorded yet.' : 'No cheque matches those filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <GridPager {...paging.pager} singular="cheque" plural="cheques" />
        </>
      )}
    </section>
  )
}

function DepositDialog({
  cheque,
  onClose,
  onSubmit,
}: {
  cheque: ChequeRow
  onClose: () => void
  onSubmit: (values: { bank: string; slip: string; date: string }) => Promise<void>
}) {
  const today = todayIST()
  const [bank, setBank] = useState(cheque.deposit_bank ?? '')
  const [slip, setSlip] = useState(cheque.slip_no ?? '')
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const ready = bank.trim() !== '' && slip.trim() !== '' && date !== ''

  return (
    <Modal
      size="sm"
      title="Mark deposited"
      description={`Cheque ${cheque.cheque_no} · ${formatMoney(cheque.amount)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true)
              await onSubmit({ bank: bank.trim(), slip: slip.trim(), date })
              setBusy(false)
            }}
          >
            {busy ? 'Saving…' : 'Mark deposited'}
          </button>
        </>
      }
    >
      <Field id="dep-bank" label="Deposit bank" required>
        <input id="dep-bank" value={bank} onChange={(e) => setBank(e.target.value)} autoFocus />
      </Field>
      <Field id="dep-slip" label="Slip number" required>
        <input id="dep-slip" className="mono" value={slip} onChange={(e) => setSlip(e.target.value)} />
      </Field>
      <Field id="dep-date" label="Deposit date" required>
        <input id="dep-date" type="date" min={cheque.collection_date} max={today} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Modal>
  )
}
