-- A Dispatch and Billing item that is Fully Dispatch is locked: only a Return can be added (or removed).
--
--  * orders: no field of a Fully Dispatch item can be changed. The figures the database works out itself (weights, value,
--    commissions, quantities, dispatch status, duplicate flag) still update, and so do the refreshes the entry triggers
--    run when a Return is added or removed (app.refresh = '1').
--  * order_dispatches: entries of a Fully Dispatch item cannot be added, changed or removed. The mill invoice, POD, GRN and
--    transporter invoice details that the delivery and freight tasks record stay open, as before.
--  * order_dispatch_adjustments: on a Fully Dispatch item only Return entries can be added, changed or removed; Cancel
--    entries are locked.
-- "Fully Dispatch" here is the item's dispatch status: fully_dispatched, or returned (a return on its confirmation).
-- Safe to run twice.

begin;

create or replace function public.order_is_fully_dispatched(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select dispatch_status in ('fully_dispatched', 'returned') and status <> 'cancelled' from orders where id = p_order), false)
$$;

-- ---------------------------------------------------------------- the item
create or replace function public.orders_fully_dispatched_lock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  derived text[] := array['updated_at', 'total_weight', 'order_value', 'buyer_commission', 'supplier_commission', 'total_amount',
                          'dispatched_qty', 'cancelled_qty', 'returned_qty', 'dispatch_status', 'is_duplicate', 'duplication_error'];
begin
  if coalesce(current_setting('app.refresh', true), '') = '1' then return new; end if;
  if old.dispatch_status not in ('fully_dispatched', 'returned') or old.status = 'cancelled' then return new; end if;
  if (to_jsonb(new) - derived) is distinct from (to_jsonb(old) - derived) then
    raise exception 'This item is Fully Dispatch and is locked. Only a Return entry can be added.';
  end if;
  return new;
end
$$;

-- fires after trg_orders_guard (which puts back the fields copied from the confirmation) and before the derive trigger
drop trigger if exists trg_orders_y_fully_dispatched_lock on public.orders;
create trigger trg_orders_y_fully_dispatched_lock
  before update on public.orders
  for each row execute function public.orders_fully_dispatched_lock();

-- ---------------------------------------------------------------- its dispatch entries
create or replace function public.dispatch_fully_dispatched_lock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not order_is_fully_dispatched(case when tg_op = 'DELETE' then old.order_id else new.order_id end) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'This item is Fully Dispatch and is locked: its dispatch entries cannot be removed. Only a Return entry can be added.';
  elsif tg_op = 'INSERT' then
    raise exception 'This item is Fully Dispatch: nothing is left to dispatch. Only a Return entry can be added.';
  elsif (new.quantity, new.dispatch_date, new.vehicle_no, new.lr_no, new.invoice_no, new.invoice_date, new.remarks, new.dc_no,
         new.delivery_date, new.transport_type, new.transport_id, new.person_id, new.cgst_pct, new.insurance_pct, new.add_amount,
         new.deduct_amount, new.round_off)
        is distinct from
        (old.quantity, old.dispatch_date, old.vehicle_no, old.lr_no, old.invoice_no, old.invoice_date, old.remarks, old.dc_no,
         old.delivery_date, old.transport_type, old.transport_id, old.person_id, old.cgst_pct, old.insurance_pct, old.add_amount,
         old.deduct_amount, old.round_off) then
    raise exception 'This item is Fully Dispatch and is locked: its dispatch entries cannot be changed. Only a Return entry can be added.';
  end if;
  return new;
end
$$;

drop trigger if exists trg_od_b_fully_dispatched_lock on public.order_dispatches;
create trigger trg_od_b_fully_dispatched_lock
  before insert or update or delete on public.order_dispatches
  for each row execute function public.dispatch_fully_dispatched_lock();

-- ---------------------------------------------------------------- its cancel and return entries
create or replace function public.adjustment_fully_dispatched_lock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare k text := case when tg_op = 'DELETE' then old.kind else new.kind end;
begin
  if k = 'return' then return case when tg_op = 'DELETE' then old else new end; end if;
  if order_is_fully_dispatched(case when tg_op = 'DELETE' then old.order_id else new.order_id end) then
    raise exception 'This item is Fully Dispatch and is locked: cancel entries cannot be added, changed or removed. Only a Return entry can be added.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_oda_a_fully_dispatched_lock on public.order_dispatch_adjustments;
create trigger trg_oda_a_fully_dispatched_lock
  before insert or update or delete on public.order_dispatch_adjustments
  for each row execute function public.adjustment_fully_dispatched_lock();

-- none of these are callable over the API
revoke all on function public.order_is_fully_dispatched(uuid) from public, anon, authenticated;
revoke all on function public.orders_fully_dispatched_lock() from public, anon, authenticated;
revoke all on function public.dispatch_fully_dispatched_lock() from public, anon, authenticated;
revoke all on function public.adjustment_fully_dispatched_lock() from public, anon, authenticated;

commit;
