-- Tasks module, monday parity (part 4): typed board views, subitems, the
-- automations monday had that the module did not, and monday's own words in
-- the reminders.
--
-- The tasks table stays the engine (timeline, notifications, proof, payment
-- lines, permissions all hang off tasks.id). Each monday board gets a typed
-- VIEW over it, with monday's column names, mirrors (buyer messenger, supplier
-- name, invoice number from the dispatch...), formulas (balance, days aging,
-- feedback due) and the links between boards (visit <-> payment collection...).
-- Views use security_invoker, so row-level security of tasks still decides who
-- sees what. Nothing here imports monday data.
--
-- Safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. Subitems (monday's Payment Collection and Cheque Collection boards carry
--    the default subitem columns: Name, Owner, Status, Date)
-- ---------------------------------------------------------------------------

create table if not exists public.task_subitems (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  name       text not null check (btrim(name) <> ''),
  owner_id   uuid references public.profiles (id) on delete set null,
  status     text not null default 'working_on_it' check (status in ('working_on_it', 'done', 'stuck')),
  item_date  date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists task_subitems_task_ix on public.task_subitems (task_id);

alter table public.task_subitems enable row level security;
drop policy if exists task_subitems_read on public.task_subitems;
create policy task_subitems_read on public.task_subitems for select to authenticated using (public.task_can(task_id, false));
drop policy if exists task_subitems_write on public.task_subitems;
create policy task_subitems_write on public.task_subitems for all to authenticated
  using (public.task_can(task_id, true)) with check (public.task_can(task_id, true));

-- ---------------------------------------------------------------------------
-- 2. Person from the buyer's Messenger (monday copies Messenger into Person on
--    create and whenever the buyer changes); Accounts from collection staff.
-- ---------------------------------------------------------------------------

create or replace function public.default_task_assignee(p_buyer uuid)
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(b.messenger_id, b.collection_staff_id, b.sales_person_id)
  from buyer_master b where b.id = p_buyer
$$;
revoke execute on function public.default_task_assignee(uuid) from public, anon, authenticated;

create or replace function public.task_defaults()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if new.buyer_id is not null then
    if new.assigned_to is null and (tg_op = 'INSERT' or new.buyer_id is distinct from old.buyer_id) then
      new.assigned_to := public.default_task_assignee(new.buyer_id);
    end if;
    if new.accounts_staff_id is null and (tg_op = 'INSERT' or new.buyer_id is distinct from old.buyer_id) then
      select b.collection_staff_id into new.accounts_staff_id from buyer_master b where b.id = new.buyer_id;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.task_defaults() from public, anon, authenticated;

drop trigger if exists trg_task_defaults on public.tasks;
create trigger trg_task_defaults before insert or update of buyer_id on public.tasks
  for each row execute function public.task_defaults();

-- ---------------------------------------------------------------------------
-- 3. One typed view per monday board
-- ---------------------------------------------------------------------------

-- Monthly Visit
create or replace view public.board_monthly_visit with (security_invoker = true) as
select
  t.id,
  t.task_no                                              as item_no,
  t.title                                                as name,
  t.status,
  t.assigned_to                                          as person_id,
  pe.name                                                as person,
  t.accounts_staff_id                                    as accounts_id,
  ac.name                                                as accounts,
  t.buyer_id,
  b.name                                                 as buyers_name,
  mp.name                                                as buyer_messenger,
  t.start_date                                           as created_date,
  case when (t.details->>'visited_on') ~ '^\d{4}-\d{2}-\d{2}$' then (t.details->>'visited_on')::date end as visited_date,
  t.lat, t.lng,
  t.check_in_at                                          as check_in_time,
  t.check_out_at                                         as check_out_time,
  t.details->>'visit_summary'                            as meeting_summary,
  coalesce((t.details->>'pending_payment')::boolean, false) as pending_payment,
  case coalesce(t.details->>'visit_status', 'planned')
    when 'visited' then 'Visited' when 'completed' then 'Completed' else 'Not Visited' end as visited_not_visited,
  (select pc.id from public.tasks pc where pc.source_task_id = t.id and pc.task_type = 'payment_collection'
    order by pc.created_at limit 1)                      as payment_collection_id,
  t.due_date,
  t.created_at
