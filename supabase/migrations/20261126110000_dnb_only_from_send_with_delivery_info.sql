-- A Sales Confirmation goes to Dispatch and Billing only once it is in "Send with Delivery Info" (2026-11-26).
--
--  * dnb_from_sc (which every path uses: the Send with Delivery Info automation, the Sales Confirmation and Deals row
--    actions and the New item form) makes nothing for a confirmation in another stage.
--  * create_dispatch_bill and create_order say so in words instead.
--  * orders: an item can only be inserted for a confirmation in Send with Delivery Info (a guard for any other path).
--  * sales_confirmations: a confirmation that has a live (not cancelled) Dispatch and Billing item cannot leave
--    Send with Delivery Info (it could be moved back to Draft or Send before).
-- Existing items are not touched. Safe to run twice.

begin;

create or replace function public.dnb_from_sc(p_sc uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare s sales_confirmations; l sc_lines; o uuid; first_o uuid; co uuid;
begin
  select * into s from sales_confirmations where id = p_sc for update;
  if not found or s.status <> 'confirmed' or s.stage is distinct from 'send_delivery' then return null; end if;
  if not exists (select 1 from sc_lines where sc_id = p_sc) or exists (select 1 from sc_lines where sc_id = p_sc and rate is null) then return null; end if;
  co := coalesce(s.company_id, (select id from companies where is_home and is_active limit 1));
  if co is null then return null; end if;
  for l in select * from sc_lines x where x.sc_id = p_sc
           and not exists (select 1 from orders z where z.sc_line_id = x.id and z.status <> 'cancelled')
           order by x.line_no loop
    insert into orders(deal_id, sales_confirmation_id, sc_line_id, buyer_id, supplier_id, company_id, count_id, quantity, uom,
                       buyer_rate, supplier_rate, final_rate, commission_type, commission_value, price_basis, freight, bag_weight, payment_term_id,
                       buyer_comm_basis, buyer_comm_value, supplier_comm_basis, supplier_comm_value,
                       delivery_schedule, special_instructions, job_process_id, alt_delivery_address,
                       sale_type, transporter_id, vehicle_no, driver_phone, person_id)
    values (s.deal_id, s.id, l.id, s.buyer_id, s.supplier_id, co, l.count_id, l.quantity, l.uom,
            l.rate, l.rate, l.rate, null, null, coalesce(s.price_basis,'ex_mill'), s.freight, l.bag_weight, s.payment_term_id,
            s.buyer_comm_basis, s.buyer_comm_value, s.supplier_comm_basis, s.supplier_comm_value,
            s.delivery_schedule, s.special_instructions, s.job_process_id, s.delivery_address,
            s.sale_type, s.transporter_id, s.vehicle_no, s.driver_phone, coalesce(auth.uid(), s.created_by))
    returning id into o;
    first_o := coalesce(first_o, o);
  end loop;
  return first_o;
end
$$;

create or replace function public.create_dispatch_bill(p_sc uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare s sales_confirmations; o uuid;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select * into s from sales_confirmations where id = p_sc;
  if not found then raise exception 'Sales Confirmation not found'; end if;
  if s.status = 'cancelled' then raise exception 'This Sales Confirmation is cancelled'; end if;
  if s.status <> 'confirmed' then raise exception 'Fill in every required field of the Sales Confirmation first'; end if;
  if s.stage is distinct from 'send_delivery' then
    raise exception 'Move the Sales Confirmation to Send with Delivery Info first: only then does it go to Dispatch and Billing';
  end if;
  if not exists (select 1 from sc_lines where sc_id = p_sc) then raise exception 'The Sales Confirmation has no counts'; end if;
  if exists (select 1 from sc_lines where sc_id = p_sc and rate is null) then raise exception 'Every count on the Sales Confirmation needs a rate'; end if;
  if coalesce(s.company_id, (select id from companies where is_home and is_active limit 1)) is null then raise exception 'Set the internal company first'; end if;
  o := dnb_from_sc(p_sc);
  if o is null then raise exception 'Every count on this Sales Confirmation already has a Dispatch and Billing item'; end if;
  return o;
end
$$;

-- create_order (Deals > Create Dispatch and Billing) calls create_dispatch_bill, so it gets the same check and message.

-- ---------------------------------------------------------------- any other path that inserts an item
create or replace function public.orders_sc_stage_check()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from sales_confirmations where id = new.sales_confirmation_id and stage = 'send_delivery') then
    raise exception 'A Dispatch and Billing item can only be made from a Sales Confirmation in Send with Delivery Info';
  end if;
  return new;
end
$$;

drop trigger if exists trg_orders_a_sc_stage on public.orders;
create trigger trg_orders_a_sc_stage
  before insert on public.orders
  for each row execute function public.orders_sc_stage_check();

-- ---------------------------------------------------------------- a confirmation with an item stays in Send with Delivery Info
create or replace function public.sc_stage_keeps_dnb()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.stage = 'send_delivery' and new.stage is distinct from old.stage and new.status <> 'cancelled'
     and exists (select 1 from orders where sales_confirmation_id = new.id and status <> 'cancelled') then
    raise exception 'This Sales Confirmation has a Dispatch and Billing item, so it stays in Send with Delivery Info';
  end if;
  return new;
end
$$;

drop trigger if exists trg_sc_a_stage_keeps_dnb on public.sales_confirmations;
create trigger trg_sc_a_stage_keeps_dnb
  before update on public.sales_confirmations
  for each row execute function public.sc_stage_keeps_dnb();

revoke all on function public.orders_sc_stage_check() from public, anon, authenticated;
revoke all on function public.sc_stage_keeps_dnb() from public, anon, authenticated;

commit;
