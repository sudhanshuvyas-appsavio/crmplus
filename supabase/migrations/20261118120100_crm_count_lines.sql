-- Count lines on deals and Sales Confirmations ("Commissioning Business - Changes needed").
--
-- A deal (and the Sales Confirmation made from it) can carry several counts, one row
-- each: Count, Quantity, Unit, Bag Weight, Final Rate. Buyer and supplier commission
-- stay per party (from the party master) and are worked out per row.
--
-- * crm_deal_lines / sc_lines hold the rows. Every existing deal and confirmation
--   gets one row from its current fields.
-- * The old single-count fields on crm_deals / sales_confirmations are kept and mirror
--   the first row, so dashboards, the lead -> deal automation and old screens keep
--   working; weight, value and commissions on the header are the totals of all rows.
-- * Rows are written only through save_deal_lines / save_sc_lines (one call replaces
--   all rows). Rows are locked once the deal is Approved, or once the confirmation
--   came from a deal or has a Dispatch and Billing item.
-- * Approving a deal copies all its rows into the Sales Confirmation.
-- * "Create Dispatch and Billing" makes one item per row (orders.sc_line_id).

begin;

-- =====================================================================
-- 1. Deal lines
-- =====================================================================
create table if not exists public.crm_deal_lines (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references public.crm_deals(id) on delete cascade,
  line_no      int  not null,
  count_id     uuid not null references public.count_master(id),
  quantity     numeric not null check (quantity > 0),
  uom          text not null default 'KG' check (uom in ('KG','BAGS','HANKS','BALES','CARTON','CHIPPA','METERS','TONS')),
  bag_weight   numeric check (bag_weight is null or bag_weight > 0),
  final_rate   numeric check (final_rate is null or final_rate >= 0),
  total_weight numeric,
  line_value   numeric,
  created_at   timestamptz not null default now(),
  unique (deal_id, line_no)
);
create index if not exists crm_deal_lines_deal_idx on public.crm_deal_lines(deal_id);

create or replace function public.trade_line_derive() returns trigger
language plpgsql security definer set search_path = public as $$
declare rate numeric;
begin
  new.total_weight := trade_total_weight(new.uom, new.quantity, new.bag_weight);
  rate := case when tg_table_name = 'crm_deal_lines' then to_jsonb(new)->>'final_rate' else to_jsonb(new)->>'rate' end;
  new.line_value := new.total_weight * rate;
  return new;
end $$;
drop trigger if exists trg_crm_deal_lines_derive on public.crm_deal_lines;
create trigger trg_crm_deal_lines_derive before insert or update on public.crm_deal_lines
  for each row execute function public.trade_line_derive();

alter table public.crm_deal_lines enable row level security;
drop policy if exists crm_deal_lines_sel on public.crm_deal_lines;
create policy crm_deal_lines_sel on public.crm_deal_lines for select to authenticated using (has_permission('deal.read'));
revoke all on public.crm_deal_lines from anon;
revoke insert, update, delete on public.crm_deal_lines from authenticated;
grant select on public.crm_deal_lines to authenticated;
grant all on public.crm_deal_lines to service_role;

-- Bag weight is now checked on each count row before Manager Approval (crm_deals_line_totals);
-- the old header rule blocked a lead in BAGS (leads carry no bag weight) from becoming a deal.
alter table public.crm_deals drop constraint if exists bags_need_weight;

-- every existing deal: one row from its fields
insert into public.crm_deal_lines(deal_id, line_no, count_id, quantity, uom, bag_weight, final_rate)
select d.id, 1, d.count_id, d.quantity, d.uom, d.bag_weight, d.final_rate
from public.crm_deals d
where d.count_id is not null and d.quantity > 0
  and not exists (select 1 from public.crm_deal_lines l where l.deal_id = d.id);

