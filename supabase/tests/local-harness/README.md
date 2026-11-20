# Local test harness (throwaway Postgres, no database needed)

Runs the real Tasks migrations and the SQL tests in an in-memory Postgres (PGlite, WebAssembly), so the
automations can be tested without a staging database and without touching production.

```powershell
cd supabase/tests/local-harness
npm install --no-save @electric-sql/pglite
node run.mjs ../task_rules_monday_timing.test.sql ../task_boards_automations.test.sql ../task_monthly_visit_and_links.test.sql
```

What it does: creates stand-in base tables (`bootstrap.sql`: profiles, buyers, orders, dispatches, ...), applies
the Tasks migrations in order (tasks module, scheduler, board parity, rules timing, the Dispatch and Billing
creation part of CRM automations round 2, the cheque and mill fixes), re-applies the newest ones to prove they are
safe to run twice, then runs each test file and prints every passed check. A failed check stops that file and
prints its message.

Limits: the base tables are simplified stand-ins (only the columns the Tasks automations read), so this proves
the Tasks logic, not the whole schema. Run the same test files on a real staging database before production.
