# MDM Plan: Master Data Management for Commission Desk

> **Superseded in part.** This plan was written from the browser UI before the monday connector was available. Some monday facts below are wrong (Buyers & Suppliers has 45 items and about 72 columns; "Private/Deleted" no longer exists; Counts workflows copy a formula, not the name; Location MDM and Transport Company are much richer). See [CRMMasterPlan.md](CRMMasterPlan.md), section 3 and section 13, for the corrected facts and the plan for the whole CRM.

**Goal:** make the Commission Desk web app (Vite + React + Supabase) the single place where master data is created, validated and maintained, replacing the **MDM** folder of boards in monday.com (workspace "CRM", folder "MDM").

**Sources used**
- monday.com MDM folder, read 17 Nov 2026 (read-only): Business Units, Buyers & Suppliers, Counts, Transport Company, Location MDM, Sizing/Delivery Address, Payment Terms.
- This repository: `src/`, `supabase/migrations/`, `supabase/schema/public.sql`.

**Not read / limits** (see section 12): the three CRM boards (Deals, Sales Confirmation, Dispatch and Billing), the Tasks boards, board forms' individual questions, board "Reports" views, and any monday data not visible to the signed-in account. Column lists come from the board UI, so hidden columns could be missing. Party data below is described by pattern only; no real names, GSTINs or phone numbers are copied here.

---

## 1. What the MDM is today (monday.com)

| Board | Items | Columns found | Automations / views |
|---|---|---|---|
| **Business Units** | 5 | Company name, Trade Name, Legal Name, Date, GST Number, Email, State, Address, Documents, Fax No., Mobile, Phone 1, Phone 2 | 3 automations: copy Name into a "Name Copy" column on create and on change; set **Date = today** on create. Views: Main table, *Business Unit Creation Form*. |
| **Buyers & Suppliers** | 43 | Name, Date, Type (Buyer / Supplier / Private-Deleted), Office Address, State, GST No., Contact Person 1-3, each with Phone and Email | 7 automations: Name-copy on create/change; **Type = Supplier moves item to the Supplier group**, **Type = Private/Deleted moves it to a Private/Deleted group**; one automation points at a column that no longer exists (broken). Groups: Buyer, Supplier, Private/Deleted. Views: Main table, Reports, *Buyer & Supplier Creation Form*, *Send Bank Details*. |
| **Counts** | 32 | Name (built by automation), Thread Count, Machine, Yarn 1, Yarn 1 (%), Yarn 2, Yarn 2 (%), Overall Yarn Composition, Overall Yarn (Blended / Cotton), Yarn (Single / Double), Process (Combed, Karded, Karded Compact, Combed Compact), Certification (BCI, NOP, GOTS, "OKEA TEX"), Type (Cone / Cheese), Item ID, Is Duplicate, Duplicate Error, Formula | 19 automations: 10 rebuild the item name from the column values (on create and when any of Thread Count, Machine, Yarn, Yarn 2, Yarn 1 %, Yarn 2 %, Type, Certification, Process changes); 9 run a **duplicate check** and write Is Duplicate / Duplicate Error. Views: Main table, Creation Form, **Record Validations**. |
| **Transport Company** | 2 | Name, Person, Vehicle Type, Date, Email, Office Address, Mill/Factory/Delivery Address, Office Phone, Res Phone | none. View: Creation Form. |
| **Location MDM** | 2 | Delivery location name | none. Views: Main table, Reports, Location Creation Form. |
| **Sizing/Delivery Address** | 2 | Process, Person, Date, Office Address, GST No. | none. View: Creation Form. |
| **Payment Terms** | 6 | Payment term, Days | none. Values: 10 / 20 / 30 / 45 / 60 DAYS PDC (10-60 days) and ADVANCE RTGS (0 days). |

Observations that shape the plan (patterns seen in the data, not individual records):

1. **Counts are free text.** Names such as "cotton", "Wool", "JC 2403 100", "New name", "10S Single Count" sit next to proper ones. Several rows have a composition total of 0%, 70% or 130%.
2. **Buyers & Suppliers has dirty values.** Some GSTINs are missing, too short, or prefixed with "GSTIN :"; the same GSTIN appears on two different supplier names (a mill and its sister unit); states are spelled several ways ("TAMILNADU", "TAMIL NADU", "UP"); phone numbers use several formats (+91, leading 0, spaces); some rows are test data ("Multi count", Appsavio e-mail addresses).
3. **There is no real "Mobile" on a party.** Phone numbers live only on Contact Person 1-3.
4. **Data entry is by creation forms**, so people outside the MDM team add records. Nothing checks them except the Counts duplicate logic.
5. **Business Units, Buyers & Suppliers and the Sizing/Delivery boards each carry their own Date** (auto-set on create), a creation date rather than a business date.
6. **"Send Bank Details"** is a saved view on Buyers & Suppliers, i.e. bank details are sent to a party from the board (WhatsApp / mail), but no bank columns were found on the board.

