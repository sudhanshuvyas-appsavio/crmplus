# Board register specification (F-01, F-03)

## monday (observed)
Each of the seven boards is its own register: its own main table (columns in document 02), its own "Creation Form", automations and (six of them) a Reports view. Sidebar: folder "Tasks" with the seven boards. Only Cheque Collection has groups (To Collect, In Progress, Collected). No saved filters, sorts or groupings exist on any view.

## CRM+ today
| Aspect | State |
|---|---|
| Navigation | sidebar group **Tasks** (own group since this session) with seven links `/tasks?view=<board>` |
| One register per board | each link shows only that board's task type(s), with that board's columns, summary cards, search, filters, sort, bulk actions, CSV export, row Actions (Open, Start, Complete, Block, Reassign, Mark delivered/cleared, Approve/Reject feedback, Record payment, Cancel, Reopen) |
| Columns | exactly monday's columns and titles in monday's order (`lib/taskBoards.ts`; production check 14/16/15/12/15/16/13) |
| Status labels | Mill: Working on it / Stuck / Done (mapped from the generic status) plus Invoice Status Not Delivered/Delivered; Cheque: Pending/Collected/Deposited/Cleared (+ Bounced, extra); Sample feedback Pending/Approved/Rejected; Freight Check Outstanding/Cleared and Status Yes/No; Payment Outstanding/Completed (derived); Visit Not Visited/Visited/Completed |
| Groups | Cheque Collection groups derived from deposit status (`ChequeQueue`) |
| Item detail | drawer with details, proof and GPS, payments, cheque, messages, timeline, and (new) subitems on Payment Collection and Cheque Collection |
| Report | new "Count by person" chart per board (`TaskReport.tsx`) |

## Differences
1. **Not separate data stores**: the registers are filtered views over one `tasks` table (`task_type`), with board-specific values in `details`. Behaviour at the screen level is board-specific; the storage is shared. The typed alternative is in `typed-columns-architecture.md`.
2. **Mill Status** is a mapping: monday's "Working on it" covers both CRM+ "To do" and "In progress". Mill's `Status` stays manual (monday's proof automation sets only Invoice Status; built in this round).
3. **Sample Type** options: monday's labels are the placeholders "TBD 1/2/3" (never defined); CRM+ keeps free text.
4. **Cheque "Bounced"** exists in CRM+ and not in monday.
5. Inline cell editing, column resizing, drag ordering, per-user saved preferences: not built (F-54).

## Decision
F-01 stays **Partially implemented / Deferred** until the typed-column work (a separate store per board is a storage decision, not a screen decision). F-03: the labels that monday defines are reproduced; the only open label is Sample Type, which monday itself leaves undefined.
