-- End-to-end test of five Tasks boards on a realistic sample data set, with the scheduler simulated at its real
-- 15-minute cadence over two months:
--   Monthly Visit, Mill Invoice Delivery, Payment Collection, Cheque Collection, Sample Delivery
-- and the links between them (visit -> Payment Collection, order/dispatch -> Mill, buyers' Messengers -> Person).
-- (Transport Freight Invoice and Commission Invoice Delivery are not part of this scenario.)
--
-- Run with supabase/tests/local-harness (it creates the base tables). One transaction, rolled back.
-- Needs 20261120160000 and the earlier Tasks migrations. Every check prints "ok ..." or raises an exception.
--
-- Cast (all active): SK = admin; Jyoti = accounts (task.manage); Rahul Sharma = field (task.work);
-- Mohit = field (task.work). Buyers: KPR (Messenger Mohit), Vardhman (Messenger Rahul), SRI (no Messenger).

begin;

-- progress messages: the local harness captures them in a table; on another database they are NOTICEs
do $x$ begin
  if to_regprocedure('public.t_ok(text)') is null then
    create function public.t_ok(msg text) returns void language plpgsql as $f$ begin raise notice '%', msg; end $f$;
  end if;
end $x$;

-- scheduler simulator: run_task_rules at every 15 minutes between two moments
create or replace function public.t_sim(p_from timestamptz, p_to timestamptz) returns int language plpgsql as $$
declare ts timestamptz := p_from; n int := 0;
begin
  while ts <= p_to loop
    perform public.run_task_rules(ts);
    ts := ts + interval '15 minutes';
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
declare
  sk uuid; jy uuid; ra uuid; mo uuid;
  b1 uuid; b2 uuid; b3 uuid; s1 uuid;
  v1 uuid; v2 uuid; v3 uuid; v4 uuid;
  o1 uuid; o2 uuid; m1 uuid; m2 uuid; d1 uuid; d2 uuid;
  pc1 uuid; pc2 uuid; c1t uuid; c2t uuid; c3t uuid; c1 uuid; c2 uuid; c3 uuid;
  sa1 uuid; sa2 uuid; sa3 uuid;
  ticks int := 0; n int; n2 int; m text; st text; txt text; num numeric; aid uuid;
begin
  -- ------------------------------------------------------------------ cast and master data
  insert into profiles (id, name, is_admin) values (gen_random_uuid(), 'SK', true) returning id into sk;
  insert into profiles (name) values ('Jyoti') returning id into jy;
  insert into profiles (name) values ('Rahul Sharma') returning id into ra;
  insert into profiles (name) values ('Mohit') returning id into mo;
  insert into user_permissions (user_id, permission) values (jy, 'task.manage'), (ra, 'task.work'), (mo, 'task.work');
  insert into buyer_master (name, messenger_id) values ('KPR Mill Limited.', mo) returning id into b1;
  insert into buyer_master (name, messenger_id) values ('Vardhman Textiles Ltd.', ra) returning id into b2;
  insert into buyer_master (name) values ('SRI VALARAMATHI TEXTILES') returning id into b3;
  insert into supplier_master (name) values ('Arvind Private Limited') returning id into s1;

  -- ------------------------------------------------------------------ Monthly Visit
  insert into tasks (task_type, title, buyer_id, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'Visit KPR', b1, jy, '2026-03-18', '2026-04-17', '{"visit_status":"planned","pending_payment":true}') returning id into v1;
  insert into tasks (task_type, title, buyer_id, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'Visit Vardhman', b2, jy, '2026-03-18', '2026-04-17', '{"visit_status":"planned","pending_payment":true}') returning id into v2;
  insert into tasks (task_type, title, buyer_id, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'Visit SRI', b3, jy, '2026-03-18', '2026-04-17', '{"visit_status":"planned","pending_payment":false}') returning id into v3;
  select assigned_to into aid from tasks where id = v1;  if aid is distinct from mo then raise exception 'MV: Person of the KPR visit is its Messenger (Mohit)'; end if;
  select assigned_to into aid from tasks where id = v2;  if aid is distinct from ra then raise exception 'MV: Person of the Vardhman visit is its Messenger (Rahul)'; end if;
  select assigned_to into aid from tasks where id = v3;  if aid is not null then raise exception 'MV: a buyer with no Messenger leaves Person empty'; end if;
  perform public.t_ok('ok MV setup: Person comes from each buyer''s Messenger (Mohit, Rahul, none)');

  -- scheduler: 18 March 00:00 -> 20 March 12:00 IST
  ticks := ticks + public.t_sim('2026-03-18 00:00+05:30', '2026-03-20 12:00+05:30');

  -- Rahul visits Vardhman on 20 March: check in and out through the app's calls
  perform set_config('request.jwt.claim.sub', ra::text, true);
  set local role authenticated;
  perform public.task_check_in(v2, 26.9124, 75.7873, 12);
  perform public.task_check_out(v2, 'Discussed March payment; cheque promised.');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  select status, details->>'visit_status', details->>'visit_summary' into st, m, txt from tasks where id = v2;
  if st <> 'in_progress' or m <> 'visited' or txt is null then raise exception 'MV check-in: status in progress, visit Visited, summary kept (got %, %, %)', st, m, txt; end if;
  select (check_in_at is not null and check_out_at is not null and lat is not null)::text into txt from tasks where id = v2;
  if txt <> 'true' then raise exception 'MV check-in: time in, time out and position recorded'; end if;
  perform public.t_ok('ok MV check-in and check-out ran as the field person (visit Visited, summary and position kept)');
  -- the real clock is used by the RPC; the scenario needs the simulated visit day
  update tasks set details = details || '{"visited_on":"2026-03-20"}' where id = v2;

  -- a completed visit that must stay out of the escalations
  insert into tasks (task_type, title, buyer_id, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'Visit KPR (done)', b1, jy, '2026-03-25', '2026-04-24', '{"visit_status":"completed","visited_on":"2026-03-25","pending_payment":true}') returning id into v4;

  ticks := ticks + public.t_sim('2026-03-20 12:15+05:30', '2026-03-24 00:00+05:30');

  -- ------------------------------------------------------------------ Mill Invoice Delivery (24 March)
  insert into orders (order_no, buyer_id, supplier_id) values ('S-001', b1, s1) returning id into o1;
  insert into orders (order_no, buyer_id, supplier_id) values ('S-002', b2, s1) returning id into o2;
  select id into m1 from tasks where dedupe_key = 'mill_inv_order:' || o1;
  select id into m2 from tasks where dedupe_key = 'mill_inv_order:' || o2;
  if m1 is null or m2 is null then raise exception 'MILL: each new Dispatch and Billing item creates a Mill task'; end if;
  select assigned_to into aid from tasks where id = m1; if aid is distinct from mo then raise exception 'MILL: Person of S-001 is Mohit'; end if;
  select assigned_to into aid from tasks where id = m2; if aid is distinct from ra then raise exception 'MILL: Person of S-002 is Rahul'; end if;
  update tasks set accounts_staff_id = jy where id in (m1, m2);
  update tasks set due_date = '2026-03-27' where id = m2;
  perform public.t_ok('ok MILL created from Dispatch and Billing items (S-001, S-002), Person from Messenger');

  -- samples
  insert into tasks (task_type, title, buyer_id, supplier_id, accounts_staff_id, details)
  values ('sample_delivery', 'Sample KPR lot 1', b1, s1, jy, '{"delivery_date":"2026-03-26","feedback_status":"pending","sample_quality":"30s combed","sample_lot":"L-1"}') returning id into sa1;
  insert into tasks (task_type, title, buyer_id, supplier_id, accounts_staff_id, details)
  values ('sample_delivery', 'Sample KPR lot 2', b1, s1, jy, '{"delivery_date":"2026-03-26","feedback_status":"approved"}') returning id into sa2;
  insert into tasks (task_type, title, buyer_id, supplier_id, accounts_staff_id, details)
  values ('sample_delivery', 'Sample Vardhman lot 3', b2, s1, jy, '{"delivery_date":"2026-04-10","feedback_status":"pending"}') returning id into sa3;

  ticks := ticks + public.t_sim('2026-03-24 00:15+05:30', '2026-03-25 12:00+05:30');

  -- dispatches on 25 March: S-001 invoice INV-001; S-002 invoice entered wrongly, then corrected
  insert into order_dispatches (order_id, mill_invoice_no, mill_invoice_date) values (o1, 'INV-001', '2026-03-25') returning id into d1;
  insert into order_dispatches (order_id, mill_invoice_no, mill_invoice_date) values (o2, 'INV-002', '2026-03-25') returning id into d2;
  update order_dispatches set mill_invoice_no = 'INV-002B' where id = d2;
  select count(*) into n from tasks where task_type = 'mill_invoice_delivery' and order_id in (o1, o2);
  if n <> 2 then raise exception 'MILL: one task per order, also after the invoice number was corrected (got %)', n; end if;
  select count(*) into n from board_mill_invoice_delivery where dispatch_and_billing_id in (d1, d2) and invoice_number in ('INV-001', 'INV-002B');
  if n <> 2 then raise exception 'MILL link: the board shows each task''s dispatch and invoice number (got %)', n; end if;
  perform public.t_ok('ok MILL linked to its dispatch, invoice number corrected without a second task');

  -- cheques (26 March)
  insert into tasks (task_type, title, buyer_id, accounts_staff_id, details) values ('cheque_collection', 'Cheque 100234 - KPR', b1, jy, '{}') returning id into c1t;
  insert into tasks (task_type, title, buyer_id, details) values ('cheque_collection', 'Cheque 100235 - Vardhman', b2, '{}') returning id into c2t;
  insert into tasks (task_type, title, buyer_id, accounts_staff_id, details) values ('cheque_collection', 'Cheque 100236 - KPR', b1, jy, '{}') returning id into c3t;
  insert into task_cheques (task_id, buyer_id, cheque_no, amount, bank_name, cheque_date, collection_date) values (c1t, b1, '100234', 120000, 'HDFC Bank', '2026-03-30', '2026-03-26') returning id into c1;
  insert into task_cheques (task_id, buyer_id, cheque_no, amount, bank_name, cheque_date, collection_date) values (c2t, b2, '100235', 80000, 'SBI', '2026-04-05', '2026-03-26') returning id into c2;
  insert into task_cheques (task_id, buyer_id, cheque_no, amount, bank_name, cheque_date, collection_date) values (c3t, b1, '100236', 45000, 'HDFC Bank', '2026-04-10', '2026-03-26') returning id into c3;

  ticks := ticks + public.t_sim('2026-03-25 12:15+05:30', '2026-03-27 12:00+05:30');

  -- 27 March: Mohit delivers S-001 (proof) and collects cheque 100234 (photo)
  perform set_config('request.jwt.claim.sub', mo::text, true);
  set local role authenticated;
  insert into task_attachments (task_id, kind, file_name, storage_path) values (m1, 'proof', 'delivery.jpg', 'task-proofs/' || m1 || '/delivery.jpg');
  insert into task_attachments (task_id, kind, file_name, storage_path) values (c1t, 'photo', 'cheque.jpg', 'task-proofs/' || c1t || '/cheque.jpg');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  select details->>'delivery_status', status into m, st from tasks where id = m1;
  if m <> 'delivered' or st <> 'in_progress' then raise exception 'MILL: proof sets Invoice Status Delivered and leaves Status (got % / %)', m, st; end if;
  select status into st from task_cheques where id = c1;
  if st <> 'collected' then raise exception 'CHEQUE: the photo marks the cheque Collected (got %)', st; end if;
  perform public.t_ok('ok MILL proof and CHEQUE photo uploaded as a field person (RLS applied)');

  ticks := ticks + public.t_sim('2026-03-27 12:15+05:30', '2026-03-30 00:00+05:30');

  -- 30 March: Jyoti deposits cheque 100234 and marks cheque 100235 collected (no photo)
  perform set_config('request.jwt.claim.sub', jy::text, true);
  set local role authenticated;
  update task_cheques set status = 'deposited', deposit_bank = 'ICICI Bank', slip_no = 'SLIP-77' where id = c1;
  update task_cheques set status = 'collected' where id = c2;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  ticks := ticks + public.t_sim('2026-03-30 00:15+05:30', '2026-04-02 12:00+05:30');
  update task_cheques set status = 'cleared' where id = c1;

  ticks := ticks + public.t_sim('2026-04-02 12:15+05:30', '2026-04-20 12:00+05:30');

  -- 20 April: the escalations of the visits have created their Payment Collection items; Jyoti collects on Vardhman's
  select id into pc1 from tasks where source_task_id = v1 and details->>'step_days' = '30';
  select id into pc2 from tasks where source_task_id = v2 and details->>'step_days' = '30';
  if pc1 is null or pc2 is null then raise exception 'PC: day-30 payments exist for both visits (got % / %)', pc1, pc2; end if;
  perform set_config('request.jwt.claim.sub', jy::text, true);
  set local role authenticated;
  update tasks set amount = 50000, details = details || '{"invoice_no":"INV-001"}' where id = pc2;
  perform public.task_add_payment(pc2, 20000, 'cash', 'RCPT-1', null, null);
  perform public.task_add_payment(pc2, 30000, 'online', 'UTR-9', null, null);
  insert into task_subitems (task_id, name, owner_id, status) values (pc2, 'Collect balance cheque', ra, 'done');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  ticks := ticks + public.t_sim('2026-04-20 12:15+05:30', '2026-05-21 00:00+05:30');
  perform public.t_ok('simulated ' || ticks || ' scheduler runs (every 15 minutes, 18 March to 21 May)');

  ------------------------------------------------------------------ RESULTS: Monthly Visit
  select count(*) into n from notifications where kind = 'visit_missed' and task_id in (select id from tasks where created_at = now());
  if n <> 5 then raise exception 'MV A-2: Visit KPR 2 + Visit Vardhman 2 + Visit SRI 1 (Accounts only) = 5, got %', n; end if;
  select count(*) into n from notifications where kind = 'visit_missed' and task_id = v4;
  if n <> 0 then raise exception 'MV A-2: a completed visit is not reminded'; end if;
  perform public.t_ok('ok MV A-2: 5 "You have not visited yet." (Person + Accounts; Accounts only for the buyer with no Messenger; none for the completed visit)');

  select count(*) into n from notifications where kind = 'visit_unpaid' and task_id in (select id from tasks where created_at = now());
  select count(*) into n2 from notifications where kind = 'visit_unpaid' and task_id = v2;
  if n <> 2 or n2 <> 2 then raise exception 'MV A-3: only the visited Vardhman visit (2 notifications), got % / %', n, n2; end if;
  perform public.t_ok('ok MV A-3: 2 reminders, only for the visit that was visited');

  select count(*) into n from tasks where task_type = 'payment_collection' and source_task_id in (v1, v2);
  select count(*) into n2 from tasks where task_type = 'payment_collection' and source_task_id in (v3, v4);
  if n <> 6 or n2 <> 0 then raise exception 'MV A-4..A-9: 3 payments for each of two visits and none for Pending = No or Completed (got % / %)', n, n2; end if;
  select count(*) into n from notifications where kind = 'payment_escalation' and task_id in (select id from tasks where created_at = now());
  if n <> 12 then raise exception 'MV A-4..A-9: 12 escalation notifications, got %', n; end if;
  select count(*) into n from tasks where source_task_id = v1 and priority = 'normal'; select count(*) into n2 from tasks where source_task_id = v1 and priority = 'urgent';
  if n <> 1 or n2 <> 1 then raise exception 'MV: step priorities normal / high / urgent'; end if;
  perform public.t_ok('ok MV A-4..A-9: 6 Payment Collection items (3 per visit), 12 notifications, none for Pending = No or a Completed visit');

  ------------------------------------------------------------------ RESULTS: Payment Collection (and its links)
  select amount_collected, status, (completed_at is not null)::text into num, st, m from tasks where id = pc2;
  if num <> 50000 or st <> 'done' or m <> 'true' then raise exception 'PC: 50000 collected completes the task (got %, %, %)', num, st, m; end if;
  select count(*) into n from notifications where task_id = pc2 and kind = 'payment_collected' and user_id = ra;
  select count(*) into n2 from notifications where task_id = pc2 and kind = 'payment_collected' and user_id = jy;
  if n <> 2 or n2 <> 0 then raise exception 'PC A-14: Rahul told twice, Jyoti (who recorded) not told, got % / %', n, n2; end if;
  select count(*) into n from notifications where task_id = pc2 and kind = 'payment_collected' and message = 'Hey, Rahul Sharma, Amount collected is 50000';
  if n <> 1 then raise exception 'PC A-14: the second message states the total (50000)'; end if;
  select payment_status, balance_amount, connected_board into m, num, st from board_payment_collection where id = pc2;
  if m <> 'Completed' or num <> 0 or st <> 'Monthly Visit' then raise exception 'PC view: Completed / 0 / Monthly Visit, got % / % / %', m, num, st; end if;
  select count(*) into n from board_payment_collection where payment_status = 'Outstanding' and connected_board = 'Monthly Visit' and created_at = now();
  if n <> 5 then raise exception 'PC: the other 5 payments are Outstanding and linked to their visit, got %', n; end if;
  select count(*) into n from task_subitems where task_id = pc2;
  if n <> 1 then raise exception 'PC: the subitem was added'; end if;
  perform public.t_ok('ok PC: payments linked to their visits; 20000 + 30000 recorded; Completed with End Date; notifications greet Rahul with the running total; subitem added');

  -- links back from the visits
  select count(*) into n from board_monthly_visit where id in (v1, v2) and payment_collection_id is not null;
  select count(*) into n2 from board_monthly_visit where id in (v3, v4) and payment_collection_id is null;
  if n <> 2 or n2 <> 2 then raise exception 'LINK visit -> payment: visits with payments link them, the others do not (got % / %)', n, n2; end if;
  perform public.t_ok('ok LINK Monthly Visit <-> Payment Collection (both directions)');

  ------------------------------------------------------------------ RESULTS: Mill Invoice Delivery
  select count(*) into n from notifications where kind = 'proof_received' and task_id = m1 and user_id = jy and message = 'Hey, Jyoti, Mill Invoice is delivered';
  if n <> 1 then raise exception 'MILL A-10: Jyoti told once with monday''s text, got %', n; end if;
  select count(*) into n from notifications where kind = 'task_overdue' and task_id = m1;
  select count(*) into n2 from notifications where kind = 'task_overdue' and task_id = m2 and user_id = ra;
  if n <> 0 or n2 <> 1 then raise exception 'MILL overdue: the delivered S-001 is never overdue, the open S-002 is reported once (got % / %)', n, n2; end if;
  perform public.t_ok('ok MILL: delivered invoice notified Accounts once and never goes overdue; the open one is reported once');

  ------------------------------------------------------------------ RESULTS: Sample Delivery
  select count(*) into n from notifications where kind = 'sample_feedback_due' and task_id in (select id from tasks where created_at = now());
  select count(*) into n2 from notifications where kind = 'sample_feedback_due' and task_id in (sa1, sa3);
  if n <> 4 or n2 <> 4 then raise exception 'SAMPLE A-20: lots 1 and 3 (pending) told Person + Accounts = 4, got % / %', n, n2; end if;
  select count(*) into n from board_sample_delivery where buyer_messenger is not null and feedback_due_date is not null and created_at = now();
  if n <> 3 then raise exception 'SAMPLE view: Messenger and Feedback Due Date on all 3, got %', n; end if;
  select to_char(feedback_due_date, 'YYYY-MM-DD') into m from board_sample_delivery where id = sa3;
  if m <> '2026-04-17' then raise exception 'SAMPLE view: Feedback Due Date = Delivery Date + 7, got %', m; end if;
  perform public.t_ok('ok SAMPLE A-20: 4 reminders for the two pending samples, none for the approved one; Feedback Due Date = Delivery Date + 7');

  ------------------------------------------------------------------ RESULTS: Cheque Collection
  select count(*) into n from notifications where kind = 'cheque_collected' and task_id = c1t and user_id = jy and message = 'Your Check for Cheque 100234 - KPR is Collected';
  select count(*) into n2 from notifications where kind = 'cheque_collected' and task_id = c2t and user_id = ra;
  if n <> 1 or n2 <> 1 then raise exception 'CHEQUE A-17: Jyoti told for 100234, Rahul (Person) told for 100235 which had no Accounts (got % / %)', n, n2; end if;
  select count(*) into n from notifications where kind = 'cheque_collected' and task_id = c3t;
  if n <> 0 then raise exception 'CHEQUE: the pending cheque 100236 notifies nobody'; end if;
  select group_name, deposit_status into st, m from board_cheque_collection where task_id = c3t;
  if st <> 'To Collect' or m <> 'Pending' then raise exception 'CHEQUE view: 100236 To Collect / Pending'; end if;
  select group_name, deposit_status into st, m from board_cheque_collection where task_id = c1t;
  if st <> 'Collected' or m <> 'Cleared' then raise exception 'CHEQUE view: 100234 Collected / Cleared, got % / %', st, m; end if;
  select group_name, deposit_status into st, m from board_cheque_collection where task_id = c2t;
  if st <> 'Collected' or m <> 'Collected' then raise exception 'CHEQUE view: 100235 Collected / Collected, got % / %', st, m; end if;
  select assigned_to into aid from tasks where id = c1t; if aid is distinct from mo then raise exception 'CHEQUE A-27: Person of 100234 is Mohit'; end if;
  select assigned_to into aid from tasks where id = c2t; if aid is distinct from ra then raise exception 'CHEQUE A-27: Person of 100235 is Rahul'; end if;
  perform public.t_ok('ok CHEQUE: photo -> Collected -> Deposited -> Cleared; fallback notification for the cheque without Accounts; pending cheque silent; Person from Messenger');

  ------------------------------------------------------------------ permissions on subitems and rows (field staff)
  perform set_config('request.jwt.claim.sub', ra::text, true);
  set local role authenticated;
  begin
    insert into task_subitems (task_id, name) values (c1t, 'Not mine');
    reset role;
    raise exception 'RLS: Rahul must not add a subitem to a cheque assigned to Mohit';
  exception when others then
    reset role;
    if sqlerrm like 'RLS:%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.t_ok('ok RLS: a field person cannot add a subitem to someone else''s task');

  ------------------------------------------------------------------ the scheduler itself
  select count(*) into n from task_rule_runs where outcome = 'failed' and run_at = now();
  if n <> 0 then raise exception 'SCHEDULER: no rule failed, got % failures', n; end if;
  select count(*) into n from task_rule_runs where outcome = 'summary' and run_at = now();
  if n <> ticks then raise exception 'SCHEDULER: every run is logged (% runs, % logged)', ticks, n; end if;
  select count(*) into n from (select user_id, dedupe_key from notifications where dedupe_key is not null group by 1, 2 having count(*) > 1) x;
  if n <> 0 then raise exception 'SCHEDULER: no duplicate notification, got %', n; end if;
  select count(*) into n from (select dedupe_key from tasks where dedupe_key is not null group by 1 having count(*) > 1) x;
  if n <> 0 then raise exception 'SCHEDULER: no duplicate task key'; end if;
  perform public.t_ok('ok SCHEDULER: ' || ticks || ' runs, 0 failures, no duplicate notification or task');
end $$;

rollback;
