-- Tasks module, part 1: tables, rules of the road, permissions, storage.
--
-- One task store for the field work monday.com tracked on seven boards (mill
-- invoice delivery, commission invoice delivery, payment collection, cheque
-- collection, freight bill check, sample delivery, monthly visit), replacing
-- collection_tasks and cheque_collections (archived in part 2).
--
-- Standalone: nothing here imports monday data. Part 2 moves the app's own
-- open collection tasks and cheques across; part 3 adds the scheduled rules.

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------

insert into public.permission_catalogue (key, label, group_name, hint, dangerous, sort_order) values
  ('task.read',    'See all tasks',            'Tasks', 'See every task, not only the ones assigned to or created by you.', false, 60),
  ('task.work',    'Work on assigned tasks',   'Tasks', 'Update the status of your own tasks, add proof photos, check in and record payments collected.', false, 61),
  ('task.manage',  'Create and manage tasks',  'Tasks', 'Create, assign, edit, reopen and delete tasks, and edit the reminder rules.', false, 62),
  ('message.send', 'Send messages',            'Tasks', 'Send WhatsApp and e-mail messages from a task or record.', false, 63),
  ('message.view', 'See the message log',      'Tasks', 'See every message the system has sent or received.', false, 64)
on conflict (key) do nothing;

-- Anyone who could work collection tasks before keeps working them: order.manage
-- becomes task.manage + task.work + task.read, order.read becomes task.read.
insert into public.user_permissions (user_id, permission, granted_by)
select u.user_id, p.perm, null
from public.user_permissions u
join (values ('order.manage', 'task.manage'), ('order.manage', 'task.work'), ('order.manage', 'task.read'),
             ('order.manage', 'message.send'), ('order.read', 'task.read')) as p(src, perm) on p.src = u.permission
where not exists (select 1 from public.user_permissions x where x.user_id = u.user_id and x.permission = p.perm);

-- ---------------------------------------------------------------------------
-- 2. Task types (configuration)
-- ---------------------------------------------------------------------------

create table if not exists public.task_types (
  key               text primary key,
  label             text not null,
  view_key          text not null,
  requires_proof    boolean not null default false,
  requires_gps      boolean not null default false,
  auto_done_on_proof boolean not null default false,
  default_due_days  integer not null default 3 check (default_due_days >= 0),
  sort_order        integer not null default 0,
  is_active         boolean not null default true
);

insert into public.task_types (key, label, view_key, requires_proof, requires_gps, auto_done_on_proof, default_due_days, sort_order) values
  ('mill_invoice_delivery',       'Mill invoice delivery',       'mill',       true,  true,  true,  2, 10),
  ('commission_invoice_delivery', 'Commission invoice delivery', 'commission', true,  true,  true,  2, 20),
  ('payment_collection',          'Payment collection',          'payments',   false, false, false, 7, 30),
  ('cheque_collection',           'Cheque collection',           'cheques',    true,  true,  false, 3, 40),
  ('freight_bill_check',          'Freight bill check',          'freight',    true,  false, false, 5, 50),
  ('sample_delivery',             'Sample delivery',             'samples',    true,  true,  false, 3, 60),
  ('monthly_visit',               'Monthly visit',               'visits',     false, true,  false, 30, 70),
  ('payment_deposit',             'Payment deposit',             'payments',   false, false, false, 2, 80),
  ('delivery_note',               'Delivery note',               'mill',       false, false, false, 2, 90),
  ('mill_payment_deposit',        'Mill payment deposit',        'payments',   false, false, false, 2, 100),
  ('follow_up',                   'Follow-up',                   'other',      false, false, false, 3, 110)
on conflict (key) do nothing;

alter table public.task_types enable row level security;
create policy task_types_read on public.task_types for select to authenticated using (true);
create policy task_types_write on public.task_types for all to authenticated
  using (public.has_permission('task.manage')) with check (public.has_permission('task.manage'));

-- ---------------------------------------------------------------------------
-- 3. Tasks
-- ---------------------------------------------------------------------------

create sequence if not exists public.task_seq;

create table if not exists public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  task_no               text unique,
  task_type             text not null references public.task_types (key),
  title                 text not null check (btrim(title) <> ''),
  status                text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority              text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date              date not null default ((now() at time zone 'Asia/Kolkata')::date),
  start_date            date not null default ((now() at time zone 'Asia/Kolkata')::date),
  assigned_to           uuid references public.profiles (id) on delete set null,
  accounts_staff_id     uuid references public.profiles (id) on delete set null,
  buyer_id              uuid references public.buyer_master (id) on delete set null,
  supplier_id           uuid references public.supplier_master (id) on delete set null,
  order_id              uuid references public.orders (id) on delete set null,
  dispatch_id           uuid references public.order_dispatches (id) on delete set null,
  commission_invoice_id uuid references public.commission_invoices (id) on delete set null,
  transporter_id        uuid references public.transporters (id) on delete set null,
  source_task_id        uuid references public.tasks (id) on delete set null,
  amount                numeric(14,2) not null default 0 check (amount >= 0),
  amount_collected      numeric(14,2) not null default 0 check (amount_collected >= 0),
  mode                  text check (mode is null or mode in ('online', 'cash', 'cheque', 'neft', 'upi', 'rtgs', 'cards')),
  notes                 text,
  check_in_at           timestamptz,
  check_out_at          timestamptz,
  lat                   numeric(9,6) check (lat is null or lat between -90 and 90),
  lng                   numeric(9,6) check (lng is null or lng between -180 and 180),
  accuracy_m            numeric(8,1),
  completed_at          timestamptz,
  completed_by          uuid references public.profiles (id) on delete set null,
  details               jsonb not null default '{}'::jsonb,
  dedupe_key            text unique,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists tasks_status_due_ix on public.tasks (status, due_date);
