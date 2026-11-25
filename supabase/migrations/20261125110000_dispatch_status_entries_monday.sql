-- Dispatch and Billing as on the monday board (follows 20261125100000).
--
-- monday: the item's Status is set by hand; each of Partially Dispatch / Cancel / Return creates a sub-item (a dispatch
-- entry) and moves the item on:
--   Draft -> Partially Dispatch : sub-item, item In Progress
--   In Progress -> Return       : sub-item, item Fully Dispatch
--   In Progress -> Cancel       : sub-item, item Fully Dispatch
-- and the item is Fully Dispatch once dispatched + cancelled equals the quantity.
--
-- So here a Return entry is a free-standing entry of the item (not tied to one dispatch), it carries the invoice number and
-- date like the other entries, every entry has a Dispatch Entry No from the same running number, and a Return closes the item
-- as Fully Dispatch without giving the quantity back to dispatch. Dispatched quantity is therefore the plain sum of the
-- dispatch entries; returned and cancelled quantities are kept beside it. Safe to run twice.

-- ---------------------------------------------------------------- entries
alter table public.order_dispatch_adjustments
  add column if not exists entry_no text,
  add column if not exists invoice_no text,
  add column if not exists invoice_date date;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.order_dispatch_adjustments'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%dispatch_id IS NOT NULL%'
  loop
    execute format('alter table public.order_dispatch_adjustments drop constraint %I', c);
  end loop;
end $$;

alter table public.orders add column if not exists returned_qty numeric not null default 0;

-- ---------------------------------------------------------------- quantities
create or replace function public.order_net_dispatched(p_order uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(quantity) from order_dispatches where order_id = p_order), 0)
$$;
create or replace function public.order_returned_qty(p_order uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(quantity) from order_dispatch_adjustments where order_id = p_order and kind = 'return'), 0)
$$;
revoke all on function public.order_returned_qty(uuid) from public, anon;
grant execute on function public.order_returned_qty(uuid) to authenticated, service_role;

