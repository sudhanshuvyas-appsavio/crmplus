# 11. Implementation roadmap

Planning only: nothing here has been built. Phases follow the real findings (documents 05, 08, 10); phases that do not apply (Kanban, Gantt, workload, saved views, private boards) are left out on purpose.

## 11.1 Decisions this plan rests on

| # | Decision | Reason |
|---|---|---|
| D1 | **Keep the `tasks` engine, add typed 1:1 detail tables per board** (not seven standalone tables) | `task_can`, timeline, proof, payments, notifications, messages, field view and RLS are keyed on `tasks.id`; typed detail tables give real columns, constraints and foreign keys without rebuilding them |
| D2 | Boards read from the **`board_*` views** (already written) | typed read model per board, with mirrors and formulas |
| D3 | Rules stay in the database, thresholds, **time of day** and recipients as data in `task_rules.config` | reliable, idempotent, auditable; no new service |
| D4 | monday's wording and timing are reproduced **exactly** where monday's configuration is read; where unverified, a rule ships off by default until confirmed | avoids notifying the field team wrongly |
| D5 | Do not copy monday defects: broken mirrors (Buyer Name, Freight Buyer), the Sample-to-lead automation (target deleted), the inactive automations A-12 and A-16, the copy error in A-9's text | |
| D6 | CRM+ stays stricter than monday on permissions (document 07) | |

## 11.2 Phases and sequence

| Phase | Content | Tasks | Milestone |
|---|---|---|---|
| 0. Confirm | Read unread monday items with an editor session; decide open questions | T-00 | Forms, offsets, recipients, dashboards documented |
| 1. Behaviour fixes | Correct the three Incorrect items and wording | T-01, T-02, T-03 | Rules match monday text and timing for visits, mill, commission |
| 2. Foundation | Typed detail tables, relations, subitems | T-04, T-05, T-06 | No board field lives in `details` |
| 3. Board functionality | Forms, grids on views, Actions, dashboards | T-07, T-08, T-09 | Each board looks and creates like monday |
| 4. Workflow and automation engine | Time of day, run log, escalation rework, rule model | T-10, T-11, T-12, T-13 | Every A-number reproduced and auditable |
| 5. Cross-module | Transport Invoice link, sample-to-lead decision, monday import | T-14, T-15, T-16 | Links match monday |
| 6. Permissions | Profile template review (no model change) | T-17 | Field staff, Accounts, Sales verified |
| 7. Testing | SQL tests, UI smoke tests, production parity check | T-18, T-19 | Document 12 passes |
| 8. Cut-over | Docs, release, single push | T-20 | Production matches monday |

Order: T-00 -> T-01/T-02/T-03 (independent, parallel) -> T-04 -> T-05/T-06 -> T-07/T-08 -> T-09 -> T-10 -> T-11 -> T-12 -> T-13 -> T-14..T-16 -> T-17 -> T-18/T-19 -> T-20. T-18 starts alongside T-01 (tests are written with each change).

Complexity: S = under a day, M = 1-3 days, L = 3-6 days, XL = more than a week.

---

## 11.3 Task cards

### T-00. Confirm the unread monday configuration
1. **Task ID** T-00 2. **Feature** Read creation forms, dashboards, app views, offsets, recipients 3. **Business requirement** Build forms and rules from fact, not inference 4. **monday reference** Views listed in document 06; automation A-4..A-9 offsets; A-11 Person recipient; which people column is People vs Accounts; viewer/guest access 5. **Current** Unread 6. **Required changes** Sign in to monday as an editor/admin and read (screenshots, form editor, automation editor in view mode) without changing anything; record sections, required marks, defaults, widget list, offsets 7. **Frontend files** none 8. **Backend files** none 9. **DB changes** none 10. **API changes** none 11. **Dependencies** an editor/admin monday session 12. **Acceptance** `02`, `05`, `06` updated; each "unverified" line closed or confirmed inaccessible 13. **Tests** n/a 14. **Complexity** M 15. **Priority** High 16. **Sequence** 1

