# Implementation status (audit of the first build + this round)

Date: 2026-11-19. Branch `Testing`, nothing committed (the first build and this round are uncommitted work in the tree). Evidence: source files, the migration read line by line, a PostgreSQL parser check of the migration and test script (syntax and PL/pgSQL bodies parse), `tsc -b` and `vite build` (both pass), live read-only queries (migration **not applied**: no `task_rule_runs` table, no `task_rule_due()` function, `visit_not_visited` still `{"after_days": 0}`), and the monday read-only inspection (see the other documents).

No SQL test has been **run** (no staging database exists: `list_branches` is empty), and the UI was not opened in a browser, so no feature below is "Tested". Status words: *Implemented but unverified* = code exists and reviews clean, never executed.

## The 12 reported features

| ID | Feature | Review result | Status |
|---|---|---|---|
| F-28 | Not-visited reminder on the creation day, 17:45 IST, Person + Accounts | `run_task_rules` uses `start_date` + `after_days` + `time`, status `planned`/`missed`, key `visit_missed:<id>:<start_date>:<user>`. Matches monday's stored config (Created Date, 17:45, Not Visited, notify Person + Accounts). Needs the migration | **Implemented but unverified** |
| F-29 | 30-day visited reminder, no pending condition | base = visited day (`visited_on`, else check-in date), offset 30, 10:00, status `visited` only; matches A-3 | **Implemented but unverified** |
| F-40 | IST time of day, configurable | `task_rule_due()` (IST, 2-day window), `time` editable in Tasks > Rules with HH:MM validation. The window means a date missed by more than 2 days is skipped (monday also fires once) | **Implemented but unverified** |
| F-30 | 30/45/60-day escalation, both branches, one Payment Collection per step | Branches, texts, Completed excluded, per-step creation, per-step dedupe correct **against monday's wording and conditions**. **Offsets differ from monday's stored configuration** (see `automation-offset-verification.md`): migration applies 30/45/60 days, monday stores none | **Partially implemented** (offset decision open) |
| F-32 | Commission 18:30 and sample 20:30 IST | rule settings `time` "18:30" / "20:30", base `start_date` / `delivery_date + 7` | **Implemented but unverified** |
| F-13 | Person = buyer Messenger only; Accounts manual | trigger and form updated. **Finding:** a buyer with no active Messenger now leaves Person empty, and the overdue rule needs a Person, so such tasks never raise "overdue" (previous code fell back to collection staff). Decision D8 | **Implemented but unverified**, with a regression to decide |
| F-31 | Mill proof: Invoice Status Delivered, Accounts told, Status unchanged | trigger branch for `mill_invoice_delivery`; delivered mill tasks excluded from overdue. Wording/recipient match A-10 | **Implemented but unverified** |
| F-42 | Rule log, one failed row does not stop the run | `task_rule_runs` (RLS: read for `task.manage`, writes only by security-definer functions), per-item `BEGIN ... EXCEPTION`, summary row per run, retention 14/90 days; Rules panel card degrades with a message when the table is missing | **Implemented but unverified** |
| F-05 | Subitems | `TaskSubitems.tsx` + existing `task_subitems` RLS (`task_can`); shown for `payment_collection` and `cheque_collection`; delete asks to confirm | **Implemented but unverified** |
| F-20 | Connected Boards picker | picker on the Payment Collection form lists the latest 300 visits and commission deliveries; writes `tasks.source_task_id` (managers only; the guard blocks others) | **Implemented but unverified** |
| F-21 | Connected Boards relationship | the relation is **one source per payment**. monday's "Connected Boards" is a multi-item, two-board relation. Two-way display exists (source on the payment, payments on the source) | **Partially implemented** |
| F-26 | Connected Boards integration | creation by escalation links `source_task_id`; manual link through the picker; no second link target | **Partially implemented** |

Totals of the 12: implemented but unverified 9; partially 3; incorrect 0.

Issues found in the review (not yet fixed because each is a decision):
1. F-13 regression: no fallback assignee (above).
2. F-30 offsets: stored monday config has none (above).
3. F-21/F-26 single source versus monday's multi-link.
4. The window (2 days) makes a rule silent if the scheduler is down longer than that; the Rule log "last run" line shows it.

## Built in this round

| ID | Feature | What | Status |
|---|---|---|---|
| F-09/F-08 | Creation forms | the seven forms were **read** (see `creation-forms-specification.md`); section headings per board and the read-only mirrored invoice number/date on Mill built | **In progress** (differences documented, decision on field forms open) |
| F-50 | Reports | `TaskReport.tsx`: "Count by person" bars stacked by the board's status, from the rows on screen | **Implemented but unverified** (monday's widget filters unreadable) |
| F-51 | App views | inspected: "Build Vibe view" is an empty prompt screen and "Commission Invoice From" shows "temporarily unavailable"; nothing to reproduce | **Verified, nothing to build** |
| F-56 | Tests | e2e plan written (`e2e-test-plan.md`); no framework in the repo | **In progress** |
| Monday facts | automation offsets, run history, report widgets, forms | documents above | **Verified against monday** |

## Not built this round

See `remaining-feature-analysis.md` and `final-feature-matrix.md`. In short: typed columns and grid rewrite (F-07, F-54: architecture proposed, not built), separate registers (F-01), rules engine (F-41: Option A recommended), multiple people (F-11), Transport Invoice link (F-24), approved-sample lead (F-38), notification e-mail (F-46), data import (F-55).
