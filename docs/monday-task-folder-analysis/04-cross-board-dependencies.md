# 04. Cross-board dependencies

Sources: board columns (`docs/monday-crm-reference.md`, relationships section), item reads (2026-11-19), the automation configurations (document 05). "Platform behaviour" marks what monday does by design and was not tested (testing would change production).

## 4.1 Board relations (Connect Boards columns)

| # | Source board . column | Destination | Type | Direction | Created how | Sync |
|---|---|---|---|---|---|---|
| R1 | Monthly Visit . Buyers Name | Buyers & Suppliers | many-to-one in practice | one-way (no reflection column on the buyer) | by hand / form | manual; Person copied from buyer by A-21/A-22 |
| R2 | Monthly Visit . link to Payment Collection (`board_relation_mm1pthv6`) <-> Payment Collection . Connected Boards (`board_relation_mm1h6bza`) | Payment Collection | one-to-many | **two-way** | automation A-4..A-9 creates the Payment Collection item and links both columns | automatic |
| R3 | Mill Invoice Delivery . Dispatch and Billing (`board_relation_mm1jn6e2`) <-> D&B . link to Mill Invoice Delivery | Dispatch and Billing | one-to-one | **two-way** | D&B automation creates the Mill row (CRMMasterPlan P2-3 A5) | automatic |
| R4 | Mill Invoice Delivery . Buyers (`board_relation_mm21fbpq`) | Buyers & Suppliers | many-to-one | one-way | by hand | Person copied (A-23/A-24) |
| R5 | Commission Invoice Delivery . Commission Invoices (`board_relation_mm1h86tq`) <-> Commission Invoices . link to Commission Invoice Delivery | Commission Invoices | one-to-one | **two-way** | created with the commission invoice (automation on that board, unverified) | automatic |
| R6 | Commission Invoice Delivery . Buyer (`board_relation_mm214a94`) | Buyers & Suppliers | many-to-one | one-way | by hand | Person copied (A-25/A-26) |
| R7 | Commission Invoice Delivery . link to Payment Collection (`board_relation_mm1pw49r`) <-> Payment Collection . Connected Boards | Payment Collection | one-to-many | **two-way** | A-11 | automatic |
| R8 | Payment Collection . Connected Boards | Monthly Visit **and** Commission Invoice Delivery | multi-board relation | two-way with both | A-4..A-9 and A-11 | automatic |
| R9 | Cheque Collection . Buyer Name (`board_relation_mm1hrhgd`) | Buyers & Suppliers | many-to-one | one-way | by hand | Person copied (A-27/A-28) |
| R10 | Transport Freight Invoice . Transport Invoice (`board_relation_mm1mepmm`) <-> Transport Invoice . link to Transport Freight Invoice | Transport Invoice | one-to-one | **two-way** | Transport Invoice automation creates the freight row | automatic |
| R11 | Sample Delivery . Buyer (`board_relation_mm1heveq`) | Buyers & Suppliers | many-to-one | one-way | by hand | Person copied (A-29/A-30) |
| R12 | Sample Delivery . Supplier (`board_relation_mm1zjtwc`) | Buyers & Suppliers | many-to-one | one-way | by hand | none |
| R13 | Sample Delivery . (Qualified-leads link, `board_relation_mm1pvwhs`) | a private/deleted board | n/a | dead | A-19 | broken |

Cardinality note: a Connect Boards column accepts several items; the "one-to-one" labels describe how the automations use them.

## 4.2 Mirror columns (read-only copies through a relation)