create index if not exists tasks_assignee_ix on public.tasks (assigned_to, status);
create index if not exists tasks_type_ix on public.tasks (task_type, status);
create index if not exists tasks_buyer_ix on public.tasks (buyer_id);
create index if not exists tasks_order_ix on public.tasks (order_id);
create index if not exists tasks_source_ix on public.tasks (source_task_id);

-- Values the free-form `details` column may carry, checked per field so a typo
-- cannot slip a task into a state no screen knows how to show.
create or replace function public.task_details_problem(p_type text, p_details jsonb)
returns text
language plpgsql immutable
set search_path to 'public'
as $$
begin
  if jsonb_typeof(p_details) is distinct from 'object' then return 'Details must be an object'; end if;
  if p_details ? 'delivery_mode' and (p_details->>'delivery_mode') not in ('hand', 'courier') then return 'Delivery mode must be hand or courier'; end if;
  if p_details ? 'delivery_status' and (p_details->>'delivery_status') not in ('not_delivered', 'delivered') then return 'Delivery status must be not_delivered or delivered'; end if;
  if p_details ? 'acknowledgement' and (p_details->>'acknowledgement') not in ('yes', 'no') then return 'Acknowledgement must be yes or no'; end if;
  if p_details ? 'check_status' and (p_details->>'check_status') not in ('outstanding', 'cleared') then return 'Check status must be outstanding or cleared'; end if;
  if p_details ? 'feedback_status' and (p_details->>'feedback_status') not in ('pending', 'approved', 'rejected') then return 'Feedback status must be pending, approved or rejected'; end if;
  if p_details ? 'visit_status' and (p_details->>'visit_status') not in ('planned', 'visited', 'completed', 'missed') then return 'Visit status must be planned, visited, completed or missed'; end if;
  if p_details ? 'received' and (p_details->>'received') not in ('yes', 'no') then return 'Received must be yes or no'; end if;
  if p_details ? 'invoice_date' and (p_details->>'invoice_date') !~ '^\d{4}-\d{2}-\d{2}$' then return 'Invoice date must be YYYY-MM-DD'; end if;
  if p_details ? 'visited_on' and (p_details->>'visited_on') !~ '^\d{4}-\d{2}-\d{2}$' then return 'Visited date must be YYYY-MM-DD'; end if;
  if p_details ? 'pending_payment' and jsonb_typeof(p_details->'pending_payment') <> 'boolean' then return 'Pending payment must be true or false'; end if;
  if p_details ? 'delivery_date' and (p_details->>'delivery_date') !~ '^\d{4}-\d{2}-\d{2}$' then return 'Delivery date must be YYYY-MM-DD'; end if;
  return null;
end $$;

create or replace function public.task_guard()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare problem text; staff boolean := auth.uid() is not null and public.has_permission('task.manage'); system boolean := auth.uid() is null;
begin
  new.title := btrim(new.title);
  problem := public.task_details_problem(new.task_type, new.details);
  if problem is not null then raise exception '%', problem; end if;

  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if not exists (select 1 from profiles where id = new.assigned_to and is_active) then raise exception 'The task can only be assigned to an active user'; end if;
  end if;

  if tg_op = 'INSERT' then
    new.task_no := 'TASK-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.task_seq')::text, 4, '0');
    if not system then new.created_by := auth.uid(); new.created_at := now(); end if;
    if new.status in ('done', 'cancelled') then raise exception 'A new task must start as To do or In progress'; end if;
    new.completed_at := null; new.completed_by := null;
    new.amount_collected := 0;
    if not system and not staff and new.assigned_to is distinct from auth.uid() then
      raise exception 'You can only create tasks assigned to yourself';
    end if;
  else
    new.task_no := old.task_no; new.created_by := old.created_by; new.created_at := old.created_at;
    if new.task_type is distinct from old.task_type then raise exception 'A task cannot change its type'; end if;

    -- Money only moves through task_payments.
    if new.amount_collected is distinct from old.amount_collected and coalesce(current_setting('app.task_payment', true), '') <> '1' then
      raise exception 'Record a payment instead of editing the amount collected';
    end if;

    -- Someone working their own task may move it along, add notes, details,
    -- location and a mode of payment; the rest is for people who manage tasks.
    if not system and not staff then
      if new.title is distinct from old.title or new.due_date is distinct from old.due_date or new.start_date is distinct from old.start_date
         or new.assigned_to is distinct from old.assigned_to or new.accounts_staff_id is distinct from old.accounts_staff_id
         or new.buyer_id is distinct from old.buyer_id or new.supplier_id is distinct from old.supplier_id
         or new.order_id is distinct from old.order_id or new.dispatch_id is distinct from old.dispatch_id
         or new.commission_invoice_id is distinct from old.commission_invoice_id or new.transporter_id is distinct from old.transporter_id
         or new.source_task_id is distinct from old.source_task_id or new.amount is distinct from old.amount
         or new.priority is distinct from old.priority or new.dedupe_key is distinct from old.dedupe_key then
        raise exception 'Your account can update the status, notes and details of a task, not its assignment or amounts';
      end if;
      if old.status in ('done', 'cancelled') and new.status is distinct from old.status then
        raise exception 'A completed or cancelled task can only be reopened by someone who manages tasks';
      end if;
    end if;

    if new.status = 'done' and old.status is distinct from 'done' then
      if not system and not staff
         and coalesce((select requires_proof from task_types where key = new.task_type), false)
         and not exists (select 1 from task_attachments a where a.task_id = new.id) then
        raise exception 'Upload the proof before completing this task';
      end if;
      new.completed_at := now(); new.completed_by := auth.uid();
    elsif new.status = 'done' then
      new.completed_at := old.completed_at; new.completed_by := old.completed_by;
    else
      new.completed_at := null; new.completed_by := null;
    end if;
  end if;

  if new.check_out_at is not null and new.check_in_at is not null and new.check_out_at < new.check_in_at then
    raise exception 'The check-out time cannot be before the check-in time';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_task_guard on public.tasks;
