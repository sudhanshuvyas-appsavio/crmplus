# Cheque Collection and Payment Collection: full test plan against data

Scope: the two boards, their automations (A-13, A-14, A-15, A-17, A-27/A-28), the links to Monthly Visit and Commission Invoice Delivery, the grids, reports and permissions. Principle: **production is read-only for testing**: tests that write run on a staging database or in the local harness; production gets only the read-only checks in section 3 and the supervised acceptance run in section 6.

## 1. Data that exists today (live database, read-only, 2026-11-20)

| Item | Count | Meaning for testing |
|---|---|---|
| Cheques | 1 (status Deposited) | migrated row, **no linked task**, no photo: automations cannot reach it; use it for display and report checks only |
| Cheques without Accounts | 0 of the linked ones (none linked) | |
| Payment Collection tasks | 0 | no real data: every payment scenario needs fixtures |
| Payment lines | 0 | confirms that "Record payment" never worked before the fix |
| Subitems | 0 | |
| monday Cheque Collection | 1 row ("New Check", Collected, Person SK, Accounts Jyoti) | reference for the acceptance run |
| monday Payment Collection | 0 rows | |

Because the real data is almost empty, the plan is fixture-driven: each scenario below creates its own `TEST` rows with known buyers/people and removes them afterwards (rollback in SQL, deletion by title prefix on staging).

## 2. Test levels

| Level | Where | What | State |
|---|---|---|---|
| L1 SQL tests | local harness or staging | the automations and constraints | **written and passing locally (47 checks across 4 files)**; run on staging before production |
| L2 Read-only data checks | production | integrity queries (section 3) before and after the migration | queries written |
| L3 Staging scenarios | staging | the end-to-end flows of section 4 with fixtures | to run |
| L4 UI tests | staging, signed-in test accounts | the forms, grids, reports, permissions (section 5) | to write (no UI framework in the repo yet: see `e2e-test-plan.md`) |
| L5 Supervised acceptance | production, after sign-off | one real cheque and one real payment (section 6) | to run |

## 3. Read-only data checks (run on production before and after applying the migration)

```sql
-- 3.1 the migration is applied
select position('new_id uuid' in pg_get_functiondef(p.oid)) > 0 as record_payment_fixed
from pg_proc p where p.proname = 'task_add_payment';                                   -- expect true after

select position('trim_scale' in pg_get_functiondef(p.oid)) > 0 as payment_text_updated
from pg_proc p where p.proname = 'task_payment_after';                                 -- expect true after

select pg_get_triggerdef(oid) from pg_trigger where tgname = 'trg_cheque_collected_notify';  -- AFTER INSERT OR UPDATE ON

-- 3.2 payment integrity: collected equals the sum of the lines, done tasks have an End Date
select count(*) as collected_mismatch from tasks t
where t.task_type = 'payment_collection'
  and t.amount_collected <> coalesce((select sum(amount) from task_payments p where p.task_id = t.id), 0);   -- expect 0
select count(*) as done_without_end from tasks
where task_type = 'payment_collection' and status = 'done' and completed_at is null;                          -- expect 0
select count(*) as overpaid from tasks where task_type = 'payment_collection' and amount > 0 and amount_collected > amount;  -- review, not an error

-- 3.3 cheque integrity
select count(*) as collected_without_photo_or_task from task_cheques
where status in ('collected','deposited','cleared') and photo_path is null;            -- review
select count(*) as cheques_without_task from task_cheques where task_id is null;       -- 1 today (the migrated row)
select count(*) as cheque_tasks_without_accounts from tasks t
where t.task_type = 'cheque_collection' and t.accounts_staff_id is null
  and exists (select 1 from task_cheques c where c.task_id = t.id);                     -- review: these only notify the fallback people
select count(*) as deposited_missing_bank_or_slip from task_cheques
where status in ('deposited','cleared','bounced') and (deposit_bank is null or slip_no is null);   -- expect 0

-- 3.4 links
select count(*) as orphan_payment_sources from tasks
where task_type = 'payment_collection' and source_task_id is not null
  and not exists (select 1 from tasks s where s.id = tasks.source_task_id);             -- expect 0
```

