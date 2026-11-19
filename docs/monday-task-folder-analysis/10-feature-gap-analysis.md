# 10. Feature-by-feature gap analysis

Classes: **Implemented** (works and was checked in code), **Partially Implemented**, **UI Only**, **Backend Only**, **Missing**, **Incorrect** (behaviour differs from monday), **Needs Verification** (monday side unreadable or CRM+ side not testable here). Priority: High, Medium, Low. A-numbers are the automations of document 05.

Files: `TB` = `src/lib/taskBoards.ts`, `TQ` = `src/pages/tasks/TaskQueue.tsx`, `TF` = `src/pages/tasks/TaskForm.tsx`, `TD` = `src/pages/tasks/TaskDetail.tsx`, `CQ` = `src/pages/tasks/ChequeQueue.tsx`, `M1` = `supabase/migrations/20261118100000_tasks_module.sql`, `M3` = `...100200_tasks_scheduler.sql`, `M4` = `20261119100000_task_boards_monday_parity.sql`.

| ID | Feature | monday behaviour | Current implementation | Class | Gap | Priority |
|---|---|---|---|---|---|---|
| F-01 | Folder with 7 boards | 7 separate boards in folder Tasks | Sidebar group Tasks, 7 links to `/tasks?view=`; one page `Tasks.tsx` | Partially Implemented | Boards are tabs of one module, not separate registers | Medium |
| F-02 | Column titles and order per board | as document 02 | `TB` columns; production check showed 14/16/15/12/15/16/13 columns | Implemented | none | Low |
| F-03 | Status labels per board | Mill Working on it/Stuck/Done; Cheque 4; Sample Pending/Approved/Rejected | `TB.statusLabels`, `STATUS_OPTIONS`, `details` selects; Mill maps five generic states onto three labels | Partially Implemented | Mill status mapping loses "todo vs in progress"; Sample Type is free text (monday: TBD 1..3 placeholders) | Medium |
| F-04 | Cheque groups To Collect / In Progress / Collected | three groups | `CQ` groups derived from status | Implemented | monday groups are not driven by status; CRM+ derives them (acceptable) | Low |
| F-05 | Subitems on Payment Collection and Cheque Collection | Subitems column, default columns, no data | `task_subitems` table + RLS (M4); no screen, no import | Backend Only | UI to add/edit subitems | Low |
| F-06 | Item numbering | monday item ids; free names | `task_no` TASK-YYYY-nnnn, `title` | Implemented | none | Low |
| F-07 | Typed board-specific fields | typed columns (status, numbers, dates) | `tasks.details` jsonb with per-key checks (`task_details_problem`) | Partially Implemented | No typed columns, FKs, indexes per board | High |
| F-08 | Creation form fields per board | form view with the board's columns | `TF` common fields + `TB.fields` | Partially Implemented | Sections/order of monday not replicated | High |
| F-09 | Form sections, labels, required marks identical to monday | Creation Form app views | `TF`, `TB.fields` follow column titles | Needs Verification | monday forms unreadable; read with an editor session | High |
| F-10 | Edit and row Actions | edit in table/card | `TQ` row Actions (Open, Start, Complete, Block, Reassign, Mark delivered/cleared, Approve/Reject feedback, Record payment, Cancel, Reopen) + `TD` drawer | Implemented | none | Low |
| F-11 | Person as multiple people | People column accepts several | single `assigned_to` | Partially Implemented | one person only; acceptable unless several messengers per buyer | Low |
| F-12 | Accounts people | Accounts column | `accounts_staff_id` | Implemented | none | Low |
| F-13 | Person from buyer Messenger | A-21..A-30: Person := Messenger on create **and when the buyer changes**; Accounts manual | `trg_task_defaults`: `coalesce(messenger, collection staff, sales person)` only when Person is empty; also fills Accounts from collection staff (M4) | Incorrect | fallbacks and Accounts auto-fill do not exist in monday; monday overwrites Person on buyer change | High |
| F-14 | Mirrors (messengers, supplier, invoice no/date, commission amount) | mirror columns | `board_*` views; grid columns in `TQ` via joins | Implemented | broken monday mirrors intentionally not copied | Low |
| F-15 | Formulas Balance, Days Aging, Feedback Due | formulas | `balanceOf`, `daysAging`, `feedbackDueDate` (`TQ`, `lib/tasks.ts`); views | Implemented | none | Low |
| F-16 | GPS check-in | location column | `GeoCapture` + `task_check_in`; `lat/lng` | Implemented | none | Low |
| F-17 | Check-in / check-out times (Monthly Visit) | two date-time columns | `check_in_at/check_out_at`, `task_check_out` | Implemented | none | Low |
| F-18 | Proof / photo upload | file column per board | `task_attachments` + `ProofUpload` + bucket | Implemented | multiple files per task (monday: one column) is a superset | Low |
| F-19 | Meeting summary / notes | long text | `details.visit_summary`, `notes` | Implemented | none | Low |
| F-20 | Link Monthly Visit <-> Payment Collection | two-way relation | `source_task_id` one way; `board_monthly_visit.payment_collection_id` derives back | Partially Implemented | no picker; one open follow-up per buyer (monday: one per step) | Medium |
| F-21 | Link Commission Invoice Delivery <-> Payment Collection | two-way | `source_task_id` | Partially Implemented | same | Medium |
| F-22 | Commission Invoices <-> Commission Invoice Delivery | two-way | `tasks.commission_invoice_id`; `commission_invoice_tasks()` | Implemented | none | Low |
| F-23 | Dispatch and Billing <-> Mill Invoice Delivery | two-way; D&B creates the row | `tasks.dispatch_id`; `dispatch_tasks()` | Implemented | none | Low |
| F-24 | Transport Invoice <-> Freight | Transport Invoice creates the row, two-way | freight task created from `order_dispatches.transporter_invoice_no`; no Transport Invoice register | Missing | needs Transport Invoice entity (master plan Group 5) | Medium |
| F-25 | Buyer / supplier relations | relation columns | `buyer_id`, `supplier_id` | Implemented | none | Low |
| F-26 | Relation pickers in forms | pick linked items | buyer, order, assignee pickers in `TF`; no picker for visit/payment/commission links | Partially Implemented | add link pickers | Medium |
| F-27 | A-1 Created Date stamped on create | automation | `tasks.start_date` default today | Implemented | none | Low |
| F-28 | A-2 "You have not visited yet." | Created Date at 17:45 IST, status Not Visited, Person + Accounts | `run_task_rules` `visit_not_visited`: due_date <= today and status todo/blocked and visit planned; recipient Person only | Incorrect | trigger date (due date = creation + 30 days), time, and Accounts recipient differ | High |
| F-29 | A-3 visited reminder +30 days | Visited Date + 30 days at 10:00, status Visited, **no** pending-payment check, Person + Accounts | `visit_visited_reminder` requires `pending_payment = true`; Person only | Incorrect | remove the pending condition, add Accounts | High |
| F-30 | A-4..A-9 30/45/60-day escalation | Pending = Yes, Visited or Not Visited; creates a Payment Collection item per step; offsets unverified | escalation rule days [30,45,60], priority raised, **one open follow-up per buyer**, notification per watcher | Partially Implemented | offset confirmation, per-step creation (or keep per-buyer by decision), Completed excluded check | Medium |
| F-31 | A-10 proof -> Delivered + notify Accounts | text "Hey, {name}, Mill Invoice is delivered"; Invoice Status := Delivered; status unchanged | `auto_done_on_proof` sets generic status done + `delivery_status`; notifies watchers "Delivered: title" except actor | Partially Implemented | wording, recipient (Accounts), do not complete the generic status | Medium |
| F-32 | A-11 commission pending payment | Created Date at 18:30 IST, Pending = Yes, notify Person + Accounts, create Payment Collection "Commission Invoice - {name}" | escalation rule days [0], base date check-in/visited/start date | Partially Implemented | time of day; base is `start_date` not Created Date; title format ok | Medium |
| F-33 | A-13 Start Date on create | automation | `start_date` default today | Implemented | none | Low |
| F-34 | A-14 Amount collected notification | Amount Collected > 0 notifies Person + Accounts | `task_payment_after` notifies watchers except actor | Implemented | actor is not notified (improvement) | Low |
| F-35 | A-15 End Date on Completed | automation | `completed_at` when status done; column End Date | Implemented | Payment Status = generic status | Low |
| F-36 | A-17 cheque photo -> Collected + notify Accounts | automation | `task_cheque_guard` + `cheque_collected_notify` | Implemented | none | Low |
| F-37 | A-18 freight Check = Outstanding | notify Person + Accounts | `freight_check_notify` | Implemented | none | Low |
| F-38 | A-19 Sample Approved -> Qualified lead | broken in monday (target deleted) | none | Missing | intentionally not built; decide whether leads module should receive approved samples | Low |
| F-39 | A-20 sample feedback due at +7 days | Delivery Date + 7 at 20:30 IST, status Pending | `sample_feedback_due` after_days 7 | Implemented | time of day (F-40) | Low |
| F-40 | Time of day for date triggers | 17:45, 18:00, 18:15, 18:30, 20:30, 22:15, 22:45 IST | `run_task_rules` works on dates; cron every 15 min | Missing | no time-of-day field in rule config or condition | Medium |
| F-41 | Rules editable as data | recipes editable by owners | `task_rules` (thresholds, active flag), `RulesPanel` | Partially Implemented | rule logic is SQL; no trigger/condition/action model | Medium |
| F-42 | Automation execution history | per-automation history (0 recorded) | `task_events` for some steps, no per-run log | Missing | `task_rule_runs` log | Medium |
| F-43 | Duplicate-run prevention | none (except platform) | `dedupe_key` on tasks/events/notifications | Implemented | better than monday | Low |
| F-44 | Message sending retries and failure state | n/a in Tasks folder | `send-message` 3 attempts, `manual` fallback | Implemented | none | Low |
| F-45 | In-app notifications | bell | `notifications`, realtime, `NotificationBell` | Implemented | none | Low |
| F-46 | E-mail / push copy of notifications | per-user monday setting | none (manual WhatsApp/e-mail sender) | Needs Verification | monday user setting unread | Low |
| F-47 | Table with search, filter, sort | standard | `TQ` search, quick filters, sort, CSV | Implemented | none | Low |
| F-48 | Bulk edit | standard | `task_set_status_many`, `task_assign_many` | Implemented | none | Low |
| F-49 | Item detail with updates, files, activity | item card | `TD` tabs: details, proof, payments, cheque, messages, timeline | Implemented | none | Low |
| F-50 | "Reports" / "Dashboard" views per board | dashboards (contents unread) | `boardSummary` cards, `TaskOverview`, collection dashboard | Needs Verification | read widgets, then match | Medium |
| F-51 | Build Vibe / "Commission Invoice From" app views | custom app views (unread) | none | Needs Verification | read, then decide | Low |
| F-52 | Phone-first field use | mobile app | `MyTasks`, `FieldTaskCard`, `GeoCapture` | Implemented | none | Low |
| F-53 | Access model | public boards, everyone edits | 5 permissions + RLS | Implemented | stricter; accepted | Low |
| F-54 | Typed board read model in the UI | n/a | `board_*` views defined; no `from('board_...')` in `src` | Backend Only | switch grids to the views (after F-07) | Medium |
| F-55 | Import of the 82 monday rows | n/a | none | Missing | optional one-off import | Low |
| F-56 | Automated tests | n/a | none (no test script or files) | Missing | add SQL and UI tests (document 12) | High |