create trigger trg_task_guard before insert or update on public.tasks
  for each row execute function public.task_guard();

-- ---------------------------------------------------------------------------
-- 4. Who may see and change a task
-- ---------------------------------------------------------------------------

create or replace function public.task_can(p_task uuid, p_write boolean default false)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from tasks t
    where t.id = p_task and (
      case when p_write
        then public.has_permission('task.manage')
             or (public.has_permission('task.work') and (t.assigned_to = auth.uid() or t.accounts_staff_id = auth.uid()))
        else public.has_permission('task.read') or public.has_permission('task.manage')
             or t.assigned_to = auth.uid() or t.accounts_staff_id = auth.uid() or t.created_by = auth.uid()
      end))
$$;

revoke execute on function public.task_can(uuid, boolean) from public, anon;
grant execute on function public.task_can(uuid, boolean) to authenticated;

alter table public.tasks enable row level security;

create policy tasks_select on public.tasks for select to authenticated
  using (public.has_permission('task.read') or public.has_permission('task.manage')
         or assigned_to = auth.uid() or accounts_staff_id = auth.uid() or created_by = auth.uid());

create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.has_permission('task.manage') or (public.has_permission('task.work') and assigned_to = auth.uid()));

create policy tasks_update on public.tasks for update to authenticated
  using (public.has_permission('task.manage')
         or (public.has_permission('task.work') and (assigned_to = auth.uid() or accounts_staff_id = auth.uid())))
  with check (public.has_permission('task.manage')
         or (public.has_permission('task.work') and (assigned_to = auth.uid() or accounts_staff_id = auth.uid())));

create policy tasks_delete on public.tasks for delete to authenticated
  using (public.has_permission('task.manage'));

-- ---------------------------------------------------------------------------
-- 5. Timeline, notifications
-- ---------------------------------------------------------------------------

