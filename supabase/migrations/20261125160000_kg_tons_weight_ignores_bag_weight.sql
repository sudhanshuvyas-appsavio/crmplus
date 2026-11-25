-- Total Weight for counts sold by KG or Tons (found in the end-to-end test, 2026-11-25).
--
-- Until now, once a row had a bag weight, Total Weight was Quantity x Bag Weight whatever the unit. For KG and Tons the
-- quantity already is a weight, so the weight, the value and every percentage commission came out multiplied by the
-- bag weight (1,000 KG with a 50 kg bag weight counted as 50,000 kg). Sales Confirmation requires a bag weight on every
-- row, so every KG / Tons row was affected.
--
-- Now: KG = the quantity, Tons = quantity x 1000, whatever the bag weight (it stays on the record as information);
-- other units (Bags, Hanks, Cartons ...) still use Quantity x Bag Weight.
-- A per-bag commission on a KG / Tons row now counts the bags (total weight / bag weight) instead of the kilograms
-- (no row used per-bag terms on KG / Tons when this was written, so no commission changes).
--
-- Then the stored totals of the existing KG / Tons rows that have a bag weight are worked out again: deal and
-- confirmation count rows, deals, confirmations, Dispatch and Billing items and their dispatch entries. Their user
-- triggers are paused only for these updates, so locked records (approved deals, confirmations made from a deal,
-- closed items) are not refused and no terms are pulled again from the masters; only the derived figures change.
-- Commission invoices already issued are not changed.
-- Safe to run twice.

begin;

create or replace function public.trade_total_weight(p_uom text, p_qty numeric, p_unit_weight numeric)
returns numeric
language sql
immutable
set search_path to 'public'
as $$
  select case
    when p_qty is null then null
    when p_uom = 'KG' then p_qty
    when p_uom = 'TONS' then p_qty * 1000
    when p_unit_weight is not null then p_qty * p_unit_weight
    else null
  end
$$;

-- A per-bag commission on a KG / Tons row counts the bags (total weight / bag weight) instead of the kilograms;
-- with no bag weight it cannot be worked out. Other units: rate x quantity, as before.
create or replace function public.trade_commission(p_basis text, p_value numeric, p_amount numeric, p_uom text,
                                                   p_qty numeric, p_total_weight numeric, p_unit_weight numeric)
returns numeric
language sql
immutable
set search_path to 'public'
as $$
  select case p_basis
    when 'pct' then p_amount * p_value / 100
    when 'per_kg' then p_value * p_total_weight
    when 'per_bag' then case
      when p_uom in ('KG', 'TONS') then case when p_unit_weight > 0 then p_value * p_total_weight / p_unit_weight end
      else p_value * p_qty
    end
  end
$$;

-- ---------------------------------------------------------------- deal count rows and deals
alter table public.crm_deal_lines disable trigger user;
update public.crm_deal_lines
   set total_weight = trade_total_weight(uom, quantity, bag_weight),
       line_value = trade_total_weight(uom, quantity, bag_weight) * final_rate
 where uom in ('KG', 'TONS') and bag_weight is not null;
alter table public.crm_deal_lines enable trigger user;

alter table public.crm_deals disable trigger user;
-- deals with count rows: the totals are the sums of their rows
update public.crm_deals d
   set total_weight = x.tw,
       deal_value = x.v,
       buyer_commission = x.bc,
       supplier_commission = x.sc,
       commission_total = case when d.commission_type is not null then d.commission_total
                               when x.bc is null and x.sc is null then null
                               else coalesce(x.bc, 0) + coalesce(x.sc, 0) end
  from (
    select l.deal_id, sum(l.total_weight) tw, sum(l.line_value) v,
           sum(trade_commission(dd.buyer_comm_basis, dd.buyer_comm_value, l.line_value, l.uom, l.quantity, l.total_weight, l.bag_weight)) bc,
           sum(trade_commission(dd.supplier_comm_basis, dd.supplier_comm_value, l.line_value, l.uom, l.quantity, l.total_weight, l.bag_weight)) sc
      from public.crm_deal_lines l join public.crm_deals dd on dd.id = l.deal_id
     group by l.deal_id
  ) x
 where x.deal_id = d.id
   and exists (select 1 from public.crm_deal_lines l where l.deal_id = d.id and l.uom in ('KG', 'TONS') and l.bag_weight is not null);
