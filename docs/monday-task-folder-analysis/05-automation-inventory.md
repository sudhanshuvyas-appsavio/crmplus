# 05. Automation inventory

Read through `list_automations` (workflows and legacy recipes) and `get_automation_statistics` on 2026-11-19. Nothing was executed or triggered. All times are IST (`Asia/Calcutta`). Recipients are **in-app notifications** ("Notify someone" blocks).

Totals: **30 automations**: 20 workflow-engine automations (18 active, 2 inactive) + 10 legacy "update column from lookup" recipes (all active). Run statistics: success 0 / failure 0 / total 0 on all seven boards (history is either not retained for these or they have not run since monday started counting): **execution history is effectively unavailable**.

Notation: "P" = Person/People column, "Acc" = Accounts column. `{name}` = the item name.

## 5.1 Monthly Visit (9 workflows + 2 legacy)

| # | id | Trigger | Conditions | Actions | Timing | Recipients | State |
|---|---|---|---|---|---|---|---|
| A-1 | 1939786788 | Item created | none | Set Created Date = today | immediate | none | active |
| A-2 | 1939784313 | Created Date arrives | Visited/Not Visited is **Not Visited** | Notify "Hey, {person}, You have not visited yet." (title {name}) | 17:45, offset not set | P + Acc | active |
| A-3 | 1939786802 | Visited Date arrives | Visited/Not Visited is **Visited** (no pending-payment check) | Notify "Hey, {person}, you have visited and not collect the payment." | 10:00, offset **+30 days** | P + Acc | active |
| A-4 | 1939784316 | Visited Date arrives | Pending Payment = Yes AND status is Visited or Not Visited | Notify "...you have visited and not collected the payment after 30 days"; create item in Payment Collection "Monthly Visit - {name}" (both boards linked) | 18:00, offset not set | P + Acc | active |
| A-5 | 1939784318 | Visited Date arrives | same | "...after 45 days"; create item | 22:15, offset not set | P + Acc | active |
| A-6 | 1939784296 | Visited Date arrives | same | "...after 60 days"; create item | 22:45, offset not set | P + Acc | active |
| A-7 | 1939789663 | **Created Date** arrives | Visited Date **empty** AND Pending Payment = Yes AND status Visited or Not Visited | "you have **not** visited and not collected the payment after 30 days"; create item | 18:15 | P + Acc | active |
| A-8 | 1939789665 | Created Date arrives | same | "...after 45 days"; create item | 22:15 | P + Acc | active |
| A-9 | 1939789669 | Created Date arrives | same | text says "you have visited ... after 60 days" (copy error); create item | 22:45 | P + Acc | active |
| A-21 | legacy 29975385 | Item created | none | Person := Messenger of linked buyer (lookup through `board_relation_mm1hwqvw`) | immediate | none | active |
| A-22 | legacy 29975569 | Buyer relation changes | none (apply to existing: off) | same | immediate | none | active |

Notes
- The condition "status is Visited **or** Not Visited" (an any-of list) means a visit already marked **Completed** is excluded. Both branches therefore fire for Not Visited rows that have Pending Payment = Yes.
- A-4..A-9 show **no offset** in the stored configuration although their messages say 30/45/60 days. Only A-3 stores an offset. Treat as **unverified** and confirm in the editor.
- A-2 fires on the Created Date itself, not later: a visit created today and not marked Visited by 17:45 gets the reminder the same day.

## 5.2 Mill Invoice Delivery (1 workflow + 2 legacy)

| # | id | Trigger | Conditions | Actions | Recipients | State |
|---|---|---|---|---|---|---|
| A-10 | 1939786580 | **Delivery Proof Upload** column changes | an "is not empty" check on the same file column is placed **last** (after the actions), so it does not gate them | 1) Notify "Hey, {Accounts name}, Mill Invoice is delivered"; 2) Change status Invoice Status := Delivered | `multiple_person_mm1ktj9h` (Accounts, inferred) | active |
| A-23 | legacy 29989333 | Item created | | People (`multiple_person_mm217rkz`) := Messenger via `board_relation_mm21fbpq` | none | active |
| A-24 | legacy 29989370 | Buyers relation changes | | same | none | active |

## 5.3 Commission Invoice Delivery (2 workflows + 2 legacy)

| # | id | Trigger | Conditions | Actions | Timing | Recipients | State |
|---|---|---|---|---|---|---|---|
| A-11 | 1939784325 | Created Date arrives | Pending Payment Status **is Yes** | Notify "Hey, {person}, Payment is pending for this record."; create item in Payment Collection named "Commission Invoice - {name}" (both boards linked) | 18:30, offset 0 | Person (`person`) + `multiple_person_mm1kba9f` (Accounts) | active |
| A-12 | 1939787001 | Item created | none | Set Created Date := today; copy the Commission Invoices relation; set Person := creating user | immediate | none | **inactive**: "missing column" notice |
| A-25 | legacy 29983513 | Buyer relation changes | | People (`multiple_person_mm21wx44`) := buyer Messenger | | | active |
| A-26 | legacy 29983530 | Item created | | same | | | active |

Risk: A-11 notifies a column named `person`; the board's current column values contain no `person` key (they contain `multiple_person_mm21wx44` and `mm1kba9f`), so the Person recipient is probably empty and only Accounts are told. **Unverified**.

## 5.4 Payment Collection (4 workflows)

