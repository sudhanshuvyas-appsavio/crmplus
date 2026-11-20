-- Throwaway stand-ins for the base tables the Tasks migrations reference.
create schema if not exists auth;
create schema if not exists storage;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;
grant usage on schema public, auth to authenticated, anon;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.profiles (id uuid primary key default gen_random_uuid(), name text, is_admin boolean default false, is_active boolean default true, created_at timestamptz default now());
create table public.permission_catalogue (key text primary key, label text, group_name text, hint text, dangerous boolean, sort_order integer);
create table public.user_permissions (id bigint generated always as identity primary key, user_id uuid, permission text, granted_at timestamptz default now(), granted_by uuid);
create or replace function public.has_permission(p text) returns boolean language sql stable security definer as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
      or exists (select 1 from user_permissions where user_id = auth.uid() and permission = p)
$$;
create table public.buyer_master (id uuid primary key default gen_random_uuid(), name text, is_active boolean default true, messenger_id uuid, collection_staff_id uuid, sales_person_id uuid, created_at timestamptz default now());
create table public.supplier_master (id uuid primary key default gen_random_uuid(), name text, is_active boolean default true, messenger_id uuid);
create table public.transporters (id uuid primary key default gen_random_uuid(), name text);
create table public.order_transports (id uuid primary key default gen_random_uuid(), order_id uuid, transporter_id uuid references public.transporters(id));
create table public.orders (id uuid primary key default gen_random_uuid(), order_no text, status text default 'open_for_execution', buyer_id uuid, supplier_id uuid, payment_tracking_enabled boolean default false, created_at timestamptz default now());
create table public.order_dispatches (id uuid primary key default gen_random_uuid(), order_id uuid references public.orders(id), mill_invoice_no text, mill_invoice_date date, transporter_invoice_no text, transporter_invoice_amount numeric, transport_id uuid, dispatch_date date);
create table public.commission_invoices (id uuid primary key default gen_random_uuid(), order_id uuid, buyer_id uuid, supplier_id uuid, invoice_no text, invoice_date date, amount numeric);
create table public.order_payments (id uuid primary key default gen_random_uuid(), order_id uuid, kind text, amount numeric, paid_on date, mode text, reference text, notes text);

create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (name text, bucket_id text);
alter table storage.objects enable row level security;

-- the "log_automation" helper of the CRM automation log (used by the teammate's round-2 migration)
create table public.automation_log (id bigint generated always as identity primary key, board text, rule text, kind text, record_id uuid, label text, outcome text, detail text, dedupe text);
create or replace function public.log_automation(p_board text, p_rule text, p_kind text, p_id uuid, p_label text, p_outcome text, p_detail text default null, p_key text default null)
returns void language sql as $$ insert into public.automation_log (board, rule, kind, record_id, label, outcome, detail, dedupe) values (p_board, p_rule, p_kind, p_id, p_label, p_outcome, p_detail, p_key) $$;

create table public.t_log (id serial primary key, msg text);
create or replace function public.t_ok(m text) returns void language sql as $$ insert into public.t_log (msg) values (m) $$;
