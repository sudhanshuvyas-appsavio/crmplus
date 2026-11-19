-- Tasks module, monday parity (part 5): the rules run at monday's time of day,
-- the two visit reminders match monday, Person comes only from the buyer's
-- Messenger, the mill proof sets Invoice Status the way monday does, and every
-- rule run is written to a log.
--
-- Source of every figure below: the read-only audit of the monday "Tasks"
-- folder (docs/monday-task-folder-analysis, documents 03 and 05).
--
--   A-2   visit still Not Visited on its Created Date, 17:45 IST -> Person + Accounts
--   A-3   Visited Date + 30 days, 10:00 IST, status Visited (no pending-payment test)
--   A-4..9 Pending Payment = Yes, visit Visited/Not Visited (not Completed):
--          Visited-Date branch 18:00 / 22:15 / 22:45, Created-Date branch (no
--          visited date) 18:15 / 22:15 / 22:45, at 30 / 45 / 60 days, one
--          Payment Collection "Monthly Visit - {name}" per step
--   A-10  proof -> Invoice Status = Delivered, Accounts told, Status unchanged
--   A-11  commission delivery, Pending Payment = Yes, Created Date 18:30 IST
--   A-20  sample feedback still Pending, Delivery Date + 7 days, 20:30 IST
--   A-21..30 Person := the buyer's Messenger (no fallback, Accounts stay manual)
--
-- The offsets of A-4..A-9 are not stored in monday's readable configuration
-- (only the messages say 30/45/60 days), so the thresholds stay data in
-- task_rules.config: change them in Tasks > Rules once confirmed.
--
-- Safe to run twice. Run this BEFORE the app version that shows the rule log.

-- ---------------------------------------------------------------------------
-- 1. Rule run log
-- ---------------------------------------------------------------------------

create table if not exists public.task_rule_runs (
  id       bigint generated always as identity primary key,
  run_at   timestamptz not null default now(),
  as_of    timestamptz,
  rule_key text not null,
  task_id  uuid references public.tasks (id) on delete set null,
  outcome  text not null check (outcome in ('fired', 'failed', 'summary')),
  detail   jsonb
);
create index if not exists task_rule_runs_run_ix on public.task_rule_runs (run_at desc);
create index if not exists task_rule_runs_rule_ix on public.task_rule_runs (rule_key, run_at desc);

alter table public.task_rule_runs enable row level security;
drop policy if exists task_rule_runs_read on public.task_rule_runs;
create policy task_rule_runs_read on public.task_rule_runs for select to authenticated
  using (public.has_permission('task.manage'));

