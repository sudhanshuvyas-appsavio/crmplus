-- Tests for the automations of the seven Tasks boards (docs/monday-task-folder-analysis, documents 05 and 12),
-- Mill Invoice Delivery first, then Commission, Payment Collection, Cheque Collection, Transport Freight
-- Invoice and Sample/Monthly Visit helpers not covered by task_rules_monday_timing.test.sql.
--
-- Run on a STAGING database. One transaction, rolled back. A failed check raises an exception naming the
-- case; a pass prints a NOTICE.
--
-- Needs: three active profiles and one buyer. The Dispatch and Billing parts insert rows into orders,
-- order_dispatches and commission_invoices with only the columns named below; if the real tables have other
-- NOT NULL columns, add them to those inserts (the Tasks automations read nothing else).
-- Needs the migrations through 20261120110000_crm_automations_round2.sql (it creates the Mill task when a
-- Dispatch and Billing item is created).

begin;

do $$
declare
  u1 uuid; u2 uuid; u3 uuid; b uuid; s uuid; o uuid; d uuid; d2 uuid; ci uuid;
  t uuid; t2 uuid; t3 uuid; n int; m text; st text; ds text; dedupe text; aid uuid; ttl text;
begin
  select id into u1 from profiles where is_active order by created_at, id limit 1;
  select id into u2 from profiles where is_active and id <> u1 order by created_at, id limit 1;
  select id into u3 from profiles where is_active and id not in (u1, u2) order by created_at, id limit 1;
  select id into b from buyer_master order by created_at, id limit 1;
  if u3 is null or b is null then raise exception 'The tests need three active profiles and one buyer'; end if;
  insert into supplier_master (name) values ('TEST supplier') returning id into s;
  update buyer_master set messenger_id = u3 where id = b;

  ------------------------------------------------------------------ MILL: D&B item created creates the Mill task
  insert into orders (order_no, buyer_id, supplier_id) values ('TEST-S-1', b, s) returning id into o;
  select id, title, status, assigned_to, accounts_staff_id::text, details->>'delivery_status'
    into t, ttl, st, aid, m, ds from tasks where dedupe_key = 'mill_inv_order:' || o;
  if t is null then raise exception 'MILL-CREATE: a new Dispatch and Billing item must create a Mill Invoice Delivery task'; end if;
  if ttl <> 'TEST-S-1 - Task' then raise exception 'MILL-CREATE: name "{name} - Task", got %', ttl; end if;
  if st <> 'in_progress' then raise exception 'MILL-CREATE: board status Working on it (in_progress), got %', st; end if;
  if aid is distinct from u3 then raise exception 'MILL-CREATE/A-23: Person must be the buyer Messenger'; end if;
  if m is not null then raise exception 'MILL-CREATE: Accounts must stay empty'; end if;
  if ds <> 'not_delivered' then raise exception 'MILL-CREATE: Invoice Status Not Delivered, got %', ds; end if;
  select count(*) into n from tasks where order_id = o and task_type = 'mill_invoice_delivery';
  if n <> 1 then raise exception 'MILL-CREATE: exactly one task, got %', n; end if;
  raise notice 'ok MILL-CREATE (Dispatch and Billing item creates its Mill task; A-23 Person from Messenger)';

  ------------------------------------------------------------------ MILL: the mill invoice fills that task; no duplicates
  insert into order_dispatches (order_id, mill_invoice_no, mill_invoice_date) values (o, 'INV-1', '2026-03-03') returning id into d;
  select count(*) into n from tasks where order_id = o and task_type = 'mill_invoice_delivery';
  if n <> 1 then raise exception 'MILL-INVOICE: the invoice must fill the open task, not add one (got %)', n; end if;
  select title, dispatch_id, details->>'invoice_no' into ttl, aid, m from tasks where id = t;
  if aid is distinct from d or m <> 'INV-1' or ttl <> 'Deliver mill invoice INV-1 (TEST-S-1)' then raise exception 'MILL-INVOICE: task not linked or filled (%, %)', ttl, m; end if;

  update order_dispatches set mill_invoice_no = 'INV-1B' where id = d;
  select count(*) into n from tasks where order_id = o and task_type = 'mill_invoice_delivery';
  if n <> 1 then raise exception 'MILL-EDIT: correcting the invoice number must not create a second delivery task (got % tasks)', n; end if;
  raise notice 'ok MILL-INVOICE / MILL-EDIT';

  ------------------------------------------------------------------ MILL: A-10 proof
  update tasks set accounts_staff_id = u2 where id = t;
  insert into task_attachments (task_id, kind, file_name, storage_path) values (t, 'document', 'note.pdf', 'tests/' || t || '/note.pdf');
  select details->>'delivery_status' into ds from tasks where id = t;
  if ds <> 'not_delivered' then raise exception 'A-10: a document is not proof, status was %', ds; end if;
  insert into task_attachments (task_id, kind, file_name, storage_path) values (t, 'proof', 'proof.jpg', 'tests/' || t || '/proof.jpg');
  select status, details->>'delivery_status' into st, ds from tasks where id = t;
  if ds <> 'delivered' then raise exception 'A-10: Invoice Status should be Delivered, got %', ds; end if;
  if st <> 'in_progress' then raise exception 'A-10: board Status must stay Working on it, got %', st; end if;
  select count(*), min(message) into n, m from notifications where task_id = t and kind = 'proof_received' and user_id = u2;
  if n <> 1 or m <> 'Hey, Accounts Two, Mill Invoice is delivered' then raise exception 'A-10: Accounts notified once with monday text, got % / %', n, m; end if;
  select count(*) into n from notifications where task_id = t and kind = 'proof_received' and user_id <> u2;
  if n <> 0 then raise exception 'A-10: only Accounts are told, got %', n; end if;
  insert into task_attachments (task_id, kind, file_name, storage_path) values (t, 'photo', 'again.jpg', 'tests/' || t || '/again.jpg');
  select count(*) into n from notifications where task_id = t and kind = 'proof_received';
  if n <> 1 then raise exception 'A-10: a second proof must not notify again, got %', n; end if;
  raise notice 'ok A-10 (proof: Invoice Status Delivered, Status unchanged, Accounts told once)';

  -- no Accounts person: Person is told instead
  insert into tasks (task_type, title, assigned_to, details) values ('mill_invoice_delivery', 'TEST mill noacc', u1, '{"delivery_status":"not_delivered"}') returning id into t3;
  insert into task_attachments (task_id, kind, file_name, storage_path) values (t3, 'proof', 'p.jpg', 'tests/' || t3 || '/p.jpg');
  select count(*) into n from notifications where task_id = t3 and user_id = u1 and kind = 'proof_received';
  if n <> 1 then raise exception 'A-10: without Accounts the Person is told, got %', n; end if;
  raise notice 'ok A-10b (no Accounts person)';

  ------------------------------------------------------------------ MILL: the grid view (monday columns)
  select status, invoice_status, buyer_messenger, invoice_number into st, ds, m, ttl from board_mill_invoice_delivery where id = t;
  if st <> 'Working on it' or ds <> 'Delivered' or ttl <> 'INV-1B' or m is distinct from (select name from profiles where id = u3) then
    raise exception 'MILL-VIEW: status %, invoice status %, invoice %, messenger %', st, ds, ttl, m;
  end if;
  raise notice 'ok MILL-VIEW (board_mill_invoice_delivery reads)';

  ------------------------------------------------------------------ MILL: overdue skips delivered invoices, raises for open ones
  insert into tasks (task_type, title, assigned_to, due_date, details) values ('mill_invoice_delivery', 'TEST mill open', u1, '2026-01-01', '{"delivery_status":"not_delivered"}') returning id into t2;
  update tasks set due_date = '2026-01-01' where id = t;
  perform public.run_task_rules('2026-03-01 10:00+05:30');
  select count(*) into n from notifications where task_id = t and kind = 'task_overdue';
  if n <> 0 then raise exception 'MILL-OVERDUE: a delivered invoice is not overdue, got %', n; end if;
  select count(*) into n from notifications where task_id = t2 and kind = 'task_overdue';
  if n <> 1 then raise exception 'MILL-OVERDUE: an open overdue delivery is reported once, got %', n; end if;
  raise notice 'ok MILL-OVERDUE';

  ------------------------------------------------------------------ MILL: A-24 buyer changes -> Person follows the Messenger
  update tasks set buyer_id = null, assigned_to = u1 where id = t2;
  update tasks set buyer_id = b where id = t2;
  select assigned_to into aid from tasks where id = t2;
  if aid is distinct from u3 then raise exception 'A-24: changing the buyer must set Person to the Messenger'; end if;
  raise notice 'ok A-24';

  ------------------------------------------------------------------ COMMISSION: invoice creates the delivery task
  insert into commission_invoices (order_id, buyer_id, supplier_id, invoice_no, invoice_date, amount) values (o, b, s, 'CI-1', '2026-03-03', 5000) returning id into ci;
  select id, assigned_to, amount, details->>'invoice_no' into t, aid, n, m from tasks where dedupe_key = 'ci:' || ci;
  if t is null or aid is distinct from u3 or n <> 5000 or m <> 'CI-1' then raise exception 'COMMISSION-CREATE: task, Messenger Person, amount, invoice number'; end if;
  raise notice 'ok COMMISSION-CREATE (A-25/A-26 Person from Messenger)';

  ------------------------------------------------------------------ PAYMENT COLLECTION: A-13, A-14, A-15
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, amount) values ('payment_collection', 'TEST pay', u1, u2, 10000) returning id into t;
  select to_char(start_date, 'YYYY-MM-DD') into m from tasks where id = t;
  if m <> to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') then raise exception 'A-13: Start Date is today, got %', m; end if;
  insert into task_payments (task_id, amount, mode) values (t, 4000, 'cash');
  select amount_collected, status into n, st from tasks where id = t;
  if n <> 4000 or st = 'done' then raise exception 'A-14: collected 4000 and still open, got % / %', n, st; end if;
  select count(*) into n from notifications where task_id = t and kind = 'payment_collected' and message like 'Amount collected is 4000%';
  if n <> 2 then raise exception 'A-14: Person and Accounts told, got %', n; end if;
  insert into task_payments (task_id, amount, mode) values (t, 6000, 'cash');
  select status, (completed_at is not null)::text into st, m from tasks where id = t;
  if st <> 'done' or m <> 'true' then raise exception 'A-15: fully paid completes the task and stamps End Date, got % / %', st, m; end if;
  update tasks set status = 'todo' where id = t;
  select (completed_at is null)::text into m from tasks where id = t;
  if m <> 'true' then raise exception 'A-15: reopening clears End Date'; end if;
  raise notice 'ok A-13 A-14 A-15 (Payment Collection)';

  ------------------------------------------------------------------ CHEQUE COLLECTION: A-17
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, details) values ('cheque_collection', 'TEST cheque', u1, u2, '{}') returning id into t;
  insert into task_cheques (task_id, cheque_no, amount, bank_name) values (t, 'TEST-CHQ-1', 100, 'Test Bank');
  select status into st from task_cheques where task_id = t;
  if st <> 'pending' then raise exception 'A-17: a new cheque is pending, got %', st; end if;
  select count(*) into n from notifications where task_id = t and kind = 'cheque_collected';
  if n <> 0 then raise exception 'A-17: nothing before the photo, got %', n; end if;
  insert into task_attachments (task_id, kind, file_name, storage_path) values (t, 'photo', 'chq.jpg', 'tests/' || t || '/chq.jpg');
  select status into st from task_cheques where task_id = t;
  if st <> 'collected' then raise exception 'A-17: the photo marks the cheque Collected, got %', st; end if;
  select count(*), min(message) into n, m from notifications where task_id = t and kind = 'cheque_collected' and user_id = u2;
  if n <> 1 or m <> 'Your Check for TEST cheque is Collected' then raise exception 'A-17: Accounts told once, got % / %', n, m; end if;
  insert into task_attachments (task_id, kind, file_name, storage_path) values (t, 'photo', 'chq2.jpg', 'tests/' || t || '/chq2.jpg');
  select count(*) into n from notifications where task_id = t and kind = 'cheque_collected';
  if n <> 1 then raise exception 'A-17: a second photo does not notify again, got %', n; end if;
  begin
    insert into task_cheques (task_id, cheque_no, amount, bank_name) values (t, 'test-chq-1 ', 50, 'TEST BANK');
    raise exception 'TC-CH2: the same cheque number and bank must be refused';
  exception when unique_violation then null;
  end;
  raise notice 'ok A-17 (Cheque Collection)';

  ------------------------------------------------------------------ FREIGHT: A-18 and creation from the dispatch
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, details) values ('freight_bill_check', 'TEST freight', u1, u2, '{"check_status":"cleared"}') returning id into t;
  select count(*) into n from notifications where task_id = t and kind = 'freight_outstanding';
  if n <> 0 then raise exception 'A-18: Cleared does not notify'; end if;
  update tasks set details = details || '{"check_status":"outstanding"}' where id = t;
  select count(*), min(message) into n, m from notifications where task_id = t and kind = 'freight_outstanding' and user_id = u1;
  if n <> 1 or m <> 'Hey, Person One, The payment for TEST freight is Outstanding' then raise exception 'A-18: Person told with monday text, got % / %', n, m; end if;
  select count(*) into n from notifications where task_id = t and kind = 'freight_outstanding';
  if n <> 2 then raise exception 'A-18: Person and Accounts told, got %', n; end if;
  update tasks set details = details || '{"load_reference":"LR-9"}' where id = t;
  select count(*) into n from notifications where task_id = t and kind = 'freight_outstanding';
  if n <> 2 then raise exception 'A-18: another edit must not notify again, got %', n; end if;
  insert into order_dispatches (order_id, transporter_invoice_no, transporter_invoice_amount) values (o, 'T-1', 900) returning id into d2;
  select id, amount, details->>'bill_no', details->>'check_status' into t, n, m, ds from tasks where dedupe_key = 'freight:' || d2;
  if t is null or n <> 900 or m <> 'T-1' or ds <> 'outstanding' then raise exception 'FREIGHT-CREATE: a transport bill creates one freight task'; end if;
  raise notice 'ok A-18 FREIGHT-CREATE';

  ------------------------------------------------------------------ SAMPLE: A-29/A-30 Person from the buyer's Messenger
  insert into tasks (task_type, title, buyer_id, details) values ('sample_delivery', 'TEST sample msgr', b, '{}') returning id into t;
  select assigned_to into aid from tasks where id = t;
  if aid is distinct from u3 then raise exception 'A-29: Person must be the buyer Messenger'; end if;
  raise notice 'ok A-29/A-30';
