-- Leads rebuild, step 1 (2026-11-19): monday's "Entry Filter Questions" and the Lead-Quotation widget.
--
--  1. leads: the five entry-filter questions of monday's Lead Creation Form
--     (weaving yarn Yes/No, payment cycle, current supplier, price range, next purchase).
--  2. lead_quote_lines: the rows of a lead's quotation (Count, Supplier, Rate), editable.
--  3. lead_quotations: each generated quotation (number QT-yyyy-nnnn, a frozen copy of the
--     rows, and the PDF in the private lead-quotations bucket).
--  Additive only: existing leads, ids and the lead -> deal automation are untouched.

begin;

-- ---------------------------------------------------------------- 1. entry questions
alter table public.leads
  add column if not exists entry_weaves_yarn text,
  add column if not exists entry_payment_cycle text,
  add column if not exists entry_current_supplier text,
  add column if not exists entry_price_range text,
  add column if not exists entry_next_purchase date;
alter table public.leads drop constraint if exists leads_entry_weaves_yarn_check;
alter table public.leads add constraint leads_entry_weaves_yarn_check
  check (entry_weaves_yarn is null or entry_weaves_yarn in ('yes','no'));
alter table public.leads drop constraint if exists leads_entry_payment_cycle_check;
alter table public.leads add constraint leads_entry_payment_cycle_check
  check (entry_payment_cycle is null or entry_payment_cycle in ('7_days','30_days','60_days','advance'));

-- ---------------------------------------------------------------- 2. quotation rows
create table if not exists public.lead_quote_lines (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  line_no integer not null check (line_no > 0),
  count_id uuid not null references public.count_master(id),
  supplier_id uuid not null references public.supplier_master(id),
  rate numeric(14,2) not null check (rate >= 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (lead_id, line_no)
);
create index if not exists lead_quote_lines_lead_ix on public.lead_quote_lines (lead_id);

-- ---------------------------------------------------------------- 3. generated quotations
create sequence if not exists public.lead_quotation_no_seq;

create table if not exists public.lead_quotations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  quote_no text not null unique
    default ('QT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.lead_quotation_no_seq')::text, 4, '0')),
  lines jsonb not null,                 -- frozen copy: [{line_no, count, supplier, rate}]
  storage_path text not null unique,
  generated_by uuid default auth.uid(),
  generated_at timestamptz not null default now()
);
create index if not exists lead_quotations_lead_ix on public.lead_quotations (lead_id, generated_at desc);

-- ---------------------------------------------------------------- access (same people as leads)
alter table public.lead_quote_lines enable row level security;
alter table public.lead_quotations enable row level security;

drop policy if exists lead_quote_lines_sel on public.lead_quote_lines;
create policy lead_quote_lines_sel on public.lead_quote_lines for select to authenticated
  using (has_any_permission(array['lead.manage','lead.qualify','deal.read']));
drop policy if exists lead_quote_lines_ins on public.lead_quote_lines;
create policy lead_quote_lines_ins on public.lead_quote_lines for insert to authenticated
  with check (has_permission('lead.manage'));
drop policy if exists lead_quote_lines_upd on public.lead_quote_lines;
create policy lead_quote_lines_upd on public.lead_quote_lines for update to authenticated
  using (has_permission('lead.manage')) with check (has_permission('lead.manage'));
drop policy if exists lead_quote_lines_del on public.lead_quote_lines;
create policy lead_quote_lines_del on public.lead_quote_lines for delete to authenticated
  using (has_permission('lead.manage'));

drop policy if exists lead_quotations_sel on public.lead_quotations;
create policy lead_quotations_sel on public.lead_quotations for select to authenticated
  using (has_any_permission(array['lead.manage','lead.qualify','deal.read']));
drop policy if exists lead_quotations_ins on public.lead_quotations;
create policy lead_quotations_ins on public.lead_quotations for insert to authenticated
  with check (has_permission('lead.manage'));
drop policy if exists lead_quotations_del on public.lead_quotations;
create policy lead_quotations_del on public.lead_quotations for delete to authenticated
  using (has_permission('lead.manage'));

grant select, insert, update, delete on public.lead_quote_lines to authenticated;
grant select, insert, delete on public.lead_quotations to authenticated;
grant all on public.lead_quote_lines, public.lead_quotations to service_role;
grant usage, select on sequence public.lead_quotation_no_seq to authenticated, service_role;

-- ---------------------------------------------------------------- the private bucket
insert into storage.buckets (id, name, public, file_size_limit)
values ('lead-quotations', 'lead-quotations', false, 5242880)
on conflict (id) do nothing;
drop policy if exists lead_quotations_storage_select on storage.objects;
create policy lead_quotations_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'lead-quotations' and has_any_permission(array['lead.manage','lead.qualify','deal.read']));
drop policy if exists lead_quotations_storage_insert on storage.objects;
create policy lead_quotations_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lead-quotations' and has_permission('lead.manage'));
drop policy if exists lead_quotations_storage_delete on storage.objects;
create policy lead_quotations_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lead-quotations' and has_permission('lead.manage'));

commit;