## 4. Staging scenarios (fixtures: 3 active users A=Person, B=Accounts, C=Messenger; 2 buyers; one Monthly Visit and one Commission Invoice Delivery task)

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| PC-1 | Create a payment (A-13) | create "TEST pay", Person A, Accounts B, Amount 10000 | Start Date = today IST; Payment Status Outstanding; Balance 10000; Days Aging 0 |
| PC-2 | First payment (A-14) | record 4000 cash | collected 4000, balance 6000; A and B each get "Hey, {their name}, Amount collected is 4000"; task still open |
| PC-3 | Second payment, decimals | record 2500.50 online | total 6500.5 in the message; balance 3499.5 |
| PC-4 | The person recording | A records 100 | A is not notified of their own entry; B is |
| PC-5 | Bad amounts | record 0, -5, text | refused with a clear message; nothing stored |
| PC-6 | Direct edit | try to edit Amount Collected in the form or by API | not possible / refused |
| PC-7 | Complete by payment (A-15) | pay the remaining balance | status Done, End Date = today, Payment Status Completed, Days Aging = End - Start |
| PC-8 | Complete by hand | "Complete" with a balance left | Done, End Date stamped, Balance still shown |
| PC-9 | Reopen | Reopen | End Date cleared; (payment status stays Completed while collected >= amount) |
| PC-10 | Overpayment | pay more than the balance | accepted, balance 0 (not negative) |
| PC-11 | Modes | record Cash, Online, Cheque | stored and shown with monday's three labels |
| PC-12 | Closed task | record a payment on a Done task | refused "reopen it first" |
| PC-13 | Connected Boards | link to the visit, then to the commission delivery | the source shows the payment; the payment names its board; clearing works |
| PC-14 | Created by automation | visit with Pending Payment = Yes reaches day 30 (simulated) | one payment task "Monthly Visit - {name}" with Person/Accounts/buyer, linked |
| PC-15 | Subitems | add, change status, delete | works for managers and the assignee; hidden on other task types |
| PC-16 | Report | open the board | "Count by person" totals equal the row count |
| CC-1 | Create with Accounts | cheque form: Name, Buyer, Accounts B, cheque no, bank, amount | task and cheque created; status Pending; group To Collect; no notification |
| CC-2 | Photo (A-17) | attach a photo from the proof tab and from the cheque form | status Collected, group Collected; B gets "Your Check for {name} is Collected" once; a second photo adds nothing |
| CC-3 | No Accounts | create without Accounts, collect | Person is told (the person who uploaded is not); with no Person, the managers are told |
| CC-4 | Manual status | change Pending to Collected without a photo | one notification |
| CC-5 | Person (A-27/A-28) | create with a buyer and no collector; then change the buyer | Person = the buyer's Messenger; after the change = the new buyer's Messenger |
| CC-6 | Deposit | deposit without bank/slip; then with both | first refused; then Deposited, group In Progress, deposit date stamped |
| CC-7 | Clear / bounce | clear; separately bounce another | Cleared (group Collected, cleared date) / Bounced |
| CC-8 | Duplicates and amounts | same number and bank again (different case/spaces); amount 0; future collection date | refused each time with a clear message |
| CC-9 | Edit | change the Name, Accounts, buyer | the task follows; Person follows the buyer's Messenger |
| CC-10 | Reports | with cheques on several dates, buyers, deposit dates and depositors | the four charts show the right counts and sums; they follow the search and filters |
| CC-11 | Export | CSV | Person is the task's Person; Accounts filled |
| CC-12 | Legacy row | the migrated cheque with no task | listed and editable; photo upload prompts for a task (known limit) |

## 5. Roles and failure cases (UI and SQL)

| ID | Case | Expected |
|---|---|---|
| R-1 | Field worker (`task.work`) | sees and updates only their own payment and cheque tasks; cannot set Accounts, reassign, change amounts or links |
| R-2 | Accounts (`task.manage`) | creates, edits, deposits, clears, links, sees the rule log |
| R-3 | Sales (`task.read`) | read-only |
| R-4 | Another worker's task | not visible / refused |
| F-1 | Notification recipient inactive | no error; others still notified |
| F-2 | Two people record a payment at the same moment | both lines kept; total = sum; no lost update |
| F-3 | Delete a cheque whose task has a payment link or subitems | refused or cascades as designed; nothing dangling |
| F-4 | Run the same scenario twice | no duplicate notifications or tasks |
| F-5 | Time zone | a payment at 23:59 and at 00:01 IST gets Start/End dates of the right day |

## 6. Supervised acceptance on production (after staging passes and the migration is applied)

1. Record the live state with the section 3 queries.
2. Create one real cheque with Accounts set to a real accounts user; attach its photo; confirm the Collected notification arrives once and the group moves.
3. Create one real Payment Collection task for a real buyer; record a part payment; confirm the notification text and the balance; record the rest; confirm Done and End Date.
4. Compare both records with the monday boards' equivalents (columns, labels, wording).
5. Re-run the section 3 queries: all expectations hold; no failed rows in the Rule log.
6. Remove nothing without the owner's approval; mark test records clearly (name prefix) if any were created.

## 7. Pass criteria and sign-off

All L1 checks green on staging; every scenario in section 4 and 5 passes or has a recorded, accepted difference (the "deliberate differences" list in `cheque-and-payment-collection.md`); section 3 queries clean; the acceptance run matches monday; no open High finding.
