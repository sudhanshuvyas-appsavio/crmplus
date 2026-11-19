# Creation forms specification (monday "Creation Form" views)

Source: the seven "Creation Form" views opened **read-only** in a signed-in monday session on 2026-11-19 (screenshots of each form in its default "Create New Record" mode; nothing was typed, submitted or saved; the Monthly Visit form's "Update Existing Record" option was only switched to look at it). The forms are one embedded app (feature 16492757) used by all seven boards; the API exposes no field list for it, so screenshots are the evidence.

## Common behaviour (all seven forms)

| Item | Observed |
|---|---|
| First control | "Select Action": **Create New Record** (default) or **Update Existing Record** |
| Update mode | Shows "Select Item to Update" (a searchable list of the board's items); the field sections appear after an item is chosen (fields beyond the picker not captured) |
| Layout | Collapsible section cards with a field count, two columns |
| Buttons | "✓ Create Item" (blue), "Clear Form" |
| Field hints | each field shows its monday column type under it ("Type: location", "Type: file", "Type: status", ...) |
| Calculated fields | grey and read-only ("(Calculated field)": mirrors and formulas) |
| Files | "Attach files (0/10)": up to 10 files |
| Required marks | a red `*` on the label |
| Not visible | validation messages, conditional rules, success behaviour, default group (no submission was made) |

## The seven forms

| # | Board (view id) | Section (fields) | Fields in order | Required |
|---|---|---|---|---|
| 1 | Monthly Visit (51888089) | **Summaries** (4) | GPS Check-In (location); Check-In Time (date + time); Check-Out Time (date + time); Meeting Summary (long text) | GPS Check-In |
| 2 | Mill Invoice Delivery (51888736) | **Delivery Information** (6) | Invoice Number (mirror, calculated); Invoice Date (mirror, calculated); Invoice Amount (numbers); Delivery Mode (status); Delivery Proof Upload (file); GPS Check-In (location) | Delivery Proof Upload |
| 3 | Commission Invoice Delivery (51888738) | **General Information** (2); **Commission Invoice Details** (3) | Name (name); Commission Invoices (relation) / Invoice Date (date + time); Photo Upload (file); GPS Check-In (location) | none shown |
| 4 | Payment Collection (51888761) | **General Information** (3); **Payment Details** (7) | Name; Person (people); Connected Boards (relation) / Invoice Number (numbers); Amount (numbers); Amount Collected (numbers); Mode of Payment (status); Payment Proof Upload (file); Balance Amount (formula, calculated); GPS Check-In (location) | none shown |
| 5 | Cheque Collection (51888765) | **General Information** (3); **Cheque Collection Details** (9) | Name; Buyer Name (relation); Accounts (people) / Invoice Number; Cheque Number; Bank Name (text); Cheque Date (date + time); Cheque Amount (numbers); Cheque Photo Upload (file); Deposit Status (status); Notes (text); GPS Check-In (location) | none shown |
| 6 | Transport Freight Invoice (51888741) | **Transport Details** (6) | Transport Bill No. (numbers); Transport Amount (numbers); Load Reference (text); Delivery Proof (file); GPS Check-In (location); Status (status) | none shown |
| 7 | Sample Delivery (51888745) | **General Information** (2) | Name; Person (people) | none shown |

Observations that matter for the build:
- The forms are **short field-staff forms**, not the full register: Monthly Visit has no Name or Buyer, Sample Delivery only Name and Person, Freight has no Check. Everything else on those boards is set by automations (Person from Messenger, Created Date, Start Date) or edited in the table.
- Dropdown **options** are not shown until opened; the status labels come from the board columns (document 02): Delivery Mode Hand/Courier; Mode of Payment Online/Cash/Cheque; Deposit Status Pending/Deposited/Cleared/Collected; freight Status Yes/No.
- Date fields have a separate time box (`hh:mm AM/PM`).

## Comparison with the CRM+ forms (after this build)

CRM+ keeps **one form component with board configuration** (`src/lib/taskBoards.ts`, `src/pages/tasks/TaskForm.tsx`, `ChequeForm.tsx`) because the same form is the manager's edit form; a separate component per board would duplicate it without changing behaviour. The fields and headings follow monday; the CRM+ form shows more than monday's form where CRM+ has no table to edit them in.

| Board | monday field | CRM+ today | Difference / decision |
|---|---|---|---|
| Monthly Visit | GPS Check-In* | location is captured by the **Check in** button (Proof & GPS tab / phone view), not a form field | not required at creation: a visit is created before the visit happens; required-at-check-in is how CRM+ enforces it. **Differs** |
| | Check-In / Check-Out Time | set by the check-in/out buttons | not editable in the form. **Differs** |
| | Meeting Summary | `visit_summary` (textarea) | same |
| | (not in monday) | Name, Buyer, Person, Accounts, Due date, Pending Payment, Visited/Not Visited, Visited Date, Notes | extras CRM+ needs; section headings now "Visit" / "Summaries" |
| Mill | Invoice Number, Invoice Date (calculated) | editable text/date; **read-only when the task is linked to a dispatch** (built) | same once linked |
| | Invoice Amount, Delivery Mode | present | same |
| | Delivery Proof Upload* | uploaded on the Proof & GPS tab (a task needs to exist first) | not required in the form; "proof required before Done" is enforced by the database for staff. **Differs** |
| | GPS | check-in button | as above |
| Commission | Name, Commission Invoices (relation), Invoice Date, Photo, GPS | Name, links, invoice date, proof tab, GPS | the relation is set automatically from the commission invoice; no picker. **Partially** |
| Payment Collection | Name, Person, Connected Boards, Invoice Number, Amount, Amount Collected, Mode, Proof, Balance, GPS | Name, Person, **Connected Boards picker (built)**, Invoice Number, Amount, Mode; Amount Collected only through payment lines (the database refuses direct edits), Balance calculated | "Amount Collected" as a form field **differs by design** (money moves only through payment lines) |
| Cheque Collection | Name, Buyer, Accounts; Invoice Number, Cheque Number, Bank, Date, Amount, Photo, Deposit Status, Notes, GPS | `ChequeForm.tsx` has the same fields | same (headings "General Information" / "Cheque Collection Details" added) |
| Freight | Bill No., Amount, Load Reference, Proof, GPS, Status | present, plus Check (Outstanding/Cleared) | Check is not in monday's form but is the column its automation watches |
| Sample | Name, Person | Name, Person, Buyer, Supplier, quality/type/lot, Delivery Date, Feedback | superset |

## Implemented in this round
- Section headings per board as above (`BoardConfig.sections`).
- Mill invoice number/date read-only when linked to a dispatch.
- Payment Collection "Connected Boards" picker (earlier round).

## Not implemented, and why
- "Update Existing Record" mode: CRM+ updates existing records from the register (row Actions, detail drawer, phone view).
- Forms limited to exactly monday's fields: it would remove fields the CRM+ register needs (no inline cell editing) and make managers unable to set the buyer of a visit.
- Success/validation behaviour of monday's forms: not observable without submitting.

**Decision needed:** if the business wants the *field staff* to use a form identical to monday's (e.g. Sample = Name + Person), that is a separate "field form" per board on top of the manager form. Say so and it can be built from the table above.
