-- =====================================================================
-- MASTER DATA: ONE SCRIPT. Paste all of it into Supabase > SQL Editor and press Run.
-- Safe to run more than once. If anything fails, nothing is changed.
--
--  Part 1  deletes the QA / test Business Units that no deal or confirmation uses
--          (Lead 2, test lead, Test 2/3 and QA BU ... are kept if a deal points at them)
--  Part 2  renames / clears whatever duplicates are still left, so the new rules can start
--  Part 3  the integrity rules (unique name/GST/PAN, currency, PAN-matches-GST, required fields, ...)
--  Part 4  document tables and the storage bucket for Transport, Location and Sizing/Delivery
--
-- After it runs: Storage > company-documents > delete the folder of each deleted company
-- (e.g. f20ff828-db92-4a15-af4e-bd169f0f1d02 for QA BU Validation).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Part 1: delete unused test business units
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  kept int := 0;
  gone int := 0;
begin
  for r in
    select c.id, c.name,
           exists (select 1 from public.crm_deals d where d.company_id = c.id)
        or exists (select 1 from public.sales_confirmations s where c.id in (s.company_id, s.buyer_company_id, s.supplier_company_id)) as in_use
    from public.companies c
    where c.is_home = false
      and (c.name ilike 'QA BU%' or c.name ilike 'Lead 2%' or c.name ilike 'test lead%'
           or c.name ilike 'Test 2%' or c.name ilike 'Test 3%')
  loop
    if r.in_use then
      kept := kept + 1;
      raise notice 'KEPT (a deal or confirmation uses it): %', r.name;
    else
      delete from public.companies where id = r.id;
      gone := gone + 1;
      raise notice 'DELETED: %', r.name;
    end if;
  end loop;
  raise notice 'Part 1 done: % deleted, % kept.', gone, kept;
end $$;

-- ---------------------------------------------------------------------
-- Part 2: duplicates that remain (kept test rows): newest copies are renamed / cleared
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select id, name, row_number() over (partition by lower(btrim(name)) order by created_at, id) as rn
    from public.companies
  loop
    if r.rn > 1 then
      update public.companies set name = btrim(r.name) || ' (duplicate ' || r.rn || ')' where id = r.id;
      raise notice 'Renamed duplicate name: %', r.name;
    end if;
  end loop;

  for r in
    select id, name, row_number() over (partition by upper(btrim(tax_id)) order by created_at, id) as rn
    from public.companies where nullif(btrim(tax_id), '') is not null
  loop
    if r.rn > 1 then
      update public.companies set tax_id = null where id = r.id;
      raise notice 'Cleared duplicate GST on: %', r.name;
    end if;
  end loop;

  for r in
    select id, name, row_number() over (partition by upper(btrim(pan_number)) order by created_at, id) as rn
    from public.companies where nullif(btrim(pan_number), '') is not null
  loop
    if r.rn > 1 then
      update public.companies set pan_number = null where id = r.id;
      raise notice 'Cleared duplicate PAN on: %', r.name;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Part 3: integrity rules
-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- 1. Business Units
-- ---------------------------------------------------------------------
-- Phones are stored as +<code><digits> with no space (companies_fmt_chk). The old screen
-- saved "+91 9876543210", so tidy anything saved that way.
update public.companies set phone_1 = regexp_replace(phone_1, '\s', '', 'g') where phone_1 ~ '\s';
update public.companies set phone_2 = regexp_replace(phone_2, '\s', '', 'g') where phone_2 ~ '\s';
update public.companies set phone_3 = regexp_replace(phone_3, '\s', '', 'g') where phone_3 ~ '\s';
update public.companies set tax_id = upper(btrim(tax_id)) where tax_id is not null and tax_id <> upper(btrim(tax_id));
update public.companies set pan_number = upper(btrim(pan_number)) where pan_number is not null and pan_number <> upper(btrim(pan_number));

create unique index if not exists companies_name_uq on public.companies (lower(btrim(name)));
create unique index if not exists companies_gst_uq on public.companies (upper(btrim(tax_id)))
  where tax_id is not null and btrim(tax_id) <> '';
create unique index if not exists companies_pan_uq on public.companies (upper(btrim(pan_number)))
  where pan_number is not null and btrim(pan_number) <> '';

-- New default for new rows; a currency is a 3-letter code.
alter table public.companies alter column currency set default 'INR';

alter table public.companies drop constraint if exists companies_currency_chk;
alter table public.companies add constraint companies_currency_chk check (currency ~ '^[A-Z]{3}$') not valid;

-- The PAN is characters 3 to 12 of the GSTIN.
alter table public.companies drop constraint if exists companies_pan_gst_chk;
alter table public.companies add constraint companies_pan_gst_chk
  check (tax_id is null or pan_number is null or substr(tax_id, 3, 10) = pan_number) not valid;

