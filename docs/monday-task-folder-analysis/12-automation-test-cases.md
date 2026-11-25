# 12. Workflow and automation test cases

How to run (document 11, T-18): SQL scripts against a **staging** database inside a transaction that is rolled back; dates are simulated with `select public.run_task_rules('<timestamp>'::timestamptz)` (the function takes `p_now`). Each case lists Given / When / Expected and a verifiable acceptance check (a query that must return the stated value). IST = Asia/Kolkata. "P" = Person, "Acc" = Accounts. Cases marked **(after T-nn)** need that task first.

## 12.1 General cases (apply to every rule)

| ID | Scenario | Given / When | Expected (acceptance) |
|---|---|---|---|
| TC-G1 | Normal execution | rule active, qualifying task | exactly one notification per recipient; `notifications.dedupe_key` as specified |
| TC-G2 | Missing required fields | qualifying task without buyer / Person | rule skips or notifies managers; no error; run returns normally |
| TC-G3 | Invalid status transition | set `visit_status='bogus'` | insert/update rejected by constraint (after T-04) / `task_details_problem` before |
| TC-G4 | Duplicate events | run the rule twice at the same `p_now` | second run creates 0 notifications and 0 tasks |
| TC-G5 | Concurrent updates | two sessions record a payment on one task | `amount_collected` = sum of both; no lost update (row lock in `task_payment_after`) |
| TC-G6 | Deleted connected item | delete the source visit of a payment | `source_task_id` becomes null; later rules still run |
| TC-G7 | Unauthorised user | user with `task.work` updates another person's task | RLS rejects (0 rows) |
| TC-G8 | Failed notification | recipient profile inactive | no exception; other recipients still notified (after T-11 the failure is logged) |
| TC-G9 | Background job failure | raise an error inside one item | the rest of the run completes (after T-11) |
| TC-G10 | Retry | message send fails | `messages.status` returns to queued, attempts < 3, then `failed`/`manual` |
| TC-G11 | Timezone | `p_now = 2026-03-18 18:29 UTC` vs `19:30 UTC` | date taken in IST: 23:59 IST on the 18th vs 01:00 IST on the 19th |
| TC-G12 | Automation loop | run rules 5 times in a row on the same data | counts of tasks and notifications stop growing after the first run |
| TC-G13 | Partial workflow | escalation notification succeeds, Payment Collection insert hits the dedupe key | notification exists once, no duplicate task, event logged |

## 12.2 Per automation

### Monthly Visit
| ID | Automation | Given | When | Expected / acceptance |
|---|---|---|---|---|
| TC-A1 | A-1 Created Date | create a visit | insert | `start_date` = today IST |
| TC-A2a | A-2 not visited (after T-01, T-10) | visit created 2026-03-18, status Not Visited, P and Acc set | run at 17:30 IST then 17:50 IST | 0 notifications at 17:30; at 17:50 two notifications "Hey, {P}, You have not visited yet." (P and Acc); a second run adds none |
| TC-A2b | A-2 visited | same but status Visited | run 17:50 | 0 notifications |
| TC-A3 | A-3 | Visited Date 2026-03-18 (status Visited) | run 2026-04-17 10:05 IST | P and Acc get "you have visited and not collect the payment."; pending flag not required; run 2026-04-16 sends none |
| TC-A3b | A-3 wrong status | status Not Visited | run 2026-04-17 | none |
| TC-A4 | A-4 30 days visited | Visited Date D, Pending = Yes, Visited | run at D + 30 18:05 (after T-12; offset per T-00) | notification "...after 30 days" to P and Acc and one Payment Collection "Monthly Visit - {name}" linked both ways |
| TC-A5 | A-5 45 days | same | D + 45 | "...after 45 days" and a new Payment Collection (D7 default) |
| TC-A6 | A-6 60 days | same | D + 60 | "...after 60 days" |
| TC-A4b | A-4 Completed excluded | status Completed | D + 30 | none |
| TC-A4c | A-4 no pending | Pending = No | D + 30 | none |
| TC-A7 | A-7 not visited 30 days | Visited Date empty, Pending = Yes, status Not Visited, Created Date C | run C + 30 | "you have not visited and not collected the payment after 30 days"; Payment Collection created |
| TC-A8 / A9 | A-8, A-9 | same at +45, +60 | | texts "...after 45 days", "...after 60 days" (not "you have visited") |
| TC-A7b | Visited Date filled | Visited Date set | C + 30 | A-7 does not fire (A-4 does) |
| TC-A21 | A-21/A-22 Person from Messenger (after T-02) | buyer with Messenger M | create visit; change buyer to one with Messenger N | Person M then N; Accounts empty; buyer without Messenger: Person empty |

