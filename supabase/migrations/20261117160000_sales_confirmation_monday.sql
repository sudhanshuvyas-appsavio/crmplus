-- Sales Confirmations follow the monday.com "Sales Confirmation" board (board 5026795662).
-- Runs after 20261117150000_deals_monday_model.
--
--  * Status (stage) pipeline: Draft -> Send -> Send with Delivery Info.
--    It moves on by itself when the confirmation is sent to a party: to "Send",
--    or to "Send with Delivery Info" when the transport details are filled in.
--    It can also be set by hand. Cancelled stays a separate state (status).
--    The existing status column keeps meaning draft (incomplete) / confirmed
--    (complete, can be sent) / cancelled.
--  * Type: Local / Export.
--  * Sizing/Delivery Address: a Job process record (the existing master of
--    sizing units and delivery points) plus the address text.
--  * Delivery info: transport company (transporters), vehicle number, driver phone.
--  * Commission terms per party copied from the deal (Percentage / KG / BAG).
--  * Total weight and value worked out like the Deals board.

begin;

alter table public.sales_confirmations
  add column if not exists stage text not null default 'draft',
  add column if not exists sale_type text not null default 'local',
  add column if not exists job_process_id uuid references public.job_processes(id) on delete set null,
  add column if not exists delivery_address text,
  add column if not exists transporter_id uuid references public.transporters(id) on delete set null,
  add column if not exists vehicle_no text,
  add column if not exists driver_phone text,
  add column if not exists buyer_comm_basis text,
  add column if not exists buyer_comm_value numeric(12,4),
  add column if not exists supplier_comm_basis text,
  add column if not exists supplier_comm_value numeric(12,4),
  add column if not exists total_weight numeric,
  add column if not exists sc_value numeric,
  add column if not exists stage_changed_at timestamptz;

alter table public.sales_confirmations
  add constraint sales_confirmations_stage_check check (stage in ('draft','send','send_delivery')),
  add constraint sales_confirmations_sale_type_check check (sale_type in ('local','export')),
  add constraint sales_confirmations_buyer_comm_basis_check check (buyer_comm_basis is null or buyer_comm_basis in ('pct','per_kg','per_bag')),
  add constraint sales_confirmations_supplier_comm_basis_check check (supplier_comm_basis is null or supplier_comm_basis in ('pct','per_kg','per_bag')),
  add constraint sales_confirmations_driver_phone_check check (driver_phone is null or driver_phone ~ '^[0-9+ -]{6,20}$');

-- ---------------------------------------------------------------- data
-- the row trigger stays off so existing confirmations keep their status and timestamps
alter table public.sales_confirmations disable trigger trg_sc_derive;
update public.sales_confirmations s set
  buyer_comm_basis = d.buyer_comm_basis, buyer_comm_value = d.buyer_comm_value,
  supplier_comm_basis = d.supplier_comm_basis, supplier_comm_value = d.supplier_comm_value
from public.crm_deals d where d.id = s.deal_id;
update public.sales_confirmations set
  stage = case when supplier_notified_at is not null or buyer_notified_at is not null then 'send' else 'draft' end,
  total_weight = public.trade_total_weight(uom, quantity, bag_weight),
  sc_value = public.trade_total_weight(uom, quantity, bag_weight) * rate;
alter table public.sales_confirmations enable trigger trg_sc_derive;

