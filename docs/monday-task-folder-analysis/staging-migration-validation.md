# Staging migration validation

## State
- Production has **not** been touched: only read queries ran (migration presence check). The migration `supabase/migrations/20261120100000_task_rules_monday_timing.sql` is **not applied** anywhere.
- No staging database exists: `list_branches` returned no branches and no staging connection is configured. Nothing was applied or run, and production was **not** used as a substitute. The steps below are for an authorised operator.

## Static review of the migration (done)

| Check | Result |
|---|---|
| SQL syntax | 28 statements parse; 6 PL/pgSQL bodies parse (pglast) |
| Idempotency | `create table/index if not exists`, `create or replace function`, `drop policy if exists` + create, rule updates written as `defaults || config` (existing keys win), label update repeatable. Re-running changes nothing |
| Existing schema | uses `tasks`, `task_events`, `notifications`, `task_rules`, `profiles`, `buyer_master`, `task_cheques`, `task_attachments`, helpers `task_watchers`, `notify_user`, `task_log`, `has_permission` (all exist in earlier migrations) |
| Objects added | table `task_rule_runs` (+2 indexes, RLS, read policy for `task.manage`); functions `task_rule_log`, `task_rule_due`, `task_visited_day`, `notify_user_new`, `task_rule_notify` |
| Objects replaced | `default_task_assignee`, `task_defaults`, `task_attachment_after`, `run_task_rules` (same signatures, so triggers and cron keep working) |
| Permissions | internal functions revoked from `public, anon, authenticated`; `task_rule_due` and `task_visited_day` are pure helpers left callable |
| RLS | no insert/update/delete policy on `task_rule_runs`: only security-definer code writes |
| Time zone | `Asia/Kolkata` written explicitly everywhere |
| Duplicate prevention | notification key `(user_id, dedupe_key)`, escalation step key `esc:<task>:<days>` in `task_events` and on the created payment task |
| Transactions | each item runs inside `BEGIN ... EXCEPTION`, so a failing item rolls back its own step and the run continues |
| Behaviour changes | Person from Messenger only (new dispatch-created tasks); mill proof no longer completes the task; escalation creates one payment task per step; reminders at monday's times |

Review findings that need a decision before applying: F-13 fallback (tasks of buyers without a Messenger have no Person and never raise "overdue"), and the escalation offsets (`automation-offset-verification.md`).

## Operator steps (staging only)

Run from a shell with `STAGING_DB_URL` pointing at the staging database. Check first: `psql "$STAGING_DB_URL" -c "select current_database(), inet_server_addr()"` must show the staging server.

```powershell
psql "$env:STAGING_DB_URL" -c "select version from supabase_migrations.schema_migrations order by version desc limit 5"
psql "$env:STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261120100000_task_rules_monday_timing.sql
psql "$env:STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261120100000_task_rules_monday_timing.sql
psql "$env:STAGING_DB_URL" -c "select rule_key, config from task_rules order by rule_key"
psql "$env:STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/task_rules_monday_timing.test.sql
```
The second run proves re-execution is safe; the last command runs the tests, which roll back what they create (look for the `ok TC-...` notices and no error). After it:

```powershell
psql "$env:STAGING_DB_URL" -c "select count(*) from task_rule_runs"      -- expect 0 (rolled back)
psql "$env:STAGING_DB_URL" -c "select count(*) from tasks where title like 'TEST %'"   -- expect 0
```

## Test coverage of the SQL script, against the checklist

| Required | Covered? |
|---|---|
| First execution, repeated execution, duplicate prevention | yes (TC-A2, TC-A4, TC-G4) |
| Several rules in one run | yes (the same run fires visits, commission, sample rows) |
| IST time, date boundaries, windows | partly: before/after the time, next-day window (`task_rule_due` cases); the 2-day cut-off has one case |
| One failing row, continuing | **no**: needs a row that raises (e.g. an inactive assignee). Add before relying on F-42 |
| Missing related records, invalid data | partly (no buyer, no Accounts) |
| Concurrent execution | **no**: needs two sessions; dedupe keys make it safe by construction, not tested |
| Existing rule configuration | partly (defaults only) |
| Leaves nothing behind | yes (one transaction, `rollback`) |

## Rollback / recovery
- Data: the script and the migration create nothing that is not removable. `drop table public.task_rule_runs;` removes the log.
- Functions: re-apply the earlier definitions: `default_task_assignee`, `task_defaults`, `run_task_rules` from `20261119100000_task_boards_monday_parity.sql` and `task_attachment_after` from `20261118100000_tasks_module.sql` (extract those `create or replace function` blocks and run them).
- Rule settings: remove the new keys (`time`, `window_days`, `visited`, `not_visited`, `one_followup_per_buyer`) with `update task_rules set config = config - 'time' - 'window_days' ...`.
- Not rehearsed on a database (none available): rehearse on staging before production.
