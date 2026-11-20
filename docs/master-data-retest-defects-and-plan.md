# Master Data retest: every error, which are valid, and the plan

Source: `Test Cases - Master Data incl. BU Retest (Scenario-wise).xlsx` (tester Kamaljeet Verma, 2026-11-19, https://commission-desk.vercel.app). 50 test cases: 32 Pass, **16 Fail, 1 Blocked, 1 N/A**. Every failing and blocked case was read (steps, observation, comment) and checked against the current source code and the live database (read-only queries, 2026-11-20).

Important: the sheet was run on the build deployed on 19 November. Some failures may already be fixed in the current code; each item says so where the code shows it.

## 1. All the errors in the sheet

| # | Case | Module | What the tester reports |
|---|---|---|---|
| 1 | BU-RT12 | Business Units | Old buyer/test records (Lead 2, Test 2, test lead) still listed |
| 2 | BU-RT14 | Business Units | No Active/Inactive control, but the list has a Status filter and an Inactive badge |
| 3 | BS-01 | Buyers & Suppliers | List has 62 columns, including deprecated fields (Short Name, Messenger...); Lead 2 shows "Incomplete" |
| 4 | BS-02 | Buyers & Suppliers | Form: Location MDM, Category, Messenger still present; label "IT Pan"; Contact Person 3 still present; no Bank fields; Counts single select; Type has no "Both" |
| 5 | BS-08 | Buyers & Suppliers | Invalid PAN, PAN not matching GST, and the same PAN with another state's GST all save without a message |
| 6 | BS-09 | Buyers & Suppliers | Role = Both shows nothing; Lead 2 exists as two separate records |
| 7 | CT-01 | Counts | Name is typed by hand (expected generated); field order differs from the spec |
| 8 | CT-06 | Counts | A second identical recipe saves (flagged "Duplicate of item ..."); tester asks whether blocking is required |
| 9 | TR-02 | Transport Company | PAN labelled "IT PAN" |
| 10 | TR-03 | Transport Company | Blocked: Locations empty, dropdown says "Nothing more to add", so no transporter can be created |
| 11 | TR-04 | Transport Company | Business Unit dropdown lists Lead 2, Test 2, test lead and duplicate Shirram entries |
| 12 | TR-06 | Transport Company | Duplicate GST saves (two transporters share one GST) |
| 13 | TR-07 | Transport Company | A Type filter (Third party / Internal) has no field on the form; old record "test tp" has blank mandatory data |
| 14 | LO-01 | Locations | Buyers & Suppliers dropdown lists Lead 2 twice (Buyer and Supplier) |
| 15 | LO-04 | Locations | No Active/Inactive control, though a Status filter exists |
| 16 | SZ-03 | Sizing / Delivery Address | Wording says "job process" (count, button, empty text) |
| 17 | PT-03 | Payment Terms | Junk record "HK" (11 days) in the list |
| 18 | BU-RT13 | Business Units | N/A (Currency and Home company were removed from the form) |

## 2. Which are valid, and why

Legend: **Bug** = the application is wrong. **Data** = rows left in the database. **Story** = the sheet's requirement differs from what was built; the build followed monday.com exactly (your earlier instruction), so the requirement must be confirmed. **UX** = works as designed, wording or guidance can be better.

| # | Verdict | Evidence found |
|---|---|---|
| 1 BU-RT12 | **Data (valid)** | `companies` holds 13 rows and every one is a test row: Lead 2, Test 2, test lead (created by lead qualification before the teammate's fix 20261120130000, which now makes qualification pick a Business Unit instead of creating one), and QA Currency Co, QA Duplicate PAN Co, QA KM Muri, QA KM Sri Dharmi, QA Prefix Co, QA RT GST, QA RT Phone, three "QA Shirram Agencies" copies. Buyers and suppliers point at some of them (`company_id`) |
| 2 BU-RT14, 15 LO-04 | **Bug / gap (valid)** | The "Active toggle" was removed from the edit forms on request, but the lists still filter by Status and show an Inactive badge, and `is_active` still exists: nothing can set it. The same on Locations (and any register with the Status filter) |
| 3 BS-01 | **Story + Data** | `Contacts.tsx` defines 62 columns; a column picker hides the ones not needed and remembers the choice. The columns exist because monday's board has them. "Incomplete" on Lead 2 is data (it has no PAN or contact) |
| 4a BS-02 Location MDM / Category / Messenger | **Story** | monday's Buyers & Suppliers form has all three (verified); the sheet's requirement says they are deprecated |
| 4b "IT Pan" | **Valid, done** | label renamed to "PAN" (section 4) |
| 4c Contact Person 3 | **Story** | monday has three contact persons; the sheet says two |
| 4d Bank fields | **Valid per the sheet, conflicts with monday** | monday's form has "Account Details (IT Pan)" only; the database has `bank_account_1/2` and an older field component (`PartyForms.tsx`) still defines them, but neither the monday-aligned create form nor the edit sections show them |
| 4e Counts single select | **Probably already fixed** | the current create form uses a multi-select picker for Counts (`LinkPicker`); retest on the current build |
| 4f Type has no "Both" | **Valid** | the list/edit screen supports Role Both (one record on each side sharing a PAN), but the create form offers Buyer and Supplier only |
| 5 BS-08 | **Bug (valid)** | `BuyerSupplierForm.tsx` only checks the PAN is 10 characters; Business Units use `isPan` and `panMatchesGst`, Buyers & Suppliers do not. Three QA rows with bad data are saved (QA RT Bad PAN `12345ABCDE`, QA RT PAN Mismatch, QA RT Same PAN Kerala) |
| 6 BS-09 | **Partly valid** | Role = Both is empty because no party shares a PAN: correct for the data. Lead 2 as two records is legacy data: a buyer without PAN (15 Oct) and a supplier with PAN `DDKKS3353L` (9 Oct), so they are not recognised as one. The valid part is 4f (no way to create "Both") |
| 7 CT-01 | **Story** | monday's Counts form has a typed Name with an auto-built Summary; the sheet wants the Name generated. The summary already matches the spec formula (tester passed it). Field order: the sheet does not give the expected order |
| 8 CT-06 | **Decision (valid question)** | monday flags duplicates (Is Duplicate / error text) and CRM+ copies that. The sheet's requirement says "should not create a second count" |
| 9 TR-02 | **Valid, done** | renamed to "PAN" |
| 10 TR-03 | **UX (by design)** | Locations is mandatory for a transporter; the message "Nothing more to add" does not say what to do |
| 11 TR-04 | **Data + small bug** | same test companies as item 1; the dropdown lists every company including inactive and test ones |
| 12 TR-06 | **Bug (valid)** | duplicate name is blocked, duplicate GST is not; the live data has two transporters with GST `33AAACQ5678R1Z9` |
| 13 TR-07 | **Bug (valid)** | the table has `transporter_type` (internal / third_party, default third_party) and the grid has a Type filter, but the form has no Type field. "test tp" (internal, no GST, PAN, vehicle) is a leftover |
| 14 LO-01 | **Data (valid)** | the Lead 2 buyer and supplier are two records; the picker already labels each "(Buyer)" / "(Supplier)" |
| 16 SZ-03 | **Bug (valid, trivial)** | `JobProcesses.tsx` still says "job process / job processes" in the count, button and empty text |
| 17 PT-03 | **Data (valid)** | payment term "HK" (11 days) exists, with "QA RT 90 DAYS PDC" (75) |
| 18 | N/A | fine |

Totals: 8 definite fixes in code (PAN validation, duplicate GST, Type filter/field, Active/Inactive control, wording, "Both" on create, empty-state message, dropdown scope), 6 data clean-ups, 5 items that need your decision because the sheet's requirement and monday disagree (list columns, Location MDM/Category/Messenger, Contact Person 3, Bank fields, Counts Name).

## 3. Solutions

| Item | Solution | Size |
|---|---|---|
| 5 BS-08 | In the create form and the edit drawer: PAN must match `AAAAA9999A` (`isPan`), PAN must match the GST (`panMatchesGst`), and a PAN already used by another party shows a warning ("this PAN belongs to {name}: use Role Both for the same party"). Database: NOT VALID check constraints on `buyer_master` and `supplier_master` (format and PAN-inside-GST), like `companies_fmt_chk`, so imports cannot bypass the screen | M |
| 12 TR-06 | Screen rule (normalised GST, same as the duplicate-name rule) and a partial unique index on `upper(gst)` where `gst is not null`, created after the QA duplicate is cleaned | S |
| 13 TR-07 | Recommended: remove the Type filter (monday's Transport Company has no Type); keep the column for existing rows. Alternative: add a Type field to the form | S |
| 2, 15 Active/Inactive | Add "Mark inactive" / "Mark active" to the Actions menu of Business Units, Locations, Transport, Sizing / Delivery Address and Buyers & Suppliers (confirm dialog, audit trail), and keep the Status filter and badge. Alternative: remove the Status filter and badge (monday has no Active/Inactive). Pickers already hide inactive records | M |
| 4f "Both" on create | Add "Both" to the create form's Type: it creates the buyer and the supplier record together, sharing the PAN, as the edit screen already does | M |
| 16 SZ-03 | Replace "job process" by "sizing / delivery address" in the count, button, empty text and messages | XS |
| 10 TR-03 | When Locations is empty: "No locations yet. Add a Location in Master data > Locations, then come back" with a link | XS |
| 11 TR-04 | Business Unit dropdowns list active business units only, sorted by name | XS |
| 8 CT-06 | Recommended: **block** a second identical recipe with a clear message naming the existing count (a unique recipe key in the database and a screen check), and keep flagging for old rows. Alternative: keep monday's flag-and-save | S |
| 7 CT-01 | Recommended: Name = the generated Summary, read-only (or hidden), regenerated when the recipe changes. Needs the expected field order from the story | S |
| 3 BS-01 | After the decision on 4a-4d, set the default visible columns to the story's list; the other columns stay in the column picker | S |
| 4a, 4c, 4d | After the decision: remove Location MDM, Category, Messenger and Contact Person 3 from the form (the columns remain in the database), and add Bank Account 1 and 2 to Account Details | S |
| 1, 11, 14, 17, 12, 13, 5, 6 (data) | Clean-up script (section 5) | S |

## 4. The "IT Pan" rename (done in code)

Change: the label is now **PAN** everywhere it said "IT Pan" or "IT PAN": the Buyers & Suppliers create form, its error message, the edit form (`PartyForms.tsx`), the Buyers & Suppliers grid column (`Contacts.tsx`) and the Transport Company form, table header, placeholder and required message (`Transporters.tsx`). The two MDM documents were updated too. No database change and no CSV change (columns are keyed by `pan`, not by the title). Typecheck and build pass; not deployed.

Two notes:
1. The sheet (BS-02 step 6, TR-02 step 6) expects "PAN Number", which is what Business Units use. You asked for "PAN only", so I used PAN. If you want one wording everywhere, say which; it is a one-line change per place.
2. monday's own column is still called "IT Pan"; this is now a deliberate difference.

Retest: open Buyers & Suppliers (create form, edit drawer, grid header), Transport Company (form, table header, empty PAN message) and confirm the new wording.

## 5. Data clean-up plan (nothing has been deleted)

All the data in these registers is test data (the live database has no real business unit). Proposed script, to be reviewed and run by you on the database after a backup, in this order:
1. Buyers and suppliers that reference test business units, plus the other test parties: Lead 2 (buyer and supplier), test (buyer and supplier), test lead, Test 2, QA RT Buyer Mills, QA RT Bad PAN, QA RT PAN Mismatch, QA RT Same PAN Kerala. First list what references them (leads, deals, tasks) so nothing real is orphaned.
2. Test business units: Lead 2, Test 2, test lead, QA Currency Co, QA Duplicate PAN Co, QA KM Muri, QA KM Sri Dharmi, QA Prefix Co, QA RT GST, QA RT Phone, three QA Shirram Agencies.
3. Transporters: QA RT Transport Two (duplicate GST), test tp; keep or remove QA RT Transport.
4. Payment terms: HK, QA RT 90 DAYS PDC. Counts: QA RT Viscose Linen, QA RT Dup Recipe. Locations and Sizing: QA RT Tiruppur, QA RT Sizing Unit.
The earlier script `supabase/manual/20261118_business_unit_test_data_cleanup.sql` is the model.

## 6. Order of work

| Phase | Work | Needs |
|---|---|---|
| 0 | Your decisions: (a) Active/Inactive: add the Actions item or remove the filter; (b) Counts duplicates: block or flag; (c) Counts Name: auto-generated from the Summary?; (d) Location MDM / Category / Messenger / Contact Person 3 / list columns: follow the sheet or monday; (e) Bank fields on the form: yes or no; (f) wording "PAN" or "PAN Number" | you |
| 1 | Quick fixes: SZ-03 wording, TR-03 message, Business Unit dropdown scope, Type filter | none |
| 2 | Validation: Buyers & Suppliers PAN rules and constraints; Transport duplicate GST and unique index | clean-up of the QA rows first |
| 3 | Active/Inactive control on the five registers | decision (a) |
| 4 | "Both" on the Buyers & Suppliers create form | none |
| 5 | Form and list changes from decisions (d), (e); Counts decisions (b), (c) | decisions |
| 6 | Data clean-up script | your review, a backup |
| 7 | Retest | below |

## 7. Retest plan

Re-run these sheet cases after each phase: Phase 1: SZ-03, TR-03, TR-04, TR-07; Phase 2: BS-08, BS-05, TR-06, TR-05; Phase 3: BU-RT14, LO-04; Phase 4: BS-02 (step 9), BS-09; Phase 5: BS-01, BS-02, CT-01, CT-06; Phase 6: BU-RT12, LO-01, PT-03, BS-09. Add to the sheet: PAN wording on both screens; a second transporter with the same GST (blocked); a bad PAN on a buyer (blocked with a message); marking a business unit inactive and seeing it leave the pickers; Role = Both with a party created as Both. Regression: the 32 cases that passed.

## 7. What was fixed (2026-11-20)

| Case | Fix | State |
|---|---|---|
| BU-RT12, BS-09 (Lead 2 twice), LO-01, PT-03, TR-07 "test tp" | test records: clean-up script `supabase/manual/20261120_master_data_qa_cleanup_safe.sql` (deletes only unused test rows, marks the used ones inactive, changes nothing else) | **script written, to be run by you** |
| BU-RT14, LO-04 | "Mark inactive" / "Mark active" in the Actions menu of Business Units, Buyers & Suppliers, Transport Company, Locations, Sizing / Delivery Address (`src/lib/active.ts`); the Status filter stays | done in code |
| BS-01 | deprecated columns (Contact Person 3 name/phone/email, Location MDM, Category, Short name, Messenger) hidden by default; users can still switch them on | done in code |
| BS-02 | Location MDM, Category, Messenger and Contact Person 3 removed from the form; Bank Account Details 1 and 2 added; Type has "Both" on create (one buyer and one supplier sharing the PAN, rolled back if the second insert fails); label "PAN" | done in code |
| BS-08 | PAN format and PAN-matches-GST checks on create, edit and in the grid | done in code (no database constraint, to protect the CRM lead-qualification function) |
| CT-01 | Name is generated from the recipe and read-only | done in code |
| CT-06 | a second identical recipe is refused on the screen and in CSV import | done in code |
| TR-02, TR-06 | label "PAN"; duplicate GST refused on the screen | done in code (no unique index yet: the QA duplicate must be cleaned first) |
| TR-03 | empty Locations list says why instead of "Nothing more to add" | done in code |
| TR-04 | Business Unit filter lists active units only | done in code |
| TR-07 | Transport Type filter removed (there is no such form field) | done in code |
| SZ-03 | "job process" wording replaced by "sizing / delivery address" | done in code |

Not changed: the field order of the Counts form (the sheet does not say what it expected); monday still calls the column "IT Pan". Not browser-tested: run the retest in section 4 after deploy.

## 8. Database hardening script (2026-11-20)

`supabase/manual/20261120_master_data_db_hardening.sql`: one re-runnable script for what the data cleanup left. It repairs the four buyer/supplier rows whose PAN disagreed with their GST (PAN = characters 3 to 12 of the GSTIN), adds the PAN format and PAN-matches-GST rules on buyers, suppliers and transporters, adds the unique GST index on transporters, hides the business units "Lead 2" and "test lead" (test placeholders for the three required fields) and the QA buyer "QA GST PAN Mismatch". A rule that existing rows still break stays active for new rows and is reported. Tested on a throwaway database: second run changes nothing; bad PAN, PAN/GST mismatch and a duplicate transporter GST are refused; lead-qualification-style inserts (PAN from the GST) pass.
