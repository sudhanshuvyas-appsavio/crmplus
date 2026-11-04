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
schema predates migration tracking, so a **baseline** of the current schema
still needs to be pulled once (it needs the database password, from the
Supabase dashboard under Project Settings > Database):

```bash
npx supabase init                      # creates supabase/config.toml
npx supabase link --project-ref uadvdqwoumwbsfbrdvse
npx supabase db pull                   # writes <timestamp>_remote_schema.sql
```

After that, every schema change goes in a new migration file committed here.

Edge Functions live in `supabase/functions/` and are deployed with
`npx supabase functions deploy admin-users`.

## Supabase Auth settings

In Authentication > URL Configuration:

- **Site URL:** `https://commission-desk.vercel.app`
- **Redirect URLs:** `https://commission-desk.vercel.app/**` and
  `https://commission-desk-*-appsavio.vercel.app/**` (previews)
