-- Dispatch and Billing: cancel and return sub-entries, and the Fully Dispatch rule.
--
-- A dispatch entry is a partial (or the full) delivery. Two more kinds of entry can sit under an item:
--   * a Cancel entry: quantity the buyer will not take after all. It belongs to the item (the undelivered remainder).
--   * a Return entry: quantity sent back. It belongs to one dispatch entry and cannot be more than that entry sent.
-- Net dispatched = dispatched - returned. The item is Fully Dispatch once net dispatched + cancelled equals the item
-- quantity (and something was dispatched). Everything cancelled and nothing dispatched shows as Cancelled.
-- orders.dispatched_qty now holds the NET dispatched quantity; orders.cancelled_qty is new.
-- Safe to run twice.

-- ---------------------------------------------------------------- table
create table if not exists public.order_dispatch_adjustments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  dispatch_id uuid references public.order_dispatches (id) on delete restrict,
  kind        text not null check (kind in ('cancel', 'return')),
  quantity    numeric not null check (quantity > 0),
  entry_date  date not null default ((now() at time zone 'Asia/Kolkata')::date),
  reason      text,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check ((kind = 'return') = (dispatch_id is not null))
);
create index if not exists oda_order_idx on public.order_dispatch_adjustments (order_id);
create index if not exists oda_dispatch_idx on public.order_dispatch_adjustments (dispatch_id);

alter table public.order_dispatch_adjustments enable row level security;
drop policy if exists order_dispatch_adjustments_sel on public.order_dispatch_adjustments;
drop policy if exists order_dispatch_adjustments_ins on public.order_dispatch_adjustments;
drop policy if exists order_dispatch_adjustments_upd on public.order_dispatch_adjustments;
drop policy if exists order_dispatch_adjustments_del on public.order_dispatch_adjustments;
create policy order_dispatch_adjustments_sel on public.order_dispatch_adjustments for select to authenticated
  using (has_permission('order.read') or has_permission('order.manage'));
create policy order_dispatch_adjustments_ins on public.order_dispatch_adjustments for insert to authenticated
  with check (has_permission('order.manage'));
create policy order_dispatch_adjustments_upd on public.order_dispatch_adjustments for update to authenticated
  using (has_permission('order.manage')) with check (has_permission('order.manage'));
create policy order_dispatch_adjustments_del on public.order_dispatch_adjustments for delete to authenticated
  using (has_permission('order.manage'));
revoke all on public.order_dispatch_adjustments from anon;

alter table public.orders add column if not exists cancelled_qty numeric not null default 0;

-- ---------------------------------------------------------------- quantities
create or replace function public.order_net_dispatched(p_order uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(quantity) from order_dispatches where order_id = p_order), 0)
       - coalesce((select sum(quantity) from order_dispatch_adjustments where order_id = p_order and kind = 'return'), 0)