---

## 2. What the app already has (source code)

The repository already implements most of the MDM, with stricter rules than monday. Routes are in `src/App.tsx`.

| MDM area | Screen / file | Table(s) | Permission |
|---|---|---|---|
| Business Units | `src/pages/Companies.tsx` (route `/companies`) | `companies`, `company_documents` | `settings.manage` to write; everyone can read |
| Buyers & Suppliers | `src/pages/Contacts.tsx` + `src/components/PartyForms.tsx`, `PartyExtras.tsx` (route `/contacts`; `/buyers` and `/suppliers` redirect) | `buyer_master`, `supplier_master`, `party_documents`, `party_md_contacts`, `activity_log` | `buyer.manage` (buyers), `mill.manage` (suppliers) |
| Counts | `src/pages/Counts.tsx` (`/counts`) | `count_master` | `article.manage` |
| Transport Company | `src/pages/Transporters.tsx` (`/transportation`) | `transporters` | `transport.read` / `transport.manage` |
| Sizing/Delivery Address | `src/pages/JobProcesses.tsx` (`/job-process`) | `job_processes`, `order_job_processes` | `jobprocess.read` / `jobprocess.manage` |
| Payment Terms | `src/pages/PaymentTerms.tsx` (`/payment-terms`) | `payment_terms` | `settings.manage` |
| Location MDM | no screen; `station_master` is only a lookup used (and added inline) by Leads, Transporters and Job Processes | `station_master` | read: `lead.manage`, `lead.qualify`, `deal.read`, `settings.manage` |
| Shared tooling | `src/lib/bulk.ts` (CSV import, bulk delete), `src/lib/csv.ts`, `src/lib/party.ts` (GST/mobile validation, error messages), `src/components/ListTools.tsx` | | |
| Access control | `src/auth/*`, `PermissionMatrix.tsx`, `permission_catalogue`, `user_permissions`, `audit_log` | | |

Rules the database already enforces (the "Record Validations" the monday boards only partly do):

- **Supplier:** name, contact person, 10-digit mobile, GSTIN (15-char regex), PAN (10 upper-case chars), bank account 1, state code (2 digits) and state are required; first two GSTIN digits must equal the state code; GST and name are unique (case-insensitive name).
- **Buyer:** same GST/PAN/state rules; contact person, spindlage capacity and product range must not be blank when given. An `incomplete` flag (trigger) marks records missing a required field, so partial imports are allowed but visible.
- **GST verification:** `gst_status` (unverified / verified / failed) with who/when; changing the GSTIN resets it. Automatic portal lookup is a stub in `src/lib/integrations.ts`.
- **Count master:** count 6-120, machine (OE, RING SPUN, VORTEX), composition (COTTON, POLYESTER, VISCOSE, LINEN, HEMP, BLENDED), blend only when composition is BLENDED, ratio format, yarn type (CHEESE, CONE), process, certification (BCI, OEKO TEX, GOTS, NPOP, NOP), ply. A trigger builds `display_name`; a unique index on it blocks duplicates. This is the Counts "Duplicate Check + auto-name" automation, done properly.
- **Companies:** exactly one `is_home` company; unique `ref_prefix`; PAN format; one record can be both buyer and supplier.
- **Parties that buy and sell:** one record in each master, matched by PAN; the Contacts screen shows them as one row with Role = Buyer / Supplier / Both.
- **Documents:** GST copy, cancelled cheque, KYC form, other, in the `party-documents` storage bucket.
- **Audit:** `audit_log`, `deal_changes`, role-based RLS on every table.

---

## 3. Gap analysis: monday MDM vs the app

