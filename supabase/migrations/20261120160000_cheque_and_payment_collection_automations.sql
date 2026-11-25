-- Cheque Collection and Payment Collection: the two automations that did not match monday.
--
-- 1. Payment Collection, A-14. monday: when Amount Collected changes and is above 0, notify Person and
--    Accounts "Hey, {name}, Amount collected is {Amount Collected}": the figure is the total collected so
--    far (the column's value), not the last payment. CRM+ said "Amount collected is {last payment}" with no
--    greeting. The message now greets the recipient and states the running total.
--
-- 2. Cheque Collection, A-17. monday notifies the Accounts column "Your Check for {name} is Collected" when
--    the cheque becomes Collected. The cheque form had no way to set Accounts, so for cheques entered in the
--    app nobody was ever notified. The form now has an Accounts field (see ChequeForm.tsx); and when a cheque
--    still has no Accounts person, the people who follow the task (Person, or the managers when nobody is
--    set), other than whoever made the change, are told instead of nobody.
--
-- 3. Recording a payment through task_add_payment failed with "column reference id is ambiguous" (fixed below).
--
-- Safe to run twice. The payment function is the module's own (20261118100000) with only the notification
-- block changed.

create or replace function public.task_payment_after()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare t tasks; o orders; oid uuid; w uuid; who text; total numeric; actor uuid := auth.uid();
begin
  select * into t from tasks where id = new.task_id for update;
  perform set_config('app.task_payment', '1', true);
  update tasks set amount_collected = amount_collected + new.amount where id = new.task_id;
  perform set_config('app.task_payment', '', true);

  perform public.task_log(new.task_id, 'payment', null, new.amount::text,
    coalesce(new.mode, 'payment') || coalesce(' ' || nullif(btrim(new.reference), ''), ''),
    jsonb_build_object('payment_id', new.id));

  -- monday A-14: "Hey, {name}, Amount collected is {Amount Collected}": the figure is the total collected so far.
  select amount_collected into total from tasks where id = new.task_id;
  for w in select * from public.task_watchers(new.task_id) loop
    if w is distinct from actor then
      select name into who from profiles where id = w;
      perform public.notify_user(w, 'payment_collected', 'info', 'Payment collected: ' || t.title,
        'Hey, ' || coalesce(who, '') || ', Amount collected is ' || trim_scale(total)::text,
        '/tasks?task=' || t.id, t.id, 'pay:' || new.id || ':' || w);
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


create or replace function public.cheque_collected_notify()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare t tasks; w uuid; title text; actor uuid := auth.uid();
begin
  if new.status <> 'collected' then return null; end if;
  if tg_op = 'UPDATE' and old.status = 'collected' then return null; end if;
  if new.task_id is null then return null; end if;
  select * into t from tasks where id = new.task_id;
  if not found then return null; end if;
  title := coalesce(t.title, new.cheque_no);
  if t.accounts_staff_id is not null then
    perform public.notify_user(t.accounts_staff_id, 'cheque_collected', 'info', title,
      'Your Check for ' || title || ' is Collected', '/tasks?task=' || t.id, t.id, 'chq_collected:' || new.id);
  else
    for w in select * from public.task_watchers(t.id) loop
      if w is distinct from actor then
        perform public.notify_user(w, 'cheque_collected', 'info', title,
          'Your Check for ' || title || ' is Collected', '/tasks?task=' || t.id, t.id, 'chq_collected:' || new.id || ':' || w);
      end if;
    end loop;
  end if;
  return null;
end $$;
revoke execute on function public.cheque_collected_notify() from public, anon, authenticated;


-- 3. Recording a payment (the "Record payment" action) always failed.
--    task_add_payment declared a variable called `id` and then read `where id = p_task`; with PostgreSQL's
--    default setting that is "column reference "id" is ambiguous", so no payment could ever be recorded
--    (the live database has no payment line yet). Found by the test for A-14. The variable is renamed; the
--    rest of the function is unchanged.
create or replace function public.task_add_payment(
  p_task uuid, p_amount numeric, p_mode text default null, p_reference text default null, p_notes text default null, p_paid_on date default null
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare t tasks; new_id uuid;
begin
  if not public.task_can(p_task, true) then raise exception 'You cannot record a payment on this task'; end if;
  select * into t from tasks where id = p_task;
  if t.status in ('done', 'cancelled') then raise exception 'This task is closed; reopen it before recording a payment'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'The amount must be more than zero'; end if;
  insert into task_payments (task_id, amount, mode, reference, notes, paid_on)
  values (p_task, p_amount, p_mode, nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_paid_on, (now() at time zone 'Asia/Kolkata')::date))
  returning task_payments.id into new_id;
  return new_id;
end $$;
revoke execute on function public.task_add_payment(uuid, numeric, text, text, text, date) from public, anon;
grant execute on function public.task_add_payment(uuid, numeric, text, text, text, date) to authenticated;
