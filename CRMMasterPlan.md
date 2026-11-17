# CRM Master Plan: monday.com CRM to Commission Desk

**Purpose.** One plan for every block and every feature of the monday.com "CRM" workspace (Appsavio), mapped onto the Commission Desk web app in this repository (Vite + React + Supabase). For each block it says what monday does today, what the app already does, what is missing, and the features to build. It is a feature plan for a **standalone CRM** modelled on the monday workflows; no monday data is imported.

**Sources (all read-only, 17 Nov 2026)**
- monday.com workspace "CRM" (id 2480519) through the monday connector: all 3 folders, 8 loose boards, 7 MDM boards, 3 CRM boards, 7 Tasks boards, subitem boards, automations, formulas, labels, item counts.
- This repository: `src/`, `supabase/migrations/`, `supabase/schema/public.sql`, `README.md`, `MDMplan.md`.
- REA was not used: it is for shipped binaries and bundles, and this is a normal source repo plus a connector.

**Not readable (confirmed gaps)**
- Forms: every "Creation Form" is an app-feature view with no form token, so questions and required flags are unknown.
- The "Billing & Dispatch Dashboard" widgets (monday gives no dashboard query).
- Per-board automation run counts (the connector fails on board ids above 32 bits). Account-wide: 5 runs, 0 failures.
- Reports views, and any column hidden from the connector.
- No personal data (names, phones, GSTINs, bank details) is reproduced here; patterns only.

> `MDMplan.md` was written earlier from the browser UI and has some wrong monday facts. Section 3 of this file replaces them.

---

## 1. System map: the blocks

| Block | monday boards | App today |
|---|---|---|
| **A. Master data (MDM)** | Business Units, Buyers & Suppliers, Counts, Transport Company, Location MDM, Sizing/Delivery Address, Payment Terms | Companies, Contacts (buyer/supplier), Counts, Transporters, Job processes, Payment terms; stations as a lookup only |
| **B. Sales pipeline** | Deals, Sales Confirmation | Leads, Deals, Pending confirmations, Sales confirmations |
| **C. Execution and billing** | Dispatch and Billing (with dispatch subitems) | Orders, dispatches, payments, close rules, pending dispatches/documents |
| **D. Billing documents** | Commission Invoices, Transport Invoice, Transporter Type Details | Commission invoices and bills, transporter invoices and payments, trip sheets |
| **E. Field and collection tasks** | Mill Invoice Delivery, Commission Invoice Delivery, Payment Collection, Cheque Collection, Kaarthika Transport Freight Invoice, Sample Delivery, Monthly Visit | Collection tasks, cheque collections and deposits, collection and office activity, staff expenses |
| **F. Messaging** | Whatsapp Message, Whatsapp Tracking, email buttons | Prefilled WhatsApp/email links and a notification log |
| **G. Reporting** | Billing & Dispatch Dashboard | Sales, billing and collection dashboards; staff performance and efficiency |
| **H. Platform** | users, boards' people columns | Supabase Auth, permission catalogue, templates, audit log |
| **I. Unused / scaffolding** | Quotes & Invoices, Test JC, Build Vibe app, 8 empty subitem boards | none needed |

### End-to-end flow (as monday runs it)

```
Lead* -> Deal (New Deal > Manager Approval > Approved) -> Sales Confirmation (Draft > Send)
      -> Dispatch and Billing item (Draft > In Progress > Fully Dispatch)
           |-> subitems = dispatch entries (partial dispatch, cancel, return)
           |-> task in Mill Invoice Delivery (proof of delivery of the mill invoice)
      -> Commission Invoice (buyer and/or supplier) -> task in Commission Invoice Delivery
      -> Transporter Type Details (trip costing) -> Transport Invoice -> task in Kaarthika Transport Freight Invoice
      -> payment pending -> Payment Collection <- Monthly Visit (30/45/60-day escalation)
      -> Cheque Collection
Every outbound document: email button and/or WhatsApp template -> logged in Whatsapp Message.
(* Leads are in the app only; monday starts at Deals.)
```

---

## 2. Cross-cutting findings that shape every block

