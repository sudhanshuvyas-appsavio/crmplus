import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

const repo = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '')
const mig = (f) => fs.readFileSync(`${repo}/supabase/migrations/${f}`, 'utf8')
const db = new PGlite()

async function run(label, sql) {
  try {
    await db.exec(sql)
    console.log('OK   ', label)
    return true
  } catch (e) {
    console.log('FAIL ', label, '\n      ', String(e.message).split('\n')[0])
    return false
  }
}

const steps = [
  ['bootstrap', fs.readFileSync(new URL('./bootstrap.sql', import.meta.url), 'utf8')],
  ['tasks_module', mig('20261118100000_tasks_module.sql')],
  ['tasks_scheduler', mig('20261118100200_tasks_scheduler.sql')],
  ['task_boards_monday_parity', mig('20261119100000_task_boards_monday_parity.sql')],
  ['task_rules_monday_timing', mig('20261120100000_task_rules_monday_timing.sql')],
  ...(process.env.NOCHQFIX ? [] : [['cheque_collected_notify_on_any_update', mig('20261120150000_cheque_collected_notify_on_any_update.sql')]]),
]
for (const [l, s] of steps) if (!(await run(l, s))) process.exit(1)

// the teammate's round-2 section 4 (orders create the Mill task) and its dispatch_tasks()
const r2 = mig('20261120110000_crm_automations_round2.sql')
const a = r2.indexOf('create or replace function public.orders_mill_invoice_task()')
const b = r2.indexOf('-- 5. The existing CRM automations write')
let r2sql = r2.slice(a, b)
if (process.env.FIX) r2sql = r2sql.replace("set dispatch_id = new.id,", "set dispatch_id = new.id, dedupe_key = 'mill_inv:' || new.id,")
if (a > 0 && b > a) await run('round2: orders_mill_invoice_task + dispatch_tasks' + (process.env.FIX ? ' (WITH one-line fix)' : ''), r2sql)

await run('seed', `insert into profiles (id, name) values ('00000000-0000-0000-0000-000000000001','Person One'),('00000000-0000-0000-0000-000000000002','Accounts Two'),('00000000-0000-0000-0000-000000000003','Messenger Three'); insert into buyer_master (name) values ('Test Buyer');`)

await run('grants', `grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated; grant execute on all functions in schema public to authenticated;`)

if (!process.env.FIX) await run('migration 20261120151000 mill invoice edit fix', mig('20261120151000_mill_invoice_edit_no_duplicate.sql'))

// idempotency: apply my migrations a second time
await run('re-run 20261120100000 (idempotency)', mig('20261120100000_task_rules_monday_timing.sql'))
await run('re-run 20261120150000 (idempotency)', mig('20261120150000_cheque_collected_notify_on_any_update.sql'))
await run('re-run 20261120151000 (idempotency)', mig('20261120151000_mill_invoice_edit_no_duplicate.sql'))

// test files: strip begin/rollback and turn NOTICE passes into rows we can read
const files = process.argv.slice(2)
for (const f of files) {
  let t = fs.readFileSync(f, 'utf8')
  t = t.replace(/^begin;$/gim, '').replace(/^rollback;$/gim, '')
  t = t.replace(/raise notice '([^']*)';/g, "perform public.t_ok('$1');")
  const ok = await run('test file ' + f.split(/[\\/]/).pop(), t)
}
const log = await db.query('select msg from public.t_log order by id')
console.log('\nPASSED CHECKS:'); for (const r of log.rows) console.log('  ' + r.msg)