create table if not exists public.task_events (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  kind        text not null check (kind in ('created', 'assigned', 'status', 'comment', 'check_in', 'check_out', 'payment', 'proof', 'message', 'escalation', 'reminder', 'system')),
  from_value  text,
  to_value    text,
  note        text,
  data        jsonb,
  dedupe_key  text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists task_events_task_ix on public.task_events (task_id, created_at);
create unique index if not exists task_events_dedupe_uq on public.task_events (dedupe_key) where dedupe_key is not null;

alter table public.task_events enable row level security;
create policy task_events_read on public.task_events for select to authenticated using (public.task_can(task_id, false));

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  severity   text not null default 'info' check (severity in ('critical', 'warning', 'info')),
  title      text not null,
  message    text,
  href       text,
  task_id    uuid references public.tasks (id) on delete cascade,
  dedupe_key text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_ix on public.notifications (user_id, read_at, created_at desc);
create unique index if not exists notifications_dedupe_uq on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_clear on public.notifications for delete to authenticated using (user_id = auth.uid());

-- Live updates for the bell.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

create or replace function public.notify_user(
  p_user uuid, p_kind text, p_severity text, p_title text, p_message text, p_href text, p_task uuid, p_dedupe text
) returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if p_user is null then return; end if;
  insert into notifications (user_id, kind, severity, title, message, href, task_id, dedupe_key)
  values (p_user, p_kind, coalesce(p_severity, 'info'), p_title, p_message, p_href, p_task, p_dedupe)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end $$;
revoke execute on function public.notify_user(uuid, text, text, text, text, text, uuid, text) from public, anon, authenticated;

-- The people who should hear about a task: whoever is assigned, the accounts
-- person, and (when neither is set) everyone who manages tasks.
create or replace function public.task_watchers(p_task uuid)
returns setof uuid
language plpgsql stable security definer
set search_path to 'public'
as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task;
  if not found then return; end if;
  if t.assigned_to is not null then return next t.assigned_to; end if;
  if t.accounts_staff_id is not null and t.accounts_staff_id is distinct from t.assigned_to then return next t.accounts_staff_id; end if;
  if t.assigned_to is null and t.accounts_staff_id is null then
    return query select p.id from profiles p
      where p.is_active and (p.is_admin or exists (select 1 from user_permissions u where u.user_id = p.id and u.permission = 'task.manage'));
  end if;
end $$;
revoke execute on function public.task_watchers(uuid) from public, anon, authenticated;

create or replace function public.task_log(p_task uuid, p_kind text, p_from text, p_to text, p_note text, p_data jsonb default null, p_dedupe text default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  insert into task_events (task_id, kind, from_value, to_value, note, data, dedupe_key, created_by)
  values (p_task, p_kind, p_from, p_to, p_note, p_data, p_dedupe, auth.uid())
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end $$;
revoke execute on function public.task_log(uuid, text, text, text, text, jsonb, text) from public, anon, authenticated;

create or replace function public.task_after()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare w uuid; actor uuid := auth.uid(); href text := '/tasks?task=' || new.id;
begin
  if tg_op = 'INSERT' then
    perform public.task_log(new.id, 'created', null, new.status, new.title);
    if new.assigned_to is not null and new.assigned_to is distinct from actor then
      perform public.notify_user(new.assigned_to, 'task_assigned', 'info', 'New task: ' || new.title, new.task_no || ' is due ' || to_char(new.due_date, 'DD Mon YYYY'), href, new.id, 'assigned:' || new.id || ':' || new.assigned_to);
    end if;
    return null;
  end if;

  if new.status is distinct from old.status then
    perform public.task_log(new.id, 'status', old.status, new.status, null);
    if new.status = 'done' then
      for w in select * from public.task_watchers(new.id) loop
        if w is distinct from actor then
          perform public.notify_user(w, 'task_done', 'info', 'Task completed: ' || new.title, new.task_no, href, new.id, 'done:' || new.id || ':' || w);
        end if;
      end loop;
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    perform public.task_log(new.id, 'assigned', old.assigned_to::text, new.assigned_to::text, null);
    if new.assigned_to is not null and new.assigned_to is distinct from actor then
      perform public.notify_user(new.assigned_to, 'task_assigned', 'info', 'Task assigned to you: ' || new.title, new.task_no || ' is due ' || to_char(new.due_date, 'DD Mon YYYY'), href, new.id, 'assigned:' || new.id || ':' || new.assigned_to);
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.task_after() from public, anon, authenticated;

drop trigger if exists trg_task_after on public.tasks;
create trigger trg_task_after after insert or update on public.tasks
  for each row execute function public.task_after();

-- ---------------------------------------------------------------------------
-- 6. Money: payment lines on a task
-- ---------------------------------------------------------------------------

create table if not exists public.task_payments (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.tasks (id) on delete cascade,
  amount           numeric(14,2) not null check (amount > 0),
  paid_on          date not null default ((now() at time zone 'Asia/Kolkata')::date),
  mode             text check (mode is null or mode in ('online', 'cash', 'cheque', 'neft', 'upi', 'rtgs', 'cards')),
  reference        text,
  notes            text,
  order_payment_id uuid references public.order_payments (id) on delete set null,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create index if not exists task_payments_task_ix on public.task_payments (task_id);

alter table public.task_payments enable row level security;
create policy task_payments_read on public.task_payments for select to authenticated using (public.task_can(task_id, false));

create or replace function public.task_payment_after()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare t tasks; o orders; oid uuid; w uuid; actor uuid := auth.uid();
begin
  select * into t from tasks where id = new.task_id for update;
  perform set_config('app.task_payment', '1', true);
  update tasks set amount_collected = amount_collected + new.amount where id = new.task_id;
  perform set_config('app.task_payment', '', true);

  perform public.task_log(new.task_id, 'payment', null, new.amount::text,
    coalesce(new.mode, 'payment') || coalesce(' ' || nullif(btrim(new.reference), ''), ''),
    jsonb_build_object('payment_id', new.id));

  for w in select * from public.task_watchers(new.task_id) loop
    if w is distinct from actor then
      perform public.notify_user(w, 'payment_collected', 'info', 'Payment collected: ' || t.title,
        'Amount collected is ' || new.amount::text, '/tasks?task=' || t.id, t.id, 'pay:' || new.id || ':' || w);
    end if;
  end loop;

  -- A buyer receipt on an order that is open for execution also counts toward
  -- closing that order, so the receipt is posted there once, from here.
  if t.order_id is not null then
    select * into o from orders where id = t.order_id;
    if found and o.status = 'open_for_execution' and o.payment_tracking_enabled then
      insert into order_payments (order_id, kind, amount, paid_on, mode, reference, notes)
      values (t.order_id, 'buyer_receipt', new.amount, new.paid_on, new.mode, new.reference, coalesce(new.notes, 'Recorded from task ' || t.task_no))
      returning id into oid;
      update task_payments set order_payment_id = oid where id = new.id;
    end if;
  end if;

  if t.amount > 0 and t.amount_collected + new.amount >= t.amount and t.status not in ('done', 'cancelled')
     and not coalesce((select requires_proof from task_types where key = t.task_type), false) then
    update tasks set status = 'done' where id = t.id;
  end if;
  return null;
end $$;
revoke execute on function public.task_payment_after() from public, anon, authenticated;

drop trigger if exists trg_task_payment_after on public.task_payments;
create trigger trg_task_payment_after after insert on public.task_payments
  for each row execute function public.task_payment_after();

-- ---------------------------------------------------------------------------
-- 7. Cheques
-- ---------------------------------------------------------------------------

create table if not exists public.task_cheques (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid references public.tasks (id) on delete set null,
  order_id        uuid references public.orders (id) on delete set null,
  buyer_id        uuid references public.buyer_master (id) on delete set null,
  invoice_no      text,
  cheque_no       text not null check (btrim(cheque_no) <> ''),
  bank_name       text,
  cheque_date     date,
  amount          numeric(14,2) not null check (amount > 0),
  photo_path      text,
  status          text not null default 'pending' check (status in ('pending', 'collected', 'deposited', 'cleared', 'bounced')),
  collected_by    uuid references public.profiles (id) on delete set null,
  collection_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  deposited_on    date,
  deposit_bank    text,
  slip_no         text,
  deposited_by    uuid references public.profiles (id) on delete set null,
  cleared_on      date,
  notes           text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint task_cheques_deposit_after_collection check (deposited_on is null or deposited_on >= collection_date)
);
create unique index if not exists task_cheques_no_bank on public.task_cheques (lower(btrim(cheque_no)), lower(coalesce(btrim(bank_name), '')));
create index if not exists task_cheques_task_ix on public.task_cheques (task_id);
create index if not exists task_cheques_status_ix on public.task_cheques (status, collection_date);

create or replace function public.task_cheque_guard()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare system boolean := auth.uid() is null; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  new.cheque_no := btrim(new.cheque_no);
  new.bank_name := nullif(btrim(new.bank_name), '');
  new.deposit_bank := nullif(btrim(new.deposit_bank), '');
  new.slip_no := nullif(btrim(new.slip_no), '');

  if tg_op = 'INSERT' then
    if not system then new.created_by := auth.uid(); new.created_at := now(); end if;
    if not system and new.collected_by is null then new.collected_by := auth.uid(); end if;
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
  end if;

  if not system and new.collection_date > today then raise exception 'The collection date cannot be in the future'; end if;

  -- A photo of the cheque is what marks it collected.
  if new.photo_path is not null and new.status = 'pending' then new.status := 'collected'; end if;

  if new.status in ('deposited', 'cleared', 'bounced') or new.deposited_on is not null then
    if new.deposited_on is null then new.deposited_on := today; end if;
    if not system and new.deposited_on > today then raise exception 'The deposit date cannot be in the future'; end if;
    if new.deposit_bank is null or new.slip_no is null then raise exception 'Enter the bank and the slip number for a deposited cheque'; end if;
    if new.status in ('pending', 'collected') then new.status := 'deposited'; end if;
    if tg_op = 'INSERT' or old.deposited_on is null then new.deposited_by := coalesce(new.deposited_by, auth.uid());
    else new.deposited_by := old.deposited_by; end if;
  else
    new.deposit_bank := null; new.slip_no := null; new.deposited_by := null;
  end if;

  if new.status = 'cleared' and new.cleared_on is null then new.cleared_on := today; end if;
  if new.status <> 'cleared' then new.cleared_on := null; end if;

  if new.collected_by is not null and (tg_op = 'INSERT' or new.collected_by is distinct from old.collected_by)
     and not exists (select 1 from profiles where id = new.collected_by and is_active) then
    raise exception 'The cheque can only be collected by an active user';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.task_cheque_guard() from public, anon, authenticated;

drop trigger if exists trg_task_cheque_guard on public.task_cheques;
create trigger trg_task_cheque_guard before insert or update on public.task_cheques
  for each row execute function public.task_cheque_guard();

alter table public.task_cheques enable row level security;
create policy task_cheques_select on public.task_cheques for select to authenticated
  using (public.has_permission('task.read') or public.has_permission('task.manage') or collected_by = auth.uid() or created_by = auth.uid()
         or (task_id is not null and public.task_can(task_id, false)));
create policy task_cheques_insert on public.task_cheques for insert to authenticated
  with check (public.has_permission('task.manage') or (public.has_permission('task.work') and collected_by = auth.uid()));
create policy task_cheques_update on public.task_cheques for update to authenticated
  using (public.has_permission('task.manage') or (public.has_permission('task.work') and collected_by = auth.uid()))
  with check (public.has_permission('task.manage') or (public.has_permission('task.work') and collected_by = auth.uid()));
create policy task_cheques_delete on public.task_cheques for delete to authenticated using (public.has_permission('task.manage'));

-- ---------------------------------------------------------------------------
-- 8. Proof photos and documents
-- ---------------------------------------------------------------------------

create table if not exists public.task_attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks (id) on delete cascade,
  kind         text not null default 'proof' check (kind in ('proof', 'photo', 'document')),
  file_name    text not null,
  storage_path text not null unique,
  size_bytes   bigint,
  content_type text,
  lat          numeric(9,6),
  lng          numeric(9,6),
  uploaded_by  uuid default auth.uid(),
  uploaded_at  timestamptz not null default now()
);
create index if not exists task_attachments_task_ix on public.task_attachments (task_id);

alter table public.task_attachments enable row level security;
create policy task_attachments_read on public.task_attachments for select to authenticated using (public.task_can(task_id, false));
create policy task_attachments_insert on public.task_attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and public.task_can(task_id, true));
create policy task_attachments_delete on public.task_attachments for delete to authenticated
  using (public.has_permission('task.manage'));

create or replace function public.task_attachment_after()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare t tasks; ty task_types; w uuid; actor uuid := auth.uid();
begin
  select * into t from tasks where id = new.task_id;
  select * into ty from task_types where key = t.task_type;
  perform public.task_log(t.id, 'proof', null, new.kind, new.file_name, jsonb_build_object('attachment_id', new.id));

  -- A cheque photo attaches to the cheque, which then counts as collected.
  if t.task_type = 'cheque_collection' and new.kind in ('proof', 'photo') then
    update task_cheques set photo_path = new.storage_path where task_id = t.id and photo_path is null;
  end if;

  -- Proof of delivery completes a delivery task and tells accounts.
  if ty.auto_done_on_proof and new.kind in ('proof', 'photo') and t.status in ('todo', 'in_progress', 'blocked') then
    update tasks set status = 'done', details = details || '{"delivery_status":"delivered"}'::jsonb where id = t.id;
    for w in select * from public.task_watchers(t.id) loop
      if w is distinct from actor then
        perform public.notify_user(w, 'proof_received', 'info', 'Delivered: ' || t.title, 'Proof was uploaded for ' || t.task_no, '/tasks?task=' || t.id, t.id, 'proof:' || t.id || ':' || w);
      end if;
    end loop;
  end if;
  return null;
end $$;
revoke execute on function public.task_attachment_after() from public, anon, authenticated;

drop trigger if exists trg_task_attachment_after on public.task_attachments;
create trigger trg_task_attachment_after after insert on public.task_attachments
  for each row execute function public.task_attachment_after();

-- The path of every proof starts with its task id: <task id>/<uuid>-<name>.
create or replace function public.task_path_can(p_path text, p_write boolean)
returns boolean
language plpgsql stable security definer
set search_path to 'public'
as $$
declare first text := split_part(p_path, '/', 1);
begin
  if first !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  return public.task_can(first::uuid, p_write);
end $$;
revoke execute on function public.task_path_can(text, boolean) from public, anon;
grant execute on function public.task_path_can(text, boolean) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-proofs', 'task-proofs', false, 20971520)
on conflict (id) do nothing;

drop policy if exists task_proofs_select on storage.objects;
create policy task_proofs_select on storage.objects for select to authenticated
  using (bucket_id = 'task-proofs' and public.task_path_can(name, false));
drop policy if exists task_proofs_insert on storage.objects;
create policy task_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-proofs' and public.task_path_can(name, true));
drop policy if exists task_proofs_delete on storage.objects;
create policy task_proofs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'task-proofs' and public.has_permission('task.manage'));

