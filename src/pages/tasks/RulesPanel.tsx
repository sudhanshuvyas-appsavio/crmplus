/** Reminder / escalation rules and message templates (Tasks > Rules).
 *
 *  Rules: the thresholds are data. An escalation rule holds the days at which a
 *  still-unpaid account is chased (30, 45, 60 by default); a reminder rule holds
 *  how many days after the date it fires. Templates: the wording of each
 *  WhatsApp / e-mail message and the name Meta approved it under. Both are
 *  editable only with `task.manage`; everyone else sees them read-only. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import '../../styles/messaging.css'
import { supabase } from '../../lib/supabase'
import { errMessage } from '../../lib/party'
import { useAuth } from '../../auth/AuthProvider'
import type { MessageTemplate, TaskRule, TaskRuleRun } from '../../api/types'
import { GridToolbar } from '../../components/GridKit'
import { Field } from '../../components/PartyForms'
import { Modal } from '../../components/Modal'
import { StatusPill } from '../../components/StatusPill'
import { pushToast } from '../../components/Toast'
import { useTaskTypes } from '../../lib/taskData'
import { formatDateTime } from '../../lib/format'

/** The ascending list of positive whole days, or what is wrong with the text. */
function parseDays(text: string): { days: number[] } | { error: string } {
  const parts = text.split(',').map((p) => p.trim())
  if (parts.length === 0 || parts.some((p) => p === '')) return { error: 'Enter days separated by commas, like 30, 45, 60.' }
  const days: number[] = []
  for (const p of parts) {
    if (!/^\d+$/.test(p) || Number(p) < 1) return { error: `"${p}" is not a whole number of days above zero.` }
    days.push(Number(p))
  }
  for (let i = 1; i < days.length; i++) {
    if ((days[i] as number) <= (days[i - 1] as number)) return { error: 'Days must go up: each step later than the one before.' }
  }
  return { days }
}

function parseAfter(text: string): { after: number } | { error: string } {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return { error: 'Enter a whole number of days (0 or more).' }
  return { after: Number(t) }
}

interface Draft {
  days: string
  after: string
  time: string
  active: boolean
}

/** Rules that fire at a time of day (HH:MM, India time) carry `time` in their settings. */
const hasTime = (r: TaskRule): boolean => typeof r.config.time === 'string'

const draftOf = (r: TaskRule): Draft => ({
  days: (r.config.days ?? []).join(', '),
  after: String(r.config.after_days ?? 0),
  time: typeof r.config.time === 'string' ? r.config.time : '',
  active: r.is_active,
})