| Board . Mirror | Through | Source column | Notes |
|---|---|---|---|
| Monthly Visit . Buyer Messenger | R1 | Buyers & Suppliers . Messenger | |
| Mill . Buyer Messenger | R4 | B&S . Messenger | |
| Mill . Supplier Name | R3 | D&B . Supplier (relation) | |
| Mill . Supplier Messenger | R3 | D&B . Supplier Messenger (itself a mirror) | mirror of a mirror |
| Mill . Invoice Number, Invoice Date | R3 | D&B . Invoice No., Invoice Date | |
| Commission Invoice Delivery . Commission Amount | R5 | Commission Invoices . `numeric_mm16fcy2` | |
| Commission Invoice Delivery . Buyer Messenger | R6 | B&S . Messenger | |
| Payment Collection . Buyer Name | R8 | Monthly Visit . Buyers Name and Commission Invoice Delivery `lookup_mm1kv6ew` | **broken for the second board** |
| Freight . Buyer | R10 | Transport Invoice `lookup_mm1k6dqe` | **broken** (column removed on the target) |
| Sample . Buyer Messenger, Supplier Messenger | R11, R12 | B&S . Messenger | |

Mirrors are **one-directional and automatic**: monday recalculates them when the source changes (platform behaviour). Broken mirrors show empty or "Column value type is not supported".

## 4.3 Cross-board item creation and updates (automations)

| From | Event | Creates / updates | Link |
|---|---|---|---|
| Dispatch and Billing | item created | Mill Invoice Delivery item "<name> - Task", Status Working on it | R3 |
| Transport Invoice | item created | Transport Freight Invoice item "<name> - Transport Task" | R10 |
| Commission Invoices | (item created; unverified) | Commission Invoice Delivery item | R5 |
| Monthly Visit | date triggers (A-4..A-9) | Payment Collection "Monthly Visit - {name}" | R2/R8 |
| Commission Invoice Delivery | date trigger (A-11) | Payment Collection "Commission Invoice - {name}" | R7/R8 |
| Mill Invoice Delivery | Invoice Status | mirrored into D&B "Mill Invoice Status" | R3 |
| Sample Delivery | Approved (A-19) | would create a Qualified lead; target missing | R13 |
| Buyers & Suppliers | Messenger change | **not** propagated: A-21..A-30 run only on create or when the item's own relation changes ("apply on existing items" is off) | |

## 4.4 Other dependency kinds

| Kind | Present? |
|---|---|
| Dependency columns, timeline/Gantt, workload | **None** on the seven boards |
| Parent/child | Subitem columns on Payment Collection and Cheque Collection only (no data) |
| Shared people | Person/People from the buyer's Messenger; Accounts typed |
| Shared dates | Created Date and Visited Date drive Monthly Visit and Payment Collection automations; Delivery Date drives Sample |
| Cross-board status updates | Mill Invoice Delivery Status -> D&B Mill Invoice Status (mirror) |
| Cross-board notifications | None: every notification is sent from the board that triggers it |

## 4.5 Deletion and archive effects (platform behaviour, not tested)

- Deleting or archiving a **linked item** removes it from the Connect Boards column of the other board; mirrors that depended on it become empty. No Tasks automation reacts.
- Deleting a Payment Collection item created by a visit leaves the visit's `link to Payment Collection` empty; the next date automation can create a **new** Payment Collection item (no duplicate check).
- Deleting the target board of a relation (as happened to the Qualified-leads board) leaves the column showing "Private/Deleted" and the automation failing silently.

## 4.6 Dependency map

```mermaid
flowchart TB
  BS[(Buyers & Suppliers)]
  DB[Dispatch and Billing]
  CI[Commission Invoices]
  TI[Transport Invoice]
  MV[Monthly Visit]
  MID[Mill Invoice Delivery]
  CID[Commission Invoice Delivery]
  PC[Payment Collection]
  CC[Cheque Collection]
  FR[Transport Freight Invoice]
  SD[Sample Delivery]
  BS -->|R1 R4 R6 R9 R11 R12, Messenger mirror| MV
  BS --> MID
  BS --> CID
  BS --> CC
  BS --> SD
  DB <-->|R3| MID
  CI <-->|R5| CID
  TI <-->|R10| FR
  MV <-->|R2| PC
  CID <-->|R7| PC
  DB -. creates .-> MID
  TI -. creates .-> FR
  MV -. A-4..A-9 create .-> PC
  CID -. A-11 creates .-> PC
```
