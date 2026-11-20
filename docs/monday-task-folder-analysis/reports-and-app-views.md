# Reports and app views

Read-only inspection of the views in a signed-in monday session, 2026-11-19. Widget filters could not be read (the filter funnel icon is highlighted on several widgets; opening it would enter the widget editor).

## Reports / Dashboard (F-50)

| Board | View | Widgets seen | Observed result |
|---|---|---|---|
| Monthly Visit | Dashboard | "Chart" (column chart): item **count by Person**, stacked by Visited/Not Visited | Rahul Sharma 1 (Empty), Jyoti 2 (1 Empty, 1 Not Visited) |
| Mill Invoice Delivery | Reports | "**User Wise Task Completed**" (chart, filtered) | No results found |
| Commission Invoice Delivery | Reports | "Chart" (filtered) | No results found |
| Payment Collection | Reports | "Chart" (filtered) | No results found |
| Cheque Collection | Reports | "**Date Wise Collection**", "**Party Wise Collection**", "**Date Wise Deposited**", "**Staff Wise Deposited**" (all filtered; more below the fold not captured) | No results found |
| Transport Freight Invoice | Reports | "Chart": count by Person (Blank), stacked by status | 20 items, all Blank/Empty |
| Sample Delivery | Reports | "Chart": count by Person, stacked by Feedback Status | SK 1 (Empty) |

Pattern: **count of items grouped by person (or date/party), stacked by a status column**. No amounts, no ageing, no totals widgets were seen. Export is the dashboard's standard "Export" menu. Access: the same as the board (everyone).

## What CRM+ now has
- `src/pages/tasks/TaskReport.tsx`: "Count by person" bars stacked by the board's status (Visited/Not Visited/Completed for visits, Delivered/Not Delivered for mill and commission, Outstanding/Cleared for freight, Outstanding/Completed for payments, Pending/Approved/Rejected for samples), built from the rows on screen (real data; follows the table filters).
- Existing: board summary cards, `TaskOverview`, the Collection dashboard.

## Not reproduced
- Date-wise and party-wise cheque charts, staff-wise deposited: monday's filters are unreadable and every one of those widgets is empty in monday today; defining them would be guessing. Next step: read each widget's settings with an editor session, then add the grouping (the data exists: `task_cheques.collection_date`, `buyer_id`, `deposited_by`).
- Widget titles ("User Wise Task Completed") are not used as headings because their filters are unknown.

## App views (F-51)

| View | Board | Observed | Decision |
|---|---|---|---|
| "Build Vibe view" (feature 15528052) | Commission Invoice Delivery, Payment Collection, Cheque Collection, Freight | An empty screen: "This screen can show anything you want ... Build your new application" (monday's AI builder prompt, nothing built) | nothing to reproduce |
| "Commission Invoice From" (feature 17720591) | Commission Invoice Delivery | "Commission_Invoice is temporarily unavailable. Contact your account admin." (the app is broken or removed) | nothing to reproduce; if a printable commission invoice is wanted it belongs to the Commission Invoices register (billing documents) |