-- deals without count rows: from their own fields
update public.crm_deals d
   set total_weight = w.tw,
       deal_value = w.tw * d.final_rate,
       buyer_commission = trade_commission(d.buyer_comm_basis, d.buyer_comm_value, w.tw * d.final_rate, d.uom, d.quantity, w.tw, d.bag_weight),
       supplier_commission = trade_commission(d.supplier_comm_basis, d.supplier_comm_value, w.tw * d.final_rate, d.uom, d.quantity, w.tw, d.bag_weight)
  from (select id, trade_total_weight(uom, quantity, bag_weight) tw from public.crm_deals) w
 where w.id = d.id and d.uom in ('KG', 'TONS') and d.bag_weight is not null
   and not exists (select 1 from public.crm_deal_lines l where l.deal_id = d.id);
update public.crm_deals d
   set commission_total = case when d.buyer_commission is null and d.supplier_commission is null then null
                               else coalesce(d.buyer_commission, 0) + coalesce(d.supplier_commission, 0) end
 where d.commission_type is null and d.uom in ('KG', 'TONS') and d.bag_weight is not null
   and not exists (select 1 from public.crm_deal_lines l where l.deal_id = d.id);
alter table public.crm_deals enable trigger user;

-- ---------------------------------------------------------------- confirmation count rows and confirmations
alter table public.sc_lines disable trigger user;
update public.sc_lines
   set total_weight = trade_total_weight(uom, quantity, bag_weight),
       line_value = trade_total_weight(uom, quantity, bag_weight) * rate
 where uom in ('KG', 'TONS') and bag_weight is not null;
alter table public.sc_lines enable trigger user;

alter table public.sales_confirmations disable trigger user;
update public.sales_confirmations s
   set total_weight = x.tw, sc_value = x.v
  from (select sc_id, sum(total_weight) tw, sum(line_value) v from public.sc_lines group by sc_id) x
 where x.sc_id = s.id
   and exists (select 1 from public.sc_lines l where l.sc_id = s.id and l.uom in ('KG', 'TONS') and l.bag_weight is not null);
update public.sales_confirmations s
   set total_weight = trade_total_weight(s.uom, s.quantity, s.bag_weight),
       sc_value = trade_total_weight(s.uom, s.quantity, s.bag_weight) * s.rate
 where s.uom in ('KG', 'TONS') and s.bag_weight is not null
   and not exists (select 1 from public.sc_lines l where l.sc_id = s.id);
alter table public.sales_confirmations enable trigger user;

-- ---------------------------------------------------------------- Dispatch and Billing items and their entries
alter table public.orders disable trigger user;
update public.orders o
   set total_weight = w.tw,
       order_value = w.tw * o.final_rate,
       buyer_commission = trade_commission(o.buyer_comm_basis, o.buyer_comm_value, w.tw * o.final_rate, o.uom, o.quantity, w.tw, o.bag_weight),
       supplier_commission = trade_commission(o.supplier_comm_basis, o.supplier_comm_value, w.tw * o.final_rate, o.uom, o.quantity, w.tw, o.bag_weight),
       total_amount = trade_total_amount(w.tw * o.final_rate, o.cgst_pct, o.insurance_pct, o.add_amount, o.deduct_amount)
  from (select id, trade_total_weight(uom, quantity, bag_weight) tw from public.orders) w
 where w.id = o.id and o.uom in ('KG', 'TONS') and o.bag_weight is not null;
alter table public.orders enable trigger user;

alter table public.order_dispatches disable trigger user;
update public.order_dispatches d
   set total_weight = trade_total_weight(o.uom, d.quantity, o.bag_weight),
       entry_value = trade_total_weight(o.uom, d.quantity, o.bag_weight) * o.final_rate,
       buyer_commission = trade_commission(o.buyer_comm_basis, o.buyer_comm_value, trade_total_weight(o.uom, d.quantity, o.bag_weight) * o.final_rate,
                                           o.uom, d.quantity, trade_total_weight(o.uom, d.quantity, o.bag_weight), o.bag_weight),
       supplier_commission = trade_commission(o.supplier_comm_basis, o.supplier_comm_value, trade_total_weight(o.uom, d.quantity, o.bag_weight) * o.final_rate,
                                              o.uom, d.quantity, trade_total_weight(o.uom, d.quantity, o.bag_weight), o.bag_weight),
       total_amount = trade_total_amount(trade_total_weight(o.uom, d.quantity, o.bag_weight) * o.final_rate, d.cgst_pct, d.insurance_pct, d.add_amount, d.deduct_amount)
  from public.orders o
 where o.id = d.order_id and o.uom in ('KG', 'TONS') and o.bag_weight is not null;
alter table public.order_dispatches enable trigger user;

commit;