-- ---------------------------------------------------------------------------
-- 9. Reminder rules (thresholds are data, not code)
-- ---------------------------------------------------------------------------

create table if not exists public.task_rules (
  rule_key   text primary key,
  label      text not null,
  task_type  text references public.task_types (key),
  kind       text not null check (kind in ('reminder', 'escalation')),
  config     jsonb not null default '{}'::jsonb,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.task_rules (rule_key, label, task_type, kind, config) values
  ('overdue_task',                      'Task is overdue',                         null,                          'reminder',   '{"after_days": 0}'),
  ('visit_not_visited',                 'Visit not done by its date',              'monthly_visit',               'reminder',   '{"after_days": 0}'),
  ('visit_pending_payment_escalation',  'Visited, payment still pending',          'monthly_visit',               'escalation', '{"days": [30, 45, 60]}'),
  ('delivery_pending_payment_escalation','Commission invoice delivered, payment pending', 'commission_invoice_delivery', 'escalation', '{"days": [0]}'),
  ('sample_feedback_due',               'Sample feedback is due',                  'sample_delivery',             'reminder',   '{"after_days": 7}')
on conflict (rule_key) do nothing;

create or replace function public.task_rules_touch()
returns trigger language plpgsql
set search_path to 'public'
as $$ begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists trg_task_rules_touch on public.task_rules;
create trigger trg_task_rules_touch before update on public.task_rules for each row execute function public.task_rules_touch();

alter table public.task_rules enable row level security;
create policy task_rules_read on public.task_rules for select to authenticated using (true);
create policy task_rules_write on public.task_rules for update to authenticated
  using (public.has_permission('task.manage')) with check (public.has_permission('task.manage'));

-- ---------------------------------------------------------------------------
-- 10. Messages (the log behind WhatsApp and e-mail sends)
-- ---------------------------------------------------------------------------

create table if not exists public.message_templates (
  key               text primary key,
  channel           text not null check (channel in ('whatsapp', 'email')),
  provider_template text,
  subject           text,
  body              text not null,
  variables         text[] not null default '{}',
  is_active         boolean not null default true,
  updated_at        timestamptz not null default now()
);

insert into public.message_templates (key, channel, provider_template, subject, body, variables) values
  ('payment_reminder',        'whatsapp', 'payment_reminder', null,
   'Dear {{buyer}}, this is a reminder that {{amount}} is pending against {{reference}}. Kindly arrange payment at the earliest. Thank you.', array['buyer', 'amount', 'reference']),
  ('payment_reminder_email',  'email',    null, 'Payment reminder: {{reference}}',
   'Dear {{buyer}},\n\nThis is a reminder that {{amount}} is pending against {{reference}}. Kindly arrange payment at the earliest.\n\nThank you.', array['buyer', 'amount', 'reference']),
  ('delivery_notice',         'whatsapp', 'delivery_notice', null,
   'Dear {{buyer}}, {{reference}} was delivered to your address on {{date}}. If anything is missing, please contact us.', array['buyer', 'reference', 'date']),
  ('delivery_notice_email',   'email',    null, 'Delivery information: {{reference}}',
   'Dear {{buyer}},\n\n{{reference}} was delivered to your address on {{date}}. If anything is missing, please contact us.\n\nThank you.', array['buyer', 'reference', 'date'])
on conflict (key) do nothing;

create table if not exists public.messages (
  id                  uuid primary key default gen_random_uuid(),
  direction           text not null default 'out' check (direction in ('out', 'in')),
  channel             text not null check (channel in ('whatsapp', 'email')),
  template_key        text references public.message_templates (key),
  recipient           text not null,
  buyer_id            uuid references public.buyer_master (id) on delete set null,
  task_id             uuid references public.tasks (id) on delete set null,
  ref_type            text,
  ref_id              uuid,
  subject             text,
  body                text not null,
  variables           jsonb not null default '{}'::jsonb,
  document_path       text,
  status              text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'replied', 'manual')),
  provider_message_id text,
  error               text,
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now()
);
create unique index if not exists messages_provider_uq on public.messages (provider_message_id) where provider_message_id is not null;
create index if not exists messages_queue_ix on public.messages (status, next_attempt_at) where status in ('queued', 'sending');
create index if not exists messages_task_ix on public.messages (task_id, created_at);

