# Commission Desk

Web app for the Appsavio CRM+ backend: deals, orders, dispatch, commission
billing and collections, behind Supabase Auth with per-user permissions.

- **Frontend:** Vite + React + TypeScript, deployed on Vercel (`commission-desk`)
- **Backend:** Supabase project **CRM+** (`uadvdqwoumwbsfbrdvse`, Tokyo).
  The browser talks to Postgres directly via supabase-js; every request is
  checked by row-level security. The only server code is the `admin-users`
  Edge Function (creating users and resetting passwords, which need the
  service role key).

## Local development

```bash
npm install
cp .env.example .env      # then fill in VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
```

Both values in `.env` are public. The anon key is protected by RLS, not by
being secret. **Never** put the service role key or secret key in `.env` or
in any `VITE_` variable.

## Environment variables

`vite.config.ts` inlines exactly two values into the browser bundle, looked up
by name:

| Inlined as | Read from (first match) |
|---|---|
| `SUPABASE_URL` | `SUPABASE_URL`, `VITE_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY` |

Other variables, including `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY` and
`SUPABASE_JWT_SECRET` (which the Supabase–Vercel integration also adds),
never reach the client.

On Vercel, `SUPABASE_URL` and `SUPABASE_ANON_KEY` must exist for **both
Production and Preview**, or preview builds fail to start.

## Deploying

Pushes to the connected GitHub repo deploy automatically: `main` deploys to
production and every other branch gets a preview URL. `vercel.json` rewrites
all paths to `index.html` so client-side routes like `/reset-password`
(opened from emails) work on a fresh page load.

## Database

`supabase/migrations/` holds the migrations recorded on CRM+. Most of the
schema predates migration tracking, so `supabase/schema/public.sql` is a
full snapshot of the `public` schema (tables, functions, triggers, RLS
policies, grants; no data). It already includes every migration's effect,
which is why it lives outside `migrations/`. Restore it with `psql`, not
the SQL editor (pg_dump 18 adds a `\restrict` line only psql understands).

To refresh the snapshot (needs the database password, from Database >
Settings in the Supabase dashboard; pg_dump ships with PostgreSQL):

```powershell
pg_dump "postgresql://postgres.uadvdqwoumwbsfbrdvse@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres" `
  --schema-only --schema=public --no-owner -f supabase\schema\public.sql
```

Every schema change goes in a new migration file committed here; refresh
the snapshot afterwards.

Edge Functions live in `supabase/functions/` and are deployed with
`npx supabase functions deploy admin-users`.

## Supabase Auth settings

In Authentication > URL Configuration:

- **Site URL:** `https://commission-desk.vercel.app`
- **Redirect URLs:** `https://commission-desk.vercel.app/**` and
  `https://commission-desk-*-appsavio.vercel.app/**` (previews)

## Tasks module setup

The Tasks module (field tasks, proof photos, reminders, WhatsApp and e-mail
sending) needs a few one-off steps. Nothing below puts a secret in the repo.

### 1. Apply the migrations, in order

Apply these files from `supabase/migrations/` (staging first), in this
order, with `psql` as described under Database above:

1. `20261118100000_tasks_module.sql` - tables, rules, permissions, storage
2. `20261118100100_tasks_archive_old.sql` - archives the old collection tasks and cheques and copies open rows across
3. `20261118100200_tasks_scheduler.sql` - `run_task_rules()` and its pg_cron job
4. `20261119100000_task_boards_monday_parity.sql` - one typed view per monday board (`board_monthly_visit`, `board_mill_invoice_delivery`, `board_commission_invoice_delivery`, `board_payment_collection`, `board_freight_invoice`, `board_sample_delivery`, `board_cheque_collection`), subitems, Messenger-first assignment, the freight-outstanding and cheque-collected notifications, and monday's wording and visit branches in `run_task_rules()`

### 2. Permissions

The first migration adds five permissions: `task.read` (see all tasks),
`task.work` (work on assigned tasks: status, proof, check-in, payments),
`task.manage` (create, assign, edit, delete, edit rules), `message.send` and
`message.view` (the message log). People who held `order.manage` receive
`task.manage`, `task.work`, `task.read` and `message.send`; `order.read` holders
receive `task.read`. The **Field staff** profile template (`PROFILE_TEMPLATES` in
`src/api/types.ts`) is for people who only work the tasks assigned to them; Accounts
get `task.manage`, Sales `task.read` and `task.work`, Management `task.read`.
Permissions are granted per user, so existing accounts keep what they have.

### 3. Secrets

Set the provider secrets on the project (they live only in Supabase):

```powershell
npx supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... WHATSAPP_VERIFY_TOKEN=... WHATSAPP_APP_SECRET=... EMAIL_API_KEY=... EMAIL_FROM=... CRON_SECRET=...
```

- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`: the Meta WhatsApp Cloud API token and phone number id.
- `WHATSAPP_VERIFY_TOKEN`: any long random string; you type the same one into Meta.
- `WHATSAPP_APP_SECRET`: the Meta app secret, used to verify webhook signatures. Set it in production.
- `EMAIL_API_KEY`, `EMAIL_FROM`: a Resend API key and a verified sender, e.g. `Commission Desk <desk@your-domain.com>`.
- `CRON_SECRET`: any long random string; the scheduler sends it in the `x-cron-secret` header.

### 4. Deploy the functions

```powershell
npx supabase functions deploy send-message
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

`whatsapp-webhook` must be deployed with `--no-verify-jwt` because Meta cannot
send a Supabase token; it is protected by the verify token and the
`X-Hub-Signature-256` signature instead.

### 5. Meta webhook and templates

1. In the Meta developer console (WhatsApp > Configuration) set the callback URL to
   `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook` and the verify
   token to your `WHATSAPP_VERIFY_TOKEN`, then subscribe to the **messages** field.
2. In WhatsApp Manager create and get approved two templates (language English, body
   text only), named exactly: `payment_reminder` (variables: buyer, amount, reference)
   and `delivery_notice` (variables: buyer, reference, date). The wording is in
   Tasks > Rules > Message templates; the variables are filled in that order.

### 6. Scheduling

- `run_task_rules()` (reminders and the 30/45/60-day escalation) is scheduled every
  15 minutes by the third migration when `pg_cron` is available. Without pg_cron, create
  a job in the dashboard (Integrations > Cron) that runs `select public.run_task_rules()`.
- Queued messages are sent when the person presses Send, and retried by a second job
  that calls `send-message` every minute with the cron secret. With `pg_cron` and
  `pg_net` enabled (replace the placeholders; the anon key is the public one):

```sql
select cron.schedule(
  'send-queued-messages',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-message',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <anon key>',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

  Or create the same call as a Cron job of type "Supabase Edge Function" in the
  dashboard, adding the `x-cron-secret` header. Prefer keeping the secret in Vault
  (`vault.decrypted_secrets`) over pasting it into the job.

### 7. Realtime

The notification bell updates live when Realtime is enabled for `public.notifications`
(Database > Replication, or `alter publication supabase_realtime add table public.notifications;`).
The first migration does this when the publication exists; the bell also polls every
five minutes as a backup.

### 8. With no secrets set

Everything still works. A message whose channel has no provider secrets is saved as
`manual` (no error); the Send dialog and the Messages log then offer an **Open link**
button that opens a prefilled WhatsApp chat (`wa.me`) or e-mail (`mailto:`) for the
person to send themselves. Add the secrets later and new messages send automatically.