1. **monday is a prototype, the app is the product.** Most Tasks boards hold almost no real data (0 to 31 items, blank statuses), and the only run count available (5 runs, 0 failures, new workflow engine only) suggests little automation traffic. The app already implements more than monday (qualification rules, approval guards, close rules).
2. **Master data is the hub.** Every board links to Buyers & Suppliers, Business Units, Counts, Location, Sizing or Transport. Build the masters first; every other block depends on them.
3. **Mirror columns are the main source of fragility.** Mirror-of-mirror values return nothing through the API (Transport Invoice total shows 0; Payment Pending goes negative). The app should store the value it needs at the moment of the event (snapshot) and keep a foreign key.
4. **Money is half-manual.** Commission Invoices has hand-typed Total, Net, Round Off, TDS, Add, Deduct; status never leaves "Generated" (36 of 36). The app already computes commission and closes orders from facts.
5. **WhatsApp works but is unobserved.** 124 messages logged: 75 sent, 39 failed (16 invalid phone, others template and account errors), 10 blank; no delivery, read or reply tracking; bank details sit in clear text on a public board.
6. **Email depends on one person's mailbox.** The commission and transport invoice emails are sent from one person's connected Gmail account; the confirmation and dispatch emails probably are too (not confirmed).
7. **Dirty identifiers.** Bill, cheque and invoice numbers are numeric columns (leading zeros lost); GSTIN/PAN/state are free text with junk; duplicate GSTINs appear on different parties.
8. **Dead and stale automations.** Rules pointing at deleted columns/labels/boards, a 07:30 "Test message" job still running, three disabled copies, nine near-identical Monthly Visit rules that can each spawn a Payment Collection item.

---

## 3. Block A: Master data (MDM)

### 3.1 monday today (corrected)

| Board | Items | Columns | Key rules |
|---|---|---|---|
| **Business Units** | 5 | 19: Name, Trade Name, Legal Name, Date, GST Number, Email, State, Address, Documents, Fax No., Mobile, Phone 1/2/3, PAN Number, Bank Account Details 1/2 (multi-line text), Name Copy, Item ID | 3 automations: Date = today and Name Copy on create; Name Copy on name change |
| **Buyers & Suppliers** | 45 (26 buyer, 18 supplier, 1 blank) | about 72. Identity: Name, Short Name, Customer Code, Type (Buyer/Supplier only), Category 1-4, GST No., IT PAN, State, addresses (office, mill/factory/delivery), Office/Res phone, Email, Website, Company profile, Map location, Documents, Remarks. Three contacts (name, phone, email). People: Sales Person, Collection Staff, Messenger. Commission: default basis, Buyer type+value, Supplier type+value (Percentage, KG, BAG). Bank 1/2 (text). Buyer-only block (machine types SULZER/AIRJET/POWERLOOM, looms, reed, width, quantities); supplier-only block (machine, counts supplying, rotors and spindles, production). Links: Business Unit, Location MDM, Counts (many), Sales Confirmation | 6 workflows + 2 older: Type=Buyer / Supplier moves to group; stale rule for a removed "Private/Deleted" label; broken create rule (deleted column); orphaned "Code It" button rule. **No Private/Deleted type any more.** |
| **Counts** | 32 | Name (free text), Thread Count, Machine (Vortex, Ring Spun, OE), Yarn 1/2 (Cotton, Polyester, Viscose, Linen, Hemp, **Lycra**), Yarn 1/2 percentage, Overall composition (sum), Overall yarn, Yarn ply, Process (Combed, Karded, Karded Compact (Combed Compact), Combed Compact), Certification (BCI, OKEA TEX, GOTS, NPOP, NOP, **GRS**), Type (Cone, Cheese), Is Duplicate, Duplicate Error, Summary (Fx) formula and a Summary text copy | 11 workflows copy the formula to Summary (they do **not** rename the item). 8 older duplicate checks fire on 7 of the columns but **not** on Process, Certification or Type. The Record Validations view lists flagged rows |
| **Transport Company** | 2 | 25: Name, Person, **Vehicle Type (Truck, Lorry, Tempo)**, Date, Email, addresses, phones, GST (titled CGST), State, State Code (number), Bank 1/2, PAN, Contact 1/2, **Vehicle No 1/2/3**, Remarks, Documents, links to Location and Business Units | none |
| **Location MDM** | 2 | 13: delivery site of a party: Name, Person, State, Date, Address, GST, Phone, Email, MD contact, Accounts phone, **Zone (West, South, North)**, Documents, link to Buyers & Suppliers | none |
| **Sizing/Delivery Address** | 2 | 15: Name (process/unit), Person, Date, address, GST, State, Contact 1/2 with phone and email, Remarks, Documents, link to Location | none |
| **Payment Terms** | 6 | Name, Days | values 10/20/30/45/60 DAYS PDC and ADVANCE RTGS (0) |

Lessons for the clone (what not to copy): GSTIN, PAN and state as free text; mixed phone formats; counts typed by hand instead of built from their parts; the same GSTIN on different parties; duplicate and stale columns. The app's constraints already prevent these.

### 3.2 App today
See `MDMplan.md` section 2 for the table list and validation rules. In short: strict database rules (GST/PAN/state-code/mobile checks, unique GST and name, `incomplete` flag, count display-name trigger plus unique index, GST verification state) and RLS by permission key (`settings.manage`, `buyer.manage`, `mill.manage`, `article.manage`, `transport.manage`, `jobprocess.manage`, `md_contact.view`).

### 3.3 Gaps and features