-- ---------------------------------------------------------------- derive
create or replace function public.sc_derive() returns trigger
language plpgsql security definer set search_path = public as $$
declare pre text; n int; sent_now boolean; has_delivery boolean;
begin
  if tg_op = 'INSERT' then
    if new.company_id is not null then
      select coalesce(nullif(ref_prefix,''), upper(left(regexp_replace(name,'[^A-Za-z0-9]','','g'),4))) into pre from companies where id = new.company_id;
      insert into sc_number_counters(company_id, year, last_no) values (new.company_id, extract(year from now())::int, 1)
        on conflict (company_id, year) do update set last_no = sc_number_counters.last_no + 1 returning last_no into n;
      new.sc_no := 'SC-' || pre || '-' || to_char(now(),'YYYY') || '-' || lpad(n::text,4,'0');
    else
      new.sc_no := 'SC-' || to_char(now(),'YYYY') || '-' || lpad(nextval('sc_seq')::text,4,'0');
    end if;
    new.confirmed_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.net_quantity is null then new.net_quantity := new.quantity; end if;
    new.stage := 'draft';
    if new.supplier_id is not null and new.supplier_comm_basis is null then
      select commission_basis, commission_value into new.supplier_comm_basis, new.supplier_comm_value from supplier_master where id = new.supplier_id;
    end if;
    if new.buyer_id is not null and new.buyer_comm_basis is null then
      select commission_basis, commission_value into new.buyer_comm_basis, new.buyer_comm_value from buyer_master where id = new.buyer_id;
    end if;
  else
    new.sc_no := old.sc_no;
    new.confirmed_at := old.confirmed_at;
    new.created_by := old.created_by;
    if old.deal_id is not null then
      -- a confirmation created from a deal freezes the commercial terms
      if new.deal_id is distinct from old.deal_id or new.supplier_id is distinct from old.supplier_id or new.buyer_id is distinct from old.buyer_id
         or new.supplier_company_id is distinct from old.supplier_company_id or new.buyer_company_id is distinct from old.buyer_company_id
         or new.company_id is distinct from old.company_id or new.count_id is distinct from old.count_id or new.uom is distinct from old.uom
         or new.quantity is distinct from old.quantity or new.buyer_rate is distinct from old.buyer_rate or new.supplier_rate is distinct from old.supplier_rate
         or new.rate is distinct from old.rate or new.commission_type is distinct from old.commission_type or new.commission_value is distinct from old.commission_value
         or new.buyer_comm_basis is distinct from old.buyer_comm_basis or new.buyer_comm_value is distinct from old.buyer_comm_value
         or new.supplier_comm_basis is distinct from old.supplier_comm_basis or new.supplier_comm_value is distinct from old.supplier_comm_value
         or new.payment_term_id is distinct from old.payment_term_id then
        raise exception 'The commercial terms of a sales confirmation created from a deal are locked. Only freight, ex-mill/net, bag weight, type, delivery and transport details, delivery schedule and instructions can be changed.';
      end if;
    end if;
  end if;
  if new.supplier_company_id is null and new.supplier_id is not null then select company_id into new.supplier_company_id from supplier_master where id = new.supplier_id; end if;
  if new.buyer_company_id is null and new.buyer_id is not null then select company_id into new.buyer_company_id from buyer_master where id = new.buyer_id; end if;
  if new.status <> 'cancelled' then
    new.status := case when new.supplier_id is not null and new.buyer_id is not null and new.supplier_company_id is not null and new.buyer_company_id is not null
      and new.count_id is not null and new.quantity is not null and new.freight is not null and (new.uom <> 'BAGS' or new.bag_weight is not null)
      and (new.deal_id is null or new.price_basis is not null)
      then 'confirmed' else 'draft' end;
  end if;

  -- stage: moves on when a party is notified, or when set by hand
  new.vehicle_no := nullif(btrim(new.vehicle_no), '');
  new.driver_phone := nullif(btrim(new.driver_phone), '');
  has_delivery := new.transporter_id is not null or new.vehicle_no is not null;
  if tg_op = 'UPDATE' then
    sent_now := (new.supplier_notified_at is distinct from old.supplier_notified_at and new.supplier_notified_at is not null)
             or (new.buyer_notified_at is distinct from old.buyer_notified_at and new.buyer_notified_at is not null);
    if sent_now then
      new.stage := case when has_delivery then 'send_delivery' else 'send' end;
    elsif new.stage is distinct from old.stage then
      if not has_permission('sc.manage') then raise exception 'You need permission to manage sales confirmations'; end if;
      if new.stage <> 'draft' and new.status <> 'confirmed' then raise exception 'Fill in every required field before marking the confirmation as sent'; end if;
      if new.stage = 'send_delivery' and not has_delivery then raise exception 'Enter the transport company or vehicle number first'; end if;
    end if;
    if new.stage is distinct from old.stage then new.stage_changed_at := now(); end if;
  end if;

  new.total_weight := trade_total_weight(new.uom, new.quantity, new.bag_weight);
  new.sc_value := new.total_weight * new.rate;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- from a deal: carry the commission terms
create or replace function public.confirm_deal(p_deal uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d crm_deals; p text[]; sc uuid;
begin
  if not (has_permission('deal.edit') or has_permission('deal.create') or has_permission('deal.approve')) then
    raise exception 'You do not have permission to create a Sales Confirmation from a deal';
  end if;
  p := deal_confirm_problems(p_deal);
  if array_length(p,1) > 0 then raise exception 'Cannot create the Sales Confirmation: %', array_to_string(p, '; '); end if;
  select * into d from crm_deals where id = p_deal for update;
  insert into sales_confirmations(deal_id, company_id, supplier_id, buyer_id, count_id, uom, quantity, net_quantity, freight, price_basis, bag_weight,
                                  rate, buyer_rate, supplier_rate, commission_type, commission_value, payment_term_id,
                                  buyer_comm_basis, buyer_comm_value, supplier_comm_basis, supplier_comm_value)
  values (d.id, d.company_id, d.supplier_id, d.buyer_id, d.count_id, d.uom, d.quantity, d.quantity, d.freight, coalesce(d.price_basis,'ex_mill'), d.bag_weight,
          d.final_rate, d.final_rate, d.final_rate, null, null, d.payment_term_id,
          d.buyer_comm_basis, d.buyer_comm_value, d.supplier_comm_basis, d.supplier_comm_value)
  returning id into sc;
  perform set_config('app.confirming', '1', true);
  update crm_deals set confirmed_at = now(), confirmed_by = auth.uid(), sales_confirmation_id = sc where id = d.id;
  perform set_config('app.confirming', '', true);
  return sc;
end $$;

commit;
