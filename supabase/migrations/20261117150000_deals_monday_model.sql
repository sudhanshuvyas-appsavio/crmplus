-- Deals follow the monday.com "Deals" board (CRM workspace, board 5024227507).
--
--  * Status pipeline: New Deal -> Manager Approval -> Approved | Reconsider | Closed Lost
--    (replaces Draft / Rate Discussion / Supplier Confirmed / Buyer Confirmed / Approved / Confirmed).
--  * One Final Rate (per kg) instead of separate buyer and supplier rates.
--  * Commission is per party, as on the Buyers & Suppliers board: each side has a
--    basis (Percentage / KG / BAG) and a value, copied from the party master when
--    the deal is created and editable on the deal.
--  * Total weight, deal value and both commissions are worked out the same way
--    as the monday Dispatch and Billing formulas.
--  * UOM list widened to monday's: KGs, Bags, Hanks, Bales, Carton, Chippa, Meters, Tons.
--  * Creating the Sales Confirmation from an Approved deal no longer changes the
--    deal's status; the link is kept in sales_confirmation_id.
--
-- Legacy columns (supplier_rate, buyer_rate, commission_type, margin*, supplier/buyer
-- confirmation stamps) are kept so old rows and reports still read; new code does
-- not write them, except commission_total, which stays buyer + supplier commission
-- because commission billing reads it.

begin;

-- ---------------------------------------------------------------- old rules off
drop trigger if exists trg_crm_deals_supplier_lock on public.crm_deals;
drop trigger if exists trg_crm_deals_z_approve on public.crm_deals;
drop trigger if exists trg_crm_deals_rate_track on public.crm_deals;
drop trigger if exists trg_crm_deals_derive on public.crm_deals;
drop function if exists public.crm_deals_supplier_lock();
drop function if exists public.crm_deals_approve_guard();

-- ---------------------------------------------------------------- columns
alter table public.crm_deals
  add column if not exists manager_id uuid references public.profiles(id) on delete set null,
  add column if not exists final_rate numeric,
  add column if not exists buyer_comm_basis text,
  add column if not exists buyer_comm_value numeric(12,4),
  add column if not exists supplier_comm_basis text,
  add column if not exists supplier_comm_value numeric(12,4),
  add column if not exists total_weight numeric,
  add column if not exists deal_value numeric,
  add column if not exists buyer_commission numeric,
  add column if not exists supplier_commission numeric,
  add column if not exists lost_reason text,
  add column if not exists status_changed_at timestamptz;

alter table public.crm_deals
  add constraint crm_deals_final_rate_check check (final_rate is null or final_rate >= 0),
  add constraint crm_deals_buyer_comm_basis_check check (buyer_comm_basis is null or buyer_comm_basis in ('pct','per_kg','per_bag')),
  add constraint crm_deals_supplier_comm_basis_check check (supplier_comm_basis is null or supplier_comm_basis in ('pct','per_kg','per_bag')),
  add constraint crm_deals_buyer_comm_value_check check (buyer_comm_value is null or buyer_comm_value >= 0),
  add constraint crm_deals_supplier_comm_value_check check (supplier_comm_value is null or supplier_comm_value >= 0);

alter table public.crm_deals drop constraint if exists crm_deals_uom_check;
alter table public.crm_deals add constraint crm_deals_uom_check
  check (uom in ('KG','BAGS','HANKS','BALES','CARTON','CHIPPA','METERS','TONS'));
alter table public.sales_confirmations drop constraint if exists sales_confirmations_uom_check;
alter table public.sales_confirmations add constraint sales_confirmations_uom_check
  check (uom in ('KG','BAGS','HANKS','BALES','CARTON','CHIPPA','METERS','TONS'));

-- ---------------------------------------------------------------- shared maths
-- Weight in kg: KG as is, TONS x 1000, any other unit x the per-unit weight (bag weight).
create or replace function public.trade_total_weight(p_uom text, p_qty numeric, p_unit_weight numeric)
returns numeric language sql immutable set search_path = public as $$
  select case
    when p_qty is null then null
    when p_uom = 'KG' then p_qty
    when p_uom = 'TONS' then p_qty * 1000
    else p_qty * p_unit_weight
  end