| ID | Feature | Detail | Priority |
|---|---|---|---|
| A-01 | Party extended profile | Short name, customer code, category 1-4 (kept), website, map location, remarks, notes | P2 |
| A-02 | Three contacts per party | Contact 1 feeds `contact_person`/`mobile`; contacts 2-3 go to `party_md_contacts` with email and an order column | P1 |
| A-03 | Party phones and emails | Office phone, residence phone, company email on both masters | P1 |
| A-04 | Mill/factory/delivery address | Separate from office address; used on confirmations and invoices | P1 |
| A-05 | Bank details | Structured bank name, branch, account number, IFSC (replace free text); two accounts per party and per business unit; restricted view | P1 |
| A-06 | Commission rules on parties | Buyer and supplier commission type (Percentage, KG, BAG) and value; map legacy "Rs per kg / Bagwise / Percentage of ex-mill" | P1 |
| A-07 | Buyer and supplier production profile | Machine types, looms, reed, width, quantities; counts supplied; spindles | P3 (confirm use) |
| A-08 | Staff assignment | Sales person, collection staff, messenger mapped to `profiles` | P1 |
| A-09 | Party links | Business unit (our billing entity), locations (many), counts supplied or bought (many) via join tables | P1 |
| A-10 | Business Unit full profile | Trade/legal name, mobile, phones 1-3, PAN, bank 1-2, documents, record date; expose columns already in the database | P1 |
| A-11 | Delivery locations master | New table with party link, address, GST, phones, email, MD contact, accounts phone, zone West/South/North; evolves `station_master` | P1 |
| A-12 | Transporter profile | Vehicle type (Truck, Lorry, Tempo), up to 3 vehicle numbers, two bank numbers, PAN, state code, links to location and business unit | P1 |
| A-13 | Sizing/delivery address profile | Two contacts with email, remarks, location link | P2 |
| A-14 | Count model alignment | Add LYCRA and GRS (business decision), map "Karded Compact (Combed Compact)", ratio must total 100, duplicate rule covers every field including process, certification, type | P1 |
| A-15 | Data-quality centre | Incomplete parties, unverified or duplicate GSTIN, missing contacts, invalid counts | P2 |
| A-16 | CSV import and export for every register | Dry run, per-row result, reject file, for the business's own data (exists for companies, parties, counts, locations; extend to transporters, job processes, payment terms) | P2 |
| A-17 | Private/Deleted | Not a monday state any more; use `is_active` only | Decision |
| A-18 | Request-new-master workflow (optional) | Replaces the creation forms: pending record, approver | P3 |

Data model changes: new `delivery_locations`, `party_locations`, `party_counts`, `party_business_units`; extend `transporters` (vehicle type, 3 vehicle numbers); `bank_accounts` (owner type/id, bank, branch, account, IFSC, is_primary); `party_commission` columns. New permission `mdm.approve` (for the optional request flow).

---

## 4. Block B: Sales pipeline (Deals and Sales Confirmation)

### 4.1 monday today

**Deals** (28 items). Statuses: New Deal, Manager Approval, Approved, Reconsider, Closed Lost (groups mirror the status). Columns: Deal No (auto number), Created and Approval dates, Owner (creator), Manager, buyer, supplier, counts, payment terms, quantity, UOM (Hanks, Bags, Bales, Carton, Chippa, KGs, Meters, Tons), bag weight, final rate, freight, mode (Net or Ex-Mill), remarks, documents, location; mirrors of the buyer and supplier contact, address, GST, PAN, commission. Sub-items link to Products & Services (a CRM template leftover).
Rules: owner = creator; Deal No auto-numbered; New Deal to Manager Approval moves the group and notifies the manager ("Please review this deal"); Reconsider notifies the owner ("Revised deal"); **Approved sets the approval date and creates a draft Sales Confirmation linked to the deal**; Closed Lost moves the group. An AI rule extracts item, quantity and colour from pasted chat into a text column. Several template-era rules are switched off.

**Sales Confirmation** (78 items). Statuses: Draft, Send, Send with Delivery Info. Columns: Confirmation No (auto), supplier, buyer, count, quantity, bag weight, ex-mill rate, final rate, UOM, freight (Included/Excluded), Type (Local/Export), payment terms, sizing/delivery address, delivery schedule, transporter name, vehicle number, driver phone, "Confirmation approved" checkbox, buyer and supplier documents, email buttons, WhatsApp status (Send to Supplier, Send To Buyer, Not Send), email timestamps for buyer and supplier, response text per party.
Rules: Draft to Send moves the group; **a status change creates a Dispatch and Billing item**; "Send To Buyer"/"Send To Supplier" buttons email the confirmation with the bank-details attachment ("revert if count/rate/quantity differs") and stamp the time; WhatsApp template sends log the response on the Whatsapp Message board; confirmation number auto-numbered.

