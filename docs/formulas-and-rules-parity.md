# Formulas and rules of the monday reference against CRM+

Source of the list: `docs/monday-crm-reference.md` (the formula columns and the "Rules" / "Notes" lines) and the rule lines of `CRMMasterPlan.md`. Checked 2026-11-25 against the CRM+ migrations and code, and by running the database functions and the Counts name function on real numbers in a local copy of the database. monday itself was not accessed.

Verdict: **Same** = same result; **Same, stricter/extended** = same result for monday's cases, with a deliberate addition; **Differs** = deliberate difference; **Missing** = not built.

## A. Formulas
| # | monday board and formula | CRM+ implementation | Verdict |
|---|---|---|---|
| 1 | Dispatch and Billing, Sales Confirmation, Deals: Total Weight = Bags Weight x Quantity (subitem: x Quantity Dispatched) | `trade_total_weight` (database) and `totalWeight` (`src/lib/deals.ts`); used for `entry_value`, order, sales confirmation and deal. Test: 20 bags x 50 kg = 1000 | Same, extended: with no bag weight, KG uses the quantity and TONS x 1000 (monday gives 0) |
| 2 | Value = Total Weight x Final Rate | `entry_value`, `order_value`, `sc_value`, `deal_value`. Test: 1000 x 100 = 100,000 | Same |
| 3 | Buyer / Supplier Commission = IF Percentage: Value x v / 100; BAG: v x Quantity; KG: v x Total Weight; else 0 | `trade_commission` (pct, per_bag, per_kg). Tests: 1% of 100,000 = 1,000; BAG 2 x 20 = 40; KG 0.5 x 1000 = 500 | Same. With no commission type CRM+ returns blank, monday 0 |
| 4 | Total Amount = Value + Value x CGST/100 + Value x Insurance/100 + Add - Deduct | `trade_total_amount`. Test: 100,000 + 5% + 1% + 10 - 5 = 106,005 | Same |
| 5 | Sales Confirmation "Formula" = Quantity x Bag Weight (total kg) | `sales_confirmations.total_weight` (same function) | Same |
| 6 | Dispatch and Billing, Validation Errors / Record Validation: sum of subitem Quantity Dispatched must not exceed the parent Quantity | `order_exec_guard`. Test: adding 1 bag to a fully dispatched 60-bag order is refused ("Dispatch quantity exceeds the order: 60 already dispatched of 60") | Same, stricter: refused, not just flagged |
| 7 | Dispatch and Billing, Is Duplicate? (same Invoice No.) | `orders.is_duplicate` / `duplication_error`. Test: "Invoice No. DUP-1 is already on ORD-LOCAL-1" | Same |
| 8 | Counts, Summary (Fx) = `20S Vortex 40% Cotton 60% Polyester Blended Double Karded Compact BCI Cheese` | `count_master_set_display` (database, the authority) and `buildName` (screen). Both give exactly that string for the doc's example | Same |
| 9 | Counts, Overall Yarn Composition = Yarn1% + Yarn2% & "%"; Overall Yarn = IF Yarn1% < 100 "Blended" else Yarn 1 | `recipeState` and the stored composition/ratio. Test: 40/60 gives "100%" and Blended; 100% cotton gives "100%" and Cotton | Same |
| 10 | Counts, Is Duplicate / Duplicate Error | `recipe_key` trigger; the form and CSV import now refuse a second identical recipe | Same, stricter |
| 11 | Payment Collection, Balance Amount = Amount - Amount Collected | `board_payment_collection.balance_amount = amount - amount_collected` | Same |
| 12 | Payment Collection, Days Aging = DAYS(End Date, Start Date) | (End Date, or today while open) - Start Date | Differs: monday shows nothing until the end date; CRM+ counts open days |
| 13 | Sample Delivery, Feedback Due Date = Delivery Date + 7 days (text DD-MM-YYYY) | `delivery_date + 7` | Same (shown as a date) |
| 14 | Commission Invoices, Payment Pending = Net Amount - Partial Payment | `payment_pending = net_amount - paid_amount` (built this session, with every receipt kept) | Same |
| 15 | Transport Invoice, Total Weight = No. Of Bags x Bag Weight; Total Amount = IF Bag: Rate x Bags, IF Kg: Rate x Total Weight; Payment Pending = Total - Partial Payment | no Transport Invoice register yet | **Missing** |
| 16 | Transporter Type Details, Actual KM = Ending KM - Start KM | `order_trips.distance_km = mileage_end - mileage_start` | Same |
| 17 | Transporter Type Details, Cost Of Diesel = Consumed x POD | the trip stores `fuel_cost` directly (no price per unit) | **Differs** |
| 18 | Transporter Type Details, Total Cost = Diesel + Driver Bata + Loading + Unloading + Tiffen + Others + LNT + PC | `trip_cost = fuel_cost + other_cost` only (no bata, loading, unloading, tiffen, LNT, PC heads) | **Partly missing** |
| 19 | monday leftovers: Deals subitem Final Product Cost = Price; Sales Confirmation "test Formula"; Buyers & Suppliers "Name Formula" = name; Counts empty "Formula" | not needed (template, test or workaround columns) | Not applicable |

