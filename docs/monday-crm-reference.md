# monday.com CRM workspace — reference catalogue

Source: monday.com workspace **CRM** (id 2480519), account `appsavio-corp`. Captured read-only on 2026-11-17 via the monday MCP (`get_board_info` with columns only, plus small item samples).
Personal data (names, phones, emails, addresses, GST/PAN numbers) is deliberately NOT reproduced; only the shape of values is described.

Conventions:
- "Mirror -> X.Col" means a monday `mirror` (lookup) column that displays column `Col` of the item(s) linked via the named relation column on board X.
- "Relation -> Board" means a `board_relation` (connect boards) column.
- Approx rows = `items_count` reported by monday (top-level items only, may include archived/deleted counts depending on monday's API).
- Column ids are given in `code` for columns referenced by formulas.

Domain (inferred): an Indian yarn/textile **commission agent / broker**. The agency matches **Buyers** (weaving mills) with **Suppliers** (spinning mills), records a **Deal**, issues a **Sales Confirmation** to both parties, tracks **Dispatch and Billing** (mill invoices, partial dispatches), then raises **Commission Invoices** to buyer/supplier and chases **Payment/Cheque Collection**. Transport freight invoicing is handled for an own transport outfit (name omitted).

---

# Folder: CRM

## Deals (5024227507) — CRM
Purpose: a yarn trade enquiry/deal between a Buyer and a Supplier for a given count, with manager approval before it becomes a Sales Confirmation. Item terminology "Deal".
Groups: New; Manager Approval; Approved; Reconsider; Closed Lost (groups mirror the Status labels).

| Title | type | notes |
|---|---|---|
| Name | name | deal title |
| Tasks | subtasks | subitems board 5024227511 (see subitem columns) |
| Owner (`deal_owner`) | people | |
| Status (`deal_stage`) | status | New Deal -> Manager Approval -> Approved (done) / Reconsider / Closed Lost |
| Manager | people | approving manager |
| Created Date | date | with time |
| Deal No | text | human deal number |
| Approval Date | date | |
| Sales Confirmation | board_relation | -> Sales Confirmation (5026795662); two-way (reflected as SC "Link to Deals") |
| Counts | board_relation | -> Counts (5026452240) |
| Summary | mirror | -> Counts.formula_mm09f733 (count summary formula) |
| Payment Terms | board_relation | -> Payment Terms (5026694999) |
| Buyer | board_relation | -> Buyers & Suppliers (5024227503) |
| Buyer mirrors (11) | mirror | via Buyer: Messenger, Contact Person 1, Contact Person 1 Phone, Office Address, Mill/Factory/Delivery Address, GST No., Location (B&S Location MDM relation), IT PAN, Business Unit, Buyer Commission Type, Buyer Commission Value |
| Supplier | board_relation | -> Buyers & Suppliers (5024227503) |
| Supplier mirrors (11) | mirror | via Supplier: Messenger, Contact Person 1, Contact Person 2, Office Address, Mill/Factory/Delivery Address, GST No., Location, IT PAN, Business Unit, Supplier Commission Type, Supplier Commission Value |
| Quantity | numbers | |
| UOM | status | KGs, Bags, Hanks, Bales, Carton, Chippa, Meters, Tons |
| Bags Weight | numbers | kg per bag (inferred) |
| Final Rate | numbers | rate per kg (inferred) |
| Freight | text | free text |
| Mode | status | Net, Ex-Mill |
| Remarks | long_text | |
| Documents | file | |
| Location | location | map location |

Subitem columns (board 5024227511, "Tasks" — leftover from the monday CRM template, inferred unused):

| Title | type | notes |
|---|---|---|
| Name | name | |
| Products & Services | board_relation | -> Products & Services (5024227500, template board, not in scope) |
| Price | mirror | -> Products & Services.price |
| SKU | mirror | -> Products & Services.sku |
| Final Product Cost | formula | `{Price}` |
| Invoice Cost | numbers | |
| Numbers A | numbers | unnamed, likely unused |

Views: not captured (columns-only fetch).
Approx rows: 28.

## Sales Confirmation (5026795662) — CRM
Purpose: the confirmation / purchase order sent to Buyer and Supplier (email + WhatsApp) for an approved deal, later enriched with delivery/transport info. Item terminology "Confirmation Number".
Groups: New; Send; Send with Delivery Info.

| Title | type | notes |
|---|---|---|
| Name | name | confirmation number/title |
| Created Date | date | |
| Supplier | board_relation | -> Buyers & Suppliers |
| Buyer | board_relation | -> Buyers & Suppliers |
| Counts | board_relation | -> Counts |
| Counts Descriptioion [sic] | mirror | -> Counts.text_mm1mjys8 (description text) |
| Quantity (`numeric_mm0yjcj3`) | numbers | |
| Bag Weight (`numeric_mm0y7646`) | numbers | |
| Ex Mill | numbers | ex-mill rate (inferred) |
| UOM | status | KGs, Bags, Hanks, Bales, Carton, Chippa, Meters, Tons |
| Final Rate | numbers | |
| Payment Terms | board_relation | -> Payment Terms |
| Freight | status | EXCLUDED, INCLUDED |
| Send To Supplier | button | "Send Email" (automation trigger) |
| Send To Buyer | button | "Send Email" (automation trigger) |
| Whatsapp Message | status | Send to Supplier, Send To Buyer, Not Send (automation trigger) |
| Status | status | Draft -> Send -> Send with Delivery Info. |
| Type | status | Local, Export |
| Sizing/Delivery Address | board_relation | -> Sizing/Delivery Address (5026819478) |
| Delivery Schedule | long_text | |
| Subitems | subtasks | subitems board 5026795666 |
| Link to Deals | board_relation | -> Deals (two-way) |
| Confirmation No | text | |
| Business Phone | mirror | via Buyer -> B&S "Business Phone" (itself a mirror of Business Units) |
| Buyer mirrors (14) | mirror | via Buyer: Messenger, Office Address, Office Phone, GST No., Business Unit, Business Unit Name, Contact Person 1, CP1 Phone, CP1 Email, "Contact Person 2 Phone", CP2 Email, IT PAN, Email, "Buyer Business Unit Phone" (actually mirrors Office Phone) |
| Supplier mirrors (16) | mirror | via Supplier: Messenger, Office Address, Mill/Factory/Delivery Address, Office Phone, GST No., Business Unit, Business Unit Name, Contact Person 1, CP1 Phone, CP1 Email, Contact Person 2, CP2 Phone, CP2 Email, IT PAN, Email, "Supplier Business Unit Phone" (mirrors Office Phone) |
| Remarks | long_text | |
| Driver Contact Phone | phone | |
| Transporter Name | text | |
| Vehicle Number | text | |
| Confirmation approved | checkbox | |
| Send To Buyer (`boolean_mm16awx5`) | checkbox | |
| Buyer Document | file | SC PDF for buyer (inferred) |
| Supplier Document | file | SC PDF for supplier (inferred) |
| test Formula | formula | `IF({boolean_mm16awx5}, "Yay, ready.", "no, wait!!")` — test leftover |
| link to Dispatch and Billing | board_relation | -> Dispatch and Billing (two-way) |
| link to Subitems of Dispatch and Billing | board_relation | -> Subitems of Dispatch and Billing (5026869429) |
| link to Transporter Type Details | board_relation | -> Transporter Type Details (5026904637) |
| wamid | text | WhatsApp message id |
| Buyer Response / Supplier Response | text | WhatsApp reply captured |
| Messsage [sic] | long_text | WhatsApp message body |
| Message Template Name | text | WhatsApp template name |
| Buyer Email Datetime / Supplier Email Datetime | date | when email was sent |
| Formula | formula | `{numeric_mm0yjcj3} * {numeric_mm0y7646}` (Quantity x Bag Weight = total kg) |

Subitem columns (board 5026795666): Name (name); Owner (people); Status (status: Working on it, Done, Stuck); Date (date). Default monday subitems, likely unused.
Views: not captured.
Approx rows: 78.

## Dispatch and Billing (5026792171) — CRM
Purpose: one item per order/invoice being dispatched against a Sales Confirmation; subitems are individual dispatch entries (partial dispatches), each with its own invoice and commission maths. Item terminology "Invoice Number".
Groups: Draft; In Progress; Fully Dispatch; New Group.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Subitems | subtasks | board 5026869429 (dispatch entries) |
| Status | status | Draft -> Partially Dispatch -> In Progress -> Fully Dispatch; also Cancel, Return (label order by index) |
| Invoice No. | text | |
| Invoice Date | date | |
| Created Date | date | |
| Sales Confirmation | board_relation | -> Sales Confirmation (two-way) |
| Buyer | board_relation | -> Buyers & Suppliers |
| Buyer mirrors (17) | mirror | via Buyer: Messenger, Name (B&S "Name Copy"), Office Phone, Office Address, Mill/Factory/Delivery Address, "Buyer CGST" (actually GST No.), Business Unit (name), Business Unit Phone, CP1, CP1 Phone, CP1 Email, CP2 Phone, CP2 Email, Email, IT PAN, Buyer Commission Type (`lookup_mm2mz5yv`), Buyer Commission Value (`lookup_mm2mzja1`) |
| Supplier | board_relation | -> Buyers & Suppliers |
| Supplier mirrors (6) | mirror | via Supplier: Messenger, Name, Business Unit, Business Unit Phone, Supplier Commission Type (`lookup_mm2m6g9s`), Supplier Commission Value (`lookup_mm2m69x5`) |
| Sizing/Delivery Address | board_relation | -> Sizing/Delivery Address |
| Quantity (`numeric_mm0zvd0h`) | numbers | |
| Transporter Name / Vehicle Number | text | |
| Driver Contact Phone | phone | |
| Delivery Schedule | date | |
| Sr. No | text | |
| Counts | board_relation | -> Counts |
| Counts Summary | mirror | -> Counts.text_mm1mjys8 |
| UOM | status | KGs, Bags, Hanks, Bales, Carton, Chippa, Meters, Tons |
| Final Rate (`numeric_mm0z8jz5`) | numbers | |
| Bags Weight (`numeric_mm0znp3e`) | numbers | |
| Total Weight (`formula_mm16jg2p`) | formula | `{Bags Weight} * {Quantity}` |
| Value (`formula_mm15x41v`) | formula | `{Total Weight} * {Final Rate}` |
| Buyer Commission | formula | `IF(BuyerCommType="Percentage", Value*BuyerCommValue/100, IF(="BAG", BuyerCommValue*Quantity, IF(="KG", BuyerCommValue*TotalWeight, 0)))` |
| Supplier Commission | formula | same pattern using Supplier Commission Type/Value |
| CGST (`numeric_mm0zhvcf`) | numbers | percent |
| Insurance Tax (`numeric_mm0zc6t6`) | numbers | percent |
| Add / Deduct | numbers | absolute adjustments |
| Total Amount | formula | `Value + Value*CGST/100 + Value*InsuranceTax/100 + Add - Deduct` |
| Round off | numbers | |
| Sum Quantity Dispatched on Subitems (`lookup_mm0z457s`) | mirror | sum of subitems' Quantity Dispatched |
| Remark 1 | long_text | |
| Dispatch Date | date | |
| Person | people | |
| Transport Type | status | Own Transport, Agreed Third Party, Third Party (Direct Payment by Party) |
| Transporter Type Details | board_relation | -> Transporter Type Details |
| Documents | file | |
| Buyer Commission Invoice Created | checkbox | set when Commission Invoice generated (inferred) |
| Supplier Commission Invoice Created | checkbox | |
| Validation Errors | formula | `IF(SumSubitemQty > Quantity, "Sum of Subitems quantity is greater than parent item's quantity.", "")` |
| Send Email | status | Send, Not Send |
| Send Whatsapp | status | Send, Not Send |
| wamid / Response / Message Template Name | text | WhatsApp tracking |
| Message | long_text | |
| link to Mill Invoice Delivery | board_relation | -> Mill Invoice Delivery (5027269220), two-way |
| Mill Invoice Status | mirror | -> Mill Invoice Delivery.status |
| Is Duplicate? | checkbox | duplicate-invoice guard |
| Duplication Error Message | text | |
| Record Validation () | formula | `IF(Quantity < SumSubitemQty, "True", "False")` |

Subitem columns (Subitems of Dispatch and Billing, 5026869429) — one row per dispatch:

| Title | type | notes |
|---|---|---|
| Name | name | |
| Owner | people | |
| Dispatch Entry No | auto_number | |
| Status | status | Draft, Partially Dispatch (done), Fully Dispatch, Cancel, Retun [sic] |
| Invoice No. | text | |
| Invoice Date | date | |
| Conf No. | numbers | SC number |
| Sales Confirmation | board_relation | -> Sales Confirmation |
| Del Date | date | delivery date |
| Date | date | |
| Buyer | board_relation | -> Buyers & Suppliers |
| Buyer mirrors (13) | mirror | Name, Office Phone, CP1 Phone, CP2 Phone, CP1 Email, CP2 Email, Office Address, Mill/Factory/Delivery Address, Business Unit, Business Unit Phone, Email, Buyer Commission Type, Buyer Commission Value |
| Supplier | board_relation | -> Buyers & Suppliers |
| Supplier mirrors (5) | mirror | Name, "Business Unit" (bug: mirrors Name Copy, not BU), Business Unit Phone, Supplier Commission Type, Supplier Commission Value |
| Sizing/Delivery Address | board_relation | -> Sizing/Delivery Address |
| DC No. | text | delivery challan no. |
| Vehicle Number | mirror | via Sales Confirmation -> SC.Vehicle Number |
| Counts | board_relation | -> Counts |
| Counts Summary | mirror | -> Counts.text_mm1mjys8 |
| Sale Type | status | Local, Export |
| Transport Company | board_relation | -> Transport Company (5026540774) |
| UOM | status | KGs, Bags, Hanks, Bales, Carton, Chippa, Meters, Tons |
| Final Rate / Bags Weight | numbers | |
| Quantity Dispatched (`numeric_mm0z61ph`) | numbers | rolled up to parent |
| Total Weight | formula | `{Bags Weight} * {Quantity Dispatched}` |
| Value | formula | `{Total Weight} * {Final Rate}` |
| Amt For Common | numbers | |
| Buyer Commission / Supplier Commission | formula | same Percentage/BAG/KG logic as parent, using Quantity Dispatched |
| CGST / Insurance Tax / Add / Deduct | numbers | |
| Total Amount | formula | `Value + Value*CGST/100 + Value*InsuranceTax/100 + Add - Deduct` |
| Round off | numbers | |
| Dispatch Date | date | |
| Person | people | |
| Transport Type | status | Own Transport, Agreed Third Party, Third Party (Direct Payment by Party) |
| Buyer/Supplier Commission Invoice Created | checkbox | x2 |
| wamid / Response / Message Template Name | text | |
| Message | long_text | |
| Send Email | status | Send, Not Send |
| Send Whatsapp | status | Send, Not Send |
| Transporter Type Details | board_relation | -> Transporter Type Details |
| Documents | file | |

Views: not captured.
Approx rows: 27 (parent items).

---

# Folder: MDM

## Buyers & Suppliers (5024227503) — MDM
Purpose: master of trading parties (companies), both buyers (weavers) and suppliers (spinning mills), with contacts, tax ids, bank details, default commission terms and a capacity profile.
Groups: Buyer; Supplier.

| Title | type | notes |
|---|---|---|
| Name | name | company name |
| Date | date | |
| Type | status | Buyer, Supplier |
| Office Address | long_text | |
| State | text | |
| GST No. | text | GSTIN |
| Contact Person 1/2/3 | text | x3 |
| Contact Person 1/2/3 Phone | phone | x3 |
| Contact Person 1/2/3 Email | email | x3 |
| Location MDM | board_relation | -> Location MDM (5026540835) |
| Category | status | 1, 2, 3, 4 |
| Bank Account Details 1 / 2 | long_text | |
| Default Commision Percentage [sic] | status | Rs per kg, Bagwise Rate., Percentage of Ex Mill Value, (blank label) — appears superseded by the Commission Type columns (inferred) |
| Name Copy (`text_mm1km6p6`) | text | copy of name, used for mirroring |
| Company profile | link | |
| Short Name | text | |
| Mill/Factory/Delivery Address | long_text | |
| Office Phone | phone | |
| Res Phone | phone | |
| IT Pan | text | PAN |
| Email | email | |
| Buyer Commission Type | status | Percentage, KG, BAG |
| Buyer Commission Value | numbers | |
| Supplier Commission Type | status | Percentage, KG, BAG |
| Supplier Commission Value | numbers | |
| Sales Person | people | |
| Collection Staff | people | |
| Documents | file | |
| Counts | board_relation | -> Counts (counts this party buys/supplies) |
| Thread Count | mirror | -> Counts.numeric_mm0929rz, aggregation = count |
| Remark 1 / Remark 2 | long_text | |
| Messenger | people | staff who delivers documents (inferred) |
| link to Sales Confirmation | board_relation | -> Sales Confirmation |
| Customer Code | text | |
| Name Formula | formula | `{name}` |
| Buyer Machine Type / Type 1 / Type 2 | status | SULZER, AIRJET, POWERLOOM (3 identical columns) |
| Supplier Machine Type | text | |
| Quantity | numbers | buyer profile |
| Fabric Producing | text | buyer profile |
| Current Machines (`color_mm1zm9t1`) | status | Working on it, Done, Stuck (default labels, never configured) |
| No. of Looms | numbers | buyer profile |
| Buyer Qty(Bags/month) / Buyer Qty(Kgs/month) | numbers | |
| Reed * Pick / Width / Type (`text_mm1zd130`) | text | fabric spec |
| Counts Supplying | numbers | supplier profile |
| Current Machines (`text_mm1vt7yq`) | text | supplier profile (duplicate title of the status column) |
| Supplier No. of Roters & Spindles | numbers | |
| Monthly Production Quantity | numbers | |
| Current Machine | status | Working on it, Done, Stuck (default labels) |
| Supplier Qty(Bags/month) / Supplier Qty(Kgs/month) | numbers | |
| Business Name | mirror | -> Business Units.text_mm1k18sd |
| Website URL | link | |
| Map Location | location | |
| Business Unit | board_relation | -> Business Units (5024662780) |
| Business Phone | mirror | -> Business Units.phone_mm0wa9bv |

Views: not captured.
Approx rows: 45.

## Business Units (5024662780) — MDM
Purpose: the agency's own legal entities / letterheads (inferred) — and the parent company record a Buyer/Supplier belongs to — with GST/PAN/bank details used on invoices. Item terminology "Company Name".
Groups: Company Information; New Group.

| Title | type | notes |
|---|---|---|
| Name | name | company name |
| Trade Name | text | |
| Legal Name | text | |
| Date | date | with time |
| Subitems | subtasks | board 5026566719 (default subitem columns, unused) |
| GST Number | text | |
| Email | email | |
| State | text | |
| Address | long_text | |
| Documents | file | |
| Fax No. | numbers | |
| Mobile (`phone_mm0wa9bv`) | phone | mirrored into B&S as "Business Phone" |
| Phone 1 / Phone 2 / Phone 3 | phone | |
| PAN Number | text | |
| Bank Account Details 1 / 2 | long_text | |
| Item ID | item_id | |
| Name Copy (`text_mm1k18sd`) | text | mirrored into B&S as "Business Name" |

Subitem columns (5026566719): Name, Owner (people), Status (Working on it, Done, Stuck), Date — defaults, unused.
Views: not captured.
Approx rows: 5.

## Counts (5026452240) — MDM
Purpose: yarn product master ("count" = yarn count, e.g. "40'S Combed Compact"). Attributes compose a human summary string.
Groups: All Products.

| Title | type | notes |
|---|---|---|
| Name | name | e.g. "16'S OE", "41'S CARDED COMPACT" |
| Created Date | date | |
| Subitems | subtasks | board 5026893068 |
| Summary (Fx) (`formula_mm09f733`) | formula | CONCATENATE of: `{Thread Count}&"S "`, Machine, `Yarn1% Yarn1`, `Yarn2% Yarn2`, "Blended " if 0<Yarn1%<100, Yarn (single/double), Process, Certification, Type — each skipped when empty/"None". Example shape: "20S Vortex 40% Cotton 60% Polyester Blended Double Karded Compact (Combed Compact) BCI Cheese" |
| Summary (`text_mm1mjys8`) | text | static copy of the formula (written by automation, inferred; can be stale) — mirrored by SC/D&B |
| Thread Count (`numeric_mm0929rz`) | numbers | the count number (often empty in sample) |
| Machine | status | Vortex, Ring Spun, OE, None |
| Yarn 1 | status | Cotton, Polyester, Viscose, Linen, Hemp, Lycra, None |
| Yarn 1 (Percentage) | numbers | |
| Yarn 2 | status | Cotton, Polyester, Viscose, Linen, Hemp, None, Lycra |
| Yarn 2 (Percentage) | numbers | |
| Overall Yarn Composition | formula | `CONCATENATE({Yarn1%} + {Yarn2%}, "%")` |
| Overall Yarn | formula | `IF({Yarn1%} < 100, "Blended", {Yarn 1})` |
| Yarn | status | Single, Double, None |
| Process | status | Combed, Karded, Karded Compact (Combed Compact), Combed Compact, None |
| Certification | status | BCI, OKEA TEX [sic, Oeko-Tex], GOTS, NPOP, NOP, GRS, None |
| Type | status | Cheese, Cone, None (package type) |
| Item ID | item_id | |
| Is Duplicate | checkbox | duplicate guard |
| Duplicate Error | text | |
| Formula | formula | empty formula (unused) |

Subitem columns (5026893068): Name, Owner (people), Status (Working on it, Done, Stuck), Date, Amount (numbers) — likely unused.
Sample shape: names are free text and inconsistent (some test rows like "cotton", "Wool", "New name").
Views: not captured.
Approx rows: 32.

## Transport Company (5026540774) — MDM
Purpose: master of transport companies / transporters used for dispatch.
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Person | people | |
| Vehicle Type | status | Truck, Lorry, Tempo |
| Date | date | |
| Email | email | |
| Office Address | long_text | |
| Mill/Factory/Delivery Address | long_text | (copied template column) |
| Office Phone / Res Phone | phone | |
| CGST | text | actually GST number (inferred) |
| State | text | |
| State Code | numbers | |
| Bank Account Number 1 / 2 | text | |
| IT PAN | text | |
| Contact Person 1 / 2 | text | |
| Contact Person 1 / 2 Phone | phone | |
| Vehicle No 1 / 2 / 3 | text | |
| Remarks | long_text | |
| Documents | file | |
| Locations | board_relation | -> Location MDM |
| Business Units | board_relation | -> Business Units |

Views: not captured.
Approx rows: 2.

## Location MDM (5026540835) — MDM
Purpose: delivery locations / sites (item terminology "Delivery location name") with zone; linked from Buyers & Suppliers.
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Person | people | |
| State | text | |
| Date | date | |
| Buyers & Suppliers | board_relation | -> Buyers & Suppliers |
| Address | long_text | |
| GST Number | text | |
| Phone | phone | |
| Email | email | |
| Contact Person (MD) | text | |
| Accounts Dept Phone | phone | |
| Zone | status | West Zone, South Zone, North Zone |
| Documents | file | |

Views: not captured.
Approx rows: 2.

## Payment Terms (5026694999) — MDM
Purpose: lookup list of payment terms.
Groups: Payment Terms.

| Title | type | notes |
|---|---|---|
| Name | name | term label |
| Days | numbers | number of days |

Full contents (6 rows, non-personal): 10 DAYS PDC (10), 20 DAYS PDC (20), 30 DAYS PDC (30), 45 DAYS PDC (45), 60 DAYS PDC (60), ADVANCE RTGS (0). PDC = post-dated cheque.
Views: not captured.
Approx rows: 6.

## Sizing/Delivery Address (5026819478) — MDM
Purpose: third-party sizing units / alternate delivery addresses where yarn is delivered instead of the buyer's mill (inferred). Item terminology "Process".
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Person | people | |
| Date | date | |
| Office Address | long_text | |
| GST No. | text | |
| State | text | |
| Contact Person 1 / 2 | text | |
| Contact Person 1 / 2 Phone | phone | |
| Contact Person 1 / 2 Email | email | |
| Remarks 1 | long_text | |
| Documents | file | |
| Locations | board_relation | -> Location MDM |

Views: not captured.
Approx rows: 2.

---

# Folder: Tasks
Field-staff task boards (created by user "SK"). Common pattern: Person/People (assignee, usually the messenger/field staff), Accounts (people, accounts team), GPS Check-In (location), proof upload (file). Intended for mobile use (inferred).

## Payment Collection (5027269376) — Tasks
Purpose: track outstanding amounts to collect from a party, with aging.
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Subitems | subtasks | board 5027318483 (default columns: Name, Owner, Status Working on it/Done/Stuck, Date) |
| Person | people | |
| Accounts | people | |
| Connected Boards | board_relation | -> Monthly Visit (5027265052) AND Commission Invoice Delivery (5027269270) (multi-board relation) |
| Buyer Name | mirror | via Connected Boards: Monthly Visit."Buyers Name" relation; Commission Invoice Delivery.`lookup_mm1kv6ew` (that column no longer exists on the target — broken mirror) |
| Invoice Number | numbers | |
| Amount (`numeric_mm1h2tr1`) | numbers | |
| Amount Collected (`numeric_mm1he4bq`) | numbers | |
| Mode of Payment | status | Online, Cash, Cheque |
| Payment Proof Upload | file | |
| Balance Amount | formula | `{Amount} - {Amount Collected}` |
| GPS Check-In | location | |
| Payment Status | status | Outstanding, Completed |
| Start Date / End Date | date | |
| Days Aging | formula | `DAYS({End Date}, {Start Date})` |

Views: not captured.
Approx rows: 0 (empty board).

## Monthly Visit (5027265052) — Tasks
Purpose: field-staff monthly customer visit log with check-in/out and meeting summary.
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Person | people | |
| Accounts | people | |
| Buyers Name | board_relation | -> Buyers & Suppliers |
| Buyer Messenger | mirror | -> B&S.Messenger |
| Created Date | date | |
| Visited Date | date | |
| GPS Check-In | location | |
| Check-In Time / Check-Out Time | date | with time |
| Meeting Summary | long_text | |
| Pending Payment Status | status | No, Yes |
| Visited/Not Visited | status | Not Visited, Visited, Completed |
| link to Payment Collection | board_relation | -> Payment Collection (two-way with "Connected Boards") |

Views: not captured.
Approx rows: 3.

## Mill Invoice Delivery (5027269220) — Tasks
Purpose: deliver the supplier mill's invoice (physical copy) to the buyer, by hand or courier, with proof.
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| People | people | |
| Accounts | people | |
| Status (`status`) | status | Working on it, Stuck, Done — mirrored into D&B "Mill Invoice Status" |
| Buyers | board_relation | -> Buyers & Suppliers |
| Buyer Messenger | mirror | -> B&S.Messenger |
| Supplier Name | mirror | via Dispatch and Billing -> D&B.Supplier relation |
| Supplier Messenger | mirror | via Dispatch and Billing -> D&B.Supplier Messenger |
| Invoice Number | mirror | -> D&B.Invoice No. |
| Invoice Date | mirror | -> D&B.Invoice Date |
| Invoice Amount | numbers | |
| Delivery Mode | status | Hand, Courier |
| Delivery Proof Upload | file | |
| GPS Check-In | location | |
| Dispatch and Billing | board_relation | -> Dispatch and Billing (two-way) |
| Invoice Status | status | Not Delivered, Delivered |

Views: not captured.
Approx rows: 26.

## Commission Invoice Delivery (5027269270) — Tasks
Purpose: deliver the agency's commission invoice to the party and capture acknowledgement.
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| People | people | |
| Accounts | people | |
| Commission Invoices | board_relation | -> Commission Invoices (5026907737) |
| Commission Amount | mirror | -> Commission Invoices.numeric_mm16fcy2 |
| Buyer | board_relation | -> Buyers & Suppliers |
| Buyer Messenger | mirror | -> B&S.Messenger |
| Commission Invoice No. | text | |
| Invoice Date | date | |
| Acknowledgement Received | status | Yes, No |
| Photo Upload | file | |
| GPS Check-In | location | |
| Pending Payment Status | status | No, Yes |
| Created Date | date | |
| link to Payment Collection | board_relation | -> Payment Collection |

Views: not captured.
Approx rows: 31.

## Transport Freight Invoice (5027269319) — Tasks
Purpose: deliver/collect freight invoices raised by the in-house/associated transport outfit (the associated transport outfit, inferred) against Transport Invoice records.
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Person | people | |
| Accounts | people | |
| Transport Invoice | board_relation | -> Transport Invoice (5027015093) |
| Buyer | mirror | -> Transport Invoice.lookup_mm1k6dqe (buyer mirror on that board) |
| Transport Bill No. | numbers | |
| Transport Amount | numbers | |
| Load Reference | text | |
| Delivery Proof | file | |
| GPS Check-In | location | |
| Status | status | Yes, No (meaning unclear — delivered? inferred) |
| Check | status | Outstanding, Cleared (payment state) |

Views: not captured.
Approx rows: 20.

## Sample Delivery - Comes From Mills (5027269351) — Tasks
Purpose: deliver yarn samples received from supplier mills to buyers and track feedback.
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Person | people | |
| Accounts | people | |
| Buyer | board_relation | -> Buyers & Suppliers |
| Buyer Messenger | mirror | -> B&S.Messenger |
| Supplier | board_relation | -> Buyers & Suppliers |
| Supplier Messenger | mirror | -> B&S.Messenger |
| Sample Quality | text | |
| Sample Type | status | TBD 1, TBD 2, TBD 3 (placeholders, never defined) |
| Sample Lot | text | |
| Delivery Date (`date4`) | date | |
| Feedback Due Date | formula | `FORMAT_DATE(ADD_DAYS({Delivery Date}, 7), "DD-MM-YYYY")` |
| Feedback Status | status | Pending, Approved, Rejected |
| GPS Check-In | location | |
| Photo Proof | file | |

Views: not captured.
Approx rows: 1.

## Cheque Collection (5027269441) — Tasks
Purpose: collect post-dated cheques from buyers and track deposit/clearance. Item terminology "Cheque".
Groups: Collected; In Progress; To Collect.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Accounts | people | |
| Person | people | |
| Buyer Name | board_relation | -> Buyers & Suppliers |
| Invoice Number | numbers | |
| Cheque Number | numbers | |
| Bank Name | text | |
| Cheque Date | date | |
| Cheque Amount | numbers | |
| Cheque Photo Upload | file | |
| Deposit Status | status | Pending -> Deposited -> Cleared; Collected; (blank label) |
| Notes | text | |
| Subitems | subtasks | board 5027269448 (default: Name, Owner, Status Working on it/Done/Stuck, Date) |
| GPS Check-In | location | |

Views: not captured.
Approx rows: 1.

---

# Root (no folder)

## Commission Invoices (5026907737) — root
Purpose: periodic commission invoice raised by the agency (from one of its Business Units) to a Buyer or Supplier, covering dispatches in a date range; sent by email/WhatsApp and tracked for payment.
Groups: Group Title; Send.

| Title | type | notes |
|---|---|---|
| Name | name | sample shapes: "Invoice 2", "CI -", "4" (inconsistent) |
| Subitems | subtasks | board 5027264498 (default: Name, Owner, Status Working on it/Done/Stuck, Date) |
| Party Type | status | Supplier, Buyer, Select Party Type (default placeholder) |
| Person | people | |
| Status | status | Generated -> Sent (done) / Pending |
| Sr. No | auto_number | prefix "SR-", board scope |
| Date | date | |
| Invoice From Date / Invoice To Date | date | billing period |
| Commission Type | status | BAG, KG, Percentage |
| Commission Value | numbers | rate |
| Add / Deduct | numbers | |
| TDS | numbers | tax deducted at source |
| Buyer | board_relation | -> Buyers & Suppliers (used for either party type, inferred) |
| Buyer mirrors (11) | mirror | Messenger, Office Phone, CP1, CP1 Phone, CP2 Phone, CP1 Email, CP2 Email, GST No., Location, Email, Office Address, Mill/Factory/Delivery Address |
| Buyer Contact Person 1 Email (`email_mm2mzg4r`) | email | plain column duplicating the mirror of same title |
| Business Units | board_relation | -> Business Units (issuing entity) |
| Business Units mirrors (5) | mirror | Name Copy, Mobile, Address, Email, Phone 1 |
| Text 1 | text | unnamed |
| Total Bags | numbers | |
| Invoice No | numbers | |
| Total | numbers | gross (inferred) |
| Net Amount (`numeric_mm16fcy2`) | numbers | mirrored into Commission Invoice Delivery |
| Round Off | numbers | |
| Mode of Payment | status | NEFT, UPI, RTGS, Cash, Cards |
| Partial Payment/ Payment Collected (`numeric_mm1qw1e7`) | numbers | |
| Payment Pending | formula | `{Net Amount} - {Partial Payment}` |
| Document No | text | |
| Text | long_text | unnamed |
| Remarks | long_text | |
| Documents | file | generated invoice PDF (inferred) |
| Email | button | "Send Email" |
| Whatsapp Message | status | Send, Not Send |
| wamid / Whatsapp Response / Message Template Name | text | |
| Message | long_text | |
| link to Commission Invoice Delivery | board_relation | -> Commission Invoice Delivery (two-way) |
| Creation date | date | with time |
| CI Number (Auto) | text | generated invoice number (empty in sample) |

Note: totals are numbers, not formulas — computed externally (automation/integration, inferred) from Dispatch and Billing subitems' Buyer/Supplier Commission.
Views: not captured.
Approx rows: 36.

## Transport Invoice (5027015093) — root
Purpose: freight invoice ("Transport Invoice No.", the associated transport outfit, inferred) raised by an own-transport Business Unit for a trip, priced per bag or per kg.
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Person | people | |
| Date | date | |
| Business Units | board_relation | -> Business Units (issuing entity) |
| Business Unit mirrors (4) | mirror | Business Unit Name (Name Copy), Account Details (Bank 1), Address, Phone 1 |
| Transport Invoice No. | text | |
| Transporter Type Details | board_relation | -> Transporter Type Details (the trip) |
| Trip mirrors (11) | mirror | via Transporter Type Details: From (TTD.From), To (TTD.To), Office Phone, CP1 Phone, CP2 Phone, To Email, To CP1 Email, To CP2 Email, Counts (TTD.Counts number), No. Of Bags (`lookup_mm15c24v`) |
| Bag Weight (`numeric_mm15kmcq`) | numbers | |
| Total Weight (`formula_mm15vqm`) | formula | `{No. Of Bags} * {Bag Weight}` |
| Mill Bill No. | numbers | |
| Lr. No./Date | date | lorry receipt date |
| Type (`status`) | status | Kg, Bag |
| Rate (`numeric_mm15dr4k`) | numbers | |
| Total Amount (`formula_mm15rjfh`) | formula | `IF(Type="Bag", Rate*NoOfBags, IF(Type="Kg", Rate*TotalWeight, 0))` |
| Mode of Payment | status | NEFT, UPI, RTGS, Cash, Cards |
| Partial Payment/ Payment Collected | numbers | |
| Payment Pending | formula | `{Total Amount} - {Partial Payment}` |
| Document No | text | |
| Remarks | long_text | |
| Sales Confirmation | board_relation | -> Sales Confirmation |
| SC mirrors (3) | mirror | Driver Contact Phone, Vehicle Number, Transporter Name |
| Whatsapp Message | status | Send, Not Send |
| Message | long_text | |
| Message Template Name / Response / wamid | text | |
| Document | file | |
| Email | button | "Send Email" |
| link to Transport Freight Invoice | board_relation | -> Transport Freight Invoice (two-way) |
| link to Transporter Type Details | board_relation | -> Transporter Type Details (second relation to same board, reflection of TTD."Transport Invoice") |
| Item ID | item_id | |
| From alt. | board_relation | -> Buyers & Suppliers (supplier/origin) |
| Buyer/to | board_relation | -> Buyers & Suppliers (destination) |
| Sizing/Delivery Address | board_relation | -> Sizing/Delivery Address |

Views: not captured.
Approx rows: 20.

## Transporter Type Details (5026904637) — root
Purpose: one record per transport trip/consignment: transport type, route (from supplier to buyer via D&B), vehicle, and own-transport trip costing (KM, diesel, bata, loading etc.).
Groups: Group Title.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Person | people | |
| Serial No | text | |
| Type (`status`) | status | Own Transport, Agreed Third Party, Third Party (Direct Payment by Party) |
| Created Date | date | |
| Dispatch and Billing | board_relation | -> Dispatch and Billing |
| D&B mirrors (12) | mirror | From (D&B.Supplier), To (D&B.Buyer), Counts (D&B.Counts), Transporter Name, Driver Contact Phone, Vehicle Number, Buyer Email, Buyer Office Phone, Buyer CP1 Phone, Buyer CP2 Phone, Buyer CP1 Email, Buyer CP2 Email |
| Transports | board_relation | -> Transport Company |
| Transport mirrors (5) | mirror | Vehicle Type, Vehicle No 1/2/3, Business Unit |
| Counts (`numeric_mm10v4w4`) | numbers | (numeric, despite name) |
| No Of Bags (`numeric_mm10mbmh`) | numbers | |
| Start KM / Ending KM | numbers | |
| Actual KM | formula | `{Ending KM} - {Start KM}` |
| Consumed (`numeric_mm10108a`) | numbers | diesel litres (inferred) |
| POD (`numeric_mm10p0jh`) | numbers | price of diesel (inferred) |
| Cost Of Diesel | formula | `{Consumed} * {POD}` |
| Driver Bata / Loading Charge / UnLoading Charge / Tiffen Charge / Others / LNT / PC | numbers | trip expenses |
| Total Cost | formula | `CostOfDiesel + DriverBata + Loading + Unloading + Tiffen + Others + LNT + PC` |
| Difference | numbers | |
| Agency Invoice Amount | numbers | |
| Transport Invoice No | numbers | |
| Transport Invoice (`boolean_mm10vqs`) | checkbox | invoice raised flag |
| Transport Invoice (`board_relation_mm1nadqz`) | board_relation | -> Transport Invoice (two-way) |
| Documents | file | |
| Remarks | long_text | |
| Sales Confirmation | board_relation | -> Sales Confirmation (two-way) |
| Vehicle Number | mirror | -> SC.Vehicle Number |
| Office Phone | phone | |
| Contact Person 1 / 2 Phone | phone | |
| Email / Contact Person 1 Email / Contact Person 2 Email | email | |

Views: not captured.
Approx rows: 11.

## Quotes & Invoices (5024227501) — root
Purpose: stock monday CRM template board; unused.
Groups: Quotes & Invoices.

| Title | type | notes |
|---|---|---|
| Name | name | "Document #" |
| Type | status | Invoice, Quote |
| Amount | numbers | "$" unit |
| Recipient | board_relation | no target board configured |
| File | file | |
| Status | status | Working on it, Approved, Sent to client, Paid, Cancelled |
| Issue date | date | |
| Owner | creation_log | |

Views: not captured.
Approx rows: 0 (empty; last updated 2025-11). Safe to drop.

## Whatsapp Message (5027236770) — root
Purpose: outbound WhatsApp message log (one row per message sent by automations/integration from SC, Commission Invoice, Transport Invoice, D&B).
Groups: Commission Invoice; Sales Confirmation; Transport Invoice; Dispatch and Billing.

| Title | type | notes |
|---|---|---|
| Name | name | |
| Subitems | subtasks | board 5027269353 (default: Name, Owner, Status Working on it/Done/Stuck, Date) |
| Board | status | Sales Confirmation, Commission Invoice, Transport Invoice, Dispatch and Billing (source board) |
| Related Records | board_relation | multi-board -> Commission Invoices, Buyers & Suppliers, Sales Confirmation, Transport Company, Transport Invoice, Dispatch and Billing (polymorphic) |
| Created Date | date | |
| To Phone | phone | recipient number |
| Client Name | board_relation | multi-board -> Buyers & Suppliers, Business Units |
| Message | long_text | |
| wamid | text | WhatsApp message id |
| Response | text | |
| Message Documents | file | attachments |
| Message Template Name | text | |
| monday Doc v2 | direct_doc | |

Views: not captured.
Approx rows: 124 (most active board).

## Whatsapp Tracking (5027998834) — root
Purpose: ad-hoc/broadcast WhatsApp messages (bank details, quotation details) to buyers/suppliers, tracking per-number message ids.
Groups: Group Title; Group Title (two groups with identical titles).

| Title | type | notes |
|---|---|---|
| Name | name | |
| Sr No. | auto_number | |
| Type (`status`) | status | Bank Details, Quotation Details, Draft |
| Created Date | date | with time |
| Buyers | board_relation | -> Buyers & Suppliers |
| Buyer mirrors (3) | mirror | Office Phone, CP1 Phone, CP2 Phone |
| Suppliers | board_relation | -> Buyers & Suppliers |
| Business Units | board_relation | -> Business Units (sender entity, inferred) |
| Message | long_text | |
| Notes | long_text | |
| Office Phone WanId / Contact Person Phone 1 WanId / Contact Person Phone 2 WanId | text | message id per recipient number |
| Response | text | |

Views: not captured.
Approx rows: 22.

---

# Relationships
Every `board_relation` column, as `Board.Column -> TargetBoard`. (2-way) = monday reflection pair; the reverse column is also listed.

Deals
- Deals.Sales Confirmation -> Sales Confirmation (2-way with SC.Link to Deals)
- Deals.Counts -> Counts
- Deals.Payment Terms -> Payment Terms
- Deals.Buyer -> Buyers & Suppliers
- Deals.Supplier -> Buyers & Suppliers
- Deals(subitem "Tasks").Products & Services -> Products & Services (5024227500, template board, out of scope)

Sales Confirmation
- SC.Supplier -> Buyers & Suppliers
- SC.Buyer -> Buyers & Suppliers
- SC.Counts -> Counts
- SC.Payment Terms -> Payment Terms
- SC.Sizing/Delivery Address -> Sizing/Delivery Address
- SC.Link to Deals -> Deals
- SC.link to Dispatch and Billing -> Dispatch and Billing (2-way with D&B.Sales Confirmation)
- SC.link to Subitems of Dispatch and Billing -> Subitems of Dispatch and Billing (2-way with D&B subitem.Sales Confirmation)
- SC.link to Transporter Type Details -> Transporter Type Details (2-way with TTD.Sales Confirmation)

Dispatch and Billing (parent)
- D&B.Sales Confirmation -> Sales Confirmation
- D&B.Buyer -> Buyers & Suppliers
- D&B.Supplier -> Buyers & Suppliers
- D&B.Sizing/Delivery Address -> Sizing/Delivery Address
- D&B.Counts -> Counts
- D&B.Transporter Type Details -> Transporter Type Details
- D&B.link to Mill Invoice Delivery -> Mill Invoice Delivery (2-way with MID.Dispatch and Billing)

Dispatch and Billing (subitems, 5026869429)
- D&B-sub.Sales Confirmation -> Sales Confirmation
- D&B-sub.Buyer -> Buyers & Suppliers
- D&B-sub.Supplier -> Buyers & Suppliers
- D&B-sub.Sizing/Delivery Address -> Sizing/Delivery Address
- D&B-sub.Counts -> Counts
- D&B-sub.Transport Company -> Transport Company
- D&B-sub.Transporter Type Details -> Transporter Type Details

Buyers & Suppliers
- B&S.Location MDM -> Location MDM
- B&S.Counts -> Counts
- B&S.link to Sales Confirmation -> Sales Confirmation
- B&S.Business Unit -> Business Units

MDM others
- Location MDM.Buyers & Suppliers -> Buyers & Suppliers
- Transport Company.Locations -> Location MDM
- Transport Company.Business Units -> Business Units
- Sizing/Delivery Address.Locations -> Location MDM

Tasks
- Payment Collection.Connected Boards -> Monthly Visit + Commission Invoice Delivery (multi-board)
- Monthly Visit.Buyers Name -> Buyers & Suppliers
- Monthly Visit.link to Payment Collection -> Payment Collection
- Mill Invoice Delivery.Buyers -> Buyers & Suppliers
- Mill Invoice Delivery.Dispatch and Billing -> Dispatch and Billing
- Commission Invoice Delivery.Commission Invoices -> Commission Invoices (2-way with CI.link to Commission Invoice Delivery)
- Commission Invoice Delivery.Buyer -> Buyers & Suppliers
- Commission Invoice Delivery.link to Payment Collection -> Payment Collection
- Transport Freight Invoice.Transport Invoice -> Transport Invoice (2-way with TI.link to Transport Freight Invoice...)
- Sample Delivery.Buyer -> Buyers & Suppliers
- Sample Delivery.Supplier -> Buyers & Suppliers
- Cheque Collection.Buyer Name -> Buyers & Suppliers

Root
- Commission Invoices.Buyer -> Buyers & Suppliers
- Commission Invoices.Business Units -> Business Units
- Commission Invoices.link to Commission Invoice Delivery -> Commission Invoice Delivery
- Transport Invoice.Business Units -> Business Units
- Transport Invoice.Transporter Type Details -> Transporter Type Details
- Transport Invoice.Sales Confirmation -> Sales Confirmation
- Transport Invoice.link to Transport Freight Invoice -> Transport Freight Invoice
- Transport Invoice.link to Transporter Type Details -> Transporter Type Details (2-way with TTD.Transport Invoice)
- Transport Invoice.From alt. -> Buyers & Suppliers
- Transport Invoice.Buyer/to -> Buyers & Suppliers
- Transport Invoice.Sizing/Delivery Address -> Sizing/Delivery Address
- Transporter Type Details.Dispatch and Billing -> Dispatch and Billing
- Transporter Type Details.Transports -> Transport Company
- Transporter Type Details.Transport Invoice -> Transport Invoice
- Transporter Type Details.Sales Confirmation -> Sales Confirmation
- Quotes & Invoices.Recipient -> (no target configured)
- Whatsapp Message.Related Records -> Commission Invoices, Buyers & Suppliers, Sales Confirmation, Transport Company, Transport Invoice, Dispatch and Billing (polymorphic)
- Whatsapp Message.Client Name -> Buyers & Suppliers, Business Units (polymorphic)
- Whatsapp Tracking.Buyers -> Buyers & Suppliers
- Whatsapp Tracking.Suppliers -> Buyers & Suppliers
- Whatsapp Tracking.Business Units -> Business Units

Core flow (inferred): Buyers & Suppliers + Counts + Payment Terms -> **Deal** -> (approved) **Sales Confirmation** -> **Dispatch and Billing** (+ dispatch subitems; + Transporter Type Details trip) -> **Commission Invoices** (per party, per period) -> **Commission Invoice Delivery** -> **Payment Collection** / **Cheque Collection**. Side flows: D&B -> **Mill Invoice Delivery**; TTD -> **Transport Invoice** -> **Transport Freight Invoice**. All outbound messages logged in **Whatsapp Message**.

---

# Notes / oddities
- **Heavy denormalisation via mirrors.** Deals, SC, D&B (and its subitems), Commission Invoices and TTD each mirror 10-30 contact/address/tax fields from Buyers & Suppliers. In Postgres these should be plain joins/views, not copied columns. Buyer/Supplier are the same table (`Buyers & Suppliers`) distinguished by `Type` (Buyer/Supplier) and group.
- **Commission logic is duplicated** on D&B parent and subitems (Percentage of Value / per BAG x qty / per KG x total weight), using the party's Buyer/Supplier Commission Type+Value from B&S. Commission Invoices then store their own Commission Type/Value and numeric totals (not formulas) — populated by an automation/integration outside the board (inferred).
- **Tax maths**: D&B Total Amount = Value + CGST% + Insurance Tax% + Add - Deduct. Only one "CGST" field (no SGST/IGST split); "Buyer CGST" mirror on D&B actually shows the GST number.
- **Validation done with formulas/flags**: D&B "Validation Errors" and "Record Validation ()" (sum of subitem Quantity Dispatched vs parent Quantity); "Is Duplicate?" + error-message text columns on D&B and Counts (set by automation, inferred). In the app these become DB constraints/triggers.
- **Status vs group duplication**: Deals, SC, D&B, Cheque Collection groups mirror their status labels (group = status bucket). D&B has an extra "New Group". D&B parent status "Return" vs subitem status "Retun" (typo).
- **Broken mirrors**: Payment Collection."Buyer Name" points to Commission Invoice Delivery column `lookup_mm1kv6ew`, and Transport Freight Invoice."Buyer" points to Transport Invoice column `lookup_mm1k6dqe`; neither column exists on the target board any more. D&B subitem "Supplier Business Unit" mirrors Name Copy instead of Business Unit. SC "Buyer/Supplier Business Unit Phone" mirror Office Phone.
- **Leftover / test / unused columns**: SC "test Formula"; Counts "Formula" (empty); Deals subitems (Products & Services, Numbers A — CRM template); default subitem boards (Working on it/Done/Stuck) on SC, Business Units, Counts, Payment Collection, Cheque Collection, Commission Invoices, Whatsapp Message; Commission Invoices "Text 1"/"Text"; B&S "Default Commision Percentage" (superseded by Commission Type/Value), "Name Copy" and "Name Formula" (workarounds for mirroring the name); B&S "Current Machines"/"Current Machine" statuses still have default labels; Sample Delivery "Sample Type" labels are TBD 1/2/3.
- **Duplicate titles**: B&S has two "Type" columns (status Buyer/Supplier and text fabric type) and two "Current Machines" (status + text); Commission Invoices has "Buyer Contact Person 1 Email" as both a mirror and an email column; Transport Invoice links to Transporter Type Details twice; TTD has "Transport Invoice" as both checkbox and relation; Whatsapp Tracking has two groups both titled "Group Title".
- **Buyer/Supplier capacity profile** on B&S (looms, machine types, monthly qty, spindles) is a sparse "in case of Buyer/Supplier" block — consider a separate profile table.
- **Transport duplication**: transporter name / vehicle no / driver phone are free text on SC, D&B and also in Transport Company + TTD. Transport Type labels are identical on D&B, D&B subitems and TTD.Type.
- **Quotes & Invoices** (empty, template), **Payment Collection** (0 rows), **Cheque Collection** and **Sample Delivery** (1 row each) are effectively unused/prototype.
- **WhatsApp integration fields** (wamid, Response, Message, Message Template Name, Send Whatsapp/Whatsapp Message status as trigger) are repeated on SC, D&B (+subitems), Commission Invoices and Transport Invoice; the Whatsapp Message board is the central log. Email sending is via button columns ("Send Email") and "Send Email" status triggers.
- **Numbering**: Deal No ("D-0NN"), Confirmation No ("S-0NN", but recent SC rows are named "1"/"2" and there are duplicate rows created the same second — likely automation/test duplicates), Commission Invoice "Sr. No" auto-number "SR-" plus empty "CI Number (Auto)", D&B subitem "Dispatch Entry No" auto-number.
- **Data quality**: Counts board names are free text and inconsistent with the computed summary (e.g. test rows "cotton", "Wool", "New name"); the static Counts.Summary text can diverge from the Summary (Fx) formula. Deals sample rows are all "New Deal" with sparse numeric fields.
- Views were not fetched (columns-only calls); no view names are recorded.
- Out of scope / skipped: "Test JC", "Build Vibe app", Products & Services (5024227500).