### 4.2 App today
Leads (`leads`, qualification trigger, `qualify_lead_auto`, `convert_lead_to_deal`), Deals (`crm_deals`, derived margin, rate tracking, supplier lock, `deal_changes` history, buyer/supplier confirmation stamps, manager approval guard with margin check, `confirm_deal` that creates the sales confirmation and locks the deal), Pending confirmations, Sales confirmations (draft/confirmed/cancelled, returns `sc_returns`, `cancel_sales_confirmation`, notification log, bulk send drawer, WhatsApp/email links).

### 4.3 Gaps and features

| ID | Feature | Detail | Priority |
|---|---|---|---|
| B-01 | Status model alignment | monday: New Deal / Manager Approval / Approved / Reconsider / Closed Lost. App: a longer chain with Buyer Confirmed and Confirmed. Decide which wins; add a Reconsider path with owner notification | Decision, P1 |
| B-02 | Manager notification | In-app and email notice when a deal enters approval and when it is sent back | P1 |
| B-03 | Units of measure | Add HANKS, BALES, CARTON, CHIPPA to the app list (KG, TONS, METERS, BAGS today) | P1 |
| B-04 | Price basis | Net / Ex-Mill and freight included/excluded: already in the app (`price_basis`, `freight`) | Done |
| B-05 | Local/Export type | New field on deal and confirmation | P2 |
| B-06 | Delivery schedule, sizing/delivery address, vehicle, transporter, driver phone on the confirmation | Needed to print the confirmation and the dispatch notice | P1 |
| B-07 | Two-party send | Separate send to buyer and to supplier, each with its own timestamp and response; supplier copy carries mill bank details | P1 |
| B-08 | Confirmation document | Generate the PDF (replaces the uploaded buyer/supplier documents) | P1 |
| B-09 | Auto numbering | Deal and confirmation numbers (app uses year-prefixed sequences) | Done |
| B-10 | AI chat extraction | Optional: parse pasted WhatsApp text into item/quantity/colour on a lead or deal | P3 |
| B-11 | Closed Lost reason | Reason capture and report | P2 |

---

## 5. Block C: Execution and dispatch (Dispatch and Billing)

### 5.1 monday today
27 invoice items (Draft, In Progress, Fully Dispatch) with **subitems as dispatch entries**. Invoice item: invoice no and date, sale type, buyer, supplier, sizing/delivery address, counts, UOM, quantity, bags weight, final rate, delivery schedule, transporter name, vehicle number, driver phone, transport type (Own Transport, Agreed Third Party, Third Party direct payment), links to Transporter Type Details and Mill Invoice Delivery, documents, commission-invoice-created flags (buyer, supplier).
Formulas: Total Weight = bag weight x quantity; Value = weight x rate; Buyer and Supplier Commission = Percentage (value x rate / 100), BAG (rate x bags) or KG (rate x kg); Total Amount = value + CGST% + insurance% + add - deduct; Sum of dispatched quantity from subitems; validation "sum of subitem quantity is greater than parent".
Subitem (dispatch entry): auto-numbered entry no, status (Draft, Partially Dispatch, Fully Dispatch, Cancel, Return), invoice no and date, DC no, delivery date, party links, quantity dispatched, rate, the same formulas, WhatsApp/email send flags and responses.
Rules: status Partially Dispatch creates a subitem; Cancel and Return each create a reversing subitem; invoice item creation creates a task in Mill Invoice Delivery; duplicate-invoice check on invoice number; "Dispatch Information" email to the buyer's sizing ("was delivered to your sizing via vehicle no. X on date; contact us if bags are not received"); WhatsApp on subitem send; Sr. No auto-number.

### 5.2 App today
`orders` (draft, confirmed, open_for_execution, closed), `create_order`, `order_dispatches` (dispatch numbers, quantity guard: cannot exceed the order, mill invoice, POD, GRN, LR, transporter invoice fields), `order_transports` (own or third party), `order_job_processes`, `order_payments` (buyer receipts, supplier payments), `order_close_status` and `order_try_close` (closes when quantity dispatched, buyer paid, supplier paid and commission invoice are all done), pending dispatches, pending documents, trip sheets, dashboards.

### 5.3 Gaps and features

| ID | Feature | Detail | Priority |
|---|---|---|---|
| C-01 | Dispatch entries as the unit | Already modelled (`order_dispatches`); keep dispatch-level invoice number, DC number, quantity | Done |
| C-02 | Cancel / Return | Reversing dispatch entries (negative or flagged) with reason; today only `sc_returns` at confirmation level | P1 |
| C-03 | Tax and adjustments | CGST/insurance percentages, add, deduct, round off on the dispatch invoice and a computed total | P1 |
| C-04 | Commission computed per dispatch | Buyer and supplier commission by basis (percentage, per bag, per kg) at the dispatch, not only per order | P1 |
| C-05 | Duplicate invoice guard | Unique invoice number per mill and financial year with a clear error | P1 |
| C-06 | Dispatch notice | Email and WhatsApp to the buyer's sizing with vehicle and date; log result | P1 |
| C-07 | Mill invoice delivery task | Auto-create a field task when a mill invoice is recorded (links to block E) | P1 |
| C-08 | Transport type | Own / Agreed third party / Third party direct payment (app: our / third_party); add the middle type | P1 |
| C-09 | Validation display | Show "dispatched exceeds ordered" before save (the database already blocks it) | Done |
| C-10 | Ageing views | Pending dispatches and pending documents (exist); add days-open and owner | P2 |