-- Name, Email, Address and Bank Account Details 1 are required on every row
-- (it used to apply only when a trade name was set).
alter table public.companies drop constraint if exists companies_required_chk;
alter table public.companies add constraint companies_required_chk
  check (
    coalesce(btrim(name), '') <> ''
    and coalesce(btrim(email), '') <> ''
    and coalesce(btrim(address), '') <> ''
    and coalesce(btrim(bank_account_1), '') <> ''
  ) not valid;

-- ---------------------------------------------------------------------
-- 2. Buyers and suppliers: spindlage / product range are no longer asked for,
--    so they must not keep a record flagged "Incomplete".
-- ---------------------------------------------------------------------
create or replace function public.buyer_flag_incomplete() returns trigger
language plpgsql as $$
begin
  new.incomplete := coalesce(btrim(new.contact_person), '') = ''
    or coalesce(btrim(new.gst), '') = ''
    or coalesce(btrim(new.pan), '') = '';
  return new;
end $$;

create or replace function public.supplier_flag_incomplete() returns trigger
language plpgsql as $$
begin
  new.incomplete := coalesce(btrim(new.contact_person), '') = ''
    or coalesce(btrim(new.mobile), '') = ''
    or coalesce(btrim(new.gst), '') = ''
    or coalesce(btrim(new.pan), '') = ''
    or coalesce(btrim(new.bank_account_1), '') = ''
    or coalesce(btrim(new.state_code), '') = ''
    or coalesce(btrim(new.state), '') = '';
  return new;
end $$;

-- Recompute the flag for existing rows (a no-op update fires the trigger).
update public.buyer_master set incomplete = incomplete;
update public.supplier_master set incomplete = incomplete;

-- ---------------------------------------------------------------------
-- 3. Documents of a deleted buyer / supplier were left behind (no foreign key)
-- ---------------------------------------------------------------------
delete from public.party_documents d
where (d.party_type = 'buyer' and not exists (select 1 from public.buyer_master b where b.id = d.party_id))
   or (d.party_type = 'supplier' and not exists (select 1 from public.supplier_master s where s.id = d.party_id));

create or replace function public.party_documents_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.party_documents where party_type = tg_argv[0] and party_id = old.id;
  return old;
end $$;
revoke execute on function public.party_documents_cleanup() from public, anon, authenticated;

drop trigger if exists trg_buyer_documents_cleanup on public.buyer_master;
create trigger trg_buyer_documents_cleanup after delete on public.buyer_master
  for each row execute function public.party_documents_cleanup('buyer');
drop trigger if exists trg_supplier_documents_cleanup on public.supplier_master;
create trigger trg_supplier_documents_cleanup after delete on public.supplier_master
  for each row execute function public.party_documents_cleanup('supplier');