| # | Area | In monday | In the app | Gap / action |
|---|---|---|---|---|
| G1 | Business Units: Trade Name, Legal Name, Phone 1/2, Bank accounts, state, record date | Present as columns | Columns exist in the database (`trade_name`, `legal_name`, `phone_1..3`, `bank_account_1/2`, `state`, `state_code`, `record_date`) but are **not in `Company` (types.ts) or the Companies form** | Add the fields to the type, form, CSV columns; show Trade vs Legal name |
| G2 | Business Units: Documents | Files column | `company_documents` (limit trigger `cd_limit`) | Confirm upload UI covers it; otherwise add |
| G3 | Party contacts | Contact Person 1-3 with phone and email | One contact person + mobile on the master; extra numbers in `party_md_contacts` (name, mobile, email, designation), gated by `md_contact.view` | Decide whether to expose up to 3 contacts on the main form; migrate Contact 1 into `contact_person`/`mobile` (required) and 2-3 into `party_md_contacts` |
| G4 | Party "Private / Deleted" | Type value that moves the row to a hidden group | `is_active` flag | Map Private/Deleted to `is_active = false`; add a visible "Inactive / Private" filter and reason note |
| G5 | Single Type field | Type = Buyer / Supplier | Role = Buyer / Supplier / Both (two tables joined by PAN) | Keep the app model. Import rule: one monday row becomes one master row per its Type |
| G6 | Counts: two-yarn recipe with percentages and computed total | Yarn 1 / %, Yarn 2 / %, Overall Composition | Machine + composition + ratio ("60/40") + blend | Same information, different shape. Keep the app model; map Yarn 1 % / Yarn 2 % to `ratio` ("60/40"), pair to `blended` (COTTON/POLYESTER, COTTON/VISCOSE). Totals must be 100 |
| G7 | Counts: "Is Duplicate" | Flag column | Unique index on `display_name` | No work; surface the clash message (already in `errMessage`) |
| G8 | Counts: "Thread Count" | Number | `count_no` 6-120 | Equivalent |
| G9 | Counts: certification spelled "OKEA TEX" | Typo in monday | `OEKO TEX` | Map OKEA TEX to OEKO TEX on import |
| G10 | Transport Company: Vehicle Type | Column | `transporter_type` is internal / third_party, **no vehicle type** (vehicle numbers are on trips) | Add `vehicle_type` (or a lookup) to `transporters` if the business wants it; ask first |
| G11 | Transport Company: Mill/Factory/Delivery address | Column | `delivery_address` | Equivalent |
| G12 | Sizing/Delivery Address | Process, Person, Date, Office Address, GST | `job_processes` (process code, name, buyer, station, addresses, GST, PAN, bank) | Superset; map Process to `name`, Person to `contact_person` |
| G13 | Location MDM | Delivery location name list | `station_master` (name, active), no screen | Add a small Locations screen (list, add, rename, deactivate, bulk import) under settings |
| G14 | Payment Terms | Name + Days | name, days, **advance_pct**, description | Superset. Map ADVANCE RTGS to days 0 and advance 100 (confirm with business) |
| G15 | Creation forms | Anyone can submit a record | Admin-only writes through RLS | Optional: a "Request new master" form that creates a pending record for an MDM owner to approve |
| G16 | "Send Bank Details" | Saved view on parties | Sales confirmation can open WhatsApp/mail links (`src/lib/integrations.ts`); no bank-details send | Optional feature: send a party the home company's bank details by WhatsApp/mail link; log in the activity feed |
| G17 | Reports views | Board Reports views on Buyers & Suppliers, Location MDM | Not built for masters | Optional: counts by state / role / category, incomplete-record report, unverified-GST report |
| G18 | Auto date | Date = today on create | `created_at`; `companies.record_date` | No work; keep `created_at` |
| G19 | Stricter app rules vs messy monday data | Anything goes | Required fields and unique GST/name | **Biggest risk:** a straight import will fail many rows (see section 6) |

---

## 4. Data model for the MDM (target)

Most tables exist. Proposed change list; every change is a new file in `supabase/migrations/` and the snapshot `supabase/schema/public.sql` is refreshed afterwards (project convention).

| Table | Status | Change |
|---|---|---|
| `companies` | exists | Expose already-present columns in the UI/types (G1). No DDL needed |
| `buyer_master`, `supplier_master` | exists | Add optional `inactive_reason text` (G4). Decide whether `supplier_master.mobile` stays required (monday has no party mobile) |
| `party_md_contacts` | exists | Allow up to 3 ordered contacts via `sort_order` (G3) |
| `count_master` | exists | None; add a `legacy_name text` column to keep the original monday item name for traceability |
| `transporters` | exists | Optional `vehicle_type text` (G10) |
| `job_processes` | exists | None |
| `payment_terms` | exists | None |
| `station_master` | exists | Optional unique-name handling already present (`station_master_name_uq`) |
| `mdm_import_batches` / `mdm_import_rows` | **new** | One row per import run and per source row (monday item id, status created / merged / rejected, reason), so migration is auditable and re-runnable |
| `mdm_requests` | **new, optional** | Pending "request new master" records (G15) with requester, payload JSON, status, approver |

---

## 5. Permissions

