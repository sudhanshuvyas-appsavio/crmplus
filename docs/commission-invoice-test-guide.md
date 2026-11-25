# Commission Invoice register: step-by-step test guide

## What is implemented
| Area | What it does |
|---|---|
| Register page | CRM > **Commission Invoices** (`/commission-invoices`): one row per invoice, monday's columns, search, filters (party type, status, payment, business unit), paging |
| Create | One invoice per Business Unit and party (Buyer or Supplier) for a date range; dispatch lines listed and ticked; optional manual commission type + value; Add, Deduct, TDS, Round Off, Text, Remarks; live Total, Net, Total Bags, amount in words |
| Rules (database) | amounts worked out on the server; a dispatch line can be billed once per party; plain invoice number series with no clashes; old per-order invoices kept as "Old" |
| PDF | "BROKERAGE BILL", drawn in the browser, stored in the private `commission-invoices` bucket, downloadable again |
| Status | Generated, Sent, Pending; Cancelled is final |
| Payments | Record payment (amount, mode NEFT/UPI/RTGS/Cash/Cards, date, reference, note); Payment Collected, Payment Pending, Mode of Payment; remove a wrong receipt |
| Cancel | reason required; frees the lines; cancels the delivery task; refused if payments exist |
| Links | a Commission Invoice Delivery task per invoice (buyer or supplier); Payment Collection follow-up from the delivery task; Pending commission bills follow the lines |

## A. Test on your own computer (nothing touches production)
Already set up in this session (Docker + local Supabase + the app). If it is not running, start it:

1. Docker Desktop must be running.
2. Start the database stack: in PowerShell `cd C:\tmp\crm-local` then `npx supabase start -x studio,imgproxy,realtime,edge-runtime,logflare,vector,mailpit,postgres-meta,supavisor`
3. Start the app against it (one PowerShell window, from `C:\crmplus\crmplus`):
```powershell
$env:VITE_SUPABASE_URL="http://127.0.0.1:45321"
$env:VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
npx vite --port 5199 --strictPort
```
   (That key is the public demo key of the local stack, not a secret. Your `.env` still points at production; these two lines override it for this window only.)
4. Open http://localhost:5199, sign in with `admin@local.test` / `Admin#12345`.
5. Stop later: Ctrl+C in the app window, and `npx supabase stop` in `C:\tmp\crm-local`.