from public.tasks t
left join public.profiles pe on pe.id = t.assigned_to
left join public.profiles ac on ac.id = t.accounts_staff_id
left join public.buyer_master b on b.id = t.buyer_id
left join public.profiles mp on mp.id = b.messenger_id
where t.task_type = 'monthly_visit';

-- Mill Invoice Delivery
create or replace view public.board_mill_invoice_delivery with (security_invoker = true) as
select
  t.id,
  t.task_no                                              as item_no,
  t.title                                                as name,
  case t.status when 'blocked' then 'Stuck' when 'done' then 'Done' else 'Working on it' end as status,
  t.assigned_to                                          as person_id,
  pe.name                                                as people,
  t.accounts_staff_id                                    as accounts_id,
  ac.name                                                as accounts,
  t.buyer_id,
  b.name                                                 as buyers,
  mp.name                                                as buyer_messenger,
  t.supplier_id,
  s.name                                                 as supplier_name,
  sp.name                                                as supplier_messenger,
  coalesce(d.mill_invoice_no, t.details->>'invoice_no')  as invoice_number,
  coalesce(d.mill_invoice_date,
           case when (t.details->>'invoice_date') ~ '^\d{4}-\d{2}-\d{2}$' then (t.details->>'invoice_date')::date end) as invoice_date,
  t.amount                                               as invoice_amount,
  case t.details->>'delivery_mode' when 'hand' then 'Hand' when 'courier' then 'Courier' end as delivery_mode,
  (select count(*) from public.task_attachments a where a.task_id = t.id) as delivery_proof_count,
  t.lat, t.lng,
  t.dispatch_id                                          as dispatch_and_billing_id,
  case coalesce(t.details->>'delivery_status', 'not_delivered') when 'delivered' then 'Delivered' else 'Not Delivered' end as invoice_status,
  t.due_date,
  t.created_at
from public.tasks t
left join public.profiles pe on pe.id = t.assigned_to
left join public.profiles ac on ac.id = t.accounts_staff_id
left join public.buyer_master b on b.id = t.buyer_id
left join public.profiles mp on mp.id = b.messenger_id
left join public.supplier_master s on s.id = t.supplier_id
left join public.profiles sp on sp.id = s.messenger_id
left join public.order_dispatches d on d.id = t.dispatch_id
where t.task_type = 'mill_invoice_delivery';

-- Commission Invoice Delivery
create or replace view public.board_commission_invoice_delivery with (security_invoker = true) as
select
  t.id,
  t.task_no                                              as item_no,
  t.title                                                as name,
  t.assigned_to                                          as person_id,
  pe.name                                                as people,
  t.accounts_staff_id                                    as accounts_id,
  ac.name                                                as accounts,
  t.commission_invoice_id                                as commission_invoice_id,
  coalesce(ci.amount, t.amount)                          as commission_amount,
  t.buyer_id,
  b.name                                                 as buyer,
  mp.name                                                as buyer_messenger,
  coalesce(ci.invoice_no, t.details->>'invoice_no')      as commission_invoice_no,
  coalesce(ci.invoice_date,
           case when (t.details->>'invoice_date') ~ '^\d{4}-\d{2}-\d{2}$' then (t.details->>'invoice_date')::date end) as invoice_date,
  case t.details->>'acknowledgement' when 'yes' then 'Yes' when 'no' then 'No' end as acknowledgement_received,
  (select count(*) from public.task_attachments a where a.task_id = t.id) as photo_upload_count,
  t.lat, t.lng,
  case when coalesce((t.details->>'pending_payment')::boolean, false) then 'Yes' else 'No' end as pending_payment_status,
  t.start_date                                           as created_date,
  (select pc.id from public.tasks pc where pc.source_task_id = t.id and pc.task_type = 'payment_collection'
    order by pc.created_at limit 1)                      as payment_collection_id,
  t.status, t.due_date, t.created_at
from public.tasks t
left join public.profiles pe on pe.id = t.assigned_to
left join public.profiles ac on ac.id = t.accounts_staff_id
left join public.buyer_master b on b.id = t.buyer_id
left join public.profiles mp on mp.id = b.messenger_id
left join public.commission_invoices ci on ci.id = t.commission_invoice_id
where t.task_type = 'commission_invoice_delivery';

