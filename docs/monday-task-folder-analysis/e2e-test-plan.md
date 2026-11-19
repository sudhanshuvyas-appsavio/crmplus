# UI and end-to-end test plan (F-56)

## Environment requirements (not available today)
- A **staging** Supabase project with all migrations through `20261120100000` and seed users: one `task.manage` (Accounts), one `task.work` only (field staff), one `task.read` only (Sales), plus buyers with and without a Messenger, a dispatch, a commission invoice.
- A staging deployment (or `vite` pointing at staging keys) and a **signed-in staging test account** per role. Production accounts and records are never used.
- A test framework: none exists in the repo (`package.json` has no test script). Recommended: Playwright (`@playwright/test`), `e2e/` folder, `npm run e2e`; a staging Resend key only (or e-mail disabled) so no real customer receives anything.
- Time control: SQL-level (`run_task_rules(p_now)`), not browser clock.

## Execution
Per spec file: log in as the role, perform the steps through the UI, assert on visible text and on the database through a read-only service helper. Each test creates its own `E2E-` prefixed rows and deletes them at the end (staging only).

## Specs

| # | Area | Steps and assertions |
|---|---|---|
| 1 | Seven creation forms | for each board: open "New ..." from the register; assert section headings and field labels per `creation-forms-specification.md`; required marks; save with missing title -> error names the field; save valid -> row appears; double-click save creates one row |
| 2 | Board registers | each sidebar link opens its register; columns equal the board's list; search, filter, sort, CSV export |
| 3 | Typed columns (after F-07) | invalid status label rejected; date/number inputs typed |
| 4 | Status updates | Start, Block, Complete, Reopen; Mill "Mark delivered" sets Invoice Status without changing Status |
| 5 | Subitems | add, change status, delete on a payment task and a cheque task; absent on a visit |
| 6 | Connected Boards | create a payment with a visit as source; visit detail shows the payment; payment detail shows the visit; cleared source |
| 7 | Cross-board | dispatch with a mill invoice number creates one Mill task; commission invoice creates one task; repeat saves create no duplicates |
| 8 | Rule configuration | Tasks > Rules: change a time to 17:50, invalid "25:99" rejected, save, reload shows the value; non-manager sees read-only |
| 9 | Rule log | call `run_task_rules` with a simulated date; the Rule log lists the fired rule and a summary row; second call adds none |
| 10 | Reports | "Count by person" totals equal the row count for each board, and change with the filter |
| 11 | Notifications | bell shows the notification with monday's wording; marking read persists; no duplicate after a second run |
| 12 | Permissions | field staff sees only own tasks and cannot reassign or edit amounts; Sales sees all, cannot edit; Accounts manages; Rules/Messages tabs hidden for non-managers |

## Failure scenarios (from the brief)
Missing required fields, invalid statuses, duplicate records, duplicate automation events (second run), concurrent updates (two browser contexts recording payments), deleted connected records, unauthorised users, failed notifications (inactive recipient), worker failure (one poisoned row), time-zone boundaries (23:59/00:01 IST), partial failure (escalation with a dedupe collision), repeated rule execution, automation loops (five consecutive runs: counts stop growing).

## Status
Plan only. Nothing here has been run: no framework, no staging, no signed-in staging account. The SQL script `supabase/tests/task_rules_monday_timing.test.sql` covers the rule logic once a staging database exists.
