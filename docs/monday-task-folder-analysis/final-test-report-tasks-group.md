# Final test report: Tasks group (five boards)

Date: 2026-11-20. Boards: Monthly Visit, Mill Invoice Delivery, Payment Collection, Cheque Collection, Sample Delivery. Not in scope (as requested): Transport Freight Invoice and Commission Invoice Delivery (their tests exist and pass, but are not part of this report; Payment Collection's link from a commission delivery is covered only on the Payment Collection side).

## Environment
A throwaway in-memory PostgreSQL 17 (PGlite) in `supabase/tests/local-harness`: the real Tasks migrations are applied in order (tasks module, scheduler, board parity, rules timing, the Dispatch and Billing part of CRM automations round 2, and the three fix migrations 20261120150000, 20261120151000, 20261120160000), then re-applied to prove they are safe to run twice. Base tables (profiles, buyers, orders, dispatches...) are simplified stand-ins. Production and the project's database were not written to.

## What was run
| File | Checks | Result |
|---|---|---|
| `task_rules_monday_timing.test.sql` | 10 | pass |
| `task_boards_automations.test.sql` | 14 | pass |
| `task_monthly_visit_and_links.test.sql` | 15 | pass |
| `task_cheque_and_payment_collection.test.sql` | 8 | pass |
| `task_group_sample_data.test.sql` (sample data, scheduler simulated) | 15 | pass |
| **Total** | **62** | **all pass**, run together and the sample-data file alone; migrations re-run twice with no error |

## The sample-data scenario
A cast of four users (SK admin, Jyoti accounts/manager, Rahul and Mohit field staff), three buyers (KPR with Messenger Mohit, Vardhman with Messenger Rahul, SRI with none), one supplier. Between 18 March and 21 May 2026 the scheduler was run at its real 15-minute cadence (6,145 runs) while people acted at the right moments: a field visit with check-in and check-out, two Dispatch and Billing items with dispatches and a corrected invoice number, proof and cheque photos uploaded by a field person (row-level security applied), a cheque deposited and cleared, a cheque collected by hand, payments recorded against a payment task, a subitem added, and three sample deliveries.

| Board | What was asserted (exact counts) | Result |
|---|---|---|
| Monthly Visit | Person from each buyer's Messenger (none for SRI); check-in/out RPC; A-2 "not visited": 5 notifications (Person + Accounts; Accounts only for SRI; none for the completed visit); A-3: 2, only for the visited visit; A-4..A-9: 6 Payment Collection items (3 per visit) and 12 notifications; none for Pending = No or a Completed visit; steps at normal/high/urgent priority | pass |
| Mill Invoice Delivery | a task per Dispatch and Billing item, Person from Messenger; invoice number filled and corrected without a second task; proof by the field person sets Invoice Status Delivered, leaves Status, tells Jyoti once with monday's text; the delivered invoice is never overdue, the open one is reported once | pass |
| Payment Collection | payments linked to their visits and shown with "Monthly Visit"; 20000 + 30000 recorded by Jyoti; Completed with End Date; Rahul told twice ("Hey, Rahul Sharma, Amount collected is 50000" for the second), Jyoti, who recorded it, not told; the other five payments Outstanding; subitem added | pass |
| Cheque Collection | photo by the field person marks Collected and notifies Accounts; a cheque with no Accounts person notifies its Person; the pending cheque notifies nobody; deposit with bank and slip; Cleared; groups To Collect / Collected; Person from Messenger | pass |
| Sample Delivery | A-20: 4 reminders (the two pending samples, Person + Accounts), none for the approved one; Messenger mirrors and Feedback Due Date = Delivery Date + 7 | pass |
| Links | visit <-> Payment Collection both ways; order -> dispatch -> Mill task (invoice number, supplier); buyers' Messengers -> Person on all five boards | pass |
| Scheduler | 6,145 runs logged, 0 failed rows, no duplicate notification, no duplicate task | pass |
| Security | a field person cannot add a subitem to someone else's task | pass |

A negative control confirmed the scenario detects the production bug below: without migration 20261120160000 it stops at "Record payment" with `column reference "id" is ambiguous`.

## What broke (and was found by testing)
| # | Finding | State |
|---|---|---|
| 1 | **"Record payment" fails for everyone** (`task_add_payment`, ambiguous `id`). The live database has 0 payment lines: it has never worked | Fixed in `20261120160000_cheque_and_payment_collection_automations.sql`; **not yet applied to the live database** |
| 2 | Cheque collected by photo never notified Accounts (trigger fired only on a status column in the update list) | fixed in `20261120150000`, **applied live** |
| 3 | Correcting a mill invoice number created a second delivery task (round-2 `dispatch_tasks`) | fixed in `20261120151000`, **applied live** |
| 4 | The cheque form had no Accounts field, so the Collected notification could not reach anyone for cheques entered in the app | fixed in `ChequeForm.tsx` (not yet deployed) and the fallback in 20261120160000 |

Nothing else broke in this round.

## Observations (not breakages; behaviour to be aware of)
1. **Every Payment Collection created by an escalation is reported overdue the next day** (it is created with due date = the creation day). Measured in the scenario: 6 "overdue" notifications for the 6 auto-created payments, plus 3 for visits and 1 for the open mill task. monday has no overdue concept; this is noise. Suggested change if wanted: give those payments the task type's default due days (7).
2. A buyer with no Messenger leaves Person empty: its visit is reminded to Accounts only, and it is never reported overdue (the overdue rule needs a Person).
3. In the "no Accounts person" fallback, the person who made the change is not told, so a cheque collected by its own Person (photo uploaded by that person) notifies nobody. Set Accounts on the cheque to avoid it.
4. The Monthly Visit escalation steps use 30/45/60-day offsets (monday stores none): an open business decision (`automation-offset-verification.md`).

## Not covered
The screens (forms, grids, reports, the Connected Boards picker) in a browser; the project's real database and its full schema; two simultaneous recordings (concurrency); the scheduler job itself (cron) rather than its function; e-mail/WhatsApp sending. Run the same five files on a real staging database before production: `node run.mjs <files>` in the harness, or `psql -f` for each file on staging.