### T-01. Correct the two visit reminders
1. **ID** T-01 2. **Feature** A-2 "You have not visited yet.", A-3 visited reminder (F-28, F-29) 3. **Requirement** Reminders reach Person and Accounts at monday's moment 4. **monday** A-2: Created Date at 17:45 IST, status Not Visited. A-3: Visited Date + 30 days at 10:00 IST, status Visited, no pending-payment condition 5. **Current** `run_task_rules`: not-visited uses `due_date` (default +30 days) and Person only; visited reminder requires `pending_payment` 6. **Changes** Base A-2 on `start_date` (Created Date); recipients Person + Accounts via `task_watchers`; remove `pending_payment` from A-3, add Accounts; keep dedupe keys per recipient 7. **Frontend** `src/pages/tasks/RulesPanel.tsx` labels only 8. **Backend** new migration redefining `run_task_rules` 9. **DB** `task_rules` rows updated (`visit_not_visited` config `{"time":"17:45"}` once T-10 exists; until then fires at date) 10. **API** none 11. **Deps** T-10 for the time; works without it 12. **Acceptance** A visit created today and still planned gets one "You have not visited yet." for Person and Accounts the same day; a Visited visit gets the 30-day reminder with no pending flag; second run sends nothing 13. **Tests** TC-A2-*, TC-A3-* (document 12) 14. **Complexity** S 15. **Priority** High 16. **Sequence** 2

### T-02. Person and Accounts assignment exactly as monday
1. **ID** T-02 2. **Feature** F-13 3. **Requirement** Person = the buyer's Messenger; Accounts typed 4. **monday** A-21..A-30: on create and on buyer change, Person := Messenger; no fallback; Accounts never automatic 5. **Current** `task_defaults()`: Person = messenger, else collection staff, else sales person; sets Person only when empty; also sets Accounts from collection staff 6. **Changes** Person := `buyer_master.messenger_id` on insert and when `buyer_id` changes (overwrite); no Accounts default; keep a *notification* fallback to managers when nobody is assigned (existing `task_watchers`); product decision recorded: fallback to collection staff only if the business asks 7. **Frontend** `TaskForm.tsx` (Person prefill hint) 8. **Backend** migration replacing `default_task_assignee`/`task_defaults` 9. **DB** none 10. **API** none 11. **Deps** none 12. **Acceptance** Create a task for a buyer with a Messenger: Person = Messenger, Accounts empty; change buyer: Person follows; buyer without Messenger: Person empty 13. **Tests** TC-A21-* 14. **Complexity** S 15. **Priority** High 16. **Sequence** 2

### T-03. monday's wording and recipients for mill proof and commission pending payment
1. **ID** T-03 2. **Feature** F-31, F-32 3. **Requirement** Same message and audience 4. **monday** A-10 notifies Accounts "Hey, {name}, Mill Invoice is delivered" and sets Invoice Status only; A-11 "Payment is pending for this record." 5. **Current** proof auto-completes the generic status and notifies watchers except the actor with "Delivered: ..." 6. **Changes** For `mill_invoice_delivery`, proof sets `details.delivery_status='delivered'` (typed column after T-04) without forcing `status='done'`; notification text and recipient (Accounts) as monday; commission rule text already matches, keep 7. **Frontend** `TQ.tsx` ("Mark delivered" action) 8. **Backend** `task_attachment_after` 9. **DB** none 10. **API** none 11. **Deps** T-04 optional 12. **Acceptance** Upload proof on a mill task: Invoice Status Delivered, Status unchanged, Accounts get the exact text 13. **Tests** TC-A10-* 14. **Complexity** S 15. **Priority** Medium 16. **Sequence** 2

### T-04. Typed detail tables per board
1. **ID** T-04 2. **Feature** F-07 3. **Requirement** Every board field is a real column 4. **monday** typed columns (document 02) 5. **Current** `tasks.details` jsonb 6. **Changes** Create `task_visit`, `task_mill_delivery`, `task_commission_delivery`, `task_payment_collection`, `task_freight_check`, `task_sample` (1:1 on `task_id` PK) with enums/check constraints for each status list in document 02; keep `task_cheques`; backfill from `details`; guard trigger writes typed columns; keep `details` for unknown keys during transition; update `board_*` views to read typed columns 7. **Frontend** `taskBoards.ts` (field targets), `TaskForm.tsx`, `TaskDetail.tsx`, `TaskQueue.tsx` 8. **Backend** new migration; `task_details_problem` retired per board 9. **DB** 6 tables, enums, FKs (`payment_collection_task_id` on visit/commission, `transport_invoice_id` reserved), indexes on status columns, RLS through `task_can(task_id)` 10. **API** RPC `task_save_board(task, payload)` validating per type (or direct upsert policies) 11. **Deps** T-00 for the form fields (not for the columns) 12. **Acceptance** No board field is read from `details` except legacy keys; constraints reject invalid labels; old rows backfilled 13. **Tests** TC-DATA-* 14. **Complexity** L 15. **Priority** High 16. **Sequence** 3