---

## 6. Block D: Billing documents

### 6.1 Commission Invoices (monday, 36 items)
Party type (Buyer/Supplier), status (Generated, Sent, Pending; all 36 "Generated"), invoice number (numeric), period from/to, commission type and value, add, deduct, TDS, total bags, total, net, round off, mode of payment (NEFT, UPI, RTGS, Cash, Cards), payment collected, Payment Pending = net - collected, buyer, business unit (with phone, email, address mirrors), documents, email button, WhatsApp send, delivery task. Rules: name "CI - n"; person = creator; a delivery task is created per invoice; email to buyer plus contacts with the invoice attached; WhatsApp template `commission_invoice`.

App: `commission_invoices` with number guard, `generate_commission_invoice`, `commission_invoice_prints` log, pending commission bills (aged), orders close only when an invoice exists.

| ID | Feature | Detail | Priority |
|---|---|---|---|
| D-01 | Invoice from facts | Net = commission from dispatches in the period, less TDS, plus add, minus deduct, plus round off; no typing of totals | P1 |
| D-02 | Lifecycle | Draft, Generated, Sent, Part-paid, Paid, Cancelled with timestamps (monday never moves past Generated) | P1 |
| D-03 | Party type | Buyer or supplier invoice from the same flow | P1 |
| D-04 | Period billing | From/to dates; list dispatches covered and attach as annexure ("mill invoices for reference") | P1 |
| D-05 | Payment tracking | Mode, partial payments, pending balance computed | P1 |
| D-06 | Send | Email with PDF to buyer and contacts; WhatsApp document; both logged | P1 |
| D-07 | Delivery task | Create the delivery task on generation (block E) | P1 |

### 6.2 Transport Invoice and Transporter Type Details (monday, 20 and 11 items)
Transporter Type Details is a trip costing sheet: type (own, agreed, third party), vehicle, counts, bags, start/end km, actual km, diesel litres and price, cost of diesel, driver bata, loading, unloading, tiffin, other, LNT, PC, **total cost**, difference, KA invoice amount, KT invoice number, links to dispatch, sales confirmation, transport invoice. Transport Invoice: KT invoice no, business unit, From/To parties, bags, bag weight, total weight, type (Kg or Bag), rate, **total amount**, mode of payment, collected, pending, mill bill no, LR no and date, vehicle, transporter, documents, email, WhatsApp, task in the Kaarthika freight board. Known defects: total shows 0 (mirror of mirror), link TI to TTD empty on all rows, five empty rows.

App: `order_trips` (trip sheets with mileage, fuel, costs, trip cost, only for own transport), dispatch-level transporter invoice fields, pending transporter invoices, transporter payments.

| ID | Feature | Detail | Priority |
|---|---|---|---|
| D-08 | Trip costing | Extend trip sheet with driver bata, loading, unloading, tiffin, other, KA invoice amount and computed difference | P1 |
| D-09 | Transport invoice | Per dispatch or per period: type Kg/Bag, rate, total weight, amount computed; payment mode, collected, pending | P1 |
| D-10 | Transporter bill register | Keep bill numbers as text; link bill to dispatches and trips | P1 |
| D-11 | Third-party types | Agreed third party vs direct payment by party | P1 |
| D-12 | Freight task | Create the freight-bill check task (block E) | P2 |

---

## 7. Block E: Field and collection tasks

