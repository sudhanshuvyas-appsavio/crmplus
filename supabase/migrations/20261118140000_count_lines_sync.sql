-- Keep count rows in step with the single-count fields on deals and Sales Confirmations.
--
-- The count rows (crm_deal_lines / sc_lines) are written by save_deal_lines / save_sc_lines.
-- Anything that still edits the old single-count fields directly (screens from before
-- the count rows, imports, SQL) left row 1 behind:
--   * a deal made from a lead gets a rate on the deal, its row keeps no rate, and
--     approval then refuses "Enter the final rate on every count";
--   * a confirmation saved with only its own count fields has no rows, and
--     "Create Dispatch and Billing" refuses "The Sales Confirmation has no counts".
-- Now: a direct edit of those fields updates the only row (refused when there are
-- several rows), and a confirmation saved that way gets its first row. Existing data
-- is repaired the same way. The save functions mark their own header updates with
-- the session setting app.lines so they are not mirrored back.

begin;

-- =====================================================================
-- 1. Deals
-- =====================================================================
create or replace function public.crm_deals_line_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; tw numeric; v numeric; bc numeric; sc numeric;
begin
  if tg_op = 'INSERT' then return new; end if;
  if coalesce(current_setting('app.lines', true), '') <> '1'
     and (new.count_id, new.quantity, new.uom, new.bag_weight, new.final_rate)
         is distinct from (old.count_id, old.quantity, old.uom, old.bag_weight, old.final_rate) then
    select count(*) into n from crm_deal_lines where deal_id = new.id;
    if n = 1 then
      update crm_deal_lines set count_id = new.count_id, quantity = new.quantity, uom = new.uom,
                                bag_weight = new.bag_weight, final_rate = new.final_rate
      where deal_id = new.id;
    elsif n > 1 then
      raise exception 'This deal has several counts; change them in its Counts table';
    end if;
  end if;
  select count(*), sum(total_weight), sum(line_value),
         sum(trade_commission(new.buyer_comm_basis, new.buyer_comm_value, line_value, uom, quantity, total_weight, bag_weight)),
         sum(trade_commission(new.supplier_comm_basis, new.supplier_comm_value, line_value, uom, quantity, total_weight, bag_weight))
    into n, tw, v, bc, sc
  from crm_deal_lines where deal_id = new.id;
  if n = 0 then return new; end if;
  if new.status is distinct from old.status and new.status in ('manager_approval','approved')
     and exists (select 1 from crm_deal_lines where deal_id = new.id and (final_rate is null or final_rate <= 0)) then
    raise exception 'Enter the final rate on every count before sending the deal for approval';
  end if;
  if new.status is distinct from old.status and new.status in ('manager_approval','approved')
     and exists (select 1 from crm_deal_lines where deal_id = new.id and uom = 'BAGS' and bag_weight is null) then
    raise exception 'Enter the bag weight on every count sold in bags before sending the deal for approval';
  end if;
  new.total_weight := tw;
  new.deal_value := v;
  new.buyer_commission := bc;
  new.supplier_commission := sc;
  if new.commission_type is null then
    new.commission_total := case when bc is null and sc is null then null else coalesce(bc,0) + coalesce(sc,0) end;
  end if;
  return new;
end $$;