## Totals (generated from this table)

| Class | Count |
|---|---|
| Implemented | 29 |
| Partially Implemented | 12 |
| Backend Only | 2 (F-05 subitems, F-54 typed views) |
| UI Only | 0 |
| Incorrect | 3 (F-13, F-28, F-29) |
| Missing | 6 (F-24, F-38, F-40, F-42, F-55, F-56) |
| Needs Verification | 4 (F-09, F-46, F-50, F-51) |
| **Total** | **56** |

## Reading the table

- The **High** items are: F-07, F-08/F-09 (forms), F-13 (assignment), F-28/F-29 (two wrong visit reminders), F-56 (tests).
- Items marked Needs Verification are blocked on monday reads that need an editor/admin session (document 11, Phase 0).
- "Incorrect" means CRM+ does something different **and** a user of monday would notice; every Incorrect item has a fix in document 11.


## Implementation status after the first build (2026-11-19)

Code is in the working tree; the database part is `supabase/migrations/20261120100000_task_rules_monday_timing.sql` (not yet applied) with tests in `supabase/tests/task_rules_monday_timing.test.sql` (written, not yet run). "Built" means typechecked and built; the database behaviour is verified only after the migration is applied and the test script is run.

| ID | Was | Now | What was built |
|---|---|---|---|
| F-05 | Backend Only | Implemented | `TaskSubitems.tsx`, shown in the task detail of Payment Collection and Cheque Collection |
| F-13 | Incorrect | Implemented | Person = the buyer's active Messenger only, on create and on buyer change; Accounts never automatic (`task_defaults`, `default_task_assignee`; `TaskForm.pickBuyer`) |
| F-20, F-21 | Partially | Implemented | "Connected Boards" picker on the Payment Collection form (`source_task_id`); each visit/commission delivery shows its payments and each payment its source (already in the detail) |
| F-26 | Partially | Implemented | the picker above; link columns on both sides |
| F-28 | Incorrect | Implemented | A-2 on the Created Date (`start_date`) at 17:45 IST, Person + Accounts, status Not Visited |
| F-29 | Incorrect | Implemented | A-3 Visited Date + 30 days at 10:00 IST, status Visited, no pending-payment test, Person + Accounts |
| F-30 | Partially | Implemented | A-4..A-9: Visited-Date branch and Created-Date branch, 30/45/60 days, times 18:00/22:15/22:45 and 18:15/22:15/22:45 from monday, Completed excluded, one Payment Collection per step (D7 default; `one_followup_per_buyer` switch kept). Offsets stay **unverified** in monday and are data in the rule |
| F-31 | Partially | Implemented | mill proof sets Invoice Status = Delivered, leaves Status alone, tells Accounts "Mill Invoice is delivered"; delivered mill tasks no longer raise overdue |
| F-32 | Partially | Implemented | A-11 at 18:30 IST on the Created Date |
| F-40 | Missing | Implemented | `task_rule_due()` and per-rule `time` / `window_days`; editable in Tasks > Rules |
| F-42 | Missing | Implemented | `task_rule_runs` (fired, failed, one summary per run), per-item error isolation, "Rule log" card in Tasks > Rules |
| F-56 | Missing | Partially Implemented | SQL test script for A-2, A-3, A-4/A-5, A-7, A-4b, A-10, A-11, A-20, A-21 and the log; no UI tests yet |

Still open (not built, and why):

| ID | Feature | Reason |
|---|---|---|
| F-01, F-03, F-08, F-09 | Separate registers, status words, form sections | monday creation forms are unreadable without an editor session (T-00); built from guesswork they would be wrong |
| F-07, F-54 | Typed detail tables and grids on the `board_*` views | rewrites every write path; best done together with the forms (T-04, T-07, T-08) |
| F-11 | Several people in Person | not used by monday data seen; low |
| F-24 | Transport Invoice link | needs the Transport Invoice register (master plan Group 5) |
| F-38 | Sample approved creates a lead | monday's target board is deleted; decision D9 default is "no" |
| F-41 | Rules as a full data model | only time, window and thresholds are data; trigger/condition/action editor not built |
| F-46, F-50, F-51 | Notification e-mail, Reports, app views | unread in monday |
| F-55 | Import of the 82 monday rows | optional |

Totals after this build: Implemented 41, Partially Implemented 7, Backend Only 1, Incorrect 0, Missing 3, Needs Verification 4 (total 56).
