# Master data QA checklist

The Business Units scenarios (SC01-SC09 of the QA workbook) repeated for every register, so each can be re-run the same way. A register passes when every row behaves as described. Record the result in the same workbook layout (one sheet per case, with a screenshot).

Before testing: run `supabase/manual/20261118_business_unit_test_data_cleanup.sql` (step 1, then step 2), then `supabase/migrations/20261118160000_mdm_documents.sql` and `20261118170000_master_data_integrity.sql` in the Supabase SQL editor.

## Every register (Payment Terms, Counts, Business Units, Buyers & Suppliers, Transport Company, Location MDM, Sizing/Delivery Address)

| # | Scenario | Expected |
|---|---|---|
| 1 | Open from the Master data menu; open the URL directly; refresh | The register opens, no 404 |
| 2 | Columns | Monday's column names, in monday's order, then Actions. Clicking a row or cell opens nothing |
| 3 | Create form | Opens with monday's sections and fields in monday's order (no Select Action: changing a saved record is Actions > Edit only) |
| 4 | Click Create with nothing entered | The button works; a message appears under **each** required field and the first one is focused; nothing is saved |
| 5 | Required fields | Only the fields marked * are required (see the table below) |
| 6 | Wrong formats | Email (`invalid@`), phone/mobile (`98abc`, `123`), GST (`33ABC`), PAN (`12345ABCDE`), state code (`3`), numbers (`-1`) each show a message next to the field while typing; save is blocked |
| 7 | Duplicates | Same name (also `  name  ` and different capitals), same GST, same customer code are refused with a message that says which field and which record clashes |
| 8 | Server errors | Any error from the database is a sentence about the field, shown at the top of the form (the form scrolls to it), never "Could not save" alone |
| 9 | Edit (Actions > Edit) | The saved values load; clearing a required field shows its message; Save works when valid |
| 11 | Actions menu | Edit, Documents (where the register has them) and Delete; there is no View. A user without edit rights gets Edit opened read-only: every field disabled, no Save or Delete |
| 12 | Delete (Actions > Delete) | Confirmation dialog; a record in use says so in words |
| 13 | Search | Typing a value from **any visible column** finds the row (name, address, GST, PAN, email, phone, state, contacts, bank, remarks, locations, counts, yarn, process...) |
| 14 | Filters | Status is filterable everywhere; State where the register has a state; plus the register's own (below). Clear resets them |
| 15 | Inactive | An inactive record shows a red **Inactive** chip next to its name |
| 16 | Import (where the register has it) | `+91 98765 43210` style numbers import; a row that fails the form's rules is reported with the same sentences |

## What is required (create)

| Register | Required |
|---|---|
| Payment Terms | Name (unique), Days (0-365) |
| Counts | Name, Thread Count (6-120), Machine, Type, Yarn 1, Yarn 1 (Percentage); Yarn 2 when Yarn 1 is below 100% |
| Business Units | Name, Email, Address, Bank Account Details 1, Short name, Reference prefix, Currency (3 letters, default INR); GST, PAN, phones checked when typed; Name, GST, PAN and prefix unique; PAN must match the GST |
| Buyers & Suppliers | Name, Type, Office Phone, Office Address, GST No., Business Unit, Default Commision Percentage, Counts; Name and GST unique per master; customer code unique |
| Transport Company | Name, GST No., Office Phone, State, State Code, Office Address, Locations, Business Units, Bank Account Number 1, IT PAN, Contact Person 1 and its phone, Vehicle Type |
| Location MDM | Name (unique), Address |
| Sizing/Delivery Address | Name, GST No., State, Office Address, both contacts with phone and email, Remarks 1, at least one document |

## Register-specific checks

| Register | Extra |
|---|---|
| Payment Terms | Name and Days are the only columns; searching `30` finds the 30-day term |
| Counts | Filters: Duplicates only, Status, Machine; a duplicate recipe is flagged, not refused |
| Business Units | Phone 1-3 save and reload as `+91 ...`; Documents column updates the moment a file is added or removed; Home company changes the sidebar title immediately and reverts when unflagged; no Buyer/Supplier tick boxes or Contacts panel; State and Status filters |
| Buyers & Suppliers | A record created in the create form opens and saves in Edit; an office phone `+971...` reopens as +971; contact phones accept +91 only (message otherwise); Type Buyer shows buyer fields, Supplier shows supplier fields; filters State, Default Commission, Location MDM, Counts; no Spindlage/Product range anywhere; a new record is not "Incomplete" because of those |
| Transport Company | Filters Type, Status, Vehicle Type, State, Business Units; State Code must be 2 digits and match the GST |
| Location MDM | State and Zone filters; Documents count refreshes |
| Sizing/Delivery Address | Filters State, Locations, Company; creating without a document is refused with a message |

## Documents (Business Units, Buyers & Suppliers, Transport, Location, Sizing/Delivery)

| # | Scenario | Expected |
|---|---|---|
| D1 | Attach a PNG, a PDF, a TXT and a DOCX | Listed; PNG, PDF, TXT preview in the dialog; DOCX downloads |
| D2 | Attach 11 files | 10 kept; a message says the rest were not added (on create and on edit) |
| D3 | A file over the size limit | Refused with its name in the message |
| D4 | Upload or delete inside the edit form, then close it | The Documents column / count on the list is already correct |
| D5 | A user without edit rights | Sees and previews files; cannot upload or delete |
