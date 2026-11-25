# 02. Individual board analysis

Common pattern on every board: **Person/People** (the assignee, normally the buyer's Messenger), **Accounts** (people, the accounts staff who are notified), **GPS Check-In** (location column), a **proof file** column, a status column or two. Built for field staff on mobile (inferred from GPS, photo and "Creation Form" views).

Column ids (`col id`) are monday's, taken from the item reads; titles and types come from `docs/monday-crm-reference.md` (verified earlier against the API). "Inferred" means deduced from data, not read from a setting.

---

## 2.1 Monthly Visit (5027265052), 3 rows, item word "task"

**Purpose**: log the monthly visit to each buyer: where the field person checked in, what was discussed, whether payment is still pending; feeds Payment Collection when payment is not collected after 30/45/60 days.

| Column | Type | col id | Notes |
|---|---|---|---|
| Name | name | name | |
| Person | people | `person` | Filled from the buyer's Messenger (legacy automation) |
| Accounts | people | `multiple_person_mm1kqm7r` | Notified by the date automations (inferred) |
| Buyers Name | board relation | `board_relation_mm1hwqvw` | to Buyers & Suppliers |
| Buyer Messenger | mirror | `lookup_mm1zx8c5` | Messenger of the linked buyer |
| Created Date | date | `date_mm1kwb01` | Set to today when the item is created (automation) |
| Visited Date | date | `date_mm1hvqrq` | Entered by hand |
| GPS Check-In | location | `location_mm1hepwy` | Address text + coordinates |
| Check-In Time, Check-Out Time | date with time | `date_mm1jnfhp`, `date_mm1jkcn7` | Which is which: not confirmed |
| Meeting Summary | long text | `long_text_mm1h8z0j` | |
| Pending Payment Status | status | `color_mm1hx92r` | **No, Yes** (index 1 = Yes) |
| Visited/Not Visited | status | `color_mm1jzfxx` | **Not Visited (0), Visited (1), Completed** |
| link to Payment Collection | board relation | `board_relation_mm1pthv6` | two-way with Payment Collection "Connected Boards" |

Groups: Group Title. Views: Dashboard, Creation Form.
Business rules observed (all from automations, none enforced by the board): created date is stamped automatically; "Not Visited" on the creation day at 17:45 notifies; 30/45/60-day messages when Pending Payment = Yes and the visit is Visited/Not Visited; each step also creates a Payment Collection item.

## 2.2 Mill Invoice Delivery (5027269220), 26 rows

**Purpose**: physically deliver the mill's invoice to the buyer (by hand or courier) and prove it.

| Column | Type | col id | Notes |
|---|---|---|---|
| Name | name | | Auto named "<SC no> - Task" by the Dispatch and Billing automation |
| People | people | `multiple_person_mm217rkz` (inferred) | Filled from the buyer's Messenger (legacy automation) |
| Accounts | people | `multiple_person_mm1ktj9h` (inferred) | Notified when proof arrives |
| Status | status | `status` | **Working on it, Stuck, Done**. Mirrored into Dispatch and Billing "Mill Invoice Status" |
| Buyers | board relation | `board_relation_mm21fbpq` | to Buyers & Suppliers |
| Buyer Messenger | mirror | `lookup_mm21bykj` | |
| Supplier Name | mirror | `lookup_mm1j28wm` | via the Dispatch and Billing link |
| Supplier Messenger | mirror | `lookup_mm1zwkp7` | via the Dispatch and Billing link ("Column value type is not supported" in the API when empty) |
| Invoice Number | mirror | `lookup_mm1js6j6` | from Dispatch and Billing "Invoice No." |
| Invoice Date | mirror | `lookup_mm1jqh95` | from Dispatch and Billing "Invoice Date" |
| Invoice Amount | numbers | `numeric_mm1heevc` | entered |
| Delivery Mode | status | `color_mm1hh151` | **Hand, Courier** |
| Delivery Proof Upload | file | `file_mm1h6ebc` | the automation trigger |
| GPS Check-In | location | `location_mm1hewrr` | |
| Dispatch and Billing | board relation | `board_relation_mm1jn6e2` | two-way |
| Invoice Status | status | `color_mm1kns67` | **Not Delivered, Delivered (index 1)** |

Two status columns exist: `Status` (work state) and `Invoice Status` (delivery result). The automation sets only Invoice Status; **Status stays "Working on it"** after delivery (observed rule, also noted in `CRMMasterPlan.md` E-01).
Views: Creation Form, Reports.

## 2.3 Commission Invoice Delivery (5027269270), 31 rows

**Purpose**: hand the agency's commission invoice to the party, get the acknowledgement, and chase payment.

| Column | Type | col id | Notes |
|---|---|---|---|
| Name | name | | |
| People | people | `multiple_person_mm21wx44` (inferred) | from buyer Messenger (legacy automation) |
| Accounts | people | `multiple_person_mm1kba9f` (inferred) | notified by the date automation |
| Commission Invoices | board relation | `board_relation_mm1h86tq` | two-way with Commission Invoices |
| Commission Amount | mirror | `lookup_mm1km7ms` | `numeric_mm16fcy2` of Commission Invoices |
| Buyer | board relation | `board_relation_mm214a94` | |
| Buyer Messenger | mirror | `lookup_mm217ps6` | |
| Commission Invoice No. | text | `text_mm1k24d6` | |
| Invoice Date | date | `date4` | |
| Acknowledgement Received | status | `status` | **Yes, No** |
| Photo Upload | file | `file_mm1h606k` | |
| GPS Check-In | location | `location_mm1h13kt` | |
| Pending Payment Status | status | `color_mm1k5e4m` | **No, Yes** |
| Created Date | date | `date_mm1kw2yx` | automation trigger |
| link to Payment Collection | board relation | `board_relation_mm1pw49r` | |

Views: Creation Form, Reports, "Build Vibe view" (app), "Commission Invoice From" (app).
Observed state: the "item created" automation is **inactive** (it errors with a missing column), so Created Date is entered or stamped by the creating automation of the Commission Invoices board (unverified).

## 2.4 Payment Collection (5027269376), 0 rows

**Purpose**: money still to collect, with ageing; created automatically from Monthly Visit and Commission Invoice Delivery.

| Column | Type | col id | Notes |
|---|---|---|---|
| Name | name | | "Monthly Visit - {name}" or "Commission Invoice - {name}" when created by automation |
| Subitems | subtasks | `subtasks_...` | board 5027318483, default columns |
| Person | people | `person` | |
| Accounts | people | `multiple_person_mm1kzfxd` | notified on amount collected |
| Connected Boards | board relation | `board_relation_mm1h6bza` | to Monthly Visit **and** Commission Invoice Delivery |
| Buyer Name | mirror | | **Broken**: points to a column that no longer exists on Commission Invoice Delivery |
| Invoice Number | numbers | | |
| Amount | numbers | `numeric_mm1h2tr1` | |
| Amount Collected | numbers | `numeric_mm1he4bq` | automation trigger |
| Mode of Payment | status | | **Online, Cash, Cheque** |
| Payment Proof Upload | file | | |
| Balance Amount | formula | | `{Amount} - {Amount Collected}` |
| GPS Check-In | location | | |
| Payment Status | status | `color_mm1k12av` | **Outstanding, Completed (index 1)** |
| Start Date | date | `date_mm1kze46` | set to today on creation |
| End Date | date | `date_mm1kk6vt` | set to today when Payment Status = Completed |
| Days Aging | formula | | `DAYS({End Date}, {Start Date})` (empty while open) |

Views: Creation Form, Reports, "Build Vibe view".

## 2.5 Cheque Collection (5027269441), 1 row, item word "Cheque"

**Purpose**: collect cheques and track deposit and clearance.
Groups: **To Collect** (id topics), **In Progress**, **Collected**. The groups mirror the Deposit Status; nothing moves an item between groups automatically (no group-move automation exists).

| Column | Type | col id | Notes |
|---|---|---|---|
| Name | name | | |
| Accounts | people | `multiple_person_mm1hmnsr` | notified on collection |
| Person | people | `multiple_person_mm1k8pgv` | from buyer Messenger (legacy automation) |
| Buyer Name | board relation | `board_relation_mm1hrhgd` | |
| Invoice Number | numbers | `numeric_mm1h1p3d`/`mm1h29e9` | two number columns exist for invoice and amount/cheque number (mapping not confirmed per id) |
| Cheque Number | numbers | | |
| Bank Name | text | `text_mm1hktf0` or `text_mm1hvzes` | |
| Cheque Date | date | `date_mm1h492b` | |
| Cheque Amount | numbers | `numeric_mm1h6fx0` | |
| Cheque Photo Upload | file | `file_mm1hd5jy` | automation trigger |
| Deposit Status | status | `color_mm1hwnc0` | **Pending, Deposited, Cleared, Collected** (+ one blank label) |
| Notes | text | | |
| Subitems | subtasks | `subtasks_mm1h7ht1` | board 5027269448 |
| GPS Check-In | location | `location_mm1hcpw2` | |

Views: Creation Form, Reports, "Build Vibe view".

## 2.6 Transport Freight Invoice (5027269319), 20 rows

**Purpose**: check each transporter's bill: bill no., amount, load reference, delivery proof; mark outstanding or cleared.

| Column | Type | col id | Notes |
|---|---|---|---|
| Name | name | | Auto named "<Transport Invoice> - Transport Task" |
| Person | people | `person` | |
| Accounts | people | `multiple_person_mm1kft12` | notified on Outstanding |
| Transport Invoice | board relation | `board_relation_mm1mepmm` | two-way |
| Buyer | mirror | `lookup_mm1mw3pv` | **Broken** (target column removed on Transport Invoice) |
| Transport Bill No. | numbers | `numeric_mm1hjd1d` or `mm1h3a99` | |
| Transport Amount | numbers | | |
| Load Reference | text | `text_mm1hj3fc` | |
| Delivery Proof | file | `file_mm1h58ht` | |
| GPS Check-In | location | `location_mm1hr58n` | |
| Status | status | `status` | **Yes, No** (meaning unclear: delivered? received?) |
| Check | status | `color_mm1kh55r` | **Outstanding (0), Cleared** |

Views: Creation Form, Reports, "Build Vibe view".

## 2.7 Sample Delivery - Comes From Mills (5027269351), 1 row

**Purpose**: deliver yarn samples received from mills to buyers and chase feedback seven days later.

| Column | Type | col id | Notes |
|---|---|---|---|
| Name | name | | |
| Person | people | `person` | from buyer Messenger |
| Accounts | people | `multiple_person_mm1ka77e` | notified with Person |
| Buyer | board relation | `board_relation_mm1heveq` | |
| Buyer Messenger | mirror | `lookup_mm1zvyx8` | |
| Supplier | board relation | `board_relation_mm1zjtwc` | |
| Supplier Messenger | mirror | `lookup_mm1z8dva` | |
| Sample Quality, Sample Lot | text | `text_mm1h6a1c`, `text_mm1h5aee` | |
| Sample Type | status | `status` | **TBD 1/2/3** (never defined) |
| Delivery Date | date | `date4` | automation trigger (+7 days) |
| Feedback Due Date | formula | `formula_mm1m358w` | `FORMAT_DATE(ADD_DAYS({Delivery Date}, 7), "DD-MM-YYYY")` |
| Feedback Status | status | `color_mm1hnx6b` | **Pending (2), Approved (1), Rejected** |
| GPS Check-In | location | `location_mm1hc3jt` | |
| Photo Proof | file | `file_mm1hn2vm` | |

Views: Creation Form, Reports.

---

## 2.8 How users operate the boards (all seven)

| Question | Observed answer | Evidence |
|---|---|---|
| How are items created? | Three ways: by hand or the **Creation Form** view; by an automation on another board (Dispatch and Billing creates Mill rows, Transport Invoice creates Freight rows, Commission Invoices creates Commission Invoice Delivery rows, date automations create Payment Collection rows, Sample Approved tried to create a lead) | item names, automation configs |
| Edited? | In the board table, in the item card, or from the mobile app (GPS Check-In and file columns suggest mobile) | column types; mobile use inferred |
| Moved between groups? | Only Cheque Collection has groups; moved by hand (no group automation) | automation lists |
| Statuses updated? | By hand; automations set Invoice Status = Delivered and Deposit Status = Collected | automations |
| Assigned? | Person/People auto-filled from the buyer's Messenger on create and on buyer change; Accounts by hand | 10 legacy recipes |
| Deadlines? | No due-date column on any board. The *date* columns (Created Date, Visited Date, Delivery Date, Start/End Date) drive automations; there is no priority column | columns, automations |
| Priorities? | None | columns |
| Archived/deleted? | Standard monday archive/delete (platform behaviour); no rule on these boards | automations |
| Subitems? | Only Payment Collection and Cheque Collection have the column; none used | subitem boards, data |
| Comments, updates, files? | Standard monday item updates; files only through file columns | columns |
| Search/filter/sort? | Standard board table tools; no saved filters on any board | views |
| Links to other boards? | Section 04 | |

## 2.9 Business rules governing the folder (observed, not assumed)

1. A mill invoice delivery is complete when **proof is uploaded**; the proof upload (not a status change) sets Invoice Status = Delivered and notifies accounts.
2. A cheque is **collected** when its photo is uploaded; accounts are notified; the cheque's group is not moved.
3. A commission invoice with **Pending Payment = Yes** triggers, on its Created Date at 18:30 IST, a notification to Person and Accounts and the creation of a Payment Collection item linked both ways.
4. A visit with Pending Payment = Yes and status Visited or Not Visited triggers the same on the 30/45/60-day automations, once for the Visited Date branch and once for the Created Date branch (when Visited Date is empty).
5. A visit still "Not Visited" on its Created Date at 17:45 IST notifies Person and Accounts.
6. Payment Collection: Start Date is stamped on creation; End Date is stamped when Payment Status becomes Completed; any Amount Collected greater than 0 notifies Person and Accounts.
7. Freight: Check = Outstanding notifies Person and Accounts. Sample: feedback still Pending seven days after the Delivery Date at 20:30 IST notifies Person and Accounts.
8. Person on five boards is the buyer's Messenger. Accounts is never filled automatically.
9. No board enforces required fields, status transitions or "cannot complete until" rules in the board itself (no column required flags were readable; the creation forms may mark fields required: unverified).
