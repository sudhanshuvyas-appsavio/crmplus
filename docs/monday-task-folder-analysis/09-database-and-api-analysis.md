# 09. Database and API analysis

All from `supabase/migrations/20261118100000_tasks_module.sql`, `...100100_tasks_archive_old.sql`, `...100200_tasks_scheduler.sql`, `20261119100000_task_boards_monday_parity.sql` and the Edge Functions. The live database was **not** queried or changed by this task.

## 9.1 Tables

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `task_types` | configuration of the 11 task types | `key`, `label`, `view_key`, `requires_proof`, `requires_gps`, `auto_done_on_proof`, `default_due_days`, `sort_order`, `is_active` |
| `tasks` | every board's row | `task_no` ("TASK-YYYY-nnnn", unique), `task_type` FK, `title`, `status` (todo, in_progress, blocked, done, cancelled), `priority`, `due_date`, `start_date`, `assigned_to`, `accounts_staff_id`, `buyer_id`, `supplier_id`, `order_id`, `dispatch_id`, `commission_invoice_id`, `transporter_id`, `source_task_id` (self FK), `amount`, `amount_collected`, `mode`, `notes`, `check_in_at`, `check_out_at`, `lat`, `lng`, `accuracy_m`, `completed_at/by`, `details jsonb`, `dedupe_key` unique, audit |
| `task_events` | timeline | `kind`, `from_value`, `to_value`, `note`, `data`, `dedupe_key` unique |
| `notifications` | bell | `user_id`, `kind`, `severity`, `title`, `message`, `href`, `task_id`, `dedupe_key`; unique `(user_id, dedupe_key)`; realtime |
| `task_payments` | payment lines | `amount > 0`, `paid_on`, `mode`, `reference`; insert only through RPC; updates `tasks.amount_collected` via trigger |
| `task_cheques` | Cheque Collection rows | `cheque_no`, `bank_name`, `cheque_date`, `amount`, `photo_path`, `status` (pending, collected, deposited, cleared, bounced), deposit fields, unique `(cheque_no, bank_name)` |
| `task_attachments` | proof photos and documents | `kind` (proof, photo, document), `storage_path` unique, GPS |
| `task_rules` | reminder thresholds | `rule_key`, `kind` (reminder, escalation), `config jsonb`, `is_active` |
| `message_templates`, `messages` | WhatsApp/e-mail log | status queued/sending/sent/delivered/read/replied/failed/manual |
| `task_subitems` | subitems (backend only) | `task_id`, `name`, `owner_id`, `status` (working_on_it, done, stuck), `item_date` |