$$;

-- monday: IF(type="Percentage", Value*v/100, IF(type="BAG", v*Quantity, IF(type="KG", v*TotalWeight, 0)))
-- BAG counts bags: the quantity when the unit is BAGS, otherwise total weight / bag weight.
create or replace function public.trade_commission(p_basis text, p_value numeric, p_amount numeric, p_uom text,
                                                   p_qty numeric, p_total_weight numeric, p_unit_weight numeric)
returns numeric language sql immutable set search_path = public as $$
  select case p_basis
    when 'pct' then p_amount * p_value / 100
    when 'per_kg' then p_value * p_total_weight
    when 'per_bag' then p_value * case when p_uom = 'BAGS' then p_qty
                                       when p_unit_weight > 0 then p_total_weight / p_unit_weight end
  end
$$;

-- ---------------------------------------------------------------- data
update public.crm_deals d set
  final_rate = coalesce(d.final_rate, d.supplier_rate, d.buyer_rate),
  buyer_comm_basis = coalesce(d.buyer_comm_basis, b.commission_basis),
  buyer_comm_value = coalesce(d.buyer_comm_value, b.commission_value),
  supplier_comm_basis = coalesce(d.supplier_comm_basis, s.commission_basis),
  supplier_comm_value = coalesce(d.supplier_comm_value, s.commission_value),
  manager_id = coalesce(d.manager_id, d.approved_by),
  status = case d.status
    when 'draft' then 'new_deal'
    when 'rate_discussion' then 'new_deal'
    when 'supplier_confirmed' then 'manager_approval'
    when 'buyer_confirmed' then 'manager_approval'
    when 'confirmed' then 'approved'
    else d.status end
from public.crm_deals d0
left join public.buyer_master b on b.id = d0.buyer_id
left join public.supplier_master s on s.id = d0.supplier_id
where d0.id = d.id;

update public.crm_deals set
  total_weight = public.trade_total_weight(uom, quantity, bag_weight),
  deal_value = public.trade_total_weight(uom, quantity, bag_weight) * final_rate;
update public.crm_deals set
  buyer_commission = public.trade_commission(buyer_comm_basis, buyer_comm_value, deal_value, uom, quantity, total_weight, bag_weight),
  supplier_commission = public.trade_commission(supplier_comm_basis, supplier_comm_value, deal_value, uom, quantity, total_weight, bag_weight);
-- Deals priced under the old fixed commission codes keep their commission_total:
-- orders and commission bills already in progress were worked out from it.
update public.crm_deals set
  commission_total = case when buyer_commission is null and supplier_commission is null then commission_total
                          else coalesce(buyer_commission,0) + coalesce(supplier_commission,0) end
where commission_type is null;

alter table public.crm_deals alter column status set default 'new_deal';
alter table public.crm_deals add constraint crm_deals_status_check
  check (status in ('new_deal','manager_approval','approved','reconsider','closed_lost'));

