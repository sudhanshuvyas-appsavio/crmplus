# 13. Acceptance criteria and final checklist

Each item is verifiable by the tests of document 12 or by a read-only comparison with monday. "Done" means: behaviour matches monday (or the recorded decision), tests pass, typecheck and build pass, one verified push to Testing and main.

## 13.1 Acceptance criteria by feature

| Feature (document 10) | Acceptance criterion | Test |
|---|---|---|
| F-01 Folder of 7 boards | Sidebar group Tasks lists the seven boards in monday's order; each opens its own register | TC-GRID-n |
| F-02 Columns | Each grid shows exactly the columns of document 02 in order | TC-GRID-n |
| F-03 Status labels | Labels per board as in document 02 (Mill: Working on it/Stuck/Done + Invoice Status; Cheque: Pending/Collected/Deposited/Cleared; Sample feedback: Pending/Approved/Rejected) | TC-DATA-2 |
| F-05 Subitems | Add/edit/delete on Payment Collection and Cheque Collection only | TC-SUB-1 |
| F-07 Typed fields | No board field is read from `details`; invalid labels rejected by the database | TC-DATA-1/2 |
| F-08/F-09 Forms | Sections, order, labels, required marks equal the monday form (after T-00) | TC-FORM-n |
| F-13 Person | Person = buyer's Messenger on create and on buyer change; Accounts never automatic | TC-A21 |
| F-20/F-21 Links | Visit and commission delivery show their Payment Collection and back | TC-REL-1/2 |
| F-24 Transport Invoice link | Freight task created from and linked to a Transport Invoice | TC-REL-FR |
| F-28 A-2 | One "You have not visited yet." to Person and Accounts on the creation day after 17:45 IST for a still-planned visit | TC-A2a/b |
| F-29 A-3 | 30 days after Visited Date, status Visited, message "you have visited and not collect the payment." to Person and Accounts; no pending condition | TC-A3/A3b |
| F-30 A-4..A-9 | Steps 30/45/60 for both branches with monday's texts; Payment Collection "Monthly Visit - {name}" created and linked; Completed excluded | TC-A4..A9 |
| F-31 A-10 | Proof sets Invoice Status Delivered, status unchanged, Accounts get "Mill Invoice is delivered" | TC-A10 |
| F-32 A-11 | At 18:30 IST on Created Date with Pending = Yes: notification and linked Payment Collection "Commission Invoice - {name}" | TC-A11 |
| F-34..F-37 | Payment notifications, End Date, cheque collected, freight outstanding as in monday | TC-A14..A18 |
| F-39 A-20 | Feedback due message at Delivery Date + 7 days 20:30 IST for Pending feedback | TC-A20 |
| F-40 Time of day | Rules fire at their configured IST time within one cron interval and not before | TC-TIME-1 |
| F-42 Run log | Every fire and failure is listed in the Rules panel | TC-LOG-1 |
| F-50/F-51 Reports | Each monday widget has a counterpart (after T-00) | TC-REPORT-n |
| F-56 Tests | Document 12 scripts run green before each push | all |
| F-53 Permissions | Field staff, Accounts, Sales behave as in document 07 | TC-PERM-1..3 |

## 13.2 Final implementation checklist

Phase 0
- [ ] T-00 Creation forms of all 7 boards read and recorded
- [ ] T-00 Reports/Dashboard widgets and app views recorded
- [ ] T-00 Offsets of A-4..A-9 confirmed; A-11 Person recipient confirmed; People vs Accounts columns confirmed
- [ ] T-00 Product decisions D7..D11 answered

Phase 1
- [ ] T-01 Visit reminders A-2, A-3 corrected
- [ ] T-02 Person from Messenger exactly; Accounts manual
- [ ] T-03 Mill proof and commission wording/recipients

Phase 2
- [ ] T-04 Typed detail tables and backfill
- [ ] T-05 Relations and link pickers
- [ ] T-06 Subitems screen

Phase 3
- [ ] T-07 Per-board creation forms
- [ ] T-08 Grids on `board_*` views; Mill Status + Invoice Status; Sample Type list
- [ ] T-09 Reports per board

Phase 4
- [ ] T-10 Time-of-day rules
- [ ] T-11 Rule run log
- [ ] T-12 Escalation rework (both branches, per step)
- [ ] T-13 Rules as data (optional)

Phase 5
- [ ] T-14 Transport Invoice link
- [ ] T-15 Sample-to-lead decision
- [ ] T-16 Import of monday rows (optional)

Phase 6-8
- [ ] T-17 Profile templates verified
- [ ] T-18 SQL tests
- [ ] T-19 UI smoke tests
- [ ] T-20 Documentation, production check against monday (read-only), one push

## 13.3 Per-board "definition of done"

- [ ] Monthly Visit: 14 columns, form, A-1..A-9, A-21/A-22, link to Payment Collection
- [ ] Mill Invoice Delivery: 16 columns, Status + Invoice Status, A-10, A-23/A-24, Dispatch link, auto-created from dispatch
- [ ] Commission Invoice Delivery: 15 columns, A-11, A-25/A-26, Commission Invoices link, Payment Collection link
- [ ] Payment Collection: 16 columns + Subitems, A-13..A-15, Balance and Days Aging, created by escalations
- [ ] Cheque Collection: 13 columns + Subitems, groups, A-17, A-27/A-28, Subitems
- [ ] Transport Freight Invoice: 12 columns, A-18, Transport Invoice link
- [ ] Sample Delivery: 15 columns, A-20, A-29/A-30, Feedback Due formula

## 13.4 Access limitations and unverified findings (carried from documents 01-07)

1. Creation form sections, order, required marks, placeholders: unread.
2. Contents of "Reports", "Dashboard", "Build Vibe view", "Commission Invoice From": unread.
3. Date offsets of A-4..A-9 (not stored in the readable configuration).
4. Which people column is People vs Accounts on Mill, Commission Invoice Delivery, Cheque Collection (inferred from automations and data).
5. Person recipient of A-11 (column `person` no longer on the board).
6. Roles and permissions of non-admin members, guests, viewers; sharing of forms.
7. E-mail/mobile delivery of monday notifications (user-level setting).
8. monday automation run history (statistics returned 0 on every board).
9. Which Commission Invoices / Transport Invoice / Dispatch and Billing automations create the linked Tasks rows (read earlier, summarised in `CRMMasterPlan.md` P2-3/P2-5; not re-read here).
10. Boards 3 and 4 were edited on the audit date: re-read before building.
