# Master data: column parity with monday.com

Read live from the monday.com workspace "CRM", folder "MDM", on 2026-11-18. Each Master data grid in CRM+ shows the monday board's columns, in monday's order and with monday's titles, followed by an **Actions** column (Edit / Documents / Delete; there is no View: someone without edit rights gets Edit opened read-only). Clicking a row or cell opens nothing.

Titles that were fixed on purpose: Transport "CGST" is shown as **GST No.** (it holds the GST number); Buyers & Suppliers "Default Commision Percentage" is shown as **Default Commission Percentage** (typo); Business Units board's "Item ID" and "Name Copy" are helper columns and are not shown.

Not shown, because monday has no CRM+ data for them or they are helper/duplicate columns:

| Board | Skipped monday columns |
|---|---|
| All | Person (assignee), Subitems (empty on Counts and Business Units), Item ID / Name Copy / Name Formula / Formula / Summary (Fx) helpers |
| Business Units | Item ID, Name Copy |
| Location MDM, Transport, Sizing/Delivery | Person |
| Buyers & Suppliers | Company profile (same as Website URL), Quantity, Current Machines (status, buyer), Current Machines (text, supplier), Current Machine (status, supplier), Type (text), link to Sales Confirmation |

## Documents (monday "Documents" file column)

| Register | Documents | Where |
|---|---|---|
| Business Units | yes | `company_documents`, bucket `company-documents` |
| Buyers & Suppliers | yes | `party_documents`, bucket `party-documents` |
| Transport Company | yes (new) | `transporter_documents`, bucket `mdm-documents` |
| Location MDM | yes (new) | `location_documents`, bucket `mdm-documents` |
| Sizing/Delivery Address | yes (new) | `job_process_documents`, bucket `mdm-documents` |
| Counts, Payment Terms | no (monday has none) | |

Images, PDFs and text files (txt, csv, json, log, md, xml) preview inside CRM+; other files download. Up to 10 files per record, 20 MB each for the new registers. The new tables and bucket come from `supabase/migrations/20261118130000_mdm_documents.sql`.

## Columns by register (monday title -> CRM+ source)

**Payment Terms**: Name (`name`), Days (`days`).

**Counts**: Name, Created Date, Summary, Thread Count, Machine, Yarn 1, Yarn 1 (Percentage), Yarn 2, Yarn 2 (Percentage), Overall Yarn Composition, Overall Yarn, Yarn, Process, Certification, Type, Item ID, Is Duplicate, Duplicate Error (all from `count_master`).

**Business Units**: Name, Trade Name, Legal Name, Date, GST Number, Email, State, Address, Documents, Fax No., Mobile, Phone 1, Phone 2, Phone 3, PAN Number, Bank Account Details 1, Bank Account Details 2 (`companies`).

**Buyers & Suppliers** (`buyer_master` / `supplier_master`; a column picker hides the ones you do not need, and the choice is remembered in the browser): Name, Date, Type, Office Address, State, GST No., Contact Person 1-3 with Phone and Email, Location MDM, Category, Bank Account Details 1-2, Default Commission Percentage, Short Name, Mill/Factory/Delivery Address, Office Phone, Res Phone, IT PAN, Email, Buyer Commission Type / Value, Supplier Commission Type / Value, Sales Person, Collection Staff, Documents, Counts, Thread Count, Remark 1, Remark 2, Messenger, Customer Code, Buyer Machine Type / 1 / 2, Supplier Machine Type, Fabric Producing, No. of Looms, Buyer Qty(Bags/month), Buyer Qty(Kgs/month), Reed * Pick, Width, Counts Supplying, Supplier No. of Roters & Spindles, Monthly Production Quantity, Supplier Qty(Bags/month), Supplier Qty(Kgs/month), Business Name, Website URL, Map Location, Business Unit, Business Phone.

**Transport Company**: Name, Vehicle Type, Date, Email, Office Address, Mill/Factory/Delivery Address, Office Phone, Res Phone, GST No., State, State Code, Bank Account Number 1, Bank Account Number 2, IT PAN, Contact Person 1 (+Phone), Contact Person 2 (+Phone), Vehicle No 1-3, Remarks, Documents, Locations, Business Units (`transporters`).

**Location MDM**: Name, State, Date, Buyers & Suppliers, Address, GST Number, Phone, Email, Contact Person (MD), Accounts Dept Phone, Zone, Documents (`station_master`).

