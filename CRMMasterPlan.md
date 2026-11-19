# CRM Master Plan: monday.com CRM to Commission Desk

**Purpose.** One plan for every block and every feature of the monday.com "CRM" workspace (Appsavio), mapped onto the Commission Desk web app in this repository (Vite + React + Supabase). For each block it says what monday does today, what the app already does, what is missing, and the features to build. It is a feature plan for a **standalone CRM** modelled on the monday workflows; no monday data is imported.

> **Update 19 Nov 2026.** Part 2 at the end of this file adds what Part 1 listed as unreadable or missing: the automations of 16 boards read from monday (every trigger, condition, action and message text), the creation forms read so far (Master data verified; Dispatch and Billing and Sales Confirmation partial), and a per-group, per-board build specification written so an AI agent can rebuild each board, form and automation. Where Part 2 and Part 1 disagree, Part 2 is newer.

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

> **Status (built):** this block is implemented as the Tasks module at `/tasks` (queues per task type, cheque register, proof photos, GPS check-in, payment lines, notifications bell, scheduled reminders and 30/45/60-day escalation, WhatsApp and e-mail sender with a message log, field view at `/tasks/my`). The old Collection tasks, Cheque collection and Cheques deposited screens were removed; the tables are archived. See the migrations `20261118100000`-`20261118100200` and the README section "Tasks module setup".

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

---

# PART 2: per-board build specification (groups, boards, creation forms, automations)

Purpose of this file: one reference an AI agent (or developer) can read to build CRM+ so that every board, creation form, column, status flow and automation matches the monday.com workspace **CRM** (id 2480519, account `appsavio-corp`). It was written from read-only reads of monday on 2026-11-19. Nothing in monday was changed.

Read this first, then the two supporting docs:

| Doc | What it holds |
|---|---|
| `docs/monday-crm-reference.md` | Every board's full column table (title, type, enum labels, formulas, mirrors, relations), subitem columns, relationship map. Authoritative for **columns**. |
| `docs/mdm-column-parity.md` | The 7 Master data boards: CRM+ column mapping and creation-form specs (done and verified on production). |
| `docs/master-data-qa-checklist.md` | The QA scenarios used for Master data; reuse them for every new register. |

---

## P2-0. How verified each section is

| Mark | Meaning |
|---|---|
| **VERIFIED** | Read directly from monday (API or the signed-in form). |
| **PARTIAL** | Part of it read; the rest is inferred from the board's columns and flagged `(confirm)`. |
| **UNREAD** | Not read. Derived only from columns. Must be confirmed in monday before building. |

| Item | Status | Notes |
|---|---|---|
| Columns of all 22 boards | VERIFIED | monday API, 2026-11-17 and 2026-11-19 |
| Automations of 16 boards | VERIFIED | Deals, Sales Confirmation, Dispatch and Billing, Commission Invoices, Transport Invoice, Transporter Type Details, Mill Invoice Delivery, Commission Invoice Delivery, Kaarthika Transport Freight Invoice, Cheque Collection, Payment Collection, Sample Delivery, Monthly Visit, Counts, Buyers & Suppliers, Business Units |
| Automations of Transport Company, Location MDM, Sizing/Delivery, Payment Terms, Whatsapp Message, Whatsapp Tracking | UNREAD | Read `list_automations` for them before building (likely only date/name helpers) |
| Creation forms of the 7 Master data boards | VERIFIED | `docs/mdm-column-parity.md` |
| Creation form of Dispatch and Billing | PARTIAL | See §P2-3.3 |
| Creation form of Sales Confirmation | PARTIAL | First section only |
| Creation form of Deals | UNREAD | The monday account used shows "No sections are available for your profile" (Viewer role). Needs an admin or editor session |
| Creation forms of the other 10 boards | UNREAD | Same reason: the form is an embedded app (app feature 16492757) that only renders in a signed-in browser |
| Date-trigger offsets in the Monthly Visit workflows | PARTIAL | Times known, some day offsets and status labels `(confirm)` |

How to finish the UNREAD items: sign in to monday with an editor/admin account in a browser, open the board's **Creation Form** view, expand every section, and record each field's label, `*` mark, type hint (shown under the field as "Type: ...") and placeholder. monday API returns the view ids (listed per board below) but not the form's fields.

---

## P2-1. Rules for the building agent

1. **Match monday's names**: board name, column titles (spelling and order), status labels, group names. Fix only obvious typos, and record each fix in `docs/mdm-column-parity.md`-style notes (as done for "Default Commision Percentage").
2. **Every register screen** uses the Master data pattern:
   - Grid with monday's columns in monday's order, then an **Actions** column (Edit / Documents / Delete). No View item. Row click opens nothing.
   - Create and Edit use the same `FormKit` cards: `FormSection` title with "(N fields)", two-column grid, `Field` with label, `*` for required, placeholder "Enter <Field>", selects "-- Select <Field> --", file field "Attach files (0/10)", footer `✓ Create Item` and `Clear Form`.
   - A user without edit rights gets Edit opened read-only.
   - Delete uses `ConfirmDialog`. Documents use `DocumentList` with in-app preview (image, PDF, text).
   - Search over every visible column (whitespace-tolerant, `searchKey`), filters for Status and each enum/relation, Inactive chip.
   - Validation messages next to the field while typing, and under every required field on Create; duplicates refused with a sentence that names the record; server errors as sentences.