-- ---------------------------------------------------------------- derive
create or replace function public.crm_deals_derive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.deal_no is null then new.deal_no := 'DL-'||to_char(now(),'YYYY')||'-'||lpad(nextval('crm_deal_seq')::text,4,'0'); end if;
    if new.company_id is null then select id into new.company_id from companies where is_home and is_active limit 1; end if;
    if new.final_rate is null then new.final_rate := coalesce(new.supplier_rate, new.buyer_rate); end if;
  end if;
  -- commission terms follow the party master unless set on the deal
  if new.buyer_comm_basis is null or (tg_op = 'UPDATE' and new.buyer_id is distinct from old.buyer_id
      and new.buyer_comm_basis is not distinct from old.buyer_comm_basis and new.buyer_comm_value is not distinct from old.buyer_comm_value) then
    select commission_basis, commission_value into new.buyer_comm_basis, new.buyer_comm_value from buyer_master where id = new.buyer_id;
  end if;
  if new.supplier_id is null then
    if tg_op = 'UPDATE' and old.supplier_id is not null then new.supplier_comm_basis := null; new.supplier_comm_value := null; end if;
  elsif new.supplier_comm_basis is null or (tg_op = 'UPDATE' and new.supplier_id is distinct from old.supplier_id
      and new.supplier_comm_basis is not distinct from old.supplier_comm_basis and new.supplier_comm_value is not distinct from old.supplier_comm_value) then
    select commission_basis, commission_value into new.supplier_comm_basis, new.supplier_comm_value from supplier_master where id = new.supplier_id;
  end if;
  select gst into new.buyer_gst from buyer_master where id = new.buyer_id;
  new.supplier_gst := null;
  if new.supplier_id is not null then select gst into new.supplier_gst from supplier_master where id = new.supplier_id; end if;

  new.total_weight := trade_total_weight(new.uom, new.quantity, new.bag_weight);
  new.deal_value := new.total_weight * new.final_rate;
  new.buyer_commission := trade_commission(new.buyer_comm_basis, new.buyer_comm_value, new.deal_value, new.uom, new.quantity, new.total_weight, new.bag_weight);
  new.supplier_commission := trade_commission(new.supplier_comm_basis, new.supplier_comm_value, new.deal_value, new.uom, new.quantity, new.total_weight, new.bag_weight);
  if new.commission_type is not null then
    -- legacy deal (old fixed commission code): billing already uses this amount
    new.commission_total := case when tg_op = 'UPDATE' then old.commission_total else new.commission_total end;
  else
    new.commission_total := case when new.buyer_commission is null and new.supplier_commission is null then null
                                 else coalesce(new.buyer_commission,0) + coalesce(new.supplier_commission,0) end;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- status rules
create or replace function public.crm_deals_status_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare linking boolean := coalesce(current_setting('app.confirming', true),'') = '1';
begin
  -- stamps only the database writes
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
        if new.supplier_id is null then raise exception 'Choose the supplier before sending the deal for approval'; end if;
        if new.final_rate is null or new.final_rate <= 0 then raise exception 'Enter the final rate before sending the deal for approval'; end if;
      when 'approved' then
        if not has_permission('deal.approve') then raise exception 'You need the "Approve deals" permission to approve a deal'; end if;
        if old.status <> 'manager_approval' then raise exception 'Only a deal in Manager Approval can be approved'; end if;
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

-- ---------------------------------------------------------------- change history
create or replace function public.crm_deals_rate_track() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.final_rate is distinct from old.final_rate then
    insert into deal_changes(deal_id, field, old_value, new_value) values (new.id, 'final_rate', old.final_rate::text, new.final_rate::text); end if;
  if new.buyer_comm_basis is distinct from old.buyer_comm_basis or new.buyer_comm_value is distinct from old.buyer_comm_value then
    insert into deal_changes(deal_id, field, old_value, new_value)
    values (new.id, 'buyer_commission', concat_ws(' ', old.buyer_comm_value::text, old.buyer_comm_basis), concat_ws(' ', new.buyer_comm_value::text, new.buyer_comm_basis)); end if;
  if new.supplier_comm_basis is distinct from old.supplier_comm_basis or new.supplier_comm_value is distinct from old.supplier_comm_value then
    insert into deal_changes(deal_id, field, old_value, new_value)
    values (new.id, 'supplier_commission', concat_ws(' ', old.supplier_comm_value::text, old.supplier_comm_basis), concat_ws(' ', new.supplier_comm_value::text, new.supplier_comm_basis)); end if;
  if new.freight is distinct from old.freight then
    insert into deal_changes(deal_id, field, old_value, new_value) values (new.id, 'freight', old.freight, new.freight); end if;
  if new.price_basis is distinct from old.price_basis then
    insert into deal_changes(deal_id, field, old_value, new_value) values (new.id, 'price_basis', old.price_basis, new.price_basis); end if;
  if new.status is distinct from old.status then
    insert into deal_changes(deal_id, field, old_value, new_value) values (new.id, 'status', old.status, new.status); end if;
  return new;
end $$;

-- order matters: derive (d) -> status guard (s) -> history (t), all BEFORE UPDATE, fired alphabetically
create trigger trg_crm_deals_d_derive before insert or update on public.crm_deals for each row execute function public.crm_deals_derive();
create trigger trg_crm_deals_s_status before update on public.crm_deals for each row execute function public.crm_deals_status_guard();
create trigger trg_crm_deals_t_track before update on public.crm_deals for each row execute function public.crm_deals_rate_track();

