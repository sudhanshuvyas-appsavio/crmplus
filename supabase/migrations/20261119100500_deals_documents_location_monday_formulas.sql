-- CRM group alignment with monday (2026-11-19).
--
--  1. Deals: Documents (up to 10 files, like monday's Documents column).
--  2. Deals: Location (monday's map location column): address text plus the
--     captured latitude / longitude.
--  3. Total Weight and BAG commission follow monday's literal formulas:
--       Total Weight = Bags Weight x Quantity
--       BAG commission = rate x Quantity
--     When no bag weight is entered, KGs and Tons still fall back to the quantity
--     (and x1000) so existing KG / Tons rows keep working.
--  Stored values are not rewritten: a row picks the new maths up the next time it
--  is saved.

begin;

-- ---------------------------------------------------------------- 1. documents
create table if not exists public.crm_deal_documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists crm_deal_documents_deal_ix on public.crm_deal_documents (deal_id);

create or replace function public.crm_deal_documents_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from crm_deals where id = new.deal_id for update;  -- one upload at a time per deal
  if (select count(*) from crm_deal_documents where deal_id = new.deal_id) >= 10 then
    raise exception 'A deal can hold at most 10 documents; remove one first';
  end if;
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_at := now();
  return new;
end $$;
drop trigger if exists trg_crm_deal_documents_limit on public.crm_deal_documents;
create trigger trg_crm_deal_documents_limit before insert on public.crm_deal_documents
  for each row execute function public.crm_deal_documents_limit();
revoke all on function public.crm_deal_documents_limit() from public, anon, authenticated;
grant all on function public.crm_deal_documents_limit() to service_role;

alter table public.crm_deal_documents enable row level security;
drop policy if exists crm_deal_documents_sel on public.crm_deal_documents;
create policy crm_deal_documents_sel on public.crm_deal_documents for select to authenticated
  using (has_permission('deal.read'));
drop policy if exists crm_deal_documents_ins on public.crm_deal_documents;
create policy crm_deal_documents_ins on public.crm_deal_documents for insert to authenticated
  with check (has_permission('deal.create') or has_permission('deal.edit'));
drop policy if exists crm_deal_documents_del on public.crm_deal_documents;
create policy crm_deal_documents_del on public.crm_deal_documents for delete to authenticated
  using (has_permission('deal.create') or has_permission('deal.edit'));
grant select, insert, delete on public.crm_deal_documents to authenticated;
grant all on public.crm_deal_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-deal-documents', 'crm-deal-documents', false, 10485760)
on conflict (id) do nothing;
drop policy if exists crm_deal_documents_storage_select on storage.objects;
create policy crm_deal_documents_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'crm-deal-documents' and has_permission('deal.read'));
drop policy if exists crm_deal_documents_storage_insert on storage.objects;
create policy crm_deal_documents_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-deal-documents' and (has_permission('deal.create') or has_permission('deal.edit')));
drop policy if exists crm_deal_documents_storage_delete on storage.objects;
create policy crm_deal_documents_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'crm-deal-documents' and (has_permission('deal.create') or has_permission('deal.edit')));

-- ---------------------------------------------------------------- 2. location
alter table public.crm_deals
  add column if not exists location_text text,
  add column if not exists location_lat numeric,
  add column if not exists location_lng numeric;
alter table public.crm_deals drop constraint if exists crm_deals_location_check;
alter table public.crm_deals add constraint crm_deals_location_check
  check ((location_lat is null or location_lat between -90 and 90) and (location_lng is null or location_lng between -180 and 180)
         and ((location_lat is null) = (location_lng is null)));

-- ---------------------------------------------------------------- 3. monday maths
-- monday: Total Weight = {Bags Weight} * {Quantity}
create or replace function public.trade_total_weight(p_uom text, p_qty numeric, p_unit_weight numeric)
returns numeric language sql immutable set search_path = public as $$
  select case
    when p_qty is null then null
    when p_unit_weight is not null then p_qty * p_unit_weight
    when p_uom = 'KG' then p_qty
    when p_uom = 'TONS' then p_qty * 1000
    else null
  end
$$;

-- monday: IF(type="Percentage", Value*v/100, IF(type="BAG", v*Quantity, IF(type="KG", v*TotalWeight, 0)))
create or replace function public.trade_commission(p_basis text, p_value numeric, p_amount numeric, p_uom text,
                                                   p_qty numeric, p_total_weight numeric, p_unit_weight numeric)
returns numeric language sql immutable set search_path = public as $$
  select case p_basis
    when 'pct' then p_amount * p_value / 100
    when 'per_kg' then p_value * p_total_weight
    when 'per_bag' then p_value * p_qty
  end
$$;

commit;
