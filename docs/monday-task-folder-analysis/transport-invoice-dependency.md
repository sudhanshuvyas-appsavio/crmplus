# Transport Invoice dependency (F-24)

## What exists
- **CRM+ has no Transport Invoice entity.** Searches of `src/` and `supabase/migrations/` find only: `order_dispatches.transporter_invoice_no` / `transporter_invoice_amount` (the dispatch row's transport bill), `transporters` (Transport Company master data), `order_transports`, `BillingDashboard.tsx` and `OfficeActivity.tsx` (read the dispatch columns). The freight task is created from the dispatch row by `dispatch_tasks()` (dedupe key `freight:<dispatch id>`).
- `CRMMasterPlan.md` Part 1 group D ("Billing documents": Commission Invoices, Transport Invoice, Transporter Type Details) plans the register; section 6.2 describes it; it is not built.

## What monday has (from `docs/monday-crm-reference.md`, verified earlier)
Transport Invoice (board 5027015093, 20 rows): Name, Person, Date, Business Units (relation) + 4 mirrors, Transport Invoice No., Transporter Type Details (relation) + 11 trip mirrors, Bag Weight, Total Weight (formula), Mill Bill No., Lr. No./Date, Type (Kg/Bag), Rate, Total Amount (formula), Mode of Payment, Payment Collected, Payment Pending (formula), Document No, Remarks, Sales Confirmation (relation) + 3 mirrors, WhatsApp/e-mail fields, Document, link to Transport Freight Invoice (two-way), From alt., Buyer/to, Sizing/Delivery Address. Known defects: Total shows 0 (mirror of mirror), link to Transporter Type Details empty on all rows.

## What the freight workflow needs from it
| Need | Source in monday | Today in CRM+ |
|---|---|---|
| Create one freight task per Transport Invoice | Transport Invoice automation "item created -> create `<name> - Transport Task`, link both ways" | created from the dispatch's transporter invoice number |
| Buyer on the freight row | mirror `lookup_mm1k6dqe` (**broken** in monday) | buyer from the order |
| Bill number, amount | typed on the freight task | `bill_no`, `amount`, defaulted from the dispatch |
| Two-way link | `board_relation_mm1mepmm` | none (dispatch id only) |

## Not defined (so not invented)
Freight validation rules (what "Check = Outstanding" requires), behaviour when a Transport Invoice is missing, and how invoice details synchronise are **not specified anywhere** in monday (the freight board's only rule is the Outstanding notification) or in the master plan.

## Decision
**Deferred.** The current dispatch-based creation keeps working. When the Transport Invoice register is built (master plan group D), add `tasks.transport_invoice_id` (FK), move the creation trigger to that table, keep the dispatch trigger as fallback until then, and derive the buyer from the invoice (not copy monday's broken mirror).
