-- Dispatch and Billing follows the monday.com "Dispatch and Billing" board (board 5026792171).
-- Runs after 20261117160000_sales_confirmation_monday.
--
-- The orders table now holds the Dispatch and Billing items and order_dispatches
-- their dispatch entries (monday subitems). Other screens (pending dispatches,
-- mill invoices, transport, collections, commission bills) keep reading the same
-- tables, so they keep working.
--
--  * Created straight from a Sales Confirmation (create_dispatch_bill); the
--    separate "confirm order" step is gone: Draft -> Start dispatch.
--  * Status: Draft / In Progress / Partially Dispatched / Fully Dispatched /
--    Cancelled / Returned, worked out from the dispatch entries and SC returns.
--  * Billing: invoice no./date, CGST %, insurance %, add, deduct, round off,
--    transport type, transport company, vehicle, driver phone, person.
--  * Each item and each dispatch entry carries total weight, value, buyer and
--    supplier commission and total amount (monday formulas):
--      total weight = weight of the quantity (KG / TONS / x bag weight)
--      value        = total weight x final rate
--      commission   = Percentage of value | per KG of weight | per BAG
--      total amount = value + value x CGST% + value x insurance% + add - deduct
--  * A Sales Confirmation can be created without a deal, so deal_id is optional.

begin;

-- ---------------------------------------------------------------- items (orders)
alter table public.orders alter column deal_id drop not null;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('draft','confirmed','open_for_execution','closed','cancelled'));

alter table public.orders
  add column if not exists dispatch_status text not null default 'draft',
  add column if not exists dispatched_qty numeric not null default 0,
  add column if not exists invoice_no text,
  add column if not exists invoice_date date,
  add column if not exists sale_type text not null default 'local',
  add column if not exists transport_type text,
  add column if not exists transporter_id uuid references public.transporters(id) on delete set null,
  add column if not exists vehicle_no text,
  add column if not exists driver_phone text,
  add column if not exists person_id uuid references public.profiles(id) on delete set null,
  add column if not exists final_rate numeric,
  add column if not exists buyer_comm_basis text,
  add column if not exists buyer_comm_value numeric(12,4),
  add column if not exists supplier_comm_basis text,
  add column if not exists supplier_comm_value numeric(12,4),
  add column if not exists total_weight numeric,
  add column if not exists order_value numeric,
  add column if not exists buyer_commission numeric,
  add column if not exists supplier_commission numeric,
  add column if not exists cgst_pct numeric(6,3),
  add column if not exists insurance_pct numeric(6,3),
  add column if not exists add_amount numeric,
  add column if not exists deduct_amount numeric,
  add column if not exists round_off numeric,
  add column if not exists total_amount numeric,
  add column if not exists cancelled_at timestamptz;

alter table public.orders
  add constraint orders_dispatch_status_check check (dispatch_status in ('draft','in_progress','partially_dispatched','fully_dispatched','cancelled','returned')),
  add constraint orders_sale_type_check check (sale_type in ('local','export')),
  add constraint orders_transport_type_check check (transport_type is null or transport_type in ('own','agreed_third_party','third_party_direct')),
  add constraint orders_buyer_comm_basis_check check (buyer_comm_basis is null or buyer_comm_basis in ('pct','per_kg','per_bag')),
  add constraint orders_supplier_comm_basis_check check (supplier_comm_basis is null or supplier_comm_basis in ('pct','per_kg','per_bag')),
  add constraint orders_pct_check check ((cgst_pct is null or cgst_pct between 0 and 100) and (insurance_pct is null or insurance_pct between 0 and 100)),
  add constraint orders_adjust_check check ((add_amount is null or add_amount >= 0) and (deduct_amount is null or deduct_amount >= 0));