/** The per-step times of a visit escalation (read only here; they live in the rule's settings). */
function stepTimes(r: TaskRule): string | null {
  const list = (v: unknown) => (v && typeof v === 'object' ? Object.values(v as Record<string, string>).join(' / ') : '')
  const visited = list(r.config.visited)
  const notVisited = list(r.config.not_visited)
  return visited || notVisited ? `Visited ${visited || '—'} · Not visited ${notVisited || '—'}` : null
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function RulesPanel() {
  return (
    <div className="tk-stack">
      <RulesCard />
      <RunLogCard />
      <TemplatesCard />
    </div>
  )
}

/* ---- rules ----------------------------------------------------------------- */

function RulesCard() {
  const { can } = useAuth()
  const canManage = can('task.manage')
  const types = useTaskTypes()
  const [rules, setRules] = useState<TaskRule[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('task_rules').select('*').order('label')
    if (error) {
      setLoadError(errMessage(error, 'Could not load the rules'))
      setRules([])
      return
    }
    const rows = (data ?? []) as TaskRule[]
    setRules(rows)
    setDrafts(Object.fromEntries(rows.map((r) => [r.rule_key, draftOf(r)])))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const typeLabel = (key: string | null) => (key ? (types.find((t) => t.key === key)?.label ?? key) : 'Any task')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rules ?? []).filter((r) => !q || `${r.label} ${typeLabel(r.task_type)}`.toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, query, types])

  function patch(key: string, change: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] as Draft), ...change } }))
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function save(rule: TaskRule) {
    const d = drafts[rule.rule_key]
    if (!d) return
    let config: TaskRule['config'] = { ...rule.config }
    if (hasTime(rule)) {
      if (!TIME.test(d.time.trim())) return setErrors((prev) => ({ ...prev, [rule.rule_key]: 'Enter the time as HH:MM, like 17:45 (India time).' }))
      config = { ...config, time: d.time.trim() }
    }
    if (rule.kind === 'escalation') {
      const parsed = parseDays(d.days)
      if ('error' in parsed) return setErrors((prev) => ({ ...prev, [rule.rule_key]: parsed.error }))
      config = { ...config, days: parsed.days }
    } else {
      const parsed = parseAfter(d.after)
      if ('error' in parsed) return setErrors((prev) => ({ ...prev, [rule.rule_key]: parsed.error }))
      config = { ...config, after_days: parsed.after }
    }

    setSaving(rule.rule_key)
    const { data, error } = await supabase
      .from('task_rules')
      .update({ config, is_active: d.active })
      .eq('rule_key', rule.rule_key)
      .select('rule_key')
    setSaving(null)
    if (error) return setErrors((prev) => ({ ...prev, [rule.rule_key]: errMessage(error, 'Could not save this rule') }))
    if (!data || data.length === 0) {
      return setErrors((prev) => ({ ...prev, [rule.rule_key]: 'Your account is not allowed to change rules.' }))
    }
    pushToast('success', `${rule.label} saved.`)
    await load()
  }

  if (!rules) return <p className="muted small">Loading rules…</p>

  return (
    <section className="md-pane tk-card" aria-label="Reminder rules">
      <GridToolbar
        title="Reminder and escalation rules"
        subtitle="Thresholds the scheduler uses to raise reminders and chase unpaid accounts."
        total={shown.length}
        singular="rule"
        plural="rules"
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search rules"
      />
      {loadError && <div className="alert">{loadError}</div>}
      {!canManage && <div className="notice small">You can see the rules, but changing them needs the “Create and manage tasks” permission.</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="left">Rule</th>
              <th>Task type</th>
              <th>Kind</th>
              <th>Active</th>
              <th>Threshold</th>
              <th>Time (IST)</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const d = drafts[r.rule_key] ?? draftOf(r)
              const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(r))
              const error = errors[r.rule_key]
              return (
                <tr key={r.rule_key}>
                  <td className="left">
                    <strong>{r.label}</strong>
                  </td>
                  <td className="small">{typeLabel(r.task_type)}</td>
                  <td>
                    <StatusPill tone={r.kind === 'escalation' ? 'warn' : 'info'}>{r.kind === 'escalation' ? 'Escalation' : 'Reminder'}</StatusPill>
                  </td>
                  <td>
                    <label className="msg-toggle">
                      <input
                        type="checkbox"
                        checked={d.active}
                        disabled={!canManage}
                        onChange={(e) => patch(r.rule_key, { active: e.target.checked })}
                        aria-label={`${r.label} active`}
                      />
                      {d.active ? 'On' : 'Off'}
                    </label>
                  </td>
                  <td>
                    {r.kind === 'escalation' ? (
                      <>
                        <input
                          className="msg-rules-input"
                          value={d.days}
                          disabled={!canManage}
                          onChange={(e) => patch(r.rule_key, { days: e.target.value })}
                          aria-label={`${r.label}: escalation days`}
                          aria-invalid={error ? true : undefined}
                          placeholder="30, 45, 60"
                        />{' '}
                        <span className="small muted">days</span>
                      </>
                    ) : (
                      <>
                        <input
                          className="msg-rules-input narrow"
                          inputMode="numeric"
                          value={d.after}
                          disabled={!canManage}
                          onChange={(e) => patch(r.rule_key, { after: e.target.value })}
                          aria-label={`${r.label}: days after`}
                          aria-invalid={error ? true : undefined}
                        />{' '}
                        <span className="small muted">days after</span>
                      </>
                    )}
                    {error && (
                      <span className="msg-rule-error" role="alert">
                        {error}
                      </span>
                    )}
                  </td>
                  <td>
                    {hasTime(r) ? (
                      <input
                        className="msg-rules-input narrow"
                        value={d.time}
                        disabled={!canManage}
                        onChange={(e) => patch(r.rule_key, { time: e.target.value })}
                        aria-label={`${r.label}: time of day`}
                        placeholder="17:45"
                      />
                    ) : (
                      <span className="muted small">{stepTimes(r) ?? '—'}</span>
                    )}
                  </td>
                  {canManage && (
                    <td>
                      <button type="button" className="btn primary sm" disabled={!dirty || saving === r.rule_key} onClick={() => void save(r)}>
                        {saving === r.rule_key ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr>
                <td className="empty" colSpan={canManage ? 7 : 6}>
                  No rules match that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ---- run log --------------------------------------------------------------- */

/** What the scheduler did: each rule that fired, each failure, and one summary line per run (so you can see it is alive). */
function RunLogCard() {
  const { can } = useAuth()
  const [rows, setRows] = useState<TaskRuleRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [only, setOnly] = useState<'all' | 'fired' | 'failed'>('fired')

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.from('task_rule_runs').select('*').order('run_at', { ascending: false }).limit(150)
    if (err) {
      setError(errMessage(err, 'The rule log is not available yet (apply the latest database migration).'))
      setRows([])
      return
    }
    setError(null)
    setRows((data ?? []) as TaskRuleRun[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!can('task.manage')) return null
  if (!rows) return <p className="muted small">Loading the rule log…</p>
  const lastRun = rows.find((r) => r.outcome === 'summary')
  const shown = rows.filter((r) => (only === 'all' ? true : r.outcome === only))

  return (
    <section className="md-pane tk-card" aria-label="Rule log">
      <div className="gk-head">
        <div className="gk-title">
          <h2>Rule log</h2>
          <p>
            {lastRun ? `Last run ${formatDateTime(lastRun.run_at)}.` : 'No run recorded yet.'} The scheduler runs every 15 minutes; a rule fires at its time (India time) once per date.
          </p>
        </div>
        <div className="td-row">
          <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} aria-label="Show">
            <option value="fired">Fired</option>
            <option value="failed">Failed</option>
            <option value="all">Everything</option>
          </select>
          <button type="button" className="btn ghost sm" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="left">When</th>
              <th className="left">Rule</th>
              <th>Result</th>
              <th className="left">Detail</th>
              <th>Task</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="left small">{formatDateTime(r.run_at)}</td>
                <td className="left small">{r.rule_key === 'run' ? 'Scheduler run' : r.rule_key}</td>
                <td>
                  <StatusPill tone={r.outcome === 'failed' ? 'danger' : r.outcome === 'fired' ? 'ok' : 'muted'}>
                    {r.outcome === 'failed' ? 'Failed' : r.outcome === 'fired' ? 'Fired' : 'Run'}
                  </StatusPill>
                </td>
                <td className="left small mono">{r.detail ? JSON.stringify(r.detail) : '—'}</td>
                <td>{r.task_id ? <a href={`/tasks?task=${r.task_id}`}>Open</a> : '—'}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td className="empty" colSpan={5}>
                  Nothing to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ---- templates ------------------------------------------------------------- */

function TemplatesCard() {
  const { can } = useAuth()
  const canManage = can('task.manage')
  const [rows, setRows] = useState<MessageTemplate[] | null>(null)
  const [editing, setEditing] = useState<MessageTemplate | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('message_templates').select('*').order('channel').order('key')
    if (error) {
      setLoadError(errMessage(error, 'Could not load the message templates'))
      setRows([])
      return
    }
    setRows((data ?? []) as MessageTemplate[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!rows) return <p className="muted small">Loading templates…</p>

  return (
    <>
      {editing && (
        <TemplateModal
          key={editing.key}
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            pushToast('success', 'Template saved.')
            await load()
          }}
        />
      )}
      <section className="md-pane tk-card" aria-label="Message templates">
        <div className="gk-head">
          <div className="gk-title">
            <h2>Message templates</h2>
            <p>
              {rows.length} {rows.length === 1 ? 'template' : 'templates'}. WhatsApp templates must also exist, with the same wording, in Meta Business Manager.
            </p>
          </div>
        </div>
        {loadError && <div className="alert">{loadError}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="left">Template</th>
                <th>Channel</th>
                <th>Provider name</th>
                <th className="left">Message</th>
                <th>Status</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.key}>
                  <td className="left">
                    <strong>{t.key}</strong>
                  </td>
                  <td className="small">{t.channel === 'whatsapp' ? 'WhatsApp' : 'E-mail'}</td>
                  <td className="mono small">{t.provider_template ?? '—'}</td>
                  <td className="left">
                    <div className="msg-template-body" title={t.body}>
                      {t.body}
                    </div>
                  </td>
                  <td>
                    <StatusPill tone={t.is_active ? 'ok' : 'muted'}>{t.is_active ? 'Active' : 'Off'}</StatusPill>
                  </td>
                  {canManage && (
                    <td>
                      <button type="button" className="btn ghost sm" onClick={() => setEditing(t)}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={canManage ? 6 : 5}>
                    No message templates.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: MessageTemplate
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [provider, setProvider] = useState(template.provider_template ?? '')
  const [subject, setSubject] = useState(template.subject ?? '')
  const [body, setBody] = useState(template.body)
  const [active, setActive] = useState(template.is_active)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const unknown = useMemo(() => {
    const used = [...body.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g), ...subject.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1] as string)
    return [...new Set(used.filter((n) => !template.variables.includes(n)))]
  }, [body, subject, template.variables])

  const problems: string[] = []
  if (!body.trim()) problems.push('the message text')
  if (unknown.length > 0) problems.push(`placeholders that are not variables of this template: ${unknown.map((n) => `{{${n}}}`).join(', ')}`)

  async function save() {
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase
      .from('message_templates')
      .update({
        provider_template: provider.trim() || null,
        subject: template.channel === 'email' ? subject.trim() || null : template.subject,
        body: body.trim(),
        is_active: active,
        updated_at: new Date().toISOString(),
      })
      .eq('key', template.key)
      .select('key')
    setBusy(false)
    if (error) return setErr(errMessage(error, 'Could not save this template'))
    if (!data || data.length === 0) return setErr('Your account is not allowed to change message templates.')
    await onSaved()
  }

  return (
    <Modal
      title={`Edit template: ${template.key}`}
      description={template.channel === 'whatsapp' ? 'WhatsApp template' : 'E-mail template'}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button type="button" className="btn primary" disabled={busy || problems.length > 0} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save template'}
          </button>
        </>
      }
    >
      {err && (
        <div className="alert" role="alert">
          {err}
        </div>
      )}
      <Field
        id="tpl-provider"
        label="Provider template name"
        hint={template.channel === 'whatsapp' ? 'The exact name approved in Meta (lower case, underscores). Needed to send through WhatsApp.' : 'Not used for e-mail.'}
      >
        <input id="tpl-provider" className="mono" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={template.channel === 'email'} />
      </Field>
      {template.channel === 'email' && (
        <Field id="tpl-subject" label="Subject">
          <input id="tpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
      )}
      <Field id="tpl-body" label="Message" required hint="Use {{name}} where a value is filled in.">
        <textarea id="tpl-body" rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="field">
        <label>Variables (in the order Meta expects them)</label>
        <div className="msg-var-chips">
          {template.variables.length === 0 ? (
            <span className="muted small">None</span>
          ) : (
            template.variables.map((v, i) => (
              <code key={v}>
                {i + 1}. {`{{${v}}}`}
              </code>
            ))
          )}
        </div>
      </div>
      <label className="check msg-section-gap">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span className="check-body">
          <span className="check-label">Active</span>
          <span className="check-hint">Switched-off templates are not offered when sending.</span>
        </span>
      </label>
      {problems.length > 0 && <p className="field-hint">Fix: {problems.join('; ')}.</p>}
    </Modal>
  )
}
