# Notification specification (F-46)

## What monday does (verified)
Every notification in the Tasks folder is a **"Notify someone"** automation block: an in-app notification (title = the item name, body as in document 05) to the people in the Person/People/Accounts columns. 14 of the 20 workflow automations notify (A-2..A-11, A-14, A-17, A-18, A-20).

Run history of the Monthly Visit board: "No automations runs yet": no notification has ever been produced.

## What cannot be read
Whether monday also e-mails or pushes these notifications is a **per-user setting** (Notification settings of each account). It is not part of the automation, not readable through the API, and not set at board level. Sender, subject and e-mail body are monday's own templates. **No e-mail notification configuration exists to replicate**; this is recorded as inaccessible, not missing.

## CRM+ (what exists)
| Capability | Where |
|---|---|
| In-app notification with the same text, deduplicated per user and event | `notify_user`, `notify_user_new`, `notifications` (unique `(user_id, dedupe_key)`), bell in the app header (realtime) |
| Recipients "Person + Accounts" (managers when neither is set) | `task_watchers` |
| History | `notifications` table (read/unread), `task_events` timeline, **Rule log** for scheduler-raised ones |
| E-mail/WhatsApp to buyers (not to staff) | `messages` + Edge Function `send-message` (Resend, Meta WhatsApp; 3 attempts; failed/manual state), Tasks > Messages |

## Decision
An e-mail copy of staff notifications is **not built**: monday's behaviour is unknown, and building one would send e-mail nobody has asked for. If the business wants staff e-mail copies, define: which notification kinds, which address (profile e-mail), subject (the notification title), body (the notification text), once per event. It can then be built on the existing queue: a trigger on `notifications` insert that calls `queue_message` for channel e-mail, with `dedupe_key` as idempotency key, the existing retry and `failed` handling, and a staging Resend key (never production recipients while testing).