end $$;

------------------------------------------------------------------ PERMISSIONS (as a signed-in worker)
do $$
declare u1 uuid; u3 uuid; own uuid; other uuid; n int;
begin
  select id into u1 from profiles where is_active order by created_at, id limit 1;
  select id into u3 from profiles where is_active and id <> u1 order by created_at, id offset 1 limit 1;
  insert into user_permissions (user_id, permission) values (u1, 'task.work');
  insert into tasks (task_type, title, assigned_to, details) values ('mill_invoice_delivery', 'TEST own', u1, '{"delivery_status":"not_delivered"}') returning id into own;
  insert into tasks (task_type, title, assigned_to, details) values ('mill_invoice_delivery', 'TEST other', u3, '{"delivery_status":"not_delivered"}') returning id into other;

  perform set_config('request.jwt.claim.sub', u1::text, true);
  set local role authenticated;

  update tasks set notes = 'worker note' where id = own;
  get diagnostics n = row_count;
  if n <> 1 then reset role; raise exception 'TC-PERM-1: a worker updates notes on their own task'; end if;
  update tasks set status = 'in_progress' where id = other;
  get diagnostics n = row_count;
  if n <> 0 then reset role; raise exception 'TC-PERM-1: a worker must not change someone else''s task'; end if;
  begin
    update tasks set assigned_to = u3 where id = own;
    reset role;
    raise exception 'TC-PERM-1: a worker must not reassign';
  exception when others then
    reset role;
    if sqlerrm like 'TC-PERM-1%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'ok TC-PERM-1 (worker rights on Mill tasks)';