### T-05. Relations and link pickers
1. **ID** T-05 2. **Feature** F-20, F-21, F-26 3. **Requirement** Two-way links like monday 4. **monday** R2, R7, R8, R10 5. **Current** `source_task_id` one way; view derives back-link; no picker 6. **Changes** FK `payment_collection_task_id` on visit and commission detail rows (set by escalation, editable); picker components (reuse `LinkPicker`) on forms; show reverse links in `TaskDetail` 7. **Frontend** `TaskForm.tsx`, `TaskDetail.tsx`, `LinkPicker.tsx` 8. **Backend** escalation sets the FK 9. **DB** FKs and indexes 10. **API** none 11. **Deps** T-04 12. **Acceptance** Visit shows its Payment Collection and the payment shows its source (visit or commission) from both screens; deleting one clears the link 13. **Tests** TC-REL-* 14. **Complexity** M 15. **Priority** Medium 16. **Sequence** 4

### T-06. Subitems screen
1. **ID** T-06 2. **Feature** F-05 3. **Requirement** Subitems on Payment Collection and Cheque Collection 4. **monday** default subitem columns Name, Owner, Status (Working on it/Done/Stuck), Date; no data 5. **Current** `task_subitems` + RLS only 6. **Changes** Subitems section in `TaskDetail` for those two types: add, edit, status, delete 7. **Frontend** `TaskDetail.tsx` 8. **Backend** none 9. **DB** none 10. **API** table CRUD under existing RLS 11. **Deps** none 12. **Acceptance** Add, change, delete a subitem on a payment task; hidden on other types 13. **Tests** TC-SUB-* 14. **Complexity** S 15. **Priority** Low 16. **Sequence** 4

### T-07. Per-board creation forms from monday's forms
1. **ID** T-07 2. **Feature** F-08, F-09 3. **Requirement** Same sections, order, labels, required marks 4. **monday** "Creation Form" app views (unread, T-00) 5. **Current** `TaskForm` generic with board fields 6. **Changes** Replace generic `common` + `fields` with `FormSection` definitions per board in `taskBoards.ts`; required marks; validation messages; keep Cheque form separate (`ChequeForm`) 7. **Frontend** `taskBoards.ts`, `TaskForm.tsx`, `ChequeForm.tsx`, `lib/validate.ts` 8. **Backend** none 9. **DB** none 10. **API** `task_save_board` from T-04 11. **Deps** T-00, T-04 12. **Acceptance** Field-by-field match with the monday form; required fields enforced; errors name the field 13. **Tests** TC-FORM-* 14. **Complexity** M 15. **Priority** High 16. **Sequence** 5

### T-08. Grids on the board views, Actions, status labels
1. **ID** T-08 2. **Feature** F-03, F-54 3. **Requirement** Each board reads its own typed view; monday's status labels 4. **monday** document 02 5. **Current** grids read `tasks` and compute columns in the browser 6. **Changes** `TaskQueue` selects from `board_*` views by board; Mill gets its own `Status` (Working on it/Stuck/Done) and `Invoice Status`; Sample Type options defined (replace TBD placeholders by a configurable list); keep RowActionMenu 7. **Frontend** `TaskQueue.tsx`, `Tasks.tsx`, `taskBoards.ts` 8. **Backend** views updated by T-04 9. **DB** Mill status column in `task_mill_delivery` 10. **API** reads of `board_*` views 11. **Deps** T-04 12. **Acceptance** Each grid shows exactly monday's columns with values from the view; filters and CSV still work 13. **Tests** TC-GRID-* 14. **Complexity** L 15. **Priority** Medium 16. **Sequence** 5

### T-09. Reports (dashboards) per board
1. **ID** T-09 2. **Feature** F-50, F-51 3. **Requirement** Equivalent of monday's "Reports"/"Dashboard" 4. **monday** unread widgets 5. **Current** `boardSummary` cards, `TaskOverview`, collection dashboard 6. **Changes** After T-00, add per-board report panels (counts by status, amounts, ageing) reusing `SummaryCards` and the dashboard components 7. **Frontend** `TaskQueue.tsx` (`boardSummary`), new `TaskReports.tsx` 8. **Backend** report RPCs as needed 9. **DB** none or views 10. **API** `board_report(board)` optional 11. **Deps** T-00, T-08 12. **Acceptance** Each widget of the monday dashboard has a CRM+ counterpart with the same definition 13. **Tests** TC-REPORT-* 14. **Complexity** M 15. **Priority** Medium 16. **Sequence** 6

