# Remaining feature analysis

Each item: what was investigated, what was found, decision.

## F-41 Rules data model (Option A or B)

Known requirement set (document 05): 20 automations. Trigger types seen: item created, column changes, status changes to X, date arrives (+offset, time), file column changes. Conditions: status is/any of, column empty, number greater than. Actions: notify people, set status, set date, copy people from a lookup, create an item in another board and link. No priorities, no retries, no dependencies between automations, no recurring rules.

| | Option A: task-specific rules (extend what exists) | Option B: generic trigger-condition-action engine |
|---|---|---|
| Effort | small: add keys to `task_rules.config` (already: `time`, `window_days`, `after_days`, `days`, per-branch times) | large: schema for triggers/conditions/actions, an interpreter, an editor UI, a regression suite for all 20 |
| Risk | low; behaviour is plain SQL, readable | high: interpreter bugs affect every rule; harder to debug |
| Maintainability | a new rule type needs a migration | new rules are data, but only 20 rules exist and none is expected to change often |
| Performance | set-based loops per rule | per-rule interpretation overhead |
| Business value | everything monday does today | unneeded: no evidence that users edit automations |

**Recommendation: Option A** (done as far as the data supports: time, window, thresholds, branch times, one-per-buyer switch, run log). Build B only if the business starts creating new automations. F-41 stays **Deferred**.

## F-11 Multiple people in Person
monday's Person/People columns are of the `people` type, which accepts several people; every value seen holds **one** person (SK, Jyoti, Rahul Sharma); the legacy recipe copies the buyer's Messenger (one person). **Optional / low.** If needed: join table `task_people(task_id, role, user_id)`, `task_watchers` reading it, picker as multi-select in `TaskForm`, notification fan-out unchanged. Not built.

## F-38 Approved sample creates a lead
monday: Feedback Approved -> create "Sample Delivery - {name}" with lead status Qualified in board 5024227502, which is **private or deleted**. CRM+ has a Leads register (`/leads`, `lead.manage`/`lead.qualify`) and no workflow that links samples to leads (no reference to samples in the leads code or migrations). No replacement target or business requirement has been given. **Deferred**; nothing created.

## F-46 Notification e-mail
See `notification-specification.md`: monday's e-mail behaviour is a per-user setting and unreadable. **Blocked** (information), nothing built.

## F-24 Transport Invoice
See `transport-invoice-dependency.md`. **Deferred** until the register exists.

## F-55 Import of the 82 monday rows
| Board | Rows | Notes |
|---|---|---|
| Monthly Visit | 3 | test-like names ("New task"); buyers by relation name |
| Mill Invoice Delivery | 26 | created from Dispatch and Billing; invoice mirrors; names "<SC no> - Task" |
| Commission Invoice Delivery | 31 | linked to commission invoices |
| Payment Collection | 0 | |
| Cheque Collection | 1 | status Collected |
| Transport Freight Invoice | 20 | almost empty |
| Sample Delivery | 1 | |

Mapping needed: buyer/supplier by name to `buyer_master`/`supplier_master` (monday names such as "KPR Mill Limited."), people by name to `profiles` (SK, Jyoti, Rahul Sharma), statuses per the label tables in document 02, dates in IST, `dedupe_key = monday:<item id>` for re-run safety, links to dispatches/commission invoices by their numbers. Most rows are empty shells, so the value is low; and the dispatch and commission-invoice rows they hang on must exist first. **Not started**; an import script should be written and reviewed against staging only.

## F-07 / F-54 / F-01
See `typed-columns-architecture.md` and `board-register-specification.md`: **Deferred** (architecture proposed).

## F-09 / F-08
Forms were read (`creation-forms-specification.md`). **In progress**: headings and the Mill mirrors done; the open decision is whether to add separate field-staff forms identical to monday's.

## F-56 Tests
`e2e-test-plan.md`. SQL tests exist; no UI test framework exists in the repo and there is no signed-in staging account. **In progress**.
