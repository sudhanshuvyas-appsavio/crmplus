/** The landing screen: the pipeline.
 *
 * The stage columns come straight from the `pipeline_stages` table, and each
 * one's permission key follows the fixed `stage.move.<stage id>` pattern set
 * up in the permission catalogue -- so the moment the deal tables' UI lands,
 * the board already knows who is allowed to do what. Until then the columns
 * are empty and labelled as such rather than faked with sample deals. */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Pipeline } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { Loading } from '../components/Loading'

/** Static phase ordering/labels -- there is no server-side phases table,
 *  just the `phase` text column on each stage, so the display names are
 *  kept here, the same way PROFILE_TEMPLATES is kept in types.ts. */
const PHASES = [
  { id: 'origination', name: 'Origination' },
  { id: 'quotation', name: 'Quotation' },
  { id: 'order', name: 'Order & production' },
  { id: 'logistics', name: 'Logistics' },
  { id: 'settlement', name: 'Settlement' },
]

export default function Home() {
  const { me, can } = useAuth()
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('pipeline_stages')
        .select('id, name, phase, owner_label, sort_order')
        .order('sort_order')
      if (cancelled) return
      const stages = (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        phase: row.phase as string,
        owner: row.owner_label as string,
        permission: `stage.move.${row.id}`,
      }))
      setPipeline({ phases: PHASES, stages })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (!pipeline) return <Loading label="Loading the pipeline" />

  const mine = pipeline.stages.filter((stage) => can(stage.permission))

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Pipeline</h1>
          <p className="page-sub">
            {mine.length
              ? `You can move deals into ${mine.length} of the ${pipeline.stages.length} stages.`
              : 'Your account cannot move deals between stages yet.'}
          </p>
        </div>
      </header>

      <div className="notice">
        <strong>Signed in as {me?.name}.</strong> The identity and permission layer is live. The
        deal, buyer, mill, quotation and document tables are the next build step — the board below
        shows the stages your account may work, so the permissions are already wired to the
        workflow.
      </div>

      <div className="board" role="list">
        {pipeline.phases.map((phase) => {
          const stages = pipeline.stages.filter((stage) => stage.phase === phase.id)
          return (
            <section className="board-phase" key={phase.id} role="listitem">
              <h2 className={`phase-label phase-${phase.id}`}>
                <i aria-hidden="true" />
                {phase.name}
              </h2>
              <div className="board-columns">
                {stages.map((stage) => {
                  const allowed = can(stage.permission)
                  return (
                    <article className={allowed ? 'column allowed' : 'column'} key={stage.id}>
                      <header className="column-head">
                        <strong>{stage.name}</strong>
                        <span className="small muted">{stage.owner}</span>
                      </header>
                      <div className="column-body">
                        <p className="column-empty small muted">No deals yet</p>
                        {allowed ? (
                          <span className="chip good">You can move deals here</span>
                        ) : (
                          <span className="chip">Not yours to move</span>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <section className="card pad">
        <h2 className="card-title">What your account can do</h2>
        <p className="muted small">
          {me?.is_admin
            ? 'You are an administrator, so you hold every permission in the catalogue.'
            : `${me?.permissions.length ?? 0} permissions, set by an administrator.`}
        </p>
        <ul className="pill-list">
          {(me?.permissions ?? []).slice(0, 40).map((permission) => (
            <li key={permission} className="pill mono">
              {permission}
            </li>
          ))}
        </ul>
        {can('user.manage') && (
          <p className="small">
            <Link to="/users">Manage users and permissions →</Link>
          </p>
        )}
      </section>
    </>
  )
}