-- ---------------------------------------------------------------- dispatch entries
alter table public.order_dispatches
  add column if not exists invoice_date date,
  add column if not exists dc_no text,
  add column if not exists delivery_date date,
  add column if not exists transport_type text,
  add column if not exists person_id uuid references public.profiles(id) on delete set null,
  add column if not exists total_weight numeric,
  add column if not exists entry_value numeric,
  add column if not exists buyer_commission numeric,
  add column if not exists supplier_commission numeric,
  add column if not exists cgst_pct numeric(6,3),
  add column if not exists insurance_pct numeric(6,3),
  add column if not exists add_amount numeric,
  add column if not exists deduct_amount numeric,
  add column if not exists round_off numeric,
  add column if not exists total_amount numeric;

alter table public.order_dispatches
  add constraint od_transport_type_check check (transport_type is null or transport_type in ('own','agreed_third_party','third_party_direct')),
  add constraint od_pct_check check ((cgst_pct is null or cgst_pct between 0 and 100) and (insurance_pct is null or insurance_pct between 0 and 100)),
  add constraint od_adjust_check check ((add_amount is null or add_amount >= 0) and (deduct_amount is null or deduct_amount >= 0));

-- ---------------------------------------------------------------- maths
create or replace function public.trade_total_amount(p_value numeric, p_cgst numeric, p_ins numeric, p_add numeric, p_deduct numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when p_value is null then null else
    p_value + p_value * coalesce(p_cgst,0) / 100 + p_value * coalesce(p_ins,0) / 100 + coalesce(p_add,0) - coalesce(p_deduct,0) end
$$;
grant execute on function public.trade_total_amount(numeric, numeric, numeric, numeric, numeric) to authenticated, service_role;

-- Status from what has happened: cancelled > returned > dispatched quantity > opened.
create or replace function public.order_dispatch_status(p_status text, p_qty numeric, p_disp numeric, p_returned boolean)
returns text language sql immutable set search_path = public as $$
  select case
    when p_status = 'cancelled' then 'cancelled'
    when p_returned then 'returned'
    when p_disp >= p_qty and p_disp > 0 then 'fully_dispatched'
    when p_disp > 0 then 'partially_dispatched'
    when p_status in ('open_for_execution','closed','confirmed') then 'in_progress'
    else 'draft' end
$$;

-- Commission billed for an item: the item's own buyer + supplier commission,
-- or, for items made under the old fixed commission codes, the deal's total.
create or replace function public.order_commission_amount(p_order uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case when o.buyer_commission is not null or o.supplier_commission is not null
              then coalesce(o.buyer_commission,0) + coalesce(o.supplier_commission,0)
              else d.commission_total end
  from orders o left join crm_deals d on d.id = o.deal_id where o.id = p_order
$$;
revoke all on function public.order_commission_amount(uuid) from public, anon;
grant execute on function public.order_commission_amount(uuid) to authenticated, service_role;

create or replace function public.orders_derive() returns trigger
language plpgsql security definer set search_path = public as $$
declare ret boolean;
begin
  new.vehicle_no := nullif(btrim(new.vehicle_no), '');
  new.driver_phone := nullif(btrim(new.driver_phone), '');
  new.invoice_no := nullif(btrim(new.invoice_no), '');
  if new.final_rate is null then new.final_rate := new.supplier_rate; end if;
  new.total_weight := trade_total_weight(new.uom, new.quantity, new.bag_weight);
  new.order_value := new.total_weight * new.final_rate;
  new.buyer_commission := trade_commission(new.buyer_comm_basis, new.buyer_comm_value, new.order_value, new.uom, new.quantity, new.total_weight, new.bag_weight);
  new.supplier_commission := trade_commission(new.supplier_comm_basis, new.supplier_comm_value, new.order_value, new.uom, new.quantity, new.total_weight, new.bag_weight);
  new.total_amount := trade_total_amount(new.order_value, new.cgst_pct, new.insurance_pct, new.add_amount, new.deduct_amount);
  if tg_op = 'INSERT' then
    new.dispatched_qty := 0;
  else
    select coalesce(sum(quantity),0) into new.dispatched_qty from order_dispatches where order_id = new.id;
  end if;
  select exists (select 1 from sc_returns r where r.sc_id = new.sales_confirmation_id) into ret;
  new.dispatch_status := order_dispatch_status(new.status, new.quantity, new.dispatched_qty, ret);
  return new;
end $$;

-- refresh the parent when dispatch entries or SC returns change
create or replace function public.order_refresh_from_children() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'sc_returns' then
    update orders set updated_at = now() where sales_confirmation_id = case when tg_op = 'DELETE' then old.sc_id else new.sc_id end;
  else
    perform set_config('app.refresh', '1', true);
    update orders set updated_at = now() where id = case when tg_op = 'DELETE' then old.order_id else new.order_id end;
    perform set_config('app.refresh', '', true);
  end if;
  return null;
end $$;

create or replace function public.dispatch_entry_derive() returns trigger
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = new.order_id;
  new.dc_no := nullif(btrim(new.dc_no), '');
  new.total_weight := trade_total_weight(o.uom, new.quantity, o.bag_weight);
  new.entry_value := new.total_weight * o.final_rate;
  new.buyer_commission := trade_commission(o.buyer_comm_basis, o.buyer_comm_value, new.entry_value, o.uom, new.quantity, new.total_weight, o.bag_weight);
  new.supplier_commission := trade_commission(o.supplier_comm_basis, o.supplier_comm_value, new.entry_value, o.uom, new.quantity, new.total_weight, o.bag_weight);
  new.total_amount := trade_total_amount(new.entry_value, new.cgst_pct, new.insurance_pct, new.add_amount, new.deduct_amount);
  if new.transport_type is null then new.transport_type := o.transport_type; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- status rules (replaces orders_guard)
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.order_no := 'ORD-' || to_char(now(),'YYYY') || '-' || lpad(nextval('order_seq')::text,4,'0');
    new.order_date := (now() at time zone 'Asia/Kolkata')::date;
    new.status := 'draft';
    new.payment_tracking_enabled := false;
    new.closed_at := null; new.cancelled_at := null;
    new.confirmed_at := null; new.confirmed_by := null; new.execution_opened_at := null; new.execution_opened_by := null;
    return new;
  end if;
  if old.status = 'closed' and coalesce(current_setting('app.refresh', true),'') <> '1' then
    -- a closed item stays read-only, except that its invoice details can still be recorded
    if new.status is distinct from old.status or new.quantity is distinct from old.quantity or new.cgst_pct is distinct from old.cgst_pct
       or new.insurance_pct is distinct from old.insurance_pct or new.add_amount is distinct from old.add_amount or new.deduct_amount is distinct from old.deduct_amount then
      raise exception 'This item is closed and read-only';
    end if;
  end if;
  if old.status = 'cancelled' and new.status is distinct from old.status then raise exception 'A cancelled item cannot be reopened'; end if;
  -- copied from the Sales Confirmation: fixed
  new.order_no := old.order_no; new.order_date := old.order_date; new.deal_id := old.deal_id; new.sales_confirmation_id := old.sales_confirmation_id;
  new.buyer_id := old.buyer_id; new.supplier_id := old.supplier_id; new.company_id := old.company_id; new.count_id := old.count_id;
  new.quantity := old.quantity; new.uom := old.uom; new.buyer_rate := old.buyer_rate; new.supplier_rate := old.supplier_rate;
  new.commission_type := old.commission_type; new.commission_value := old.commission_value; new.price_basis := old.price_basis;
  new.freight := old.freight; new.bag_weight := old.bag_weight; new.payment_term_id := old.payment_term_id;
  new.final_rate := old.final_rate;
  new.buyer_comm_basis := old.buyer_comm_basis; new.buyer_comm_value := old.buyer_comm_value;
  new.supplier_comm_basis := old.supplier_comm_basis; new.supplier_comm_value := old.supplier_comm_value;
  new.confirmed_at := old.confirmed_at; new.confirmed_by := old.confirmed_by;
  new.execution_opened_at := old.execution_opened_at; new.execution_opened_by := old.execution_opened_by;
  new.payment_tracking_enabled := old.payment_tracking_enabled;
  new.closed_at := old.closed_at; new.cancelled_at := old.cancelled_at;
  if new.status is distinct from old.status then
    if old.status in ('draft','confirmed') and new.status = 'open_for_execution' then
      -- "Start dispatch": no separate confirmation step any more
      if old.sales_confirmation_id is null or not exists (select 1 from sales_confirmations s where s.id = old.sales_confirmation_id and s.status <> 'cancelled') then
        raise exception 'The Sales Confirmation for this item is cancelled';
      end if;
      if old.status = 'draft' then new.confirmed_at := now(); new.confirmed_by := auth.uid(); end if;
      new.execution_opened_at := now(); new.execution_opened_by := auth.uid();
      new.payment_tracking_enabled := true;
    elsif old.status = 'draft' and new.status = 'confirmed' then
      new.confirmed_at := now(); new.confirmed_by := auth.uid();
    elsif old.status = 'open_for_execution' and new.status = 'closed' then
      if coalesce(current_setting('app.closing', true),'') <> '1' then raise exception 'An item closes automatically once all four conditions are met'; end if;
      new.closed_at := now();
    elsif new.status = 'cancelled' and old.status in ('draft','confirmed','open_for_execution') then
      if exists (select 1 from order_dispatches where order_id = old.id) then raise exception 'Items with dispatch entries cannot be cancelled'; end if;
      new.cancelled_at := now();
    else
      raise exception 'An item cannot move from % to %', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- create from a Sales Confirmation
create or replace function public.create_dispatch_bill(p_sc uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s sales_confirmations; o uuid; co uuid;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select * into s from sales_confirmations where id = p_sc;
  if not found then raise exception 'Sales Confirmation not found'; end if;
  if s.status = 'cancelled' then raise exception 'This Sales Confirmation is cancelled'; end if;
  if s.status <> 'confirmed' then raise exception 'Fill in every required field of the Sales Confirmation first'; end if;
  if s.rate is null then raise exception 'The Sales Confirmation has no rate'; end if;
  if exists (select 1 from orders where sales_confirmation_id = p_sc and status <> 'cancelled') then
    raise exception 'This Sales Confirmation already has a Dispatch and Billing item';
  end if;
  co := coalesce(s.company_id, (select id from companies where is_home and is_active limit 1));
  if co is null then raise exception 'Set the internal company first'; end if;
  insert into orders(deal_id, sales_confirmation_id, buyer_id, supplier_id, company_id, count_id, quantity, uom,
                     buyer_rate, supplier_rate, final_rate, commission_type, commission_value, price_basis, freight, bag_weight, payment_term_id,
                     buyer_comm_basis, buyer_comm_value, supplier_comm_basis, supplier_comm_value,
                     delivery_schedule, special_instructions, job_process_id, alt_delivery_address,
                     sale_type, transporter_id, vehicle_no, driver_phone, person_id)
  values (s.deal_id, s.id, s.buyer_id, s.supplier_id, co, s.count_id, coalesce(s.net_quantity, s.quantity), s.uom,
          coalesce(s.buyer_rate, s.rate), coalesce(s.supplier_rate, s.rate), s.rate, null, null, coalesce(s.price_basis,'ex_mill'), s.freight, s.bag_weight, s.payment_term_id,
          s.buyer_comm_basis, s.buyer_comm_value, s.supplier_comm_basis, s.supplier_comm_value,
          s.delivery_schedule, s.special_instructions, s.job_process_id, s.delivery_address,
          s.sale_type, s.transporter_id, s.vehicle_no, s.driver_phone, auth.uid())
  returning id into o;
  return o;
end $$;
revoke all on function public.create_dispatch_bill(uuid) from public, anon;
grant execute on function public.create_dispatch_bill(uuid) to authenticated, service_role;

-- the old deal -> order path now goes through the Sales Confirmation
create or replace function public.create_order(p_deal uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d crm_deals;
begin
  select * into d from crm_deals where id = p_deal;
  if not found then raise exception 'Deal not found'; end if;
  if d.sales_confirmation_id is null then raise exception 'Create the Sales Confirmation first'; end if;
  return create_dispatch_bill(d.sales_confirmation_id);
end $$;

-- ---------------------------------------------------------------- billing reads the item's commission
create or replace function public.generate_commission_invoice(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare o orders; amt numeric; inv uuid;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select * into o from orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'open_for_execution' then raise exception 'The commission invoice can only be generated while the item is in progress'; end if;
  if exists (select 1 from commission_invoices where order_id = p_order) then raise exception 'A commission invoice already exists for this item'; end if;
  amt := order_commission_amount(p_order);
  if amt is null then raise exception 'The commission amount cannot be worked out (no commission terms on this item)'; end if;
  insert into commission_invoices(order_id, buyer_id, supplier_id, company_id, amount) values (o.id, o.buyer_id, o.supplier_id, o.company_id, amt) returning id into inv;
  return inv;
end $$;

create or replace function public.pending_commission_bills() returns table(order_id uuid, order_no text, order_date date, status text, buyer_id uuid, supplier_id uuid, company_id uuid, quantity numeric, uom text, commission_type text, commission_value numeric, commission_amount numeric, days_pending integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('order.read') or has_permission('order.manage')) then
    raise exception 'You need permission to view orders';
  end if;
  return query
  select o.id, o.order_no, o.order_date, o.status, o.buyer_id, o.supplier_id, o.company_id, o.quantity, o.uom,
         o.commission_type, o.commission_value, order_commission_amount(o.id),
         greatest(0, (current_date - o.order_date))::int
  from orders o
  where o.status in ('confirmed','open_for_execution')
    and not exists (select 1 from commission_invoices c where c.order_id = o.id)
  order by o.order_date, o.order_no;
end $$;

create or replace function public.billing_dispatch_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t date := (now() at time zone 'Asia/Kolkata')::date;
  res jsonb := jsonb_build_object('as_of', t);
  a int; b int; c numeric; d numeric; e int;
begin
  if not (has_permission('order.read') or has_permission('order.manage')) then
    raise exception 'You need permission to view orders';
  end if;
  select count(*), coalesce(sum(quantity),0) into a, c from order_dispatches where dispatch_date = t;
  select count(*), coalesce(sum(bal),0) into b, d from (
    select o.quantity - coalesce((select sum(x.quantity) from order_dispatches x where x.order_id=o.id),0) bal
    from orders o where o.status in ('confirmed','open_for_execution') and o.tentative_dispatch_date = t) q where bal > 0;
  res := res || jsonb_build_object('dispatch_today', jsonb_build_object('dispatched_entries', a, 'dispatched_qty', c, 'scheduled_orders', b, 'scheduled_balance_qty', d));
  select count(*), count(*) filter (where dispatch_date < t - 3), coalesce(min(t - dispatch_date),0) into a, b, e
    from order_dispatches where mill_invoice_no is null and mill_invoice_date is null;
  res := res || jsonb_build_object('billing_pending', jsonb_build_object('pending', a, 'older_than_3_days', b, 'oldest_days', (select coalesce(max(t - dispatch_date),0) from order_dispatches where mill_invoice_no is null and mill_invoice_date is null)));
  select count(*), coalesce(sum(order_commission_amount(o.id)),0), count(*) filter (where o.order_date < t - 7) into a, c, b
    from orders o
    where o.status in ('confirmed','open_for_execution') and not exists (select 1 from commission_invoices ci where ci.order_id = o.id);
  res := res || jsonb_build_object('commission_pending', jsonb_build_object('pending', a, 'amount', c, 'older_than_7_days', b));
  select count(*), coalesce(sum(tr.freight_amount),0), count(*) filter (where od.dispatch_date < t - 7) into a, c, b
    from order_dispatches od join order_transports tr on tr.id = od.transport_id
    where tr.kind = 'third_party' and od.transporter_invoice_no is null;
  res := res || jsonb_build_object('transport_invoice_pending', jsonb_build_object('pending', a, 'freight_amount', c, 'older_than_7_days', b));
  return res;
end $$;

-- a confirmation with a live Dispatch and Billing item cannot be cancelled
create or replace function public.cancel_sales_confirmation(p_sc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare disp numeric;
begin
  if not has_permission('sc.manage') then raise exception 'You need permission to manage sales confirmations'; end if;
  select coalesce(sum(x.quantity),0) into disp from order_dispatches x join orders o on o.id = x.order_id where o.sales_confirmation_id = p_sc;
  if disp > 0 then raise exception 'This confirmation already has dispatches and cannot be cancelled'; end if;
  if exists (select 1 from orders where sales_confirmation_id = p_sc and status <> 'cancelled') then
    raise exception 'Cancel its Dispatch and Billing item first';
  end if;
  update sales_confirmations set status = 'cancelled' where id = p_sc and status <> 'cancelled';
end $$;

-- ---------------------------------------------------------------- triggers
-- orders: guard (g) then derive (z)
drop trigger if exists trg_orders_z_derive on public.orders;
create trigger trg_orders_z_derive before insert or update on public.orders for each row execute function public.orders_derive();
-- dispatch entries: existing guard (trg_od_guard) and stamp (trg_od_stamp) run first, then derive (z)
drop trigger if exists trg_od_z_derive on public.order_dispatches;
create trigger trg_od_z_derive before insert or update on public.order_dispatches for each row execute function public.dispatch_entry_derive();
drop trigger if exists trg_od_refresh on public.order_dispatches;
create trigger trg_od_refresh after insert or update or delete on public.order_dispatches for each row execute function public.order_refresh_from_children();
drop trigger if exists trg_scr_refresh on public.sc_returns;
create trigger trg_scr_refresh after insert or update or delete on public.sc_returns for each row execute function public.order_refresh_from_children();

revoke all on function public.orders_derive() from public;
revoke all on function public.order_refresh_from_children() from public;
revoke all on function public.dispatch_entry_derive() from public;
grant all on function public.orders_derive() to service_role;
grant all on function public.order_refresh_from_children() to service_role;
grant all on function public.dispatch_entry_derive() to service_role;

-- ---------------------------------------------------------------- data
-- existing items: final rate from the supplier rate, transport type from their transport records, figures worked out
alter table public.orders disable trigger trg_orders_guard;
update public.orders o set
  final_rate = coalesce(o.final_rate, s.rate, o.supplier_rate),
  sale_type = coalesce(s.sale_type, 'local'),
  transport_type = coalesce(o.transport_type,
    (select case when bool_or(t.kind = 'our') then 'own' when bool_or(t.kind = 'third_party') then 'agreed_third_party' end
       from order_transports t where t.order_id = o.id))
from public.orders o0 left join public.sales_confirmations s on s.id = o0.sales_confirmation_id
where o0.id = o.id;
update public.orders set updated_at = updated_at;  -- fires orders_derive for every row
alter table public.orders enable trigger trg_orders_guard;

alter table public.order_dispatches disable trigger trg_od_guard;
alter table public.order_dispatches disable trigger trg_od_refresh;
update public.order_dispatches set quantity = quantity;  -- fires dispatch_entry_derive
alter table public.order_dispatches enable trigger trg_od_refresh;
alter table public.order_dispatches enable trigger trg_od_guard;

commit;