-- ---------------------------------------------------------------- Sales Confirmation from a deal
create or replace function public.deal_confirm_problems(p_deal uuid) returns text[]
language plpgsql stable security definer set search_path = public as $_$
declare d crm_deals; s supplier_master; b buyer_master; p text[] := '{}'; gstre text := '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
begin
  select * into d from crm_deals where id = p_deal;
  if not found then return array['Deal not found']; end if;
  if d.sales_confirmation_id is not null then return array['This deal already has a Sales Confirmation']; end if;
  if d.status <> 'approved' then p := array_append(p, 'The deal is not Approved'); end if;
  if d.supplier_id is null then p := array_append(p, 'Supplier is missing'); end if;
  if d.company_id is null then p := array_append(p, 'Internal company is missing'); end if;
  if d.count_id is null then p := array_append(p, 'Count is missing'); end if;
  if d.quantity is null or d.quantity <= 0 then p := array_append(p, 'Quantity is missing'); end if;
  if d.final_rate is null or d.final_rate <= 0 then p := array_append(p, 'Final rate is missing'); end if;
  if d.payment_term_id is null then p := array_append(p, 'Payment term is missing'); end if;
  if d.uom not in ('KG','TONS') and (d.bag_weight is null or d.bag_weight <= 0) then p := array_append(p, 'Bag weight is missing'); end if;
  select * into s from supplier_master where id = d.supplier_id;
  if found then
    if coalesce(s.gst,'') !~ gstre then p := array_append(p, 'Supplier GST is missing or not valid'); end if;
    if not s.is_active then p := array_append(p, 'Supplier is inactive'); end if;
    if s.company_id is null then p := array_append(p, 'Supplier is not linked to a company'); end if;
  end if;
  select * into b from buyer_master where id = d.buyer_id;
  if found then
    if coalesce(b.gst,'') !~ gstre then p := array_append(p, 'Buyer GST is missing or not valid'); end if;
    if not b.is_active then p := array_append(p, 'Buyer is inactive'); end if;
    if b.company_id is null then p := array_append(p, 'Buyer is not linked to a company'); end if;
  end if;
  if exists (select 1 from count_master c where c.id = d.count_id and not c.is_active) then p := array_append(p, 'Count is inactive'); end if;
  return p;
end $_$;

