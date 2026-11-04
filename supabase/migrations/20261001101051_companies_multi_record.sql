-- Replace the org_settings singleton with a multi-record `companies` table
-- (T-001 widened from "our own company profile" to a general Companies
-- object with full CRUD + import/export). Exactly one row may be flagged
-- is_home=true; that row continues to drive the app's own branding
-- (name/short_name/currency) and deal reference-number prefix, the same
-- role org_settings.id=1 used to play.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text not null,
  currency text not null default 'USD',
  ref_prefix text not null,
  address text,
  phone_numbers text[],
  fax text,
  email text,
  tax_id text,
  is_home boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one home company at a time.
create unique index companies_one_home_idx on public.companies (is_home) where (is_home);

create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

alter table public.companies enable row level security;

-- Read stays open to every signed-in user (branding fields are shown
-- app-wide, same as org_settings before it); writes need settings.manage,
-- matching the permission the old singleton screen was gated by.
create policy companies_select on public.companies
  for select
  using (true);

create policy companies_write on public.companies
  for all
  using (public.has_permission('settings.manage'))
  with check (public.has_permission('settings.manage'));

-- org_settings had 0 rows in production, so there is no data to carry over.
drop table public.org_settings;
