-- Tasks module, part 3: the scheduled rules.
--
-- run_task_rules() does what monday's date-triggered automations did, once and
-- safely: it raises reminders and escalations from the thresholds stored in
-- task_rules. Every action is keyed (a notification or timeline key), so running
-- it every few minutes, or twice in a row, never repeats anything.
--
-- p_now exists so the rules can be tested: select run_task_rules(now() + interval '31 days');

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

  ---------------------------------------------------------------- visit not done
  select * into r from task_rules where rule_key = 'visit_not_visited' and is_active;
  if found then
    grace := coalesce((r.config->>'after_days')::int, 0);
    for tk in select * from tasks
      where task_type = 'monthly_visit' and status in ('todo', 'blocked') and assigned_to is not null
        and coalesce(details->>'visit_status', 'planned') = 'planned' and due_date <= today - grace loop
      perform public.notify_user(tk.assigned_to, 'visit_missed', 'warning', 'You have not visited yet: ' || tk.title,
        tk.task_no || ' was planned for ' || to_char(tk.due_date, 'DD Mon YYYY'), '/tasks?task=' || tk.id, tk.id, 'visit_missed:' || tk.id);
      raised := raised + 1;
    end loop;
  end if;

  ---------------------------------------------------------------- sample feedback
  select * into r from task_rules where rule_key = 'sample_feedback_due' and is_active;
  if found then
    grace := coalesce((r.config->>'after_days')::int, 7);
    for tk in select * from tasks
      where task_type = 'sample_delivery' and status <> 'cancelled'
        and coalesce(details->>'feedback_status', 'pending') = 'pending'
        and (details->>'delivery_date') ~ '^\d{4}-\d{2}-\d{2}$'
        and (details->>'delivery_date')::date + grace <= today loop
      for w in select * from public.task_watchers(tk.id) loop
        perform public.notify_user(w, 'sample_feedback_due', 'warning', 'Sample feedback is due: ' || tk.title,
          'No feedback has been recorded for ' || tk.task_no, '/tasks?task=' || tk.id, tk.id, 'feedback:' || tk.id || ':' || w);
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
          perform public.notify_user(w, 'payment_escalation', 'critical',
            'Payment still pending after ' || d || ' days: ' || coalesce(buyer_name, tk.title),
            tk.task_no || ' - a payment follow-up is open', '/tasks?task=' || coalesce(ex.id, tk.id), tk.id, 'esc:' || tk.id || ':' || d || ':' || w);
        end loop;
        raised := raised + 1;
        ex := null;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('as_of', today, 'notifications_raised', raised, 'tasks_created', created_tasks);
end $$;

revoke execute on function public.run_task_rules(timestamptz) from public, anon, authenticated;

-- Run every 15 minutes where pg_cron is available. If it is not, schedule
-- `select public.run_task_rules()` from the Supabase dashboard (Integrations,
-- Cron) instead; the function is safe to call as often as you like.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available (%); schedule run_task_rules() from the dashboard', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('run-task-rules', '*/15 * * * *', 'select public.run_task_rules()');
  end if;
end $$;