-- a new deal (by hand or from a lead) starts with one row from its fields
create or replace function public.crm_deals_first_line() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.count_id is not null and new.quantity > 0 and not exists (select 1 from crm_deal_lines where deal_id = new.id) then
    insert into crm_deal_lines(deal_id, line_no, count_id, quantity, uom, bag_weight, final_rate)
    values (new.id, 1, new.count_id, new.quantity, new.uom, new.bag_weight, new.final_rate);
  end if;
  return null;
end $$;
drop trigger if exists trg_crm_deals_y_first_line on public.crm_deals;
create trigger trg_crm_deals_y_first_line after insert on public.crm_deals
  for each row execute function public.crm_deals_first_line();

-- header totals = all rows (runs after trg_crm_deals_d_derive, before the status guard)
create or replace function public.crm_deals_line_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; tw numeric; v numeric; bc numeric; sc numeric;
begin
  if tg_op = 'INSERT' then return new; end if;
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
drop trigger if exists trg_crm_deals_e_lines on public.crm_deals;
create trigger trg_crm_deals_e_lines before insert or update on public.crm_deals
  for each row execute function public.crm_deals_line_totals();

-- replace all rows of a deal in one call
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
  update crm_deals set count_id = first.count_id, quantity = first.quantity, uom = first.uom,
                       bag_weight = first.bag_weight, final_rate = first.final_rate
  where id = p_deal;
end $$;

-- =====================================================================
-- 2. Sales Confirmation lines
-- =====================================================================
create table if not exists public.sc_lines (
  id           uuid primary key default gen_random_uuid(),
  sc_id        uuid not null references public.sales_confirmations(id) on delete cascade,
  line_no      int  not null,
  deal_line_id uuid references public.crm_deal_lines(id) on delete set null,
  count_id     uuid not null references public.count_master(id),
  quantity     numeric not null check (quantity > 0),
  uom          text not null default 'KG' check (uom in ('KG','BAGS','HANKS','BALES','CARTON','CHIPPA','METERS','TONS')),
  bag_weight   numeric check (bag_weight is null or bag_weight > 0),
  rate         numeric check (rate is null or rate >= 0),
  total_weight numeric,
  line_value   numeric,
  created_at   timestamptz not null default now(),
  unique (sc_id, line_no)
);
create index if not exists sc_lines_sc_idx on public.sc_lines(sc_id);
drop trigger if exists trg_sc_lines_derive on public.sc_lines;
create trigger trg_sc_lines_derive before insert or update on public.sc_lines
  for each row execute function public.trade_line_derive();

alter table public.sc_lines enable row level security;
drop policy if exists sc_lines_sel on public.sc_lines;
create policy sc_lines_sel on public.sc_lines for select to authenticated using (has_permission('sc.read') or has_permission('sc.manage'));
revoke all on public.sc_lines from anon;
revoke insert, update, delete on public.sc_lines from authenticated;
grant select on public.sc_lines to authenticated;
grant all on public.sc_lines to service_role;

-- every existing confirmation with a count: one row from its fields
alter table public.sc_lines disable trigger trg_sc_lines_derive;
insert into public.sc_lines(sc_id, line_no, deal_line_id, count_id, quantity, uom, bag_weight, rate, total_weight, line_value)
select s.id, 1, (select l.id from public.crm_deal_lines l where l.deal_id = s.deal_id order by l.line_no limit 1),
       s.count_id, s.quantity, s.uom, s.bag_weight, s.rate,
       public.trade_total_weight(s.uom, s.quantity, s.bag_weight), public.trade_total_weight(s.uom, s.quantity, s.bag_weight) * s.rate
from public.sales_confirmations s
where s.count_id is not null and s.quantity > 0
  and not exists (select 1 from public.sc_lines l where l.sc_id = s.id);
alter table public.sc_lines enable trigger trg_sc_lines_derive;

-- header totals = all rows (runs after trg_sc_derive)
create or replace function public.sc_line_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; tw numeric; v numeric;
begin
  if tg_op = 'INSERT' then return new; end if;
  select count(*), sum(total_weight), sum(line_value) into n, tw, v from sc_lines where sc_id = new.id;
  if n > 0 then new.total_weight := tw; new.sc_value := v; end if;
  return new;