### T-10. Time of day for date-based rules
1. **ID** T-10 2. **Feature** F-40 3. **Requirement** Date triggers fire at monday's time (IST) 4. **monday** 17:45, 18:00, 18:15, 18:30, 20:30, 22:15, 22:45, 10:00 5. **Current** rules compare dates only 6. **Changes** Add `time` (HH:MM IST) and `offset_days` to rule config; `run_task_rules` fires when `now IST >= date + offset + time` and records the fire with a dedupe key per item, rule and date value; a changed date value re-arms the rule (matches monday) 7. **Frontend** `RulesPanel.tsx` (time field) 8. **Backend** `run_task_rules`; cron stays 15 minutes (fires within 15 minutes of the stored time) 9. **DB** rule config keys 10. **API** none 11. **Deps** T-00 (offsets), T-11 for logging 12. **Acceptance** A rule set to 17:45 does not fire at 17:30 and fires once between 17:45 and 18:00 IST; repeated runs send nothing; a changed date fires again 13. **Tests** TC-TIME-* 14. **Complexity** M 15. **Priority** Medium 16. **Sequence** 7

### T-11. Rule run log
1. **ID** T-11 2. **Feature** F-42 3. **Requirement** Every automation run auditable 4. **monday** run history (empty here) 5. **Current** none 6. **Changes** `task_rule_runs(rule_key, task_id, fired_at, outcome, detail)`; every rule writes one row per evaluated item that fires or fails; failure of one item does not stop the run (exception block) 7. **Frontend** `RulesPanel.tsx` run list 8. **Backend** `run_task_rules` 9. **DB** new table, RLS read for `task.manage` 10. **API** table read 11. **Deps** none 12. **Acceptance** After a run the panel lists what fired and why; a forced error on one row is logged and the rest still run 13. **Tests** TC-LOG-* 14. **Complexity** M 15. **Priority** Medium 16. **Sequence** 6

### T-12. Escalation rework (A-4..A-9, A-11)
1. **ID** T-12 2. **Feature** F-30, F-32 3. **Requirement** Same conditions and wording; Payment Collection created as monday does 4. **monday** Pending = Yes, status Visited/Not Visited (not Completed); two branches (Visited Date / Created Date with Visited Date empty); item "Monthly Visit - {name}" per step; commission at 18:30 5. **Current** one rule with days [30,45,60], one open follow-up per buyer 6. **Changes** Two explicit branches; step days and times from config (T-10); create per step **or** keep one per buyer: product decision D7 (default: replicate monday: one Payment Collection per step, deduped by `(visit, step)`); exclude Completed; text per branch (fix the A-9 copy error) 7. **Frontend** `RulesPanel.tsx` 8. **Backend** `run_task_rules` 9. **DB** dedupe keys `esc:<task>:<branch>:<step>` 10. **API** none 11. **Deps** T-00, T-04, T-10, T-11 12. **Acceptance** Matrix in document 12 (TC-A4..A9, A11) 13. **Tests** same 14. **Complexity** M 15. **Priority** Medium 16. **Sequence** 8

### T-13. Rules as a data model (optional)
1. **ID** T-13 2. **Feature** F-41 3. **Requirement** Add or change a rule without a migration 4. **monday** recipe editor 5. **Current** thresholds in config only 6. **Changes** Generic rule: trigger (date column + offset + time, or event), conditions (field, operator, value), actions (notify who, create task type with title template, set field); executed by one interpreter function; seed the 20 monday automations as rows. Recommended only after T-12 proves the shape; otherwise skip 7. **Frontend** `RulesPanel.tsx` 8. **Backend** interpreter 9. **DB** `task_rules` columns or `task_rule_defs` 10. **API** none 11. **Deps** T-10..T-12 12. **Acceptance** Each seeded rule produces the same results as its hard-coded predecessor (regression suite) 13. **Tests** whole of document 12 re-run 14. **Complexity** XL 15. **Priority** Low 16. **Sequence** 9

### T-14. Transport Invoice link for freight checks
1. **ID** T-14 2. **Feature** F-24 3. **Requirement** Freight rows come from Transport Invoice and link two ways 4. **monday** R10; Transport Invoice automation creates "<name> - Transport Task" 5. **Current** from `order_dispatches.transporter_invoice_no` 6. **Changes** When the Transport Invoice register exists (master plan Group 5), create freight tasks from it and link; keep the dispatch path until then; drop the broken Buyer mirror (derive buyer from the invoice) 7. **Frontend** `TaskForm`, `TaskDetail` 8. **Backend** trigger on the Transport Invoice table 9. **DB** `transport_invoice_id` FK 10. **API** none 11. **Deps** Transport Invoice register (outside this folder) 12. **Acceptance** Creating a Transport Invoice creates one freight task with the link 13. **Tests** TC-REL-FR 14. **Complexity** M 15. **Priority** Medium 16. **Sequence** 10

