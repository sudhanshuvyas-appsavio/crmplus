-- CRM automations, round 2 (2026-11-20): the monday automations of the CRM group the app did not have
-- yet, apart from messaging (email / WhatsApp), which stays out of scope.
--
--  1. automation_log: one row per automation run (what ran, on which record, done / skipped / failed),
--     shown to administrators in Administration > Automation log. The CRM automations below and the
--     ones that already existed write to it. A trigger that fails rolls its whole change back, so a
--     failure inside a trigger is shown to the user instead; the scheduled job logs its failures here.
--  2. Leads: "Do you buy weaving yarn?" = No (when a lead is created with it, or when it changes to No)
--     sets the status to Disqualified (monday workflows 1939788427 and 1939788838). Leads already turned
--     into a deal are left alone (they are read-only).
--  3. Leads: on "When is your next purchase planned?" at 12:45 IST, the lead owner is reminded
--     (monday workflow 1939800963): "Next Purchase Plan Reminder" / "This is a reminder to review and
--     update the Next Purchase Plan to ensure timely procurement." Runs every 15 minutes, at most once
--     per lead and date.
--  4. Dispatch and Billing: a new item creates its Mill Invoice Delivery task "{Item} - Task", status
--     Working on it (monday A5). When the first dispatch with a mill invoice number is recorded, that
--     task takes the invoice instead of a second task being made.
-- Additive: no existing row changes.

begin;

-- =====================================================================
-- 1. automation_log
-- =====================================================================
create table if not exists public.automation_log (
  id bigint generated always as identity primary key,
  board text not null,
  rule text not null,
  entity_type text,
  entity_id uuid,
  entity_label text,
  state text not null default 'done' check (state in ('done', 'skipped', 'failed')),
  detail text,
  dedupe_key text unique,
  actor uuid default auth.uid(),
  ran_at timestamptz not null default now()
);
create index if not exists automation_log_ran_ix on public.automation_log (ran_at desc);
create index if not exists automation_log_entity_ix on public.automation_log (entity_id);

alter table public.automation_log enable row level security;
drop policy if exists automation_log_sel on public.automation_log;
create policy automation_log_sel on public.automation_log for select to authenticated
  using (public.is_admin() or public.has_permission('audit.view'));
grant select on public.automation_log to authenticated;
grant all on public.automation_log to service_role;