Sample data in the local copy: Business Unit "Kaarthika Commission Agencies"; buyers "Local Buyer" (order ORD-LOCAL-1: dispatch entries (monday's subitems) with Invoice No. MI-101 20 bags 10 Nov and MI-102 40 bags 15 Nov, 1% from buyer, Rs 2/bag from supplier) and "Second Buyer" (ORD-LOCAL-2: MI-201 10 bags 12 Nov); mill "Local Mill".

## B. The test script (do in this order)
**1. Menu and empty/old state.** Open CRM > Commission Invoices. Expect the page, the columns (Invoice No ... Round Off, Payment Collected, Payment Pending, Mode of Payment, Status, Actions) and the **New commission invoice** button.

**2. Buyer invoice.** Click New commission invoice.
- Business Unit: Kaarthika Commission Agencies; Party Type: Buyer; Buyer: Local Buyer; Invoice From 2026-11-01, To 2026-11-30.
- Expect two lines (MI-101, MI-102), both ticked, commission 1% each, Total 3,000.00, Total Bags 60, and "Three Thousand Rupees Only". "Second Buyer"'s line must NOT appear.
- Untick one line: the total drops. Tick it again.
- Enter Add 10, Deduct 5, TDS 30, Round Off 0.5, Text "Kind Attn: Accounts". Expect Net 3,005.00.
- Click **Generate invoice**. Expect "Invoice N created and its PDF saved." and a PDF download.

**3. Open the PDF.** Check: business unit name, PAN, address, phone, fax, email at the top; BROKERAGE BILL; INVOICE NO and date; "To," + buyer name and address + your Text; "Being Commission for the goods despatched from 01/11/2026 to 30/11/2026 @ 1%"; table SNo / Mill / Count / Invoice No. / Invoice Date / Quantity / Amount with a Total row; "Net Amount : ... Only"; Round Off; the five terms; Bank Details; Prepared by / Checked by / For {business unit}. Compare with a bill from monday.

**3b. Party list per Business Unit.** After choosing the Business Unit and Party Type, open the Buyer list: only parties that still have dispatch lines to bill appear, each with its line count (for example "Second Buyer (1 line)"). A party whose lines are all billed is not offered.

**3c. Document No.** Fill the Document No field on the create form; it appears as a column in the register and in the opened invoice.

**3d. Billed entries are protected.** On the order (CRM > Dispatch and Billing > open the order), try Remove on a dispatch entry that is on a live invoice: it is refused with "This dispatch entry is billed on commission invoice N. Cancel that invoice first". Cancel the invoice, then Remove works.

**4. Double billing.** Click New commission invoice again with the same buyer and dates. Expect "Nothing to bill" (both lines are taken). Choose "Second Buyer": expect its one line.

**5. Manual rate.** New invoice for Second Buyer, Commission Type "KG", Value 2: the Amount for the line changes (2 x its weight). Do not generate unless you want it.

**6. Supplier invoice.** Party Type Supplier, Local Mill, same dates. Expect the column to be called **Buyer**, the buyer names listed, "Rs. 2/bag" amounts, and the mill's address. Generate. Check the PDF says "Buyer" in the table header and "@ Rs. 2/Bags".

**7. Record payment.** In the register, Actions > **Record payment** on an invoice.
- The amount is pre-filled with the pending amount. Try an amount above it: expect "More than the ... pending". Leave Mode empty: expect "Choose the mode of payment".
- Enter a part amount, mode UPI, a reference, Record. Expect the banner, Payment Collected = amount, Payment Pending = rest, Mode of Payment = UPI.
- Record the rest with NEFT: pending 0, mode NEFT; Record payment is greyed out ("Fully paid").
- Filter Payment > "Fully paid" / "Part paid" / "Nothing collected" and check the rows.

**7b. Part payment, for example 40 of 100.** Make an invoice of 100, Record payment 40 (UPI): Payment Collected 40, Payment Pending 60, Payment Status **Part paid**. Try 70: refused ("more than the amount pending"). Record the remaining 60: Payment Pending 0, Payment Status **Paid**.

**7c. Follow-up closes.** On a delivery task set Pending Payment = Yes and let the rule raise its Payment Collection follow-up (Tasks > Payment Collection). A part payment on the invoice leaves the follow-up open; the payment that completes the invoice marks the follow-up Done and clears the flag. Cancelling an invoice (with no payments) cancels its follow-up.

**7d. One ledger.** With a follow-up open (7c): record 300 Cash on the follow-up task (Tasks > Payment Collection): the invoice gets a receipt of 300 and shows 300 collected. Then Record payment 200 UPI on the invoice: the follow-up gets a line of 200 (note "Recorded on commission invoice N") and shows 500 collected. Record more on the follow-up than is pending on the invoice: only what fits is added to the invoice (its note says so) and the invoice becomes Paid.

**8. Status.** Actions > **Mark as sent**: status chip Sent. Actions > **Mark as pending**: chip Pending. Open the invoice: Status shows "Sent on <date>" after marking sent.

**9. Open and remove a payment.** Actions > Open. The Payments section lists the receipts. Click **Remove** on one: collected and pending update.

**10. Cancel.** Actions > Cancel invoice. Try with an invoice that has payments: expect a refusal. Remove the payments first (step 9), then cancel with a reason. Expect: status Cancelled, the lines available again in New commission invoice, invoice number not reused (the next invoice gets a new number).

**11. Download PDF.** Actions > Download PDF on a generated invoice: the stored copy opens.

**12. Links.** Tasks > **Commission Invoice Delivery**: one task per invoice ("Deliver commission invoice N - party"), with invoice number, amount (= net) and date; a cancelled invoice's task is Cancelled. For a supplier invoice the Buyer column shows the mill.

**13. Order screen.** CRM > Dispatch and Billing > open an order: the "Commission invoice" card lists the invoice numbers made for it (buyer and supplier) and links to Commission Invoices; there is no "Generate commission invoice" button any more.

**14. Reports.** Billing & dispatch dashboard and Pending commission bills show dispatched commission that is not on an invoice yet.

## C. The automatic tests (no browser)
```powershell
cd C:\crmplus\crmplus\supabase\tests\local-harness
node commission-invoice.mjs
```
Expect `107 passed, 0 failed`. Also `cd C:\crmplus\crmplus; npx tsc -b; npm run build`.

## D. Test on production (after you apply the migration)
1. Back up the database.
2. Run `supabase/migrations/20261125170000_commission_invoice_register.sql` in the Supabase SQL editor (re-runnable). Check: `select to_regclass('public.commission_invoice_lines'), to_regclass('public.commission_invoice_payments');` both not null.
3. Optional, to continue monday's numbering: `update public.commission_invoice_counter set last_no = <last monday number> where id = 1;`
4. Deploy the app, open Commission Invoices: the 3 old per-order invoices show as "Old, per order".
5. Production dispatch lines have no commission terms yet, so the create form may show nothing to bill. Open an order, give it commission terms, add a dispatch entry, then repeat steps 2 to 12 above with that order's Business Unit and party.
6. Make one real invoice first, compare it with the same lines in monday (totals, net, amount in words, layout), then cancel it if it was only a test.

## E. If something looks wrong
- "Could not find the function ... in the schema cache": the migration is not applied, or run `notify pgrst, 'reload schema';`.
- No "New commission invoice" button or no menu: the user lacks `order.manage` / `order.read`.
- "Nothing to bill": the lines are on a live invoice, outside the dates, belong to another party or Business Unit, or the order is not Open for Execution / Closed.