-- what is still to be sent: nothing once the item is Fully Dispatch by a return
create or replace function public.order_balance(p_order uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when order_returned_qty(o.id) > 0 then 0
              else greatest(o.quantity - order_net_dispatched(o.id) - order_cancelled(o.id), 0) end
  from orders o where o.id = p_order
$$;
revoke all on function public.order_balance(uuid) from public, anon;
grant execute on function public.order_balance(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- status
create or replace function public.order_dispatch_status(p_status text, p_qty numeric, p_disp numeric, p_returned boolean, p_cancelled numeric default 0, p_ret_entries numeric default 0)
returns text language sql immutable set search_path = public as $$
  select case
    when p_status = 'cancelled' then 'cancelled'
    when p_returned then 'returned'
    when p_disp <= 0 and p_cancelled >= p_qty and p_qty > 0 then 'cancelled'
    when p_disp > 0 and (p_disp + p_cancelled >= p_qty or p_ret_entries > 0) then 'fully_dispatched'
    when p_disp > 0 then 'partially_dispatched'
    when p_status in ('open_for_execution','closed','confirmed') then 'in_progress'
    else 'draft' end
$$;
grant execute on function public.order_dispatch_status(text, numeric, numeric, boolean, numeric, numeric) to authenticated, service_role;

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
    new.dispatched_qty := 0; new.cancelled_qty := 0; new.returned_qty := 0;
  else
    new.dispatched_qty := order_net_dispatched(new.id);
    new.cancelled_qty := order_cancelled(new.id);
    new.returned_qty := order_returned_qty(new.id);
  end if;
  select exists (select 1 from sc_returns r where r.sc_id = new.sales_confirmation_id) into ret;
  new.dispatch_status := order_dispatch_status(new.status, new.quantity, new.dispatched_qty, ret, new.cancelled_qty, new.returned_qty);
  return new;
end $$;

create or replace function public.order_close_status(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; disp numeric; canc numeric; retq numeric; rec numeric; paid numeric; inv boolean;
begin
  select * into o from orders where id = p_order;
  if not found then return null; end if;
  disp := order_net_dispatched(p_order);
  canc := order_cancelled(p_order);
  retq := order_returned_qty(p_order);
  select coalesce(sum(amount) filter (where kind='buyer_receipt'),0), coalesce(sum(amount) filter (where kind='supplier_payment'),0) into rec, paid from order_payments where order_id = p_order;
  select exists (select 1 from commission_invoices where order_id = p_order) into inv;
  return jsonb_build_object(
    'dispatched', disp, 'cancelled', canc, 'returned', retq, 'quantity', o.quantity,
    'quantity_done', disp > 0 and (disp + canc >= o.quantity or retq > 0),
    'buyer_received', rec, 'buyer_value', o.buyer_rate * o.quantity, 'buyer_done', rec >= o.buyer_rate * o.quantity,
    'supplier_paid', paid, 'supplier_value', o.supplier_rate * o.quantity, 'supplier_done', paid >= o.supplier_rate * o.quantity,
    'invoice_done', inv);
end $$;

-- ---------------------------------------------------------------- guards
-- dispatch entries: no more than is left; the quantity of an entry is no longer tied to returns
create or replace function public.order_exec_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare o orders; used numeric; oid uuid;
begin
  oid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  select * into o from orders where id = oid;
  if tg_op = 'DELETE' then
    if o.status is distinct from 'open_for_execution' then raise exception 'The order is not open for execution'; end if;
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
    if order_returned_qty(new.order_id) > 0 and tg_op = 'INSERT' then
      raise exception 'This item has a return and is Fully Dispatch; remove the return entry to dispatch more';
    end if;
    select coalesce(sum(quantity),0) into used from order_dispatches where order_id = new.order_id and id is distinct from new.id;
    used := used + order_cancelled(new.order_id);
    if used + new.quantity > o.quantity then
      raise exception 'Dispatch quantity exceeds what is left: % already dispatched or cancelled of % %', used, o.quantity, o.uom;
    end if;
    if new.transport_id is not null and not exists (select 1 from order_transports t where t.id = new.transport_id and t.order_id = new.order_id) then
      raise exception 'The transportation record belongs to another order';
    end if;
  end if;
  return new;
end $$;

create or replace function public.order_adjustment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare o orders; others numeric; room numeric;
begin
  if tg_op = 'DELETE' then
    select * into o from orders where id = old.order_id;
    if o.status is distinct from 'open_for_execution' then raise exception 'The order is not open for execution'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.order_id is distinct from old.order_id or new.kind is distinct from old.kind) then
    raise exception 'An entry cannot be moved; remove it and add a new one';
  end if;
  select * into o from orders where id = new.order_id;
  if o.status is distinct from 'open_for_execution' then raise exception 'The order must be Open for Execution first'; end if;
  new.reason := nullif(btrim(new.reason), '');
  new.invoice_no := nullif(btrim(new.invoice_no), '');
  new.dispatch_id := null;
  if tg_op = 'INSERT' then
    new.entry_no := 'DSP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('dispatch_seq')::text,4,'0');
  else
    new.entry_no := old.entry_no;
  end if;
  if new.kind = 'return' then
    -- a return is of what was dispatched
    select coalesce(sum(quantity),0) into others from order_dispatch_adjustments
      where order_id = new.order_id and kind = 'return' and id is distinct from new.id;
    if order_net_dispatched(new.order_id) <= 0 then raise exception 'Nothing has been dispatched, so there is nothing to return'; end if;
    if others + new.quantity > order_net_dispatched(new.order_id) then
      raise exception 'Returned quantity exceeds what was dispatched: % dispatched, % already returned', order_net_dispatched(new.order_id), others;
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

-- ---------------------------------------------------------------- balances elsewhere
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
    select order_balance(o.id) bal
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
         coalesce(bool_and(coalesce((select sum(order_net_dispatched(o.id) + order_cancelled(o.id)) from orders o where o.sc_line_id = l.id), 0) >= l.quantity
                           or exists (select 1 from orders o where o.sc_line_id = l.id and order_returned_qty(o.id) > 0)), false)
    into has_lines, all_done
  from sc_lines l where l.sc_id = p_sc;
  if has_lines then
    if all_done then return 'Executed'; end if;
  elsif disp + canc >= coalesce(s.quantity, 0)
        or exists (select 1 from orders o where o.sales_confirmation_id = p_sc and order_returned_qty(o.id) > 0) then
    return 'Executed';
  end if;
  return 'Partially Executed';
end $$;

do $$
declare def text;
begin
  select pg_get_functiondef('public.sales_followup_dashboard'::regproc) into def;
  def := replace(def,
    'o.quantity - order_net_dispatched(o.id) - order_cancelled(o.id) bal',
    'order_balance(o.id) bal');
  execute def;
end $$;