**Sizing/Delivery Address**: Name, Date, Office Address, GST No., State, Contact Person 1 (+Phone, +Email), Contact Person 2 (+Phone, +Email), Remarks 1, Documents, Locations (`job_processes`).

## Creation forms (read from monday's "Creation Form" views on 2026-11-18)

Every form ends with Create Item. (monday's forms open with Select Action, Create New Record / Update Existing Record; CRM+ leaves out Update Existing Record, because Actions > Edit on the list does the same.) CRM+ shows the same sections, field order, labels and required marks (\*), as titled cards in a two-column grid. Required marks are enforced when creating; an existing record may lack some of them. Fields CRM+ needs that monday's form does not have sit in a final "Company settings" / "More details" card.

| Register | monday sections (fields) and required fields |
|---|---|
| Business Units | Board Information (11): Name\*, Trade Name, Legal Name, Email\*, State, Mobile, Phone 1-3, Address\*, GST Number. Account Details (3): Bank Account Details 1\*, Bank Account Details 2, PAN Number. Documents (1). |
| Buyers & Suppliers | Buyer & Supplier Details: Name\*, Date, Type\*, Email, Office Phone\*, Office Address\*, Mill/Factory/Delivery Address, State, GST No.\*, Business Unit\*, Location MDM, Default Commision Percentage\*, Category, Messenger. Account Details: IT Pan. MD Information / Account Information / Dispatch Information: Contact Person 1 / 2 / 3 with Phone and Email. Product Configuration: Counts\*, Buyer and Supplier Commission Type and Value. Incase of Buyer / Supplier (depends on Type): Buyer - Quantity, Fabric Producing, No. of Looms, Buyer Qty(Bags/month), Buyer Qty(Kgs/month), Reed * Pick, Width, Type; Supplier - Supplier Machine Type, Counts Supplying, Current Machines, Supplier No. of Roters & Spindles, Monthly Production Quantity, Supplier Qty(Kgs/month), Supplier Qty(Bags/month). Remarks: Remark 1, 2. Documents. |
| Counts | Count Information (7): Name\*, Thread Count\*, Machine\*, Type\*, Process, Certification, Yarn. Fabric Composition (5): Yarn 1\*, Yarn 1 (Percentage)\*, Yarn 2, Yarn 2 (Percentage), Overall Yarn (calculated). |
| Transport Company | Transport Type Details (12): Name\*, Date, Email, CGST\*, Office Phone\*, Res Phone, State\*, State Code\*, Office Address\*, Mill/Factory/Delivery Address, Locations\*, Business Units\*. Account Details (3): Bank Account Number 1\*, Bank Account Number 2, IT PAN\*. Contact Details (4): Contact Person 1\*, its Phone\*, Contact Person 2, its Phone. Vehicle Details (4): Vehicle Type\*, Vehicle No 1-3. Remarks (1). Documents (1). |
| Location MDM | Location Details (11): Name\*, State, Date, Zone, GST Number, Phone, Email, Contact Person (MD), Buyers & Suppliers, Accounts Dept Phone, Address\*. Documents (1). |
| Sizing/Delivery Address | Sizing/Delivery Address Information (6): Name\*, Date, GST No.\*, State\*, Office Address\*, Locations. Contact Details (6): Contact Person 1\* and 2\*, their Phones\* and Emails\*. Remarks (1): Remarks 1\*. Documents (1)\* (at least one file). |

Differences from monday, on purpose or by necessity:
- **Date** is not asked on Location, Transport or Sizing/Delivery (no date column in CRM+; the record's created date is shown instead).
- Transport "CGST" is labelled **GST No.**
- **Buyers & Suppliers** on a Location form is not editable at creation; link a party to a location from the party's Location MDM field.
- Buyers & Suppliers fields without a CRM+ column are not asked: Quantity, Type (text) and the Current Machines fields.
- A new Buyer or Supplier shows only its own commission pair and its own "Incase of" fields.
- **Edit / View of a Buyer or Supplier** use the same sections, labels and order as the creation form, plus a final "More details" card for monday columns its form does not ask for (Short Name, Customer Code, State Code, Res Phone, Website URL, Map Location, Bank Account Details 1-2, Sales Person, Collection Staff). GST verification, documents, MD contact numbers and history stay below the form.
- **Counts** options are shown in title case (Ring Spun, Cotton) as in monday; the stored value stays upper case. "OEKO TEX" corrects monday's "OKEA TEX" typo, and monday's "None" option is the empty choice.
- **Category** options are 1-4 as in monday; "Bagwise Rate" drops the stray full stop of monday's label.
