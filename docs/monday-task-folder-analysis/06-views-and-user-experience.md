# 06. Views and user experience

## 6.1 What monday offers on these boards (observed)

The API returned the following views per board (document 01 section 1.4). Only the **main table** and **forms/dashboards** exist; there is no Kanban, Calendar, Timeline, Gantt, Workload or Chart view on any of the seven boards, and no view has a stored filter, sort or grouping.

| View | Boards | Purpose (inferred from name and type) | Readable? |
|---|---|---|---|
| Main table | all 7 | The register: one row per item, columns as in document 02. Cheque Collection shows three groups (To Collect, In Progress, Collected) | columns yes; layout no |
| **Creation Form** (app view, feature 16492757) | all 7 | Field-friendly form to add an item with the board's columns; the form's sections, order, required marks, placeholders, defaults are **unverified** (embedded app view, not readable) | no |
| **Reports** (dashboard view) | 6 (not Monthly Visit) | Per-board dashboard of widgets (counts by status, amounts...): **unverified** | no |
| **Dashboard** (dashboard view) | Monthly Visit | Same idea for visits: **unverified** | no |
| **Build Vibe view** (app feature 15528052) | Commission Invoice Delivery, Payment Collection, Cheque Collection, Transport Freight Invoice | A custom app view generated with monday "Vibe" (custom UI over the board). Content **unverified**. A board called "Build Vibe app" also exists at the root (out of scope) | no |
| **Commission Invoice From** (app feature 17720591) | Commission Invoice Delivery | A custom app view (probably a printable or fillable commission-invoice form): **unverified** | no |

## 6.2 How people work with a board

| Interaction | monday behaviour | Evidence |
|---|---|---|
| Add an item | "New item" in the table, or the Creation Form (public link or in-board view) | form views |
| Edit | Inline cell edit; item card for updates; mobile app for GPS and file columns | column types |
| Status change | Click the label | |
| Search / filter / sort | Standard board tools (search box, Filter, Sort, Person filter); **no saved filter** exists | views list |
| Group / hide columns | Standard; Cheque Collection is the only grouped board | |
| Bulk edit | Standard multi-select actions (platform) | |
| Drag and drop | Rows between groups on Cheque Collection (manual) | |
| Item detail panel | Item card with Updates (comments, @mentions), Files, Activity log (platform) | |
| Notifications | Bell notification from automations; email/push per user setting (unverified) | automations |
| Attachments | File columns (one per board) plus updates | columns |
| User preferences | Per-user column visibility and filters (platform) | |

## 6.3 What is essential, what is optional

| Feature | Verdict | Why |
|---|---|---|
| Board tables with monday's columns, labels and order | **Essential** | the daily register |
| Per-board creation form with monday's sections | **Essential** | how field staff add records (sections unverified: read first) |
| GPS check-in and proof upload per record | **Essential** | the point of the boards |
| Relations and mirrors (document 04) | **Essential** | Person, invoice and amount come from them |
| Notifications of the 20 automations | **Essential** | the follow-up system |
| Reports dashboards | **Important, optional until read** | contents unknown; CRM+ already has overview cards and collection dashboards |
| Build Vibe / app views | Optional until read | contents unknown |
| Groups on Cheque Collection | Important | three buckets drive how accountants work |
| Subitems | Optional | no data, default columns only |
| Kanban, Calendar, Timeline, Gantt, Workload | **Not required** | monday does not use them on this folder |
| Saved filters | Optional | none exist in monday |

## 6.4 What CRM+ offers today (summary; detail in document 08)

Per-board **tab on `/tasks`** with summary cards, search, filters, status/priority quick filters, bulk status/assign, CSV export, row Actions menu, detail drawer with timeline, proof gallery, payment lines, cheque panel, message sender; a **mobile "Field view"** (`/tasks/my`) with check-in and proof capture; Rules and Messages panels for managers.
Differences to address: per-board creation-form sections, dashboards equivalent to "Reports", groups beyond Cheque Collection (none needed), subitems screen.