Keep the existing keys; add only what is missing.

| Action | Key |
|---|---|
| Edit Business Units | `settings.manage` (existing) |
| Edit buyers / suppliers | `buyer.manage` / `mill.manage` (existing) |
| Edit counts | `article.manage` (existing) |
| Edit transporters / job processes | `transport.manage` / `jobprocess.manage` (existing) |
| Edit payment terms, locations | `settings.manage` (existing) |
| See party contact numbers | `md_contact.view` (existing) |
| Run MDM import | new `mdm.import` (dangerous: true) |
| Approve master requests | new `mdm.approve` |

Add both new keys to `permission_catalogue` and to the Management / Accounts templates in `PROFILE_TEMPLATES` (`src/api/types.ts`) as appropriate.

---

## 6. Migration from monday.com

monday has no connector available in this session and the monday API needs a token, so use a board export.

1. **Export** each MDM board to Excel/CSV from monday (Menu > Export board to Excel). Ask the board owner; do not paste credentials anywhere.
2. **Stage** every row in `mdm_import_rows` with the monday item id.
3. **Clean** before loading (rules below), then run the importer in **dry-run** mode first and review the rejects.
4. **Load** in this order, because later masters point at earlier ones: Payment Terms, Locations, Business Units, Counts, Buyers & Suppliers, Transport Company, Sizing/Delivery Address.
5. **Reconcile:** counts per board in monday vs rows created / merged / rejected; spot check 10 rows per board.
6. **Freeze** the monday MDM boards (read-only) after sign-off; keep them for one quarter.

Cleaning rules by board:

| Board | Rules |
|---|---|
| Business Units | Trim; uppercase PAN; `Name` to `name`/`short_name`; Trade Name / Legal Name to their columns; phone fields to `phone_1`, `phone_2`, `mobile`; GST to `tax_id`; derive `ref_prefix` (unique, 4 chars) and ask the business which unit is `is_home` |
| Buyers & Suppliers | Strip "GSTIN :" prefixes and spaces, uppercase; **reject** a GSTIN that fails the 15-character regex but keep the row as `incomplete`; derive state code from the first two digits of GSTIN and normalise state names against `GST_STATES` (`src/lib/party.ts`); phone to 10 digits (drop +91 and leading 0); Contact 1 to `contact_person`/`mobile`, Contacts 2-3 to `party_md_contacts`; Type Buyer to `buyer_master`, Supplier to `supplier_master`; Private/Deleted to `is_active = false`; skip obvious test rows after the business confirms |
| Duplicate GSTINs | The same GSTIN on two different supplier names violates the unique index. Do not auto-merge. List every pair, let the business choose "same party" (merge) or "different unit" (fix the GSTIN, since sister units normally have their own) |
| Counts | Parse names such as "10S OE", "20S", "41'S CARDED COMPACT" into count_no / machine / process where possible; otherwise rebuild from the Yarn 1 / Yarn 2 / % / Process / Certification / Type columns; reject test names ("cotton", "Wool", "New name"); ratio must total 100; map "OKEA TEX" to OEKO TEX; keep the original name in `legacy_name` |
| Transport Company, Sizing/Delivery, Location | Trim, dedupe by lower-case name, normalise phones and GST |
| Payment Terms | Load the six values as they are; confirm ADVANCE RTGS advance percentage |

Every rejected row goes into a downloadable CSV with a plain-language reason (the importer already works this way through `importCsvFile` / `importSummary` in `src/lib/bulk.ts`).

---

## 7. Build plan (phased)

Each phase ends with something that can be used and checked. Estimates are rough working days for one developer already familiar with the repo.

### Phase 0: Decisions and data (2 days)
- Confirm the open questions in section 11.
- Obtain the board exports (section 6, step 1).
- Agree the cleaning rules and who owns the "same party or different unit" calls.

### Phase 1: Close the field gaps (3 days)
- G1: add Trade Name, Legal Name, phones, bank accounts, state and record date to `Company`, the Companies form and the CSV import/export (`COMPANY_CSV_COLUMNS`).
- G3, G4: contact list (up to 3) and the inactive/private flow with reason on the Contacts drawer.
- G9: map certification spelling in the importer.
- Optional G10: vehicle type on transporters.
- **Done when:** a Business Unit and a party saved in the app carry every field the monday board carried, and `npm run typecheck` is clean.

### Phase 2: Locations screen (1 day)
- G13: `/locations` list with add, rename, deactivate, search, CSV import, bulk delete, gated by `settings.manage`. Reuse `ListTools`, `Drawer` and `bulk.ts`.
- **Done when:** the Location MDM values can be maintained without the Leads screen.