| monday board | Items | Purpose and rules | App today | Features |
|---|---|---|---|---|
| **Mill Invoice Delivery** | 26 | Task per mill invoice: delivery mode (Hand/Courier), proof upload, GPS, invoice status (Not Delivered/Delivered). Proof upload sets Delivered and notifies accounts. A second generic status never changes | `collection_tasks` type `invoice_delivery`, `delivery_note`, `order_dispatches` POD fields | **E-01** Delivery task with mode, proof photo, GPS, status; auto-complete on proof; one status only |
| **Commission Invoice Delivery** | 31 | Hand delivery of the commission invoice, acknowledgement (Yes/No), pending-payment flag; if pending, spawns a Payment Collection item | `collection_tasks` type `commission_invoice` | **E-02** Delivery with acknowledgement; **E-03** escalate to payment follow-up |
| **Payment Collection** | 0 | Amount, collected, mode (Online, Cash, Cheque), proof, GPS, balance, status Outstanding/Completed, start/end date, ageing | `collection_tasks` types `buyer_payment`, `cash_collection`, `payment_deposit`; `order_payments` | **E-04** Collection ledger with partial amounts, proof, GPS, open ageing (monday ageing only works after completion); auto-complete when balance is zero |
| **Cheque Collection** | 1 | Cheque no, bank, date, amount, photo, deposit status (Pending, Collected, Deposited, Cleared), groups Collected/In progress/To collect | `cheque_collections` with duplicate guard, `ChequeDeposits`, `collection_task_guard` | **E-05** Cheque lifecycle with photo, deposit slip, cleared date; link to the payment; fix the double state model (groups and status) |
| **Kaarthika Transport Freight Invoice** | 20 | Freight bill check: bill no, amount, load reference, delivery proof, GPS, Check (Outstanding/Cleared) | `PendingTransporterInvoices`, `TransporterPayments` | **E-06** Freight-bill verification and payment status (hard-coded transporter name in monday should become data) |
| **Sample Delivery** | 1 | Samples from mills for a buyer: lot, quality, type, feedback due 7 days after delivery, feedback status (Pending, Approved, Rejected), reminder | none | **E-07** Sample register with feedback reminder; approval creates a lead/deal follow-up (monday targets a board that no longer exists) |
| **Monthly Visit** | 3 | Visit plan and log: check-in/out times, GPS, summary, visited status, pending payment flag; escalation at 30/45/60 days to Payment Collection (nine near-duplicate rules) | `activity_log` kinds (call, meeting, reminder, task), `CollectionActivity`, `OfficeActivity` | **E-08** Visit planner with check-in/out and GPS; **E-09** one escalation rule with thresholds as data (30/45/60) creating at most one open follow-up per buyer |

Cross-cutting task features
- **E-10 Mobile field view** (check-in with GPS and photo): monday boards all have GPS Check-in and proof file columns; the app needs a phone-friendly task screen.
- **E-11 Task assignment**: person and accounts staff per task, copied from the party's messenger/collection staff (monday does this with six duplicate recipes).
- **E-12 Notifications**: in-app and email reminders (see section 9).
- **E-13 Proof storage**: photos and PDFs in Supabase Storage with the existing document bucket pattern.

---

## 8. Block F: Messaging (WhatsApp and email)

### 8.1 monday today
- **Whatsapp Message** (124 rows): board, related record, to phone, template name, message text, wamid, response, document. Templates: sales_confirmation_buyer, sales_confirmation_supplier, commission_invoice, transport_invoice, disptach_and_billing (sic), plus test templates (hello_world, whatsapp_document). Sends go to office phone and contact persons 1 and 2.
- **Whatsapp Tracking** (22 rows): bank-details and quotation messages per number, with message ids. Bank details in clear text.
- **Email**: button on Sales Confirmation (buyer and supplier), Commission Invoices, Transport Invoice; status-driven "Dispatch Information" on Dispatch and Billing. All use one connected mailbox.
- Failure picture: 31% failed; no delivery/read/reply status.

### 8.2 App today
`src/lib/integrations.ts`: `whatsappLink` (opens a prefilled chat), `emailLink` (mailto), `WHATSAPP_CONNECTED = false`; `sales_confirmation_notifications` log; `BulkSendDrawer`, `SendPanel`, `NotificationLog`; `MailingList` screen.

### 8.3 Features

| ID | Feature | Detail | Priority |
|---|---|---|---|
| F-01 | WhatsApp Business API sender | Supabase Edge Function holds the token; templates stored as data; sends to office phone and contacts 1-2; never in the front end | P1 |
| F-02 | Message log | One `messages` table (channel, template, recipient, document, provider id, status) linked to the source record | P1 |
| F-03 | Status tracking | Sent, delivered, read, failed with reason, via provider webhook; inbound replies stored | P1 |
| F-04 | Phone validation | Block sends on invalid phone (16 of 39 failures); normalise to E.164 before sending | P1 |
| F-05 | Templates registry | Approved template names and variables in one table; remove test and misspelled templates | P1 |
| F-06 | Email service | Edge Function with a shared sender (SMTP or API), not a personal mailbox; attach the PDF | P1 |
| F-07 | Send bank details | Controlled action with an access log; no bank text in logs | P2 |
| F-08 | Quotation message | Replace the "Quotation Details" tracking rows with a quotation activity on the lead or deal | P2 |
| F-09 | Retry and dedupe | Retry failed sends; prevent double sends on repeated status flips | P2 |
| F-10 | Rate and opt-out | Throttle bulk sends; honour opt-out | P3 |

---

## 9. Automation: how monday rules become app behaviour

