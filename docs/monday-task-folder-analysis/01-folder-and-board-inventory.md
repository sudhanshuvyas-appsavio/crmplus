# 01. Folder and board inventory

Source: monday.com read-only calls on 2026-11-19 (`workspace_info`, `get_board_info` with views and subscribers, `get_board_items_page`, `list_users_and_teams`). Anything not readable is marked **unverified**.

## 1.1 The folder

| Item | Value |
|---|---|
| Workspace | "CRM", id 2480519, kind **open**, default workspace, created 2025-11-10. Workspace owner: a deleted member (the owner record shows "Deleted member") |
| Folder | **Tasks**, id 6555221. No description. No nested folders. No docs in the folder |
| Sibling folders | MDM (6502872, 7 boards), CRM (6502922, 3 boards). Not part of this audit except where a Tasks board links to them |
| Boards in the folder | 7 (below). The folder holds no other objects |
| Created by | One user, "SK", for every board (creator and sole board owner) |
| Board kind / visibility | All seven: `public`, permissions `everyone` |
| Hierarchy | All seven are classic (not multi-level) boards. Items limit 100000 |
| Board descriptions | Empty on six boards; Cheque Collection: "Board to manage tasks and processes involved in cheque collection and payment follow-ups." |
| Item terminology | Monthly Visit: "task"; Cheque Collection: "Cheque"; the rest: "item" |

## 1.2 Boards

| # | Board | Id | Rows | Groups | Last updated (monday) | Subscribers |
|---|---|---|---|---|---|---|
| 1 | Monthly Visit | 5027265052 | 3 | Group Title | 2026-11-18 | SK, Jyoti |
| 2 | Mill Invoice Delivery | 5027269220 | 26 | Group Title | 2026-04-03 | SK |
| 3 | Commission Invoice Delivery | 5027269270 | 31 | Group Title | **2026-11-19** | SK |
| 4 | Payment Collection | 5027269376 | 0 | Group Title | **2026-11-19** | SK |
| 5 | Cheque Collection | 5027269441 | 1 | **To Collect**, **In Progress**, **Collected** (ids `topics`, `group_mm1headj`, `group_mm1haah0`) | 2026-04-02 | SK |
| 6 | Transport Freight Invoice (monday title carries the agency's trade name as a prefix; left out in CRM+ on purpose) | 5027269319 | 20 | Group Title | 2026-04-02 | SK |
| 7 | Sample Delivery - Comes From Mills | 5027269351 | 1 | Group Title | 2026-03-31 | SK |

Boards 3 and 4 were edited on the day of the audit, so their configuration can still change: re-read before building.

**Subitem boards** (monday creates one per board that has a Subitems column): "Subitems of Payment Collection" (5027318483), "Subitems of Cheque Collection" (5027269448) and a second "Subitems of Cheque Collection" (5027269447, unused duplicate). Default columns only: Name, Owner, Status (Working on it / Done / Stuck), Date. No subitems exist in the data seen.

## 1.3 Owners, administrators and members

| Person | monday role | Where seen |
|---|---|---|
| SK | admin; creator and only listed **owner** of all seven boards; subscriber of all | all boards; Person/Accounts values |
| Jyoti | admin; subscriber of Monthly Visit; creator of the 10 legacy automations (user id 99199946) | Monthly Visit, legacy recipes |
| Rahul Sharma | member (appears as Person on a Monthly Visit row) | Monthly Visit |

No team owners, no team subscribers, no tags on any board. The full member list of the account was not read (listing all users is a broad query); roles of ordinary members are **unverified**.

## 1.4 Views on each board

| Board | Views (id, name, type) |
|---|---|
| Monthly Visit | 51858876 "Dashboard" (dashboard widget view, settings empty); 51888089 "Creation Form" (app view, feature 16492757) |
| Mill Invoice Delivery | 51888736 "Creation Form" (app view 16492757); 51969954 "Reports" (dashboard view) |
| Commission Invoice Delivery | 51888738 "Creation Form"; 51969988 "Reports"; 52236729 "Build Vibe view" (app feature 15528052); 58595553 "Commission Invoice From" (app feature 17720591) |
| Payment Collection | 51888761 "Creation Form"; 51970020 "Reports"; 52123299 "Build Vibe view" |
| Cheque Collection | 51888765 "Creation Form"; 51970036 "Reports"; 52152923 "Build Vibe view" |
| Transport Freight Invoice | 51888741 "Creation Form"; 51970000 "Reports"; 52123283 "Build Vibe view" |
| Sample Delivery | 51888745 "Creation Form"; 51970012 "Reports" |

The default main table view exists on every board but is not returned by the API as a named view. No view carries a stored filter or sort. **The contents of the forms, dashboards and app views are unverified** (embedded features, not readable without a signed-in editor).

## 1.5 Connected boards outside the folder that take part

| Board | Id | Role in the Tasks workflows |
|---|---|---|
| Buyers & Suppliers (MDM) | 5024227503 | Every Tasks board links to it (buyer, supplier); its **Messenger** people column drives Person on five boards |
| Dispatch and Billing (CRM) | 5026792171 | Creates a Mill Invoice Delivery row; two-way link; supplies Invoice No./Date and supplier mirrors |
| Commission Invoices | 5026907737 | Two-way link with Commission Invoice Delivery; supplies Commission Amount |
| Transport Invoice | 5027015093 | Creates a Transport Freight Invoice row; two-way link |
| Qualified-leads board | 5024227502 | Target of the Sample Delivery "Approved" automation. **Private or deleted** (shows as "Private/Deleted") |
| Whatsapp Message / Whatsapp Tracking | 5027236770 / 5027998834 | Message log used by the wider system; no Tasks automation writes to it |

## 1.6 Row counts and observed usage (2026-11-19)

| Board | Rows | What the rows look like |
|---|---|---|
| Monthly Visit | 3 | Two rows named "New task" with buyer and Created Date only; one "Item 1" with GPS address, Pending Payment = Yes, Visited/Not Visited = Not Visited, Accounts = SK |
| Mill Invoice Delivery | 26 | Rows named "<SC no> - Task" / "JC ... - Task" created from Dispatch and Billing; Status "Working on it"; Invoice mirrors filled; delivery mode, proof, GPS empty |
| Commission Invoice Delivery | 31 | Named "Invoice 1", "Invoice 2": linked to a Commission Invoice (Commission Amount mirror filled); status columns empty |
| Payment Collection | 0 | Empty |
| Cheque Collection | 1 | "New Check": Deposit Status Collected, in group Collected, Accounts Jyoti, Person SK (from buyer Messenger) |
| Transport Freight Invoice | 20 | Named "<Transport Invoice> - Transport Task"; almost all columns empty |
| Sample Delivery | 1 | "New item": buyer linked, Person SK (from Messenger), everything else empty |

Conclusion: the automations were built and the boards are wired, but the field team has barely used the boards. There is little production data to migrate; behaviour, not data, is what must be replicated.
