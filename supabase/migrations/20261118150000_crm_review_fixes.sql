-- Fixes found in the pre-release review of the count lines and automations.
--   * Auto Dispatch and Billing now fires when a confirmation reaches "Send with Delivery Info"
--     through sending (which only sets the sent time; the stage is moved by a trigger),
--     not only when the stage is changed by hand.
--   * It creates items only when every count has a rate (all or none), and never twice:
--     the confirmation row is locked and one live item per count is enforced.
--   * Execution status (Open / Partially / Executed) is judged per count.
--   * Deal notifications reach active admins as well as people with the approve permission.
--   * Manager Approval needs a weight per unit on every count not sold by KG or TONS
--     (otherwise weight, value and commissions stay blank on the confirmation and items).

begin;

-- one live Dispatch and Billing item per count
create unique index if not exists orders_sc_line_live_uq on public.orders(sc_line_id)
  where sc_line_id is not null and status <> 'cancelled';

-- all-or-nothing creation, serialised per confirmation
create or replace function public.dnb_from_sc(p_sc uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s sales_confirmations; l sc_lines; o uuid; first_o uuid; co uuid;
begin
  select * into s from sales_confirmations where id = p_sc for update;
  if not found or s.status <> 'confirmed' then return null; end if;
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
end $$;

-- the trigger fires on any update of the confirmation: sending only sets the sent time,
-- and the stage is moved afterwards by sc_derive, which "UPDATE OF stage" would not see
drop trigger if exists trg_sc_auto_dnb on public.sales_confirmations;
create trigger trg_sc_auto_dnb after update on public.sales_confirmations
  for each row execute function public.sc_auto_dnb();

-- execution status per count: Executed only when every count has been dispatched in full
create or replace function public.sc_execution_status(p_sc uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare s sales_confirmations; disp numeric; ret numeric; has_lines boolean; all_done boolean;
begin
  select * into s from sales_confirmations where id = p_sc;
  if not found then return null; end if;
  if s.status = 'cancelled' then return 'Cancelled'; end if;
  select coalesce(sum(x.quantity),0) into disp from order_dispatches x join orders o on o.id = x.order_id where o.sales_confirmation_id = p_sc;
  select coalesce(sum(quantity),0) into ret from sc_returns where sc_id = p_sc;
  if ret > 0 then return 'Return Adjusted'; end if;
  if disp <= 0 then return 'Open'; end if;
  select count(*) > 0,
         coalesce(bool_and(coalesce((select sum(x.quantity) from order_dispatches x join orders o on o.id = x.order_id where o.sc_line_id = l.id), 0) >= l.quantity), false)
    into has_lines, all_done
  from sc_lines l where l.sc_id = p_sc;
  if has_lines then
    if all_done then return 'Executed'; end if;
  elsif disp >= coalesce(s.quantity, 0) then
    return 'Executed';
  end if;
  return 'Partially Executed';
end $$;

-- notifications: active admins and active holders of the approve permission when the deal has no manager
create or replace function public.crm_deals_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; key text := 'deal:' || new.id || ':' || new.status || ':' || coalesce(new.status_changed_at::text, now()::text);
begin
  if new.status = 'manager_approval' and old.status is distinct from 'manager_approval' then
    for r in
      select p.id as u from profiles p
      where p.is_active and new.manager_id is not null and p.id = new.manager_id
      union
      select p.id from profiles p
      where p.is_active and new.manager_id is null
        and (p.is_admin or exists (select 1 from user_permissions up where up.user_id = p.id and up.permission = 'deal.approve'))
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

-- weight per unit before Manager Approval for every count not sold by KG or TONS
create or replace function public.crm_deals_unit_weight_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('manager_approval','approved')
     and exists (select 1 from crm_deal_lines where deal_id = new.id and uom not in ('KG','TONS') and (bag_weight is null or bag_weight <= 0)) then
    raise exception 'Enter the weight per unit on every count that is not sold by KG or TONS before sending the deal for approval';
  end if;
  return new;
end $$;
drop trigger if exists trg_crm_deals_f_unit_weight on public.crm_deals;
create trigger trg_crm_deals_f_unit_weight before update on public.crm_deals
  for each row execute function public.crm_deals_unit_weight_check();

do $$
declare f text;
begin
  foreach f in array array['dnb_from_sc(uuid)','crm_deals_notify()','crm_deals_unit_weight_check()','sc_auto_dnb()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant all on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.sc_execution_status(uuid) from public, anon;
grant execute on function public.sc_execution_status(uuid) to authenticated, service_role;

commit;
