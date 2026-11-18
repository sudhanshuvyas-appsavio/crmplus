-- Lead's change list "Commissioning Business - Changes needed" (CRM part),
-- applied where it agrees with the monday.com CRM; monday wins where they
-- differ (one count per deal, first deal status "New Deal", no Draft).
-- Runs after 20261117180000.
--
--  * Lead -> Deal: when a lead changes to Qualified, a deal is created once
--    (status New Deal, owner = the user who qualified it; buyer, supplier,
--    count, quantity and unit copied; rates left blank). "Convert to deal" on
--    a lead that already has one returns the existing deal.
--  * A deal may start without a buyer (e.g. a supplier lead); the buyer must be
--    picked from Buyers & Suppliers before it goes for Manager Approval.
--  * Deal -> Sales Confirmation: when a deal changes to Approved, its Sales
--    Confirmation is created once and linked both ways (monday automation
--    "status changes -> create item in Sales Confirmation and connect").
--  * Sales Confirmation buyer documents: up to 10 files (monday "Buyer Document").
--  * Leads: Lead Type (Existing / New), Lead Source, follow-up date AND time,
--    timeline as a from-to date range, mobile country code (+91 default), all
--    8 monday units.

begin;

-- =====================================================================
-- 1. Deals: buyer optional until Manager Approval
-- =====================================================================
alter table public.crm_deals alter column buyer_id drop not null;

create or replace function public.crm_deals_status_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare linking boolean := coalesce(current_setting('app.confirming', true),'') = '1';
begin
  new.approved_at := old.approved_at; new.approved_by := old.approved_by;
  new.supplier_confirmed_at := old.supplier_confirmed_at; new.supplier_confirmed_by := old.supplier_confirmed_by;
  new.buyer_confirmed_at := old.buyer_confirmed_at; new.buyer_confirmed_by := old.buyer_confirmed_by;
  new.approval_margin_pct := old.approval_margin_pct;
  if not linking then
    new.sales_confirmation_id := old.sales_confirmation_id;
    new.confirmed_at := old.confirmed_at; new.confirmed_by := old.confirmed_by;
  end if;
  new.status_changed_at := old.status_changed_at;

  if new.status is distinct from old.status then
    if old.status = 'approved' then
      if not is_admin() then raise exception 'Only an administrator can move an Approved deal back'; end if;
      if old.sales_confirmation_id is not null then raise exception 'This deal already has a Sales Confirmation and cannot leave Approved'; end if;
    end if;
    case new.status
      when 'manager_approval' then
        if old.status not in ('new_deal','reconsider','approved') then raise exception 'Only a New Deal or one sent to Reconsider can go for Manager Approval'; end if;
        if new.buyer_id is null then raise exception 'Pick the buyer from Buyers & Suppliers before sending the deal for approval'; end if;
        if new.supplier_id is null then raise exception 'Choose the supplier before sending the deal for approval'; end if;
        if new.final_rate is null or new.final_rate <= 0 then raise exception 'Enter the final rate before sending the deal for approval'; end if;
      when 'approved' then
        if not has_permission('deal.approve') then raise exception 'You need the "Approve deals" permission to approve a deal'; end if;
        if old.status <> 'manager_approval' then raise exception 'Only a deal in Manager Approval can be approved'; end if;
        if new.buyer_id is null or new.supplier_id is null or new.final_rate is null or new.final_rate <= 0 then
          raise exception 'The buyer, supplier and final rate are needed before approval';
        end if;
        new.approved_at := now(); new.approved_by := auth.uid();
        new.manager_id := coalesce(new.manager_id, auth.uid());
      when 'reconsider' then
        if not has_permission('deal.approve') then raise exception 'You need the "Approve deals" permission to send a deal back'; end if;
        if old.status <> 'manager_approval' then raise exception 'Only a deal in Manager Approval can be sent to Reconsider'; end if;
      when 'closed_lost' then
        null;
      when 'new_deal' then
        null;
      else
        raise exception 'Unknown deal status %', new.status;
    end case;
    if new.status <> 'approved' then new.approved_at := null; new.approved_by := null; end if;
    if new.status <> 'closed_lost' then new.lost_reason := null; end if;
    new.status_changed_at := now();
  elsif old.status = 'approved' and not linking and (
       new.buyer_id is distinct from old.buyer_id or new.supplier_id is distinct from old.supplier_id
    or new.company_id is distinct from old.company_id or new.count_id is distinct from old.count_id
    or new.quantity is distinct from old.quantity or new.uom is distinct from old.uom or new.bag_weight is distinct from old.bag_weight
    or new.final_rate is distinct from old.final_rate or new.payment_term_id is distinct from old.payment_term_id
    or new.freight is distinct from old.freight or new.price_basis is distinct from old.price_basis
    or new.buyer_comm_basis is distinct from old.buyer_comm_basis or new.buyer_comm_value is distinct from old.buyer_comm_value
    or new.supplier_comm_basis is distinct from old.supplier_comm_basis or new.supplier_comm_value is distinct from old.supplier_comm_value) then
    raise exception 'This deal is Approved and its terms are locked';
  end if;
  return new;
