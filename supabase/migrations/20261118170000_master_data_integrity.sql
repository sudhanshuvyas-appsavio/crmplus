-- Master data integrity (QA run on Business Units, then applied to every register).
--
-- Run supabase/manual/20261118_business_unit_test_data_cleanup.sql FIRST: the unique
-- indexes below cannot be created while duplicate Business Units (the QA test rows)
-- exist. This file stops with a clear message if any are left.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------
-- 0. Stop early, and say why, if duplicates would block the new indexes
-- ---------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n from (
    select 1 from public.companies group by lower(btrim(name)) having count(*) > 1) d;
  if n > 0 then
    raise exception 'Business Units has % duplicate name group(s). Run the cleanup script first.', n;
  end if;

  select count(*) into n from (
    select 1 from public.companies where nullif(btrim(tax_id), '') is not null
    group by upper(btrim(tax_id)) having count(*) > 1) d;
  if n > 0 then
    raise exception 'Business Units has % duplicate GST number group(s). Run the cleanup script first.', n;
  end if;

  select count(*) into n from (
    select 1 from public.companies where nullif(btrim(pan_number), '') is not null
    group by upper(btrim(pan_number)) having count(*) > 1) d;
  if n > 0 then
    raise exception 'Business Units has % duplicate PAN group(s). Run the cleanup script first.', n;
  end if;
end $$;

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