3. monday's form opens with **Select Action: Create New Record / Update Existing Record**. CRM+ drops "Update Existing Record" (decision recorded 2026-11-18: Actions > Edit is the only way to change a record).
4. Keep monday's **groups** as a grouping or status filter in the grid, because monday users work by group (e.g. Deals: New, Manager Approval, Approved, Reconsider, Closed Lost).
5. Mirror columns (monday "lookup") are **read-only derived columns** from the linked record. Show them in the grid and on the form as read-only. Do not store copies unless monday does (a few boards copy values with automations; those are listed per board).
6. Formula columns are computed in the database (generated column or view), with the same formula text as monday (listed per board).
7. Automations are listed per board as **A1, A2, ...** with trigger, conditions, actions and message texts. Build them in the automation layer of §P2-2. Mark a board done only when each A-number has a test.
8. Never read or write monday from the app. Production checks are read-only unless a test record is agreed.
9. Commits: no `Co-Authored-By` line. Push to `Testing` and `main` once, after the checks pass.

---

## P2-2. Automation layer (build once, use for every board)

monday's workflows are built from a small set of triggers, conditions and actions. Build these as reusable pieces (database triggers or an Edge Function worker plus a `automation_log` table), then express each board's A-numbers with them.

**Triggers**
- `item_created`
- `column_changed(column)`; `status_changed(column, from?, to)`
- `button_clicked(column)` (Email / Send To Buyer / Send To Supplier)
- `date_arrives(column, time_of_day, tz=Asia/Calcutta, offset_days?)`
- `subitem_status_changed`, `subitem_column_changed`

**Conditions**: `column_is_empty`, `column_is_not_empty`, `status_is(value)`, `number_greater_than(value)`.

**Actions**
- `set_column(col, value | template)`, `set_date(col, today|now)`, `change_status(col, label)`
- `move_to_group(group)`
- `create_item_and_link(target_board, name_template, column_values, link_both_ways)`
- `create_subitem(name_template, column_values)`
- `assign_creator(people_col)`, `notify(person_cols, title, message)`
- `send_email(to_cols, subject, body_template, attachment_col)`
- `send_whatsapp_template(template_name, to_phone_cols[], document_col, log_cols{response, wamid, template, message})`
- `copy_from_lookup(target_col, source_col via relation)` (used on create and when the relation changes)
- `duplicate_check(columns, flag_col, message_col)`
- `autonumber(col, prefix?)`, `ai_fill(col)` (monday uses AI to fill one Deals column; skip unless asked)

**Template variables** are written `{Column title}` below. Message text is verbatim from monday (typos kept for traceability).

**Logging**: every run writes `automation_log(board, item, automation_id, state, error, ran_at)`; show failures to admins (monday shows run history).

**Switched off in monday: do not build** (listed so nobody copies them): Commission Invoice Delivery "set date / link / assign person on create" (missing column), SC → "Orders" (old), Sample Delivery → "Qualified Leads" (target board deleted), Commission Invoices date trigger that only creates a "Test message", all deactivated Deals template automations (email opened, AI on create, etc.).

---

## P2-3. Group CRM (folder "CRM"): the core sales flow

Flow: **Deal** → (manager approves) → **Sales Confirmation** → (send with delivery info) → **Dispatch and Billing** → dispatch entries (subitems) → **Commission Invoice**.

### 3.1 Deals (board 5024227507, 28 rows)