end $$;

-- =====================================================================
-- 2. Deal -> Sales Confirmation, automatically on Approved
-- =====================================================================
create or replace function public.sc_from_deal(p_deal uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d crm_deals; sc uuid; prev text := coalesce(current_setting('app.confirming', true),'');
begin
  select * into d from crm_deals where id = p_deal for update;
  if not found then raise exception 'Deal not found'; end if;
  if d.sales_confirmation_id is not null then return d.sales_confirmation_id; end if;
  insert into sales_confirmations(deal_id, company_id, supplier_id, buyer_id, count_id, uom, quantity, net_quantity, freight, price_basis, bag_weight,
                                  rate, buyer_rate, supplier_rate, commission_type, commission_value, payment_term_id,
                                  buyer_comm_basis, buyer_comm_value, supplier_comm_basis, supplier_comm_value)
  values (d.id, d.company_id, d.supplier_id, d.buyer_id, d.count_id, d.uom, d.quantity, d.quantity, d.freight, coalesce(d.price_basis,'ex_mill'), d.bag_weight,
          d.final_rate, d.final_rate, d.final_rate, null, null, d.payment_term_id,
          d.buyer_comm_basis, d.buyer_comm_value, d.supplier_comm_basis, d.supplier_comm_value)
  returning id into sc;
  perform set_config('app.confirming', '1', true);
  update crm_deals set confirmed_at = now(), confirmed_by = auth.uid(), sales_confirmation_id = sc where id = d.id;
  perform set_config('app.confirming', prev, true);
  return sc;
end $$;

create or replace function public.crm_deals_auto_sc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.sales_confirmation_id is null then
    perform sc_from_deal(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_crm_deals_auto_sc on public.crm_deals;
create trigger trg_crm_deals_auto_sc after update of status on public.crm_deals for each row execute function public.crm_deals_auto_sc();

-- "Create Sales Confirmation" for an Approved deal that has none (approved before this change)
create or replace function public.confirm_deal(p_deal uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d crm_deals;
begin
  if not (has_permission('deal.edit') or has_permission('deal.create') or has_permission('deal.approve') or has_permission('sc.manage')) then
    raise exception 'You do not have permission to create a Sales Confirmation from a deal';
  end if;
  select * into d from crm_deals where id = p_deal;
  if not found then raise exception 'Deal not found'; end if;
  if d.sales_confirmation_id is not null then return d.sales_confirmation_id; end if;
  if d.status <> 'approved' then raise exception 'Only an Approved deal can have a Sales Confirmation'; end if;
  return sc_from_deal(p_deal);
end $$;

create or replace function public.deal_confirm_problems(p_deal uuid) returns text[]
language plpgsql stable security definer set search_path = public as $_$
declare d crm_deals; s supplier_master; b buyer_master; p text[] := '{}'; gstre text := '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
begin
  select * into d from crm_deals where id = p_deal;
  if not found then return array['Deal not found']; end if;
  if d.sales_confirmation_id is not null then return array['This deal already has a Sales Confirmation']; end if;
  if d.status <> 'approved' then p := array_append(p, 'The deal is not Approved'); end if;
  if d.buyer_id is null then p := array_append(p, 'Buyer is missing'); end if;
  if d.supplier_id is null then p := array_append(p, 'Supplier is missing'); end if;
  if d.count_id is null then p := array_append(p, 'Count is missing'); end if;
  if d.quantity is null or d.quantity <= 0 then p := array_append(p, 'Quantity is missing'); end if;
  if d.final_rate is null or d.final_rate <= 0 then p := array_append(p, 'Final rate is missing'); end if;
  if d.payment_term_id is null then p := array_append(p, 'Payment term is missing'); end if;
  if d.uom not in ('KG','TONS') and (d.bag_weight is null or d.bag_weight <= 0) then p := array_append(p, 'Bag weight is missing'); end if;
  select * into s from supplier_master where id = d.supplier_id;
  if found then
    if coalesce(s.gst,'') !~ gstre then p := array_append(p, 'Supplier GST is missing or not valid'); end if;
    if s.company_id is null then p := array_append(p, 'Supplier is not linked to a company'); end if;
  end if;
  select * into b from buyer_master where id = d.buyer_id;
  if found then
    if coalesce(b.gst,'') !~ gstre then p := array_append(p, 'Buyer GST is missing or not valid'); end if;
    if b.company_id is null then p := array_append(p, 'Buyer is not linked to a company'); end if;
  end if;
  return p;
end $_$;

-- =====================================================================
-- 3. Sales Confirmation buyer documents (up to 10)
-- =====================================================================
create table if not exists public.sc_documents (
  id uuid primary key default gen_random_uuid(),
  sc_id uuid not null references public.sales_confirmations(id) on delete cascade,
  kind text not null default 'buyer' check (kind in ('buyer','supplier','other')),
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists sc_documents_sc_ix on public.sc_documents (sc_id);

create or replace function public.sc_documents_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from sales_confirmations where id = new.sc_id for update;  -- one upload at a time per confirmation
  if (select count(*) from sc_documents where sc_id = new.sc_id) >= 10 then
    raise exception 'A confirmation can hold at most 10 documents; remove one first';
  end if;
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_at := now();
  return new;
end $$;
drop trigger if exists trg_sc_documents_limit on public.sc_documents;
create trigger trg_sc_documents_limit before insert on public.sc_documents for each row execute function public.sc_documents_limit();

alter table public.sc_documents enable row level security;
create policy sc_documents_sel on public.sc_documents for select to authenticated using (has_permission('sc.read') or has_permission('sc.manage'));
create policy sc_documents_ins on public.sc_documents for insert to authenticated with check (has_permission('sc.manage'));
create policy sc_documents_del on public.sc_documents for delete to authenticated using (has_permission('sc.manage'));
grant select, insert, delete on public.sc_documents to authenticated;
grant all on public.sc_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('sc-documents', 'sc-documents', false, 10485760)
on conflict (id) do nothing;
drop policy if exists sc_documents_storage_select on storage.objects;
create policy sc_documents_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'sc-documents' and (public.has_permission('sc.read') or public.has_permission('sc.manage')));
drop policy if exists sc_documents_storage_insert on storage.objects;
create policy sc_documents_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sc-documents' and public.has_permission('sc.manage'));
drop policy if exists sc_documents_storage_delete on storage.objects;
create policy sc_documents_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sc-documents' and public.has_permission('sc.manage'));

-- =====================================================================
-- 4. Leads: type, source, follow-up time, timeline range, phone code, units,
--    and the automatic deal on Qualified
-- =====================================================================
alter table public.leads
  add column if not exists lead_type text not null default 'new',
  add column if not exists lead_source text,
  add column if not exists follow_up_at timestamptz,
  add column if not exists timeline_from date,
  add column if not exists timeline_to date,
  add column if not exists mobile_cc text not null default '+91';
alter table public.leads
  add constraint leads_lead_type_check check (lead_type in ('existing','new')),
  add constraint leads_timeline_range_check check (timeline_from is null or timeline_to is null or timeline_to >= timeline_from),
  add constraint leads_mobile_cc_check check (mobile_cc ~ '^\+[0-9]{1,4}$');
alter table public.leads drop constraint if exists leads_uom_check;
alter table public.leads add constraint leads_uom_check
  check (uom is null or uom in ('KG','BAGS','HANKS','BALES','CARTON','CHIPPA','METERS','TONS'));
alter table public.leads drop constraint if exists leads_mobile_check;
alter table public.leads add constraint leads_mobile_check
  check (mobile is null or (mobile_cc = '+91' and mobile ~ '^[0-9]{10}$') or (mobile_cc <> '+91' and mobile ~ '^[0-9]{6,14}$'));

-- existing leads tied to a master record count as "Existing"; the lock on
-- converted leads must not stop this one-off fill
alter table public.leads disable trigger user;
update public.leads set lead_type = 'existing' where buyer_id is not null or supplier_id is not null;
alter table public.leads enable trigger user;

create or replace function public.leads_follow_up_sync() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.follow_up_at is not null then
    new.follow_up_date := (new.follow_up_at at time zone 'Asia/Kolkata')::date;
  elsif tg_op = 'UPDATE' and old.follow_up_at is not null and new.follow_up_date is not distinct from old.follow_up_date then
    new.follow_up_date := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_leads_follow_up_sync on public.leads;
create trigger trg_leads_follow_up_sync before insert or update on public.leads for each row execute function public.leads_follow_up_sync();

create or replace function public.lead_create_deal(p_lead uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare l leads%rowtype; d uuid; n text;
begin
  select * into l from leads where id = p_lead for update;
  if not found then raise exception 'Lead not found'; end if;
  if l.converted_deal_id is not null then return l.converted_deal_id; end if;
  select id into d from crm_deals where lead_id = l.id;
  if d is null then
    if l.count_id is null or l.quantity is null then raise exception 'The lead needs a count and a quantity before it can become a deal'; end if;
    n := concat_ws(' | ', 'From lead '||l.lead_no, nullif(l.remarks,''),
                   case when l.expected_rate is not null then 'Expected rate '||l.expected_rate end,
                   case when l.timeline_from is not null or l.timeline_to is not null
                          then 'Timeline '||coalesce(to_char(l.timeline_from,'DD Mon YYYY'),'?')||' to '||coalesce(to_char(l.timeline_to,'DD Mon YYYY'),'?')
                        when coalesce(l.timeline,'') <> '' then 'Timeline: '||l.timeline end);
    insert into crm_deals(lead_id, status, buyer_id, supplier_id, count_id, quantity, uom, notes, owner_id, created_by)
    values (l.id, 'new_deal', l.buyer_id, l.supplier_id, l.count_id, l.quantity, coalesce(l.uom,'KG'), n,
            coalesce(auth.uid(), l.sales_staff_id), auth.uid())
    returning id into d;
    insert into activity_log(entity_type, entity_id, kind, note) values ('deal', d, 'note', 'Created from lead '||l.lead_no);
  end if;
  update leads set converted_deal_id = d, converted_at = now() where id = l.id;
  return d;
end $$;

create or replace function public.leads_auto_deal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'qualified' and (tg_op = 'INSERT' or old.status is distinct from 'qualified') and new.converted_deal_id is null then
    perform lead_create_deal(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_leads_z_auto_deal on public.leads;
create trigger trg_leads_z_auto_deal after insert or update of status on public.leads for each row execute function public.leads_auto_deal();

-- "Convert to deal": the existing deal if there is one, else a new one
create or replace function public.convert_lead_to_deal(p_lead uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare l leads%rowtype;
begin
  select * into l from leads where id = p_lead;
  if not found then raise exception 'Lead not found'; end if;
  if l.converted_deal_id is not null then return l.converted_deal_id; end if;
  if not has_permission('deal.create') then raise exception 'You do not have permission to create deals'; end if;
  if not (has_permission('lead.manage') or has_permission('lead.qualify')) then raise exception 'You do not have permission to convert leads'; end if;
  if l.status <> 'qualified' then raise exception 'Only a Qualified lead can be converted to a deal'; end if;
  return lead_create_deal(p_lead);
end $$;

-- =====================================================================
-- 5. grants: trigger / internal functions are not callable over the API
-- =====================================================================
do $$
declare f text;
begin
  foreach f in array array['crm_deals_status_guard()','sc_from_deal(uuid)','crm_deals_auto_sc()','sc_documents_limit()',
                           'leads_follow_up_sync()','lead_create_deal(uuid)','leads_auto_deal()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant all on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.confirm_deal(uuid) from public, anon;
grant execute on function public.confirm_deal(uuid) to authenticated, service_role;
revoke all on function public.convert_lead_to_deal(uuid) from public, anon;
grant execute on function public.convert_lead_to_deal(uuid) to authenticated, service_role;
revoke all on function public.deal_confirm_problems(uuid) from public, anon;
grant execute on function public.deal_confirm_problems(uuid) to authenticated, service_role;

commit;