-- ---------------------------------------------------------------------
-- 4. Payment Terms had no updated_at trigger
-- ---------------------------------------------------------------------
drop trigger if exists trg_payment_terms_updated_at on public.payment_terms;
create trigger trg_payment_terms_updated_at before update on public.payment_terms
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- Part 4: documents for Transport, Location and Sizing/Delivery
-- ---------------------------------------------------------------------
-- Master data: the "Documents" file column of the monday.com MDM boards that
-- CRM+ did not have yet (Transport Company, Location MDM, Sizing/Delivery
-- Address). Business Units (company_documents) and Buyers & Suppliers
-- (party_documents) already have theirs. Up to 10 files per record, kept in the
-- private `mdm-documents` bucket under <register>/<record id>/<uuid>-<name>.

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.transporter_documents (
  id uuid primary key default gen_random_uuid(),
  transporter_id uuid not null references public.transporters(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists transporter_documents_ix on public.transporter_documents (transporter_id);

create table if not exists public.location_documents (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.station_master(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists location_documents_ix on public.location_documents (station_id);

create table if not exists public.job_process_documents (
  id uuid primary key default gen_random_uuid(),
  job_process_id uuid not null references public.job_processes(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists job_process_documents_ix on public.job_process_documents (job_process_id);

-- ---------------------------------------------------------------------
-- 2. At most 10 files per record
-- ---------------------------------------------------------------------
create or replace function public.mdm_documents_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if tg_table_name = 'transporter_documents' then
    select count(*) into n from transporter_documents where transporter_id = new.transporter_id;
  elsif tg_table_name = 'location_documents' then
    select count(*) into n from location_documents where station_id = new.station_id;
  else
    select count(*) into n from job_process_documents where job_process_id = new.job_process_id;
  end if;
  if n >= 10 then
    raise exception 'A record can hold at most 10 documents; remove one first';
  end if;
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_at := now();
  return new;
end $$;

drop trigger if exists trg_transporter_documents_limit on public.transporter_documents;
create trigger trg_transporter_documents_limit before insert on public.transporter_documents
  for each row execute function public.mdm_documents_limit();
drop trigger if exists trg_location_documents_limit on public.location_documents;
create trigger trg_location_documents_limit before insert on public.location_documents
  for each row execute function public.mdm_documents_limit();
drop trigger if exists trg_job_process_documents_limit on public.job_process_documents;
create trigger trg_job_process_documents_limit before insert on public.job_process_documents
  for each row execute function public.mdm_documents_limit();

-- A trigger function is not meant to be called directly.
revoke execute on function public.mdm_documents_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Row access: same permissions as the register itself
-- ---------------------------------------------------------------------
alter table public.transporter_documents enable row level security;
drop policy if exists transporter_documents_sel on public.transporter_documents;
create policy transporter_documents_sel on public.transporter_documents for select to authenticated
  using (has_permission('transport.read') or has_permission('transport.manage'));
drop policy if exists transporter_documents_ins on public.transporter_documents;
create policy transporter_documents_ins on public.transporter_documents for insert to authenticated
  with check (has_permission('transport.manage'));
drop policy if exists transporter_documents_del on public.transporter_documents;
create policy transporter_documents_del on public.transporter_documents for delete to authenticated
  using (has_permission('transport.manage'));

alter table public.location_documents enable row level security;
drop policy if exists location_documents_sel on public.location_documents;
create policy location_documents_sel on public.location_documents for select to authenticated
  using (has_permission('lead.manage') or has_permission('lead.qualify') or has_permission('deal.read') or has_permission('settings.manage'));
drop policy if exists location_documents_ins on public.location_documents;
create policy location_documents_ins on public.location_documents for insert to authenticated
  with check (has_permission('settings.manage'));
drop policy if exists location_documents_del on public.location_documents;
create policy location_documents_del on public.location_documents for delete to authenticated
  using (has_permission('settings.manage'));

alter table public.job_process_documents enable row level security;
drop policy if exists job_process_documents_sel on public.job_process_documents;
create policy job_process_documents_sel on public.job_process_documents for select to authenticated
  using (has_permission('jobprocess.read') or has_permission('jobprocess.manage'));
drop policy if exists job_process_documents_ins on public.job_process_documents;
create policy job_process_documents_ins on public.job_process_documents for insert to authenticated
  with check (has_permission('jobprocess.manage'));
drop policy if exists job_process_documents_del on public.job_process_documents;
create policy job_process_documents_del on public.job_process_documents for delete to authenticated
  using (has_permission('jobprocess.manage'));

grant select, insert, delete on public.transporter_documents, public.location_documents, public.job_process_documents to authenticated;
grant all on public.transporter_documents, public.location_documents, public.job_process_documents to service_role;

-- ---------------------------------------------------------------------
-- 4. Storage bucket (private, 20 MB per file) and its policies. The first
--    folder of the object path says which register the file belongs to.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('mdm-documents', 'mdm-documents', false, 20971520)
on conflict (id) do nothing;

drop policy if exists mdm_documents_storage_select on storage.objects;
create policy mdm_documents_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'mdm-documents' and (
      ((storage.foldername(name))[1] = 'transporter' and (public.has_permission('transport.read') or public.has_permission('transport.manage')))
      or ((storage.foldername(name))[1] = 'location' and (public.has_permission('lead.manage') or public.has_permission('lead.qualify') or public.has_permission('deal.read') or public.has_permission('settings.manage')))
      or ((storage.foldername(name))[1] = 'job-process' and (public.has_permission('jobprocess.read') or public.has_permission('jobprocess.manage')))
    )
  );

drop policy if exists mdm_documents_storage_insert on storage.objects;
create policy mdm_documents_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'mdm-documents' and (
      ((storage.foldername(name))[1] = 'transporter' and public.has_permission('transport.manage'))
      or ((storage.foldername(name))[1] = 'location' and public.has_permission('settings.manage'))
      or ((storage.foldername(name))[1] = 'job-process' and public.has_permission('jobprocess.manage'))
    )
  );

drop policy if exists mdm_documents_storage_delete on storage.objects;
create policy mdm_documents_storage_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'mdm-documents' and (
      ((storage.foldername(name))[1] = 'transporter' and public.has_permission('transport.manage'))
      or ((storage.foldername(name))[1] = 'location' and public.has_permission('settings.manage'))
      or ((storage.foldername(name))[1] = 'job-process' and public.has_permission('jobprocess.manage'))
    )
  );


-- ---------------------------------------------------------------------
-- Result: what is left, and the new rules in place
-- ---------------------------------------------------------------------
select
  (select count(*) from public.companies) as business_units_left,
  (select count(*) from pg_indexes where tablename = 'companies' and indexname in ('companies_name_uq','companies_gst_uq','companies_pan_uq')) as unique_indexes_expected_3,
  (select column_default from information_schema.columns where table_name = 'companies' and column_name = 'currency') as currency_default,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('transporter_documents','location_documents','job_process_documents')) as document_tables_expected_3,
  (select count(*) from storage.buckets where id = 'mdm-documents') as documents_bucket_expected_1;