### Mill Invoice Delivery
| ID | Automation | Given | When | Expected |
|---|---|---|---|---|
| TC-A10 | A-10 proof (after T-03) | mill task, Invoice Status Not Delivered, Acc set | insert a `task_attachments` row kind proof | Invoice Status Delivered; Status unchanged; Acc gets "Hey, {name}, Mill Invoice is delivered" |
| TC-A10b | no Acc | no accounts person | same | no error; managers notified |
| TC-A10c | non-proof document | kind document | insert | nothing |
| TC-A5-DB | D&B creates the Mill row | insert `order_dispatches` with `mill_invoice_no` | | one task, `dedupe_key mill_inv:<id>`; re-update creates none |

### Commission Invoice Delivery
| ID | Automation | Given | When | Expected |
|---|---|---|---|---|
| TC-A11 | A-11 | Created Date C, Pending = Yes | run C 18:35 IST | P and Acc notified "Payment is pending for this record."; Payment Collection "Commission Invoice - {name}" linked; run C 18:20 sends none |
| TC-A11b | Pending = No | | | none |
| TC-A11c | duplicate | run again | | none |
| TC-A12 | A-12 (inactive in monday) | | | not built; Created Date default exists |
| TC-CI | commission invoice creates a delivery task | insert `commission_invoices` | | one task with `dedupe_key ci:<id>` |

### Payment Collection
| ID | Automation | Given | When | Expected |
|---|---|---|---|---|
| TC-A13 | A-13 Start Date | create | insert | `start_date` = today IST |
| TC-A14 | A-14 | amount 10000 | `task_add_payment(4000)` | `amount_collected` 4000; watchers (except the actor) notified "Amount collected is 4000" |
| TC-A14b | zero amount | `task_add_payment(0)` | | rejected "The amount must be more than zero" |
| TC-A14c | overpayment | amount 10000, pay 12000 | | accepted; balance shows 0 (floor) ; status done if no proof required |
| TC-A15 | A-15 End Date | status -> done | update | `completed_at` set; Days Aging = completed - start |
| TC-A15b | reopen | done -> todo | | `completed_at` null |
| TC-A16 | A-16 (inactive) | | | not built |

### Cheque Collection
| ID | Automation | Given | When | Expected |
|---|---|---|---|---|
| TC-A17 | A-17 | cheque status pending, task Acc set | set `photo_path` / attach a photo | status collected; Acc gets "Your Check for {name} is Collected" once |
| TC-A17b | already collected | status collected | attach another photo | no second notification (`chq_collected:<id>` key) |
| TC-A17c | no Acc | | | no error |
| TC-CH1 | deposit rules | deposit without bank and slip | | rejected |
| TC-CH2 | duplicate cheque | same number and bank | | unique index error |

### Transport Freight Invoice
| ID | Automation | Given | When | Expected |
|---|---|---|---|---|
| TC-A18 | A-18 | freight task, check_status cleared | set `check_status = outstanding` | P and Acc notified "Hey, {name}, The payment for {title} is Outstanding" once |
| TC-A18b | re-save outstanding | | update details again | none |
| TC-A18c | other type | monthly_visit with check_status | | none |
| TC-FR | dispatch creates freight task | `transporter_invoice_no` filled | | one task, `freight:<id>` |

### Sample Delivery
| ID | Automation | Given | When | Expected |
|---|---|---|---|---|
| TC-A20 | A-20 | Delivery Date D, feedback Pending | run D + 7 20:35 IST (after T-10) | P and Acc notified "The sample {title} feedback is due."; D + 7 20:00: none |
| TC-A20b | Approved | feedback approved | D + 7 | none |
| TC-A19 | A-19 | feedback -> approved | | per decision D9 (default: nothing created) |
| TC-A29 | A-29/A-30 | as TC-A21 | | |

## 12.3 Cross-board and data cases

| ID | Scenario | Expected |
|---|---|---|
| TC-REL-1 | Payment Collection created by escalation (after T-05) | visit shows it; payment shows the visit as source |
| TC-REL-2 | Delete the payment | visit link cleared; next step creates a new one only if its key is unused |
| TC-REL-FR | Transport Invoice created (after T-14) | one freight task linked both ways |
| TC-DATA-1 | Backfill (after T-04) | every task's board fields equal the old `details` values; row counts equal |
| TC-DATA-2 | Constraint | inserting an invalid label fails |
| TC-SUB-1 | Subitem CRUD on payment task | allowed for `task_can(write)`, hidden for other types |
| TC-IMP-1 | Import (after T-16) | counts 3/26/31/0/1/20/1 |
| TC-PERM-1 | Field staff | sees only own tasks; cannot change assignee or amount |
| TC-PERM-2 | Accounts | sees all, can manage, cannot send messages without `message.send` |
| TC-PERM-3 | Sales | read-only on tasks |
| TC-FORM-n | each board form | fields, order, required marks, error messages as in the monday form (after T-07) |
| TC-GRID-n | each board grid | columns equal document 02; filters and CSV work |
| TC-REPORT-n | each report widget | numbers equal the same query on the data |
| TC-LOG-1 | Rule run log (after T-11) | one row per fired item; failures logged with detail |
| TC-TIME-1 | Date value changed after the rule fired | the rule fires again for the new date |
