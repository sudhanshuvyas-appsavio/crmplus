-- The enabled monday CRM automations the app did not have yet (read from the monday
-- boards Deals, Sales Confirmation and Dispatch and Billing):
--   1. Deals: moving to Manager Approval notifies the manager; Reconsider notifies the owner
--      (uses notify_user and the notifications table from the Tasks module).
--   2. Sales Confirmation: reaching "Send with Delivery Info" creates its Dispatch and
--      Billing items by itself when it has none.
--   3. Dispatch and Billing: duplicate Invoice No. check (flag + message).
-- Everything else enabled on monday (status -> group, approval date, owner on create,
-- created date, auto numbers, Approved -> Sales Confirmation, partial / fully dispatch
-- status, send timestamps) already exists in the app.

begin;

-- =====================================================================
-- 1. Deal notifications (through the existing notify_user / notifications table of the Tasks module)
-- =====================================================================
-- monday: "When status changes to Manager Approval, notify Manager: 'Please Review this Deal'".
-- With no manager on the deal, everyone who can approve deals is told. Moving to Reconsider
-- tells the deal's owner to revise it (monday addresses the greeting to the owner).
create or replace function public.crm_deals_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; key text := 'deal:' || new.id || ':' || new.status || ':' || coalesce(new.status_changed_at::text, now()::text);
begin
  if new.status = 'manager_approval' and old.status is distinct from 'manager_approval' then
    for r in
      select new.manager_id as u where new.manager_id is not null
      union
      select up.user_id from user_permissions up where up.permission = 'deal.approve' and new.manager_id is null
    loop
      if r.u is distinct from auth.uid() then
        perform notify_user(r.u, 'deal', 'info', 'Deal - ' || new.deal_no, 'Please review this deal - ' || new.deal_no,
                            '/deals?open=' || new.id, null, key);
      end if;
    end loop;
  elsif new.status = 'reconsider' and old.status is distinct from 'reconsider' and new.owner_id is not null and new.owner_id is distinct from auth.uid() then
    perform notify_user(new.owner_id, 'deal', 'warning', 'Revised deal - ' || new.deal_no, 'Please revise this deal - ' || new.deal_no,
                        '/deals?open=' || new.id, null, key);
  end if;
  return null;
end $$;
drop trigger if exists trg_crm_deals_notify on public.crm_deals;
create trigger trg_crm_deals_notify after update of status on public.crm_deals
  for each row execute function public.crm_deals_notify();

-- =====================================================================
-- 2. Sales Confirmation -> Dispatch and Billing, automatically
-- =====================================================================
-- the insert loop of create_dispatch_bill, without permission checks or errors:
-- one item per count that has none yet; returns the first item made (or null)
create or replace function public.dnb_from_sc(p_sc uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s sales_confirmations; l sc_lines; o uuid; first_o uuid; co uuid;
begin
  select * into s from sales_confirmations where id = p_sc;
  if not found or s.status <> 'confirmed' then return null; end if;
  co := coalesce(s.company_id, (select id from companies where is_home and is_active limit 1));
  if co is null then return null; end if;
  for l in select * from sc_lines x where x.sc_id = p_sc and x.rate is not null
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
end $$;

-- the manual button keeps its checks and messages
create or replace function public.create_dispatch_bill(p_sc uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s sales_confirmations; o uuid;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select * into s from sales_confirmations where id = p_sc;
  if not found then raise exception 'Sales Confirmation not found'; end if;
  if s.status = 'cancelled' then raise exception 'This Sales Confirmation is cancelled'; end if;
  if s.status <> 'confirmed' then raise exception 'Fill in every required field of the Sales Confirmation first'; end if;
  if not exists (select 1 from sc_lines where sc_id = p_sc) then raise exception 'The Sales Confirmation has no counts'; end if;
  if exists (select 1 from sc_lines where sc_id = p_sc and rate is null) then raise exception 'Every count on the Sales Confirmation needs a rate'; end if;
  if coalesce(s.company_id, (select id from companies where is_home and is_active limit 1)) is null then raise exception 'Set the internal company first'; end if;
  o := dnb_from_sc(p_sc);
  if o is null then raise exception 'Every count on this Sales Confirmation already has a Dispatch and Billing item'; end if;
  return o;
end $$;

-- monday: status Send -> Send with Delivery Info, when "link to Dispatch and Billing" is empty,
-- creates the Dispatch and Billing item and links it.
create or replace function public.sc_auto_dnb() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'send_delivery' and old.stage is distinct from 'send_delivery' and new.status = 'confirmed'
     and not exists (select 1 from orders where sales_confirmation_id = new.id and status <> 'cancelled') then
    perform dnb_from_sc(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_sc_auto_dnb on public.sales_confirmations;
create trigger trg_sc_auto_dnb after update of stage on public.sales_confirmations
  for each row execute function public.sc_auto_dnb();

-- =====================================================================
-- 3. Dispatch and Billing: duplicate Invoice No. check
-- =====================================================================
alter table public.orders
  add column if not exists is_duplicate boolean not null default false,
  add column if not exists duplication_error text;

-- monday: "Perform duplicate checks and log output in Is Duplicate? / Duplication Error Message"
create or replace function public.orders_duplicate_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare other text;
begin
  if tg_op = 'UPDATE' and new.invoice_no is not distinct from old.invoice_no then
    new.is_duplicate := old.is_duplicate; new.duplication_error := old.duplication_error;
    return new;
  end if;
  new.is_duplicate := false; new.duplication_error := null;
  if new.invoice_no is not null then
    select o.order_no into other from orders o
    where o.id is distinct from new.id and o.status <> 'cancelled' and lower(btrim(o.invoice_no)) = lower(btrim(new.invoice_no))
    order by o.created_at limit 1;
    if other is not null then
      new.is_duplicate := true;
      new.duplication_error := 'Invoice No. ' || new.invoice_no || ' is already on ' || other;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_zz_duplicate on public.orders;
create trigger trg_orders_zz_duplicate before insert or update on public.orders
  for each row execute function public.orders_duplicate_check();

-- existing items
update public.orders o set
  is_duplicate = true,
  duplication_error = 'Invoice No. ' || o.invoice_no || ' is already on ' ||
    (select x.order_no from public.orders x where x.id <> o.id and x.status <> 'cancelled' and lower(btrim(x.invoice_no)) = lower(btrim(o.invoice_no)) order by x.created_at limit 1)
where o.invoice_no is not null and o.status <> 'cancelled'
  and exists (select 1 from public.orders x where x.id <> o.id and x.status <> 'cancelled' and lower(btrim(x.invoice_no)) = lower(btrim(o.invoice_no)));

-- =====================================================================
-- grants
-- =====================================================================
do $$
declare f text;
begin
  foreach f in array array['crm_deals_notify()','dnb_from_sc(uuid)','sc_auto_dnb()','orders_duplicate_check()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant all on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.create_dispatch_bill(uuid) from public, anon;
grant execute on function public.create_dispatch_bill(uuid) to authenticated, service_role;

commit;