### T-15. Sample approved: lead decision
1. **ID** T-15 2. **Feature** F-38 3. **Requirement** Decide whether an approved sample creates a qualified lead 4. **monday** A-19 (target deleted) 5. **Current** none 6. **Changes** If the business wants it: on `feedback_status = approved` create a lead (`leads` table) named "Sample Delivery - {name}" linked to the buyer; otherwise record "not built" 7. **Frontend** none 8. **Backend** trigger 9. **DB** optional link column 10. **API** none 11. **Deps** product decision 12. **Acceptance** per decision 13. **Tests** TC-A19 14. **Complexity** S 15. **Priority** Low 16. **Sequence** 10

### T-16. Import the monday rows (optional)
1. **ID** T-16 2. **Feature** F-55 3. **Requirement** Carry the 82 rows over 4. **monday** document 01 section 1.6 5. **Current** none 6. **Changes** One-off read-only export from monday into a staging CSV, mapped by board; import through the typed tables with `dedupe_key = monday:<item id>` 7. **Frontend** none 8. **Backend** import script under `supabase/manual/` 9. **DB** none 10. **API** none 11. **Deps** T-04 12. **Acceptance** Row counts match per board; buyers matched by name 13. **Tests** TC-IMP-* 14. **Complexity** M 15. **Priority** Low 16. **Sequence** 10

### T-17. Profile templates review
1. **ID** T-17 2. **Feature** F-53 3. **Requirement** Field staff, Accounts, Sales, Management see what they should 4. **monday** everyone edits 5. **Current** 5 permissions, templates in `PROFILE_TEMPLATES` 6. **Changes** Confirm template permissions with monday's real members (T-00); adjust if a role needs `task.read` 7. **Frontend** `src/api/types.ts` 8. **Backend** none 9. **DB** none 10. **API** none 11. **Deps** T-00 12. **Acceptance** Each template can do its documented tasks (TC-PERM-*) 13. **Tests** TC-PERM-* 14. **Complexity** S 15. **Priority** Low 16. **Sequence** 11

### T-18. Automated SQL tests
1. **ID** T-18 2. **Feature** F-56 3. **Requirement** Every automation has a repeatable test 4. **monday** n/a 5. **Current** no tests 6. **Changes** A `supabase/tests/` folder of SQL scripts run in a transaction against a staging database (set `p_now` to simulate dates), one per A-number; a runner script in `package.json` 7. **Frontend** none 8. **Backend** test scripts 9. **DB** none (rolled back) 10. **API** none 11. **Deps** staging database 12. **Acceptance** document 12 scenarios pass; run in CI or by hand before each push 13. **Tests** itself 14. **Complexity** L 15. **Priority** High 16. **Sequence** alongside T-01

### T-19. UI smoke tests
1. **ID** T-19 2. **Feature** F-56 3. **Requirement** Forms, Actions, grids verified automatically 4. **monday** n/a 5. **Current** manual browser checks 6. **Changes** Playwright smoke tests for each board: open, create, edit, filter, export; one field-view check at phone width 7. **Frontend** `e2e/` 8. **Backend** none 9. **DB** none 10. **API** none 11. **Deps** T-07, T-08 12. **Acceptance** suite green on staging 13. **Tests** itself 14. **Complexity** M 15. **Priority** Medium 16. **Sequence** after T-08

### T-20. Documentation, release and parity check
1. **ID** T-20 2. **Feature** Cut-over 3. **Requirement** Production behaves like monday 4. **monday** whole folder 5. **Current** n/a 6. **Changes** Update `README.md`, `docs/mdm-column-parity.md`-style Tasks parity doc, `CRMMasterPlan.md`; production check against monday (read-only), one push to Testing and main 7. **Frontend** none 8. **Backend** none 9. **DB** migrations applied in order 10. **API** none 11. **Deps** all 12. **Acceptance** document 13 checklist complete 13. **Tests** document 12 on production-like data 14. **Complexity** S 15. **Priority** High 16. **Sequence** last

## 11.4 Open product decisions

| # | Question | Default if not answered |
|---|---|---|
| D7 | One Payment Collection per escalation step (monday) or one open follow-up per buyer (current CRM+)? | Replicate monday, flag per rule |
| D8 | Should Person fall back to collection staff when the buyer has no Messenger? | No (monday leaves it empty); managers are notified |
| D9 | Do approved samples become leads? | No |
| D10 | Keep Mill "Status" and "Invoice Status" as two fields? | Yes, as monday |
| D11 | Time-of-day precision acceptable at 15 minutes? | Yes |