### Phase 3: Import tool (4 days)
- New admin page `/mdm-import` (permission `mdm.import`): choose a board type, upload CSV, preview, **dry-run**, run, download rejects.
- Tables `mdm_import_batches` / `mdm_import_rows`; row-by-row insert so one bad row never blocks the rest (existing pattern).
- Cleaning functions in `src/lib/mdmClean.ts`: GST normaliser, mobile normaliser, state normaliser, count-name parser, duplicate-GST detector.
- **Done when:** a dry-run over the real exports produces a reject list a person can act on.

### Phase 4: Data quality and reports (3 days)
- "Needs attention" page: incomplete parties (`incomplete = true`), unverified GST, duplicate GST suspects, missing contact, counts failing the ratio rule.
- Master summary report: counts by state, role, category; export to CSV.
- **Done when:** the business can see what is still dirty after import.

### Phase 5: Optional workflow features (4 days)
- G15 "Request new master" with approval (`mdm_requests`, `mdm.approve`).
- G16 "Send bank details" link (WhatsApp / mail, logged to `activity_log`).
- Wire the GST portal lookup in an Edge Function when credentials exist (`lookupGst` stub).

### Phase 6: Cutover (2 days)
- Run the import on production after a staging rehearsal; reconcile (section 6, step 5); freeze monday boards; brief the users.

---

## 8. Screens and behaviour to keep (do not rebuild)

- Contacts screen with Role Buyer / Supplier / Both, PAN pairing, GST auto-fills state, same-party hint (`SamePartyHint`).
- Count form with live name preview that mirrors the database trigger.
- CSV import/export and multi-select bulk delete; deletion falls back to "mark inactive" when a record is in use.
- RLS-based access; the database is the authority and the UI only explains errors in plain words (`errMessage`).

---

## 9. Verification checklist

- [ ] `npm run typecheck` and `npm run build` pass.
- [ ] Each MDM table: create, edit, deactivate, delete-blocked-when-in-use, CSV round trip.
- [ ] A user without the matching permission cannot write (RLS) and sees a clear message.
- [ ] Import dry-run on each real export: created + merged + rejected = source rows.
- [ ] Duplicate GST pairs are listed, not silently merged.
- [ ] Count names from import equal the trigger-built `display_name`.
- [ ] Audit log shows who imported and when.
- [ ] Migration files committed and `supabase/schema/public.sql` refreshed.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Strict database rules reject much of the monday data | Dry-run first; allow partial records flagged `incomplete`; give the business a fix list |
| Duplicate GSTINs across different names | Manual decision per pair; never auto-merge |
| Counts cannot be parsed from free text | Rebuild from structured columns; unresolved rows go to a manual queue |
| monday boards keep changing during migration | Freeze edits at export time; re-export for the final run |
| Real party data in test environments | Rehearse on a staging Supabase project, not production |
| Secrets | No monday token or service key in the front end; imports run through RLS or an Edge Function |

---

## 11. Open questions for the business

1. Which Business Unit is the **home** company (branding and deal-number prefix)?
2. Should a party keep up to three contacts on the main form, or only one plus "more numbers"?
3. Is a missing party mobile acceptable (monday has none), or must Contact 1's phone be used?
4. Do sister units of one mill legitimately share a GSTIN, or is that an entry error?
5. Is "Private/Deleted" a hide-only status, or should those records be permanently removed?
6. Is **Vehicle Type** on Transport Company needed, and with what list of values?
7. What is the advance percentage for "ADVANCE RTGS"?
8. Should anyone outside the MDM team be able to submit records (the creation forms), with approval?
9. Who may run the import, and who signs off the reconciliation?

---

## 12. Not covered / to confirm

- **CRM boards** (Deals, Sales Confirmation, Dispatch and Billing) and **Tasks boards** (Monthly Visit, Mill Invoice Delivery, Commission Invoice Delivery, transport freight, sample delivery, payment and cheque collection, transporter type details, billing and dispatch dashboard, WhatsApp message and tracking) were not analysed. The app already has screens for most of these; a separate plan would be needed.
- The **creation forms** and **Reports** views on the MDM boards were seen only by name; their exact questions, required flags and charts were not read.
- Counts' drop-down option lists (Machine, Yarn 1, Yarn 2) were not fully read; the app's lists (`COUNT_MACHINES`, `COUNT_COMPOSITIONS`) are used as the target.
- The "Formula" column on Counts and the "Name Copy" columns were not inspected.
- The monday UI showed a notice that the account is near its board-column limit (68 of 75); another reason to move the masters.
