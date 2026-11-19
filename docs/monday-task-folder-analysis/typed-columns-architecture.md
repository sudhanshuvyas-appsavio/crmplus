# Typed columns architecture (F-07) and board grids (F-54)

Not built. This is the trace and the proposal required before touching it.

## 1. Save paths that write `tasks` (traced)

| Path | File | Writes |
|---|---|---|
| Create / edit a task | `TaskForm.tsx` `save()` | `insert/update tasks` with `details` merged from the form |
| Quick actions (Mark delivered, Mark cleared, Approve/Reject feedback) | `TaskQueue.tsx` `patchDetails` | `update tasks set details` |
| Status | RPC `task_set_status`, `task_set_status_many`, `task_assign_many` | status, assignee |
| Check in/out | RPC `task_check_in/out` (also sets `details.visit_status`, `visited_on`, `visit_summary`) | |
| Payments | RPC `task_add_payment` | `task_payments`, `tasks.amount_collected` |
| Cheques | `ChequeForm.tsx` | `tasks` + `task_cheques` |
| Triggers | `dispatch_tasks`, `commission_invoice_tasks`, `task_attachment_after`, `run_task_rules` (escalation) | insert tasks with `details`, set `details.delivery_status` |

## 2. Readers of `details`
`TaskQueue.tsx`, `TaskDetail.tsx`, `TaskForm.tsx`, `TaskReport.tsx`, `lib/party.ts`, `api/types.ts`; SQL: `task_details_problem`, `task_guard`, the seven `board_*` views, `freight_check_notify`, `run_task_rules`, `task_attachment_after`. (`board_*` views read the keys as text and cast.)

## 3. Types per monday column (what typed storage needs)

| monday type | Examples | Today |
|---|---|---|
| status | Pending Payment, Visited/Not Visited, Delivery Mode, Invoice Status, Check, Feedback Status, Deposit Status, Mode of Payment | text key in `details`, validated per key in `task_details_problem`; cheque and generic status as columns |
| date / date+time | Visited Date, Invoice Date, Delivery Date, Cheque Date, Check-In/Out | `details` ISO text; check-in/out typed columns |
| numbers | Invoice Amount, Amount, Collected, Bill No. | typed columns for amounts; others text |
| long text / text | Meeting Summary, Load Reference, Sample Quality/Lot | `details` text |
| people | Person, Accounts | typed FKs (single) |
| board relation | buyer, supplier, dispatch, commission invoice, source task | typed FKs |
| file | proofs | `task_attachments` |
| location | GPS | `lat`, `lng`, `accuracy_m` |
| mirror / formula | messengers, invoice no., balance, ageing, feedback due | `board_*` views / computed in the UI |

## 4. Can typed columns be introduced without breaking things?
Yes, **additively**, because every write goes through the five paths in section 1 and every reader is listed in section 2.

## 5. Proposed architecture (smallest maintainable)
One 1:1 detail table per board, keyed by `task_id`, holding only that board's typed fields (check constraints for the status labels, `date`/`numeric` types, FKs), instead of the `details` JSON. The engine tables (`tasks`, events, attachments, payments, notifications, RLS through `task_can`) stay untouched.

| Step | Change | Safe because |
|---|---|---|
| 1 | Create `task_visit`, `task_mill_delivery`, `task_commission_delivery`, `task_payment_collection`, `task_freight_check`, `task_sample` (Cheque already typed in `task_cheques`); RLS `task_can(task_id)` | additive |
| 2 | Backfill from `details`; keep `details` read-only for unknown keys | idempotent, verifiable by row counts |
| 3 | A trigger keeps `details` and the detail table in step while screens are migrated | old and new readers both work |
| 4 | Switch the writers (form, quick actions, RPCs, triggers) to the detail tables through one RPC `task_save_board` | one validated entry point |
| 5 | Rewrite `board_*` views over the typed tables; switch `TaskQueue` to read them (F-54) | views already define the columns |
| 6 | Drop `task_details_problem`/`details` keys per board | last |

Rejected: a generic JSON-only model (no constraints, no indexes, no FKs, weak reporting) and seven fully separate tables (duplicates `task_can`, events, payments, messages, phone view).

## 6. Why it is not built now
It touches every writer and reader above and is best done **together with** the board forms (the field set must be final first) and tests (none exist for the UI). Doing it blind in the same round as the unrun migration would stack unverified changes. Prerequisites: staging database, UI test harness (see `e2e-test-plan.md`), a decision on the field forms (`creation-forms-specification.md`).

## 7. Grid behaviour observed in monday (F-54)
Not reproducible from what was read: column resize, drag order, inline edit, grouping and per-user preferences are standard monday table features; no saved view with filters or sorting exists on any of the seven boards. CRM+'s register already shows only each board's configured columns (verified earlier on production: 14/16/15/12/15/16/13 columns), with search, filters, sort, bulk actions and export. Inline cell editing, column resize and saved preferences are **not** built.