| monday behaviour | App mechanism |
|---|---|
| Auto numbers (Deal No, Confirmation No, CI-n, TI-n, Sr. No, dispatch entry no) | Database sequences and triggers (already the pattern: `next_ref_no`, `dispatch_seq`) |
| Name copy / summary copy | Computed columns or triggers; not stored twice |
| Date = today on create | `created_at`; record date defaults |
| Status change creates an item on another board | Database functions called from the app or triggers (`confirm_deal`, `create_order` exist); explicit and logged |
| Move item to group by status | UI filters and board views; no copy of state into groups |
| Notify someone | `notifications` table written by triggers; Edge Function sends email/WhatsApp |
| Date arrives, if status is X, notify | `pg_cron` job reading overdue and ageing views |
| Email/WhatsApp button | Server action that renders the template, sends, logs |
| Duplicate check | Unique indexes plus an "already exists" error |
| Formulas (commission, totals, weights) | SQL functions/views used by the screens and by exports |
| AI extraction from chat | Optional Edge Function call to a model |

New tables: `notifications`, `message_templates`, `messages`, `task_rules` (thresholds as data), `jobs` log.

---

## 10. Blocks G and H: Reporting and platform

**Reporting.** monday has one dashboard (Billing & Dispatch, widgets unreadable) and "Reports" views that are empty. The app has `sales_followup_dashboard`, `billing_dispatch_dashboard`, `collection_dashboard`, staff performance, efficiency, collection and office activity. Features: **G-01** confirm what the monday dashboard shows with its owner and match it; **G-02** commission earned vs invoiced vs collected; **G-03** ageing of dispatch, bills, collections; **G-04** WhatsApp delivery report; **G-05** master data quality report.

**Platform.** monday people columns (Owner, Manager, Person, Accounts, Messenger, Sales Person, Collection Staff) map to `profiles` and permission keys. App roles: Sales, Backend operations, Accounts, Management, Viewer. Features: **H-01** add a Field staff template (collection tasks, proof upload) and an MDM owner template; **H-02** manager assignment per deal; **H-03** audit of master and commission changes (exists, extend); **H-04** keep Supabase Auth and RLS as the only access layer.

---

## 11. monday CRM capabilities to clone (platform features)

The goal is a standalone CRM with the same business features and flows, not a copy of the monday product or its data. Each monday capability the Appsavio workspace relies on becomes a fixed feature of the app. A generic no-code board builder is out of scope.

| monday capability | How the workspace uses it | Standalone feature |
|---|---|---|
| Typed columns (status, dropdown, people, date, numbers, files, phone, email, location, checkbox, link) | Every board | Typed database columns with constraints; status and dropdown lists stored as editable lists (see section 12) |
| Groups by status | Deals, Sales Confirmation, Dispatch, Cheques | Saved list views with status filters and counts; state lives in one column, never duplicated into a group |
| Board relations and mirrors | Party, count, location, business unit links everywhere | Foreign keys and joined views; the value needed at the time of the event is copied onto the record (snapshot) |
| Formulas | Commission, totals, weights, trip cost, payment pending, feedback due date, validation messages | SQL functions and views, one definition used by screens and exports |
| Subitems | Dispatch entries, Payment Collection lines | Child tables with their own numbers and a parent rule (sum of children cannot exceed parent) |
| Auto-number | Deal, confirmation, invoice, dispatch entry numbers | Database sequences with year prefix (already the pattern) |
| Item conversation and activity | "Start conversation" on items, emails and activities | Activity log per record (exists) with notes, calls, meetings, reminders |
| Files column | Documents, proofs, invoices, bank documents | Storage bucket with typed attachments per record (exists for parties and deals) |
| Creation forms | Every MDM board and every Tasks board | Validated "new record" forms with required fields; optional request-and-approve flow |
| Buttons | "Send Email" on confirmations and invoices | Action buttons on a record: generate PDF, send, log |
| Automations (trigger, condition, action) | Approvals, record creation on status change, date-based reminders, notifications | Rules in section 9; thresholds and recipients stored as data |
| Notifications and inbox | Manager review, payment pending, feedback due | In-app notification centre with email copy |
| People columns, owner, guests | Owner, Manager, Accounts, Messenger, Sales Person, Collection Staff | Users, roles and permission keys; assignment fields on records |
| Dashboards and reports | Billing and dispatch dashboard | Dashboard pages in section 10 |
| Table view tools (search, filter, sort, group, export) | All boards | List tools (exist): search, filters, sort, CSV export; add saved views |
| Integrations (Gmail, WhatsApp API, Emails and Activities, AI) | Confirmations, invoices, dispatch notices | Edge Functions in section 8 |
| Location and file capture (GPS check-in, photo) | Every Tasks board | Phone-friendly field screen (E-10) |

Out of scope: generic board/column builder, marketplace apps, monday AI and agents, multi-account hosting.

---

## 12. Starting data (no monday import)

