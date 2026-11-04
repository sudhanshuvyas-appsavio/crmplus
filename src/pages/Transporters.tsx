/** Transportation (transporter records).
 *
 *  One record per transporter, whether it is one of our own vehicles/people
 *  ("Internal") or an outside party ("Third party"). The fields follow the
 *  transporter form: name, short name, station, two contacts with mobiles,
 *  office and residence phone, office and mill/factory/delivery addresses, a
 *  company, and Account / Info / Remarks tabs (GST, state code, state, PAN, bank
 *  account). Only the name is required; GST and PAN are checked when entered. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Station, Transporter } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'
import { Drawer, DeleteControl } from '../components/Drawer'
import { Field } from '../components/PartyForms'
import { ImportIssues, ListTools, useSelection } from '../components/ListTools'
import { bulkDelete, deleteSummary, importCsvFile, importSummary, parseBool, pickOne } from '../lib/bulk'
import type { CsvRowResult } from '../lib/bulk'
import { downloadCSV, toCSV } from '../lib/csv'
import { GST_STATES, errMessage, isGst, isMobile } from '../lib/party'
import { formatDateTime } from '../lib/format'

type Company = { id: string; name: string; is_active: boolean }

const TYPES = [
  { value: 'third_party', label: 'Third party' },
  { value: 'internal', label: 'Internal' },
] as const

const CSV_COLUMNS = [
  'transporter_code', 'name', 'short_name', 'transporter_type', 'station', 'contact_person', 'mobile',
  'contact_person_2', 'mobile_2', 'office_phone', 'res_phone', 'office_address', 'delivery_address',
  'gst', 'state_code', 'state', 'pan', 'bank_account', 'company', 'info', 'remarks', 'is_active',
] as const

type Form = {
  transporter_type: 'internal' | 'third_party'
  name: string
  short_name: string
  station_id: string
  office_address: string
  delivery_address: string
  contact_person: string
  mobile: string
  contact_person_2: string
  mobile_2: string
  office_phone: string
  res_phone: string
  gst: string
  state_code: string
  state: string
  pan: string
  bank_account: string
  company_id: string
  info: string
  remarks: string
  is_active: boolean
}

const blank: Form = {
  transporter_type: 'third_party', name: '', short_name: '', station_id: '', office_address: '', delivery_address: '',
  contact_person: '', mobile: '', contact_person_2: '', mobile_2: '', office_phone: '', res_phone: '',
  gst: '', state_code: '', state: '', pan: '', bank_account: '', company_id: '', info: '', remarks: '', is_active: true,
}

const fromRow = (r: Transporter): Form => ({
  transporter_type: r.transporter_type, name: r.name, short_name: r.short_name ?? '', station_id: r.station_id ?? '',
  office_address: r.office_address ?? '', delivery_address: r.delivery_address ?? '', contact_person: r.contact_person ?? '',
  mobile: r.mobile ?? '', contact_person_2: r.contact_person_2 ?? '', mobile_2: r.mobile_2 ?? '', office_phone: r.office_phone ?? '',
  res_phone: r.res_phone ?? '', gst: r.gst ?? '', state_code: r.state_code ?? '', state: r.state ?? '', pan: r.pan ?? '',
  bank_account: r.bank_account ?? '', company_id: r.company_id ?? '', info: r.info ?? '', remarks: r.remarks ?? '', is_active: r.is_active,
})

function problems(f: Form): string[] {
  const out: string[] = []
  if (!f.name.trim()) out.push('Transporter name')
  if (f.mobile && !isMobile(f.mobile)) out.push('Mobile (10 digits)')
  if (f.mobile_2 && !isMobile(f.mobile_2)) out.push('Second mobile (10 digits)')
  if (f.gst && !isGst(f.gst)) out.push('GST (15 characters, valid format)')
  if (f.pan && f.pan.trim().length !== 10) out.push('PAN (10 characters)')
  if (f.gst && f.state_code && f.gst.slice(0, 2) !== f.state_code) out.push('State code (must match the first two digits of the GST)')
  return out
}

const payload = (f: Form) => {
  const t = (v: string) => v.trim() || null
  return {
    transporter_type: f.transporter_type, name: f.name.trim(), short_name: t(f.short_name), station_id: f.station_id || null,
    office_address: t(f.office_address), delivery_address: t(f.delivery_address), contact_person: t(f.contact_person),
    mobile: t(f.mobile), contact_person_2: t(f.contact_person_2), mobile_2: t(f.mobile_2), office_phone: t(f.office_phone),
    res_phone: t(f.res_phone), gst: t(f.gst.toUpperCase()), state_code: t(f.state_code), state: t(f.state),
    pan: t(f.pan.toUpperCase()), bank_account: t(f.bank_account), company_id: f.company_id || null,
    info: t(f.info), remarks: t(f.remarks), is_active: f.is_active,
  }
}

export default function Transporters() {
  const { can } = useAuth()
  const canManage = can('transport.manage')
  const canRead = canManage || can('transport.read')
  const [rows, setRows] = useState<Transporter[] | null>(null)
  const [stations, setStations] = useState<Station[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [editing, setEditing] = useState<Transporter | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [importResults, setImportResults] = useState<CsvRowResult[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [r, s, c] = await Promise.all([
      supabase.from('transporters').select('*').order('name'),
      supabase.from('station_master').select('*').order('name'),
      supabase.from('companies').select('id,name,is_active').order('name'),
    ])
    if (r.error) setBanner({ kind: 'bad', text: errMessage(r.error, 'Could not load transporters') })
    setRows((r.data ?? []) as Transporter[])
    setStations((s.data ?? []) as Station[])
    setCompanies((c.data ?? []) as Company[])
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const stationName = useMemo(() => new Map(stations.map((x) => [x.id, x.name])), [stations])
  const companyName = useMemo(() => new Map(companies.map((x) => [x.id, x.name])), [companies])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(
      (x) =>
        (!typeFilter || x.transporter_type === typeFilter) &&
        (!q ||
          [x.name, x.short_name, x.transporter_code, x.contact_person, x.mobile, x.gst, x.pan, x.station_id ? stationName.get(x.station_id) : '']
            .some((v) => (v ?? '').toLowerCase().includes(q))),
    )
  }, [rows, search, typeFilter, stationName])

  const selection = useSelection(useMemo(() => shown.map((x) => x.id), [shown]))

  async function deleteSelected() {
    setBusy(true)
    setBanner(null)
    const names = new Map((rows ?? []).map((x) => [x.id, x.name]))
    const result = await bulkDelete('transporters', selection.chosen)
    setBanner(deleteSummary('transporter', 'transporters', result, (id) => names.get(id) ?? id))
    selection.clear()
    await load()
    setBusy(false)
  }

  function exportCSV() {
    const list = (selection.chosen.length > 0 ? shown.filter((x) => selection.isSelected(x.id)) : shown).map((x) => ({
      ...x,
      station: x.station_id ? stationName.get(x.station_id) ?? '' : '',
      company: x.company_id ? companyName.get(x.company_id) ?? '' : '',
    }))
    downloadCSV(`transporters-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(CSV_COLUMNS, list))
  }

  async function importCSV(file: File) {
    setBusy(true)
    setBanner(null)
    setImportResults(null)
    const outcome = await importCsvFile(
      file,
      (r) => r.get('name'),
      async (r) => {
        const stationText = r.get('station')
        const station = stationText ? stations.find((s) => s.name.toLowerCase() === stationText.toLowerCase()) : null
        if (stationText && !station) throw new Error(`Station "${stationText}" is not in the Station list`)
        const companyText = r.get('company')
        const company = companyText ? companies.find((c) => c.name.toLowerCase() === companyText.toLowerCase()) : null
        if (companyText && !company) throw new Error(`Company "${companyText}" was not found`)
        const typeText = r.get('transporter_type').toLowerCase().replace(/[\s-]+/g, '_')
        const gst = r.get('gst').toUpperCase().replace(/\s+/g, '')
        const f: Form = {
          ...blank,
          transporter_type: (pickOne('Type', typeText, ['INTERNAL', 'THIRD_PARTY']) || 'THIRD_PARTY').toLowerCase() as Form['transporter_type'],
          name: r.get('name'), short_name: r.get('short_name'), station_id: station?.id ?? '',
          office_address: r.get('office_address'), delivery_address: r.get('delivery_address'),
          contact_person: r.get('contact_person'), mobile: r.get('mobile'), contact_person_2: r.get('contact_person_2'),
          mobile_2: r.get('mobile_2'), office_phone: r.get('office_phone'), res_phone: r.get('res_phone'),
          gst, state_code: r.get('state_code') || gst.slice(0, 2), state: r.get('state') || GST_STATES[gst.slice(0, 2)] || '',
          pan: r.get('pan').toUpperCase(), bank_account: r.get('bank_account'), company_id: company?.id ?? '',
          info: r.get('info'), remarks: r.get('remarks'), is_active: parseBool(r.get('is_active'), true),
        }
        const missing = problems(f)
        if (missing.length > 0) throw new Error(`Needs: ${missing.join(', ')}`)
        const { error } = await supabase.from('transporters').insert(payload(f))
        if (error) throw error
      },
    )
    if ('error' in outcome) setBanner({ kind: 'bad', text: outcome.error })
    else {
      setImportResults(outcome.results)
      setBanner(importSummary(outcome.results))
      await load()
    }
    setBusy(false)
  }

  if (!canRead) return <div className="card pad narrow-card">Your account does not have access to transportation records.</div>
  if (!rows) return <Loading label="Loading transporters" />

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Transportation</h1>
          <p className="page-sub">Transporters, whether our own resource or a third party.</p>
        </div>
        {canManage && (
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
            New transporter
          </button>
        )}
      </header>

      {banner && (
        <div className={banner.kind === 'ok' ? 'notice' : 'alert'} role="status">
          {banner.text}
          <button className="btn ghost sm" type="button" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      )}

      <ListTools
        plural="transporters"
        canImport={canManage}
        canDelete={canManage}
        selectedCount={selection.chosen.length}
        exportLabel={`Export ${selection.chosen.length > 0 ? `${selection.chosen.length} selected` : shown.length === rows.length ? 'all' : `${shown.length} shown`} as CSV`}
        exportDisabled={shown.length === 0}
        busy={busy}
        onImport={(file) => void importCSV(file)}
        onExport={exportCSV}
        onDelete={deleteSelected}
      />
      <ImportIssues results={importResults} />

      <div className="form-grid" style={{ maxWidth: 560 }}>
        <div className="field">
          <input aria-label="Search transporters" placeholder="Search name, code, contact, mobile, GST, PAN or station" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <select aria-label="Filter by type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card pad empty">{rows.length === 0 ? 'No transporters yet.' : 'No transporter matches.'}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canManage && (
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={selection.allSelected} onChange={selection.toggleAll} aria-label="Select all transporters" />
                  </th>
                )}
                <th>Code</th>
                <th>Transporter</th>
                <th>Type</th>
                <th>Station</th>
                <th>Contact</th>
                <th>Mobile</th>
                <th>GST</th>
                <th>Company</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.id} className="clickable" onClick={() => setEditing(x)}>
                  {canManage && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selection.isSelected(x.id)} onChange={() => selection.toggle(x.id)} aria-label={`Select ${x.name}`} />
                    </td>
                  )}
                  <td className="mono small">{x.transporter_code}</td>
                  <td>
                    <strong>{x.name}</strong>
                    {x.short_name && <span className="muted small"> · {x.short_name}</span>}
                  </td>
                  <td>
                    <span className="chip">{x.transporter_type === 'internal' ? 'Internal' : 'Third party'}</span>
                  </td>
                  <td className="small">{x.station_id ? stationName.get(x.station_id) ?? '—' : '—'}</td>
                  <td className="small">{x.contact_person ?? '—'}</td>
                  <td className="mono small">{x.mobile ?? '—'}</td>
                  <td className="mono small">{x.gst ?? '—'}</td>
                  <td className="small">{x.company_id ? companyName.get(x.company_id) ?? '—' : '—'}</td>
                  <td>{x.is_active ? <span className="chip good">Active</span> : <span className="chip bad">Inactive</span>}</td>
                  <td className="mono small">{formatDateTime(x.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TransporterDrawer
          key={editing === 'new' ? 'new' : editing.id}
          row={editing === 'new' ? null : editing}
          canManage={canManage}
          stations={stations}
          companies={companies}
          onClose={() => setEditing(null)}
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

function TransporterDrawer({
  row, canManage, stations, companies, onClose, onDone,
}: {
  row: Transporter | null
  canManage: boolean
  stations: Station[]
  companies: Company[]
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
}) {
  const [f, setF] = useState<Form>(row ? fromRow(row) : blank)
  const [tab, setTab] = useState<'account' | 'info' | 'remarks'>('account')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  const missing = problems(f)

  /** Typing a GSTIN fills the state code, state and PAN that it carries. */
  function setGst(value: string) {
    const gst = value.toUpperCase().replace(/\s+/g, '')
    setF((p) => {
      const next = { ...p, gst }
      const code = gst.slice(0, 2)
      if (/^[0-9]{2}$/.test(code)) {
        next.state_code = code
        if (GST_STATES[code] && (p.state.trim() === '' || p.state === GST_STATES[p.gst.slice(0, 2)])) next.state = GST_STATES[code]!
      }
      if (gst.length >= 12 && !p.pan.trim()) next.pan = gst.slice(2, 12)
      return next
    })
  }

  async function save() {
    if (missing.length > 0) return setErr(`Fix: ${missing.join(', ')}.`)
    setBusy(true)
    setErr(null)
    const { data, error } = row
      ? await supabase.from('transporters').update(payload(f)).eq('id', row.id).select('id')
      : await supabase.from('transporters').insert(payload(f)).select('id')
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this transporter'))
    if (!data || data.length === 0) return setErr('Your account cannot change this transporter.')
    await onDone(row ? `${f.name.trim()} updated.` : `${f.name.trim()} added.`)
  }

  async function remove() {
    if (!row) return
    setBusy(true)
    const { data, error } = await supabase.from('transporters').delete().eq('id', row.id).select('id')
    setBusy(false)
    if (error || !data || data.length === 0) return setErr(error ? errMessage(error) : 'Your account cannot delete this transporter.')
    await onDone(`${row.name} deleted.`)
  }

  return (
    <Drawer title={row ? `${row.transporter_code} · ${row.name}` : 'New transporter'} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      {!canManage && <div className="notice small">You can view this record; changing it needs the “Add and edit transporters” permission.</div>}
      <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-grid">
          <Field id="t-type" label="Type" required hint="Internal = our own vehicle or resource.">
            <select id="t-type" value={f.transporter_type} onChange={(e) => set('transporter_type', e.target.value as Form['transporter_type'])}>
              {TYPES.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
            </select>
          </Field>
          <Field id="t-name" label="Transporter" required>
            <input id="t-name" value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id="t-short" label="Short name">
            <input id="t-short" value={f.short_name} onChange={(e) => set('short_name', e.target.value)} />
          </Field>
          <Field id="t-station" label="Station">
            <select id="t-station" value={f.station_id} onChange={(e) => set('station_id', e.target.value)}>
              <option value="">—</option>
              {stations.filter((s) => s.is_active || s.id === f.station_id).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </Field>
          <Field id="t-cp" label="Contact person">
            <input id="t-cp" value={f.contact_person} onChange={(e) => set('contact_person', e.target.value)} />
          </Field>
          <Field id="t-mob" label="Mobile" hint="10 digits.">
            <input id="t-mob" className="mono" inputMode="numeric" maxLength={10} value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id="t-cp2" label="Contact person 2">
            <input id="t-cp2" value={f.contact_person_2} onChange={(e) => set('contact_person_2', e.target.value)} />
          </Field>
          <Field id="t-mob2" label="Mobile 2" hint="10 digits.">
            <input id="t-mob2" className="mono" inputMode="numeric" maxLength={10} value={f.mobile_2} onChange={(e) => set('mobile_2', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id="t-ophone" label="Office phone">
            <input id="t-ophone" className="mono" value={f.office_phone} onChange={(e) => set('office_phone', e.target.value)} />
          </Field>
          <Field id="t-rphone" label="Res. phone">
            <input id="t-rphone" className="mono" value={f.res_phone} onChange={(e) => set('res_phone', e.target.value)} />
          </Field>
        </div>
        <Field id="t-oaddr" label="Office address">
          <textarea id="t-oaddr" rows={3} value={f.office_address} onChange={(e) => set('office_address', e.target.value)} />
        </Field>
        <Field id="t-daddr" label="Mill / Factory / Delivery address">
          <textarea id="t-daddr" rows={3} value={f.delivery_address} onChange={(e) => set('delivery_address', e.target.value)} />
        </Field>

        <div role="tablist" className="drawer-actions" style={{ marginTop: 8, paddingTop: 0, borderTop: 'none' }}>
          {(['account', 'info', 'remarks'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} type="button" className={`btn sm${tab === k ? ' primary' : ' ghost'}`} onClick={() => setTab(k)}>
              {k === 'account' ? 'Account' : k === 'info' ? 'Info' : 'Remarks'}
            </button>
          ))}
        </div>

        {tab === 'account' && (
          <div className="form-grid">
            <Field id="t-gst" label="GST" hint="Fills state code, state and PAN.">
              <input id="t-gst" className="mono" maxLength={15} value={f.gst} onChange={(e) => setGst(e.target.value)} />
            </Field>
            <Field id="t-pan" label="IT PAN" hint="10 characters.">
              <input id="t-pan" className="mono" maxLength={10} value={f.pan} onChange={(e) => set('pan', e.target.value.toUpperCase().replace(/\s+/g, ''))} />
            </Field>
            <Field id="t-sc" label="State code">
              <input id="t-sc" className="mono" maxLength={2} value={f.state_code} onChange={(e) => set('state_code', e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field id="t-state" label="State">
              <input id="t-state" value={f.state} onChange={(e) => set('state', e.target.value)} />
            </Field>
            <Field id="t-bank" label="Bank A/c. No.">
              <textarea id="t-bank" rows={3} value={f.bank_account} onChange={(e) => set('bank_account', e.target.value)} />
            </Field>
          </div>
        )}
        {tab === 'info' && (
          <Field id="t-info" label="Info" hint="Vehicle details, routes served or anything else worth knowing.">
            <textarea id="t-info" rows={5} value={f.info} onChange={(e) => set('info', e.target.value)} />
          </Field>
        )}
        {tab === 'remarks' && (
          <Field id="t-remarks" label="Remarks">
            <textarea id="t-remarks" rows={5} value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </Field>
        )}

        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field id="t-company" label="Company">
            <select id="t-company" value={f.company_id} onChange={(e) => set('company_id', e.target.value)}>
              <option value="">—</option>
              {companies.filter((c) => c.is_active || c.id === f.company_id).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </Field>
          <label style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active
          </label>
        </div>
      </fieldset>

      {missing.length > 0 && <p className="field-hint">Fix: {missing.join(', ')}.</p>}

      {canManage && (
        <div className="drawer-actions">
          <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : row ? 'Save changes' : 'Add transporter'}
          </button>
          {row && <DeleteControl label="Delete" name={row.name} busy={busy} onConfirm={() => void remove()} />}
        </div>
      )}
    </Drawer>
  )
}