## B. Rules
| # | monday rule | CRM+ | Verdict |
|---|---|---|---|
| 1 | Deals: statuses New Deal, Manager Approval, Approved, Reconsider, Closed Lost; owner = creator | the same five statuses (New Deal shown as Draft), status guard | Same |
| 2 | Deals: Manager Approval notifies the manager ("Please review this deal"); Reconsider notifies the owner ("Revised deal") | `crm_automations` and the round-2 migration, logged in the Automation log | Same |
| 3 | Deals: Approved sets the approval date and creates a draft Sales Confirmation | `approved_at` / `approved_by` stamped; `confirm_deal` creates the confirmation | Same |
| 4 | Sales Confirmation: Draft, Send, Send with Delivery Info; a status change creates a Dispatch and Billing item | `create_dispatch_bill`, created automatically on send (commit 4485ce7) | Same |
| 5 | Sales Confirmation: Send buttons e-mail the confirmation with the bank details; Dispatch Information e-mail on Send with Delivery Info | send panel and the automation log (Done / Skipped with the reason) | Same in behaviour (opens the user's e-mail and WhatsApp; no stored attachment) |
| 6 | Dispatch and Billing: Partially Dispatch creates a subitem (dispatch entry) | `order_dispatches` entries | Same |
| 7 | Dispatch and Billing: Cancel and Return each create a reversing subitem | built upstream (20261125100000 / 20261125110000): Cancel and Return entries of the item; they are not billable on commission invoices, as in monday | Same |
| 8 | Dispatch and Billing: invoice item creation creates a Mill Invoice Delivery task; duplicate-invoice check | `dispatch_tasks` trigger; duplicate check (row 7 above) | Same |
| 9 | Tax maths: one CGST field and one Insurance field (no SGST/IGST) | `cgst_pct`, `insurance_pct` | Same |
| 10 | Business Units: Date = today on create (Name Copy workaround) | `record_date` default today; Name Copy not needed | Same |
| 11 | Numbering: Deal No "D-0NN", Confirmation No "S-0NN", commission invoice "Sr. No SR-", dispatch entry no auto | `DL-2026-0001`, `SC-2026-0001`, plain invoice numbers (1, 2, 3), dispatch entry numbers by sequence | **Differs** in format (all unique and automatic) |
| 12 | Commission invoice: one invoice per party and date range, lines from the dispatch subitems | Commission Invoices register (this session) | Same |
| 13 | Tasks boards (reminders, escalations, payment and cheque notifications, A-1 to A-28) | implemented and tested in the Tasks work (62 + checks) | Same (see `docs/monday-task-folder-analysis/`) |

## C. What is left to build to make the formulas fully the same
1. Transport Invoice register with Total Weight, Total Amount and Payment Pending (row 15).
2. Trip costing with price per unit and the cost heads (rows 17 and 18).
3. Decide whether the number formats (rule 11) should follow monday's.
