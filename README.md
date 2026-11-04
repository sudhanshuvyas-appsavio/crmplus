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
