# Commission invoice: monday against CRM+ (types, lines, other invoices, process)

Sources: monday's Commission Board app code (read from the downloaded folder), `docs/monday-crm-reference.md`, `CRMMasterPlan.md` section 6, `docs/monday-task-folder-analysis/` (automation inventory, Transport Invoice dependency), and the CRM+ code, migrations and a local test database. monday itself was not accessed.

## 0. What monday really does after an invoice is generated (read in monday on 2026-11-25, view only)
Opened the Commission Invoices board, one item (CI - 11) with its Activity Log and Files, the Commission Invoice Delivery board and the six automations of the Commission Invoices board. Nothing was changed.
1. The Commission Board app creates the item **"Invoice N" in the group "Group Title"** with Status **Generated**, sets its **Business Units** and **Buyer** links, and uploads **invoice_N.pdf into the Documents column** (the Files tab shows that one PDF).
2. Automation "item created: change item Name to Column Value, then Person to Column Value" renames it to **"CI - N"** and sets Person to the creator (Sr. No SR-n is the board's own auto number).
3. Automation "item created: create item in Commission Invoice Delivery (both boards)" makes the **delivery item** "Invoice N", linked to the invoice, with the Commission Amount (net) copied from it; People and Accounts are usually empty, and the Buyer mirror is blank for supplier invoices.
4. Sending is manual: automation "Email clicked: send an Email to Someone" (Gmail) and "Whatsapp Message changes to Send: send template Commission Invoice (Doc) with the document from Documents to the Buyer Office Phone" (WhatsAppConnect). A WhatsApp response is logged on the Whatsapp Message board (two more automations).
5. The status stays **Generated**: none of the 36 invoices ever moves to Sent or Pending, and Payment Pending / Mode of Payment are typed by hand. Older rows show blank Party Type ("Select Party Type") and inconsistent names ("CI -", "Invoice 1", "4").
CRM+ does steps 1 to 3 in one go (invoice, stored PDF, delivery task with the net amount and the party, one numbering), keeps the status and payments as real records, and does not send e-mail or WhatsApp.

## 0b. Limitations seen in monday, and how CRM+ handles each
Seen on 2026-11-25 by looking at the monday boards (view only): the Commission Invoices board (36 items) and the Commission Invoice Delivery board (31 items), plus the earlier documentation. "Seen" = on screen; "docs" = from the reference documents.

| # | Limitation in monday | Evidence | In CRM+ |
|---|---|---|---|
| 1 | Status never moves: every invoice is still "Generated" | seen | Real status (Generated, Sent, Pending, Cancelled) changed by action, with the time on Sent |
| 2 | Party Type left blank ("Select Party Type") on several older invoices | seen | Required and checked by the database |
| 3 | Person blank on most invoices | seen | The register has a **Person** column (who generated it, recorded by the system) |
| 4 | Names are inconsistent or blank: "CI -", "CI-5", "Invoice 1", "4", "Invoice 6", "CI - 9" | seen | One numbering series, no free-text names |
| 5 | Empty invoices exist: "CI -" rows with no dates or amounts, "Invoice 1" with no period | seen | An invoice needs at least one dispatch line, both dates, and (new) a **net amount above 0** |
| 6 | Commission Value blank on Percentage invoices; only the BAG ones carry a value (12, 11) | seen | The rate and basis are stored on every line (and on the invoice when a manual rate is used) |
| 7 | The "Buyer" column is also used for supplier invoices, so a supplier invoice shows the buyer's name, messenger, phone and contact | seen | Separate buyer and supplier on the invoice; the party block and the delivery board show the right party |
| 8 | Buyer relation blank on some invoices | seen | Party is mandatory |
| 9 | Delivery board: Accounts empty on every visible item, People empty on most | seen | **Fixed today.** Accounts = whoever generated the invoice; Person = the party's Messenger, or the same person when the party has none, so no delivery task is left without anyone |
| 10 | Delivery board: Buyer blank ("-") for supplier invoices | seen | The Buyer column shows the buyer or, for a supplier invoice, the supplier |
| 11 | Delivery items with no invoice link ("Commission Invoice- Invoice 101", "Invoice 15", "Invoice 16"), amount 0 on one ("Invoice 13") | seen | Tasks are created only from an invoice (linked by id); zero-value invoices are refused (**fixed today**); a delivery task can still be added by hand on the Tasks screen, without a link |
| 12 | Delivery item is named "Invoice N" while the invoice is renamed "CI - N" | seen | Both use the invoice number ("Deliver commission invoice N - party") |
| 13 | The board is near its column limit (56 of 75), so nothing more can be added | seen | No such limit |
| 14 | Sending is manual (e-mail button, WhatsApp status); replies are logged separately | seen | **Still open:** CRM+ does not send e-mail or WhatsApp (decided) |
| 15 | The lines of an invoice exist only inside the PDF; no cancel; the "created" tick can fail silently | docs / app code | Lines stored; cancel with a reason; lines saved with the invoice |
| 16 | Three numbers (Invoice No, Sr. No SR-n, CI Number) and a highest-plus-one number that can clash | docs / seen | One locked series |
| 17 | Mirrors broken or duplicated (duplicate titles, mirror of mirror shows 0) | docs | Plain joins, no copied columns |
| 18 | Payment Pending / Mode typed by hand | seen / docs | Receipts, validated, one ledger with the follow-up |

## 1. Invoice types and sub-types
| Topic | monday | CRM+ | Same? |
|---|---|---|---|
| Party type | Buyer or Supplier invoice. A dispatch row has one "Commission Invoice Created" tick per party, so it can be billed once as Buyer and once as Supplier | `party_type` buyer / supplier; one live invoice line per dispatch entry and party (database rule) | Same, stricter |
| Commission type | Percentage, BAG, KG. Comes from the party's Buyer/Supplier Commission Type + Value, mirrored on the dispatch row; the app can override with a manual type and value | Percentage, BAG, KG (`pct`, `per_bag`, `per_kg`). Comes from the party default, copied to the deal, the confirmation, the order and each dispatch entry; manual override works the same | Same |
| Old fixed commission codes (0.5%, 1%, Rs 1/kg...) | none | CRM+ only: older deals keep one fixed `commission_total` with no buyer/supplier split | **CRM+ gap**: orders made under the old codes cannot be billed per party in the register |
| Status | Generated, Sent, Pending (all 36 sit at Generated; nothing moves them) | Generated, Sent, Pending, Cancelled; Sent stamps the time; changed by action | Same, plus Cancelled |
| Payment | Mode of Payment (NEFT, UPI, RTGS, Cash, Cards), Partial Payment, Payment Pending = Net - Partial, typed by hand | the same fields, kept as one receipt per payment with date, reference and note; pending computed; over-payment refused | Same, stricter |
| Count on the invoice | one "Count" text (the first row's) | the count of every line | CRM+ better |
| Number | "Invoice No" = highest + 1 (two users can clash), "Sr. No" SR-n and "CI Number (Auto)" besides | one locked series (1, 2, 3...); cancelled numbers never reused; old per-order invoices keep `CINV-` | Differs on purpose |

## 2. Sub-items and lines
| Topic | monday | CRM+ |
|---|---|---|
| Where the lines come from | Dispatch and Billing **subitems** (each partial dispatch); a parent with subitems is billed through its Partially Dispatch subitems only, a parent without subitems through itself if Fully Dispatch | dispatch **entries** (`order_dispatches`) of an Open or Closed order; every entry is a line (CRM+ has no dispatch without an entry) |
| Fields taken from the sub-item | Invoice No., Invoice Date, Quantity Dispatched, Value, Total Weight, commission | the entry's invoice no., invoice date, quantity, value, weight, commission; a missing date falls back to the order's, then the mill invoice date, then the dispatch date |
| Fields inherited from the parent | Orders, Buyer, Supplier, Business Unit, Counts, commission terms | the order's buyer, supplier, Business Unit (company), count, commission terms |
| Cancel / Return | subitems with status Cancel / Return are skipped by the app | Cancel and Return entries (built upstream, `order_dispatch_adjustments`) are separate from the dispatch entries, so they are never offered for billing |
| The invoice's own sub-items | "Subitems of Commission Invoices" exists but holds only default columns and is unused; the lines exist **only in the PDF** | the lines are **stored** (`commission_invoice_lines`) with count, invoice no., date, quantity, rate and amount |
| Marking rows as billed | the app ticks the checkbox after creating the invoice; if that call fails, nothing is reported and the row can be billed again | the lines are saved in the same step as the invoice; a second live line for the same entry and party is impossible |
| Editing a dispatch after billing | nothing stops it, so invoice and dispatch can disagree | the database refuses to remove or change the quantity, invoice no. or invoice date of a billed entry ("cancel that invoice first") |
| Cancelling an invoice | no function: someone un-ticks the rows by hand | Cancel (reason required) frees the lines, cancels the delivery task, refuses if a payment exists |
| Party list | the Company list is loaded per Business Unit | the same: only parties with lines left to bill there, with the line count |

## 3. The other invoices around it
| Invoice | monday | CRM+ | Same? |
|---|---|---|---|
| Mill invoice (to the buyer) | `Invoice No.` on the dispatch parent / subitem; creating the dispatch item creates a **Mill Invoice Delivery** task; duplicate-invoice check | dispatch entry invoice no. and date; `dispatch_tasks` creates the Mill Invoice Delivery task; `is_duplicate` check | Same |
| Commission Invoice Delivery | created with each commission invoice ("CI - n"), person = creator; field staff add the acknowledgement and photo | one task per invoice (buyer or supplier), amount = net, assigned to the party's Messenger; acknowledgement and photo supported | Same (name and assignee differ) |
| Pending payment and Payment Collection | A-11: at 18:30 on the created date, if Pending Payment = Yes, notify and create a Payment Collection item "Commission Invoice - {name}" linked both ways | the same rule, tested for buyer and supplier invoices | Same |
| Transport Invoice (to the transport party) | its own board with its own app view and PDF: Kg/Bag rate, weights, total, payment collected/pending, links to Business Unit, Transporter Type Details, Sales Confirmation, Buyer, Sizing address; creating it creates a Transport Freight Invoice task | **no Transport Invoice register**: the transporter's bill is typed on the dispatch (number, date, amount), with Pending transporter invoices, Transporter payments and the freight task | **Missing** (planned D-09 to D-12) |
| Transporter Type Details (trip costing) | cost heads: diesel, bata, loading, unloading, tiffin, others, LNT, PC, total, difference | trip sheet with mileage, fuel cost and other cost only | **Partly missing** |
| Link between the invoices | the commission board does not reference mill or transport invoices; the PDF's "Invoice No." is the dispatch invoice number | same: the line carries the dispatch invoice no.; the order screen lists the commission invoices beside the dispatch, transport and payment entries | Same |

## 4. The process, step by step
| Step | monday | CRM+ |
|---|---|---|
| 1 Dispatch | a subitem is added (Partially Dispatch); quantity checked against the parent | a dispatch entry is added; quantity above the order is refused |
| 2 Choose what to bill | open the app view on the Commission Invoices board: Business Unit, party type, company, dates; rows are filtered by status, Business Unit, party, dates and the "created" tick | Commission Invoices > New: Business Unit, party type, party (only those with lines left), dates; the lines are listed and ticked |
| 3 Rates | commission per row from the party's terms, or one manual type + value | the same |
| 4 Totals | Total, Net = Total + Add - Deduct, Round Off and TDS typed (TDS is a dead field and saves 0) | the same; TDS and Round Off are stored and printed |
| 5 Create | an item is created on the Commission Invoices board (number from highest + 1), the PDF is attached in the background, rows are ticked afterwards | the database creates the invoice, number and lines in one step; the browser draws the PDF, stores it and downloads it |
| 6 Delivery task | automation creates "CI - n" | one task per invoice, linked to it |
| 7 Send | Status Generated, then Sent; "Send Email" button (invoice attached, to the buyer and contacts); WhatsApp template `commission_invoice` | Status can be set to Sent or Pending by hand; **no e-mail or WhatsApp sending** (decided) |
| 8 Deliver and acknowledge | Commission Invoice Delivery: photo, acknowledgement | the same task fields |
| 9 Chase payment | Pending Payment = Yes creates a Payment Collection item | the same |
| 10 Record payment | Partial Payment and Mode typed on the invoice | Record payment (several receipts, validated) |
| 11 Close the order | the commission step is an "invoice created" tick | no closing step any more (upstream: an item is finished when it is Fully Dispatch); the order panel lists the commission invoices made for it, and `order_commission_billed` tells whether every dispatch entry with commission is billed to each party |
| 12 Correct a mistake | edit the item by hand | cancel the invoice (lines freed), remove or fix the entry, re-issue |
| 13 Who may do it | any board member with access; no login on the app routes | `order.read` to see, `order.manage` to create, pay, change status or cancel |

## 5. What to take from it
1. **Same flow, safer in CRM+:** billing a line twice, number clashes, tick-after-create, billed rows edited, no way to cancel.
2. **CRM+ gaps to close if wanted:** e-mail / WhatsApp sending of the invoice; the Transport Invoice register and trip costing; a way to bill legacy orders that only carry an old fixed commission code (for example map `pct_1` and the like to a buyer commission basis, or bill their `commission_total`).
3. **monday columns not carried:** Person, Sr. No, CI Number, the buyer mirror columns, the unused invoice sub-items.
