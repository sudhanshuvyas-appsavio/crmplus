--
-- PostgreSQL database dump
--

\restrict 3qjM8aM6fMy7UmXHN3ZdjGjPQdaMMCxoKRkZBw9EqWibDqzW2CsDDUfoJjf3IeE

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: activity_can(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activity_can(p_type text, p_write boolean) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select case p_type when 'lead' then has_permission('lead.manage') or has_permission('lead.qualify') when 'supplier' then has_permission('mill.manage') or (not p_write and has_permission('document.read')) when 'buyer' then has_permission('buyer.manage') or (not p_write and has_permission('document.read')) when 'deal' then has_permission('deal.create') or has_permission('deal.edit') or (not p_write and has_permission('deal.read')) else false end $$;


--
-- Name: billing_dispatch_dashboard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.billing_dispatch_dashboard() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  t date := (now() at time zone 'Asia/Kolkata')::date;
  res jsonb := jsonb_build_object('as_of', t);
  a int; b int; c numeric; d numeric; e int;
begin
  if not (public.has_permission('order.read') or public.has_permission('order.manage')) then
    raise exception 'You need permission to view orders';
  end if;
  -- Dispatch today: entries dated today, and orders scheduled for today with quantity left
  select count(*), coalesce(sum(quantity),0) into a, c from order_dispatches where dispatch_date = t;
  select count(*), coalesce(sum(bal),0) into b, d from (
    select o.quantity - coalesce((select sum(x.quantity) from order_dispatches x where x.order_id=o.id),0) bal
    from orders o where o.status in ('confirmed','open_for_execution') and o.tentative_dispatch_date = t) q where bal > 0;
  res := res || jsonb_build_object('dispatch_today', jsonb_build_object('dispatched_entries', a, 'dispatched_qty', c, 'scheduled_orders', b, 'scheduled_balance_qty', d));
  -- Billing pending: dispatches with no mill invoice recorded
  select count(*), count(*) filter (where dispatch_date < t - 3), coalesce(min(t - dispatch_date),0) into a, b, e
    from order_dispatches where mill_invoice_no is null and mill_invoice_date is null;
  res := res || jsonb_build_object('billing_pending', jsonb_build_object('pending', a, 'older_than_3_days', b, 'oldest_days', (select coalesce(max(t - dispatch_date),0) from order_dispatches where mill_invoice_no is null and mill_invoice_date is null)));
  -- Commission pending
  select count(*), coalesce(sum(dl.commission_total),0), count(*) filter (where o.order_date < t - 7) into a, c, b
    from orders o left join crm_deals dl on dl.id = o.deal_id
    where o.status in ('confirmed','open_for_execution') and not exists (select 1 from commission_invoices ci where ci.order_id = o.id);
  res := res || jsonb_build_object('commission_pending', jsonb_build_object('pending', a, 'amount', c, 'older_than_7_days', b));
  -- Transport invoice pending: third-party dispatches with no transporter invoice no.
  select count(*), coalesce(sum(tr.freight_amount),0), count(*) filter (where od.dispatch_date < t - 7) into a, c, b
    from order_dispatches od join order_transports tr on tr.id = od.transport_id
    where tr.kind = 'third_party' and od.transporter_invoice_no is null;
  res := res || jsonb_build_object('transport_invoice_pending', jsonb_build_object('pending', a, 'freight_amount', c, 'older_than_7_days', b));
  return res;
end $$;


--
-- Name: buyer_flag_incomplete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.buyer_flag_incomplete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ begin
new.incomplete := coalesce(btrim(new.contact_person),'')='' or coalesce(btrim(new.gst),'')='' or coalesce(btrim(new.pan),'')='' or coalesce(btrim(new.spindlage_capacity),'')='' or coalesce(btrim(new.product_range),'')='';
return new; end $$;


--
-- Name: cancel_sales_confirmation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_sales_confirmation(p_sc uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare disp numeric;
begin
  if not public.has_permission('sc.manage') then raise exception 'You need permission to manage sales confirmations'; end if;
  select coalesce(sum(x.quantity),0) into disp from order_dispatches x join orders o on o.id = x.order_id where o.sales_confirmation_id = p_sc;
  if disp > 0 then raise exception 'This confirmation already has dispatches and cannot be cancelled'; end if;
  update sales_confirmations set status = 'cancelled' where id = p_sc and status <> 'cancelled';
end $$;


--
-- Name: cd_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cd_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ begin if (select count(*) from company_documents where company_id=new.company_id) >= 10 then raise exception 'A company can have at most 10 documents'; end if; return new; end $$;


--
-- Name: cheque_collection_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cheque_collection_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
  else
    if new.order_id is distinct from old.order_id then raise exception 'A cheque cannot be moved to another order'; end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  new.cheque_no := btrim(new.cheque_no);
  new.deposit_bank := nullif(btrim(new.deposit_bank), '');
  new.slip_no := nullif(btrim(new.slip_no), '');
  if new.collection_date > current_date then raise exception 'The collection date cannot be in the future'; end if;
  if new.deposited_on is null then
    new.deposit_bank := null; new.slip_no := null; new.deposited_by := null;
  else
    if new.deposited_on > current_date then raise exception 'The deposit date cannot be in the future'; end if;
    if new.deposit_bank is null or new.slip_no is null then raise exception 'Enter the bank and the slip number for a deposited cheque'; end if;
    if tg_op = 'INSERT' or old.deposited_on is null then new.deposited_by := coalesce(new.deposited_by, auth.uid());
    else new.deposited_by := old.deposited_by; end if;
  end if;
  if new.collected_by is not null and not exists (select 1 from profiles where id = new.collected_by and is_active) then
    raise exception 'The cheque can only be collected by an active user';
  end if;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: collection_activity(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.collection_activity(p_from date, p_to date) RETURNS TABLE(activity_date date, user_id uuid, name text, cheques_collected bigint, cheques_amount numeric, cash_collections bigint, cash_amount numeric, invoices_delivered bigint, delivery_notes bigint, mill_deposits bigint, mill_deposit_amount numeric, cheques_deposited bigint, cheques_deposited_amount numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not (public.has_permission('order.read') or public.has_permission('order.manage')) then raise exception 'You need permission to view orders'; end if;
  return query
  with a as (
    select collection_date d, collected_by u, 'chq'::text k, amount amt from cheque_collections where collected_by is not null and collection_date between p_from and p_to
    union all
    select deposited_on, deposited_by, 'dep', amount from cheque_collections where deposited_on between p_from and p_to and deposited_by is not null
    union all
    select (completed_at at time zone 'Asia/Kolkata')::date, assigned_to,
           case task_type when 'cash_collection' then 'cash' when 'invoice_delivery' then 'inv' when 'delivery_note' then 'dn' when 'mill_payment_deposit' then 'mill' end, amount_to_collect
    from collection_tasks
    where status = 'done' and assigned_to is not null and task_type in ('cash_collection','invoice_delivery','delivery_note','mill_payment_deposit')
      and (completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  )
  select a.d, a.u, p.name,
    count(*) filter (where k='chq'), coalesce(sum(amt) filter (where k='chq'),0),
    count(*) filter (where k='cash'), coalesce(sum(amt) filter (where k='cash'),0),
    count(*) filter (where k='inv'), count(*) filter (where k='dn'),
    count(*) filter (where k='mill'), coalesce(sum(amt) filter (where k='mill'),0),
    count(*) filter (where k='dep'), coalesce(sum(amt) filter (where k='dep'),0)
  from a join profiles p on p.id = a.u
  group by a.d, a.u, p.name order by a.d desc, p.name;
end $$;


--
-- Name: collection_dashboard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.collection_dashboard() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  t date := (now() at time zone 'Asia/Kolkata')::date;
  res jsonb := jsonb_build_object('as_of', t);
  a int; b int; c numeric; d numeric; e int; aging jsonb;
begin
  if not (public.has_permission('order.read') or public.has_permission('order.manage')) then
    raise exception 'You need permission to view orders';
  end if;
  with ord as (
    select o.id,
           (coalesce((select sum(x.quantity) from order_dispatches x where x.order_id=o.id),0) * o.buyer_rate)
             - coalesce((select sum(p.amount) from order_payments p where p.order_id=o.id and p.kind='buyer_receipt'),0) as outstanding,
           (select min(x.dispatch_date) from order_dispatches x where x.order_id=o.id) + coalesce(pt.days,0) as due
    from orders o left join payment_terms pt on pt.id = o.payment_term_id
    where o.status in ('confirmed','open_for_execution','closed')
  ), open_ord as (select * from ord where outstanding > 0 and due is not null)
  select count(*), coalesce(sum(outstanding),0), coalesce(sum(outstanding) filter (where due < t),0),
    jsonb_build_array(
      jsonb_build_object('label','Not yet due','orders',count(*) filter (where due >= t),'amount',coalesce(sum(outstanding) filter (where due >= t),0)),
      jsonb_build_object('label','1-15 days overdue','orders',count(*) filter (where t-due between 1 and 15),'amount',coalesce(sum(outstanding) filter (where t-due between 1 and 15),0)),
      jsonb_build_object('label','16-30 days overdue','orders',count(*) filter (where t-due between 16 and 30),'amount',coalesce(sum(outstanding) filter (where t-due between 16 and 30),0)),
      jsonb_build_object('label','31-60 days overdue','orders',count(*) filter (where t-due between 31 and 60),'amount',coalesce(sum(outstanding) filter (where t-due between 31 and 60),0)),
      jsonb_build_object('label','Over 60 days overdue','orders',count(*) filter (where t-due > 60),'amount',coalesce(sum(outstanding) filter (where t-due > 60),0)))
  into a, c, d, aging from open_ord;
  res := res || jsonb_build_object('outstanding', jsonb_build_object('orders', a, 'amount', c, 'overdue_amount', d), 'aging', aging);

  select count(*), coalesce(sum(amount),0) into a, c from order_payments where kind='buyer_receipt' and paid_on = t;
  select count(*), coalesce(sum(amount),0) into b, d from cheque_collections where collection_date = t;
  res := res || jsonb_build_object('today', jsonb_build_object('receipts', a, 'receipts_amount', c, 'cheques_collected', b, 'cheques_amount', d));

  select count(*), coalesce(sum(amount),0), coalesce(max(t - collection_date),0), count(*) filter (where collection_date < t - 3)
    into a, c, e, b from cheque_collections where deposited_on is null;
  res := res || jsonb_build_object('cheques_pending', jsonb_build_object('count', a, 'amount', c, 'oldest_days', e, 'older_than_3_days', b));
  return res;
end $$;


--
-- Name: collection_task_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.collection_task_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if new.status in ('done','cancelled') then raise exception 'A new task must start as Pending or In progress'; end if;
    new.completed_at := null; new.completed_by := null;
  else
    if new.order_id is distinct from old.order_id then raise exception 'A task cannot be moved to another order'; end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
    if new.status = 'done' then
      if old.status is distinct from 'done' then new.completed_at := now(); new.completed_by := auth.uid();
      else new.completed_at := old.completed_at; new.completed_by := old.completed_by; end if;
    else
      new.completed_at := null; new.completed_by := null;
    end if;
  end if;
  if new.assigned_to is not null then
    if not exists (select 1 from profiles where id = new.assigned_to and is_active) then raise exception 'The task can only be assigned to an active user'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: commission_invoice_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.commission_invoice_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  new.invoice_no := 'CINV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('cinv_seq')::text,4,'0');
  return new;
end $$;


--
-- Name: confirm_deal(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_deal(p_deal uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare d crm_deals; p text[]; sc uuid;
begin
  if not (public.has_permission('deal.edit') or public.has_permission('deal.create') or public.has_permission('deal.approve')) then
    raise exception 'You do not have permission to confirm deals';
  end if;
  p := public.deal_confirm_problems(p_deal);
  if array_length(p,1) > 0 then raise exception 'Cannot confirm: %', array_to_string(p, '; '); end if;
  select * into d from crm_deals where id = p_deal for update;
  insert into sales_confirmations(deal_id, company_id, supplier_id, buyer_id, count_id, uom, quantity, net_quantity, freight, price_basis, bag_weight,
                                  rate, buyer_rate, supplier_rate, commission_type, commission_value, payment_term_id)
  values (d.id, d.company_id, d.supplier_id, d.buyer_id, d.count_id, d.uom, d.quantity, d.quantity, d.freight, coalesce(d.price_basis,'ex_mill'), d.bag_weight,
          d.supplier_rate, d.buyer_rate, d.supplier_rate, d.commission_type, d.commission_value, d.payment_term_id)
  returning id into sc;
  perform set_config('app.confirming', '1', true);
  update crm_deals set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), sales_confirmation_id = sc where id = d.id;
  perform set_config('app.confirming', '', true);
  return sc;
end $$;


--
-- Name: convert_lead_to_deal(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_lead_to_deal(p_lead uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare l leads%rowtype; d uuid; n text;
begin
  if not has_permission('deal.create') then raise exception 'You do not have permission to create deals'; end if;
  if not (has_permission('lead.manage') or has_permission('lead.qualify')) then raise exception 'You do not have permission to convert leads'; end if;
  select * into l from leads where id=p_lead for update;
  if not found then raise exception 'Lead not found'; end if;
  if l.converted_deal_id is not null then raise exception 'This lead has already been converted to a deal'; end if;
  if l.status<>'qualified' then raise exception 'Only a Qualified lead can be converted to a deal'; end if;
  if l.buyer_id is null or l.count_id is null then raise exception 'The lead needs a buyer and a count before it can be converted'; end if;
  n := concat_ws(' | ', 'From lead '||l.lead_no, nullif(l.remarks,''), case when l.timeline is not null and l.timeline<>'' then 'Timeline: '||l.timeline end);
  insert into crm_deals(lead_id,buyer_id,supplier_id,count_id,quantity,uom,buyer_rate,notes)
  values (l.id,l.buyer_id,l.supplier_id,l.count_id,l.quantity,coalesce(l.uom,'KG'),case when l.party_role in ('buyer','both') then l.expected_rate end,n)
  returning id into d;
  update leads set converted_deal_id=d, converted_at=now() where id=l.id;
  insert into activity_log(entity_type,entity_id,kind,note) values ('deal',d,'note','Created from lead '||l.lead_no);
  return d;
end $$;


--
-- Name: count_master_set_display(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.count_master_set_display() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ begin new.display_name := concat_ws(' ', new.count_no::text || ' S', new.machine, new.ratio, coalesce(new.blended, new.composition), new.yarn_type, new.process, new.certification, new.ply); return new; end; $$;


--
-- Name: create_order(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_order(p_deal uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare d crm_deals; o uuid;
begin
  if not public.has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select * into d from crm_deals where id = p_deal;
  if not found then raise exception 'Deal not found'; end if;
  if d.status <> 'confirmed' or d.sales_confirmation_id is null then raise exception 'An order can only be created from a confirmed deal that has a Sales Confirmation'; end if;
  if exists (select 1 from orders where deal_id = d.id) then raise exception 'This deal already has an order'; end if;
  insert into orders(deal_id, sales_confirmation_id, buyer_id, supplier_id, company_id, count_id, quantity, uom, buyer_rate, supplier_rate,
    commission_type, commission_value, price_basis, freight, bag_weight, payment_term_id)
  values (d.id, d.sales_confirmation_id, d.buyer_id, d.supplier_id, d.company_id, d.count_id, d.quantity, d.uom, d.buyer_rate, d.supplier_rate,
    d.commission_type, d.commission_value, d.price_basis, d.freight, d.bag_weight, d.payment_term_id)
  returning id into o;
  return o;
end $$;


--
-- Name: crm_deals_approve_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_deals_approve_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if old.status = 'confirmed' then raise exception 'This deal is confirmed and read-only'; end if;
  if new.status = 'confirmed' then
    if old.status <> 'approved' or coalesce(current_setting('app.confirming', true),'') <> '1' then
      raise exception 'Use "Confirm deal" to confirm an approved deal';
    end if;
    return new;
  end if;
  new.confirmed_at := old.confirmed_at; new.confirmed_by := old.confirmed_by; new.sales_confirmation_id := old.sales_confirmation_id;
  new.approved_at := old.approved_at; new.approved_by := old.approved_by; new.approval_margin_pct := old.approval_margin_pct;
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if not public.has_permission('deal.approve') then raise exception 'You need the "Approve deals" permission to approve a deal'; end if;
    if old.status <> 'buyer_confirmed' then raise exception 'Only a Buyer Confirmed deal can be approved'; end if;
    if new.supplier_id is null or new.supplier_rate is null then raise exception 'The supplier and supplier rate are needed before approval'; end if;
    if new.company_id is null then raise exception 'Select the internal company before approving'; end if;
    if new.margin is null or new.buyer_rate is null or new.buyer_rate <= 0 then raise exception 'The margin cannot be worked out; check the rates and commission'; end if;
    if new.margin < 0 then raise exception 'Margin is negative; the deal cannot be approved'; end if;
    new.approval_margin_pct := round(new.margin / new.buyer_rate * 100, 2);
    new.approved_at := now();
    new.approved_by := auth.uid();
  elsif old.status = 'approved' then
    if new.status is distinct from 'approved' then
      if not public.is_admin() then raise exception 'Only an administrator can reopen an approved deal'; end if;
      if new.status <> 'buyer_confirmed' then raise exception 'An approved deal can only be reopened to Buyer Confirmed'; end if;
      new.approved_at := null; new.approved_by := null; new.approval_margin_pct := null;
    elsif new.company_id is distinct from old.company_id or new.supplier_id is distinct from old.supplier_id or new.buyer_id is distinct from old.buyer_id
       or new.supplier_rate is distinct from old.supplier_rate or new.buyer_rate is distinct from old.buyer_rate
       or new.freight is distinct from old.freight or new.price_basis is distinct from old.price_basis
       or new.commission_type is distinct from old.commission_type or new.count_id is distinct from old.count_id
       or new.quantity is distinct from old.quantity or new.uom is distinct from old.uom then
      raise exception 'This deal is approved and its terms are locked';
    end if;
  end if;
  return new;
end $$;


--
-- Name: crm_deals_derive(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_deals_derive() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare kgu numeric; pct numeric; b text; v numeric;
begin
  if tg_op='INSERT' then
    if new.deal_no is null then new.deal_no := 'DL-'||to_char(now(),'YYYY')||'-'||lpad(nextval('crm_deal_seq')::text,4,'0'); end if;
    if new.company_id is null then select id into new.company_id from companies where is_home and is_active limit 1; end if;
    if new.commission_type is null then
      select commission_basis, commission_value into b, v from supplier_master where id=new.supplier_id;
      if b is null then select commission_basis, commission_value into b, v from buyer_master where id=new.buyer_id; end if;
      new.commission_type := case when b='pct' and v=0.5 then 'pct_0_5' when b='pct' and v=1 then 'pct_1' when b='pct' and v=2 then 'pct_2'
        when b='per_kg' and v=1 then 'per_kg_1' when b='per_bag' and v=30 then 'per_bag_30' else null end;
    end if;
  end if;
  select gst into new.buyer_gst from buyer_master where id=new.buyer_id;
  new.supplier_gst := null;
  if new.supplier_id is not null then select gst into new.supplier_gst from supplier_master where id=new.supplier_id; end if;
  kgu := case new.uom when 'KG' then 1 when 'TONS' then 1000 when 'BAGS' then new.bag_weight else null end;
  new.commission_value := case new.commission_type
    when 'pct_0_5' then new.supplier_rate*0.5/100
    when 'pct_1' then new.supplier_rate*1/100
    when 'pct_2' then new.supplier_rate*2/100
    when 'per_kg_1' then kgu
    when 'per_bag_30' then case new.uom when 'BAGS' then 30 when 'KG' then 30/new.bag_weight when 'TONS' then 30*1000/new.bag_weight else null end
    else null end;
  new.commission_total := new.commission_value*new.quantity;
  if new.buyer_rate is not null and new.supplier_rate is not null and new.commission_value is not null then
    new.margin := new.buyer_rate-new.supplier_rate-new.commission_value;
    new.margin_total := new.margin*new.quantity;
  else new.margin := null; new.margin_total := null; end if;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: crm_deals_rate_track(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_deals_rate_track() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare changed boolean := false;
begin
  if new.buyer_rate is distinct from old.buyer_rate then
    insert into deal_changes(deal_id, field, old_value, new_value) values (new.id, 'buyer_rate', old.buyer_rate::text, new.buyer_rate::text); changed := true; end if;
  if new.supplier_rate is distinct from old.supplier_rate then
    insert into deal_changes(deal_id, field, old_value, new_value) values (new.id, 'supplier_rate', old.supplier_rate::text, new.supplier_rate::text); changed := true; end if;
  if new.commission_type is distinct from old.commission_type then
    insert into deal_changes(deal_id, field, old_value, new_value) values (new.id, 'commission_type', old.commission_type, new.commission_type); changed := true; end if;
  if new.freight is distinct from old.freight then
    insert into deal_changes(deal_id, field, old_value, new_value) values (new.id, 'freight', old.freight, new.freight); changed := true; end if;
  if new.price_basis is distinct from old.price_basis then
    insert into deal_changes(deal_id, field, old_value, new_value) values (new.id, 'price_basis', old.price_basis, new.price_basis); changed := true; end if;
  if changed and new.status = 'draft' and old.status = 'draft' then new.status := 'rate_discussion'; end if;
  if new.status is distinct from old.status then
    insert into deal_changes(deal_id, field, old_value, new_value) values (new.id, 'status', old.status, new.status);
  end if;
  return new;
end $$;


--
-- Name: crm_deals_supplier_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_deals_supplier_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  new.supplier_confirmed_at := old.supplier_confirmed_at; new.supplier_confirmed_by := old.supplier_confirmed_by;
  new.buyer_confirmed_at := old.buyer_confirmed_at; new.buyer_confirmed_by := old.buyer_confirmed_by;
  if new.status = 'supplier_confirmed' and old.status is distinct from 'supplier_confirmed' then
    if new.supplier_id is null then raise exception 'Choose a supplier before confirming the supplier'; end if;
    if new.supplier_rate is null or new.supplier_rate <= 0 then raise exception 'Enter the supplier rate before confirming the supplier'; end if;
    if old.status not in ('draft','rate_discussion') then raise exception 'Only a draft or rate-discussion deal can be supplier-confirmed'; end if;
    new.supplier_confirmed_at := now();
    new.supplier_confirmed_by := auth.uid();
  end if;
  if new.status = 'buyer_confirmed' and old.status not in ('buyer_confirmed','approved') then
    if new.buyer_rate is null or new.buyer_rate <= 0 then raise exception 'Enter the buyer rate before confirming the buyer'; end if;
    if old.status not in ('draft','rate_discussion','supplier_confirmed') then raise exception 'This deal cannot be buyer-confirmed from its current status'; end if;
    new.buyer_confirmed_at := now();
    new.buyer_confirmed_by := auth.uid();
  end if;
  if old.status in ('supplier_confirmed','buyer_confirmed') and new.status is distinct from old.status
     and not (old.status = 'supplier_confirmed' and new.status = 'buyer_confirmed')
     and not (old.status = 'buyer_confirmed' and new.status = 'approved') then
    if not public.is_admin() then raise exception 'Only an administrator can reopen a confirmed deal'; end if;
    new.supplier_confirmed_at := null; new.supplier_confirmed_by := null;
    new.buyer_confirmed_at := null; new.buyer_confirmed_by := null;
  end if;
  if old.supplier_confirmed_at is not null and new.supplier_confirmed_at is not null
     and (new.supplier_rate is distinct from old.supplier_rate or new.supplier_id is distinct from old.supplier_id) then
    raise exception 'The supplier and supplier rate are locked: the supplier has confirmed this deal';
  end if;
  if old.buyer_confirmed_at is not null and new.buyer_confirmed_at is not null
     and (new.buyer_rate is distinct from old.buyer_rate or new.freight is distinct from old.freight or new.price_basis is distinct from old.price_basis) then
    raise exception 'The buyer rate, freight and Ex-Mill/Net are locked: the buyer has confirmed this deal';
  end if;
  return new;
end $$;


--
-- Name: crm_deals_unconvert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_deals_unconvert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if old.lead_id is not null then
    perform set_config('crm.unconvert','on',true);
    update leads set converted_deal_id=null, converted_at=null where id=old.lead_id;
    perform set_config('crm.unconvert','off',true);
  end if;
  return old;
end $$;


--
-- Name: deal_confirm_problems(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deal_confirm_problems(p_deal uuid) RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare d crm_deals; s supplier_master; b buyer_master; p text[] := '{}'; gstre text := '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
begin
  select * into d from crm_deals where id = p_deal;
  if not found then return array['Deal not found']; end if;
  if d.status = 'confirmed' then return array['Deal is already confirmed']; end if;
  if d.supplier_confirmed_at is null then p := array_append(p, 'Supplier has not confirmed'); end if;
  if d.buyer_confirmed_at is null then p := array_append(p, 'Buyer has not confirmed'); end if;
  if d.status <> 'approved' or d.approved_at is null then p := array_append(p, 'Manager approval is not completed'); end if;
  if d.supplier_id is null then p := array_append(p, 'Supplier is missing'); end if;
  if d.company_id is null then p := array_append(p, 'Internal company is missing'); end if;
  if d.count_id is null then p := array_append(p, 'Count is missing'); end if;
  if d.quantity is null or d.quantity <= 0 then p := array_append(p, 'Quantity is missing'); end if;
  if d.supplier_rate is null or d.supplier_rate <= 0 then p := array_append(p, 'Supplier rate is missing'); end if;
  if d.buyer_rate is null or d.buyer_rate <= 0 then p := array_append(p, 'Buyer rate is missing'); end if;
  if d.commission_type is null then p := array_append(p, 'Commission type is missing'); end if;
  if d.payment_term_id is null then p := array_append(p, 'Payment term is missing'); end if;
  if d.uom = 'BAGS' and (d.bag_weight is null or d.bag_weight <= 0) then p := array_append(p, 'Bag weight is missing'); end if;
  select * into s from supplier_master where id = d.supplier_id;
  if found then
    if coalesce(s.gst,'') !~ gstre then p := array_append(p, 'Supplier GST is missing or not valid'); end if;
    if s.incomplete then p := array_append(p, 'Supplier master record is incomplete'); end if;
    if not s.is_active then p := array_append(p, 'Supplier is inactive'); end if;
    if s.company_id is null then p := array_append(p, 'Supplier is not linked to a company'); end if;
  end if;
  select * into b from buyer_master where id = d.buyer_id;
  if found then
    if coalesce(b.gst,'') !~ gstre then p := array_append(p, 'Buyer GST is missing or not valid'); end if;
    if b.incomplete then p := array_append(p, 'Buyer master record is incomplete'); end if;
    if not b.is_active then p := array_append(p, 'Buyer is inactive'); end if;
    if b.company_id is null then p := array_append(p, 'Buyer is not linked to a company'); end if;
  end if;
  if exists (select 1 from count_master c where c.id = d.count_id and not c.is_active) then p := array_append(p, 'Count is inactive'); end if;
  if exists (select 1 from companies c where c.id = d.company_id and not c.is_active) then p := array_append(p, 'Internal company is inactive'); end if;
  return p;
end $_$;


--
-- Name: deal_documents_after_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deal_documents_after_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
    perform public.record_audit('document', 'Removed document', old.deal_id::text, old.file_name);
    return old;
end;
$$;


--
-- Name: deal_documents_after_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deal_documents_after_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
    perform public.record_audit('document', 'Attached document', new.deal_id::text, new.file_name);
    return new;
end;
$$;


--
-- Name: deals_before_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deals_before_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
    if new.created_by is null then
        new.created_by := auth.uid();
    end if;
    if new.owner_id is null then
        new.owner_id := auth.uid();
    end if;
    if new.owner_id <> auth.uid() and not public.has_permission('deal.reassign') then
        raise exception 'Your account does not have permission to change who owns a deal';
    end if;
    if new.ref_no is null or new.ref_no = '' then
        new.ref_no := public.next_ref_no(extract(year from now())::integer);
    end if;
    new.stage := 'lead';
    new.status := 'open';

    perform public.record_audit('deal', 'Opened enquiry', new.id::text, new.ref_no);
    return new;
end;
$$;


--
-- Name: deals_before_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deals_before_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
    v_missing text;
begin
    -- stage move -------------------------------------------------------
    if new.stage is distinct from old.stage then
        if old.status = 'lost' then
            raise exception 'Reopen this deal before moving its stage';
        end if;
        if not exists (select 1 from public.pipeline_stages where id = new.stage and is_supported) then
            raise exception 'That stage is not available yet — only Lead and Enquiry are built so far';
        end if;

        if not public.has_permission('stage.move.' || new.stage) then
            raise exception 'Your account does not have permission to move a deal to that stage';
        end if;
        if public.stage_sort_order(new.stage) < public.stage_sort_order(old.stage)
           and not public.has_permission('stage.move_back') then
            raise exception 'Your account does not have permission to move a deal back to an earlier stage';
        end if;

        if public.stage_sort_order(new.stage) > public.stage_sort_order(old.stage) then
            -- the enquiry gate -- the only one built so far, mirroring
            -- GATES["enquiry"] in the old domain/stages.py
            if new.stage = 'enquiry' then
                v_missing := '';
                if new.buyer_id is null then v_missing := v_missing || 'Buyer; '; end if;
                if new.article is null or btrim(new.article) = '' then v_missing := v_missing || 'Article description; '; end if;
                if new.quantity is null then v_missing := v_missing || 'Quantity; '; end if;
                if new.target_price is null then v_missing := v_missing || 'Target price; '; end if;
                if v_missing <> '' then
                    raise exception 'Still needed before this deal can move: %', rtrim(v_missing, '; ');
                end if;
            end if;
        end if;

        perform public.record_audit('deal', 'Moved stage', new.id::text, old.stage || ' -> ' || new.stage);

    -- reassignment -------------------------------------------------------
    elsif new.owner_id is distinct from old.owner_id then
        if not public.has_permission('deal.reassign') then
            raise exception 'Your account does not have permission to change who owns a deal';
        end if;
        perform public.record_audit('deal', 'Reassigned deal', new.id::text, new.ref_no);

    -- lost / reopened ------------------------------------------------------
    elsif new.status is distinct from old.status then
        if not public.has_permission('deal.mark_lost') then
            raise exception 'Your account does not have permission to mark a deal lost or reopen it';
        end if;
        if new.status = 'lost' then
            perform public.record_audit('deal', 'Marked deal lost', new.id::text, new.ref_no);
        else
            new.lost_reason := null;
            perform public.record_audit('deal', 'Reopened deal', new.id::text, new.ref_no);
        end if;

    -- everything else: article, quantity, buyer, notes, sample fields, etc.
    else
        if not public.has_permission('deal.edit') then
            raise exception 'Your account does not have permission to edit deal details';
        end if;
        perform public.record_audit('deal', 'Updated deal', new.id::text, new.ref_no);
    end if;

    return new;
end;
$$;


--
-- Name: dispatch_entry_stamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dispatch_entry_stamp() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare had_m boolean; had_t boolean;
begin
  had_m := tg_op = 'UPDATE' and old.mill_invoice_entered_at is not null;
  had_t := tg_op = 'UPDATE' and old.transporter_invoice_entered_at is not null;
  if new.mill_invoice_no is null and new.mill_invoice_date is null then
    new.mill_invoice_entered_at := null; new.mill_invoice_entered_by := null;
  elsif had_m then
    new.mill_invoice_entered_at := old.mill_invoice_entered_at; new.mill_invoice_entered_by := old.mill_invoice_entered_by;
  else
    new.mill_invoice_entered_at := now(); new.mill_invoice_entered_by := auth.uid();
  end if;
  if new.transporter_invoice_no is null then
    new.transporter_invoice_entered_at := null; new.transporter_invoice_entered_by := null;
  elsif had_t then
    new.transporter_invoice_entered_at := old.transporter_invoice_entered_at; new.transporter_invoice_entered_by := old.transporter_invoice_entered_by;
  else
    new.transporter_invoice_entered_at := now(); new.transporter_invoice_entered_by := auth.uid();
  end if;
  return new;
end $$;


--
-- Name: find_or_create_company_for_lead(text, text, text, text, text, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_or_create_company_for_lead(p_name text, p_pan text, p_gst text, p_address text, p_mobile text, p_buyer boolean, p_supplier boolean) RETURNS TABLE(id uuid, created boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid; v_name text := btrim(coalesce(p_name,'')); v_pan text := nullif(upper(btrim(coalesce(p_pan,''))),'');
  v_short text; v_pref text;
begin
  if not (has_permission('lead.qualify') or has_permission('lead.manage') or has_permission('settings.manage')) then
    raise exception 'Your account does not have permission to create companies from a lead.';
  end if;
  if v_name = '' then raise exception 'Company name is required'; end if;
  if v_pan is not null and length(v_pan) <> 10 then v_pan := null; end if;
  select c.id into v_id from companies c
   where (v_pan is not null and c.pan_number = v_pan) or lower(btrim(c.name)) = lower(v_name)
   order by (c.pan_number = v_pan) desc nulls last, c.created_at limit 1;
  if v_id is not null then
    update companies c set is_buyer = c.is_buyer or coalesce(p_buyer,false), is_supplier = c.is_supplier or coalesce(p_supplier,false)
     where c.id = v_id and ((coalesce(p_buyer,false) and not c.is_buyer) or (coalesce(p_supplier,false) and not c.is_supplier));
    return query select v_id, false;
    return;
  end if;
  v_pref := upper(left(regexp_replace(v_name,'[^A-Za-z0-9]','','g'),4));
  if v_pref = '' then v_pref := 'CO'; end if;
  v_short := left(v_name, 30);
  insert into companies(name, short_name, ref_prefix, address, mobile, tax_id, pan_number, is_buyer, is_supplier, created_by)
  values (v_name, v_short, v_pref, nullif(btrim(coalesce(p_address,'')),''), nullif(btrim(coalesce(p_mobile,'')),''),
          nullif(upper(btrim(coalesce(p_gst,''))),''), v_pan, coalesce(p_buyer,false), coalesce(p_supplier,false), auth.uid())
  returning companies.id into v_id;
  return query select v_id, true;
end $$;


--
-- Name: generate_commission_invoice(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_commission_invoice(p_order uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o orders; amt numeric; inv uuid;
begin
  if not public.has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select * into o from orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'open_for_execution' then raise exception 'The commission invoice can only be generated while the order is Open for Execution'; end if;
  if exists (select 1 from commission_invoices where order_id = p_order) then raise exception 'A commission invoice already exists for this order'; end if;
  select commission_total into amt from crm_deals where id = o.deal_id;
  if amt is null then raise exception 'The commission amount cannot be worked out for this order (no commission type on the deal)'; end if;
  insert into commission_invoices(order_id, buyer_id, supplier_id, company_id, amount) values (o.id, o.buyer_id, o.supplier_id, o.company_id, amt) returning id into inv;
  return inv;
end $$;


--
-- Name: handle_new_auth_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    is_first_user boolean;
begin
    select not exists (select 1 from public.profiles) into is_first_user;

    insert into public.profiles (id, email, name, is_admin)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
        is_first_user
    )
    on conflict (id) do nothing;

    return new;
end;
$$;


--
-- Name: has_any_permission(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_any_permission(perms text[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select
        public.is_admin()
        or exists (
            select 1
            from public.user_permissions up
            join public.profiles p on p.id = up.user_id
            where up.user_id = auth.uid()
              and up.permission = any(perms)
              and p.is_active
        );
$$;


--
-- Name: has_permission(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_permission(perm text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select
        public.is_admin()
        or exists (
            select 1
            from public.user_permissions up
            join public.profiles p on p.id = up.user_id
            where up.user_id = auth.uid()
              and up.permission = perm
              and p.is_active
        );
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select coalesce(
        (select is_admin from public.profiles where id = auth.uid() and is_active),
        false
    );
$$;


--
-- Name: leads_enforce_qualification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leads_enforce_qualification() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ declare problems text[] := '{}'; entering boolean := (new.status = 'qualified') and (tg_op = 'INSERT' or old.status is distinct from 'qualified'); begin if new.status <> 'qualified' then new.qualified_at := null; new.qualified_by := null; return new; end if; if entering and not public.has_permission('lead.qualify') then raise exception 'You need the "Qualify a lead" permission to qualify a lead.' using errcode = '42501'; end if; if new.count_id is null then problems := array_append(problems, 'select a count'); end if; if new.quantity is null or new.quantity <= 0 then problems := array_append(problems, 'enter a quantity'); end if; if new.party_role in ('buyer','both') then if new.buyer_id is null then problems := array_append(problems, 'link the buyer to the Buyer Master'); elsif not exists (select 1 from public.buyer_master b where b.id = new.buyer_id and b.is_active) then problems := array_append(problems, 'link an active Buyer Master record'); end if; end if; if new.party_role in ('supplier','both') then if new.supplier_id is null then problems := array_append(problems, 'link the supplier to the Supplier Master'); elsif not exists (select 1 from public.supplier_master s where s.id = new.supplier_id and s.is_active) then problems := array_append(problems, 'link an active Supplier Master record'); end if; end if; if array_length(problems, 1) is not null then raise exception 'This lead cannot be qualified yet: %.', array_to_string(problems, '; ') using errcode = 'check_violation'; end if; if entering then new.qualified_at := now(); new.qualified_by := auth.uid(); end if; return new; end; $$;


--
-- Name: leads_readonly_when_converted(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leads_readonly_when_converted() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ begin
 if old.converted_deal_id is not null and coalesce(current_setting('crm.unconvert',true),'')<>'on' then
  raise exception 'This lead has been converted to a deal and is read-only' using errcode='P0001';
 end if;
 if tg_op='DELETE' then return old; end if; return new; end $$;


--
-- Name: log_commission_invoice_print(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_commission_invoice_print(p_invoice uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not (public.has_permission('order.read') or public.has_permission('order.manage')) then raise exception 'You need permission to view orders'; end if;
  if not exists (select 1 from commission_invoices where id = p_invoice) then raise exception 'Commission invoice not found'; end if;
  insert into commission_invoice_prints(invoice_id, printed_by) values (p_invoice, auth.uid());
end $$;


--
-- Name: log_lead_discussion(uuid, text, numeric, numeric, text, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_lead_discussion(p_lead uuid, p_note text, p_quantity numeric DEFAULT NULL::numeric, p_rate numeric DEFAULT NULL::numeric, p_timeline text DEFAULT NULL::text, p_task_note text DEFAULT NULL::text, p_task_due date DEFAULT NULL::date) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare l leads%rowtype; ch text[] := '{}'; s text;
begin
  if p_note is null or length(btrim(p_note))=0 then raise exception 'Please write what was discussed'; end if;
  select * into l from leads where id=p_lead;
  if not found then raise exception 'Lead not found or not accessible'; end if;
  if p_quantity is not null and p_quantity>0 and p_quantity is distinct from l.quantity then ch := array_append(ch,'quantity '||coalesce(l.quantity::text,'-')||' → '||p_quantity::text); end if;
  if p_rate is not null and p_rate>=0 and p_rate is distinct from l.expected_rate then ch := array_append(ch,'rate '||coalesce(l.expected_rate::text,'-')||' → '||p_rate::text); end if;
  if p_timeline is not null and btrim(p_timeline)<>'' and p_timeline is distinct from l.timeline then ch := array_append(ch,'timeline "'||coalesce(l.timeline,'-')||'" → "'||p_timeline||'"'); end if;
  update leads set
    quantity = case when p_quantity is not null and p_quantity>0 then p_quantity else quantity end,
    expected_rate = case when p_rate is not null and p_rate>=0 then p_rate else expected_rate end,
    timeline = case when p_timeline is not null and btrim(p_timeline)<>'' then p_timeline else timeline end,
    follow_up_date = coalesce(p_task_due, follow_up_date),
    status = case when status='new' then 'contacted' else status end
  where id=p_lead;
  s := btrim(p_note);
  if array_length(ch,1) is not null then s := s||E'\nUpdated: '||array_to_string(ch,'; '); end if;
  insert into activity_log(entity_type,entity_id,kind,note) values ('lead',p_lead,'discussion',s);
  if p_task_note is not null and btrim(p_task_note)<>'' then
    insert into activity_log(entity_type,entity_id,kind,note,due_date) values ('lead',p_lead,'task',btrim(p_task_note),p_task_due);
  end if;
end $$;


--
-- Name: next_ref_no(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_ref_no(p_year integer) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_value integer;
    v_prefix text;
begin
    insert into public.deal_ref_sequences (year, last_value)
    values (p_year, 0)
    on conflict (year) do nothing;

    update public.deal_ref_sequences
    set last_value = last_value + 1
    where year = p_year
    returning last_value into v_value;

    select coalesce(ref_prefix, 'MRG') into v_prefix from public.companies where is_home = true;
    v_prefix := coalesce(v_prefix, 'MRG');

    return v_prefix || '-' || p_year::text || '-' || lpad(v_value::text, 4, '0');
end;
$$;


--
-- Name: office_activity(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.office_activity(p_from date, p_to date) RETURNS TABLE(activity_date date, user_id uuid, name text, receipt_entries bigint, receipt_amount numeric, confirmations_sent bigint, dispatch_entries bigint, billing_entries bigint, bills_printed bigint, transport_invoices bigint, payment_entries bigint, payment_amount numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not (public.has_permission('order.read') or public.has_permission('order.manage')) then raise exception 'You need permission to view orders'; end if;
  return query
  with a as (
    select (created_at at time zone 'Asia/Kolkata')::date d, created_by u, case kind when 'buyer_receipt' then 'rcpt' else 'pay' end k, amount amt from order_payments
    union all select (sent_at at time zone 'Asia/Kolkata')::date, sent_by, 'conf', 0 from sales_confirmation_notifications
    union all select (created_at at time zone 'Asia/Kolkata')::date, created_by, 'disp', 0 from order_dispatches
    union all select (mill_invoice_entered_at at time zone 'Asia/Kolkata')::date, mill_invoice_entered_by, 'bill', 0 from order_dispatches where mill_invoice_entered_at is not null
    union all select (printed_at at time zone 'Asia/Kolkata')::date, printed_by, 'print', 0 from commission_invoice_prints
    union all select (transporter_invoice_entered_at at time zone 'Asia/Kolkata')::date, transporter_invoice_entered_by, 'trinv', 0 from order_dispatches where transporter_invoice_entered_at is not null
  )
  select a.d, a.u, p.name,
    count(*) filter (where k='rcpt'), coalesce(sum(amt) filter (where k='rcpt'),0),
    count(*) filter (where k='conf'), count(*) filter (where k='disp'), count(*) filter (where k='bill'),
    count(*) filter (where k='print'), count(*) filter (where k='trinv'),
    count(*) filter (where k='pay'), coalesce(sum(amt) filter (where k='pay'),0)
  from a join profiles p on p.id = a.u
  where a.d between p_from and p_to
  group by a.d, a.u, p.name order by a.d desc, p.name;
end $$;


--
-- Name: order_close_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_close_check() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.order_try_close(case when tg_op = 'DELETE' then old.order_id else new.order_id end);
  return null;
end $$;


--
-- Name: order_close_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_close_status(p_order uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare o orders; disp numeric; rec numeric; paid numeric; inv boolean;
begin
  select * into o from orders where id = p_order;
  if not found then return null; end if;
  select coalesce(sum(quantity),0) into disp from order_dispatches where order_id = p_order;
  select coalesce(sum(amount) filter (where kind='buyer_receipt'),0), coalesce(sum(amount) filter (where kind='supplier_payment'),0) into rec, paid from order_payments where order_id = p_order;
  select exists (select 1 from commission_invoices where order_id = p_order) into inv;
  return jsonb_build_object(
    'dispatched', disp, 'quantity', o.quantity,
    'quantity_done', disp >= o.quantity,
    'buyer_received', rec, 'buyer_value', o.buyer_rate * o.quantity, 'buyer_done', rec >= o.buyer_rate * o.quantity,
    'supplier_paid', paid, 'supplier_value', o.supplier_rate * o.quantity, 'supplier_done', paid >= o.supplier_rate * o.quantity,
    'invoice_done', inv);
end $$;


--
-- Name: order_exec_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_exec_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
    select coalesce(sum(quantity),0) into used from order_dispatches where order_id = new.order_id and id is distinct from new.id;
    if used + new.quantity > o.quantity then
      raise exception 'Dispatch quantity exceeds the order: % already dispatched of % %', used, o.quantity, o.uom;
    end if;
    if new.transport_id is not null and not exists (select 1 from order_transports t where t.id = new.transport_id and t.order_id = new.order_id) then
      raise exception 'The transportation record belongs to another order';
    end if;
  end if;
  return new;
end $$;


--
-- Name: order_trip_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_trip_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare ok boolean;
begin
  if tg_op = 'INSERT' then
    new.trip_no := 'TRIP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('trip_seq')::text, 4, '0');
    new.created_by := auth.uid(); new.created_at := now();
  else
    if new.dispatch_id is distinct from old.dispatch_id then raise exception 'A trip cannot be moved to another dispatch'; end if;
    new.trip_no := old.trip_no; new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  select (t.kind = 'our') or (d.transport_id is null and exists (select 1 from order_transports x where x.order_id = d.order_id and x.kind = 'our'))
    into ok
  from order_dispatches d left join order_transports t on t.id = d.transport_id where d.id = new.dispatch_id;
  if not coalesce(ok, false) then raise exception 'A trip sheet can only be linked to a dispatch on our own transport (the dispatch is on another transport, or the order has no own-transport record)'; end if;
  if new.trip_date > current_date then raise exception 'The trip date cannot be in the future'; end if;
  new.vehicle_no := nullif(btrim(new.vehicle_no), ''); new.driver_name := nullif(btrim(new.driver_name), '');
  new.updated_at := now();
  return new;
end $$;


--
-- Name: order_try_close(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_try_close(p_order uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare s jsonb;
begin
  if not exists (select 1 from orders where id = p_order and status = 'open_for_execution') then return; end if;
  s := public.order_close_status(p_order);
  if (s->>'quantity_done')::boolean and (s->>'buyer_done')::boolean and (s->>'supplier_done')::boolean and (s->>'invoice_done')::boolean then
    perform set_config('app.closing', '1', true);
    update orders set status = 'closed' where id = p_order;
    perform set_config('app.closing', '', true);
  end if;
end $$;


--
-- Name: orders_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orders_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.order_no := 'ORD-' || to_char(now(),'YYYY') || '-' || lpad(nextval('order_seq')::text,4,'0');
    new.order_date := (now() at time zone 'Asia/Kolkata')::date;
    new.status := 'draft';
    new.payment_tracking_enabled := false;
    new.closed_at := null;
    new.confirmed_at := null; new.confirmed_by := null; new.execution_opened_at := null; new.execution_opened_by := null;
    return new;
  end if;
  if old.status = 'closed' then raise exception 'This order is closed and read-only'; end if;
  new.order_no := old.order_no; new.order_date := old.order_date; new.deal_id := old.deal_id; new.sales_confirmation_id := old.sales_confirmation_id;
  new.buyer_id := old.buyer_id; new.supplier_id := old.supplier_id; new.company_id := old.company_id; new.count_id := old.count_id;
  new.quantity := old.quantity; new.uom := old.uom; new.buyer_rate := old.buyer_rate; new.supplier_rate := old.supplier_rate;
  new.commission_type := old.commission_type; new.commission_value := old.commission_value; new.price_basis := old.price_basis;
  new.freight := old.freight; new.bag_weight := old.bag_weight; new.payment_term_id := old.payment_term_id;
  new.confirmed_at := old.confirmed_at; new.confirmed_by := old.confirmed_by;
  new.execution_opened_at := old.execution_opened_at; new.execution_opened_by := old.execution_opened_by;
  new.payment_tracking_enabled := old.payment_tracking_enabled;
  new.closed_at := old.closed_at;
  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'confirmed' then
      if old.sales_confirmation_id is null or not exists (select 1 from sales_confirmations s where s.id = old.sales_confirmation_id and s.status <> 'cancelled') then
        raise exception 'A valid (not cancelled) Sales Confirmation is needed before the order can be confirmed';
      end if;
      if new.tentative_dispatch_date is null then raise exception 'Enter the tentative dispatch date before confirming'; end if;
      if new.tentative_dispatch_date < old.order_date then raise exception 'The tentative dispatch date cannot be before the order date'; end if;
      if coalesce(btrim(new.delivery_schedule),'') = '' then raise exception 'Enter the delivery schedule before confirming'; end if;
      if new.job_process_id is not null and coalesce(btrim(new.alt_delivery_address),'') = '' then raise exception 'The alternate delivery address is empty'; end if;
      new.confirmed_at := now(); new.confirmed_by := auth.uid();
    elsif old.status = 'confirmed' and new.status = 'open_for_execution' then
      new.execution_opened_at := now(); new.execution_opened_by := auth.uid();
      new.payment_tracking_enabled := true;
    elsif old.status = 'open_for_execution' and new.status = 'closed' then
      if coalesce(current_setting('app.closing', true),'') <> '1' then raise exception 'An order closes automatically once all four conditions are met'; end if;
      new.closed_at := now();
    else
      raise exception 'An order cannot move from % to %', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;


--
-- Name: party_doc_can(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.party_doc_can(p_type text, p_write boolean) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ select case when p_type='supplier' then has_permission('mill.manage') or (not p_write and has_permission('document.read')) else has_permission('buyer.manage') or (not p_write and has_permission('document.read')) end $$;


--
-- Name: party_gst_verify(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.party_gst_verify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ begin
 if tg_op='UPDATE' then
  if new.gst is distinct from old.gst then
   new.gst_status:='unverified'; new.gst_verified_at:=null; new.gst_verified_by:=null; new.gst_verify_note:=null;
  elsif new.gst_status is distinct from old.gst_status then
   if new.gst_status='unverified' then new.gst_verified_at:=null; new.gst_verified_by:=null;
   else new.gst_verified_at:=now(); new.gst_verified_by:=auth.uid(); end if;
  end if;
 else
  new.gst_status:='unverified'; new.gst_verified_at:=null; new.gst_verified_by:=null; new.gst_verify_note:=null;
 end if;
 return new; end $$;


--
-- Name: pending_commission_bills(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pending_commission_bills() RETURNS TABLE(order_id uuid, order_no text, order_date date, status text, buyer_id uuid, supplier_id uuid, company_id uuid, quantity numeric, uom text, commission_type text, commission_value numeric, commission_amount numeric, days_pending integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not (public.has_permission('order.read') or public.has_permission('order.manage')) then
    raise exception 'You need permission to view orders';
  end if;
  return query
  select o.id, o.order_no, o.order_date, o.status, o.buyer_id, o.supplier_id, o.company_id, o.quantity, o.uom,
         o.commission_type, o.commission_value, d.commission_total,
         greatest(0, (current_date - o.order_date))::int
  from orders o
  left join crm_deals d on d.id = o.deal_id
  where o.status in ('confirmed','open_for_execution')
    and not exists (select 1 from commission_invoices c where c.order_id = o.id)
  order by o.order_date, o.order_no;
end $$;


--
-- Name: qualify_lead_auto(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.qualify_lead_auto(p_lead uuid, p_role text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  l leads%rowtype; v_role text := lower(btrim(coalesce(p_role,'')));
  v_gst text; v_pan text; v_mobile text; v_sc text; v_state text;
  v_company uuid; v_co_new boolean := false;
  v_buyer uuid; v_supplier uuid; v_code text; v_created text[] := '{}';
  v_need_b boolean; v_need_s boolean; r record;
begin
  if not has_permission('lead.qualify') then
    raise exception 'You need the "Qualify a lead" permission to qualify a lead.' using errcode = '42501';
  end if;
  if v_role not in ('buyer','supplier','both') then raise exception 'Select a Role: Buyer or Supplier.'; end if;
  select * into l from leads where id = p_lead for update;
  if not found then raise exception 'Lead not found'; end if;
  if l.converted_deal_id is not null then raise exception 'This lead has already been converted to a deal.'; end if;
  if v_role = 'both' and l.party_role <> 'both' then raise exception 'Select a Role: Buyer or Supplier.'; end if;
  v_need_b := v_role in ('buyer','both'); v_need_s := v_role in ('supplier','both');

  v_gst := upper(regexp_replace(coalesce(l.gst,''),'\s','','g'));
  if v_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then v_gst := null; end if;
  v_pan := case when v_gst is not null then substr(v_gst,3,10) end;
  v_sc := case when v_gst is not null then left(v_gst,2) end;
  v_mobile := regexp_replace(coalesce(l.mobile,''),'[^0-9]','','g');
  if length(v_mobile) > 10 then v_mobile := right(v_mobile,10); end if;
  if length(v_mobile) <> 10 then v_mobile := null; end if;
  v_state := case v_sc when '01' then 'Jammu and Kashmir' when '02' then 'Himachal Pradesh' when '03' then 'Punjab' when '04' then 'Chandigarh' when '05' then 'Uttarakhand' when '06' then 'Haryana' when '07' then 'Delhi' when '08' then 'Rajasthan' when '09' then 'Uttar Pradesh' when '10' then 'Bihar' when '11' then 'Sikkim' when '12' then 'Arunachal Pradesh' when '13' then 'Nagaland' when '14' then 'Manipur' when '15' then 'Mizoram' when '16' then 'Tripura' when '17' then 'Meghalaya' when '18' then 'Assam' when '19' then 'West Bengal' when '20' then 'Jharkhand' when '21' then 'Odisha' when '22' then 'Chhattisgarh' when '23' then 'Madhya Pradesh' when '24' then 'Gujarat' when '27' then 'Maharashtra' when '29' then 'Karnataka' when '30' then 'Goa' when '32' then 'Kerala' when '33' then 'Tamil Nadu' when '34' then 'Puducherry' when '36' then 'Telangana' when '37' then 'Andhra Pradesh' else null end;

  select c.id, c.created into v_company, v_co_new from find_or_create_company_for_lead(l.party_name, v_pan, coalesce(v_gst, l.gst), l.office_address, l.mobile, v_need_b, v_need_s) c;
  if v_co_new then v_created := array_append(v_created, 'Company'); end if;

  if v_need_b then
    select id into v_buyer from buyer_master where (v_gst is not null and gst = v_gst) or lower(btrim(name)) = lower(btrim(l.party_name)) order by (gst = v_gst) desc nulls last limit 1;
    if v_buyer is null then
      insert into buyer_master(name, contact_person, mobile, address, gst, pan, state_code, state, company_id, created_by)
      values (btrim(l.party_name), nullif(btrim(coalesce(l.contact_person,'')),''), v_mobile, nullif(btrim(coalesce(l.office_address,'')),''), v_gst, v_pan, v_sc, v_state, v_company, auth.uid())
      returning buyer_master.id, buyer_code into v_buyer, v_code;
      v_created := array_append(v_created, 'Buyer ' || v_code);
    else
      update buyer_master set company_id = v_company where id = v_buyer and company_id is null;
    end if;
  end if;
  if v_need_s then
    select id into v_supplier from supplier_master where (v_gst is not null and gst = v_gst) or lower(btrim(name)) = lower(btrim(l.party_name)) order by (gst = v_gst) desc nulls last limit 1;
    if v_supplier is null then
      insert into supplier_master(name, contact_person, mobile, address, gst, pan, state_code, state, company_id, created_by)
      values (btrim(l.party_name), nullif(btrim(coalesce(l.contact_person,'')),''), v_mobile, nullif(btrim(coalesce(l.office_address,'')),''), v_gst, v_pan, v_sc, v_state, v_company, auth.uid())
      returning supplier_master.id, supplier_code into v_supplier, v_code;
      v_created := array_append(v_created, 'Supplier ' || v_code);
    else
      update supplier_master set company_id = v_company where id = v_supplier and company_id is null;
    end if;
  end if;

  update leads set party_role = v_role, buyer_id = v_buyer, supplier_id = v_supplier, status = 'qualified' where id = p_lead;

  return jsonb_build_object('company_id', v_company, 'buyer_id', v_buyer, 'supplier_id', v_supplier, 'created', to_jsonb(v_created),
    'incomplete', coalesce((select incomplete from buyer_master where id = v_buyer), false) or coalesce((select incomplete from supplier_master where id = v_supplier), false));
end $_$;


--
-- Name: record_audit(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_audit(p_entity text, p_action text, p_entity_id text DEFAULT NULL::text, p_detail text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
    v_name text;
begin
    select name into v_name from public.profiles where id = auth.uid();
    insert into public.audit_log (actor_id, actor_name, entity, entity_id, action, detail)
    values (auth.uid(), v_name, p_entity, p_entity_id, p_action, p_detail);
end;
$$;


--
-- Name: record_sc_return(uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_sc_return(p_sc uuid, p_quantity numeric, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare id uuid; disp numeric;
begin
  if not public.has_permission('sc.manage') then raise exception 'You need permission to manage sales confirmations'; end if;
  select coalesce(sum(x.quantity),0) into disp from order_dispatches x join orders o on o.id = x.order_id where o.sales_confirmation_id = p_sc;
  if disp <= 0 then raise exception 'Nothing has been dispatched on this confirmation, so there is nothing to return'; end if;
  insert into sc_returns(sc_id, quantity, notes) values (p_sc, p_quantity, p_notes) returning sc_returns.id into id;
  return id;
end $$;


--
-- Name: sales_followup_dashboard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sales_followup_dashboard() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  t date := (now() at time zone 'Asia/Kolkata')::date;
  ms date := date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date;
  pms date := (date_trunc('month', (now() at time zone 'Asia/Kolkata')) - interval '1 month')::date;
  nms date := (date_trunc('month', (now() at time zone 'Asia/Kolkata')) + interval '1 month')::date;
  res jsonb := jsonb_build_object('as_of', t, 'month_start', ms);
  a int; b int; c numeric; d numeric; e int; f numeric;
begin
  if public.has_permission('lead.manage') or public.has_permission('lead.qualify') then
    select count(*), count(*) filter (where follow_up_date < t), count(*) filter (where status='new'), count(*) filter (where follow_up_date is null)
      into a, b, e, f from leads where status in ('new','contacted') and converted_deal_id is null;
    res := res || jsonb_build_object('leads', jsonb_build_object('pending', a, 'overdue_follow_up', b, 'new', e, 'no_follow_up_date', f));
  end if;
  if public.has_permission('deal.read') then
    select count(*), count(*) filter (where created_at::date < t - 7) into a, b from crm_deals where status <> 'confirmed';
    res := res || jsonb_build_object('confirmations', jsonb_build_object('pending', a, 'older_than_7_days', b,
      'by_stage', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from crm_deals where status <> 'confirmed' group by 1) s), '{}'::jsonb)));
  end if;
  if public.has_permission('order.read') or public.has_permission('order.manage') then
    select count(*), count(*) filter (where tentative_dispatch_date < t), coalesce(sum(bal),0) into a, b, c
    from (select o.tentative_dispatch_date, o.quantity - coalesce((select sum(x.quantity) from order_dispatches x where x.order_id=o.id),0) bal
          from orders o where o.status in ('confirmed','open_for_execution')) q where bal > 0;
    res := res || jsonb_build_object('dispatch', jsonb_build_object('pending', a, 'overdue', b, 'balance_qty', c));
  end if;
  if public.has_permission('order.manage') or public.has_permission('report.view') then
    select coalesce(sum(amount) filter (where invoice_date >= ms and invoice_date < nms),0), count(*) filter (where invoice_date >= ms and invoice_date < nms),
           coalesce(sum(amount) filter (where invoice_date >= pms and invoice_date < ms),0)
      into c, a, d from commission_invoices;
    res := res || jsonb_build_object('revenue', jsonb_build_object('this_month', c, 'invoices', a, 'last_month', d));
  end if;
  return res;
end $$;


--
-- Name: sc_derive(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sc_derive() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare pre text; n int;
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
         or new.payment_term_id is distinct from old.payment_term_id then
        raise exception 'The commercial terms of a sales confirmation created from a deal are locked. Only freight, ex-mill/net, bag weight, delivery schedule and special instructions can be changed.';
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
  new.updated_at := now();
  return new;
end $$;


--
-- Name: sc_execution_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sc_execution_status(p_sc uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare s sales_confirmations; disp numeric; ret numeric;
begin
  select * into s from sales_confirmations where id = p_sc;
  if not found then return null; end if;
  if s.status = 'cancelled' then return 'Cancelled'; end if;
  select coalesce(sum(x.quantity),0) into disp from order_dispatches x join orders o on o.id = x.order_id where o.sales_confirmation_id = p_sc;
  select coalesce(sum(quantity),0) into ret from sc_returns where sc_id = p_sc;
  if ret > 0 then return 'Return Adjusted'; end if;
  if disp <= 0 then return 'Open'; end if;
  if disp >= coalesce(s.quantity, 0) then return 'Executed'; end if;
  return 'Partially Executed';
end $$;


--
-- Name: sc_execution_statuses(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sc_execution_statuses() RETURNS TABLE(sc_id uuid, exec_status text, dispatched_qty numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not (public.has_permission('sc.read') or public.has_permission('sc.manage')) then raise exception 'You need permission to view sales confirmations'; end if;
  return query select s.id, public.sc_execution_status(s.id),
    coalesce((select sum(x.quantity) from order_dispatches x join orders o on o.id = x.order_id where o.sales_confirmation_id = s.id),0)
  from sales_confirmations s;
end $$;


--
-- Name: scn_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scn_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.sent_by := coalesce(auth.uid(), new.sent_by);
    new.sent_at := now();
    if new.delivery_status not in ('opened','sent','failed') then new.delivery_status := 'opened'; end if;
  else
    new.sc_id := old.sc_id; new.party := old.party; new.channel := old.channel; new.recipient := old.recipient;
    new.message := old.message; new.sent_by := old.sent_by; new.sent_at := old.sent_at; new.batch_id := old.batch_id;
  end if;
  return new;
end $$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
    new.updated_at := now();
    return new;
end;
$$;


--
-- Name: staff_efficiency(date, date, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_efficiency(p_from date, p_to date, p_idle_hours numeric DEFAULT 4) RETURNS TABLE(user_id uuid, name text, email text, job_title text, role text, department text, entries bigint, tasks_completed bigint, tasks_pending bigint, tasks_overdue bigint, last_activity timestamp with time zone, idle_hours numeric, is_idle boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare t0 timestamptz := p_from::timestamptz; t1 timestamptz := (p_to + 1)::timestamptz;
begin
  if not public.is_admin() then raise exception 'Only an administrator can view staff efficiency'; end if;
  return query
  with ev as (
    select created_by u, created_at at from leads union all
    select created_by, created_at from crm_deals union all
    select created_by, created_at from buyer_master union all
    select created_by, created_at from supplier_master union all
    select created_by, created_at from sales_confirmations union all
    select created_by, created_at from orders union all
    select created_by, created_at from order_transports union all
    select created_by, created_at from order_job_processes union all
    select created_by, created_at from order_dispatches union all
    select created_by, created_at from order_payments union all
    select created_by, created_at from commission_invoices union all
    select created_by, created_at from activity_log union all
    select created_by, created_at from transporters union all
    select created_by, created_at from job_processes union all
    select created_by, created_at from party_md_contacts
  ), act as (
    select u, at from ev where u is not null
    union all select done_by, done_at from activity_log where done_by is not null and done_at is not null
    union all select actor_id, at from audit_log where actor_id is not null
    union all select id, last_login_at from profiles where last_login_at is not null
  ), last_act as (select u, max(at) la from act group by u),
  ent as (select u, count(*) c from ev where u is not null and at >= t0 and at < t1 group by u),
  tdone as (select done_by u, count(*) c from activity_log where is_done and done_by is not null and done_at >= t0 and done_at < t1 group by 1),
  tpend as (select created_by u, count(*) c, count(*) filter (where due_date < current_date) od from activity_log where due_date is not null and not coalesce(is_done,false) and created_at < t1 group by 1)
  select p.id, p.name, p.email, p.job_title,
         case when p.is_admin then 'admin' else coalesce(p.profile_template,'unassigned') end,
         p.department,
         coalesce(e.c,0), coalesce(d.c,0), coalesce(tp.c,0), coalesce(tp.od,0),
         l.la,
         case when l.la is null then null else round((extract(epoch from (now()-l.la))/3600)::numeric,1) end,
         (l.la is null or now()-l.la > make_interval(secs => p_idle_hours*3600))
  from profiles p
  left join last_act l on l.u=p.id left join ent e on e.u=p.id left join tdone d on d.u=p.id left join tpend tp on tp.u=p.id
  where p.is_active
  order by p.name;
end $$;


--
-- Name: staff_monthly_summary(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_monthly_summary(p_month date) RETURNS TABLE(person_id uuid, person_name text, person_type text, petrol numeric, service numeric, food numeric, advance numeric, diwali_bonus numeric, total_expense numeric, days_present integer, half_days integer, days_absent integer, days_leave integer, leave_casual integer, leave_sick integer, leave_paid integer, leave_unpaid integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare s date := date_trunc('month', coalesce(p_month, current_date))::date; e date;
begin
  if not (public.is_admin() or public.has_permission('order.manage') or public.has_permission('report.view')) then
    raise exception 'Not allowed';
  end if;
  e := (s + interval '1 month')::date;
  return query
  select p.id, p.name, p.person_type,
    coalesce((select sum(x.amount) from staff_expenses x where x.person_id=p.id and x.category='petrol' and x.entry_date>=s and x.entry_date<e),0),
    coalesce((select sum(x.amount) from staff_expenses x where x.person_id=p.id and x.category='service' and x.entry_date>=s and x.entry_date<e),0),
    coalesce((select sum(x.amount) from staff_expenses x where x.person_id=p.id and x.category='food' and x.entry_date>=s and x.entry_date<e),0),
    coalesce((select sum(x.amount) from staff_expenses x where x.person_id=p.id and x.category='advance' and x.entry_date>=s and x.entry_date<e),0),
    coalesce((select sum(x.amount) from staff_expenses x where x.person_id=p.id and x.category='diwali_bonus' and x.entry_date>=s and x.entry_date<e),0),
    coalesce((select sum(x.amount) from staff_expenses x where x.person_id=p.id and x.entry_date>=s and x.entry_date<e),0),
    (select count(*) from staff_attendance a where a.person_id=p.id and a.att_date>=s and a.att_date<e and a.status='present')::int,
    (select count(*) from staff_attendance a where a.person_id=p.id and a.att_date>=s and a.att_date<e and a.status='half_day')::int,
    (select count(*) from staff_attendance a where a.person_id=p.id and a.att_date>=s and a.att_date<e and a.status='absent')::int,
    (select count(*) from staff_attendance a where a.person_id=p.id and a.att_date>=s and a.att_date<e and a.status='leave')::int,
    (select count(*) from staff_attendance a where a.person_id=p.id and a.att_date>=s and a.att_date<e and a.leave_type='casual')::int,
    (select count(*) from staff_attendance a where a.person_id=p.id and a.att_date>=s and a.att_date<e and a.leave_type='sick')::int,
    (select count(*) from staff_attendance a where a.person_id=p.id and a.att_date>=s and a.att_date<e and a.leave_type='paid')::int,
    (select count(*) from staff_attendance a where a.person_id=p.id and a.att_date>=s and a.att_date<e and a.leave_type='unpaid')::int
  from staff_people p where p.is_active order by p.name;
end $$;


--
-- Name: staff_performance(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.staff_performance(p_from date, p_to date) RETURNS TABLE(user_id uuid, name text, email text, role text, department text, staff_type text, entries bigint, tasks_total bigint, tasks_done bigint, completed_pct numeric, cheques_collected bigint, cheque_amount numeric, invoices_delivered bigint, payments_deposited bigint, deposit_amount numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare t0 timestamptz := p_from::timestamptz; t1 timestamptz := (p_to + 1)::timestamptz;
begin
  if not (public.is_admin() or public.has_permission('report.view')) then raise exception 'You need the report permission to view staff performance'; end if;
  return query
  with ev as (
    select created_by u, created_at at from leads union all
    select created_by, created_at from crm_deals union all
    select created_by, created_at from buyer_master union all
    select created_by, created_at from supplier_master union all
    select created_by, created_at from sales_confirmations union all
    select created_by, created_at from orders union all
    select created_by, created_at from order_transports union all
    select created_by, created_at from order_job_processes union all
    select created_by, created_at from order_dispatches union all
    select created_by, created_at from order_payments union all
    select created_by, created_at from commission_invoices union all
    select created_by, created_at from activity_log union all
    select created_by, created_at from transporters union all
    select created_by, created_at from job_processes union all
    select created_by, created_at from party_md_contacts union all
    select created_by, created_at from collection_tasks union all
    select created_by, created_at from cheque_collections
  ), ent as (select u, count(*) c from ev where u is not null and at >= t0 and at < t1 group by u),
  due as (select assigned_to u, count(*) total, count(*) filter (where status='done') done from collection_tasks
          where assigned_to is not null and status <> 'cancelled' and due_date between p_from and p_to group by 1),
  dn as (select assigned_to u,
           count(*) filter (where task_type='invoice_delivery') inv,
           count(*) filter (where task_type='payment_deposit') dp, coalesce(sum(amount_to_collect) filter (where task_type='payment_deposit'),0) dpa
         from collection_tasks where status='done' and assigned_to is not null and completed_at >= t0 and completed_at < t1 group by 1),
  chq as (select collected_by u, count(*) ch, coalesce(sum(amount),0) cha from cheque_collections
          where collected_by is not null and collection_date between p_from and p_to group by 1)
  select p.id, p.name, p.email, case when p.is_admin then 'admin' else coalesce(p.profile_template,'unassigned') end, p.department, p.staff_type,
         coalesce(e.c,0), coalesce(d.total,0), coalesce(d.done,0),
         case when coalesce(d.total,0)=0 then null else round(100.0*d.done/d.total,1) end,
         coalesce(c.ch,0), coalesce(c.cha,0), coalesce(n.inv,0), coalesce(n.dp,0), coalesce(n.dpa,0)
  from profiles p left join ent e on e.u=p.id left join due d on d.u=p.id left join dn n on n.u=p.id left join chq c on c.u=p.id
  where p.is_active order by p.name;
end $$;


--
-- Name: stage_sort_order(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stage_sort_order(p_stage text) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
    select sort_order from public.pipeline_stages where id = p_stage;
$$;


--
-- Name: supplier_flag_incomplete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.supplier_flag_incomplete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ begin
new.incomplete := coalesce(btrim(new.contact_person),'')='' or coalesce(btrim(new.mobile),'')='' or coalesce(btrim(new.gst),'')='' or coalesce(btrim(new.pan),'')='' or coalesce(btrim(new.bank_account_1),'')='' or coalesce(btrim(new.state_code),'')='' or coalesce(btrim(new.state),'')='' or coalesce(btrim(new.product_range),'')='';
return new; end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    kind text NOT NULL,
    note text,
    quotation_ref text,
    due_date date,
    is_done boolean DEFAULT false NOT NULL,
    done_at timestamp with time zone,
    done_by uuid,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT activity_log_entity_type_check CHECK ((entity_type = ANY (ARRAY['lead'::text, 'supplier'::text, 'buyer'::text, 'deal'::text]))),
    CONSTRAINT activity_log_kind_check CHECK ((kind = ANY (ARRAY['note'::text, 'call'::text, 'quotation'::text, 'reminder'::text, 'task'::text, 'discussion'::text, 'email'::text, 'whatsapp'::text, 'meeting'::text])))
);


--
-- Name: article_specs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_specs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    gsm numeric(8,2),
    fiber text,
    blend_ratio text,
    weave_type text,
    certification text,
    width_cm numeric(8,2),
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT article_specs_fiber_check CHECK (((fiber IS NULL) OR (fiber = ANY (ARRAY['cotton'::text, 'polyester'::text, 'viscose'::text, 'linen'::text, 'blended'::text, 'other'::text])))),
    CONSTRAINT article_specs_weave_type_check CHECK (((weave_type IS NULL) OR (weave_type = ANY (ARRAY['woven'::text, 'knit'::text, 'nonwoven'::text]))))
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    actor_name text,
    entity text NOT NULL,
    entity_id text,
    action text NOT NULL,
    detail text,
    ip text
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buyer_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.buyer_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: buyer_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buyer_master (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_code text DEFAULT ('BUY-'::text || lpad((nextval('public.buyer_code_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
    name text NOT NULL,
    contact_person text,
    mobile text,
    email text,
    address text,
    gst text,
    pan text,
    spindlage_capacity text,
    product_range text,
    state_code text,
    state text,
    category text,
    commission_basis text,
    commission_value numeric(12,4),
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    gst_status text DEFAULT 'unverified'::text NOT NULL,
    gst_verified_at timestamp with time zone,
    gst_verified_by uuid,
    gst_verify_note text,
    company_id uuid,
    incomplete boolean DEFAULT false NOT NULL,
    CONSTRAINT buyer_master_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['1'::text, '2'::text, '3'::text, '4'::text])))),
    CONSTRAINT buyer_master_commission_basis_check CHECK (((commission_basis IS NULL) OR (commission_basis = ANY (ARRAY['pct'::text, 'per_bag'::text, 'per_kg'::text])))),
    CONSTRAINT buyer_master_commission_value_check CHECK (((commission_value IS NULL) OR (commission_value >= (0)::numeric))),
    CONSTRAINT buyer_master_contact_person_check CHECK ((btrim(contact_person) <> ''::text)),
    CONSTRAINT buyer_master_gst_check CHECK (((gst = upper(gst)) AND (gst ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'::text))),
    CONSTRAINT buyer_master_gst_state CHECK (((state_code IS NULL) OR ("left"(gst, 2) = state_code))),
    CONSTRAINT buyer_master_gst_status_check CHECK ((gst_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'failed'::text]))),
    CONSTRAINT buyer_master_mobile_check CHECK (((mobile IS NULL) OR (mobile ~ '^[0-9]{10}$'::text))),
    CONSTRAINT buyer_master_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT buyer_master_pan_check CHECK (((pan = upper(pan)) AND (length(pan) = 10))),
    CONSTRAINT buyer_master_product_range_check CHECK ((btrim(product_range) <> ''::text)),
    CONSTRAINT buyer_master_spindlage_capacity_check CHECK ((btrim(spindlage_capacity) <> ''::text)),
    CONSTRAINT buyer_master_state_code_check CHECK (((state_code IS NULL) OR (state_code ~ '^[0-9]{2}$'::text)))
);


--
-- Name: buyers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buyers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    country text,
    contact_name text,
    email text,
    phone text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    tax_id text,
    address text,
    category text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT buyers_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['1'::text, '2'::text, '3'::text, '4'::text]))))
);


--
-- Name: cheque_collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cheque_collections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    cheque_no text NOT NULL,
    bank_name text,
    amount numeric NOT NULL,
    collection_date date DEFAULT CURRENT_DATE NOT NULL,
    collected_by uuid,
    deposited_on date,
    notes text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deposit_bank text,
    slip_no text,
    deposited_by uuid,
    CONSTRAINT cheque_collections_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT cheque_collections_check CHECK (((deposited_on IS NULL) OR (deposited_on >= collection_date))),
    CONSTRAINT cheque_collections_cheque_no_check CHECK ((length(btrim(cheque_no)) > 0))
);


--
-- Name: cinv_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cinv_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: collection_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collection_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    task_type text NOT NULL,
    due_date date NOT NULL,
    assigned_to uuid,
    amount_to_collect numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    completed_at timestamp with time zone,
    completed_by uuid,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collection_tasks_amount_to_collect_check CHECK ((amount_to_collect >= (0)::numeric)),
    CONSTRAINT collection_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text]))),
    CONSTRAINT collection_tasks_task_type_check CHECK ((task_type = ANY (ARRAY['buyer_payment'::text, 'commission_invoice'::text, 'follow_up'::text, 'cheque_collection'::text, 'invoice_delivery'::text, 'payment_deposit'::text, 'cash_collection'::text, 'delivery_note'::text, 'mill_payment_deposit'::text])))
);


--
-- Name: commission_invoice_prints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_invoice_prints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    printed_by uuid DEFAULT auth.uid(),
    printed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: commission_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_no text,
    order_id uuid NOT NULL,
    invoice_date date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date NOT NULL,
    buyer_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    company_id uuid NOT NULL,
    amount numeric NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commission_invoices_amount_check CHECK ((amount >= (0)::numeric))
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    short_name text NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    ref_prefix text NOT NULL,
    address text,
    phone_numbers text[],
    fax text,
    email text,
    tax_id text,
    is_home boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pan_number text,
    mobile text,
    brand_name text,
    is_buyer boolean DEFAULT false NOT NULL,
    is_supplier boolean DEFAULT false NOT NULL,
    trade_name text,
    legal_name text,
    state text,
    state_code text,
    phone_1 text,
    phone_2 text,
    phone_3 text,
    bank_account_1 text,
    bank_account_2 text,
    record_date date DEFAULT CURRENT_DATE NOT NULL,
    CONSTRAINT companies_pan_number_format CHECK (((pan_number IS NULL) OR ((pan_number = upper(pan_number)) AND (length(pan_number) = 10))))
);


--
-- Name: COLUMN companies.pan_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.pan_number IS 'Indian PAN (permanent account number), e.g. AHFP5121IG. Stored upper-cased; 10 chars when present.';


--
-- Name: COLUMN companies.mobile; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.mobile IS 'Primary contact mobile number, distinct from the office phone_numbers list.';


--
-- Name: COLUMN companies.brand_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.brand_name IS 'The parent/market-facing brand name this legal company trades under. Several legal companies (different ref_prefix/short_name, same brand_name) can share one brand -- groups them without a separate parent table.';


--
-- Name: COLUMN companies.is_buyer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.is_buyer IS 'This party is (also) a buyer. A record can be is_buyer and is_supplier at once so the same party is never duplicated.';


--
-- Name: COLUMN companies.is_supplier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.is_supplier IS 'This party is (also) a supplier. See is_buyer.';


--
-- Name: company_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    size_bytes bigint,
    mime_type text,
    uploaded_by uuid DEFAULT auth.uid(),
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: count_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.count_master (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    count_no integer NOT NULL,
    machine text NOT NULL,
    composition text NOT NULL,
    ratio text NOT NULL,
    blended text,
    yarn_type text NOT NULL,
    process text,
    certification text,
    ply text,
    display_name text DEFAULT ''::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT count_master_blended_check CHECK (((blended IS NULL) OR (blended = ANY (ARRAY['COTTON/POLYESTER'::text, 'COTTON/VISCOSE'::text])))),
    CONSTRAINT count_master_blended_rule CHECK (((composition = 'BLENDED'::text) = (blended IS NOT NULL))),
    CONSTRAINT count_master_certification_check CHECK (((certification IS NULL) OR (certification = ANY (ARRAY['BCI'::text, 'OEKO TEX'::text, 'GOTS'::text, 'NPOP'::text, 'NOP'::text])))),
    CONSTRAINT count_master_composition_check CHECK ((composition = ANY (ARRAY['COTTON'::text, 'POLYESTER'::text, 'VISCOSE'::text, 'LINEN'::text, 'HEMP'::text, 'BLENDED'::text]))),
    CONSTRAINT count_master_count_no_check CHECK (((count_no >= 6) AND (count_no <= 120))),
    CONSTRAINT count_master_machine_check CHECK ((machine = ANY (ARRAY['OE'::text, 'RING SPUN'::text, 'VORTEX'::text]))),
    CONSTRAINT count_master_ply_check CHECK (((ply IS NULL) OR (ply = ANY (ARRAY['SINGLE'::text, 'DOUBLE'::text])))),
    CONSTRAINT count_master_process_check CHECK (((process IS NULL) OR (process = ANY (ARRAY['COMBED'::text, 'KARDED'::text, 'KARDED COMPACT'::text, 'COMBED COMPACT'::text])))),
    CONSTRAINT count_master_ratio_check CHECK ((ratio ~ '^[0-9]{1,3}(%|(/[0-9]{1,3})+)$'::text)),
    CONSTRAINT count_master_yarn_type_check CHECK ((yarn_type = ANY (ARRAY['CHEESE'::text, 'CONE'::text])))
);


--
-- Name: crm_deal_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crm_deal_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_no text,
    status text DEFAULT 'draft'::text NOT NULL,
    lead_id uuid,
    buyer_id uuid NOT NULL,
    supplier_id uuid,
    company_id uuid,
    buyer_gst text,
    supplier_gst text,
    payment_term_id uuid,
    count_id uuid NOT NULL,
    quantity numeric NOT NULL,
    uom text DEFAULT 'KG'::text NOT NULL,
    supplier_rate numeric,
    buyer_rate numeric,
    price_basis text DEFAULT 'ex_mill'::text NOT NULL,
    freight text DEFAULT 'excluded'::text NOT NULL,
    bag_weight numeric,
    commission_type text,
    commission_value numeric,
    commission_total numeric,
    margin numeric,
    margin_total numeric,
    notes text,
    owner_id uuid DEFAULT auth.uid(),
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_confirmed_at timestamp with time zone,
    supplier_confirmed_by uuid,
    buyer_confirmed_at timestamp with time zone,
    buyer_confirmed_by uuid,
    approved_at timestamp with time zone,
    approved_by uuid,
    approval_margin_pct numeric(8,2),
    confirmed_at timestamp with time zone,
    confirmed_by uuid,
    sales_confirmation_id uuid,
    CONSTRAINT bags_need_weight CHECK (((uom <> 'BAGS'::text) OR (bag_weight IS NOT NULL))),
    CONSTRAINT crm_deals_bag_weight_check CHECK (((bag_weight IS NULL) OR (bag_weight > (0)::numeric))),
    CONSTRAINT crm_deals_buyer_rate_check CHECK (((buyer_rate IS NULL) OR (buyer_rate >= (0)::numeric))),
    CONSTRAINT crm_deals_commission_type_check CHECK (((commission_type IS NULL) OR (commission_type = ANY (ARRAY['pct_0_5'::text, 'pct_1'::text, 'pct_2'::text, 'per_kg_1'::text, 'per_bag_30'::text])))),
    CONSTRAINT crm_deals_freight_check CHECK ((freight = ANY (ARRAY['included'::text, 'excluded'::text]))),
    CONSTRAINT crm_deals_price_basis_check CHECK ((price_basis = ANY (ARRAY['ex_mill'::text, 'net'::text]))),
    CONSTRAINT crm_deals_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT crm_deals_supplier_rate_check CHECK (((supplier_rate IS NULL) OR (supplier_rate >= (0)::numeric))),
    CONSTRAINT crm_deals_uom_check CHECK ((uom = ANY (ARRAY['KG'::text, 'TONS'::text, 'METERS'::text, 'BAGS'::text])))
);


--
-- Name: deal_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    field text NOT NULL,
    old_value text,
    new_value text,
    changed_by uuid DEFAULT auth.uid(),
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deal_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    kind text NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    size_bytes bigint,
    content_type text,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deal_documents_kind_check CHECK ((kind = ANY (ARRAY['bl'::text, 'invoice'::text, 'packing_list'::text, 'cert_origin'::text, 'qc_report'::text, 'po'::text, 'lc'::text, 'remittance'::text, 'other'::text])))
);


--
-- Name: deal_ref_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_ref_sequences (
    year integer NOT NULL,
    last_value integer DEFAULT 0 NOT NULL
);


--
-- Name: deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ref_no text NOT NULL,
    stage text DEFAULT 'lead'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    lost_reason text,
    buyer_id uuid,
    owner_id uuid,
    source text,
    article text,
    quantity numeric(14,3),
    unit text,
    target_price numeric(14,4),
    notes text,
    sample_status text,
    sample_dispatched_on date,
    sample_courier_ref text,
    sample_approved_on date,
    sample_notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deals_sample_status_check CHECK (((sample_status IS NULL) OR (sample_status = ANY (ARRAY['not_required'::text, 'requested'::text, 'dispatched'::text, 'in_transit'::text, 'approved'::text, 'revision'::text])))),
    CONSTRAINT deals_source_check CHECK (((source IS NULL) OR (source = ANY (ARRAY['repeat'::text, 'referral'::text, 'fair'::text, 'outbound'::text, 'inbound'::text])))),
    CONSTRAINT deals_status_check CHECK ((status = ANY (ARRAY['open'::text, 'lost'::text])))
);


--
-- Name: dispatch_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispatch_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_process_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_process_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: job_processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_processes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    process_code text DEFAULT ('JOB-'::text || lpad((nextval('public.job_process_code_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
    name text NOT NULL,
    short_name text,
    buyer_id uuid,
    station_id uuid,
    office_address text,
    delivery_address text,
    contact_person text,
    mobile text,
    contact_person_2 text,
    mobile_2 text,
    office_phone text,
    res_phone text,
    gst text,
    state_code text,
    state text,
    pan text,
    bank_account text,
    company_id uuid,
    info text,
    remarks text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_processes_gst_check CHECK (((gst IS NULL) OR ((gst = upper(gst)) AND (gst ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'::text)))),
    CONSTRAINT job_processes_gst_state CHECK (((gst IS NULL) OR (state_code IS NULL) OR ("left"(gst, 2) = state_code))),
    CONSTRAINT job_processes_mobile_2_check CHECK (((mobile_2 IS NULL) OR (mobile_2 ~ '^[0-9]{10}$'::text))),
    CONSTRAINT job_processes_mobile_check CHECK (((mobile IS NULL) OR (mobile ~ '^[0-9]{10}$'::text))),
    CONSTRAINT job_processes_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT job_processes_pan_check CHECK (((pan IS NULL) OR ((pan = upper(pan)) AND (length(pan) = 10)))),
    CONSTRAINT job_processes_state_code_check CHECK (((state_code IS NULL) OR (state_code ~ '^[0-9]{2}$'::text)))
);


--
-- Name: lead_no_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_no_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_no text DEFAULT ((('LD-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.lead_no_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    party_role text NOT NULL,
    party_name text NOT NULL,
    contact_person text,
    mobile text,
    station text,
    office_address text,
    gst text,
    count_id uuid,
    quantity numeric(14,3),
    uom text,
    expected_rate numeric(14,2),
    timeline text,
    remarks text,
    sales_staff_id uuid,
    follow_up_date date,
    buyer_id uuid,
    supplier_id uuid,
    qualified_at timestamp with time zone,
    qualified_by uuid,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    converted_deal_id uuid,
    converted_at timestamp with time zone,
    CONSTRAINT leads_expected_rate_check CHECK (((expected_rate IS NULL) OR (expected_rate >= (0)::numeric))),
    CONSTRAINT leads_gst_check CHECK (((gst IS NULL) OR ((gst = upper(gst)) AND (gst ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'::text)))),
    CONSTRAINT leads_mobile_check CHECK (((mobile IS NULL) OR (mobile ~ '^[0-9]{10}$'::text))),
    CONSTRAINT leads_party_name_check CHECK ((btrim(party_name) <> ''::text)),
    CONSTRAINT leads_party_role_check CHECK ((party_role = ANY (ARRAY['buyer'::text, 'supplier'::text, 'both'::text]))),
    CONSTRAINT leads_quantity_check CHECK (((quantity IS NULL) OR (quantity > (0)::numeric))),
    CONSTRAINT leads_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'qualified'::text, 'lost'::text]))),
    CONSTRAINT leads_uom_check CHECK (((uom IS NULL) OR (uom = ANY (ARRAY['KG'::text, 'TONS'::text, 'METERS'::text, 'BAGS'::text]))))
);


--
-- Name: mills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    country text,
    contact_name text,
    email text,
    phone text,
    category text,
    certifications text,
    default_commission_basis text,
    default_commission_value numeric(10,4),
    bank_details text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mills_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['1'::text, '2'::text, '3'::text, '4'::text])))),
    CONSTRAINT mills_default_commission_basis_check CHECK (((default_commission_basis IS NULL) OR (default_commission_basis = ANY (ARRAY['pct'::text, 'per_kg'::text, 'per_order'::text]))))
);


--
-- Name: order_dispatches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_dispatches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dispatch_no text,
    order_id uuid NOT NULL,
    dispatch_date date DEFAULT CURRENT_DATE NOT NULL,
    quantity numeric NOT NULL,
    transport_id uuid,
    vehicle_no text,
    lr_no text,
    invoice_no text,
    remarks text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    mill_invoice_no text,
    mill_invoice_date date,
    pod_received_on date,
    grn_no text,
    grn_received_on date,
    transporter_invoice_no text,
    transporter_invoice_date date,
    transporter_invoice_amount numeric,
    mill_invoice_entered_at timestamp with time zone,
    mill_invoice_entered_by uuid,
    transporter_invoice_entered_at timestamp with time zone,
    transporter_invoice_entered_by uuid,
    transporter_paid_amount numeric,
    transporter_paid_on date,
    transporter_payment_ref text,
    CONSTRAINT od_grn_after_dispatch CHECK (((grn_received_on IS NULL) OR (grn_received_on >= dispatch_date))),
    CONSTRAINT od_millinv_after_dispatch CHECK (((mill_invoice_date IS NULL) OR (mill_invoice_date >= (dispatch_date - 30)))),
    CONSTRAINT od_pod_after_dispatch CHECK (((pod_received_on IS NULL) OR (pod_received_on >= dispatch_date))),
    CONSTRAINT od_tinv_amount_chk CHECK (((transporter_invoice_amount IS NULL) OR (transporter_invoice_amount >= (0)::numeric))),
    CONSTRAINT od_tpay_chk CHECK ((((transporter_paid_amount IS NULL) OR (transporter_paid_amount >= (0)::numeric)) AND ((COALESCE(transporter_paid_amount, (0)::numeric) = (0)::numeric) OR (transporter_paid_on IS NOT NULL)))),
    CONSTRAINT order_dispatches_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: order_job_processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_job_processes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    job_process_id uuid NOT NULL,
    quantity numeric,
    instructions text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_job_processes_quantity_check CHECK (((quantity IS NULL) OR (quantity > (0)::numeric)))
);


--
-- Name: order_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    kind text NOT NULL,
    amount numeric NOT NULL,
    paid_on date DEFAULT CURRENT_DATE NOT NULL,
    mode text,
    reference text,
    notes text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT order_payments_kind_check CHECK ((kind = ANY (ARRAY['buyer_receipt'::text, 'supplier_payment'::text])))
);


--
-- Name: order_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_transports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_transports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    kind text NOT NULL,
    transporter_id uuid,
    vehicle_no text,
    driver_name text,
    driver_mobile text,
    freight_amount numeric,
    notes text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_transports_check CHECK (((kind = 'our'::text) OR (transporter_id IS NOT NULL))),
    CONSTRAINT order_transports_freight_amount_check CHECK (((freight_amount IS NULL) OR (freight_amount >= (0)::numeric))),
    CONSTRAINT order_transports_kind_check CHECK ((kind = ANY (ARRAY['our'::text, 'third_party'::text])))
);


--
-- Name: order_trips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_trips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_no text DEFAULT 'pending'::text NOT NULL,
    dispatch_id uuid NOT NULL,
    trip_date date DEFAULT CURRENT_DATE NOT NULL,
    vehicle_no text,
    driver_name text,
    mileage_start numeric NOT NULL,
    mileage_end numeric NOT NULL,
    fuel_used numeric DEFAULT 0 NOT NULL,
    fuel_cost numeric DEFAULT 0 NOT NULL,
    other_cost numeric DEFAULT 0 NOT NULL,
    notes text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    distance_km numeric GENERATED ALWAYS AS ((mileage_end - mileage_start)) STORED,
    trip_cost numeric GENERATED ALWAYS AS ((fuel_cost + other_cost)) STORED,
    CONSTRAINT order_trips_check CHECK ((mileage_end >= mileage_start)),
    CONSTRAINT order_trips_fuel_cost_check CHECK ((fuel_cost >= (0)::numeric)),
    CONSTRAINT order_trips_fuel_used_check CHECK ((fuel_used >= (0)::numeric)),
    CONSTRAINT order_trips_mileage_start_check CHECK ((mileage_start >= (0)::numeric)),
    CONSTRAINT order_trips_other_cost_check CHECK ((other_cost >= (0)::numeric))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_no text,
    order_date date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    deal_id uuid NOT NULL,
    sales_confirmation_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    company_id uuid NOT NULL,
    count_id uuid NOT NULL,
    quantity numeric NOT NULL,
    uom text NOT NULL,
    buyer_rate numeric NOT NULL,
    supplier_rate numeric NOT NULL,
    commission_type text,
    commission_value numeric,
    price_basis text NOT NULL,
    freight text NOT NULL,
    bag_weight numeric,
    payment_term_id uuid,
    tentative_dispatch_date date,
    delivery_schedule text,
    special_instructions text,
    job_process_id uuid,
    alt_delivery_address text,
    confirmed_at timestamp with time zone,
    confirmed_by uuid,
    execution_opened_at timestamp with time zone,
    execution_opened_by uuid,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_tracking_enabled boolean DEFAULT false NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'open_for_execution'::text, 'closed'::text])))
);


--
-- Name: party_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.party_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    party_type text NOT NULL,
    party_id uuid NOT NULL,
    doc_type text DEFAULT 'other'::text NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    size_bytes bigint,
    mime_type text,
    uploaded_by uuid DEFAULT auth.uid(),
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT party_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['gst_copy'::text, 'cancelled_cheque'::text, 'kyc_form'::text, 'other'::text]))),
    CONSTRAINT party_documents_party_type_check CHECK ((party_type = ANY (ARRAY['supplier'::text, 'buyer'::text])))
);


--
-- Name: party_md_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.party_md_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    party_type text NOT NULL,
    party_id uuid NOT NULL,
    name text NOT NULL,
    mobile text NOT NULL,
    email text,
    designation text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT party_md_contacts_mobile_check CHECK ((mobile ~ '^[0-9]{10}$'::text)),
    CONSTRAINT party_md_contacts_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT party_md_contacts_party_type_check CHECK ((party_type = ANY (ARRAY['supplier'::text, 'buyer'::text])))
);


--
-- Name: payment_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_terms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    days integer DEFAULT 0 NOT NULL,
    advance_pct numeric(5,2) DEFAULT 0 NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_terms_advance_pct_check CHECK (((advance_pct >= (0)::numeric) AND (advance_pct <= (100)::numeric))),
    CONSTRAINT payment_terms_days_check CHECK (((days >= 0) AND (days <= 365))),
    CONSTRAINT payment_terms_name_check CHECK ((length(btrim(name)) > 0))
);


--
-- Name: permission_catalogue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_catalogue (
    key text NOT NULL,
    label text NOT NULL,
    group_name text NOT NULL,
    hint text DEFAULT ''::text NOT NULL,
    dangerous boolean DEFAULT false NOT NULL,
    sort_order integer NOT NULL
);


--
-- Name: TABLE permission_catalogue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.permission_catalogue IS 'Fixed catalogue of grantable permission keys, ported from app/domain/permissions.py CATALOGUE. Rows here are reference data, not something the app writes to at runtime.';


--
-- Name: pipeline_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_stages (
    id text NOT NULL,
    name text NOT NULL,
    phase text NOT NULL,
    owner_label text NOT NULL,
    sort_order integer NOT NULL,
    is_supported boolean DEFAULT false NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    job_title text,
    is_admin boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    profile_template text,
    last_login_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    department text,
    staff_type text,
    CONSTRAINT profiles_staff_type_chk CHECK (((staff_type IS NULL) OR (staff_type = ANY (ARRAY['collection'::text, 'office'::text]))))
);


--
-- Name: TABLE profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profiles IS 'App-level profile for a Supabase Auth user. Mirrors the old User model minus the password fields, which Supabase Auth now owns.';


--
-- Name: sales_confirmation_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_confirmation_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sc_id uuid NOT NULL,
    party text NOT NULL,
    channel text NOT NULL,
    recipient text,
    message text,
    sent_by uuid DEFAULT auth.uid(),
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    delivery_status text DEFAULT 'opened'::text NOT NULL,
    batch_id uuid,
    CONSTRAINT sales_confirmation_notifications_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'email'::text]))),
    CONSTRAINT sales_confirmation_notifications_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['opened'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT sales_confirmation_notifications_party_check CHECK ((party = ANY (ARRAY['supplier'::text, 'buyer'::text])))
);


--
-- Name: sales_confirmations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_confirmations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sc_no text,
    confirmed_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    deal_id uuid,
    supplier_id uuid,
    buyer_id uuid,
    supplier_company_id uuid,
    buyer_company_id uuid,
    count_id uuid,
    uom text DEFAULT 'KG'::text NOT NULL,
    quantity numeric,
    net_quantity numeric,
    freight text DEFAULT 'excluded'::text NOT NULL,
    bag_weight numeric,
    rate numeric,
    payment_term_id uuid,
    remarks text,
    supplier_notified_at timestamp with time zone,
    buyer_notified_at timestamp with time zone,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id uuid,
    buyer_rate numeric,
    supplier_rate numeric,
    commission_type text,
    commission_value numeric,
    price_basis text,
    delivery_schedule text,
    special_instructions text,
    CONSTRAINT sales_confirmations_bag_weight_check CHECK (((bag_weight IS NULL) OR (bag_weight > (0)::numeric))),
    CONSTRAINT sales_confirmations_buyer_rate_check CHECK (((buyer_rate IS NULL) OR (buyer_rate >= (0)::numeric))),
    CONSTRAINT sales_confirmations_freight_check CHECK ((freight = ANY (ARRAY['included'::text, 'excluded'::text]))),
    CONSTRAINT sales_confirmations_net_quantity_check CHECK (((net_quantity IS NULL) OR (net_quantity > (0)::numeric))),
    CONSTRAINT sales_confirmations_price_basis_check CHECK (((price_basis IS NULL) OR (price_basis = ANY (ARRAY['ex_mill'::text, 'net'::text])))),
    CONSTRAINT sales_confirmations_quantity_check CHECK (((quantity IS NULL) OR (quantity > (0)::numeric))),
    CONSTRAINT sales_confirmations_rate_check CHECK (((rate IS NULL) OR (rate >= (0)::numeric))),
    CONSTRAINT sales_confirmations_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'cancelled'::text]))),
    CONSTRAINT sales_confirmations_supplier_rate_check CHECK (((supplier_rate IS NULL) OR (supplier_rate >= (0)::numeric))),
    CONSTRAINT sales_confirmations_uom_check CHECK ((uom = ANY (ARRAY['KG'::text, 'TONS'::text, 'METERS'::text, 'BAGS'::text]))),
    CONSTRAINT sc_bags_need_weight CHECK (((uom <> 'BAGS'::text) OR (bag_weight IS NOT NULL) OR (status = 'draft'::text)))
);


--
-- Name: sc_number_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sc_number_counters (
    company_id uuid NOT NULL,
    year integer NOT NULL,
    last_no integer DEFAULT 0 NOT NULL
);


--
-- Name: sc_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sc_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sc_id uuid NOT NULL,
    return_date date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date NOT NULL,
    quantity numeric NOT NULL,
    notes text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sc_returns_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: sc_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sc_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    att_date date NOT NULL,
    status text NOT NULL,
    leave_type text,
    notes text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_attendance_check CHECK (((status = 'leave'::text) OR (leave_type IS NULL))),
    CONSTRAINT staff_attendance_leave_type_check CHECK (((leave_type IS NULL) OR (leave_type = ANY (ARRAY['casual'::text, 'sick'::text, 'paid'::text, 'unpaid'::text])))),
    CONSTRAINT staff_attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'half_day'::text, 'absent'::text, 'leave'::text])))
);


--
-- Name: staff_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    category text NOT NULL,
    amount numeric NOT NULL,
    vehicle_no text,
    notes text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_expenses_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT staff_expenses_category_check CHECK ((category = ANY (ARRAY['petrol'::text, 'service'::text, 'food'::text, 'advance'::text, 'diwali_bonus'::text])))
);


--
-- Name: staff_people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    person_type text DEFAULT 'driver'::text NOT NULL,
    profile_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_people_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT staff_people_person_type_check CHECK ((person_type = ANY (ARRAY['staff'::text, 'driver'::text])))
);


--
-- Name: station_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_master (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT station_master_name_check CHECK ((length(btrim(name)) > 0))
);


--
-- Name: supplier_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supplier_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supplier_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_master (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_code text DEFAULT ('SUP-'::text || lpad((nextval('public.supplier_code_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
    name text NOT NULL,
    contact_person text,
    mobile text,
    email text,
    address text,
    gst text,
    pan text,
    bank_account_1 text,
    bank_account_2 text,
    state_code text,
    state text,
    category text,
    commission_basis text,
    commission_value numeric(12,4),
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    gst_status text DEFAULT 'unverified'::text NOT NULL,
    gst_verified_at timestamp with time zone,
    gst_verified_by uuid,
    gst_verify_note text,
    product_range text,
    company_id uuid,
    incomplete boolean DEFAULT false NOT NULL,
    CONSTRAINT supplier_master_bank_account_1_check CHECK ((btrim(bank_account_1) <> ''::text)),
    CONSTRAINT supplier_master_category_check CHECK (((category IS NULL) OR (category = ANY (ARRAY['1'::text, '2'::text, '3'::text, '4'::text])))),
    CONSTRAINT supplier_master_commission_basis_check CHECK (((commission_basis IS NULL) OR (commission_basis = ANY (ARRAY['pct'::text, 'per_bag'::text, 'per_kg'::text])))),
    CONSTRAINT supplier_master_commission_value_check CHECK (((commission_value IS NULL) OR (commission_value >= (0)::numeric))),
    CONSTRAINT supplier_master_contact_person_check CHECK ((btrim(contact_person) <> ''::text)),
    CONSTRAINT supplier_master_gst_check CHECK (((gst = upper(gst)) AND (gst ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'::text))),
    CONSTRAINT supplier_master_gst_state CHECK (("left"(gst, 2) = state_code)),
    CONSTRAINT supplier_master_gst_status_check CHECK ((gst_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'failed'::text]))),
    CONSTRAINT supplier_master_mobile_check CHECK ((mobile ~ '^[0-9]{10}$'::text)),
    CONSTRAINT supplier_master_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT supplier_master_pan_check CHECK (((pan = upper(pan)) AND (length(pan) = 10))),
    CONSTRAINT supplier_master_state_check CHECK ((btrim(state) <> ''::text)),
    CONSTRAINT supplier_master_state_code_check CHECK ((state_code ~ '^[0-9]{2}$'::text))
);


--
-- Name: transporter_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transporter_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transporters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transporters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transporter_code text DEFAULT ('TRN-'::text || lpad((nextval('public.transporter_code_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
    transporter_type text DEFAULT 'third_party'::text NOT NULL,
    name text NOT NULL,
    short_name text,
    station_id uuid,
    office_address text,
    delivery_address text,
    contact_person text,
    mobile text,
    contact_person_2 text,
    mobile_2 text,
    office_phone text,
    res_phone text,
    gst text,
    state_code text,
    state text,
    pan text,
    bank_account text,
    company_id uuid,
    info text,
    remarks text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transporters_gst_check CHECK (((gst IS NULL) OR ((gst = upper(gst)) AND (gst ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'::text)))),
    CONSTRAINT transporters_gst_state CHECK (((gst IS NULL) OR (state_code IS NULL) OR ("left"(gst, 2) = state_code))),
    CONSTRAINT transporters_mobile_2_check CHECK (((mobile_2 IS NULL) OR (mobile_2 ~ '^[0-9]{10}$'::text))),
    CONSTRAINT transporters_mobile_check CHECK (((mobile IS NULL) OR (mobile ~ '^[0-9]{10}$'::text))),
    CONSTRAINT transporters_name_check CHECK ((btrim(name) <> ''::text)),
    CONSTRAINT transporters_pan_check CHECK (((pan IS NULL) OR ((pan = upper(pan)) AND (length(pan) = 10)))),
    CONSTRAINT transporters_state_code_check CHECK (((state_code IS NULL) OR (state_code ~ '^[0-9]{2}$'::text))),
    CONSTRAINT transporters_transporter_type_check CHECK ((transporter_type = ANY (ARRAY['internal'::text, 'third_party'::text])))
);


--
-- Name: trip_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trip_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permissions (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    permission text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    granted_by uuid
);


--
-- Name: user_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_permissions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: article_specs article_specs_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_specs
    ADD CONSTRAINT article_specs_code_key UNIQUE (code);


--
-- Name: article_specs article_specs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_specs
    ADD CONSTRAINT article_specs_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: buyer_master buyer_master_buyer_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_master
    ADD CONSTRAINT buyer_master_buyer_code_key UNIQUE (buyer_code);


--
-- Name: buyer_master buyer_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_master
    ADD CONSTRAINT buyer_master_pkey PRIMARY KEY (id);


--
-- Name: buyers buyers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyers
    ADD CONSTRAINT buyers_pkey PRIMARY KEY (id);


--
-- Name: cheque_collections cheque_collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cheque_collections
    ADD CONSTRAINT cheque_collections_pkey PRIMARY KEY (id);


--
-- Name: collection_tasks collection_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_tasks
    ADD CONSTRAINT collection_tasks_pkey PRIMARY KEY (id);


--
-- Name: commission_invoice_prints commission_invoice_prints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_invoice_prints
    ADD CONSTRAINT commission_invoice_prints_pkey PRIMARY KEY (id);


--
-- Name: commission_invoices commission_invoices_invoice_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_invoices
    ADD CONSTRAINT commission_invoices_invoice_no_key UNIQUE (invoice_no);


--
-- Name: commission_invoices commission_invoices_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_invoices
    ADD CONSTRAINT commission_invoices_order_id_key UNIQUE (order_id);


--
-- Name: commission_invoices commission_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_invoices
    ADD CONSTRAINT commission_invoices_pkey PRIMARY KEY (id);


--
-- Name: companies companies_fmt_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.companies
    ADD CONSTRAINT companies_fmt_chk CHECK ((((tax_id IS NULL) OR (tax_id ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'::text)) AND ((pan_number IS NULL) OR (pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'::text)) AND ((email IS NULL) OR (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)) AND ((phone_1 IS NULL) OR (phone_1 ~ '^\+[0-9]{1,3}[0-9]{6,12}$'::text)) AND ((phone_2 IS NULL) OR (phone_2 ~ '^\+[0-9]{1,3}[0-9]{6,12}$'::text)) AND ((phone_3 IS NULL) OR (phone_3 ~ '^\+[0-9]{1,3}[0-9]{6,12}$'::text)))) NOT VALID;


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: companies companies_required_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.companies
    ADD CONSTRAINT companies_required_chk CHECK (((trade_name IS NULL) OR ((COALESCE(TRIM(BOTH FROM email), ''::text) <> ''::text) AND (COALESCE(TRIM(BOTH FROM address), ''::text) <> ''::text) AND (COALESCE(TRIM(BOTH FROM bank_account_1), ''::text) <> ''::text)))) NOT VALID;


--
-- Name: company_documents company_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_documents
    ADD CONSTRAINT company_documents_pkey PRIMARY KEY (id);


--
-- Name: count_master count_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.count_master
    ADD CONSTRAINT count_master_pkey PRIMARY KEY (id);


--
-- Name: crm_deals crm_deals_deal_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_deal_no_key UNIQUE (deal_no);


--
-- Name: crm_deals crm_deals_lead_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_lead_id_key UNIQUE (lead_id);


--
-- Name: crm_deals crm_deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_pkey PRIMARY KEY (id);


--
-- Name: deal_changes deal_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_changes
    ADD CONSTRAINT deal_changes_pkey PRIMARY KEY (id);


--
-- Name: deal_documents deal_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_documents
    ADD CONSTRAINT deal_documents_pkey PRIMARY KEY (id);


--
-- Name: deal_documents deal_documents_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_documents
    ADD CONSTRAINT deal_documents_storage_path_key UNIQUE (storage_path);


--
-- Name: deal_ref_sequences deal_ref_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_ref_sequences
    ADD CONSTRAINT deal_ref_sequences_pkey PRIMARY KEY (year);


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);


--
-- Name: deals deals_ref_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_ref_no_key UNIQUE (ref_no);


--
-- Name: job_processes job_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_processes
    ADD CONSTRAINT job_processes_pkey PRIMARY KEY (id);


--
-- Name: job_processes job_processes_process_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_processes
    ADD CONSTRAINT job_processes_process_code_key UNIQUE (process_code);


--
-- Name: leads leads_lead_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_lead_no_key UNIQUE (lead_no);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: mills mills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mills
    ADD CONSTRAINT mills_pkey PRIMARY KEY (id);


--
-- Name: order_dispatches order_dispatches_dispatch_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_dispatches
    ADD CONSTRAINT order_dispatches_dispatch_no_key UNIQUE (dispatch_no);


--
-- Name: order_dispatches order_dispatches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_dispatches
    ADD CONSTRAINT order_dispatches_pkey PRIMARY KEY (id);


--
-- Name: order_job_processes order_job_processes_order_id_job_process_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_job_processes
    ADD CONSTRAINT order_job_processes_order_id_job_process_id_key UNIQUE (order_id, job_process_id);


--
-- Name: order_job_processes order_job_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_job_processes
    ADD CONSTRAINT order_job_processes_pkey PRIMARY KEY (id);


--
-- Name: order_payments order_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_pkey PRIMARY KEY (id);


--
-- Name: order_transports order_transports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_transports
    ADD CONSTRAINT order_transports_pkey PRIMARY KEY (id);


--
-- Name: order_trips order_trips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_trips
    ADD CONSTRAINT order_trips_pkey PRIMARY KEY (id);


--
-- Name: order_trips order_trips_trip_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_trips
    ADD CONSTRAINT order_trips_trip_no_key UNIQUE (trip_no);


--
-- Name: orders orders_deal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_deal_id_key UNIQUE (deal_id);


--
-- Name: orders orders_order_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_no_key UNIQUE (order_no);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: party_documents party_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_documents
    ADD CONSTRAINT party_documents_pkey PRIMARY KEY (id);


--
-- Name: party_documents party_documents_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_documents
    ADD CONSTRAINT party_documents_storage_path_key UNIQUE (storage_path);


--
-- Name: party_md_contacts party_md_contacts_party_type_party_id_mobile_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_md_contacts
    ADD CONSTRAINT party_md_contacts_party_type_party_id_mobile_key UNIQUE (party_type, party_id, mobile);


--
-- Name: party_md_contacts party_md_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.party_md_contacts
    ADD CONSTRAINT party_md_contacts_pkey PRIMARY KEY (id);


--
-- Name: payment_terms payment_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_terms
    ADD CONSTRAINT payment_terms_pkey PRIMARY KEY (id);


--
-- Name: permission_catalogue permission_catalogue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_catalogue
    ADD CONSTRAINT permission_catalogue_pkey PRIMARY KEY (key);


--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: sales_confirmation_notifications sales_confirmation_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmation_notifications
    ADD CONSTRAINT sales_confirmation_notifications_pkey PRIMARY KEY (id);


--
-- Name: sales_confirmations sales_confirmations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmations
    ADD CONSTRAINT sales_confirmations_pkey PRIMARY KEY (id);


--
-- Name: sales_confirmations sales_confirmations_sc_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmations
    ADD CONSTRAINT sales_confirmations_sc_no_key UNIQUE (sc_no);


--
-- Name: sc_number_counters sc_number_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sc_number_counters
    ADD CONSTRAINT sc_number_counters_pkey PRIMARY KEY (company_id, year);


--
-- Name: sc_returns sc_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sc_returns
    ADD CONSTRAINT sc_returns_pkey PRIMARY KEY (id);


--
-- Name: staff_attendance staff_attendance_person_id_att_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_person_id_att_date_key UNIQUE (person_id, att_date);


--
-- Name: staff_attendance staff_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_pkey PRIMARY KEY (id);


--
-- Name: staff_expenses staff_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_expenses
    ADD CONSTRAINT staff_expenses_pkey PRIMARY KEY (id);


--
-- Name: staff_people staff_people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_people
    ADD CONSTRAINT staff_people_pkey PRIMARY KEY (id);


--
-- Name: station_master station_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_master
    ADD CONSTRAINT station_master_pkey PRIMARY KEY (id);


--
-- Name: supplier_master supplier_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_master
    ADD CONSTRAINT supplier_master_pkey PRIMARY KEY (id);


--
-- Name: supplier_master supplier_master_supplier_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_master
    ADD CONSTRAINT supplier_master_supplier_code_key UNIQUE (supplier_code);


--
-- Name: transporters transporters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporters
    ADD CONSTRAINT transporters_pkey PRIMARY KEY (id);


--
-- Name: transporters transporters_transporter_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporters
    ADD CONSTRAINT transporters_transporter_code_key UNIQUE (transporter_code);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_user_id_permission_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_permission_key UNIQUE (user_id, permission);


--
-- Name: activity_entity_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_entity_ix ON public.activity_log USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: buyer_master_gst_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX buyer_master_gst_uq ON public.buyer_master USING btree (gst);


--
-- Name: buyer_master_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX buyer_master_name_uq ON public.buyer_master USING btree (lower(btrim(name)));


--
-- Name: buyer_master_pan_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX buyer_master_pan_ix ON public.buyer_master USING btree (pan);


--
-- Name: cheque_collections_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cheque_collections_date ON public.cheque_collections USING btree (collection_date);


--
-- Name: cheque_collections_no_bank; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cheque_collections_no_bank ON public.cheque_collections USING btree (lower(btrim(cheque_no)), lower(COALESCE(btrim(bank_name), ''::text)));


--
-- Name: cheque_collections_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cheque_collections_order ON public.cheque_collections USING btree (order_id);


--
-- Name: collection_tasks_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX collection_tasks_order ON public.collection_tasks USING btree (order_id);


--
-- Name: collection_tasks_status_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX collection_tasks_status_due ON public.collection_tasks USING btree (status, due_date);


--
-- Name: commission_invoice_prints_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commission_invoice_prints_at ON public.commission_invoice_prints USING btree (printed_at);


--
-- Name: companies_one_home_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX companies_one_home_idx ON public.companies USING btree (is_home) WHERE is_home;


--
-- Name: companies_ref_prefix_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX companies_ref_prefix_uq ON public.companies USING btree (upper(ref_prefix)) WHERE (ref_prefix IS NOT NULL);


--
-- Name: count_master_display_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX count_master_display_uq ON public.count_master USING btree (upper(display_name));


--
-- Name: ix_article_specs_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_article_specs_code ON public.article_specs USING btree (code);


--
-- Name: ix_audit_log_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_log_at ON public.audit_log USING btree (at);


--
-- Name: ix_audit_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_audit_log_entity ON public.audit_log USING btree (entity, entity_id);


--
-- Name: ix_buyers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_buyers_name ON public.buyers USING btree (name);


--
-- Name: ix_deal_documents_deal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_deal_documents_deal_id ON public.deal_documents USING btree (deal_id);


--
-- Name: ix_deals_buyer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_deals_buyer ON public.deals USING btree (buyer_id);


--
-- Name: ix_deals_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_deals_owner ON public.deals USING btree (owner_id);


--
-- Name: ix_deals_stage_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_deals_stage_status ON public.deals USING btree (stage, status);


--
-- Name: ix_mills_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_mills_name ON public.mills USING btree (name);


--
-- Name: ix_user_permissions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_permissions_user_id ON public.user_permissions USING btree (user_id);


--
-- Name: job_processes_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX job_processes_name_uq ON public.job_processes USING btree (lower(btrim(name)));


--
-- Name: leads_status_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_status_ix ON public.leads USING btree (status);


--
-- Name: order_trips_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_trips_date ON public.order_trips USING btree (trip_date);


--
-- Name: order_trips_dispatch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_trips_dispatch ON public.order_trips USING btree (dispatch_id);


--
-- Name: party_docs_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX party_docs_ix ON public.party_documents USING btree (party_type, party_id);


--
-- Name: payment_terms_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payment_terms_name_uq ON public.payment_terms USING btree (lower(btrim(name)));


--
-- Name: staff_attendance_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_attendance_date ON public.staff_attendance USING btree (att_date);


--
-- Name: staff_expenses_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_expenses_date ON public.staff_expenses USING btree (entry_date);


--
-- Name: staff_expenses_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_expenses_person ON public.staff_expenses USING btree (person_id);


--
-- Name: staff_people_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX staff_people_name ON public.staff_people USING btree (lower(btrim(name)));


--
-- Name: staff_people_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX staff_people_profile ON public.staff_people USING btree (profile_id) WHERE (profile_id IS NOT NULL);


--
-- Name: station_master_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX station_master_name_uq ON public.station_master USING btree (lower(btrim(name)));


--
-- Name: supplier_master_gst_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX supplier_master_gst_uq ON public.supplier_master USING btree (gst);


--
-- Name: supplier_master_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX supplier_master_name_uq ON public.supplier_master USING btree (lower(btrim(name)));


--
-- Name: supplier_master_pan_ix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_master_pan_ix ON public.supplier_master USING btree (pan);


--
-- Name: transporters_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX transporters_name_uq ON public.transporters USING btree (lower(btrim(name)));


--
-- Name: company_documents cd_limit_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cd_limit_trg BEFORE INSERT ON public.company_documents FOR EACH ROW EXECUTE FUNCTION public.cd_limit();


--
-- Name: article_specs trg_article_specs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_article_specs_updated_at BEFORE UPDATE ON public.article_specs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: buyer_master trg_buyer_flag_incomplete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_buyer_flag_incomplete BEFORE INSERT OR UPDATE ON public.buyer_master FOR EACH ROW EXECUTE FUNCTION public.buyer_flag_incomplete();


--
-- Name: buyer_master trg_buyer_gst_verify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_buyer_gst_verify BEFORE INSERT OR UPDATE ON public.buyer_master FOR EACH ROW EXECUTE FUNCTION public.party_gst_verify();


--
-- Name: buyer_master trg_buyer_master_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_buyer_master_updated_at BEFORE UPDATE ON public.buyer_master FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: buyers trg_buyers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_buyers_updated_at BEFORE UPDATE ON public.buyers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cheque_collections trg_cc_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cc_guard BEFORE INSERT OR UPDATE ON public.cheque_collections FOR EACH ROW EXECUTE FUNCTION public.cheque_collection_guard();


--
-- Name: commission_invoices trg_ci_close; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ci_close AFTER INSERT ON public.commission_invoices FOR EACH ROW EXECUTE FUNCTION public.order_close_check();


--
-- Name: commission_invoices trg_ci_no; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ci_no BEFORE INSERT ON public.commission_invoices FOR EACH ROW EXECUTE FUNCTION public.commission_invoice_guard();


--
-- Name: companies trg_companies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: count_master trg_count_master_display; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_count_master_display BEFORE INSERT OR UPDATE ON public.count_master FOR EACH ROW EXECUTE FUNCTION public.count_master_set_display();


--
-- Name: count_master trg_count_master_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_count_master_updated_at BEFORE UPDATE ON public.count_master FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_deals trg_crm_deals_derive; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_crm_deals_derive BEFORE INSERT OR UPDATE ON public.crm_deals FOR EACH ROW EXECUTE FUNCTION public.crm_deals_derive();


--
-- Name: crm_deals trg_crm_deals_rate_track; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_crm_deals_rate_track BEFORE UPDATE ON public.crm_deals FOR EACH ROW EXECUTE FUNCTION public.crm_deals_rate_track();


--
-- Name: crm_deals trg_crm_deals_supplier_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_crm_deals_supplier_lock BEFORE UPDATE ON public.crm_deals FOR EACH ROW EXECUTE FUNCTION public.crm_deals_supplier_lock();


--
-- Name: crm_deals trg_crm_deals_unconvert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_crm_deals_unconvert AFTER DELETE ON public.crm_deals FOR EACH ROW EXECUTE FUNCTION public.crm_deals_unconvert();


--
-- Name: crm_deals trg_crm_deals_z_approve; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_crm_deals_z_approve BEFORE UPDATE ON public.crm_deals FOR EACH ROW EXECUTE FUNCTION public.crm_deals_approve_guard();


--
-- Name: collection_tasks trg_ct_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ct_guard BEFORE INSERT OR UPDATE ON public.collection_tasks FOR EACH ROW EXECUTE FUNCTION public.collection_task_guard();


--
-- Name: deal_documents trg_deal_documents_after_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_deal_documents_after_delete AFTER DELETE ON public.deal_documents FOR EACH ROW EXECUTE FUNCTION public.deal_documents_after_delete();


--
-- Name: deal_documents trg_deal_documents_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_deal_documents_after_insert AFTER INSERT ON public.deal_documents FOR EACH ROW EXECUTE FUNCTION public.deal_documents_after_insert();


--
-- Name: deals trg_deals_before_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_deals_before_insert BEFORE INSERT ON public.deals FOR EACH ROW EXECUTE FUNCTION public.deals_before_insert();


--
-- Name: deals trg_deals_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_deals_before_update BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.deals_before_update();


--
-- Name: deals trg_deals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_deals_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: job_processes trg_job_processes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_job_processes_updated_at BEFORE UPDATE ON public.job_processes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: leads trg_leads_a_readonly; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_leads_a_readonly BEFORE DELETE OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.leads_readonly_when_converted();


--
-- Name: leads trg_leads_qualification; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_leads_qualification BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.leads_enforce_qualification();


--
-- Name: leads trg_leads_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mills trg_mills_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mills_updated_at BEFORE UPDATE ON public.mills FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: order_dispatches trg_od_close; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_od_close AFTER INSERT OR DELETE OR UPDATE ON public.order_dispatches FOR EACH ROW EXECUTE FUNCTION public.order_close_check();


--
-- Name: order_dispatches trg_od_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_od_guard BEFORE INSERT OR DELETE OR UPDATE ON public.order_dispatches FOR EACH ROW EXECUTE FUNCTION public.order_exec_guard();


--
-- Name: order_dispatches trg_od_stamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_od_stamp BEFORE INSERT OR UPDATE ON public.order_dispatches FOR EACH ROW EXECUTE FUNCTION public.dispatch_entry_stamp();


--
-- Name: order_job_processes trg_ojp_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ojp_guard BEFORE INSERT OR DELETE OR UPDATE ON public.order_job_processes FOR EACH ROW EXECUTE FUNCTION public.order_exec_guard();


--
-- Name: order_payments trg_op_close; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_op_close AFTER INSERT OR DELETE OR UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION public.order_close_check();


--
-- Name: order_payments trg_op_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_op_guard BEFORE INSERT OR DELETE OR UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION public.order_exec_guard();


--
-- Name: orders trg_orders_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_guard BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.orders_guard();


--
-- Name: order_transports trg_ot_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ot_guard BEFORE INSERT OR DELETE OR UPDATE ON public.order_transports FOR EACH ROW EXECUTE FUNCTION public.order_exec_guard();


--
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sales_confirmations trg_sc_derive; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sc_derive BEFORE INSERT OR UPDATE ON public.sales_confirmations FOR EACH ROW EXECUTE FUNCTION public.sc_derive();


--
-- Name: sales_confirmation_notifications trg_scn_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_scn_guard BEFORE INSERT OR UPDATE ON public.sales_confirmation_notifications FOR EACH ROW EXECUTE FUNCTION public.scn_guard();


--
-- Name: supplier_master trg_supplier_flag_incomplete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_supplier_flag_incomplete BEFORE INSERT OR UPDATE ON public.supplier_master FOR EACH ROW EXECUTE FUNCTION public.supplier_flag_incomplete();


--
-- Name: supplier_master trg_supplier_gst_verify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_supplier_gst_verify BEFORE INSERT OR UPDATE ON public.supplier_master FOR EACH ROW EXECUTE FUNCTION public.party_gst_verify();


--
-- Name: supplier_master trg_supplier_master_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_supplier_master_updated_at BEFORE UPDATE ON public.supplier_master FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: transporters trg_transporters_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_transporters_updated_at BEFORE UPDATE ON public.transporters FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: order_trips trg_trip_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trip_guard BEFORE INSERT OR UPDATE ON public.order_trips FOR EACH ROW EXECUTE FUNCTION public.order_trip_guard();


--
-- Name: article_specs article_specs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_specs
    ADD CONSTRAINT article_specs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);


--
-- Name: buyer_master buyer_master_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_master
    ADD CONSTRAINT buyer_master_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: buyer_master buyer_master_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_master
    ADD CONSTRAINT buyer_master_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: buyers buyers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyers
    ADD CONSTRAINT buyers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: cheque_collections cheque_collections_collected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cheque_collections
    ADD CONSTRAINT cheque_collections_collected_by_fkey FOREIGN KEY (collected_by) REFERENCES public.profiles(id);


--
-- Name: cheque_collections cheque_collections_deposited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cheque_collections
    ADD CONSTRAINT cheque_collections_deposited_by_fkey FOREIGN KEY (deposited_by) REFERENCES public.profiles(id);


--
-- Name: cheque_collections cheque_collections_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cheque_collections
    ADD CONSTRAINT cheque_collections_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: collection_tasks collection_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_tasks
    ADD CONSTRAINT collection_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id);


--
-- Name: collection_tasks collection_tasks_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_tasks
    ADD CONSTRAINT collection_tasks_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: commission_invoice_prints commission_invoice_prints_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_invoice_prints
    ADD CONSTRAINT commission_invoice_prints_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.commission_invoices(id);


--
-- Name: commission_invoices commission_invoices_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_invoices
    ADD CONSTRAINT commission_invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: companies companies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: company_documents company_documents_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_documents
    ADD CONSTRAINT company_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: count_master count_master_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.count_master
    ADD CONSTRAINT count_master_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: crm_deals crm_deals_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.buyer_master(id) ON DELETE RESTRICT;


--
-- Name: crm_deals crm_deals_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: crm_deals crm_deals_count_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.count_master(id) ON DELETE RESTRICT;


--
-- Name: crm_deals crm_deals_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE RESTRICT;


--
-- Name: crm_deals crm_deals_payment_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_payment_term_id_fkey FOREIGN KEY (payment_term_id) REFERENCES public.payment_terms(id) ON DELETE SET NULL;


--
-- Name: crm_deals crm_deals_sales_confirmation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_sales_confirmation_id_fkey FOREIGN KEY (sales_confirmation_id) REFERENCES public.sales_confirmations(id) ON DELETE RESTRICT;


--
-- Name: crm_deals crm_deals_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.supplier_master(id) ON DELETE RESTRICT;


--
-- Name: deal_changes deal_changes_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_changes
    ADD CONSTRAINT deal_changes_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.crm_deals(id) ON DELETE CASCADE;


--
-- Name: deal_documents deal_documents_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_documents
    ADD CONSTRAINT deal_documents_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;


--
-- Name: deal_documents deal_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_documents
    ADD CONSTRAINT deal_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id);


--
-- Name: deals deals_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.buyers(id);


--
-- Name: deals deals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: deals deals_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id);


--
-- Name: deals deals_stage_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_stage_fkey FOREIGN KEY (stage) REFERENCES public.pipeline_stages(id);


--
-- Name: job_processes job_processes_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_processes
    ADD CONSTRAINT job_processes_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.buyer_master(id) ON DELETE SET NULL;


--
-- Name: job_processes job_processes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_processes
    ADD CONSTRAINT job_processes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: job_processes job_processes_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_processes
    ADD CONSTRAINT job_processes_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.station_master(id) ON DELETE SET NULL;


--
-- Name: leads leads_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.buyer_master(id) ON DELETE RESTRICT;


--
-- Name: leads leads_count_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.count_master(id) ON DELETE RESTRICT;


--
-- Name: leads leads_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: leads leads_qualified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_qualified_by_fkey FOREIGN KEY (qualified_by) REFERENCES public.profiles(id);


--
-- Name: leads leads_sales_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_sales_staff_id_fkey FOREIGN KEY (sales_staff_id) REFERENCES public.profiles(id);


--
-- Name: leads leads_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.supplier_master(id) ON DELETE RESTRICT;


--
-- Name: mills mills_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mills
    ADD CONSTRAINT mills_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: order_dispatches order_dispatches_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_dispatches
    ADD CONSTRAINT order_dispatches_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_dispatches order_dispatches_transport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_dispatches
    ADD CONSTRAINT order_dispatches_transport_id_fkey FOREIGN KEY (transport_id) REFERENCES public.order_transports(id) ON DELETE SET NULL;


--
-- Name: order_job_processes order_job_processes_job_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_job_processes
    ADD CONSTRAINT order_job_processes_job_process_id_fkey FOREIGN KEY (job_process_id) REFERENCES public.job_processes(id) ON DELETE RESTRICT;


--
-- Name: order_job_processes order_job_processes_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_job_processes
    ADD CONSTRAINT order_job_processes_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_payments order_payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_transports order_transports_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_transports
    ADD CONSTRAINT order_transports_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_transports order_transports_transporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_transports
    ADD CONSTRAINT order_transports_transporter_id_fkey FOREIGN KEY (transporter_id) REFERENCES public.transporters(id) ON DELETE SET NULL;


--
-- Name: order_trips order_trips_dispatch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_trips
    ADD CONSTRAINT order_trips_dispatch_id_fkey FOREIGN KEY (dispatch_id) REFERENCES public.order_dispatches(id);


--
-- Name: orders orders_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.crm_deals(id) ON DELETE RESTRICT;


--
-- Name: orders orders_job_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_job_process_id_fkey FOREIGN KEY (job_process_id) REFERENCES public.job_processes(id) ON DELETE SET NULL;


--
-- Name: orders orders_sales_confirmation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_sales_confirmation_id_fkey FOREIGN KEY (sales_confirmation_id) REFERENCES public.sales_confirmations(id) ON DELETE RESTRICT;


--
-- Name: profiles profiles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sales_confirmation_notifications sales_confirmation_notifications_sc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmation_notifications
    ADD CONSTRAINT sales_confirmation_notifications_sc_id_fkey FOREIGN KEY (sc_id) REFERENCES public.sales_confirmations(id) ON DELETE CASCADE;


--
-- Name: sales_confirmations sales_confirmations_buyer_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmations
    ADD CONSTRAINT sales_confirmations_buyer_company_id_fkey FOREIGN KEY (buyer_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: sales_confirmations sales_confirmations_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmations
    ADD CONSTRAINT sales_confirmations_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.buyer_master(id) ON DELETE RESTRICT;


--
-- Name: sales_confirmations sales_confirmations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmations
    ADD CONSTRAINT sales_confirmations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: sales_confirmations sales_confirmations_count_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmations
    ADD CONSTRAINT sales_confirmations_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.count_master(id) ON DELETE RESTRICT;


--
-- Name: sales_confirmations sales_confirmations_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmations
    ADD CONSTRAINT sales_confirmations_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.crm_deals(id) ON DELETE SET NULL;


--
-- Name: sales_confirmations sales_confirmations_payment_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmations
    ADD CONSTRAINT sales_confirmations_payment_term_id_fkey FOREIGN KEY (payment_term_id) REFERENCES public.payment_terms(id) ON DELETE SET NULL;


--
-- Name: sales_confirmations sales_confirmations_supplier_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmations
    ADD CONSTRAINT sales_confirmations_supplier_company_id_fkey FOREIGN KEY (supplier_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: sales_confirmations sales_confirmations_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_confirmations
    ADD CONSTRAINT sales_confirmations_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.supplier_master(id) ON DELETE RESTRICT;


--
-- Name: sc_returns sc_returns_sc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sc_returns
    ADD CONSTRAINT sc_returns_sc_id_fkey FOREIGN KEY (sc_id) REFERENCES public.sales_confirmations(id) ON DELETE CASCADE;


--
-- Name: staff_attendance staff_attendance_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_attendance
    ADD CONSTRAINT staff_attendance_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.staff_people(id);


--
-- Name: staff_expenses staff_expenses_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_expenses
    ADD CONSTRAINT staff_expenses_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.staff_people(id);


--
-- Name: staff_people staff_people_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_people
    ADD CONSTRAINT staff_people_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id);


--
-- Name: supplier_master supplier_master_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_master
    ADD CONSTRAINT supplier_master_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: supplier_master supplier_master_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_master
    ADD CONSTRAINT supplier_master_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: transporters transporters_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporters
    ADD CONSTRAINT transporters_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: transporters transporters_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transporters
    ADD CONSTRAINT transporters_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.station_master(id) ON DELETE SET NULL;


--
-- Name: user_permissions user_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id);


--
-- Name: user_permissions user_permissions_permission_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_permission_fkey FOREIGN KEY (permission) REFERENCES public.permission_catalogue(key);


--
-- Name: user_permissions user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: activity_log act_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY act_read ON public.activity_log FOR SELECT TO authenticated USING (public.activity_can(entity_type, false));


--
-- Name: activity_log act_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY act_write ON public.activity_log TO authenticated USING (public.activity_can(entity_type, true)) WITH CHECK (public.activity_can(entity_type, true));


--
-- Name: activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: article_specs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_specs ENABLE ROW LEVEL SECURITY;

--
-- Name: article_specs article_specs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY article_specs_select ON public.article_specs FOR SELECT TO authenticated USING (public.has_any_permission(ARRAY['deal.read'::text, 'article.manage'::text]));


--
-- Name: article_specs article_specs_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY article_specs_write ON public.article_specs TO authenticated USING (public.has_permission('article.manage'::text)) WITH CHECK (public.has_permission('article.manage'::text));


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT TO authenticated WITH CHECK ((actor_id = auth.uid()));


--
-- Name: audit_log audit_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated USING (public.has_permission('audit.view'::text));


--
-- Name: buyer_master; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.buyer_master ENABLE ROW LEVEL SECURITY;

--
-- Name: buyer_master buyer_master_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY buyer_master_select ON public.buyer_master FOR SELECT TO authenticated USING (public.has_any_permission(ARRAY['buyer.manage'::text, 'lead.manage'::text, 'lead.qualify'::text, 'deal.read'::text]));


--
-- Name: buyer_master buyer_master_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY buyer_master_write ON public.buyer_master TO authenticated USING (public.has_permission('buyer.manage'::text)) WITH CHECK (public.has_permission('buyer.manage'::text));


--
-- Name: buyers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;

--
-- Name: buyers buyers_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY buyers_select ON public.buyers FOR SELECT TO authenticated USING (public.has_any_permission(ARRAY['deal.read'::text, 'buyer.manage'::text]));


--
-- Name: buyers buyers_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY buyers_write ON public.buyers TO authenticated USING (public.has_permission('buyer.manage'::text)) WITH CHECK (public.has_permission('buyer.manage'::text));


--
-- Name: cheque_collections cc_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cc_del ON public.cheque_collections FOR DELETE TO authenticated USING (public.has_permission('order.manage'::text));


--
-- Name: cheque_collections cc_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cc_ins ON public.cheque_collections FOR INSERT TO authenticated WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: cheque_collections cc_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cc_sel ON public.cheque_collections FOR SELECT TO authenticated USING ((public.has_permission('order.read'::text) OR public.has_permission('order.manage'::text)));


--
-- Name: cheque_collections cc_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cc_upd ON public.cheque_collections FOR UPDATE TO authenticated USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: company_documents cd_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cd_del ON public.company_documents FOR DELETE TO authenticated USING ((public.has_permission('settings.manage'::text) OR public.is_admin()));


--
-- Name: company_documents cd_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cd_ins ON public.company_documents FOR INSERT TO authenticated WITH CHECK ((public.has_permission('settings.manage'::text) OR public.is_admin()));


--
-- Name: company_documents cd_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cd_sel ON public.company_documents FOR SELECT TO authenticated USING ((public.has_permission('settings.manage'::text) OR public.is_admin()));


--
-- Name: cheque_collections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cheque_collections ENABLE ROW LEVEL SECURITY;

--
-- Name: commission_invoices ci_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ci_sel ON public.commission_invoices FOR SELECT USING ((public.has_permission('order.read'::text) OR public.has_permission('order.manage'::text)));


--
-- Name: commission_invoice_prints cip_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cip_sel ON public.commission_invoice_prints FOR SELECT TO authenticated USING ((public.has_permission('order.read'::text) OR public.has_permission('order.manage'::text)));


--
-- Name: collection_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collection_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: commission_invoice_prints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commission_invoice_prints ENABLE ROW LEVEL SECURITY;

--
-- Name: commission_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commission_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: companies companies_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_select ON public.companies FOR SELECT USING (true);


--
-- Name: companies companies_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_write ON public.companies USING (public.has_permission('settings.manage'::text)) WITH CHECK (public.has_permission('settings.manage'::text));


--
-- Name: company_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: count_master; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.count_master ENABLE ROW LEVEL SECURITY;

--
-- Name: count_master count_master_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY count_master_select ON public.count_master FOR SELECT TO authenticated USING (public.has_any_permission(ARRAY['article.manage'::text, 'lead.manage'::text, 'lead.qualify'::text, 'deal.read'::text]));


--
-- Name: count_master count_master_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY count_master_write ON public.count_master TO authenticated USING (public.has_permission('article.manage'::text)) WITH CHECK (public.has_permission('article.manage'::text));


--
-- Name: crm_deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_deals ENABLE ROW LEVEL SECURITY;

--
-- Name: collection_tasks ct_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ct_del ON public.collection_tasks FOR DELETE TO authenticated USING (public.has_permission('order.manage'::text));


--
-- Name: collection_tasks ct_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ct_ins ON public.collection_tasks FOR INSERT TO authenticated WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: collection_tasks ct_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ct_sel ON public.collection_tasks FOR SELECT TO authenticated USING ((public.has_permission('order.read'::text) OR public.has_permission('order.manage'::text)));


--
-- Name: collection_tasks ct_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ct_upd ON public.collection_tasks FOR UPDATE TO authenticated USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: deal_changes dc_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dc_sel ON public.deal_changes FOR SELECT USING (public.has_permission('deal.read'::text));


--
-- Name: deal_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_documents deal_documents_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deal_documents_delete ON public.deal_documents FOR DELETE TO authenticated USING (public.has_permission('document.delete'::text));


--
-- Name: deal_documents deal_documents_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deal_documents_insert ON public.deal_documents FOR INSERT TO authenticated WITH CHECK ((public.has_permission('document.upload'::text) AND (uploaded_by = auth.uid())));


--
-- Name: deal_documents deal_documents_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deal_documents_select ON public.deal_documents FOR SELECT TO authenticated USING (public.has_permission('document.read'::text));


--
-- Name: deal_ref_sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_ref_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_deals deals_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_del ON public.crm_deals FOR DELETE TO authenticated USING (((status = 'draft'::text) AND public.has_permission('deal.create'::text)));


--
-- Name: crm_deals deals_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_ins ON public.crm_deals FOR INSERT TO authenticated WITH CHECK (public.has_permission('deal.create'::text));


--
-- Name: deals deals_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_insert ON public.deals FOR INSERT TO authenticated WITH CHECK (public.has_permission('deal.create'::text));


--
-- Name: crm_deals deals_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_sel ON public.crm_deals FOR SELECT TO authenticated USING (public.has_permission('deal.read'::text));


--
-- Name: deals deals_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_select ON public.deals FOR SELECT TO authenticated USING (public.has_permission('deal.read'::text));


--
-- Name: crm_deals deals_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_upd ON public.crm_deals FOR UPDATE TO authenticated USING ((public.has_permission('deal.edit'::text) OR public.has_permission('deal.create'::text))) WITH CHECK ((public.has_permission('deal.edit'::text) OR public.has_permission('deal.create'::text)));


--
-- Name: deals deals_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_update ON public.deals FOR UPDATE TO authenticated USING (public.has_permission('deal.read'::text)) WITH CHECK (public.has_permission('deal.read'::text));


--
-- Name: job_processes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_processes ENABLE ROW LEVEL SECURITY;

--
-- Name: job_processes jp_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jp_del ON public.job_processes FOR DELETE USING (public.has_permission('jobprocess.manage'::text));


--
-- Name: job_processes jp_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jp_ins ON public.job_processes FOR INSERT WITH CHECK (public.has_permission('jobprocess.manage'::text));


--
-- Name: job_processes jp_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jp_sel ON public.job_processes FOR SELECT USING ((public.has_permission('jobprocess.read'::text) OR public.has_permission('jobprocess.manage'::text)));


--
-- Name: job_processes jp_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jp_upd ON public.job_processes FOR UPDATE USING (public.has_permission('jobprocess.manage'::text)) WITH CHECK (public.has_permission('jobprocess.manage'::text));


--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: leads leads_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_delete ON public.leads FOR DELETE TO authenticated USING (public.has_permission('lead.manage'::text));


--
-- Name: leads leads_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_insert ON public.leads FOR INSERT TO authenticated WITH CHECK (public.has_permission('lead.manage'::text));


--
-- Name: leads leads_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated USING (public.has_any_permission(ARRAY['lead.manage'::text, 'lead.qualify'::text, 'deal.read'::text]));


--
-- Name: leads leads_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_update ON public.leads FOR UPDATE TO authenticated USING (public.has_any_permission(ARRAY['lead.manage'::text, 'lead.qualify'::text])) WITH CHECK (public.has_any_permission(ARRAY['lead.manage'::text, 'lead.qualify'::text]));


--
-- Name: party_md_contacts md_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY md_all ON public.party_md_contacts TO authenticated USING ((public.has_permission('md_contact.view'::text) AND public.party_doc_can(party_type, true))) WITH CHECK ((public.has_permission('md_contact.view'::text) AND public.party_doc_can(party_type, true)));


--
-- Name: mills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mills ENABLE ROW LEVEL SECURITY;

--
-- Name: mills mills_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mills_select ON public.mills FOR SELECT TO authenticated USING (public.has_any_permission(ARRAY['deal.read'::text, 'mill.manage'::text]));


--
-- Name: mills mills_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mills_write ON public.mills TO authenticated USING (public.has_permission('mill.manage'::text)) WITH CHECK (public.has_permission('mill.manage'::text));


--
-- Name: orders ord_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ord_del ON public.orders FOR DELETE USING (((status = 'draft'::text) AND public.has_permission('order.manage'::text)));


--
-- Name: orders ord_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ord_sel ON public.orders FOR SELECT USING ((public.has_permission('order.read'::text) OR public.has_permission('order.manage'::text)));


--
-- Name: orders ord_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ord_upd ON public.orders FOR UPDATE USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: order_dispatches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_dispatches ENABLE ROW LEVEL SECURITY;

--
-- Name: order_dispatches order_dispatches_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_dispatches_del ON public.order_dispatches FOR DELETE USING (public.has_permission('order.manage'::text));


--
-- Name: order_dispatches order_dispatches_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_dispatches_ins ON public.order_dispatches FOR INSERT WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: order_dispatches order_dispatches_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_dispatches_sel ON public.order_dispatches FOR SELECT USING ((public.has_permission('order.read'::text) OR public.has_permission('order.manage'::text)));


--
-- Name: order_dispatches order_dispatches_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_dispatches_upd ON public.order_dispatches FOR UPDATE USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: order_job_processes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_job_processes ENABLE ROW LEVEL SECURITY;

--
-- Name: order_job_processes order_job_processes_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_job_processes_del ON public.order_job_processes FOR DELETE USING (public.has_permission('order.manage'::text));


--
-- Name: order_job_processes order_job_processes_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_job_processes_ins ON public.order_job_processes FOR INSERT WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: order_job_processes order_job_processes_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_job_processes_sel ON public.order_job_processes FOR SELECT USING ((public.has_permission('order.read'::text) OR public.has_permission('order.manage'::text)));


--
-- Name: order_job_processes order_job_processes_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_job_processes_upd ON public.order_job_processes FOR UPDATE USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: order_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: order_payments order_payments_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_payments_del ON public.order_payments FOR DELETE USING (public.has_permission('order.manage'::text));


--
-- Name: order_payments order_payments_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_payments_ins ON public.order_payments FOR INSERT WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: order_payments order_payments_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_payments_sel ON public.order_payments FOR SELECT USING ((public.has_permission('order.read'::text) OR public.has_permission('order.manage'::text)));


--
-- Name: order_payments order_payments_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_payments_upd ON public.order_payments FOR UPDATE USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: order_transports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_transports ENABLE ROW LEVEL SECURITY;

--
-- Name: order_transports order_transports_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_transports_del ON public.order_transports FOR DELETE USING (public.has_permission('order.manage'::text));


--
-- Name: order_transports order_transports_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_transports_ins ON public.order_transports FOR INSERT WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: order_transports order_transports_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_transports_sel ON public.order_transports FOR SELECT USING ((public.has_permission('order.read'::text) OR public.has_permission('order.manage'::text)));


--
-- Name: order_transports order_transports_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_transports_upd ON public.order_transports FOR UPDATE USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: order_trips; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_trips ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: order_trips ot_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ot_del ON public.order_trips FOR DELETE TO authenticated USING (public.has_permission('order.manage'::text));


--
-- Name: order_trips ot_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ot_ins ON public.order_trips FOR INSERT TO authenticated WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: order_trips ot_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ot_sel ON public.order_trips FOR SELECT TO authenticated USING ((public.has_permission('order.read'::text) OR public.has_permission('order.manage'::text)));


--
-- Name: order_trips ot_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ot_upd ON public.order_trips FOR UPDATE TO authenticated USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: party_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.party_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: party_md_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.party_md_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_terms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_terms ENABLE ROW LEVEL SECURITY;

--
-- Name: party_documents pdoc_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pdoc_read ON public.party_documents FOR SELECT TO authenticated USING (public.party_doc_can(party_type, false));


--
-- Name: party_documents pdoc_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pdoc_write ON public.party_documents TO authenticated USING (public.party_doc_can(party_type, true)) WITH CHECK (public.party_doc_can(party_type, true));


--
-- Name: permission_catalogue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permission_catalogue ENABLE ROW LEVEL SECURITY;

--
-- Name: permission_catalogue permission_catalogue_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permission_catalogue_select ON public.permission_catalogue FOR SELECT TO authenticated USING (true);


--
-- Name: pipeline_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_stages pipeline_stages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pipeline_stages_select ON public.pipeline_stages FOR SELECT TO authenticated USING (true);


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_admin_all ON public.profiles TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: profiles profiles_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_authenticated ON public.profiles FOR SELECT TO authenticated USING (true);


--
-- Name: profiles profiles_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK (((id = auth.uid()) AND (is_admin = ( SELECT profiles_1.is_admin
   FROM public.profiles profiles_1
  WHERE (profiles_1.id = auth.uid()))) AND (is_active = ( SELECT profiles_1.is_active
   FROM public.profiles profiles_1
  WHERE (profiles_1.id = auth.uid())))));


--
-- Name: payment_terms pterm_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pterm_read ON public.payment_terms FOR SELECT TO authenticated USING ((public.has_permission('deal.read'::text) OR public.has_permission('lead.manage'::text) OR public.has_permission('settings.manage'::text)));


--
-- Name: payment_terms pterm_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pterm_write ON public.payment_terms TO authenticated USING (public.has_permission('settings.manage'::text)) WITH CHECK (public.has_permission('settings.manage'::text));


--
-- Name: staff_attendance sa_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sa_del ON public.staff_attendance FOR DELETE TO authenticated USING (public.has_permission('order.manage'::text));


--
-- Name: staff_attendance sa_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sa_ins ON public.staff_attendance FOR INSERT TO authenticated WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: staff_attendance sa_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sa_sel ON public.staff_attendance FOR SELECT TO authenticated USING ((public.has_permission('order.manage'::text) OR public.has_permission('report.view'::text)));


--
-- Name: staff_attendance sa_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sa_upd ON public.staff_attendance FOR UPDATE TO authenticated USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: sales_confirmation_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_confirmation_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_confirmations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_confirmations ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_confirmations sc_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sc_del ON public.sales_confirmations FOR DELETE USING ((public.has_permission('sc.manage'::text) AND (status = 'draft'::text)));


--
-- Name: sales_confirmations sc_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sc_ins ON public.sales_confirmations FOR INSERT WITH CHECK (public.has_permission('sc.manage'::text));


--
-- Name: sc_number_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sc_number_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: sc_returns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sc_returns ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_confirmations sc_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sc_sel ON public.sales_confirmations FOR SELECT USING ((public.has_permission('sc.read'::text) OR public.has_permission('sc.manage'::text)));


--
-- Name: sales_confirmations sc_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sc_upd ON public.sales_confirmations FOR UPDATE USING (public.has_permission('sc.manage'::text)) WITH CHECK (public.has_permission('sc.manage'::text));


--
-- Name: sales_confirmation_notifications scn_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scn_ins ON public.sales_confirmation_notifications FOR INSERT WITH CHECK (public.has_permission('sc.manage'::text));


--
-- Name: sales_confirmation_notifications scn_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scn_sel ON public.sales_confirmation_notifications FOR SELECT USING ((public.has_permission('sc.read'::text) OR public.has_permission('sc.manage'::text)));


--
-- Name: sales_confirmation_notifications scn_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scn_upd ON public.sales_confirmation_notifications FOR UPDATE USING (public.has_permission('sc.manage'::text)) WITH CHECK (public.has_permission('sc.manage'::text));


--
-- Name: sc_returns scr_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scr_ins ON public.sc_returns FOR INSERT WITH CHECK (public.has_permission('sc.manage'::text));


--
-- Name: sc_returns scr_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scr_sel ON public.sc_returns FOR SELECT USING ((public.has_permission('sc.read'::text) OR public.has_permission('sc.manage'::text)));


--
-- Name: staff_expenses se_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY se_del ON public.staff_expenses FOR DELETE TO authenticated USING (public.has_permission('order.manage'::text));


--
-- Name: staff_expenses se_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY se_ins ON public.staff_expenses FOR INSERT TO authenticated WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: staff_expenses se_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY se_sel ON public.staff_expenses FOR SELECT TO authenticated USING ((public.has_permission('order.manage'::text) OR public.has_permission('report.view'::text)));


--
-- Name: staff_expenses se_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY se_upd ON public.staff_expenses FOR UPDATE TO authenticated USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: staff_people sp_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sp_ins ON public.staff_people FOR INSERT TO authenticated WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: staff_people sp_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sp_sel ON public.staff_people FOR SELECT TO authenticated USING ((public.has_permission('order.manage'::text) OR public.has_permission('report.view'::text)));


--
-- Name: staff_people sp_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sp_upd ON public.staff_people FOR UPDATE TO authenticated USING (public.has_permission('order.manage'::text)) WITH CHECK (public.has_permission('order.manage'::text));


--
-- Name: staff_attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_people ENABLE ROW LEVEL SECURITY;

--
-- Name: station_master station_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY station_delete ON public.station_master FOR DELETE TO authenticated USING (public.has_permission('settings.manage'::text));


--
-- Name: station_master station_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY station_insert ON public.station_master FOR INSERT TO authenticated WITH CHECK ((public.has_permission('lead.manage'::text) OR public.has_permission('settings.manage'::text)));


--
-- Name: station_master; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.station_master ENABLE ROW LEVEL SECURITY;

--
-- Name: station_master station_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY station_read ON public.station_master FOR SELECT TO authenticated USING ((public.has_permission('lead.manage'::text) OR public.has_permission('lead.qualify'::text) OR public.has_permission('deal.read'::text) OR public.has_permission('settings.manage'::text)));


--
-- Name: station_master station_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY station_update ON public.station_master FOR UPDATE TO authenticated USING (public.has_permission('settings.manage'::text)) WITH CHECK (public.has_permission('settings.manage'::text));


--
-- Name: supplier_master; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_master ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_master supplier_master_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_master_select ON public.supplier_master FOR SELECT TO authenticated USING (public.has_any_permission(ARRAY['mill.manage'::text, 'lead.manage'::text, 'lead.qualify'::text, 'deal.read'::text]));


--
-- Name: supplier_master supplier_master_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_master_write ON public.supplier_master TO authenticated USING (public.has_permission('mill.manage'::text)) WITH CHECK (public.has_permission('mill.manage'::text));


--
-- Name: transporters tr_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tr_del ON public.transporters FOR DELETE USING (public.has_permission('transport.manage'::text));


--
-- Name: transporters tr_ins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tr_ins ON public.transporters FOR INSERT WITH CHECK (public.has_permission('transport.manage'::text));


--
-- Name: transporters tr_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tr_sel ON public.transporters FOR SELECT USING ((public.has_permission('transport.read'::text) OR public.has_permission('transport.manage'::text)));


--
-- Name: transporters tr_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tr_upd ON public.transporters FOR UPDATE USING (public.has_permission('transport.manage'::text)) WITH CHECK (public.has_permission('transport.manage'::text));


--
-- Name: transporters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transporters ENABLE ROW LEVEL SECURITY;

--
-- Name: user_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_permissions user_permissions_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_permissions_admin_write ON public.user_permissions TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: user_permissions user_permissions_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_permissions_select_own_or_admin ON public.user_permissions FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION activity_can(p_type text, p_write boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.activity_can(p_type text, p_write boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.activity_can(p_type text, p_write boolean) TO authenticated;
GRANT ALL ON FUNCTION public.activity_can(p_type text, p_write boolean) TO service_role;


--
-- Name: FUNCTION billing_dispatch_dashboard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.billing_dispatch_dashboard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.billing_dispatch_dashboard() TO authenticated;
GRANT ALL ON FUNCTION public.billing_dispatch_dashboard() TO service_role;


--
-- Name: FUNCTION buyer_flag_incomplete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.buyer_flag_incomplete() TO anon;
GRANT ALL ON FUNCTION public.buyer_flag_incomplete() TO authenticated;
GRANT ALL ON FUNCTION public.buyer_flag_incomplete() TO service_role;


--
-- Name: FUNCTION cancel_sales_confirmation(p_sc uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_sales_confirmation(p_sc uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_sales_confirmation(p_sc uuid) TO authenticated;
GRANT ALL ON FUNCTION public.cancel_sales_confirmation(p_sc uuid) TO service_role;


--
-- Name: FUNCTION cd_limit(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cd_limit() TO anon;
GRANT ALL ON FUNCTION public.cd_limit() TO authenticated;
GRANT ALL ON FUNCTION public.cd_limit() TO service_role;


--
-- Name: FUNCTION cheque_collection_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cheque_collection_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cheque_collection_guard() TO service_role;


--
-- Name: FUNCTION collection_activity(p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.collection_activity(p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.collection_activity(p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.collection_activity(p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION collection_dashboard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.collection_dashboard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.collection_dashboard() TO authenticated;
GRANT ALL ON FUNCTION public.collection_dashboard() TO service_role;


--
-- Name: FUNCTION collection_task_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.collection_task_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.collection_task_guard() TO service_role;


--
-- Name: FUNCTION commission_invoice_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.commission_invoice_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.commission_invoice_guard() TO service_role;


--
-- Name: FUNCTION confirm_deal(p_deal uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_deal(p_deal uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_deal(p_deal uuid) TO authenticated;
GRANT ALL ON FUNCTION public.confirm_deal(p_deal uuid) TO service_role;


--
-- Name: FUNCTION convert_lead_to_deal(p_lead uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.convert_lead_to_deal(p_lead uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.convert_lead_to_deal(p_lead uuid) TO authenticated;
GRANT ALL ON FUNCTION public.convert_lead_to_deal(p_lead uuid) TO service_role;


--
-- Name: FUNCTION count_master_set_display(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.count_master_set_display() TO anon;
GRANT ALL ON FUNCTION public.count_master_set_display() TO authenticated;
GRANT ALL ON FUNCTION public.count_master_set_display() TO service_role;


--
-- Name: FUNCTION create_order(p_deal uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_order(p_deal uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_order(p_deal uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_order(p_deal uuid) TO service_role;


--
-- Name: FUNCTION crm_deals_approve_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.crm_deals_approve_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.crm_deals_approve_guard() TO service_role;


--
-- Name: FUNCTION crm_deals_derive(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.crm_deals_derive() FROM PUBLIC;
GRANT ALL ON FUNCTION public.crm_deals_derive() TO service_role;


--
-- Name: FUNCTION crm_deals_rate_track(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.crm_deals_rate_track() FROM PUBLIC;
GRANT ALL ON FUNCTION public.crm_deals_rate_track() TO service_role;


--
-- Name: FUNCTION crm_deals_supplier_lock(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.crm_deals_supplier_lock() FROM PUBLIC;
GRANT ALL ON FUNCTION public.crm_deals_supplier_lock() TO service_role;


--
-- Name: FUNCTION crm_deals_unconvert(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.crm_deals_unconvert() FROM PUBLIC;
GRANT ALL ON FUNCTION public.crm_deals_unconvert() TO service_role;


--
-- Name: FUNCTION deal_confirm_problems(p_deal uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.deal_confirm_problems(p_deal uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.deal_confirm_problems(p_deal uuid) TO authenticated;
GRANT ALL ON FUNCTION public.deal_confirm_problems(p_deal uuid) TO service_role;


--
-- Name: FUNCTION deal_documents_after_delete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.deal_documents_after_delete() TO anon;
GRANT ALL ON FUNCTION public.deal_documents_after_delete() TO authenticated;
GRANT ALL ON FUNCTION public.deal_documents_after_delete() TO service_role;


--
-- Name: FUNCTION deal_documents_after_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.deal_documents_after_insert() TO anon;
GRANT ALL ON FUNCTION public.deal_documents_after_insert() TO authenticated;
GRANT ALL ON FUNCTION public.deal_documents_after_insert() TO service_role;


--
-- Name: FUNCTION deals_before_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.deals_before_insert() TO anon;
GRANT ALL ON FUNCTION public.deals_before_insert() TO authenticated;
GRANT ALL ON FUNCTION public.deals_before_insert() TO service_role;


--
-- Name: FUNCTION deals_before_update(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.deals_before_update() TO anon;
GRANT ALL ON FUNCTION public.deals_before_update() TO authenticated;
GRANT ALL ON FUNCTION public.deals_before_update() TO service_role;


--
-- Name: FUNCTION dispatch_entry_stamp(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.dispatch_entry_stamp() FROM PUBLIC;
GRANT ALL ON FUNCTION public.dispatch_entry_stamp() TO service_role;


--
-- Name: FUNCTION find_or_create_company_for_lead(p_name text, p_pan text, p_gst text, p_address text, p_mobile text, p_buyer boolean, p_supplier boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.find_or_create_company_for_lead(p_name text, p_pan text, p_gst text, p_address text, p_mobile text, p_buyer boolean, p_supplier boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_or_create_company_for_lead(p_name text, p_pan text, p_gst text, p_address text, p_mobile text, p_buyer boolean, p_supplier boolean) TO authenticated;
GRANT ALL ON FUNCTION public.find_or_create_company_for_lead(p_name text, p_pan text, p_gst text, p_address text, p_mobile text, p_buyer boolean, p_supplier boolean) TO service_role;


--
-- Name: FUNCTION generate_commission_invoice(p_order uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_commission_invoice(p_order uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_commission_invoice(p_order uuid) TO authenticated;
GRANT ALL ON FUNCTION public.generate_commission_invoice(p_order uuid) TO service_role;


--
-- Name: FUNCTION handle_new_auth_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_auth_user() TO service_role;


--
-- Name: FUNCTION has_any_permission(perms text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_any_permission(perms text[]) TO authenticated;
GRANT ALL ON FUNCTION public.has_any_permission(perms text[]) TO service_role;


--
-- Name: FUNCTION has_permission(perm text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_permission(perm text) TO authenticated;
GRANT ALL ON FUNCTION public.has_permission(perm text) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION leads_enforce_qualification(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.leads_enforce_qualification() TO anon;
GRANT ALL ON FUNCTION public.leads_enforce_qualification() TO authenticated;
GRANT ALL ON FUNCTION public.leads_enforce_qualification() TO service_role;


--
-- Name: FUNCTION leads_readonly_when_converted(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.leads_readonly_when_converted() TO anon;
GRANT ALL ON FUNCTION public.leads_readonly_when_converted() TO authenticated;
GRANT ALL ON FUNCTION public.leads_readonly_when_converted() TO service_role;


--
-- Name: FUNCTION log_commission_invoice_print(p_invoice uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_commission_invoice_print(p_invoice uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_commission_invoice_print(p_invoice uuid) TO authenticated;
GRANT ALL ON FUNCTION public.log_commission_invoice_print(p_invoice uuid) TO service_role;


--
-- Name: FUNCTION log_lead_discussion(p_lead uuid, p_note text, p_quantity numeric, p_rate numeric, p_timeline text, p_task_note text, p_task_due date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.log_lead_discussion(p_lead uuid, p_note text, p_quantity numeric, p_rate numeric, p_timeline text, p_task_note text, p_task_due date) TO anon;
GRANT ALL ON FUNCTION public.log_lead_discussion(p_lead uuid, p_note text, p_quantity numeric, p_rate numeric, p_timeline text, p_task_note text, p_task_due date) TO authenticated;
GRANT ALL ON FUNCTION public.log_lead_discussion(p_lead uuid, p_note text, p_quantity numeric, p_rate numeric, p_timeline text, p_task_note text, p_task_due date) TO service_role;


--
-- Name: FUNCTION next_ref_no(p_year integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.next_ref_no(p_year integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.next_ref_no(p_year integer) TO authenticated;
GRANT ALL ON FUNCTION public.next_ref_no(p_year integer) TO service_role;


--
-- Name: FUNCTION office_activity(p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.office_activity(p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.office_activity(p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.office_activity(p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION order_close_check(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.order_close_check() FROM PUBLIC;
GRANT ALL ON FUNCTION public.order_close_check() TO service_role;


--
-- Name: FUNCTION order_close_status(p_order uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.order_close_status(p_order uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.order_close_status(p_order uuid) TO authenticated;
GRANT ALL ON FUNCTION public.order_close_status(p_order uuid) TO service_role;


--
-- Name: FUNCTION order_exec_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.order_exec_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.order_exec_guard() TO service_role;


--
-- Name: FUNCTION order_trip_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.order_trip_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.order_trip_guard() TO service_role;


--
-- Name: FUNCTION order_try_close(p_order uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.order_try_close(p_order uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.order_try_close(p_order uuid) TO authenticated;
GRANT ALL ON FUNCTION public.order_try_close(p_order uuid) TO service_role;


--
-- Name: FUNCTION orders_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.orders_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.orders_guard() TO service_role;


--
-- Name: FUNCTION party_doc_can(p_type text, p_write boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.party_doc_can(p_type text, p_write boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.party_doc_can(p_type text, p_write boolean) TO authenticated;
GRANT ALL ON FUNCTION public.party_doc_can(p_type text, p_write boolean) TO service_role;


--
-- Name: FUNCTION party_gst_verify(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.party_gst_verify() TO anon;
GRANT ALL ON FUNCTION public.party_gst_verify() TO authenticated;
GRANT ALL ON FUNCTION public.party_gst_verify() TO service_role;


--
-- Name: FUNCTION pending_commission_bills(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pending_commission_bills() FROM PUBLIC;
GRANT ALL ON FUNCTION public.pending_commission_bills() TO authenticated;
GRANT ALL ON FUNCTION public.pending_commission_bills() TO service_role;


--
-- Name: FUNCTION qualify_lead_auto(p_lead uuid, p_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.qualify_lead_auto(p_lead uuid, p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.qualify_lead_auto(p_lead uuid, p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.qualify_lead_auto(p_lead uuid, p_role text) TO service_role;


--
-- Name: FUNCTION record_audit(p_entity text, p_action text, p_entity_id text, p_detail text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.record_audit(p_entity text, p_action text, p_entity_id text, p_detail text) TO anon;
GRANT ALL ON FUNCTION public.record_audit(p_entity text, p_action text, p_entity_id text, p_detail text) TO authenticated;
GRANT ALL ON FUNCTION public.record_audit(p_entity text, p_action text, p_entity_id text, p_detail text) TO service_role;


--
-- Name: FUNCTION record_sc_return(p_sc uuid, p_quantity numeric, p_notes text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_sc_return(p_sc uuid, p_quantity numeric, p_notes text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_sc_return(p_sc uuid, p_quantity numeric, p_notes text) TO authenticated;
GRANT ALL ON FUNCTION public.record_sc_return(p_sc uuid, p_quantity numeric, p_notes text) TO service_role;


--
-- Name: FUNCTION sales_followup_dashboard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sales_followup_dashboard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sales_followup_dashboard() TO authenticated;
GRANT ALL ON FUNCTION public.sales_followup_dashboard() TO service_role;


--
-- Name: FUNCTION sc_derive(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sc_derive() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sc_derive() TO service_role;


--
-- Name: FUNCTION sc_execution_status(p_sc uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sc_execution_status(p_sc uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sc_execution_status(p_sc uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sc_execution_status(p_sc uuid) TO service_role;


--
-- Name: FUNCTION sc_execution_statuses(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sc_execution_statuses() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sc_execution_statuses() TO authenticated;
GRANT ALL ON FUNCTION public.sc_execution_statuses() TO service_role;


--
-- Name: FUNCTION scn_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.scn_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.scn_guard() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION staff_efficiency(p_from date, p_to date, p_idle_hours numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_efficiency(p_from date, p_to date, p_idle_hours numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_efficiency(p_from date, p_to date, p_idle_hours numeric) TO authenticated;
GRANT ALL ON FUNCTION public.staff_efficiency(p_from date, p_to date, p_idle_hours numeric) TO service_role;


--
-- Name: FUNCTION staff_monthly_summary(p_month date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_monthly_summary(p_month date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_monthly_summary(p_month date) TO authenticated;
GRANT ALL ON FUNCTION public.staff_monthly_summary(p_month date) TO service_role;


--
-- Name: FUNCTION staff_performance(p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.staff_performance(p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.staff_performance(p_from date, p_to date) TO authenticated;
GRANT ALL ON FUNCTION public.staff_performance(p_from date, p_to date) TO service_role;


--
-- Name: FUNCTION stage_sort_order(p_stage text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.stage_sort_order(p_stage text) TO anon;
GRANT ALL ON FUNCTION public.stage_sort_order(p_stage text) TO authenticated;
GRANT ALL ON FUNCTION public.stage_sort_order(p_stage text) TO service_role;


--
-- Name: FUNCTION supplier_flag_incomplete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.supplier_flag_incomplete() TO anon;
GRANT ALL ON FUNCTION public.supplier_flag_incomplete() TO authenticated;
GRANT ALL ON FUNCTION public.supplier_flag_incomplete() TO service_role;


--
-- Name: TABLE activity_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.activity_log TO anon;
GRANT ALL ON TABLE public.activity_log TO authenticated;
GRANT ALL ON TABLE public.activity_log TO service_role;


--
-- Name: TABLE article_specs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.article_specs TO anon;
GRANT ALL ON TABLE public.article_specs TO authenticated;
GRANT ALL ON TABLE public.article_specs TO service_role;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_log TO anon;
GRANT ALL ON TABLE public.audit_log TO authenticated;
GRANT ALL ON TABLE public.audit_log TO service_role;


--
-- Name: SEQUENCE audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.audit_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO service_role;


--
-- Name: SEQUENCE buyer_code_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.buyer_code_seq TO anon;
GRANT ALL ON SEQUENCE public.buyer_code_seq TO authenticated;
GRANT ALL ON SEQUENCE public.buyer_code_seq TO service_role;


--
-- Name: TABLE buyer_master; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.buyer_master TO anon;
GRANT ALL ON TABLE public.buyer_master TO authenticated;
GRANT ALL ON TABLE public.buyer_master TO service_role;


--
-- Name: TABLE buyers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.buyers TO anon;
GRANT ALL ON TABLE public.buyers TO authenticated;
GRANT ALL ON TABLE public.buyers TO service_role;


--
-- Name: TABLE cheque_collections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cheque_collections TO anon;
GRANT ALL ON TABLE public.cheque_collections TO authenticated;
GRANT ALL ON TABLE public.cheque_collections TO service_role;


--
-- Name: SEQUENCE cinv_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.cinv_seq TO anon;
GRANT ALL ON SEQUENCE public.cinv_seq TO authenticated;
GRANT ALL ON SEQUENCE public.cinv_seq TO service_role;


--
-- Name: TABLE collection_tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.collection_tasks TO anon;
GRANT ALL ON TABLE public.collection_tasks TO authenticated;
GRANT ALL ON TABLE public.collection_tasks TO service_role;


--
-- Name: TABLE commission_invoice_prints; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.commission_invoice_prints TO anon;
GRANT ALL ON TABLE public.commission_invoice_prints TO authenticated;
GRANT ALL ON TABLE public.commission_invoice_prints TO service_role;


--
-- Name: TABLE commission_invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.commission_invoices TO anon;
GRANT ALL ON TABLE public.commission_invoices TO authenticated;
GRANT ALL ON TABLE public.commission_invoices TO service_role;


--
-- Name: TABLE companies; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.companies TO anon;
GRANT ALL ON TABLE public.companies TO authenticated;
GRANT ALL ON TABLE public.companies TO service_role;


--
-- Name: TABLE company_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.company_documents TO anon;
GRANT ALL ON TABLE public.company_documents TO authenticated;
GRANT ALL ON TABLE public.company_documents TO service_role;


--
-- Name: TABLE count_master; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.count_master TO anon;
GRANT ALL ON TABLE public.count_master TO authenticated;
GRANT ALL ON TABLE public.count_master TO service_role;


--
-- Name: SEQUENCE crm_deal_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.crm_deal_seq TO anon;
GRANT ALL ON SEQUENCE public.crm_deal_seq TO authenticated;
GRANT ALL ON SEQUENCE public.crm_deal_seq TO service_role;


--
-- Name: TABLE crm_deals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.crm_deals TO anon;
GRANT ALL ON TABLE public.crm_deals TO authenticated;
GRANT ALL ON TABLE public.crm_deals TO service_role;


--
-- Name: TABLE deal_changes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deal_changes TO anon;
GRANT ALL ON TABLE public.deal_changes TO authenticated;
GRANT ALL ON TABLE public.deal_changes TO service_role;


--
-- Name: TABLE deal_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deal_documents TO anon;
GRANT ALL ON TABLE public.deal_documents TO authenticated;
GRANT ALL ON TABLE public.deal_documents TO service_role;


--
-- Name: TABLE deal_ref_sequences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deal_ref_sequences TO anon;
GRANT ALL ON TABLE public.deal_ref_sequences TO authenticated;
GRANT ALL ON TABLE public.deal_ref_sequences TO service_role;


--
-- Name: TABLE deals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deals TO anon;
GRANT ALL ON TABLE public.deals TO authenticated;
GRANT ALL ON TABLE public.deals TO service_role;


--
-- Name: SEQUENCE dispatch_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.dispatch_seq TO anon;
GRANT ALL ON SEQUENCE public.dispatch_seq TO authenticated;
GRANT ALL ON SEQUENCE public.dispatch_seq TO service_role;


--
-- Name: SEQUENCE job_process_code_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.job_process_code_seq TO anon;
GRANT ALL ON SEQUENCE public.job_process_code_seq TO authenticated;
GRANT ALL ON SEQUENCE public.job_process_code_seq TO service_role;


--
-- Name: TABLE job_processes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.job_processes TO anon;
GRANT ALL ON TABLE public.job_processes TO authenticated;
GRANT ALL ON TABLE public.job_processes TO service_role;


--
-- Name: SEQUENCE lead_no_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.lead_no_seq TO anon;
GRANT ALL ON SEQUENCE public.lead_no_seq TO authenticated;
GRANT ALL ON SEQUENCE public.lead_no_seq TO service_role;


--
-- Name: TABLE leads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leads TO anon;
GRANT ALL ON TABLE public.leads TO authenticated;
GRANT ALL ON TABLE public.leads TO service_role;


--
-- Name: TABLE mills; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mills TO anon;
GRANT ALL ON TABLE public.mills TO authenticated;
GRANT ALL ON TABLE public.mills TO service_role;


--
-- Name: TABLE order_dispatches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_dispatches TO anon;
GRANT ALL ON TABLE public.order_dispatches TO authenticated;
GRANT ALL ON TABLE public.order_dispatches TO service_role;


--
-- Name: TABLE order_job_processes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_job_processes TO anon;
GRANT ALL ON TABLE public.order_job_processes TO authenticated;
GRANT ALL ON TABLE public.order_job_processes TO service_role;


--
-- Name: TABLE order_payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_payments TO anon;
GRANT ALL ON TABLE public.order_payments TO authenticated;
GRANT ALL ON TABLE public.order_payments TO service_role;


--
-- Name: SEQUENCE order_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.order_seq TO anon;
GRANT ALL ON SEQUENCE public.order_seq TO authenticated;
GRANT ALL ON SEQUENCE public.order_seq TO service_role;


--
-- Name: TABLE order_transports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_transports TO anon;
GRANT ALL ON TABLE public.order_transports TO authenticated;
GRANT ALL ON TABLE public.order_transports TO service_role;


--
-- Name: TABLE order_trips; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_trips TO anon;
GRANT ALL ON TABLE public.order_trips TO authenticated;
GRANT ALL ON TABLE public.order_trips TO service_role;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orders TO anon;
GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;


--
-- Name: TABLE party_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.party_documents TO anon;
GRANT ALL ON TABLE public.party_documents TO authenticated;
GRANT ALL ON TABLE public.party_documents TO service_role;


--
-- Name: TABLE party_md_contacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.party_md_contacts TO anon;
GRANT ALL ON TABLE public.party_md_contacts TO authenticated;
GRANT ALL ON TABLE public.party_md_contacts TO service_role;


--
-- Name: TABLE payment_terms; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_terms TO anon;
GRANT ALL ON TABLE public.payment_terms TO authenticated;
GRANT ALL ON TABLE public.payment_terms TO service_role;


--
-- Name: TABLE permission_catalogue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.permission_catalogue TO anon;
GRANT ALL ON TABLE public.permission_catalogue TO authenticated;
GRANT ALL ON TABLE public.permission_catalogue TO service_role;


--
-- Name: TABLE pipeline_stages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pipeline_stages TO anon;
GRANT ALL ON TABLE public.pipeline_stages TO authenticated;
GRANT ALL ON TABLE public.pipeline_stages TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE sales_confirmation_notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sales_confirmation_notifications TO anon;
GRANT ALL ON TABLE public.sales_confirmation_notifications TO authenticated;
GRANT ALL ON TABLE public.sales_confirmation_notifications TO service_role;


--
-- Name: TABLE sales_confirmations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sales_confirmations TO anon;
GRANT ALL ON TABLE public.sales_confirmations TO authenticated;
GRANT ALL ON TABLE public.sales_confirmations TO service_role;


--
-- Name: TABLE sc_number_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sc_number_counters TO anon;
GRANT ALL ON TABLE public.sc_number_counters TO authenticated;
GRANT ALL ON TABLE public.sc_number_counters TO service_role;


--
-- Name: TABLE sc_returns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sc_returns TO anon;
GRANT ALL ON TABLE public.sc_returns TO authenticated;
GRANT ALL ON TABLE public.sc_returns TO service_role;


--
-- Name: SEQUENCE sc_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.sc_seq TO anon;
GRANT ALL ON SEQUENCE public.sc_seq TO authenticated;
GRANT ALL ON SEQUENCE public.sc_seq TO service_role;


--
-- Name: TABLE staff_attendance; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_attendance TO anon;
GRANT ALL ON TABLE public.staff_attendance TO authenticated;
GRANT ALL ON TABLE public.staff_attendance TO service_role;


--
-- Name: TABLE staff_expenses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_expenses TO anon;
GRANT ALL ON TABLE public.staff_expenses TO authenticated;
GRANT ALL ON TABLE public.staff_expenses TO service_role;


--
-- Name: TABLE staff_people; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_people TO anon;
GRANT ALL ON TABLE public.staff_people TO authenticated;
GRANT ALL ON TABLE public.staff_people TO service_role;


--
-- Name: TABLE station_master; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.station_master TO anon;
GRANT ALL ON TABLE public.station_master TO authenticated;
GRANT ALL ON TABLE public.station_master TO service_role;


--
-- Name: SEQUENCE supplier_code_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.supplier_code_seq TO anon;
GRANT ALL ON SEQUENCE public.supplier_code_seq TO authenticated;
GRANT ALL ON SEQUENCE public.supplier_code_seq TO service_role;


--
-- Name: TABLE supplier_master; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.supplier_master TO anon;
GRANT ALL ON TABLE public.supplier_master TO authenticated;
GRANT ALL ON TABLE public.supplier_master TO service_role;


--
-- Name: SEQUENCE transporter_code_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.transporter_code_seq TO anon;
GRANT ALL ON SEQUENCE public.transporter_code_seq TO authenticated;
GRANT ALL ON SEQUENCE public.transporter_code_seq TO service_role;


--
-- Name: TABLE transporters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.transporters TO anon;
GRANT ALL ON TABLE public.transporters TO authenticated;
GRANT ALL ON TABLE public.transporters TO service_role;


--
-- Name: SEQUENCE trip_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.trip_seq TO anon;
GRANT ALL ON SEQUENCE public.trip_seq TO authenticated;
GRANT ALL ON SEQUENCE public.trip_seq TO service_role;


--
-- Name: TABLE user_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_permissions TO anon;
GRANT ALL ON TABLE public.user_permissions TO authenticated;
GRANT ALL ON TABLE public.user_permissions TO service_role;


--
-- Name: SEQUENCE user_permissions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.user_permissions_id_seq TO anon;
GRANT ALL ON SEQUENCE public.user_permissions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.user_permissions_id_seq TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 3qjM8aM6fMy7UmXHN3ZdjGjPQdaMMCxoKRkZBw9EqWibDqzW2CsDDUfoJjf3IeE