- **CRM+ today**: `/deals` (src/pages/Deals.tsx), ~20 columns, row-click style. **Gap**: ~25 monday columns missing (mostly buyer/supplier mirrors), no Actions column, no groups tabs parity.
- **Purpose**: a buyer enquiry/deal for a count, approved by a manager before it becomes a Sales Confirmation.
- **Groups**: New, Manager Approval, Approved, Reconsider, Closed Lost.
- **Columns** (full table in `docs/monday-crm-reference.md` §Deals): Name, Tasks (subitems), Owner, Status (`deal_stage`: New Deal → Manager Approval → Approved / Reconsider / Closed Lost), Manager, Created Date, Deal No, Approval Date, Sales Confirmation (relation), Counts (relation), Summary (mirror of Counts.Summary), Payment Terms (relation), Buyer (relation) + 10 buyer mirrors (Messenger, Contact Person 1, Contact Person Phone, Office Address, Mill/Factory/Delivery Address, GST No., Location, IT PAN, Business Unit, Buyer Commission Type, Buyer Commission Value), Supplier (relation) + 11 supplier mirrors (Messenger, Contact Person 1, Contact Person 2, Office Address, Mill/Factory/Delivery Address, GST No., Location, IT PAN, Business Unit, Supplier Commission Type, Supplier Commission Value), Quantity, UOM (KGs, Bags, Hanks, Bales, Carton, Chippa, Meters, Tons), Bags Weight, Final Rate, Freight (text), Mode (Net, Ex-Mill), Remarks, Documents, Location (map).
- **Creation form**: view id 51649995 "Deal Creation Form". **UNREAD**. Proposed until confirmed (from columns, in monday's column order): Deal Details (Name*, Owner, Manager, Created Date, Deal No), Parties (Buyer*, Supplier), Product (Counts*, Quantity*, UOM*, Bags Weight, Final Rate, Mode, Freight, Payment Terms), Remarks, Documents. Confirm required marks in monday.
- **Automations** (VERIFIED):
  - A1 `status_changed(Status → Manager Approval)`: notify the **Manager** with title `Deal - {Name}`, message `Hey, / Please Review this Deal - {Name}`; move to group Manager Approval.
  - A2 `status_changed(Manager Approval → Approved)`: create an item in **Sales Confirmation** named `Sales Confirm -  {Deal Name}`, Status = Draft, group New, linked both ways (Deals."Sales Confirmation" ↔ SC."Link to Deals"); set **Approval Date** = today; move the deal to group Approved.
  - A3 `status_changed(Manager Approval → Reconsider)`: notify the **Owner** with title `Revised Deal - {Name}`, message `Hey {Owner}, / Please revised this Deal - {Name}`; move to group Reconsider.
  - A4 `status_changed(→ Closed Lost)`: move to group Closed Lost.
  - A5 `column_changed(Deal No)`: set Name = `{Deal No}`.
  - A6 `item_created`: assign the creator to **Owner**.
  - A7 `item_created`: Created Date = now; Deal No = auto-number (legacy automations 29500214 and 29500216).
- **Build notes**: an Approved deal is locked (CRM+ already has `crm_deals_status_guard`). Reconsider returns the deal to the owner for edits. Keep the existing lead link (CRM+-only).
- **Acceptance**: each of A1 to A7 has a test; the grid shows all 45 columns with the column picker; Actions menu works.

### 3.2 Sales Confirmation (board 5026795662, 78 rows)

- **CRM+ today**: `/sales-confirmations`, ~22 columns, bulk send drawer and notification log exist (`src/components/sc/`). **Gap**: ~50 buyer/supplier mirror columns, statuses/groups, email/WhatsApp parity, Actions column.
- **Purpose**: the confirmation (purchase order) sent to buyer and supplier by email and WhatsApp for an approved deal, later enriched with delivery/transport info.
- **Groups**: New, Send, Send with Delivery Info.
- **Columns**: see `docs/monday-crm-reference.md` §Sales Confirmation. Key enums: Status (Draft → Send → Send with Delivery Info.), Type (Local, Export), Freight (EXCLUDED, INCLUDED), UOM (as Deals), Whatsapp Message (Send to Supplier, Send To Buyer, Not Send). Buttons: Send To Supplier, Send To Buyer. Checkboxes: Confirmation approved, Send To Buyer. Files: Buyer Document, Supplier Document. Text: Confirmation No, wamid, Buyer Response, Supplier Response, Message Template Name, Transporter Name, Vehicle Number. Long text: Delivery Schedule, Remarks, Messsage [sic]. Phone: Driver Contact Phone. Dates: Created Date, Buyer Email Datetime, Supplier Email Datetime. Formula: Quantity × Bag Weight (total kg).
- **Creation form**: view id 51649580 "Sales Confirmation Creation Form". **PARTIAL**. First section read: **Sales Confirmation Details (7 fields)**: Name*, Created Date (date and time), Type*, Status*, Link to Deals (relation), Delivery Schedule (long text), plus one field not seen `(confirm)`. Remaining sections not read. Proposed continuation from the columns: Parties (Buyer*, Supplier*), Product (Counts*, Quantity*, Bag Weight, Ex Mill, UOM*, Final Rate, Payment Terms*, Freight), Delivery (Sizing/Delivery Address, Transporter Name, Vehicle Number, Driver Contact Phone), Remarks, Documents.
- **Automations** (VERIFIED):
  - A1 `status_changed(Draft → Send)`: move to group Send.
  - A2 `status_changed(Send → Send with Delivery Info.)` and `Link to Dispatch and Billing` is empty: create an item in **Dispatch and Billing** named `Sales - {Name}`, Status = Draft, group Draft, linked both ways (SC."link to Dispatch and Billing" ↔ D&B."Sales Confirmation"); copy Transporter Name, Driver Contact Phone, Vehicle Number into the new item; move the SC to group "Send with Delivery Info.".
  - A3 `button_clicked(Send To Supplier)`: send email, subject `Sales Confirmation Document`, attach **Supplier Document**, body: `Dear Sir, / Please find attached the confirmation for your reference, / Incase there is any difference in count/ rate/ quantity , kindly revert at the earliest. Attachment to have the bank details of mill / Contact {Supplier Messenger…} / Thanking you, / Confirmation department / {…}`. Then set **Supplier Email Datetime** = now.
  - A4 `button_clicked(Send To Buyer)`: same, subject `Sales Confirmation Document`, attach **Buyer Document**, body starts `Dear Sir, / Please find attached the confirmation for your reference, / In case there is any difference in count/ rate/ quantity , kindly revert at the earliest. Attachment to have the bank details of mill / Contact {…} / Thanking you, / Confirmation department / {…}`. Then **Buyer Email Datetime** = now.
  - A5 `status_changed(Whatsapp Message → Send To Buyer)`: send WhatsApp template `sales_confirmation_buyer` ("Sales Conf. - BUYER (Doc)") with **Buyer Document** to Buyer Office Phone, Buyer Contact Person 1 Phone, Contact Person 2 Phone; log Buyer Response, wamid, Message Template Name, Messsage.
  - A6 `status_changed(Whatsapp Message → Send to Supplier)`: template `sales_confirmation_supplier` ("Sales Conf. - SUPPLIER (Doc)") with **Supplier Document** to Supplier Office Phone and contact phones; log Supplier Response, wamid, template, message.
  - A7 `column_changed(Buyer Response)` is not empty: create **Whatsapp Message** item `Message-{…}` (Board = Sales Confirmation, group Sales Confirmation) with To Phone, Message, wamid, Response, Message Template Name, linked through Related Records.
  - A8 same for `Supplier Response`.
  - A9 `column_changed(Confirmation No)`: Name = `{Confirmation No}`.
  - A10 `item_created`: Created Date = now; Confirmation No = auto-number.
- **Build notes**: Email = SMTP/Gmail sender with the same subject and body; WhatsApp = template API with a response-capture webhook that fills the Response columns. Quantity × Bag Weight is a generated column.

### 3.3 Dispatch and Billing (board 5026792171, 27 rows)

- **CRM+ today**: `/orders` with tabs Main table, Reports, "Dispatch & Billing Creation Form" (`src/components/DnbCreationForm.tsx`); ~40 columns. **Gap**: monday columns not shown (about 35 mirrors), Actions column, automation parity.
- **Purpose**: one item per order/invoice against a Sales Confirmation. Subitems are individual dispatch entries (partial dispatches), each with its own invoice and commission maths.
- **Groups**: Draft, In Progress, Fully Dispatch, New Group.
- **Columns**: `docs/monday-crm-reference.md` §Dispatch and Billing. Status labels: Draft → Partially Dispatch → In Progress → Fully Dispatch, plus Cancel and Return. UOM as Deals. Transport Type: Own Transport, Agreed Third Party, Third Party (Direct Payment by Party). Send Email and Send Whatsapp: Send, Not Send.
- **Formulas** (keep exactly):
  - Total Weight = Bags Weight × Quantity
  - Value = Total Weight × Final Rate
  - Buyer Commission = IF(Buyer Commission Type="Percentage", Value × Buyer Commission Value / 100, IF="BAG", Value-of-type × Quantity, IF="KG", × Total Weight, 0); Supplier Commission is the same with the supplier type/value
  - Total Amount = Value + Value × CGST/100 + Value × Insurance Tax/100 + Add − Deduct
  - Validation Errors = IF(sum of subitem Quantity Dispatched > Quantity, "Sum of Subitems quantity is greater than parent item's quantity.", "")
  - Record Validation = IF(Quantity < sum of subitem quantity, "True", "False")
- **Creation form**: view id 51650025 "Dispatch & Billing Creation Form". **PARTIAL** (read in the signed-in browser; the middle was skipped while scrolling):
  - **Buyer & Supplier Details (2 fields)**: Bags Weight, Final Rate.
  - **Product Congifurations [sic] (2 fields)**: UOM (status select), Quantity (numbers).
  - A section (name not seen, `confirm`) with: Add, Deduct, Insurance Tax, Round off (all numbers), and presumably CGST `(confirm)`.
  - **Transporter Type Details (1 field)**: Transporter Type Details (relation, select).
  - **Documents (1 field)**: Documents (file, "Attach files (0/10)").
  - Footer: `✓ Create Item`, `Clear Form`. Select Action radio at the top.
  - Note: the form has no buyer/supplier/SC fields. Items are normally created by automation A2 of Sales Confirmation; CRM+ builds them from a picked confirmation (one item per count), which is acceptable.
- **Automations** (VERIFIED, 10 workflows plus legacy):
  - A1 `status_changed(Draft → Partially Dispatch)`: create a **subitem** named `{Name}` with Status = Partially Dispatch and its Invoice No. copied; set the parent Status = In Progress; move to group In Progress.
  - A2 `status_changed(In Progress → Cancel)`: create a subitem with Status = Cancel; set the parent Status = Fully Dispatch; move to group Fully Dispatch.
  - A3 `status_changed(In Progress → Return)`: create a subitem with Status = Retun [sic]; parent = Fully Dispatch; move to Fully Dispatch.
  - A4 `status_changed(Draft → Fully Dispatch)`: move to group Fully Dispatch.
  - A5 `item_created`: create an item in **Mill Invoice Delivery** named `{Name} - Task`, Status = Working on it, linked both ways (D&B."link to Mill Invoice Delivery" ↔ MID."Dispatch and Billing").
  - A6 `status_changed(Send Email → Send)` (parent): send email, subject `Dispatch Information`, body `Dear Sir, / Please note –{Counts}- {Quantity}… was delivered to your sizing via vehicle no. {Vehicle Number} on {Dispatch Date} / Incase you have not received the bags, kindly contact {Buyer Messenger} / Thanking you, / Delivery department / {…}`.
  - A7 `subitem_status_changed(Send Email Not Send → Send)`: same email for a dispatch entry (`Dear Sir, / Please Note-{…} – {…} – {…} was delivered to your sizing via vehicle no. {Vehicle Number} on {Dispatch Date}. / ...`).
  - A8 `status_changed(Send Whatsapp → Send)` (parent) and the subitem equivalent: WhatsApp template `disptach_and_billing` ("Dispatch & Billing (Doc)") to Buyer Office Phone, CP1 Phone, CP2 Phone; log Response, wamid, Message Template Name, Message.
  - A9 `column_changed(Response)` / `subitem_column_changed(Response)` not empty: create a **Whatsapp Message** item `Message-{…}` (Board = Dispatch and Billing, group Dispatch and Billing).
  - A10 `column_changed(Sr. No)`: Name = `{Sr. No}`.
  - A11 `item_created` and `column_changed`: **duplicate check** on Invoice No. into Is Duplicate? and Duplication Error Message.
  - A12 `item_created`: Created Date = now; Sr. No = auto-number.
- **Subitems (dispatch entries)**: columns in `docs/monday-crm-reference.md` §"Subitems of Dispatch and Billing". Quantity Dispatched rolls up to the parent (sum). Same commission formulas using Quantity Dispatched.
- **Views to mirror**: "Record Validations" (items where Record Validation = True) and "Duplicate Checks" (Is Duplicate checked) as saved filters.

---

## P2-4. Group Tasks (folder "Tasks"): field-staff and collection boards

Common pattern: Person / People (assignee, usually the messenger), **Accounts** (people), GPS Check-In (location), proof upload (file). Meant for mobile. Messenger is copied from the buyer to the person columns by a pair of legacy automations on most of these boards (`copy_from_lookup(Person ← B&S.Messenger via the Buyer relation)` on create and on relation change).

CRM+ has a Tasks module (`src/pages/tasks/*`, migration `20261118100000_tasks_module.sql`, queues: pending documents, collection tasks, cheque collections). Compare each board below with it before adding anything.

### 4.1 Payment Collection (5027269376, 0 rows)
- **Groups**: Group Title. **Columns**: Name, Subitems, Person, Accounts, Connected Boards (relation → Monthly Visit **and** Commission Invoice Delivery), Buyer Name (mirror), Invoice Number, Amount, Amount Collected, Mode of Payment (Online, Cash, Cheque), Payment Proof Upload, Balance Amount (= Amount − Amount Collected), GPS Check-In, Payment Status (Outstanding, Completed), Start Date, End Date, Days Aging (= DAYS(End Date, Start Date)).
- **Creation form**: view id 51888761. **UNREAD**. Proposed: Payment (Name*, Connected record, Invoice Number, Amount*, Amount Collected, Mode of Payment, Payment Status, Start Date, End Date), People (Person, Accounts), Proof (Payment Proof Upload, GPS Check-In).
- **Automations**: A1 `column_changed(Amount Collected)` and Amount Collected > 0: notify Person + Accounts, title `{Person}`, message `Hey,{user} , / Amount collected is {Amount Collected}`. A2 `item_created`: Start Date = today. A3 `status_changed(Payment Status → Completed)`: End Date = today. A4 (inactive) copy Connected Boards. Items are also created by Monthly Visit and Commission Invoice Delivery (see 4.2, 4.4).

### 4.2 Monthly Visit (5027265052, 3 rows)
- **Columns**: Name, Person, Accounts, Buyers Name (relation → B&S), Buyer Messenger (mirror), Created Date, Visited Date, GPS Check-In, Check-In Time, Check-Out Time, Meeting Summary, Pending Payment Status (No, Yes), Visited/Not Visited (Not Visited, Visited, Completed), link to Payment Collection. Extra monday view: "Dashboard".
- **Creation form**: view id 51888089. **UNREAD**. Proposed: Visit (Name*, Buyers Name*, Person, Accounts, Visited Date, Visited/Not Visited), Check-in (GPS Check-In, Check-In Time, Check-Out Time), Summary (Meeting Summary, Pending Payment Status).
- **Automations** (VERIFIED structure; some labels and offsets `(confirm)`), 9 workflows:
  - A1 `item_created`: Created Date = today.
  - A2 `date_arrives(Created Date, 17:45 IST)` and Visited/Not Visited = Not Visited: notify, title `{Name}`, message `Hey, {Person}, / You have not visited yet.`
  - A3 `date_arrives(Visited Date +30 days, 10:00)` and Visited/Not Visited = Visited `(confirm)`: notify `Hey, {Person}, / you have visited and not collect the payment.`
  - A4/A5/A6 visited branch at 30, 45, 60 days (Visited Date, times 18:00, 22:15, 22:45 IST): when Pending Payment Status = Yes and Visited: notify `Hey, {Person}, you have visited and not collected the payment after 30 / 45 / 60 days` and create a **Payment Collection** item `Monthly Visit - {…}` linked both ways (Monthly Visit."link to Payment Collection" ↔ PC."Connected Boards").
  - A7/A8/A9 not-visited branch at 30, 45, 60 days (Created Date, times 18:15, 22:15, 22:45 IST): when Visited Date is empty and Pending Payment Status = Yes: notify `Hey, {Person}, you have not visited and not collected the payment after 30 / 45 / 60 days` and create the Payment Collection item.
  - Plus Person ← Buyer Messenger copy (legacy).

### 4.3 Mill Invoice Delivery (5027269220, 26 rows)
- **Columns**: Name, People, Accounts, Status (Working on it, Stuck, Done; mirrored into D&B "Mill Invoice Status"), Buyers, Buyer Messenger, Supplier Name, Supplier Messenger, Invoice Number, Invoice Date (mirrors of D&B), Invoice Amount, Delivery Mode (Hand, Courier), Delivery Proof Upload, GPS Check-In, Dispatch and Billing (relation), Invoice Status (Not Delivered, Delivered).
- **Creation form**: view id 51888736. **UNREAD**.
- **Automations**: A1 `column_changed(Delivery Proof Upload)` and not empty: notify **Accounts**, title `{Name}`, message `Hey, {Accounts}, / Mill Invoice is delivered`; set Invoice Status = Delivered. A2 (legacy) People ← Messenger (copy from lookup).
- Created by Dispatch and Billing A5.

### 4.4 Commission Invoice Delivery (5027269270, 31 rows)
- **Columns**: Name, People, Accounts, Commission Invoices (relation), Commission Amount (mirror of Net Amount), Buyer, Buyer Messenger, Commission Invoice No., Invoice Date, Acknowledgement Received (Yes, No), Photo Upload, GPS Check-In, Pending Payment Status (No, Yes), Created Date, link to Payment Collection.
- **Creation form**: view id 51888738. **UNREAD**.
- **Automations**: A1 `date_arrives(Created Date, 18:30 IST)` and Pending Payment Status = Yes: notify Person + Accounts, title `{Name}`, message `Hey, {Person}, / Payment is pending for this record.`; create a **Payment Collection** item `Commission Invoice - {Name}` linked both ways. A2 (legacy) People ← Messenger.
- Created by Commission Invoices A4.

### 4.5 Kaarthika Transport Freight Invoice (5027269319, 20 rows)
- **Columns**: Name, Person, Accounts, Transport Invoice (relation), Buyer (mirror), Transport Bill No., Transport Amount, Load Reference, Delivery Proof, GPS Check-In, Status (Yes, No), Check (Outstanding, Cleared).
- **Creation form**: view id 51888741. **UNREAD**.
- **Automations**: A1 `status_changed(Check → Outstanding)`: notify Person + Accounts, title `{Name}`, message `Hey, {Accounts}, / The payment for {Name} is {Check}`.
- Created by Transport Invoice A2.

### 4.6 Sample Delivery - Comes From Mills (5027269351, 1 row)
- **Columns**: Name, Person, Accounts, Buyer, Buyer Messenger, Supplier, Supplier Messenger, Sample Quality, Sample Type (TBD 1/2/3 placeholders), Sample Lot, Delivery Date, Feedback Due Date (= Delivery Date + 7 days, DD-MM-YYYY), Feedback Status (Pending, Approved, Rejected), GPS Check-In, Photo Proof.
- **Creation form**: view id 51888745. **UNREAD**.
- **Automations**: A1 `date_arrives(Delivery Date +7 days, 20:30 IST)` and Feedback Status = Pending: notify Person + Accounts, title `{Name}`, message `Hey, {Person}, / The sample {Name} feedback is due.` A2 (legacy) Person ← Buyer Messenger. Skip: Feedback Status = Approved → create "Qualified" lead (target board deleted).

### 4.7 Cheque Collection (5027269441, 1 row)
- **Groups**: To Collect, In Progress, Collected. **Columns**: Name, Accounts, Person, Buyer Name, Invoice Number, Cheque Number, Bank Name, Cheque Date, Cheque Amount, Cheque Photo Upload, Deposit Status (Pending, Deposited, Cleared, Collected), Notes, Subitems, GPS Check-In.
- **Creation form**: view id 51888765. **UNREAD**.
- **Automations**: A1 `column_changed(Cheque Photo Upload)` and not empty: set Deposit Status = Collected; notify Accounts, title `{Deposit Status}`, message `Your Check for {Name} is {Deposit Status}`. A2 (legacy) Person ← Messenger.
- CRM+ already has `ChequeQueue`/`ChequeForm`; align column titles and the group view.

---

## P2-5. Group Root boards: billing documents and messaging

### 5.1 Commission Invoices (5026907737, 36 rows)
- **CRM+ today**: only the "Commission bills" task queue. **Gap**: no register. Build one.
- **Groups**: Group Title, Send. **Columns**: `docs/monday-crm-reference.md` §Commission Invoices (about 55). Enums: Party Type (Supplier, Buyer), Status (Generated, Sent, Pending), Commission Type (BAG, KG, Percentage), Mode of Payment (NEFT, UPI, RTGS, Cash, Cards), Whatsapp Message (Send, Not Send). Totals (Total, Net Amount, Round Off) are numbers filled externally from Dispatch and Billing commissions; Payment Pending = Net Amount − Partial Payment/Payment Collected.
- **Creation form**: monday has a "Commission Invoice From" app view (not a standard Creation Form; `FeatureBoardView`) `(confirm what it does)`.
- **Automations**:
  - A1 `button_clicked(Email)`: send email, subject `Commission Invoice From Kaarthika Agency`, attach Documents, body `Dear Sir, / Thanks for purchasing yarn via {Business Unit Name}. / Please find attached the commission bill from Date {Invoice From Date} to {Invoice To Date} along with mill invoices for your reference. / Incase of any discrepancies revert within 15 days of bill date. / kindly contact account department. {Business Unit Phone} / Thanking you …`.
  - A2 `status_changed(Whatsapp Message → Send)`: template (document template, name `(confirm)`) to buyer phones; log wamid, Whatsapp Response, template, Message.
  - A3 `column_changed(Whatsapp Response)` not empty: create Whatsapp Message item (Board = Commission Invoice, group Commission Invoice).
  - A4 `item_created`: create a **Commission Invoice Delivery** item named `{Name}` in group Group Title, linked both ways.
  - A5 `item_created`: Name = `CI - {…}`; assign creator to Person; Creation date = now; Sr. No auto-number (`SR-`).

### 5.2 Transport Invoice (5027015093, 20 rows)
- **CRM+ today**: "Transport invoices" queue only. **Gap**: register.
- **Columns**: `docs/monday-crm-reference.md` §Transport Invoice (about 48). Type (Kg, Bag). Formulas: Total Weight = No. Of Bags × Bag Weight; Total Amount = IF(Type="Bag", Rate × No. Of Bags, IF(Type="Kg", Rate × Total Weight, 0)); Payment Pending = Total Amount − Partial Payment. Other views: "Table", "Transport Invoice" (app).
- **Creation form**: view id 51525761. **UNREAD**.
- **Automations**:
  - A1 `column_changed(Response)` not empty: create Whatsapp Message item `Message-{…}` (group Transport Invoice) copying To Phone, Message, wamid, Response, Template, Document.
  - A2 `item_created`: create **Kaarthika Transport Freight Invoice** item `{Name} - Transport Task`, linked both ways.
  - A3 `button_clicked(Email)`: send email, subject `Transport Commission Invoice`, attach Document, to the To Email and To Contact Person 1/2 Email lookups. Body: `Dear Team , / Please find attached the transport commission bill from {Business Unit Name} on date {Date}. / The physical copy of this invoice has been raised and dispatched to your office. / We kindly request you to process the payment at your earliest convenience. / All other details regarding the shipment and billing are provided in the attached document. / Thank you for your continued business! / {Business Unit Name} / Best regards`.
  - A4 `column_changed(KT INV. NO.)`: Name = `TI - {KT INV. NO.}`.
  - A5 `item_created`: assign creator to Person.
  - A6 `status_changed(Whatsapp Message → Send)`: template `transport_invoice` ("Transport Invoice (Doc)") with Document to Office Phone, CP1 Phone, CP2 Phone lookups; log response, wamid, template, message.
  - A7 `column_changed(Transporter Type Details)`: refresh lookups (legacy).

### 5.3 Transporter Type Details (5026904637, 11 rows)
- **CRM+ today**: partly in trip sheets / transporter payments. **Gap**: register.
- **Columns**: `docs/monday-crm-reference.md` §Transporter Type Details (about 54). Type (Own Transport, Agreed Third Party, Third Party (Direct Payment by Party)). Formulas: Actual KM = Ending KM − Start KM; Cost Of Diesel = Consumed × POD; Total Cost = Cost Of Diesel + Driver Bata + Loading Charge + UnLoading Charge + Tiffen Charge + Others + LNT + PC.
- **Creation form**: view id 55834935. **UNREAD**.
- **Automations**: A1 `column_changed(Transport Invoice relation)`: tick checkbox Transport Invoice. A2 `column_changed(Serial No)`: Name = `{Serial No}`. A3 `item_created` and `column_changed(Dispatch and Billing)`: copy Office Phone, Contact Person 1/2 Phone, Email, Contact Person 1/2 Email from the linked D&B buyer lookups into the plain phone/email columns. A4 `item_created`: Created Date = now; Serial No auto-number. Two older copies of A3 are inactive.

### 5.4 Whatsapp Message (5027236770, 124 rows) and Whatsapp Tracking (5027998834, 22 rows)
- **CRM+ today**: `MessagesPanel`, `NotificationLog`, `SendMessage`.
- **Whatsapp Message** columns: Name, Subitems, Board (Sales Confirmation, Commission Invoice, Transport Invoice, Dispatch and Billing), Related Records (relation to six boards), Created Date, To Phone, Client Name (relation), Message, wamid, Response, Message Documents, Message Template Name, monday Doc v2. Groups: Commission Invoice, Sales Confirmation, Transport Invoice, Dispatch and Billing. Rows are created by the "response arrived" automations above. Automations on this board itself: **UNREAD**.
- **Whatsapp Tracking** columns: Name, Sr No. (auto-number), Type (Bank Details, Quotation Details, Draft), Created Date, Buyers (+ Office Phone, CP1 Phone, CP2 Phone mirrors), Suppliers, Business Units, Message, Notes, Office Phone WanId, Contact Person Phone 1 WanId, Contact Person Phone 2 WanId, Response. Used for broadcasts ("Send Bank Details", "Broadcast" views). Automations and forms: **UNREAD**.
- Build as a message log register with a read-only grid and "resend" action; one creation form for broadcasts.

### 5.5 Quotes & Invoices (5024227501, 0 rows)
Stock monday template board, empty. **Do not build.**

---

## P2-6. Group MDM (folder "MDM"): done, verified on production

Status of CRM+: **built and verified** (columns, forms, validation, documents, search, filters, Actions menu). Details, form specs and column mapping are in `docs/mdm-column-parity.md`; QA in `docs/master-data-qa-checklist.md`. Summary and automation notes:

| Board (monday id) | CRM+ route | Rows in monday | Creation form (VERIFIED) | monday automations |
|---|---|---|---|---|
| Business Units (5024662780) | `/master-data/business-units` | 5 | Board Information (Name*, Trade Name, Legal Name, Email*, State, Mobile, Phone 1, Phone 2, Phone 3, Address*, GST Number); Account Details (Bank Account Details 1*, Bank Account Details 2, PAN Number); Documents | `item_created`: Date = today; `Name` → Name Copy (helper). CRM+ also keeps Short name and Reference prefix |
| Buyers & Suppliers (5024227503) | `/master-data/buyers-suppliers` | 45 | Buyer & Supplier Details (Name*, Date, Type*, Email, Office Phone*, Office Address*, Mill/Factory/Delivery Address, State, GST No.*, Business Unit*, Location MDM, Default Commision Percentage*, Category, Messenger); Account Details (IT Pan); MD / Account / Dispatch Information (Contact Person 1, 2, 3 with Phone and Email); Product Configuration (Counts*, Buyer/Supplier Commission Type and Value); Incase of Buyer / Supplier; Remarks (Remark 1, 2); Documents | `status_changed(Type → Buyer)` move to group Buyer; `Type → Supplier` move to group Supplier; Name Copy sync; legacy: Emails & Activities → activity item (inactive/unused), a custom "Code It" button |
| Counts (5026452240) | `/master-data/counts` | 32 | Count Information (Name*, Thread Count*, Machine*, Type*, Process, Certification, Yarn); Fabric Composition (Yarn 1*, Yarn 1 (Percentage)*, Yarn 2, Yarn 2 (Percentage), Overall Yarn Composition, Overall Yarn) | Summary text rebuilt when Name/Thread Count/Machine/Yarn 1/Yarn 1 %/Yarn 2/Yarn 2 %/Yarn/Process/Certification/Type changes (11 workflows); duplicate check on create and on each of those columns (Is Duplicate, Duplicate Error) |
| Transport Company (5026540774) | `/master-data/transport` | 2 | Transport Type Details (Name*, Email, GST No.*, Office Phone*, Res Phone, State*, State Code*, Office Address*, Mill/Factory/Delivery Address, Locations*, Business Units*); Account Details (Bank Account Number 1*, Bank Account Number 2, IT PAN*); Contact Details (Contact Person 1*, Phone*, Contact Person 2, Phone); Vehicle Details (Vehicle Type*, Vehicle No 1-3); Remarks; Documents | UNREAD |
| Location MDM (5026540835) | `/master-data/locations` | 2 | Location Details (Name*, State, Zone, GST Number, Phone, Email, Contact Person (MD), Accounts Dept Phone, Address*); Documents | UNREAD |
| Sizing/Delivery Address (5026819478) | `/master-data/delivery-address` | 2 | Information (Name*, GST No.*, State*, Office Address*, Locations); Contact Details (Contact Person 1* and 2*, their Phones* and Emails*); Remarks 1*; Documents* | UNREAD |
| Payment Terms (5026694999) | `/master-data/payment-terms` | 6 | none in monday; CRM+ asks Name*, Days* (0 to 365) | UNREAD |

**Still to do in Master data**
- Import monday's real rows (production holds only test data).
- Implement the Counts Summary rebuild and the Buyers & Suppliers Type → group behaviour if not already in the grid.
- Read the automations of Transport Company, Location MDM, Sizing/Delivery and Payment Terms.

Known deliberate differences (do not "fix"): no Date field on Location, Transport and Sizing/Delivery forms; Transport "CGST" is labelled "GST No."; Counts show title case while storing upper case; "OEKO TEX" corrects monday's "OKEA TEX"; "Bagwise Rate." loses its stray full stop; monday's "None" option is the empty choice.

---

## P2-7. Relationship map (build the links in this order)

```
Business Units ─┬─ Buyers & Suppliers ─┬─ Deals ── Sales Confirmation ── Dispatch and Billing ─┬─ subitems (dispatch entries)
Payment Terms ──┤  Counts ─────────────┤                                  │                    ├─ Mill Invoice Delivery
Location MDM ───┤  Location MDM ───────┘                                  │                    └─ Transporter Type Details ── Transport Invoice ── Kaarthika Freight Invoice
Sizing/Delivery ┘                                                         └─ Commission Invoices ── Commission Invoice Delivery ── Payment Collection ── Monthly Visit
Transport Company ── Transporter Type Details        Cheque Collection, Sample Delivery (buyer/supplier links)
Whatsapp Message  ← written by SC, D&B, Commission Invoices, Transport Invoice "response arrived" automations
```

Two-way links to keep: Deals ↔ Sales Confirmation, SC ↔ Dispatch and Billing, D&B ↔ Mill Invoice Delivery, Commission Invoices ↔ Commission Invoice Delivery, Commission Invoice Delivery ↔ Payment Collection, Monthly Visit ↔ Payment Collection, Transport Invoice ↔ Kaarthika Freight Invoice, Transporter Type Details ↔ Transport Invoice, SC ↔ Transporter Type Details.

---

## P2-8. Build order and acceptance

| Step | Work | Done when |
|---|---|---|
| 0 | Automation layer (§P2-2) and the shared register pattern for CRM boards (Actions column, FormKit forms, documents) | One board runs end to end with logged automations |
| 1 | Finish reading the UNREAD items in §P2-0 (needs an editor/admin monday session) | This file has no `(confirm)` left for the boards being built |
| 2 | Deals, then Sales Confirmation, then Dispatch and Billing (§P2-3), including all A-numbers | Each A-number has a passing test; grids show all monday columns; production check against monday passes |
| 3 | Billing documents: Commission Invoices, Transport Invoice, Transporter Type Details (§P2-5.1 to 5.3) | Same |
| 4 | Tasks boards (§P2-4) | Same |
| 5 | Messaging registers (§P2-5.4) and dashboards ("Reports", "Sales Report", Monthly Visit "Dashboard", "Billing & Dispatch Dashboard") | Same |
| 6 | Import monday data for every board | Row counts match monday (Business Units 5, Counts 32, Buyers & Suppliers 45, Deals 28, Sales Confirmation 78, Dispatch and Billing 27, Commission Invoices 36, Transport Invoice 20, Transporter Type Details 11, Whatsapp Message 124) |

Acceptance for every board: column titles and order equal monday's (plus Actions); creation form sections, field order, labels and required marks equal monday's; each A-number reproduced; status flow and groups reproduced; formulas return the same numbers on a sample of real rows; the QA checklist scenarios pass; checked on production read-only before pushing.

---

## P2-9. Open questions for the owner

1. Which automations should run automatically in CRM+, and which only as manual actions (especially email and WhatsApp sends)?
2. Email sender account and WhatsApp provider for CRM+ (monday uses a Gmail credential and a WhatsApp template integration with the template names listed above).
3. Should monday's real data be imported, and from which date?
4. A monday admin/editor session to read the remaining creation forms (Deals and the nine others in §P2-0).
5. The unnamed Dispatch and Billing form section and the seventh Sales Confirmation field: confirm in monday.