alter table public.message_templates enable row level security;
create policy message_templates_read on public.message_templates for select to authenticated using (true);
create policy message_templates_write on public.message_templates for all to authenticated
  using (public.has_permission('task.manage')) with check (public.has_permission('task.manage'));

alter table public.messages enable row level security;
create policy messages_select on public.messages for select to authenticated
  using (public.has_permission('message.view') or created_by = auth.uid() or (task_id is not null and public.task_can(task_id, false)));

-- Phones are checked before anything is queued: most failed sends in the old
-- setup were numbers the provider refused. Ten digits get the Indian prefix.
create or replace function public.normalize_phone(p_phone text)
returns text
language plpgsql immutable
set search_path to 'public'
as $$
declare d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(d) = 10 then return '91' || d; end if;
  if length(d) = 11 and left(d, 1) = '0' then return '91' || substr(d, 2); end if;
  if length(d) between 11 and 15 then return d; end if;
  return null;
end $$;

create or replace function public.queue_message(
  p_channel text, p_template text, p_recipient text, p_vars jsonb default '{}'::jsonb,
  p_task uuid default null, p_buyer uuid default null, p_document text default null
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare tpl message_templates; body text; subj text; k text; v text; rcpt text; id uuid;
begin
  if not (public.has_permission('message.send') or public.has_permission('task.manage')) then
    raise exception 'Your account does not have permission to send messages';
  end if;
  if p_task is not null and not public.task_can(p_task, true) then raise exception 'You cannot send messages for this task'; end if;
  select * into tpl from message_templates where key = p_template and is_active;
  if not found then raise exception 'Message template % does not exist or is switched off', p_template; end if;
  if tpl.channel <> p_channel then raise exception 'Template % is for %, not %', p_template, tpl.channel, p_channel; end if;

  if p_channel = 'whatsapp' then
    rcpt := public.normalize_phone(p_recipient);
    if rcpt is null then raise exception 'That is not a valid phone number: %', coalesce(p_recipient, '(blank)'); end if;
  else
    rcpt := lower(btrim(coalesce(p_recipient, '')));
    if position('@' in rcpt) < 2 then raise exception 'That is not a valid e-mail address: %', coalesce(p_recipient, '(blank)'); end if;
  end if;

  body := tpl.body; subj := tpl.subject;
  for k, v in select key, value from jsonb_each_text(coalesce(p_vars, '{}'::jsonb)) loop
    body := replace(body, '{{' || k || '}}', coalesce(v, ''));
    if subj is not null then subj := replace(subj, '{{' || k || '}}', coalesce(v, '')); end if;
  end loop;

  insert into messages (channel, template_key, recipient, buyer_id, task_id, subject, body, variables, document_path)
  values (p_channel, p_template, rcpt, p_buyer, p_task, subj, body, coalesce(p_vars, '{}'::jsonb), p_document)
  returning messages.id into id;
  if p_task is not null then perform public.task_log(p_task, 'message', null, p_channel, p_template, jsonb_build_object('message_id', id)); end if;
  return id;
end $$;
revoke execute on function public.queue_message(text, text, text, jsonb, uuid, uuid, text) from public, anon;
grant execute on function public.queue_message(text, text, text, jsonb, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Calls the screens make
-- ---------------------------------------------------------------------------

create or replace function public.task_set_status(p_task uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.task_can(p_task, true) then raise exception 'You cannot change this task'; end if;
  update tasks set status = p_status where id = p_task;
  if p_note is not null and btrim(p_note) <> '' then perform public.task_log(p_task, 'comment', null, null, btrim(p_note)); end if;
end $$;

create or replace function public.task_set_status_many(p_tasks uuid[], p_status text)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare tid uuid; n integer := 0;
begin
  foreach tid in array coalesce(p_tasks, '{}') loop
    if public.task_can(tid, true) then
      update tasks set status = p_status where tasks.id = tid and tasks.status is distinct from p_status;
      if found then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.task_assign_many(p_tasks uuid[], p_user uuid)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare n integer;
begin
  if not public.has_permission('task.manage') then raise exception 'Assigning tasks needs the Create and manage tasks permission'; end if;
  update tasks set assigned_to = p_user where id = any (coalesce(p_tasks, '{}')) and assigned_to is distinct from p_user;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.task_check_in(p_task uuid, p_lat numeric, p_lng numeric, p_accuracy numeric default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare t tasks;
begin
  if not public.task_can(p_task, true) then raise exception 'You cannot check in to this task'; end if;
  select * into t from tasks where id = p_task;
  if t.status in ('done', 'cancelled') then raise exception 'This task is already closed'; end if;
  update tasks set check_in_at = now(), check_out_at = null, lat = p_lat, lng = p_lng, accuracy_m = p_accuracy,
    status = case when status = 'todo' then 'in_progress' else status end,
    details = case when task_type = 'monthly_visit'
                   then details || jsonb_build_object('visit_status', 'visited', 'visited_on', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'))
                   else details end
  where id = p_task;
  perform public.task_log(p_task, 'check_in', null, null, null, jsonb_build_object('lat', p_lat, 'lng', p_lng, 'accuracy_m', p_accuracy));
end $$;

create or replace function public.task_check_out(p_task uuid, p_summary text default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.task_can(p_task, true) then raise exception 'You cannot check out of this task'; end if;
  update tasks set check_out_at = now(),
    details = case when p_summary is not null and btrim(p_summary) <> '' then details || jsonb_build_object('visit_summary', btrim(p_summary)) else details end
  where id = p_task and check_in_at is not null;
  perform public.task_log(p_task, 'check_out', null, null, nullif(btrim(coalesce(p_summary, '')), ''));
end $$;

create or replace function public.task_add_payment(
  p_task uuid, p_amount numeric, p_mode text default null, p_reference text default null, p_notes text default null, p_paid_on date default null
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare t tasks; id uuid;
begin
  if not public.task_can(p_task, true) then raise exception 'You cannot record a payment on this task'; end if;
  select * into t from tasks where id = p_task;
  if t.status in ('done', 'cancelled') then raise exception 'This task is closed; reopen it before recording a payment'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'The amount must be more than zero'; end if;
  insert into task_payments (task_id, amount, mode, reference, notes, paid_on)
  values (p_task, p_amount, p_mode, nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_paid_on, (now() at time zone 'Asia/Kolkata')::date))
  returning task_payments.id into id;
  return id;
end $$;

create or replace function public.task_add_comment(p_task uuid, p_text text)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.task_can(p_task, false) then raise exception 'You cannot comment on this task'; end if;
  if btrim(coalesce(p_text, '')) = '' then raise exception 'Write something first'; end if;
  perform public.task_log(p_task, 'comment', null, null, btrim(p_text));
end $$;

-- Counts for the summary cards, worked out under the caller's own visibility.
create or replace function public.task_counts()
returns jsonb
language sql stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'open',            count(*) filter (where t.status in ('todo', 'in_progress', 'blocked')),
    'due_today',       count(*) filter (where t.status in ('todo', 'in_progress', 'blocked') and t.due_date = (now() at time zone 'Asia/Kolkata')::date),
    'overdue',         count(*) filter (where t.status in ('todo', 'in_progress', 'blocked') and t.due_date < (now() at time zone 'Asia/Kolkata')::date),
    'awaiting_proof',  count(*) filter (where t.status in ('todo', 'in_progress', 'blocked')
                         and exists (select 1 from task_types ty where ty.key = t.task_type and ty.requires_proof)
                         and not exists (select 1 from task_attachments a where a.task_id = t.id)),
    'payment_outstanding', count(*) filter (where t.task_type = 'payment_collection' and t.status in ('todo', 'in_progress', 'blocked') and t.amount_collected < t.amount),
    'mine',            count(*) filter (where t.status in ('todo', 'in_progress', 'blocked') and t.assigned_to = auth.uid())
  ) from tasks t
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'task_set_status(uuid, text, text)', 'task_set_status_many(uuid[], text)', 'task_assign_many(uuid[], uuid)',
    'task_check_in(uuid, numeric, numeric, numeric)', 'task_check_out(uuid, text)',
    'task_add_payment(uuid, numeric, text, text, text, date)', 'task_add_comment(uuid, text)', 'task_counts()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Tasks that create themselves
-- ---------------------------------------------------------------------------

create or replace function public.default_task_assignee(p_buyer uuid)
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(b.collection_staff_id, b.messenger_id, b.sales_person_id)
  from buyer_master b where b.id = p_buyer
$$;
revoke execute on function public.default_task_assignee(uuid) from public, anon, authenticated;

create or replace function public.dispatch_tasks()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare o orders; days int; tr uuid; label text;
begin
  select * into o from orders where id = new.order_id;
  if not found then return null; end if;

  -- The mill invoice has to be carried to the buyer.
  if new.mill_invoice_no is not null and btrim(new.mill_invoice_no) <> ''
     and (tg_op = 'INSERT' or old.mill_invoice_no is distinct from new.mill_invoice_no) then
    select default_due_days into days from task_types where key = 'mill_invoice_delivery';
    insert into tasks (task_type, title, due_date, assigned_to, buyer_id, supplier_id, order_id, dispatch_id, details, dedupe_key)
    values ('mill_invoice_delivery', 'Deliver mill invoice ' || btrim(new.mill_invoice_no) || ' (' || coalesce(o.order_no, 'order') || ')',
            (now() at time zone 'Asia/Kolkata')::date + coalesce(days, 2), public.default_task_assignee(o.buyer_id),
            o.buyer_id, o.supplier_id, o.id, new.id,
            jsonb_build_object('delivery_status', 'not_delivered', 'invoice_no', btrim(new.mill_invoice_no),
                               'invoice_date', coalesce(new.mill_invoice_date::text, '')) - case when new.mill_invoice_date is null then 'invoice_date' else '' end, 'mill_inv:' || new.id)
    on conflict (dedupe_key) do nothing;
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
revoke execute on function public.dispatch_tasks() from public, anon, authenticated;

drop trigger if exists trg_dispatch_tasks on public.order_dispatches;
create trigger trg_dispatch_tasks after insert or update on public.order_dispatches
  for each row execute function public.dispatch_tasks();

create or replace function public.commission_invoice_tasks()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare days int; o orders;
begin
  select * into o from orders where id = new.order_id;
  select default_due_days into days from task_types where key = 'commission_invoice_delivery';
  insert into tasks (task_type, title, due_date, assigned_to, buyer_id, supplier_id, order_id, commission_invoice_id, amount, details, dedupe_key)
  values ('commission_invoice_delivery', 'Deliver commission invoice ' || coalesce(new.invoice_no, '') || ' (' || coalesce(o.order_no, 'order') || ')',
          (now() at time zone 'Asia/Kolkata')::date + coalesce(days, 2), public.default_task_assignee(new.buyer_id),
          new.buyer_id, new.supplier_id, new.order_id, new.id, new.amount,
          jsonb_build_object('delivery_status', 'not_delivered', 'invoice_no', new.invoice_no, 'invoice_date', new.invoice_date::text), 'ci:' || new.id)
  on conflict (dedupe_key) do nothing;
  return null;
end $$;
revoke execute on function public.commission_invoice_tasks() from public, anon, authenticated;

drop trigger if exists trg_commission_invoice_tasks on public.commission_invoices;
create trigger trg_commission_invoice_tasks after insert on public.commission_invoices
  for each row execute function public.commission_invoice_tasks();