create or replace function public.task_rule_log(p_rule text, p_task uuid, p_outcome text, p_detail jsonb, p_as_of timestamptz)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  insert into task_rule_runs (rule_key, task_id, outcome, detail, as_of) values (p_rule, p_task, p_outcome, p_detail, p_as_of);
end $$;
revoke execute on function public.task_rule_log(text, uuid, text, jsonb, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers: the moment a date rule fires, a notification that reports whether
--    it was new, and the day a visit happened
-- ---------------------------------------------------------------------------

-- True from (date + offset days at HH:MM IST) until `p_window` days later. monday
-- fires a date rule once, at its time; the window lets a delayed scheduler catch
-- up without notifying about old dates.
create or replace function public.task_rule_due(p_date date, p_offset integer, p_time text, p_now timestamptz, p_window integer default 2)
returns boolean
language sql stable
set search_path to 'public'
as $$
  select p_date is not null
     and p_now >= (((p_date + coalesce(p_offset, 0))::timestamp + coalesce(nullif(btrim(p_time), ''), '00:00')::time) at time zone 'Asia/Kolkata')
     and p_now <  (((p_date + coalesce(p_offset, 0))::timestamp + coalesce(nullif(btrim(p_time), ''), '00:00')::time) at time zone 'Asia/Kolkata')
                   + make_interval(days => greatest(coalesce(p_window, 2), 1))
$$;

create or replace function public.task_visited_day(p_details jsonb, p_check_in timestamptz)
returns date
language sql stable
set search_path to 'public'
as $$
  select coalesce(
    case when (p_details->>'visited_on') ~ '^\d{4}-\d{2}-\d{2}$' then (p_details->>'visited_on')::date end,
    (p_check_in at time zone 'Asia/Kolkata')::date)
$$;

create or replace function public.notify_user_new(
  p_user uuid, p_kind text, p_severity text, p_title text, p_message text, p_href text, p_task uuid, p_dedupe text
) returns boolean
language plpgsql security definer
set search_path to 'public'
as $$
declare n integer;
begin
  if p_user is null then return false; end if;
  insert into notifications (user_id, kind, severity, title, message, href, task_id, dedupe_key)
  values (p_user, p_kind, coalesce(p_severity, 'info'), p_title, p_message, p_href, p_task, p_dedupe)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.notify_user_new(uuid, text, text, text, text, text, uuid, text) from public, anon, authenticated;

-- Tell everyone who hears about the task (Person and Accounts; managers when
-- neither is set) "Hey, {name}, {text}". Returns how many notifications were new.
create or replace function public.task_rule_notify(
  p_task uuid, p_kind text, p_severity text, p_title text, p_text text, p_key text, p_href text default null
) returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare w uuid; who text; n integer := 0;
begin
  for w in select * from public.task_watchers(p_task) loop
    select name into who from profiles where id = w;
    if public.notify_user_new(w, p_kind, p_severity, p_title, 'Hey, ' || coalesce(who, '') || ', ' || p_text,
                              coalesce(p_href, '/tasks?task=' || p_task), p_task, p_key || ':' || w) then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.task_rule_notify(uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Person from the buyer's Messenger only (monday: A-21..A-30)
-- ---------------------------------------------------------------------------

create or replace function public.default_task_assignee(p_buyer uuid)
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select b.messenger_id
  from buyer_master b
  join profiles p on p.id = b.messenger_id and p.is_active
  where b.id = p_buyer
$$;
revoke execute on function public.default_task_assignee(uuid) from public, anon, authenticated;

-- On create (when nobody is chosen) and whenever the buyer changes, Person
-- becomes the buyer's Messenger. Accounts are never filled in automatically.
create or replace function public.task_defaults()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare m uuid;
begin
  if new.buyer_id is not null and (tg_op = 'INSERT' or new.buyer_id is distinct from old.buyer_id) then
    m := public.default_task_assignee(new.buyer_id);
    if m is not null and (tg_op = 'UPDATE' or new.assigned_to is null) then
      new.assigned_to := m;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.task_defaults() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Mill invoice proof (monday A-10): Invoice Status = Delivered and Accounts
--    are told "Hey, {name}, Mill Invoice is delivered"; the board's own Status
--    is left alone. Other task types keep completing on proof.
-- ---------------------------------------------------------------------------

create or replace function public.task_attachment_after()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare t tasks; ty task_types; w uuid; who text; actor uuid := auth.uid();
begin
  select * into t from tasks where id = new.task_id;
  select * into ty from task_types where key = t.task_type;
  perform public.task_log(t.id, 'proof', null, new.kind, new.file_name, jsonb_build_object('attachment_id', new.id));

  -- A cheque photo attaches to the cheque, which then counts as collected.
  if t.task_type = 'cheque_collection' and new.kind in ('proof', 'photo') then
    update task_cheques set photo_path = new.storage_path where task_id = t.id and photo_path is null;
  end if;

  if ty.auto_done_on_proof and new.kind in ('proof', 'photo') and t.status in ('todo', 'in_progress', 'blocked') then
    if t.task_type = 'mill_invoice_delivery' then
      if coalesce(t.details->>'delivery_status', '') <> 'delivered' then
        update tasks set details = details || '{"delivery_status":"delivered"}'::jsonb where id = t.id;
        for w in select * from (
          select t.accounts_staff_id as id where t.accounts_staff_id is not null
          union all
          select x.id from public.task_watchers(t.id) as x(id) where t.accounts_staff_id is null
        ) q loop
          select name into who from profiles where id = w;
          perform public.notify_user(w, 'proof_received', 'info', t.title, 'Hey, ' || coalesce(who, '') || ', Mill Invoice is delivered',
            '/tasks?task=' || t.id, t.id, 'proof:' || t.id || ':' || w);
        end loop;
      end if;
    else
      update tasks set status = 'done', details = details || '{"delivery_status":"delivered"}'::jsonb where id = t.id;
      for w in select * from public.task_watchers(t.id) loop
        if w is distinct from actor then
          perform public.notify_user(w, 'proof_received', 'info', 'Delivered: ' || t.title, 'Proof was uploaded for ' || t.task_no, '/tasks?task=' || t.id, t.id, 'proof:' || t.id || ':' || w);
        end if;
      end loop;
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.task_attachment_after() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Rule settings: time of day and window, as data
-- ---------------------------------------------------------------------------

-- Existing values (days, after_days) win over these defaults.
update public.task_rules set config = '{"after_days": 0, "time": "17:45", "window_days": 2}'::jsonb || config
  where rule_key = 'visit_not_visited';
update public.task_rules set config = '{"after_days": 30, "time": "10:00", "window_days": 2}'::jsonb || config
  where rule_key = 'visit_visited_reminder';
update public.task_rules set label = 'Visited, payment not collected after 30 days'
  where rule_key = 'visit_visited_reminder';
update public.task_rules set config = '{"days": [30, 45, 60],
    "visited":     {"30": "18:00", "45": "22:15", "60": "22:45"},
    "not_visited": {"30": "18:15", "45": "22:15", "60": "22:45"},
    "window_days": 2, "one_followup_per_buyer": false}'::jsonb || config
  where rule_key = 'visit_pending_payment_escalation';
update public.task_rules set config = '{"days": [0], "time": "18:30", "window_days": 2, "one_followup_per_buyer": false}'::jsonb || config
  where rule_key = 'delivery_pending_payment_escalation';
update public.task_rules set config = '{"after_days": 7, "time": "20:30", "window_days": 2}'::jsonb || config
  where rule_key = 'sample_feedback_due';

-- ---------------------------------------------------------------------------
-- 6. The scheduler
-- ---------------------------------------------------------------------------

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
  d int;
  win int;
  tm text;
  base date;
  visited_day date;
  branch text;
  msg text;
  ttl text;
  buyer_name text;
  step_priority text;
  assignee uuid;
  one_per_buyer boolean;
  n int;
  created_tasks int := 0;
  raised int := 0;
  failures int := 0;
begin
  ---------------------------------------------------------------- overdue
  select * into r from task_rules where rule_key = 'overdue_task' and is_active;
  if found then
    for tk in select * from tasks
      where status in ('todo', 'in_progress', 'blocked') and assigned_to is not null
        and due_date < today - coalesce((r.config->>'after_days')::int, 0)
        and not (task_type = 'mill_invoice_delivery' and coalesce(details->>'delivery_status', '') = 'delivered') loop
      begin
        if public.notify_user_new(tk.assigned_to, 'task_overdue', 'critical', 'Overdue: ' || tk.title,
             tk.task_no || ' was due ' || to_char(tk.due_date, 'DD Mon YYYY'), '/tasks?task=' || tk.id, tk.id, 'overdue:' || tk.id) then
          raised := raised + 1;
          perform public.task_rule_log('overdue_task', tk.id, 'fired', jsonb_build_object('due', tk.due_date), p_now);
        end if;
      exception when others then
        failures := failures + 1;
        perform public.task_rule_log('overdue_task', tk.id, 'failed', jsonb_build_object('error', sqlerrm), p_now);
      end;
    end loop;
  end if;

  ---------------------------------------------------------------- A-2: not visited on the Created Date
  select * into r from task_rules where rule_key = 'visit_not_visited' and is_active;
  if found then
    win := coalesce((r.config->>'window_days')::int, 2);
    tm := coalesce(r.config->>'time', '17:45');
    for tk in select * from tasks
      where task_type = 'monthly_visit' and status in ('todo', 'in_progress', 'blocked')
        and coalesce(details->>'visit_status', 'planned') in ('planned', 'missed')
        and public.task_rule_due(start_date, coalesce((r.config->>'after_days')::int, 0), tm, p_now, win) loop
      begin
        n := public.task_rule_notify(tk.id, 'visit_missed', 'warning', tk.title, 'You have not visited yet.', 'visit_missed:' || tk.id || ':' || tk.start_date);
        if n > 0 then
          raised := raised + n;
          perform public.task_rule_log('visit_not_visited', tk.id, 'fired', jsonb_build_object('created', tk.start_date, 'notified', n), p_now);
        end if;
      exception when others then
        failures := failures + 1;
        perform public.task_rule_log('visit_not_visited', tk.id, 'failed', jsonb_build_object('error', sqlerrm), p_now);
      end;
    end loop;
  end if;

  ---------------------------------------------------------------- A-3: visited, 30 days on
  select * into r from task_rules where rule_key = 'visit_visited_reminder' and is_active;
  if found then
    win := coalesce((r.config->>'window_days')::int, 2);
    tm := coalesce(r.config->>'time', '10:00');
    for tk in select * from tasks
      where task_type = 'monthly_visit' and coalesce(details->>'visit_status', 'planned') = 'visited' loop
      begin
        visited_day := public.task_visited_day(tk.details, tk.check_in_at);
        if visited_day is null
           or not public.task_rule_due(visited_day, coalesce((r.config->>'after_days')::int, 30), tm, p_now, win) then
          continue;
        end if;
        n := public.task_rule_notify(tk.id, 'visit_unpaid', 'warning', tk.title, 'you have visited and not collect the payment.', 'visit_unpaid:' || tk.id || ':' || visited_day);
        if n > 0 then
          raised := raised + n;
          perform public.task_rule_log('visit_visited_reminder', tk.id, 'fired', jsonb_build_object('visited', visited_day, 'notified', n), p_now);
        end if;
      exception when others then
        failures := failures + 1;
        perform public.task_rule_log('visit_visited_reminder', tk.id, 'failed', jsonb_build_object('error', sqlerrm), p_now);
      end;
    end loop;
  end if;

  ---------------------------------------------------------------- A-20: sample feedback due
  select * into r from task_rules where rule_key = 'sample_feedback_due' and is_active;
  if found then
    win := coalesce((r.config->>'window_days')::int, 2);
    tm := coalesce(r.config->>'time', '20:30');
    for tk in select * from tasks
      where task_type = 'sample_delivery' and status <> 'cancelled'
        and coalesce(details->>'feedback_status', 'pending') = 'pending'
        and (details->>'delivery_date') ~ '^\d{4}-\d{2}-\d{2}$' loop
      begin
        if not public.task_rule_due((tk.details->>'delivery_date')::date, coalesce((r.config->>'after_days')::int, 7), tm, p_now, win) then
          continue;
        end if;
        n := public.task_rule_notify(tk.id, 'sample_feedback_due', 'warning', tk.title, 'The sample ' || tk.title || ' feedback is due.',
               'feedback:' || tk.id || ':' || (tk.details->>'delivery_date'));
        if n > 0 then
          raised := raised + n;
          perform public.task_rule_log('sample_feedback_due', tk.id, 'fired', jsonb_build_object('delivery', tk.details->>'delivery_date', 'notified', n), p_now);
        end if;
      exception when others then
        failures := failures + 1;
        perform public.task_rule_log('sample_feedback_due', tk.id, 'failed', jsonb_build_object('error', sqlerrm), p_now);
      end;
    end loop;
  end if;

  ---------------------------------------------------------------- A-4..A-9 and A-11: unpaid after a visit or a delivery
  for r in select * from task_rules where kind = 'escalation' and is_active and task_type is not null loop
    win := coalesce((r.config->>'window_days')::int, 2);
    one_per_buyer := coalesce((r.config->>'one_followup_per_buyer')::boolean, false);
    for tk in select * from tasks
      where task_type = r.task_type and status <> 'cancelled'
        and coalesce((details->>'pending_payment')::boolean, false) loop

      if tk.task_type = 'monthly_visit' then
        -- Pending = Yes and the visit is Visited or Not Visited, not Completed.
        if coalesce(tk.details->>'visit_status', 'planned') = 'completed' then continue; end if;
        visited_day := public.task_visited_day(tk.details, tk.check_in_at);
        branch := case when visited_day is not null then 'visited' else 'not_visited' end;
        base := coalesce(visited_day, tk.start_date);
      else
        branch := 'delivery';
        base := tk.start_date;
      end if;

      for d in select (jsonb_array_elements_text(r.config->'days'))::int order by 1 loop
        begin
          tm := coalesce(r.config #>> array[branch, d::text], r.config->>'time', '10:00');
          if not public.task_rule_due(base, d, tm, p_now, win) then continue; end if;

          -- A step that has already been taken is skipped.
          insert into task_events (task_id, kind, to_value, note, dedupe_key)
          values (tk.id, 'escalation', d::text, 'Payment still pending after ' || d || ' days', 'esc:' || tk.id || ':' || d)
          on conflict (dedupe_key) where dedupe_key is not null do nothing;
          get diagnostics n = row_count;
          if n = 0 then continue; end if;

          step_priority := case when d >= 60 then 'urgent' when d >= 45 then 'high' else 'normal' end;
          select name into buyer_name from buyer_master where id = tk.buyer_id;
          assignee := case when exists (select 1 from profiles where id = tk.assigned_to and is_active) then tk.assigned_to end;
          ex := null;

          if one_per_buyer then
            -- Optional: one open follow-up per buyer; a later step raises its priority.
            select * into ex from tasks
              where task_type = 'payment_collection' and buyer_id is not distinct from tk.buyer_id
                and status in ('todo', 'in_progress', 'blocked') and coalesce((details->>'escalation')::boolean, false)
              order by created_at limit 1;
            if found then
              update tasks set priority = case when step_priority = 'urgent' or priority = 'urgent' then 'urgent'
                                               when step_priority = 'high' or priority = 'high' then 'high' else priority end
                where id = ex.id;
              perform public.task_log(ex.id, 'escalation', null, d::text, 'Still unpaid after ' || d || ' days (' || tk.task_no || ')', null, 'escseen:' || ex.id || ':' || tk.id || ':' || d);
            end if;
          end if;

          if ex.id is null then
            -- monday: one Payment Collection item per step, named "Monthly Visit - {name}".
            insert into tasks (task_type, title, due_date, priority, assigned_to, accounts_staff_id, buyer_id, supplier_id, order_id, source_task_id, amount, details, dedupe_key)
            values ('payment_collection',
                    case tk.task_type when 'monthly_visit' then 'Monthly Visit' when 'commission_invoice_delivery' then 'Commission Invoice' else 'Task' end
                      || ' - ' || tk.title,
                    today, step_priority, assignee, tk.accounts_staff_id, tk.buyer_id, tk.supplier_id, tk.order_id, tk.id, coalesce(tk.amount, 0),
                    jsonb_build_object('escalation', true, 'step_days', d, 'branch', branch), 'esc:' || tk.id || ':' || d)
            on conflict (dedupe_key) do nothing
            returning * into ex;
            if ex.id is not null then created_tasks := created_tasks + 1; end if;
          end if;

          msg := case branch
                   when 'delivery' then 'Payment is pending for this record.'
                   when 'visited' then 'you have visited and not collected the payment after ' || d || ' days'
                   else 'you have not visited and not collected the payment after ' || d || ' days' end;
          ttl := case when tk.task_type = 'commission_invoice_delivery' then tk.title
                      else 'Payment still pending after ' || d || ' days: ' || coalesce(buyer_name, tk.title) end;
          n := public.task_rule_notify(tk.id, 'payment_escalation', 'critical', ttl, msg, 'esc:' || tk.id || ':' || d,
                 '/tasks?task=' || coalesce(ex.id, tk.id));
          raised := raised + n;
          perform public.task_rule_log(r.rule_key, tk.id, 'fired',
            jsonb_build_object('step_days', d, 'branch', branch, 'notified', n, 'payment_task', ex.id), p_now);
        exception when others then
          failures := failures + 1;
          perform public.task_rule_log(r.rule_key, tk.id, 'failed', jsonb_build_object('step_days', d, 'error', sqlerrm), p_now);
        end;
      end loop;
    end loop;
  end loop;

  -- One summary row per run (also tells managers the scheduler is alive), then tidy the log.
  insert into task_rule_runs (rule_key, outcome, detail, as_of)
  values ('run', 'summary', jsonb_build_object('notifications_raised', raised, 'tasks_created', created_tasks, 'failures', failures), p_now);
  delete from task_rule_runs where outcome = 'summary' and run_at < now() - interval '14 days';
  delete from task_rule_runs where outcome <> 'summary' and run_at < now() - interval '90 days';

  return jsonb_build_object('as_of', today, 'notifications_raised', raised, 'tasks_created', created_tasks, 'failures', failures);
end $$;
revoke execute on function public.run_task_rules(timestamptz) from public, anon, authenticated;
