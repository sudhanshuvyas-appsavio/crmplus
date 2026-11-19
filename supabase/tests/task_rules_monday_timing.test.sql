-- Tests for 20261120100000_task_rules_monday_timing.sql (docs/monday-task-folder-analysis, document 12).
--
-- Run on a STAGING database (psql -f, or the SQL editor). Everything happens in
-- one transaction that is rolled back, so no data is kept. Dates are simulated
-- by passing p_now to run_task_rules. A failed check raises an exception that
-- names the case (TC-...); a pass prints a NOTICE.
--
-- Needs: two active profiles and at least one buyer in the database.

begin;

do $$
declare
  u1 uuid; u2 uuid; b uuid;
  t uuid; p uuid;
  n int; m text; st text; ds text;
begin
  select id into u1 from profiles where is_active order by created_at limit 1;
  select id into u2 from profiles where is_active and id <> u1 order by created_at limit 1;
  select id into b from buyer_master order by created_at limit 1;
  if u1 is null or u2 is null or b is null then
    raise exception 'The tests need two active profiles and one buyer';
  end if;

  ------------------------------------------------------------------ helper function
  if not public.task_rule_due('2026-03-18', 0, '17:45', '2026-03-18 17:50+05:30', 2) then raise exception 'TC-TIME: should be due at 17:50 IST'; end if;
  if public.task_rule_due('2026-03-18', 0, '17:45', '2026-03-18 17:30+05:30', 2) then raise exception 'TC-TIME: must not be due at 17:30 IST'; end if;
  if public.task_rule_due('2026-03-18', 0, '17:45', '2026-03-21 09:00+05:30', 2) then raise exception 'TC-TIME: must not be due after the window'; end if;
  if not public.task_rule_due('2026-03-18', 30, '10:00', '2026-04-17 10:05+05:30', 2) then raise exception 'TC-TIME: +30 days at 10:00 IST'; end if;
  raise notice 'ok TC-TIME';

  ------------------------------------------------------------------ TC-A2: not visited on the Created Date
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'TEST visit A2', u1, u2, '2026-03-18', '2026-04-17', '{}') returning id into t;

  perform public.run_task_rules('2026-03-18 17:30+05:30');
  select count(*) into n from notifications where task_id = t and kind = 'visit_missed';
  if n <> 0 then raise exception 'TC-A2a: nothing before 17:45 IST, got %', n; end if;

  perform public.run_task_rules('2026-03-18 17:50+05:30');
  select count(*) into n from notifications where task_id = t and kind = 'visit_missed';
  if n <> 2 then raise exception 'TC-A2a: Person and Accounts should be told, got %', n; end if;
  select message into m from notifications where task_id = t and kind = 'visit_missed' and user_id = u1;
  if m not like '%You have not visited yet.' then raise exception 'TC-A2a: wording, got %', m; end if;

  perform public.run_task_rules('2026-03-18 18:05+05:30');
  select count(*) into n from notifications where task_id = t and kind = 'visit_missed';
  if n <> 2 then raise exception 'TC-G4: a second run must add nothing, got %', n; end if;

  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'TEST visit A2b', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"visited"}') returning id into p;
  perform public.run_task_rules('2026-03-18 17:55+05:30');
  select count(*) into n from notifications where task_id = p and kind = 'visit_missed';
  if n <> 0 then raise exception 'TC-A2b: a visited visit must not be reminded, got %', n; end if;
  raise notice 'ok TC-A2';

  ------------------------------------------------------------------ TC-A3: visited, 30 days, no pending-payment test
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'TEST visit A3', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"visited","visited_on":"2026-03-18"}') returning id into t;
  perform public.run_task_rules('2026-04-16 10:30+05:30');
  select count(*) into n from notifications where task_id = t and kind = 'visit_unpaid';
  if n <> 0 then raise exception 'TC-A3: too early, got %', n; end if;
  perform public.run_task_rules('2026-04-17 10:05+05:30');
  select count(*) into n from notifications where task_id = t and kind = 'visit_unpaid';
  if n <> 2 then raise exception 'TC-A3: Person and Accounts should be told, got %', n; end if;
  raise notice 'ok TC-A3';

  ------------------------------------------------------------------ TC-A4/A5: escalation, one Payment Collection per step
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'TEST visit A4', u1, u2, '2026-03-18', '2026-04-17',
          '{"visit_status":"visited","visited_on":"2026-03-18","pending_payment":true}') returning id into t;

  perform public.run_task_rules('2026-04-17 17:30+05:30');
  select count(*) into n from tasks where source_task_id = t;
  if n <> 0 then raise exception 'TC-A4: before 18:00 IST nothing is created, got %', n; end if;

  perform public.run_task_rules('2026-04-17 18:05+05:30');
  select count(*) into n from tasks where source_task_id = t and task_type = 'payment_collection';
  if n <> 1 then raise exception 'TC-A4: one Payment Collection at 30 days, got %', n; end if;
  select title into m from tasks where source_task_id = t;
  if m <> 'Monthly Visit - TEST visit A4' then raise exception 'TC-A4: title, got %', m; end if;
  select count(*) into n from notifications where task_id = t and kind = 'payment_escalation';
  if n <> 2 then raise exception 'TC-A4: Person and Accounts told, got %', n; end if;
  select message into m from notifications where task_id = t and kind = 'payment_escalation' and user_id = u1;
  if m not like '%you have visited and not collected the payment after 30 days' then raise exception 'TC-A4: wording, got %', m; end if;

  perform public.run_task_rules('2026-04-17 18:20+05:30');
  select count(*) into n from tasks where source_task_id = t;
  if n <> 1 then raise exception 'TC-G4: a second run must not create another, got %', n; end if;

  perform public.run_task_rules('2026-05-02 22:20+05:30');
  select count(*) into n from tasks where source_task_id = t and task_type = 'payment_collection';
  if n <> 2 then raise exception 'TC-A5: a second Payment Collection at 45 days, got %', n; end if;
  raise notice 'ok TC-A4 TC-A5';

  ------------------------------------------------------------------ TC-A7: not visited branch (Created Date, Visited Date empty)
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'TEST visit A7', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"planned","pending_payment":true}') returning id into t;
  perform public.run_task_rules('2026-04-17 18:20+05:30');
  select message into m from notifications where task_id = t and kind = 'payment_escalation' and user_id = u1;
  if m is null or m not like '%you have not visited and not collected the payment after 30 days' then raise exception 'TC-A7: wording, got %', m; end if;

  ------------------------------------------------------------------ TC-A4b: Completed visits are left alone
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'TEST visit completed', u1, u2, '2026-03-18', '2026-04-17',
          '{"visit_status":"completed","visited_on":"2026-03-18","pending_payment":true}') returning id into t;
  perform public.run_task_rules('2026-04-17 18:20+05:30');
  select count(*) into n from tasks where source_task_id = t;
  if n <> 0 then raise exception 'TC-A4b: Completed visits are excluded, got %', n; end if;
  raise notice 'ok TC-A7 TC-A4b';

  ------------------------------------------------------------------ TC-A11: commission delivery, 18:30 IST on the Created Date
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details)
  values ('commission_invoice_delivery', 'TEST CID', u1, u2, '2026-03-18', '2026-03-20', '{"pending_payment":true}') returning id into t;
  perform public.run_task_rules('2026-03-18 18:20+05:30');
  select count(*) into n from tasks where source_task_id = t;
  if n <> 0 then raise exception 'TC-A11: before 18:30 IST nothing, got %', n; end if;
  perform public.run_task_rules('2026-03-18 18:35+05:30');
  select title into m from tasks where source_task_id = t;
  if m <> 'Commission Invoice - TEST CID' then raise exception 'TC-A11: title, got %', m; end if;
  select message into m from notifications where task_id = t and kind = 'payment_escalation' and user_id = u1;
  if m not like '%Payment is pending for this record.' then raise exception 'TC-A11: wording, got %', m; end if;
  raise notice 'ok TC-A11';

  ------------------------------------------------------------------ TC-A20: sample feedback, +7 days at 20:30 IST
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details)
  values ('sample_delivery', 'TEST sample', u1, u2, '2026-03-18', '2026-03-25', '{"delivery_date":"2026-03-18","feedback_status":"pending"}') returning id into t;
  perform public.run_task_rules('2026-03-25 20:00+05:30');
  select count(*) into n from notifications where task_id = t and kind = 'sample_feedback_due';
  if n <> 0 then raise exception 'TC-A20: before 20:30 IST nothing, got %', n; end if;
  perform public.run_task_rules('2026-03-25 20:35+05:30');
  select count(*) into n from notifications where task_id = t and kind = 'sample_feedback_due';
  if n <> 2 then raise exception 'TC-A20: Person and Accounts told, got %', n; end if;
  raise notice 'ok TC-A20';

  ------------------------------------------------------------------ TC-A10: mill proof sets Invoice Status, not Status
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, details)
  values ('mill_invoice_delivery', 'TEST mill', u1, u2, '{"delivery_status":"not_delivered"}') returning id into t;
  insert into task_attachments (task_id, kind, file_name, storage_path) values (t, 'proof', 'proof.jpg', 'tests/' || t || '/proof.jpg');
  select status, details->>'delivery_status' into st, ds from tasks where id = t;
  if ds <> 'delivered' then raise exception 'TC-A10: Invoice Status should be delivered, got %', ds; end if;
  if st <> 'todo' then raise exception 'TC-A10: the board status must stay as it was, got %', st; end if;
  select count(*) into n from notifications where task_id = t and kind = 'proof_received' and user_id = u2;
  if n <> 1 then raise exception 'TC-A10: Accounts should be told once, got %', n; end if;
  select message into m from notifications where task_id = t and kind = 'proof_received' and user_id = u2;
  if m not like '%Mill Invoice is delivered' then raise exception 'TC-A10: wording, got %', m; end if;
  select count(*) into n from notifications where task_id = t and user_id = u1 and kind = 'proof_received';
  if n <> 0 then raise exception 'TC-A10: only Accounts are told, got %', n; end if;
  raise notice 'ok TC-A10';

  ------------------------------------------------------------------ TC-A21: Person from the buyer's Messenger only
  update buyer_master set messenger_id = u2 where id = b;
  insert into tasks (task_type, title, buyer_id, details) values ('monthly_visit', 'TEST person', b, '{}') returning id into t;
  select assigned_to, accounts_staff_id::text into p, m from tasks where id = t;
  if p is distinct from u2 then raise exception 'TC-A21: Person should be the Messenger'; end if;
  if m is not null then raise exception 'TC-A21: Accounts must stay empty'; end if;
  update buyer_master set messenger_id = null where id = b;
  insert into tasks (task_type, title, buyer_id, details) values ('monthly_visit', 'TEST person none', b, '{}') returning id into t;
  select assigned_to into p from tasks where id = t;
  if p is not null then raise exception 'TC-A21: no Messenger means no Person'; end if;
  raise notice 'ok TC-A21';

  ------------------------------------------------------------------ the log
  select count(*) into n from task_rule_runs where outcome = 'fired';
  if n = 0 then raise exception 'TC-LOG: fired rules should be logged'; end if;
  select count(*) into n from task_rule_runs where outcome = 'summary';
  if n = 0 then raise exception 'TC-LOG: each run writes a summary'; end if;
  raise notice 'ok TC-LOG';
end $$;

rollback;