$$;
create or replace function public.order_cancelled(p_order uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(quantity) from order_dispatch_adjustments where order_id = p_order and kind = 'cancel'), 0)
$$;
revoke all on function public.order_net_dispatched(uuid), public.order_cancelled(uuid) from public, anon;
grant execute on function public.order_net_dispatched(uuid), public.order_cancelled(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- status from what has happened
create or replace function public.order_dispatch_status(p_status text, p_qty numeric, p_disp numeric, p_returned boolean, p_cancelled numeric default 0)
returns text language sql immutable set search_path = public as $$
  select case
    when p_status = 'cancelled' then 'cancelled'
    when p_returned then 'returned'
    when p_disp <= 0 and p_cancelled >= p_qty and p_qty > 0 then 'cancelled'
    when p_disp > 0 and p_disp + p_cancelled >= p_qty then 'fully_dispatched'
    when p_disp > 0 then 'partially_dispatched'
    when p_status in ('open_for_execution','closed','confirmed') then 'in_progress'
    else 'draft' end
$$;
grant execute on function public.order_dispatch_status(text, numeric, numeric, boolean, numeric) to authenticated, service_role;

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
    new.cancelled_qty := 0;
  else
    new.dispatched_qty := order_net_dispatched(new.id);
    new.cancelled_qty := order_cancelled(new.id);
  end if;
  select exists (select 1 from sc_returns r where r.sc_id = new.sales_confirmation_id) into ret;
  new.dispatch_status := order_dispatch_status(new.status, new.quantity, new.dispatched_qty, ret, new.cancelled_qty);
  return new;
end $$;

-- the four closing conditions: the quantity is done once dispatched (net) + cancelled covers it
create or replace function public.order_close_status(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; disp numeric; canc numeric; rec numeric; paid numeric; inv boolean;
begin
  select * into o from orders where id = p_order;
  if not found then return null; end if;
  disp := order_net_dispatched(p_order);
  canc := order_cancelled(p_order);
  select coalesce(sum(amount) filter (where kind='buyer_receipt'),0), coalesce(sum(amount) filter (where kind='supplier_payment'),0) into rec, paid from order_payments where order_id = p_order;
  select exists (select 1 from commission_invoices where order_id = p_order) into inv;
  return jsonb_build_object(
    'dispatched', disp, 'cancelled', canc, 'quantity', o.quantity,
    'quantity_done', disp > 0 and disp + canc >= o.quantity,
    'buyer_received', rec, 'buyer_value', o.buyer_rate * o.quantity, 'buyer_done', rec >= o.buyer_rate * o.quantity,
    'supplier_paid', paid, 'supplier_value', o.supplier_rate * o.quantity, 'supplier_done', paid >= o.supplier_rate * o.quantity,
    'invoice_done', inv);
end $$;

-- ---------------------------------------------------------------- guards
-- Dispatch entries may not go past what is left (quantity - net dispatched of the others - cancelled), a dispatch
-- cannot be lowered below what was returned from it, and one with return entries cannot be removed.
create or replace function public.order_exec_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare o orders; used numeric; oid uuid; rets numeric;
begin
  oid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  select * into o from orders where id = oid;
  if tg_op = 'DELETE' then
    if o.status is distinct from 'open_for_execution' then raise exception 'The order is not open for execution'; end if;
    if tg_table_name = 'order_dispatches' and exists (select 1 from order_dispatch_adjustments where dispatch_id = old.id) then
      raise exception 'Remove the return entries of this dispatch first';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.order_id is distinct from old.order_id then raise exception 'A record cannot be moved to another order'; end if;
  if tg_table_name = 'order_dispatches' then
    -- mill invoice / POD / GRN details may be recorded at any time, even after the order closes
    if tg_op = 'UPDATE' then
      if new.quantity is not distinct from old.quantity and new.dispatch_date is not distinct from old.dispatch_date
         and new.transport_id is not distinct from old.transport_id and new.vehicle_no is not distinct from old.vehicle_no
         and new.lr_no is not distinct from old.lr_no and new.invoice_no is not distinct from old.invoice_no and new.remarks is not distinct from old.remarks then
        new.dispatch_no := old.dispatch_no;
        return new;
      end if;
    end if;
  end if;
  if o.status is distinct from 'open_for_execution' then raise exception 'The order must be Open for Execution first'; end if;
  if tg_table_name = 'order_payments' then
    if not o.payment_tracking_enabled then raise exception 'Payment tracking is not enabled for this order'; end if;
  end if;
  if tg_table_name = 'order_dispatches' then
    if tg_op = 'INSERT' then new.dispatch_no := 'DSP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('dispatch_seq')::text,4,'0');
    else new.dispatch_no := old.dispatch_no; end if;
    select coalesce(sum(quantity),0) into used from order_dispatches where order_id = new.order_id and id is distinct from new.id;
    used := used - order_returned(new.order_id) + order_cancelled(new.order_id);
    if used + new.quantity > o.quantity then
      raise exception 'Dispatch quantity exceeds what is left: % already dispatched or cancelled of % %', used, o.quantity, o.uom;
    end if;
    if tg_op = 'UPDATE' then
      select coalesce(sum(quantity),0) into rets from order_dispatch_adjustments where dispatch_id = new.id and kind = 'return';
      if new.quantity < rets then raise exception 'This dispatch has % returned; its quantity cannot be lower', rets; end if;
    end if;
    if new.transport_id is not null and not exists (select 1 from order_transports t where t.id = new.transport_id and t.order_id = new.order_id) then
      raise exception 'The transportation record belongs to another order';
    end if;
  end if;
  return new;
end $$;

-- returns on all dispatch entries of an order other than one (the one being edited)
create or replace function public.order_returned(p_order uuid, p_except uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(quantity), 0) from order_dispatch_adjustments
  where order_id = p_order and kind = 'return' and dispatch_id is distinct from p_except
$$;
revoke all on function public.order_returned(uuid, uuid) from public, anon;
grant execute on function public.order_returned(uuid, uuid) to authenticated, service_role;

create or replace function public.order_adjustment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare o orders; d order_dispatches; others numeric; room numeric;
begin
  if tg_op = 'DELETE' then
    select * into o from orders where id = old.order_id;
    if o.status is distinct from 'open_for_execution' then raise exception 'The order is not open for execution'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.order_id is distinct from old.order_id or new.kind is distinct from old.kind
                           or new.dispatch_id is distinct from old.dispatch_id) then
    raise exception 'An entry cannot be moved; remove it and add a new one';
  end if;
  select * into o from orders where id = new.order_id;
  if o.status is distinct from 'open_for_execution' then raise exception 'The order must be Open for Execution first'; end if;
  new.reason := nullif(btrim(new.reason), '');
  if new.kind = 'return' then
    select * into d from order_dispatches where id = new.dispatch_id;
    if not found or d.order_id <> new.order_id then raise exception 'A return must be against a dispatch entry of this item'; end if;
    select coalesce(sum(quantity),0) into others from order_dispatch_adjustments
      where dispatch_id = new.dispatch_id and kind = 'return' and id is distinct from new.id;
    if others + new.quantity > d.quantity then
      raise exception 'Returned quantity exceeds the dispatch: % already returned of % sent', others, d.quantity;
    end if;
  else
    select coalesce(sum(quantity),0) into others from order_dispatch_adjustments
      where order_id = new.order_id and kind = 'cancel' and id is distinct from new.id;
    room := o.quantity - order_net_dispatched(new.order_id) - others;
    if new.quantity > room then
      raise exception 'Cancelled quantity exceeds what is left to dispatch: % % left', greatest(room, 0), o.uom;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_oda_guard on public.order_dispatch_adjustments;
create trigger trg_oda_guard before insert or update or delete on public.order_dispatch_adjustments for each row execute function public.order_adjustment_guard();
drop trigger if exists trg_oda_refresh on public.order_dispatch_adjustments;
create trigger trg_oda_refresh after insert or update or delete on public.order_dispatch_adjustments for each row execute function public.order_refresh_from_children();
drop trigger if exists trg_oda_close on public.order_dispatch_adjustments;
create trigger trg_oda_close after insert or update or delete on public.order_dispatch_adjustments for each row execute function public.order_close_check();

-- an item with cancel or return entries cannot be cancelled as a whole either
create or replace function public.orders_cancel_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and exists (select 1 from order_dispatch_adjustments where order_id = old.id) then
    raise exception 'Items with cancel or return entries cannot be cancelled';
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_cancel_guard on public.orders;
create trigger trg_orders_cancel_guard before update on public.orders for each row execute function public.orders_cancel_guard();

-- ---------------------------------------------------------------- balances elsewhere count net dispatched + cancelled
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
    select o.quantity - order_net_dispatched(o.id) - order_cancelled(o.id) bal
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

-- the Sales Confirmation's execution status: Executed once every item is Fully Dispatch (net + cancelled)
create or replace function public.sc_execution_status(p_sc uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare s sales_confirmations; disp numeric; ret numeric; canc numeric; has_lines boolean; all_done boolean;
begin
  select * into s from sales_confirmations where id = p_sc;
  if not found then return null; end if;
  if s.status = 'cancelled' then return 'Cancelled'; end if;
  select coalesce(sum(order_net_dispatched(o.id)),0), coalesce(sum(order_cancelled(o.id)),0) into disp, canc
    from orders o where o.sales_confirmation_id = p_sc;
  select coalesce(sum(quantity),0) into ret from sc_returns where sc_id = p_sc;
  if ret > 0 then return 'Return Adjusted'; end if;
  if disp <= 0 then return 'Open'; end if;
  select count(*) > 0,
         coalesce(bool_and(coalesce((select sum(order_net_dispatched(o.id) + order_cancelled(o.id)) from orders o where o.sc_line_id = l.id), 0) >= l.quantity), false)
    into has_lines, all_done
  from sc_lines l where l.sc_id = p_sc;
  if has_lines then
    if all_done then return 'Executed'; end if;
  elsif disp + canc >= coalesce(s.quantity, 0) then
    return 'Executed';
  end if;
  return 'Partially Executed';
end $$;

create or replace function public.sc_execution_statuses()
returns table(sc_id uuid, exec_status text, dispatched_qty numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_permission('sc.read') or public.has_permission('sc.manage')) then raise exception 'You need permission to view sales confirmations'; end if;
  return query select s.id, public.sc_execution_status(s.id),
    coalesce((select sum(order_net_dispatched(o.id)) from orders o where o.sales_confirmation_id = s.id),0)
  from sales_confirmations s;
end $$;

-- the dashboard's pending-dispatch balance (inside sales_followup_dashboard): only that one line changes
do $$
declare def text;
begin
  select pg_get_functiondef('public.sales_followup_dashboard'::regproc) into def;
  def := replace(def,
    'o.quantity - coalesce((select sum(x.quantity) from order_dispatches x where x.order_id=o.id),0) bal',
    'o.quantity - order_net_dispatched(o.id) - order_cancelled(o.id) bal');
  execute def;
end $$;