end $$;

------------------------------------------------------------------ RULE RUN: one failing row does not stop the others (F-42)
do $$
declare u1 uuid; u2 uuid; bad uuid; ok_t uuid; bad_t uuid; n int; f int;
begin
  select id into u1 from profiles where is_active order by created_at, id limit 1;
  select id into bad from profiles where is_active and id <> u1 order by created_at, id limit 1;
  execute replace('create function public.t_boom() returns trigger language plpgsql as $f$ begin if new.user_id = ''%BAD%'' then raise exception ''poisoned recipient''; end if; return new; end $f$', '%BAD%', bad::text);

  insert into tasks (task_type, title, assigned_to, start_date, due_date, details) values ('monthly_visit', 'TEST poison', bad, '2026-03-18', '2026-04-17', '{}') returning id into bad_t;
  insert into tasks (task_type, title, assigned_to, start_date, due_date, details) values ('monthly_visit', 'TEST healthy', u1, '2026-03-18', '2026-04-17', '{}') returning id into ok_t;
  -- the poison goes in only now: creating the tasks above also notifies their assignee
  create trigger t_boom before insert on public.notifications for each row execute function public.t_boom();
  perform public.run_task_rules('2026-03-18 17:50+05:30');

  select count(*) into n from notifications where task_id = ok_t and kind = 'visit_missed';
  if n <> 1 then raise exception 'F-42: the healthy row must still be processed, got %', n; end if;
  select count(*) into n from task_rule_runs where task_id = bad_t and outcome = 'failed' and detail->>'error' like '%poisoned%';
  if n <> 1 then raise exception 'F-42: the failing row is logged once, got %', n; end if;
  select (detail->>'failures')::int into f from task_rule_runs where outcome = 'summary' order by id desc limit 1;
  if f < 1 then raise exception 'F-42: the run summary counts the failure, got %', f; end if;
  drop trigger t_boom on public.notifications;
  drop function public.t_boom();
  raise notice 'ok F-42 (a failing row is logged, the others still run)';
end $$;

rollback;