create or replace function public.confirm_deal(p_deal uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d crm_deals; p text[]; sc uuid;
begin
  if not (has_permission('deal.edit') or has_permission('deal.create') or has_permission('deal.approve')) then
    raise exception 'You do not have permission to create a Sales Confirmation from a deal';
  end if;
  p := deal_confirm_problems(p_deal);
  if array_length(p,1) > 0 then raise exception 'Cannot create the Sales Confirmation: %', array_to_string(p, '; '); end if;
  select * into d from crm_deals where id = p_deal for update;
  insert into sales_confirmations(deal_id, company_id, supplier_id, buyer_id, count_id, uom, quantity, net_quantity, freight, price_basis, bag_weight,
                                  rate, buyer_rate, supplier_rate, commission_type, commission_value, payment_term_id)
  values (d.id, d.company_id, d.supplier_id, d.buyer_id, d.count_id, d.uom, d.quantity, d.quantity, d.freight, coalesce(d.price_basis,'ex_mill'), d.bag_weight,
          d.final_rate, d.final_rate, d.final_rate, null, null, d.payment_term_id)
  returning id into sc;
  perform set_config('app.confirming', '1', true);
  update crm_deals set confirmed_at = now(), confirmed_by = auth.uid(), sales_confirmation_id = sc where id = d.id;
  perform set_config('app.confirming', '', true);
  return sc;
end $$;

create or replace function public.create_order(p_deal uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d crm_deals; o uuid;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select * into d from crm_deals where id = p_deal;
  if not found then raise exception 'Deal not found'; end if;
  if d.sales_confirmation_id is null then raise exception 'An order can only be created from a deal that has a Sales Confirmation'; end if;
  if exists (select 1 from orders where deal_id = d.id) then raise exception 'This deal already has an order'; end if;
  insert into orders(deal_id, sales_confirmation_id, buyer_id, supplier_id, company_id, count_id, quantity, uom, buyer_rate, supplier_rate,
    commission_type, commission_value, price_basis, freight, bag_weight, payment_term_id)
  values (d.id, d.sales_confirmation_id, d.buyer_id, d.supplier_id, d.company_id, d.count_id, d.quantity, d.uom, d.final_rate, d.final_rate,
    null, null, d.price_basis, d.freight, d.bag_weight, d.payment_term_id)
  returning id into o;
  return o;
end $$;

-- ---------------------------------------------------------------- dashboard + RLS
create or replace function public.sales_followup_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t date := (now() at time zone 'Asia/Kolkata')::date;
  ms date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  pms date := (date_trunc('month', (now() at time zone 'Asia/Kolkata')) - interval '1 month')::date;
  nms date := (date_trunc('month', (now() at time zone 'Asia/Kolkata')) + interval '1 month')::date;
  res jsonb := jsonb_build_object('as_of', t, 'month_start', ms);
  a int; b int; c numeric; d numeric; e int; f numeric;
begin
  if has_permission('lead.manage') or has_permission('lead.qualify') then
    select count(*), count(*) filter (where follow_up_date < t), count(*) filter (where status='new'), count(*) filter (where follow_up_date is null)
      into a, b, e, f from leads where status in ('new','contacted') and converted_deal_id is null;
    res := res || jsonb_build_object('leads', jsonb_build_object('pending', a, 'overdue_follow_up', b, 'new', e, 'no_follow_up_date', f));
  end if;
  if has_permission('deal.read') then
    select count(*), count(*) filter (where created_at::date < t - 7) into a, b
      from crm_deals where sales_confirmation_id is null and status <> 'closed_lost';
    res := res || jsonb_build_object('confirmations', jsonb_build_object('pending', a, 'older_than_7_days', b,
      'by_stage', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from crm_deals
                            where sales_confirmation_id is null and status <> 'closed_lost' group by 1) s), '{}'::jsonb)));
  end if;
  if has_permission('order.read') or has_permission('order.manage') then
    select count(*), count(*) filter (where tentative_dispatch_date < t), coalesce(sum(bal),0) into a, b, c
    from (select o.tentative_dispatch_date, o.quantity - coalesce((select sum(x.quantity) from order_dispatches x where x.order_id=o.id),0) bal
          from orders o where o.status in ('confirmed','open_for_execution')) q where bal > 0;
    res := res || jsonb_build_object('dispatch', jsonb_build_object('pending', a, 'overdue', b, 'balance_qty', c));
  end if;
  if has_permission('order.manage') or has_permission('report.view') then
    select coalesce(sum(amount) filter (where invoice_date >= ms and invoice_date < nms),0), count(*) filter (where invoice_date >= ms and invoice_date < nms),
           coalesce(sum(amount) filter (where invoice_date >= pms and invoice_date < ms),0)
      into c, a, d from commission_invoices;
    res := res || jsonb_build_object('revenue', jsonb_build_object('this_month', c, 'invoices', a, 'last_month', d));
  end if;
  return res;
end $$;

drop policy if exists deals_del on public.crm_deals;
create policy deals_del on public.crm_deals for delete to authenticated
  using (status = 'new_deal' and sales_confirmation_id is null and has_permission('deal.create'));

-- ---------------------------------------------------------------- grants (match 20261104: no PUBLIC execute on definer functions)
revoke all on function public.crm_deals_derive() from public;
revoke all on function public.crm_deals_status_guard() from public;
revoke all on function public.crm_deals_rate_track() from public;
grant all on function public.crm_deals_derive() to service_role;
grant all on function public.crm_deals_status_guard() to service_role;
grant all on function public.crm_deals_rate_track() to service_role;
grant execute on function public.trade_total_weight(text, numeric, numeric) to authenticated, service_role;
grant execute on function public.trade_commission(text, numeric, numeric, text, numeric, numeric, numeric) to authenticated, service_role;

commit;
