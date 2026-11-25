# Commission Invoice register (monday Commission Board app, rebuilt in CRM+)

Sources: the monday code app in `Downloads\Commision Board\Commision Board` (read only), monday's Commission Invoices board as documented in `docs/monday-crm-reference.md`, the CRM+ code and live schema (read-only queries). monday itself was only read.

## What it is
One **commission invoice** per Business Unit and **party** (Buyer or Supplier) for a **date range**, listing the dispatch lines billed. It replaces the old one-invoice-per-order record (kept as "old" rows). It is not the **Commission Invoice Delivery** task: that task is still created automatically, one per invoice, and follows the invoice number and net amount.

Screen: **Commission Invoices** (menu CRM > Commission Invoices, route `/commission-invoices`).
- Create: Business Unit, Party Type, party, Invoice From / To dates; the dispatch lines of that party that are not yet billed to that party are listed and ticked; optional manual Commission Type + Value (replaces each line's own commission, like monday); Add, Deduct, TDS, Round Off, Text, Remarks; Total, Net Amount, Total Bags and the amount in words update live.
- On Generate: the database checks everything again, numbers the invoice and saves the lines; the browser draws the "BROKERAGE BILL" PDF, stores it in the private `commission-invoices` bucket and downloads it.
- Register actions: Open (lines, totals and payments), **Edit details**, Download PDF (the stored copy, or drawn again), Record payment, Mark as sent, Mark as pending, Cancel invoice (reason required; frees the lines; its delivery task is cancelled; refused when payment is already recorded).
- Columns follow monday's board: Invoice No, Date, Party Type, Party, Business Unit, Invoice From/To, Commission, Total Bags, Total, Add, Deduct, TDS, Net Amount, Round Off, **Payment Collected, Payment Pending, Mode of Payment, Status**. Filters: party type, status, payment (nothing collected / part paid / fully paid), business unit.

## Status and payments (monday: Status, Mode of Payment, Partial Payment, Payment Pending)
- Status: Generated, then Sent (done, stamps the time) or Pending; Cancelled is final and has its own action. Changing between Generated, Sent and Pending needs `order.manage`.
- Payments: every receipt is kept (`commission_invoice_payments`: amount, date, mode, reference, note). **Payment Collected** = the sum, **Payment Pending** = Net Amount - Payment Collected (monday's formula), **Mode of Payment** = the mode of the latest receipt. Modes are monday's labels: NEFT, UPI, RTGS, Cash, Cards.
- Refused: a zero or negative amount, more than 2 decimals, a mode outside the list, a future date, an amount above what is pending, a payment on a cancelled invoice. A wrong receipt can be removed (the totals follow); an invoice with payments cannot be cancelled until they are removed.
- Old one-per-order invoices can be paid too (pending = their amount).
- **Payment Status** shows where the money stands: Unpaid, Part paid (for example 40 of 100) or Paid; the Payment filter uses the same three.
- **One ledger with the Payment Collection follow-up.** The delivery task can raise a Payment Collection follow-up (rule A-11, when its Pending Payment flag is Yes). The invoice and the follow-up are kept in step both ways, so nothing is entered twice:
  - a payment recorded **on the invoice** is copied to the open follow-up (the collector is notified and sees the balance fall);
  - a payment recorded **by the collector on the follow-up** becomes a receipt of the invoice (never more than what is pending: an over-payment stays on the task and the receipt's note says how much fitted);
  - a follow-up raised after part of the invoice was already paid starts with that amount collected;
  - when the invoice is **fully paid** the follow-up is done and the delivery task's pending flag is cleared; when the invoice is **cancelled** (only possible with no payments) the follow-up is cancelled too;
  - not copied: old per-order invoices (their follow-ups post buyer receipts to the order), cancelled invoices, and the removal of a receipt (a wrong receipt removed from the invoice does not undo the follow-up's line).
  Payment modes are monday's (NEFT, UPI, RTGS, Cash, Cards) plus **Online and Cheque**, so every mode of the follow-up task can be paired.

## Where the lines come from (monday subitems = CRM+ dispatch entries)
In monday the Commission Board app reads **Dispatch and Billing**: parent items (one per order and count) and their **subitems** (each partial dispatch). In CRM+ the same two levels exist: the **order** (the parent) and its **dispatch entries** (`order_dispatches`, the subitems; shown as "Dispatch entries" on the order). Every invoice line is one dispatch entry.
| monday | CRM+ |
|---|---|
| subitem (partial dispatch) | dispatch entry (`order_dispatches`) |
| subitem Quantity Dispatched | entry `quantity` |
| subitem Invoice No. / Invoice Date | entry `invoice_no` / `invoice_date` (typed on the dispatch form); when the entry has no number, its mill invoice no. is used |
| date missing on the subitem: inherits the parent's | entry date, else the order's `invoice_date`, else the mill invoice date, else the dispatch date |
| Buyer, Supplier, Business Unit, Counts, commission terms (inherited from the parent) | the order's buyer, supplier, company (Business Unit), count and commission terms |
| subitem Total Weight, Value, Buyer/Supplier Commission | entry `total_weight`, `entry_value`, `buyer_commission`, `supplier_commission` (worked out by the database for each entry) |
| "Buyer/Supplier Commission Invoice Created" tick on the subitem | the entry's invoice line (one live line per entry and party) |
| status Partially Dispatch / Fully Dispatch | the order is Open for Execution or Closed and the entry exists |
Differences:
- A parent without subitems is billed through its single dispatch entry (CRM+ has no entry-less dispatch, so this is not a gap).
- **Cancel / Return.** monday keeps them as subitems with the status Cancel or Return, and the commission app bills only Partially / Fully Dispatch rows. CRM+ now has the same (migrations 20261125100000 and 20261125110000: Cancel and Return entries of the item, kept in `order_dispatch_adjustments`). They are separate from the dispatch entries, so they are never offered on a commission invoice, as in monday; the dispatched entries stay billable. A wrong dispatch entry can still be removed while it is unbilled; **once it is on a live commission invoice the database refuses to remove it or to change its quantity, invoice no. or invoice date** ("cancel that invoice first"), and after the invoice is cancelled the entry can be removed and the cancelled invoice keeps its line as a snapshot. Commission already billed on goods that are later returned is corrected by cancelling and re-issuing the invoice, or with the invoice's Deduct amount.
- **Company list per Business Unit.** monday loads the Company dropdown per Business Unit. CRM+ does the same from the data: after you choose the Business Unit and party type, the party list holds only parties that still have dispatch lines to bill there, with the number of lines ("Local Mill (3 lines)").
- **No task left without someone, no empty invoices.** The delivery task's Accounts is whoever generated the invoice and its Person is the party's Messenger (the same person when the party has none); an invoice whose net amount is 0 is refused. The register shows who generated each invoice (Person).
- **Document No** (monday's text column) is captured on the create form and shown in the register and the invoice view.
- **Orders under the old fixed commission codes** (pct_0_5, pct_1, ...) carry one total with no buyer/supplier split, so the register cannot bill them per party. In the live data (checked 2026-11-25) all four such orders already have their old-style invoice, so nothing is waiting; a rule for which party pays would be needed before supporting new ones.
- Not captured: monday's Person (the creator is recorded instead), Sr. No / CI Number (CRM+ has one invoice number), the e-mail / WhatsApp fields, subitems on the invoice and the buyer mirror columns.

## Editing and exporting
- **Edit details** changes the free-text fields of a live invoice: Document No, Text (printed under the party's address) and Remarks. When the Text changes the stored PDF is drawn again. Amounts, dates, party and lines never change after generation: cancel the invoice and make a new one. Cancelled and old per-order invoices cannot be edited; it needs `order.manage`.
- **Export N as CSV** (toolbar) downloads the rows currently shown (after search and filters) with: invoice no., date, party type, party, business unit, from / to dates, commission type and value, total bags, total, add, deduct, TDS, net amount, round off, payment collected, payment pending, payment status, mode of payment, document no., person, status, text, remarks, cancel reason.

## Rules
- Commission per line: Percentage = line value x rate / 100; BAG = rate x quantity; KG = rate x total weight (database function `trade_commission`). The line's own commission is used unless a manual type and value are given. Each line is rounded to 2 decimals.
- Net Amount = Total + Add - Deduct (must not be negative). Round Off and TDS are stored and printed, not applied (as in monday).
- A dispatch line can be billed once per party while its invoice is live: unique index on `commission_invoice_lines (dispatch_id, party_type) where active`. The line of an order that has an old one-per-order invoice cannot be billed again.
- Eligible lines: dispatch entries of orders of the chosen Business Unit (status Open for Execution or Closed) whose buyer (or supplier) is the chosen party and whose invoice date (entry, else the order's, else the mill invoice date, else the dispatch date) is within the dates.
- Number: one global plain series (1, 2, 3 ...), allocated under a row lock so two people can never get the same number; a cancelled number is never reused. Old invoices keep `CINV-yyyy-nnnn`.
- Orders no longer close by themselves (Dispatch and Billing migration 20261125120000: an item is finished when it is Fully Dispatch). The order panel's Commission invoice card lists the invoices made for the item, and the database function `order_commission_billed` says whether every dispatch entry with commission has been billed to each party (or an old invoice exists); `order_close_status` still reports it as `invoice_done`.
- Pending commission bills and the Billing dashboard tile now count dispatched commission that is not yet on an invoice.

## Differences from monday (on purpose)
| monday app | CRM+ |
|---|---|
| number = highest + 1, can clash | locked counter, no clash |
| "invoice created" tick set after the invoice, failure ignored | the lines are saved with the invoice in one step; a second invoice for a line is refused by the database |
| party and Business Unit matched by text (substring) | matched by id |
| amounts computed in the browser | recomputed on the server |
| only the first 25 business units, whole Dispatch board loaded | normal queries |
| PDF border only on the last page, TDS box did nothing | border on every page, header repeated, TDS stored |
| no authentication on the app routes | existing CRM+ permissions: `order.read` to see, `order.manage` to create/cancel |

## Not included (open)
- e-mail / WhatsApp sending and monday's Person, Sr. No, Document No and subitem columns (decided: PDF stored and downloadable only).
- GST: monday has none on commission invoices.
- The old per-order screen button and bill print: "Generate commission invoice" is gone from the order screen (the database function now refuses); old bills can still be printed.
- Starting number: the counter starts at 0, so the first invoice is 1. To continue monday's series run once, with monday's last number: `update public.commission_invoice_counter set last_no = <last number> where id = 1;`

## Apply
0. Run the Dispatch and Billing migrations first (they are older in the folder, so the normal order does it): `20261125100000` and `20261125110000`. The commission script comes after them on purpose: those two redefine `order_close_status` and `billing_dispatch_dashboard`, and the commission script puts its invoice rules back into them.
1. Back up, then run `supabase/migrations/20261125170000_commission_invoice_register.sql` in the SQL editor (re-runnable, deletes nothing).
2. Deploy the app.
3. Optional: set the starting number (above).

## Tests
`supabase/tests/local-harness/commission-invoice.mjs` (in-memory PostgreSQL, stand-in tables shaped like the live schema): 112 checks pass: numbering, eligibility, double billing refused, override rate, totals, delivery task for buyer and supplier, cancel (and freeing the lines), order-close picture, pending list, payments (part and full, every refusal, delete, last mode, old invoices), status changes, permissions, row-level security, migration re-run. Run: `cd supabase/tests/local-harness && node commission-invoice.mjs`.

Also tried in the browser against a local Docker copy of the schema (all 42 migrations loaded): create (buyer and supplier), stored PDF, record payment (with the validation messages), mark as sent, open, remove payment, cancel.

Not tested: the PDF layout against monday's bill (the text content was checked, the rendering was not seen), the migration on the real production database, live monday data.
