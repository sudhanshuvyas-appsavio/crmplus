# Cheque Collection and Payment Collection: monday against CRM+, gaps, change plan

Sources: monday read-only (board columns, 4 automations on Payment Collection, 3 on Cheque Collection, the creation forms and Reports views, 2026-11-19/20); the CRM+ code and migrations; read-only queries of the live database (2026-11-20); tests run in the local harness (`supabase/tests/local-harness`).

## 1. The two boards in monday

**Payment Collection (5027269376, 0 rows).** Columns: Name, Subitems, Person, Accounts, Connected Boards (Monthly Visit or Commission Invoice Delivery), Buyer Name (mirror), Invoice Number, Amount, Amount Collected, Mode of Payment (Online, Cash, Cheque), Payment Proof Upload, Balance Amount (`Amount - Amount Collected`), GPS Check-In, Payment Status (Outstanding, Completed), Start Date, End Date, Days Aging (`DAYS(End Date, Start Date)`). Form: General Information (Name, Person, Connected Boards) and Payment Details (Invoice Number, Amount, Amount Collected, Mode, Proof, Balance, GPS). Report: one chart.

**Cheque Collection (5027269441, 1 row).** Columns: Name, Accounts, Person, Buyer Name, Invoice Number, Cheque Number, Bank Name, Cheque Date, Cheque Amount, Cheque Photo Upload, Deposit Status (Pending, Deposited, Cleared, Collected), Notes, Subitems, GPS. Groups To Collect, In Progress, Collected. Form: General Information (Name, Buyer Name, Accounts) and Cheque Collection Details (Invoice Number, Cheque Number, Bank, Date, Amount, Photo, Deposit Status, Notes, GPS). Reports: Date Wise Collection, Party Wise Collection, Date Wise Deposited, Staff Wise Deposited.

## 2. monday automations (all active unless stated)

| Board | # | Automation |
|---|---|---|
| Payment Collection | A-13 | Item created: Start Date = today |
| | A-14 | Amount Collected changes and is greater than 0: notify Person and Accounts "Hey, {name}, Amount collected is {Amount Collected}" (the column value, i.e. the total so far) |
| | A-15 | Payment Status becomes Completed: End Date = today |
| | A-16 | (inactive) Item created: copy Connected Boards |
| | (on other boards) | Monthly Visit A-4..A-9 and Commission Invoice Delivery A-11 create the Payment Collection items |
| Cheque Collection | A-17 | Cheque Photo Upload changes: Deposit Status = Collected, then notify Accounts "Your Check for {name} is Collected" |
| | A-27, A-28 | Person = the buyer's Messenger, on create and when the buyer changes |

## 3. What CRM+ had, and what was missing

| # | Finding | Severity | Status after this work |
|---|---|---|---|
| P-1 | **"Record payment" failed for everyone.** `task_add_payment` declared a variable `id` and read `where id = p_task`: PostgreSQL raises "column reference id is ambiguous". The live database has 0 payment lines, so it never worked. With no payment recorded, A-13/A-14/A-15 (collected amount, notification, completion) could not run from the screens | **Critical** | Fixed in migration `20261120160000` (variable renamed). Verified in the local harness |
| P-2 | A-14 text: CRM+ said "Amount collected is {last payment}" with no greeting; monday says "Hey, {name}, Amount collected is {total so far}" | Medium | Fixed (same migration): greeting + running total (`trim_scale`), the person who recorded it is still not told about their own entry |
| P-3 | A-13 Start Date, A-15 End Date (completed_at), Balance, Days Aging | none | Already matched; now covered by tests |
| C-1 | **A-17 could never notify for cheques entered in the app.** The cheque form had no Accounts field, and the notification goes to Accounts only | High | Fixed: Accounts field (managers) on the cheque form; migration makes a cheque without Accounts tell the task's Person, or the managers when nobody is set, instead of nobody |
| C-2 | A-17 when the photo came through the proof upload: trigger did not fire | High | Fixed earlier (`20261120150000`, applied) |
| C-3 | monday's form has Name; CRM+ named the task itself | Low | Name field added (empty keeps "Cheque {no} - {buyer}") |
| C-4 | A-28: changing the cheque's buyer changed `task_cheques` only, so Person did not follow the new Messenger | Medium | Fixed in the form (managers): the task takes the new buyer and the existing trigger sets Person |
| C-5 | The grid's Person column showed the collector, monday's Person is the Messenger | Low | Fixed: shows the task's Person, the collector as fallback |
| C-6 | Reports: monday has four charts | Medium | Built (`ChequeReport.tsx`): count and amount by collection date, party, deposit date and who deposited, over the cheques shown. monday's widget filters are unreadable, so all cheques shown are counted |
| C-7 | Subitems on a cheque | none | Built earlier (detail drawer) |
| C-8 | The one live cheque has no task (migrated), so no automation can reach it | Low | Not changed; see the test plan (data section) |

Deliberate differences that stay: Deposit Status changes through actions (deposit needs bank and slip number, "Bounced" exists), Amount Collected moves only through payment lines, Days Aging counts open days to today while monday leaves it empty until End Date, the Person on a payment task is filled from the buyer's Messenger when a buyer is picked (monday has no such recipe there), the Connected Boards link is a single source.

## 4. Change plan (and what was applied)

| Step | Change | Files | State |
|---|---|---|---|
| 1 | Fix "Record payment" | `supabase/migrations/20261120160000_cheque_and_payment_collection_automations.sql` (section 3) | written, tested locally, **not applied to the live database** |
| 2 | A-14 wording and total | same migration (section 1) | same |
| 3 | A-17 fallback recipients | same migration (section 2) | same |
| 4 | Cheque form: Name, Accounts, edit sync of Name/Accounts/buyer | `src/pages/tasks/ChequeForm.tsx` | built, typechecked |
| 5 | Cheque grid Person; Reports | `src/pages/tasks/ChequeQueue.tsx`, `ChequeReport.tsx` | built, typechecked |
| 6 | Tests | `supabase/tests/task_cheque_and_payment_collection.test.sql` (+ harness) | 8 checks pass locally |

Apply order on the live database: run the migration (idempotent, replaces three functions, creates nothing), then deploy the app. The app works before the migration for everything except the new notification wording; Record payment only starts working once the migration is applied.

## 5. Results (local harness, real migrations, stand-in base tables)

All four test files pass: 47 checks. New for these boards: Start Date; the notification greets the recipient and states the total (4000, then 6500.5, then 6600.5); the person who recorded it is not told; zero, negative and direct edits of Amount Collected are refused; fully paid completes the task and stamps End Date; completing by hand stamps End Date; reopening clears it; A-17 with Accounts, without Accounts (Person), with nobody (managers), by manual status; a second change does not notify again; Person from Messenger on a cheque task and when the buyer changes; deposit needs bank and slip; groups To Collect / In Progress / Collected; Cleared and Bounced; zero amount and duplicate number and bank are refused.

Not covered locally: the screens (cheque form, queue, reports), the real production schema, concurrency. The full test plan against data is in `cheque-and-payment-collection-test-plan.md`.