-- Payment Collection (balance and days aging are monday's two formulas)
create or replace view public.board_payment_collection with (security_invoker = true) as
select
  t.id,
  t.task_no                                              as item_no,
  t.title                                                as name,
  t.assigned_to                                          as person_id,
  pe.name                                                as person,
  t.accounts_staff_id                                    as accounts_id,
  ac.name                                                as accounts,
  t.source_task_id                                       as connected_task_id,
  case src.task_type when 'monthly_visit' then 'Monthly Visit'
                     when 'commission_invoice_delivery' then 'Commission Invoice Delivery' end as connected_board,
  t.buyer_id,
  b.name                                                 as buyer_name,
  t.details->>'invoice_no'                               as invoice_number,
  t.amount,
  t.amount_collected,
  case t.mode when 'online' then 'Online' when 'cash' then 'Cash' when 'cheque' then 'Cheque' else initcap(t.mode) end as mode_of_payment,
  (select count(*) from public.task_attachments a where a.task_id = t.id) as payment_proof_count,
  t.amount - t.amount_collected                          as balance_amount,
  t.lat, t.lng,
  case when t.status = 'done' or (t.amount > 0 and t.amount_collected >= t.amount) then 'Completed' else 'Outstanding' end as payment_status,
  t.start_date,
  (t.completed_at at time zone 'Asia/Kolkata')::date     as end_date,
  coalesce((t.completed_at at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date) - t.start_date as days_aging,
  t.status, t.priority, t.due_date, t.created_at
from public.tasks t
left join public.profiles pe on pe.id = t.assigned_to
left join public.profiles ac on ac.id = t.accounts_staff_id
left join public.buyer_master b on b.id = t.buyer_id
left join public.tasks src on src.id = t.source_task_id
where t.task_type = 'payment_collection';

-- Transport Freight Invoice
create or replace view public.board_freight_invoice with (security_invoker = true) as
select
  t.id,
  t.task_no                                              as item_no,
  t.title                                                as name,
  t.assigned_to                                          as person_id,
  pe.name                                                as person,
  t.accounts_staff_id                                    as accounts_id,
  ac.name                                                as accounts,
  t.dispatch_id                                          as transport_invoice_id,
  t.buyer_id,
  b.name                                                 as buyer,
  t.details->>'bill_no'                                  as transport_bill_no,
  t.amount                                               as transport_amount,
  t.details->>'load_reference'                           as load_reference,
  (select count(*) from public.task_attachments a where a.task_id = t.id) as delivery_proof_count,
  t.lat, t.lng,
  case t.details->>'received' when 'yes' then 'Yes' when 'no' then 'No' end as status,
  case coalesce(t.details->>'check_status', 'outstanding') when 'cleared' then 'Cleared' else 'Outstanding' end as "check",
  t.due_date, t.created_at
from public.tasks t
left join public.profiles pe on pe.id = t.assigned_to
left join public.profiles ac on ac.id = t.accounts_staff_id
left join public.buyer_master b on b.id = t.buyer_id
where t.task_type = 'freight_bill_check';

-- Sample Delivery - Comes From Mills (Feedback Due Date = Delivery Date + 7)
create or replace view public.board_sample_delivery with (security_invoker = true) as
select
  t.id,
  t.task_no                                              as item_no,
  t.title                                                as name,
  t.assigned_to                                          as person_id,
  pe.name                                                as person,
  t.accounts_staff_id                                    as accounts_id,
  ac.name                                                as accounts,
  t.buyer_id,
  b.name                                                 as buyer,
  mp.name                                                as buyer_messenger,
  t.supplier_id,
  s.name                                                 as supplier,
  sp.name                                                as supplier_messenger,
  t.details->>'sample_quality'                           as sample_quality,
  t.details->>'sample_type'                              as sample_type,
  t.details->>'sample_lot'                               as sample_lot,
  dd.delivery_date,
  dd.delivery_date + 7                                   as feedback_due_date,
  case coalesce(t.details->>'feedback_status', 'pending') when 'approved' then 'Approved' when 'rejected' then 'Rejected' else 'Pending' end as feedback_status,
  t.lat, t.lng,
  (select count(*) from public.task_attachments a where a.task_id = t.id) as photo_proof_count,
  t.due_date, t.created_at
from public.tasks t
left join public.profiles pe on pe.id = t.assigned_to
left join public.profiles ac on ac.id = t.accounts_staff_id
left join public.buyer_master b on b.id = t.buyer_id
left join public.profiles mp on mp.id = b.messenger_id
left join public.supplier_master s on s.id = t.supplier_id
left join public.profiles sp on sp.id = s.messenger_id
cross join lateral (select case when (t.details->>'delivery_date') ~ '^\d{4}-\d{2}-\d{2}$' then (t.details->>'delivery_date')::date end as delivery_date) dd
where t.task_type = 'sample_delivery';

-- Cheque Collection (monday's groups: To Collect, In Progress, Collected)
create or replace view public.board_cheque_collection with (security_invoker = true) as
select
  c.id,
  coalesce(t.title, c.cheque_no)                         as name,
  t.accounts_staff_id                                    as accounts_id,
  ac.name                                                as accounts,
  coalesce(t.assigned_to, c.collected_by)                as person_id,
  pe.name                                                as person,
  c.buyer_id,
  b.name                                                 as buyer_name,
  c.invoice_no                                           as invoice_number,
  c.cheque_no                                            as cheque_number,
  c.bank_name,
  c.cheque_date,
  c.amount                                               as cheque_amount,
  c.photo_path,
  case c.status when 'pending' then 'Pending' when 'collected' then 'Collected' when 'deposited' then 'Deposited'
                when 'cleared' then 'Cleared' else 'Bounced' end as deposit_status,
  case c.status when 'pending' then 'To Collect' when 'deposited' then 'In Progress' else 'Collected' end as group_name,
  c.notes,
  (select count(*) from public.task_subitems s where s.task_id = c.task_id) as subitems,
  t.lat, t.lng,
  c.task_id,
  c.created_at
from public.task_cheques c
left join public.tasks t on t.id = c.task_id
left join public.profiles ac on ac.id = t.accounts_staff_id
left join public.profiles pe on pe.id = coalesce(t.assigned_to, c.collected_by)
left join public.buyer_master b on b.id = c.buyer_id;

grant select on
  public.board_monthly_visit, public.board_mill_invoice_delivery, public.board_commission_invoice_delivery,
  public.board_payment_collection, public.board_freight_invoice, public.board_sample_delivery, public.board_cheque_collection
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Automations monday had that the module did not
-- ---------------------------------------------------------------------------

-- Freight bill: when Check becomes Outstanding, tell Person and Accounts
-- ("The payment for {name} is Outstanding").
create or replace function public.freight_check_notify()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare w uuid; who text;
begin
  if new.task_type <> 'freight_bill_check' then return null; end if;
  if coalesce(new.details->>'check_status', '') <> 'outstanding' then return null; end if;
  if tg_op = 'UPDATE' and coalesce(old.details->>'check_status', '') = 'outstanding' then return null; end if;
  for w in select * from public.task_watchers(new.id) loop
    select name into who from profiles where id = w;
    perform public.notify_user(w, 'freight_outstanding', 'warning', new.title,
      'Hey, ' || coalesce(who, '') || ', The payment for ' || new.title || ' is Outstanding',
      '/tasks?task=' || new.id, new.id, 'freight_out:' || new.id || ':' || w);
  end loop;
  return null;
end $$;
revoke execute on function public.freight_check_notify() from public, anon, authenticated;

drop trigger if exists trg_freight_check_notify on public.tasks;
create trigger trg_freight_check_notify after insert or update of details on public.tasks
  for each row execute function public.freight_check_notify();

-- Cheque: when the photo makes it Collected, tell Accounts ("Your Check for
-- {name} is Collected").
create or replace function public.cheque_collected_notify()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare t tasks;
begin
  if new.status <> 'collected' then return null; end if;
  if tg_op = 'UPDATE' and old.status = 'collected' then return null; end if;
  if new.task_id is null then return null; end if;
  select * into t from tasks where id = new.task_id;
  if not found or t.accounts_staff_id is null then return null; end if;
  perform public.notify_user(t.accounts_staff_id, 'cheque_collected', 'info', coalesce(t.title, new.cheque_no),
    'Your Check for ' || coalesce(t.title, new.cheque_no) || ' is Collected',
    '/tasks?task=' || t.id, t.id, 'chq_collected:' || new.id);
  return null;
end $$;
revoke execute on function public.cheque_collected_notify() from public, anon, authenticated;

drop trigger if exists trg_cheque_collected_notify on public.task_cheques;
create trigger trg_cheque_collected_notify after insert or update of status on public.task_cheques
  for each row execute function public.cheque_collected_notify();

-- ---------------------------------------------------------------------------
-- 5. Rules: monday's wording, and the visit branches
-- ---------------------------------------------------------------------------

insert into public.task_rules (rule_key, label, task_type, kind, config) values
  ('visit_visited_reminder', 'Visited, payment not collected after 30 days', 'monthly_visit', 'reminder', '{"after_days": 30}')
on conflict (rule_key) do nothing;

create or replace function public.run_task_rules(p_now timestamptz default now())
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  today date := (p_now at time zone 'Asia/Kolkata')::date;
  r task_rules;
  tk tasks;
  ex tasks;
  w uuid;
  d int;
  base date;
  n int;
  grace int;
  buyer_name text;
  who text;
  visited boolean;
  step_priority text;
  created_tasks int := 0;
  raised int := 0;
begin
  ---------------------------------------------------------------- overdue
  select * into r from task_rules where rule_key = 'overdue_task' and is_active;
  if found then
    grace := coalesce((r.config->>'after_days')::int, 0);
    for tk in select * from tasks where status in ('todo', 'in_progress', 'blocked') and assigned_to is not null and due_date < today - grace loop
      perform public.notify_user(tk.assigned_to, 'task_overdue', 'critical', 'Overdue: ' || tk.title,
        tk.task_no || ' was due ' || to_char(tk.due_date, 'DD Mon YYYY'), '/tasks?task=' || tk.id, tk.id, 'overdue:' || tk.id);
      raised := raised + 1;
    end loop;
  end if;

  ---------------------------------------------------------------- visit not done: "You have not visited yet."
  select * into r from task_rules where rule_key = 'visit_not_visited' and is_active;
  if found then
    grace := coalesce((r.config->>'after_days')::int, 0);
    for tk in select * from tasks
      where task_type = 'monthly_visit' and status in ('todo', 'blocked') and assigned_to is not null
        and coalesce(details->>'visit_status', 'planned') = 'planned' and due_date <= today - grace loop
      select name into who from profiles where id = tk.assigned_to;
      perform public.notify_user(tk.assigned_to, 'visit_missed', 'warning', tk.title,
        'Hey, ' || coalesce(who, '') || ', You have not visited yet.', '/tasks?task=' || tk.id, tk.id, 'visit_missed:' || tk.id);
      raised := raised + 1;
    end loop;
  end if;

  ---------------------------------------------------------------- visited, 30 days on, payment not collected
  select * into r from task_rules where rule_key = 'visit_visited_reminder' and is_active;
  if found then
    grace := coalesce((r.config->>'after_days')::int, 30);
    for tk in select * from tasks
      where task_type = 'monthly_visit' and status <> 'cancelled' and assigned_to is not null
        and coalesce(details->>'visit_status', 'planned') in ('visited', 'completed')
        and coalesce((details->>'pending_payment')::boolean, false)
        and coalesce(case when (details->>'visited_on') ~ '^\d{4}-\d{2}-\d{2}$' then (details->>'visited_on')::date end,
                     (check_in_at at time zone 'Asia/Kolkata')::date, start_date) + grace <= today loop
      select name into who from profiles where id = tk.assigned_to;
      perform public.notify_user(tk.assigned_to, 'visit_unpaid', 'warning', tk.title,
        'Hey, ' || coalesce(who, '') || ', you have visited and not collect the payment.', '/tasks?task=' || tk.id, tk.id, 'visit_unpaid:' || tk.id);
      raised := raised + 1;
    end loop;
  end if;

  ---------------------------------------------------------------- sample feedback: "The sample {name} feedback is due."
  select * into r from task_rules where rule_key = 'sample_feedback_due' and is_active;
  if found then
    grace := coalesce((r.config->>'after_days')::int, 7);
    for tk in select * from tasks
      where task_type = 'sample_delivery' and status <> 'cancelled'
        and coalesce(details->>'feedback_status', 'pending') = 'pending'
        and (details->>'delivery_date') ~ '^\d{4}-\d{2}-\d{2}$'
        and (details->>'delivery_date')::date + grace <= today loop
      for w in select * from public.task_watchers(tk.id) loop
        select name into who from profiles where id = w;
        perform public.notify_user(w, 'sample_feedback_due', 'warning', tk.title,
          'Hey, ' || coalesce(who, '') || ', The sample ' || tk.title || ' feedback is due.', '/tasks?task=' || tk.id, tk.id, 'feedback:' || tk.id || ':' || w);
      end loop;
      raised := raised + 1;
    end loop;
  end if;

  ---------------------------------------------------------------- unpaid after a visit or a delivery
  for r in select * from task_rules where kind = 'escalation' and is_active and task_type is not null loop
    for tk in select * from tasks
      where task_type = r.task_type and status <> 'cancelled'
        and coalesce((details->>'pending_payment')::boolean, false) loop

      -- Counted from the day the visit happened (or the task began).
      base := coalesce((tk.check_in_at at time zone 'Asia/Kolkata')::date,
                       case when (tk.details->>'visited_on') ~ '^\d{4}-\d{2}-\d{2}$' then (tk.details->>'visited_on')::date end,
                       tk.start_date);
      visited := coalesce(tk.details->>'visit_status', 'planned') in ('visited', 'completed') or tk.check_in_at is not null;

      for d in select (jsonb_array_elements_text(r.config->'days'))::int order by 1 loop
        if today < base + d then continue; end if;

        -- A step that has already been taken is skipped.
        insert into task_events (task_id, kind, to_value, note, dedupe_key)
        values (tk.id, 'escalation', d::text, 'Payment still pending after ' || d || ' days', 'esc:' || tk.id || ':' || d)
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
        get diagnostics n = row_count;
        if n = 0 then continue; end if;

        step_priority := case when d >= 60 then 'urgent' when d >= 45 then 'high' else 'normal' end;
        select name into buyer_name from buyer_master where id = tk.buyer_id;

        -- One open follow-up per buyer: a later step raises its priority instead
        -- of opening a duplicate.
        select * into ex from tasks
          where task_type = 'payment_collection' and buyer_id is not distinct from tk.buyer_id
            and status in ('todo', 'in_progress', 'blocked') and coalesce((details->>'escalation')::boolean, false)
          order by created_at limit 1;

        if found then
          update tasks set priority = case when step_priority = 'urgent' or priority = 'urgent' then 'urgent'
                                           when step_priority = 'high' or priority = 'high' then 'high' else priority end
            where id = ex.id;
          perform public.task_log(ex.id, 'escalation', null, d::text, 'Still unpaid after ' || d || ' days (' || tk.task_no || ')', null, 'escseen:' || ex.id || ':' || tk.id || ':' || d);
        else
          insert into tasks (task_type, title, due_date, priority, assigned_to, accounts_staff_id, buyer_id, supplier_id, order_id, source_task_id, amount, details, dedupe_key)
          values ('payment_collection',
                  case tk.task_type when 'monthly_visit' then 'Monthly Visit' when 'commission_invoice_delivery' then 'Commission Invoice' else 'Task' end
                    || ' - ' || tk.title,
                  today, step_priority, tk.assigned_to, tk.accounts_staff_id, tk.buyer_id, tk.supplier_id, tk.order_id, tk.id, coalesce(tk.amount, 0),
                  jsonb_build_object('escalation', true, 'step_days', d), 'esc:' || tk.id || ':' || d)
          on conflict (dedupe_key) do nothing
          returning * into ex;
          if ex.id is not null then created_tasks := created_tasks + 1; end if;
        end if;

        for w in select * from public.task_watchers(tk.id) loop
          select name into who from profiles where id = w;
          perform public.notify_user(w, 'payment_escalation', 'critical',
            case when tk.task_type = 'commission_invoice_delivery' then tk.title
                 else 'Payment still pending after ' || d || ' days: ' || coalesce(buyer_name, tk.title) end,
            case when tk.task_type = 'commission_invoice_delivery'
                   then 'Hey, ' || coalesce(who, '') || ', Payment is pending for this record.'
                 when visited
                   then 'Hey, ' || coalesce(who, '') || ', you have visited and not collected the payment after ' || d || ' days'
                 else 'Hey, ' || coalesce(who, '') || ', you have not visited and not collected the payment after ' || d || ' days' end,
            '/tasks?task=' || coalesce(ex.id, tk.id), tk.id, 'esc:' || tk.id || ':' || d || ':' || w);
        end loop;
        raised := raised + 1;
        ex := null;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('as_of', today, 'notifications_raised', raised, 'tasks_created', created_tasks);
end $$;
revoke execute on function public.run_task_rules(timestamptz) from public, anon, authenticated;