The app starts empty. No party, deal, invoice or message data is brought across from monday. What the app ships with is configuration, taken from the labels monday uses, so the business can start entering real records on day one.

| List | Seed values |
|---|---|
| Units of measure | KG, TONS, METERS, BAGS (existing) plus HANKS, BALES, CARTON, CHIPPA |
| Payment terms | 10, 20, 30, 45, 60 DAYS PDC; ADVANCE RTGS (0 days, advance 100%) |
| Price basis / freight | Net, Ex-Mill; Included, Excluded |
| Sale type | Local, Export |
| Deal states | per decision B-01 (monday: New Deal, Manager Approval, Approved, Reconsider, Closed Lost) |
| Confirmation states | Draft, Send, Send with delivery info |
| Dispatch states | Draft, In progress, Partially dispatched, Fully dispatched, Cancelled, Returned |
| Transport type | Own transport, Agreed third party, Third party (direct payment by party) |
| Vehicle type | Truck, Lorry, Tempo |
| Commission basis | Percentage of ex-mill value, Per kg, Per bag |
| Payment mode | NEFT, UPI, RTGS, Cash, Cards, Cheque, Online |
| Count options | Machine: Vortex, Ring Spun, OE. Yarn: Cotton, Polyester, Viscose, Linen, Hemp (Lycra pending decision). Ply: Single, Double. Process: Combed, Karded, Karded Compact, Combed Compact. Certification: BCI, OEKO TEX, GOTS, NPOP, NOP (GRS pending). Type: Cone, Cheese |
| Zones | West, South, North |
| Party category | 1, 2, 3, 4 |
| Cheque states | Pending, Collected, Deposited, Cleared |
| Collection states | Outstanding, Completed |
| Task states | Not started, In progress, Done, Stuck |
| Message templates | sales confirmation (buyer, supplier), commission invoice, transport invoice, dispatch notice, document |
| Reminder thresholds | 30, 45, 60 days (editable) |

Users bring their own data through the existing CSV import and export on each register (dry run, per-row result, reject file). The first administrator creates users, assigns role templates and enters the home company.

---

## 13. Roadmap

| Phase | Scope | Depends on | Rough effort |
|---|---|---|---|
| 0. Decisions | Section 14 questions; WhatsApp provider and shared mailbox set-up | none | 2 d |
| 1. Master data | A-01 to A-15, A-18, seed lists, units B-03 | 0 | 10 d |
| 2. Sales pipeline | B-01, B-02, B-05 to B-08, B-11 | 1 | 8 d |
| 3. Execution and billing | C-02 to C-08, D-01 to D-07 | 2 | 14 d |
| 4. Transport billing | D-08 to D-12 | 3 | 8 d |
| 5. Messaging service | F-01 to F-06, F-09 | 1, provider account | 10 d |
| 6. Field tasks | E-01 to E-13, mobile view | 3, 5 | 12 d |
| 7. Reports and polish | G-01 to G-05, H-01 to H-03, data-quality centre | all | 6 d |
| 8. Hardening and launch | Staging rehearsal with test data, user acceptance, backups, role set-up, user guide | all | 4 d |

Effort is working days for one developer who knows the repo; phases 5 and 6 can overlap with 3 and 4 with a second developer. Every database change is a new file in `supabase/migrations/` and the schema snapshot is refreshed afterwards.

---

## 14. Decisions needed from the business

1. Deal status model: monday's five states or the app's longer chain?
2. Are Lycra and GRS valid counts and certifications?
3. Are Local/Export and the units Hanks, Bales, Carton, Chippa in daily use?
4. Is the buyer/supplier production profile (looms, reed, machines) used by anyone?
5. Is category 1-4 a credit grade that affects deals?
6. Who owns WhatsApp: provider account, templates, opt-in, sender number?
7. Which shared mailbox sends invoices and confirmations?
8. What are the real escalation days for unpaid invoices (30/45/60) and who is notified?
9. Do sample deliveries need a full workflow or just a register?
10. What does the Billing & Dispatch dashboard show today (ask the owner for a screenshot)?
11. May bank details be sent by WhatsApp, and who may see them?
12. What do the creation forms ask and which fields are required (not readable from monday)?

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Scope creep into a generic no-code builder | Fixed features only (section 11); P3 items are optional |
| WhatsApp template approval takes time | Start provider approval in Phase 0; keep link-based sending as fallback |
| Single-mailbox dependency repeats | Shared sender from day one |
| Rules engine grows complex | Keep rules few, with thresholds as data; every rule logged in `jobs` |
| Unreadable forms and dashboard | Ask the owner for screenshots; confirm before building |
| Bank details exposure | Structured fields, permission-gated, never written to logs |
| Field staff need phones, not desktops | Build the mobile task screen early (Phase 6) and test on real devices |
| Business rules differ from monday habits | User acceptance in Phase 8 with real scenarios |