Views (`security_invoker = true`): `board_monthly_visit`, `board_mill_invoice_delivery`, `board_commission_invoice_delivery`, `board_payment_collection`, `board_freight_invoice`, `board_sample_delivery`, `board_cheque_collection` (monday's columns, mirrors, formulas).

## 9.2 Functions, triggers, jobs

| Object | Kind | Role |
|---|---|---|
| `task_guard()` / `trg_task_guard` | before insert/update on `tasks` | numbering, details validation, permission limits, proof-before-done, completion stamp, money only through payments |
| `task_after()` / `trg_task_after` | after insert/update | timeline + assigned/done notifications |
| `task_defaults()` / `trg_task_defaults` | before insert / update of buyer | Person and Accounts defaults |
| `task_payment_after()` | after insert on `task_payments` | add to collected, notify, post order receipt, auto-complete when fully paid |
| `task_attachment_after()` | after insert on `task_attachments` | cheque photo link; auto-done on proof; notify |
| `task_cheque_guard()`, `cheque_collected_notify()` | cheques | status rules; "Your Check for {name} is Collected" |
| `freight_check_notify()` | after insert/update of details | outstanding notification |
| `dispatch_tasks()`, `commission_invoice_tasks()` | after insert/update on `order_dispatches`, `commission_invoices` | create mill / freight / commission tasks |
| `run_task_rules(p_now)` | SQL function | overdue, visit not visited, visit visited reminder, sample feedback due, escalations; pg_cron `run-task-rules` every 15 minutes |
| `task_set_status`, `task_set_status_many`, `task_assign_many`, `task_check_in`, `task_check_out`, `task_add_payment`, `task_add_comment`, `task_counts` | RPCs for the screens | permission checks inside |
| `notify_user`, `task_watchers`, `task_log`, `queue_message`, `normalize_phone`, `task_can`, `task_path_can` | helpers | revoked from `public`/`anon` where internal |

## 9.3 API surface used by the screens

Direct table reads/writes through supabase-js (RLS enforced): `tasks`, `task_cheques`, `task_events`, `task_payments`, `task_attachments`, `messages`, `message_templates`, `task_rules`, `buyer_master`. RPCs: `task_counts`, `task_set_status`, `task_set_status_many`, `task_assign_many`, `task_add_payment`, `task_add_comment`. Edge Functions: `send-message` (JWT or cron secret; retries up to 3; `manual` fallback), `whatsapp-webhook` (signature verified, `--no-verify-jwt`). Check-in/out RPCs exist and are used by the phone view.

## 9.4 Does the schema support what monday needs?

| Entity | Supported? | Note |
|---|---|---|
| Workspaces / folders | n/a | sidebar groups are code |
| Boards | partial | `task_types` + `taskBoards.ts`, not data-driven for columns |
| Board groups | partial | Cheque groups derived from status in code |
| Items | yes | `tasks`, `task_cheques` |
| Subitems | **database only** | `task_subitems` |
| Custom columns / field definitions | **no** | fixed columns + `details` jsonb (untyped except per-key checks) |
| Status labels | partial | CHECK constraints per column and label maps in code (`task_details_problem`, `STATUS_OPTIONS`, `boardStatusLabel`) |
| People assignments | yes (single) | `assigned_to`, `accounts_staff_id`; monday allows several people per column |
| Board relations | partial | typed FKs for buyer, supplier, order, dispatch, commission invoice, transporter, `source_task_id`; **no** Payment Collection back-link FK (the view derives it from `source_task_id`), no Transport Invoice entity |
| Mirrors | yes via views | `board_*` |
| Dependencies | no / not needed | |
| Automations, conditions, actions | partial | `task_rules.config` for thresholds; the logic itself is SQL code, not a rule model |
| Automation execution history | **no** | only `task_events` for escalation steps and notifications; no per-rule run log |
| Comments / updates | yes | `task_events` kind comment |
| Notifications | yes | in-app, realtime; messages by WhatsApp/e-mail |
| Attachments | yes | `task_attachments`, bucket |
| Board views, saved filters | no | tabs and quick filters in code |
| User permissions | yes | 5 keys + RLS |
| Activity logs | yes | `task_events`, `audit` module elsewhere |

## 9.5 Weaknesses found

1. **`details` jsonb carries typed business fields** (delivery mode, acknowledgement, feedback status, visit state, pending payment, bill number...). Validation is only per-key in `task_details_problem`; no foreign keys, no indexes, hard to report on.
2. **Two statuses on one row**: the generic task status and the board's own status are conflated: Mill "Status" is a *mapping* of five generic states onto three labels (`todo`/`in_progress` both become "Working on it"), Payment "Payment Status" is derived from `status`/`amount_collected`.
3. **Time of day is lost**: `run_task_rules` works on dates (`today`) and runs every 15 minutes; monday fires at fixed times.
4. **Rules are code**: a new rule needs a migration; thresholds only are data.
5. **No rule-run log**: a rule that raises nothing is indistinguishable from one that did not run.
6. **Unique key on notifications** prevents duplicates per user and event, but the visit reminder uses a single key per visit, so a second reminder cycle (monday allows repeated date fires) is suppressed.
7. **Index coverage** is adequate for current volumes (`tasks_status_due_ix`, `tasks_assignee_ix`, `tasks_type_ix`, `tasks_buyer_ix`); the escalation loop scans all tasks of a type with `pending_payment` each run: fine at tens of thousands of rows, needs an expression index on `details->>'pending_payment'` beyond that.
8. **Concurrency**: `task_payment_after` locks the task row (`for update`), `dedupe_key` unique indexes make creation idempotent; status changes are last-write-wins (as in monday).
9. **Scalability**: reads go through RLS functions (`task_can`) per row for related tables; acceptable for the volumes seen (82 monday rows); revisit if a board passes ~50k rows.
