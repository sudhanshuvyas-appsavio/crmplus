# 07. Permissions and access control

## 7.1 monday.com (observed)

| Aspect | Observation |
|---|---|
| Board visibility | All seven boards are **public**, permission level `everyone`: every member of the workspace can **see and edit** all columns and items (monday's default for "everyone can edit") |
| Workspace | Kind **open**: any account member can join and see the boards |
| Owners | One owner per board: **SK** (admin). No team owners |
| Subscribers | SK on every board, Jyoti on Monthly Visit |
| Admins | SK and Jyoti are account **admins** (user kind "admin"); both can edit automations and views |
| Automation management | Owners and admins; Jyoti authored the legacy recipes, SK the workflow automations |
| Assigned users | Person/People and Accounts are *labels*, not permissions: assignment gives no extra rights |
| Create / delete items | Everyone who can edit the board (platform default for `everyone`) |
| Column-level restrictions | None observed (monday column permissions are an enterprise feature; no setting read) |
| Guests, view-only users | **Unverified**: the account's guest and viewer lists were not read (broad user query not run). A viewer account was used earlier in this project and could not see the Deals form, which suggests viewer limits exist for forms |
| Private boards, shareable boards | None private; sharing links for forms: **unverified** |
| Team-level access | No team on any board |
| Board-specific differences | None: identical settings on all seven |

What each role can do on these boards (derived from the above and monday defaults):

| Role | Read | Create/edit items | Delete | Edit columns, views, automations | Manage members |
|---|---|---|---|---|---|
| Admin / board owner (SK, Jyoti) | yes | yes | yes | yes | yes |
| Member | yes | yes (everyone-edit) | yes (platform default) | no | no |
| Viewer / guest | unverified | no (viewer) / unverified (guest) | no | no | no |

## 7.2 CRM+ (implemented)

| Permission key | Label | Effect (from `20261118100000_tasks_module.sql`) |
|---|---|---|
| `task.read` | See all tasks | sees every task, cheque, event; otherwise sees only tasks assigned to, accounts-assigned to, or created by the user |
| `task.work` | Work on assigned tasks | update status, notes, details, check in, upload proof, record payments on **own** tasks (assignee or accounts) |
| `task.manage` | Create and manage tasks | create, assign, edit, reopen, delete; edit rules and task types; sees all |
| `message.send` | Send messages | WhatsApp / e-mail from a task |
| `message.view` | See the message log | read every message |

Enforcement is layered: RLS policies on `tasks`, `task_events`, `task_payments`, `task_cheques`, `task_attachments`, `task_subitems`, `messages`; the helper `task_can(task, write)`; the guard trigger `task_guard()` (a non-manager can change status, notes, details, location, mode only; completed tasks can be reopened only by managers; proof required before Done for staff); storage policies on the `task-proofs` bucket by task id; permission-gated routes and sidebar links (`TASK = ['task.read','task.work','task.manage']`).

## 7.3 Comparison

| Topic | monday | CRM+ | Decision |
|---|---|---|---|
| Who sees all boards | everyone in the workspace | `task.read` / `task.manage`, others only their own | **Keep CRM+** (stricter; field staff see only their tasks). Document the difference |
| Who edits | everyone | managers; workers only their own tasks and only certain fields | Keep CRM+ |
| Who creates items | everyone | `task.manage`, or `task.work` for tasks assigned to self | Keep |
| Who deletes | everyone | `task.manage` | Keep |
| Who edits automations/rules | owner/admin | `task.manage` edits thresholds; the code is migration-controlled | Keep; thresholds are data |
| Person/Accounts meaning | labels | Person/Accounts also grant visibility and work rights | Keep (improvement) |
| Guests, private boards | not used | not needed | n/a |
| Column-level restrictions | none | money and assignment protected by the guard trigger | Keep |

Gaps: none that block parity. Open items: confirm whether monday has non-admin members who see these boards (their access mapping is a profile-template decision, `PROFILE_TEMPLATES` in `src/api/types.ts` already has Field staff, Accounts, Sales and Management).