end $$;
drop trigger if exists trg_sc_lines_totals on public.sales_confirmations;
create trigger trg_sc_lines_totals before update on public.sales_confirmations
  for each row execute function public.sc_line_totals();

-- replace all rows of a manual confirmation in one call
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
  update sales_confirmations set count_id = first.count_id, quantity = first.quantity, net_quantity = first.quantity,
                                 uom = first.uom, bag_weight = first.bag_weight, rate = first.rate
  where id = p_sc;
end $$;

-- Deal -> Sales Confirmation now copies every row
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
  insert into sc_lines(sc_id, line_no, deal_line_id, count_id, quantity, uom, bag_weight, rate)
  select sc, l.line_no, l.id, l.count_id, l.quantity, l.uom, l.bag_weight, l.final_rate
  from crm_deal_lines l where l.deal_id = d.id order by l.line_no;
  -- header totals from the copied rows
  update sales_confirmations set updated_at = now() where id = sc;
  perform set_config('app.confirming', '1', true);
  update crm_deals set confirmed_at = now(), confirmed_by = auth.uid(), sales_confirmation_id = sc where id = d.id;
  perform set_config('app.confirming', prev, true);
  return sc;
end $$;

-- =====================================================================
-- 3. Dispatch and Billing: one item per count
-- =====================================================================
-- a deal can now have several items (one per count)
alter table public.orders drop constraint if exists orders_deal_id_key;
create index if not exists orders_deal_idx on public.orders(deal_id);
alter table public.orders add column if not exists sc_line_id uuid references public.sc_lines(id) on delete set null;
create index if not exists orders_sc_line_idx on public.orders(sc_line_id);
update public.orders o set sc_line_id = l.id
from public.sc_lines l
where o.sc_line_id is null and l.sc_id = o.sales_confirmation_id and l.line_no = 1;

create or replace function public.create_dispatch_bill(p_sc uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s sales_confirmations; l sc_lines; o uuid; first_o uuid; co uuid;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select * into s from sales_confirmations where id = p_sc;
  if not found then raise exception 'Sales Confirmation not found'; end if;
  if s.status = 'cancelled' then raise exception 'This Sales Confirmation is cancelled'; end if;
  if s.status <> 'confirmed' then raise exception 'Fill in every required field of the Sales Confirmation first'; end if;
  if not exists (select 1 from sc_lines where sc_id = p_sc) then raise exception 'The Sales Confirmation has no counts'; end if;
  if exists (select 1 from sc_lines where sc_id = p_sc and rate is null) then raise exception 'Every count on the Sales Confirmation needs a rate'; end if;
  co := coalesce(s.company_id, (select id from companies where is_home and is_active limit 1));
  if co is null then raise exception 'Set the internal company first'; end if;
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
            s.sale_type, s.transporter_id, s.vehicle_no, s.driver_phone, auth.uid())
    returning id into o;
    first_o := coalesce(first_o, o);
  end loop;
  if first_o is null then raise exception 'Every count on this Sales Confirmation already has a Dispatch and Billing item'; end if;
  return first_o;
end $$;

-- =====================================================================
-- 4. grants
-- =====================================================================
do $$
declare f text;
begin
  foreach f in array array['trade_line_derive()','crm_deals_first_line()','crm_deals_line_totals()','sc_line_totals()','sc_from_deal(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant all on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.save_deal_lines(uuid, jsonb) from public, anon;
grant execute on function public.save_deal_lines(uuid, jsonb) to authenticated, service_role;
revoke all on function public.save_sc_lines(uuid, jsonb) from public, anon;
grant execute on function public.save_sc_lines(uuid, jsonb) to authenticated, service_role;
revoke all on function public.create_dispatch_bill(uuid) from public, anon;
grant execute on function public.create_dispatch_bill(uuid) to authenticated, service_role;

commit;