create or replace function public.log_automation(
  p_board text, p_rule text, p_entity_type text, p_entity uuid, p_label text,
  p_state text default 'done', p_detail text default null, p_dedupe text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into automation_log (board, rule, entity_type, entity_id, entity_label, state, detail, dedupe_key)
  values (p_board, p_rule, p_entity_type, p_entity, p_label, coalesce(p_state, 'done'), p_detail, p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

-- =====================================================================
-- 2. Leads: weaving yarn = No -> Disqualified
-- =====================================================================
create or replace function public.leads_weaving_no_disqualify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.entry_weaves_yarn = 'no'
     and (tg_op = 'INSERT' or old.entry_weaves_yarn is distinct from 'no')
     and new.converted_deal_id is null
     and new.status is distinct from 'lost' then
    new.status := 'lost';
    perform log_automation('Leads', 'Weaving yarn = No sets Disqualified', 'lead', new.id,
                           coalesce(new.lead_no, new.party_name), 'done', 'Status set to Disqualified');
  end if;
  return new;
end $$;
-- runs after the read-only check and before the qualification rules (triggers fire in name order)
drop trigger if exists trg_leads_b_weaving_no on public.leads;
create trigger trg_leads_b_weaving_no before insert or update on public.leads
  for each row execute function public.leads_weaving_no_disqualify();

-- =====================================================================
-- 3. Leads: next purchase reminder (scheduled)
-- =====================================================================
create or replace function public.run_crm_rules(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (p_now at time zone 'Asia/Kolkata')::date;
  at_time time := (p_now at time zone 'Asia/Kolkata')::time;
  l leads;
  key text;
  sent int := 0;
begin
  if at_time >= time '12:45' then
    for l in select * from leads where entry_next_purchase = today loop
      key := 'next_purchase:' || l.id || ':' || today;
      if l.sales_staff_id is null then
        perform log_automation('Leads', 'Next purchase reminder', 'lead', l.id, coalesce(l.lead_no, l.party_name),
                               'skipped', 'The lead has no owner to remind', key);
        continue;
      end if;
      if exists (select 1 from notifications where user_id = l.sales_staff_id and dedupe_key = key) then
        continue;
      end if;
      begin
        perform notify_user(l.sales_staff_id, 'lead_reminder', 'info', 'Next Purchase Plan Reminder',
          'This is a reminder to review and update the Next Purchase Plan to ensure timely procurement. ('
            || coalesce(l.lead_no, '') || ' · ' || l.party_name || ')',
          '/leads?open=' || l.id, null, key);
        perform log_automation('Leads', 'Next purchase reminder', 'lead', l.id, coalesce(l.lead_no, l.party_name),
                               'done', 'Lead owner reminded', key);
        sent := sent + 1;
      exception when others then
        perform log_automation('Leads', 'Next purchase reminder', 'lead', l.id, coalesce(l.lead_no, l.party_name),
                               'failed', sqlerrm, key || ':failed');
      end;
    end loop;
  end if;
  return jsonb_build_object('next_purchase_reminders', sent);
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'run-crm-rules') then
      perform cron.unschedule('run-crm-rules');
    end if;
    perform cron.schedule('run-crm-rules', '*/15 * * * *', 'select public.run_crm_rules()');
  else
    raise notice 'pg_cron is not available; schedule select public.run_crm_rules() every 15 minutes from the dashboard';
  end if;
end $$;

-- =====================================================================
-- 4. Dispatch and Billing: Mill Invoice Delivery task when an item is created
-- =====================================================================
create or replace function public.orders_mill_invoice_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare days int; made uuid;
begin
  select default_due_days into days from task_types where key = 'mill_invoice_delivery';
  insert into tasks (task_type, title, status, due_date, assigned_to, buyer_id, supplier_id, order_id, details, dedupe_key)
  values ('mill_invoice_delivery', coalesce(new.order_no, 'Item') || ' - Task', 'in_progress',
          (now() at time zone 'Asia/Kolkata')::date + coalesce(days, 2), public.default_task_assignee(new.buyer_id),
          new.buyer_id, new.supplier_id, new.id, jsonb_build_object('delivery_status', 'not_delivered'),
          'mill_inv_order:' || new.id)
  on conflict (dedupe_key) do nothing
  returning id into made;
  if made is not null then
    perform log_automation('Dispatch and Billing', 'New item creates its Mill Invoice Delivery task', 'order', new.id,
                           new.order_no, 'done', 'Task ' || coalesce(new.order_no, '') || ' - Task created');
  end if;
  return null;
end $$;
drop trigger if exists trg_orders_mill_invoice_task on public.orders;
create trigger trg_orders_mill_invoice_task after insert on public.orders
  for each row execute function public.orders_mill_invoice_task();

-- The dispatch rule: a recorded mill invoice fills the item's open task (made above) when it still has
-- no invoice; otherwise it makes a task of its own, as before. The freight part is unchanged.
create or replace function public.dispatch_tasks()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare o orders; days int; tr uuid; label text; tid uuid;
begin
  select * into o from orders where id = new.order_id;
  if not found then return null; end if;

  -- The mill invoice has to be carried to the buyer.
  if new.mill_invoice_no is not null and btrim(new.mill_invoice_no) <> ''
     and (tg_op = 'INSERT' or old.mill_invoice_no is distinct from new.mill_invoice_no) then
    select id into tid from tasks
     where dedupe_key = 'mill_inv_order:' || o.id and dispatch_id is null
       and coalesce(details->>'invoice_no', '') = '' and status not in ('done', 'cancelled')
     limit 1;
    if tid is not null then
      update tasks
         set dispatch_id = new.id,
             title = 'Deliver mill invoice ' || btrim(new.mill_invoice_no) || ' (' || coalesce(o.order_no, 'order') || ')',
             details = details || (jsonb_build_object('invoice_no', btrim(new.mill_invoice_no),
                                                      'invoice_date', coalesce(new.mill_invoice_date::text, ''))
                                   - case when new.mill_invoice_date is null then 'invoice_date' else '' end)
       where id = tid;
    else
      select default_due_days into days from task_types where key = 'mill_invoice_delivery';
      insert into tasks (task_type, title, due_date, assigned_to, buyer_id, supplier_id, order_id, dispatch_id, details, dedupe_key)
      values ('mill_invoice_delivery', 'Deliver mill invoice ' || btrim(new.mill_invoice_no) || ' (' || coalesce(o.order_no, 'order') || ')',
              (now() at time zone 'Asia/Kolkata')::date + coalesce(days, 2), public.default_task_assignee(o.buyer_id),
              o.buyer_id, o.supplier_id, o.id, new.id,
              jsonb_build_object('delivery_status', 'not_delivered', 'invoice_no', btrim(new.mill_invoice_no),
                                 'invoice_date', coalesce(new.mill_invoice_date::text, '')) - case when new.mill_invoice_date is null then 'invoice_date' else '' end, 'mill_inv:' || new.id)
      on conflict (dedupe_key) do nothing;
    end if;
  end if;

  -- A transporter's bill has to be checked and paid.
  if new.transporter_invoice_no is not null and btrim(new.transporter_invoice_no) <> ''
     and (tg_op = 'INSERT' or old.transporter_invoice_no is distinct from new.transporter_invoice_no) then
    select default_due_days into days from task_types where key = 'freight_bill_check';
    select t.transporter_id into tr from order_transports t where t.id = new.transport_id;
    insert into tasks (task_type, title, due_date, assigned_to, buyer_id, supplier_id, order_id, dispatch_id, transporter_id, amount, details, dedupe_key)
    values ('freight_bill_check', 'Check freight bill ' || btrim(new.transporter_invoice_no) || ' (' || coalesce(o.order_no, 'order') || ')',
            (now() at time zone 'Asia/Kolkata')::date + coalesce(days, 5), public.default_task_assignee(o.buyer_id),
            o.buyer_id, o.supplier_id, o.id, new.id, tr, coalesce(new.transporter_invoice_amount, 0),
            jsonb_build_object('check_status', 'outstanding', 'bill_no', btrim(new.transporter_invoice_no)), 'freight:' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;
  return null;
end $$;

-- =====================================================================
-- 5. The existing CRM automations write to the log too (separate triggers; the rules are untouched)
-- =====================================================================
create or replace function public.crm_log_leads() returns trigger
language plpgsql security definer set search_path = public as $$
declare dno text;
begin
  if new.status = 'qualified' and (tg_op = 'INSERT' or old.status is distinct from 'qualified') then
    select deal_no into dno from crm_deals where lead_id = new.id;
    perform log_automation('Leads', 'Qualified creates the deal', 'lead', new.id, coalesce(new.lead_no, new.party_name),
                           case when dno is null then 'skipped' else 'done' end,
                           case when dno is null then 'No deal was created' else 'Deal ' || dno || ' created' end);
  end if;
  return null;
end $$;
drop trigger if exists trg_leads_zz_log on public.leads;
create trigger trg_leads_zz_log after insert or update of status on public.leads
  for each row execute function public.crm_log_leads();

create or replace function public.crm_log_deals() returns trigger
language plpgsql security definer set search_path = public as $$
declare sno text;
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'manager_approval' then
    perform log_automation('Deals', 'Manager Approval notifies the manager', 'deal', new.id, new.deal_no, 'done',
                           case when new.manager_id is null then 'Everyone who can approve deals was notified' else 'Manager notified' end);
  elsif new.status = 'reconsider' then
    perform log_automation('Deals', 'Reconsider notifies the owner', 'deal', new.id, new.deal_no,
                           case when new.owner_id is null then 'skipped' else 'done' end,
                           case when new.owner_id is null then 'The deal has no owner' else 'Owner notified' end);
  elsif new.status = 'approved' then
    select sc_no into sno from sales_confirmations where deal_id = new.id order by created_at limit 1;
    perform log_automation('Deals', 'Approved creates the Sales Confirmation', 'deal', new.id, new.deal_no,
                           case when sno is null then 'skipped' else 'done' end,
                           case when sno is null then 'No Sales Confirmation was created' else 'Sales Confirmation ' || sno || ' created' end);
  end if;
  return null;
end $$;
drop trigger if exists trg_crm_deals_zz_log on public.crm_deals;
create trigger trg_crm_deals_zz_log after update of status on public.crm_deals
  for each row execute function public.crm_log_deals();

create or replace function public.crm_log_sc() returns trigger
language plpgsql security definer set search_path = public as $$
declare items text;
begin
  if new.stage = 'send_delivery' and old.stage is distinct from 'send_delivery' then
    select string_agg(order_no, ', ' order by order_no) into items from orders where sales_confirmation_id = new.id and status <> 'cancelled';
    perform log_automation('Sales Confirmation', 'Send with Delivery Info creates Dispatch and Billing', 'sales_confirmation', new.id, new.sc_no,
                           case when items is null then 'skipped' else 'done' end,
                           case when items is null then 'No item was created' else 'Items: ' || items end);
  end if;
  return null;
end $$;
drop trigger if exists trg_sc_zz_log on public.sales_confirmations;
create trigger trg_sc_zz_log after update of stage on public.sales_confirmations
  for each row execute function public.crm_log_sc();

create or replace function public.crm_log_orders_duplicate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_duplicate and (tg_op = 'INSERT' or not old.is_duplicate) then
    perform log_automation('Dispatch and Billing', 'Duplicate Invoice No. check', 'order', new.id, new.order_no, 'done',
                           coalesce(new.duplication_error, 'Flagged as a duplicate invoice'));
  end if;
  return null;
end $$;
drop trigger if exists trg_orders_zz_log_duplicate on public.orders;
create trigger trg_orders_zz_log_duplicate after insert or update of is_duplicate on public.orders
  for each row execute function public.crm_log_orders_duplicate();

-- =====================================================================
-- grants: none of these are callable over the API
-- =====================================================================
do $$
declare f text;
begin
  foreach f in array array['log_automation(text,text,text,uuid,text,text,text,text)', 'leads_weaving_no_disqualify()',
                           'run_crm_rules(timestamptz)', 'orders_mill_invoice_task()', 'dispatch_tasks()',
                           'crm_log_leads()', 'crm_log_deals()', 'crm_log_sc()', 'crm_log_orders_duplicate()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant all on function public.%s to service_role', f);
  end loop;
end $$;

commit;