create or replace function public.save_deal_lines(p_deal uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d crm_deals; first crm_deal_lines;
begin
  if not (has_permission('deal.edit') or has_permission('deal.create')) then
    raise exception 'You do not have permission to change deals';
  end if;
  select * into d from crm_deals where id = p_deal for update;
  if not found then raise exception 'Deal not found'; end if;
  if d.status = 'approved' or d.sales_confirmation_id is not null then
    raise exception 'This deal is Approved and its counts are locked';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A deal needs at least one count';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) v where v->>'uom' = 'BAGS' and nullif(v->>'bag_weight','') is null) then
    raise exception 'Enter the bag weight for every count sold in bags';
  end if;
  delete from crm_deal_lines where deal_id = p_deal;
  insert into crm_deal_lines(deal_id, line_no, count_id, quantity, uom, bag_weight, final_rate)
  select p_deal, x.n, (x.v->>'count_id')::uuid, (x.v->>'quantity')::numeric, coalesce(nullif(x.v->>'uom',''),'KG'),
         nullif(x.v->>'bag_weight','')::numeric, nullif(x.v->>'final_rate','')::numeric
  from jsonb_array_elements(p_lines) with ordinality as x(v, n);
  select * into first from crm_deal_lines where deal_id = p_deal order by line_no limit 1;
  perform set_config('app.lines', '1', true);
  update crm_deals set count_id = first.count_id, quantity = first.quantity, uom = first.uom,
                       bag_weight = first.bag_weight, final_rate = first.final_rate
  where id = p_deal;
  perform set_config('app.lines', '', true);
end $$;

-- =====================================================================
-- 2. Sales Confirmations
-- =====================================================================
create or replace function public.sc_line_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; tw numeric; v numeric;
begin
  if tg_op = 'INSERT' then return new; end if;
  if coalesce(current_setting('app.lines', true), '') <> '1'
     and (new.count_id, new.quantity, new.uom, new.bag_weight, new.rate)
         is distinct from (old.count_id, old.quantity, old.uom, old.bag_weight, old.rate) then
    select count(*) into n from sc_lines where sc_id = new.id;
    if n = 1 then
      if new.count_id is not null and new.quantity > 0 then
        update sc_lines set count_id = new.count_id, quantity = new.quantity, uom = new.uom,
                            bag_weight = new.bag_weight, rate = new.rate
        where sc_id = new.id;
      end if;
    elsif n = 0 then
      if new.count_id is not null and new.quantity > 0 then
        insert into sc_lines(sc_id, line_no, count_id, quantity, uom, bag_weight, rate)
        values (new.id, 1, new.count_id, new.quantity, new.uom, new.bag_weight, new.rate);
      end if;
    else
      raise exception 'This Sales Confirmation has several counts; change them in its Counts table';
    end if;
  end if;
  select count(*), sum(total_weight), sum(line_value) into n, tw, v from sc_lines where sc_id = new.id;
  if n > 0 then new.total_weight := tw; new.sc_value := v; end if;
  return new;
end $$;

-- a confirmation saved with only its own count fields starts with one row from them
create or replace function public.sc_first_line() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.lines', true), '') <> '1'
     and new.count_id is not null and new.quantity > 0
     and not exists (select 1 from sc_lines where sc_id = new.id) then
    insert into sc_lines(sc_id, line_no, count_id, quantity, uom, bag_weight, rate)
    values (new.id, 1, new.count_id, new.quantity, new.uom, new.bag_weight, new.rate);
  end if;
  return null;
end $$;
drop trigger if exists trg_sc_y_first_line on public.sales_confirmations;
create trigger trg_sc_y_first_line after insert on public.sales_confirmations
  for each row execute function public.sc_first_line();

create or replace function public.save_sc_lines(p_sc uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s sales_confirmations; first sc_lines;
begin
  if not has_permission('sc.manage') then raise exception 'You need permission to manage sales confirmations'; end if;
  select * into s from sales_confirmations where id = p_sc for update;
  if not found then raise exception 'Sales Confirmation not found'; end if;
  if s.status = 'cancelled' then raise exception 'This Sales Confirmation is cancelled'; end if;
  if s.deal_id is not null then raise exception 'The counts of a confirmation made from a deal come from the deal and are locked'; end if;
  if exists (select 1 from orders where sales_confirmation_id = p_sc and status <> 'cancelled') then
    raise exception 'This confirmation already has Dispatch and Billing items; its counts are locked';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A Sales Confirmation needs at least one count';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) v where v->>'uom' = 'BAGS' and nullif(v->>'bag_weight','') is null) then
    raise exception 'Enter the bag weight for every count sold in bags';
  end if;
  delete from sc_lines where sc_id = p_sc;
  insert into sc_lines(sc_id, line_no, count_id, quantity, uom, bag_weight, rate)
  select p_sc, x.n, (x.v->>'count_id')::uuid, (x.v->>'quantity')::numeric, coalesce(nullif(x.v->>'uom',''),'KG'),
         nullif(x.v->>'bag_weight','')::numeric, nullif(x.v->>'rate','')::numeric
  from jsonb_array_elements(p_lines) with ordinality as x(v, n);
  select * into first from sc_lines where sc_id = p_sc order by line_no limit 1;
  perform set_config('app.lines', '1', true);
  update sales_confirmations set count_id = first.count_id, quantity = first.quantity, net_quantity = first.quantity,
                                 uom = first.uom, bag_weight = first.bag_weight, rate = first.rate
  where id = p_sc;
  perform set_config('app.lines', '', true);
end $$;

-- Deal -> Sales Confirmation copies every row (the first-row trigger must not add its own)
create or replace function public.sc_from_deal(p_deal uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d crm_deals; sc uuid; prev text := coalesce(current_setting('app.confirming', true),'');
begin
  select * into d from crm_deals where id = p_deal for update;
  if not found then raise exception 'Deal not found'; end if;
  if d.sales_confirmation_id is not null then return d.sales_confirmation_id; end if;
  perform set_config('app.lines', '1', true);
  insert into sales_confirmations(deal_id, company_id, supplier_id, buyer_id, count_id, uom, quantity, net_quantity, freight, price_basis, bag_weight,
                                  rate, buyer_rate, supplier_rate, commission_type, commission_value, payment_term_id,
                                  buyer_comm_basis, buyer_comm_value, supplier_comm_basis, supplier_comm_value)
  values (d.id, d.company_id, d.supplier_id, d.buyer_id, d.count_id, d.uom, d.quantity, d.quantity, d.freight, coalesce(d.price_basis,'ex_mill'), d.bag_weight,
          d.final_rate, d.final_rate, d.final_rate, null, null, d.payment_term_id,
          d.buyer_comm_basis, d.buyer_comm_value, d.supplier_comm_basis, d.supplier_comm_value)
  returning id into sc;
  insert into sc_lines(sc_id, line_no, deal_line_id, count_id, quantity, uom, bag_weight, rate)
  select sc, l.line_no, l.id, l.count_id, l.quantity, l.uom, l.bag_weight, l.final_rate
  from crm_deal_lines l where l.deal_id = d.id order by l.line_no;
  -- header totals from the copied rows
  update sales_confirmations set updated_at = now() where id = sc;
  perform set_config('app.lines', '', true);
  perform set_config('app.confirming', '1', true);
  update crm_deals set confirmed_at = now(), confirmed_by = auth.uid(), sales_confirmation_id = sc where id = d.id;
  perform set_config('app.confirming', prev, true);
  return sc;
end $$;

-- =====================================================================
-- 3. Repair existing data (rows left behind by direct edits)
--    Plain statements only: no temporary tables, no switching triggers off, so it
--    also runs in the Supabase SQL Editor, which can run statements separately.
-- =====================================================================
update public.crm_deal_lines l set count_id = d.count_id, quantity = d.quantity, uom = d.uom, bag_weight = d.bag_weight, final_rate = d.final_rate
from public.crm_deals d
where l.deal_id = d.id and d.quantity > 0
  and (select count(*) from public.crm_deal_lines x where x.deal_id = d.id) = 1
  and (l.count_id, l.quantity, l.uom, l.bag_weight, l.final_rate) is distinct from (d.count_id, d.quantity, d.uom, d.bag_weight, d.final_rate);
insert into public.crm_deal_lines(deal_id, line_no, count_id, quantity, uom, bag_weight, final_rate)
select d.id, 1, d.count_id, d.quantity, d.uom, d.bag_weight, d.final_rate from public.crm_deals d
where d.count_id is not null and d.quantity > 0 and not exists (select 1 from public.crm_deal_lines l where l.deal_id = d.id);

update public.sc_lines l set count_id = s.count_id, quantity = s.quantity, uom = s.uom, bag_weight = s.bag_weight, rate = s.rate
from public.sales_confirmations s
where l.sc_id = s.id and s.count_id is not null and s.quantity > 0
  and (select count(*) from public.sc_lines x where x.sc_id = s.id) = 1
  and (l.count_id, l.quantity, l.uom, l.bag_weight, l.rate) is distinct from (s.count_id, s.quantity, s.uom, s.bag_weight, s.rate);
insert into public.sc_lines(sc_id, line_no, count_id, quantity, uom, bag_weight, rate)
select s.id, 1, s.count_id, s.quantity, s.uom, s.bag_weight, s.rate from public.sales_confirmations s
where s.count_id is not null and s.quantity > 0 and not exists (select 1 from public.sc_lines l where l.sc_id = s.id);

-- header totals from the rows, only where they differ (the update triggers recompute them)
update public.crm_deals d set updated_at = d.updated_at
where exists (select 1 from public.crm_deal_lines l where l.deal_id = d.id)
  and (d.total_weight, d.deal_value) is distinct from
      ((select sum(l.total_weight) from public.crm_deal_lines l where l.deal_id = d.id), (select sum(l.line_value) from public.crm_deal_lines l where l.deal_id = d.id));
update public.sales_confirmations s set updated_at = s.updated_at
where exists (select 1 from public.sc_lines l where l.sc_id = s.id)
  and (s.total_weight, s.sc_value) is distinct from
      ((select sum(l.total_weight) from public.sc_lines l where l.sc_id = s.id), (select sum(l.line_value) from public.sc_lines l where l.sc_id = s.id));

-- =====================================================================
-- grants
-- =====================================================================
revoke all on function public.sc_first_line() from public, anon, authenticated;
grant all on function public.sc_first_line() to service_role;
revoke all on function public.crm_deals_line_totals() from public, anon, authenticated;
revoke all on function public.sc_line_totals() from public, anon, authenticated;
revoke all on function public.sc_from_deal(uuid) from public, anon, authenticated;
revoke all on function public.save_deal_lines(uuid, jsonb) from public, anon;
grant execute on function public.save_deal_lines(uuid, jsonb) to authenticated, service_role;
revoke all on function public.save_sc_lines(uuid, jsonb) from public, anon;
grant execute on function public.save_sc_lines(uuid, jsonb) to authenticated, service_role;

commit;