| # | id | Trigger | Conditions | Actions | Recipients | State |
|---|---|---|---|---|---|---|
| A-13 | 1939786764 | Item created | none | Set Start Date (`date_mm1kze46`) := today | none | active |
| A-14 | 1939784157 | **Amount Collected** (`numeric_mm1he4bq`) changes | Amount Collected is **greater than 0** | Notify "Hey, {user who changed it} , Amount collected is {amount}" (title: Person name) | Person + Accounts (`multiple_person_mm1kzfxd`) | active |
| A-15 | 1939786765 | **Payment Status** (`color_mm1k12av`) changes to **Completed** | none | Set End Date (`date_mm1kk6vt`) := today | none | active |
| A-16 | 1939789667 | Item created | Connected Boards **is not empty** (condition runs before the change) | Change Connected Boards := Connected Boards (copy) | none | **inactive** |

## 5.5 Cheque Collection (1 workflow + 2 legacy)

| # | id | Trigger | Actions | Recipients | State |
|---|---|---|---|---|---|
| A-17 | 1939786777 | **Cheque Photo Upload** (`file_mm1hd5jy`) changes | 1) Change Deposit Status := **Collected** (index 5); 2) Notify "Your Check for {name} is {Deposit Status label}" (title {name}) | Accounts (`multiple_person_mm1hmnsr`) | active |
| A-27, A-28 | legacy 29989282 / 29989284 | Item created / buyer relation changes | Person (`multiple_person_mm1k8pgv`) := buyer Messenger | none | active |

## 5.6 Transport Freight Invoice (1 workflow)

| # | id | Trigger | Actions | Recipients | State |
|---|---|---|---|---|---|
| A-18 | 1939786760 | **Check** (`color_mm1kh55r`) changes to **Outstanding** | Notify "Hey, {Accounts name}, The payment for {name} is {Check}" (title {name}) | Person (`person`) + Accounts (`multiple_person_mm1kft12`) | active |

## 5.7 Sample Delivery (2 workflows + 2 legacy)

| # | id | Trigger | Conditions | Actions | Timing | Recipients | State |
|---|---|---|---|---|---|---|---|
| A-19 | 1939782423 | **Feedback Status** changes to **Approved** | none | Create item "Sample Delivery - {name}" in board 5024227502 with lead status **Qualified**, link both boards | immediate | none | active but **target board private/deleted: cannot work** |
| A-20 | 1939784308 | Delivery Date arrives | Feedback Status **is Pending** | Notify "Hey, {person}, The sample {name} feedback is due." | 20:30, offset **+7 days** | Person + Accounts (`multiple_person_mm1ka77e`) | active |
| A-29, A-30 | legacy 29989306 / 29989311 | Item created / buyer relation changes | | Person (`person`) := buyer Messenger | | | active |

## 5.8 Categories covered and not covered

| Category | Present | Where |
|---|---|---|
| Status-based | yes | A-10, A-14, A-15, A-17, A-18, A-19 |
| Date-based (date arrives, with optional offset) | yes | A-2..A-9, A-11, A-20 |
| Assignment-based | yes (copy from lookup) | A-21..A-30 |
| Cross-board (create item and connect) | yes | A-4..A-9, A-11, A-19 |
| Recurring (create tasks on a schedule) | **none** | |
| Overdue-to-status, move to group, subitem creation, dependency, integration triggers | **none** | |
| Notification | yes | every workflow except A-1, A-12, A-13, A-15, A-16 |

## 5.9 Execution logic (section 3.3 questions)

| Question | Answer |
|---|---|
| What triggers each? | Section tables above |
| Conditions evaluated? | Status "is"/"is any of", column empty / not empty, number greater than; evaluated in the order of the stored node chain |
| Immediate or scheduled? | Item/column/status triggers are immediate; "date arrives" fires at the stored time on the date (+ offset), once per item per date value (platform behaviour) |
| Several automations from one event? | Yes: A-2, A-4..A-9, A-1 all hang off the same Created/Visited Date values; A-21 and A-1 both run on item creation; A-26 and A-12 would both run on creation of a Commission Invoice Delivery item |
| Automations trigger other automations? | Yes, through the data they write: A-1 sets Created Date, which later arms A-2 and A-7..A-9; A-4..A-9 and A-11 create Payment Collection items, which fire A-13 (Start Date) and, once A-16 was active, A-16; A-10 sets Invoice Status which is mirrored into D&B (a D&B automation on that column is possible: not read here) |
| Duplicate execution prevented? | Only by monday itself (one date-arrives fire per item per date). There is **no** duplicate check on the created Payment Collection items |
| Failure handling / retries? | monday retries platform errors; there are no custom handlers. A-12 shows "missing column", A-19 has no target; both fail without alerting anyone |
| Execution history? | monday offers per-automation history and statistics; the statistics returned 0 for all boards |
| Who may enable/disable/modify? | Board owners and admins (SK, Jyoti); the legacy recipes were created by Jyoti |

## 5.10 Edge cases and loops

1. **Same-day multiple fires**: for a visit with Pending Payment = Yes and Not Visited, A-2 (17:45), A-7 (18:15), A-8 (22:15) and A-9 (22:45) all fire on the Created Date if the offsets really are 0, creating three Payment Collection items for one visit. Offsets must be confirmed.
2. **Visited visit with Created Date branch**: A-7..A-9 require Visited Date empty, so a visited row never double-fires.
3. **Completed visit**: excluded from A-4..A-9 by the status condition.
4. **Loop risk**: none found. The only self-write is A-1 (Created Date) which arms later date triggers; A-16 (copy a column onto itself) is a no-op and inactive.
5. **Changed buyer**: Person is re-copied on relation change (A-22, A-24, A-26, A-28, A-30) and overwrites a manual Person.
6. **Messenger change on the buyer** does not update existing rows (apply-on-existing is off).
7. **Date arrives with no value**: nothing fires.
8. **Timezone**: all date triggers use `Asia/Calcutta`; the legacy recipes have no timezone.
