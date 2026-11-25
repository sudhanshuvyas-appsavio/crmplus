-- Tests for the 11 Monthly Visit automations of monday, and for the links between the Tasks boards
-- (docs/monday-task-folder-analysis, documents 04, 05 and 12).
--
-- Run on a STAGING database, or with supabase/tests/local-harness. One transaction, rolled back. A failed check
-- raises an exception naming the case; a pass prints a NOTICE. Same fixtures as task_boards_automations.test.sql
-- (three active profiles, one buyer; orders / order_dispatches / commission_invoices inserted with only the
-- columns named below).
--
-- monday's 11 Monthly Visit automations
--   A-1  item created: Created Date = today
--   A-2  Created Date arrives 17:45, status Not Visited: notify Person + Accounts "You have not visited yet."
--   A-3  Visited Date + 30 days 10:00, status Visited: notify "you have visited and not collect the payment."
--   A-4..A-6  Visited Date arrives (18:00 / 22:15 / 22:45): Pending = Yes, Visited or Not Visited: notify and create
--             Payment Collection "Monthly Visit - {name}" linked both ways (steps "30 / 45 / 60 days")
--   A-7..A-9  Created Date arrives (18:15 / 22:15 / 22:45) and Visited Date empty: same
--   A-10/A-11  Person := the buyer's Messenger on create and when the buyer changes
-- NOTE: monday stores no day offset for A-4..A-9; CRM+ uses 30 / 45 / 60 days (see
-- docs/monday-task-folder-analysis/automation-offset-verification.md). These tests assert CRM+'s 30/45/60.

begin;

do $$
declare
  u1 uuid; u2 uuid; u3 uuid; b uuid; s uuid; o uuid; d uuid; ci uuid;
  a uuid; bb uuid; c uuid; dd uuid; v uuid; w uuid; x uuid; y uuid; p uuid; q uuid; cid uuid; pc uuid; pc2 uuid;
  n int; m text; st text; aid uuid; ttl text; pr text;
begin
  select id into u1 from profiles where is_active order by created_at, id limit 1;
  select id into u2 from profiles where is_active and id <> u1 order by created_at, id limit 1;
  select id into u3 from profiles where is_active and id not in (u1, u2) order by created_at, id limit 1;
  select id into b from buyer_master order by created_at, id limit 1;
  if u3 is null or b is null then raise exception 'The tests need three active profiles and one buyer'; end if;
  update buyer_master set messenger_id = u3 where id = b;
  insert into supplier_master (name) values ('TEST supplier LV') returning id into s;

  ------------------------------------------------------------------ A-1
  insert into tasks (task_type, title, assigned_to, details) values ('monthly_visit', 'LV created', u1, '{}') returning id into a;
  select to_char(start_date, 'YYYY-MM-DD') into m from tasks where id = a;
  if m <> to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') then raise exception 'A-1: Created Date is today IST, got %', m; end if;
  select to_char(created_date, 'YYYY-MM-DD') into m from board_monthly_visit where id = a;
  if m <> to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') then raise exception 'A-1: the board shows Created Date, got %', m; end if;
  raise notice 'ok A-1 (Created Date set on create)';

  ------------------------------------------------------------------ A-2 not visited, boundaries
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV a2 due', u1, u2, '2026-03-18', '2026-04-17', '{}') returning id into a;
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV a2 future', u1, u2, '2026-03-19', '2026-04-18', '{}') returning id into bb;
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV a2 stale', u1, u2, '2026-03-15', '2026-04-14', '{}') returning id into c;
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV a2 completed', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"completed"}') returning id into dd;
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV a2 visited', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"visited"}') returning id into v;
  perform public.run_task_rules('2026-03-18 17:44+05:30');
  select count(*) into n from notifications where kind = 'visit_missed' and task_id = a;
  if n <> 0 then raise exception 'A-2: nothing at 17:44, got %', n; end if;
  perform public.run_task_rules('2026-03-18 17:45+05:30');
  select count(*) into n from notifications where kind = 'visit_missed' and task_id = a;
  if n <> 2 then raise exception 'A-2: Person and Accounts at 17:45, got %', n; end if;
  select count(*) into n from notifications where kind = 'visit_missed' and task_id in (bb, c, dd, v);
  if n <> 0 then raise exception 'A-2: not a future date, not a stale one (past the window), not Completed or Visited, got %', n; end if;
  select message into m from notifications where kind = 'visit_missed' and task_id = a and user_id = u2;
  if m <> 'Hey, ' || (select name from profiles where id = u2) || ', You have not visited yet.' then raise exception 'A-2: wording, got %', m; end if;
  perform public.run_task_rules('2026-03-18 18:00+05:30');
  select count(*) into n from notifications where kind = 'visit_missed' and task_id = a;
  if n <> 2 then raise exception 'A-2: fires once, got %', n; end if;
  raise notice 'ok A-2 (17:45 IST, Not Visited only, Person + Accounts, once)';

  ------------------------------------------------------------------ A-3 visited, +30 days, 10:00
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV a3 visited', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"visited","visited_on":"2026-03-18"}') returning id into v;
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV a3 notvisited', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"planned","visited_on":"2026-03-18"}') returning id into w;
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV a3 completed', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"completed","visited_on":"2026-03-18"}') returning id into x;
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV a3 nodate', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"visited"}') returning id into y;
  perform public.run_task_rules('2026-04-17 09:59+05:30');
  select count(*) into n from notifications where kind = 'visit_unpaid' and task_id in (v, w, x, y);
  if n <> 0 then raise exception 'A-3: nothing before 10:00, got %', n; end if;
  perform public.run_task_rules('2026-04-17 10:00+05:30');
  select count(*) into n from notifications where kind = 'visit_unpaid' and task_id = v;
  if n <> 2 then raise exception 'A-3: Person and Accounts at 10:00 on day 30, got %', n; end if;
  select count(*) into n from notifications where kind = 'visit_unpaid' and task_id in (w, x, y);
  if n <> 0 then raise exception 'A-3: only status Visited, and only with a visited day, got %', n; end if;
  select message into m from notifications where kind = 'visit_unpaid' and task_id = v and user_id = u1;
  if m <> 'Hey, ' || (select name from profiles where id = u1) || ', you have visited and not collect the payment.' then raise exception 'A-3: wording, got %', m; end if;
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV a3 day29', u1, u2, '2026-03-19', '2026-04-18', '{"visit_status":"visited","visited_on":"2026-03-19"}') returning id into y;
  perform public.run_task_rules('2026-04-17 10:30+05:30');
  select count(*) into n from notifications where kind = 'visit_unpaid' and task_id = y;
  if n <> 0 then raise exception 'A-3: day 29 does not fire, got %', n; end if;
  raise notice 'ok A-3 (visited day + 30, 10:00 IST, Visited only, no pending test)';

  ------------------------------------------------------------------ A-4 / A-5 / A-6 visited branch, and the links
  insert into tasks (task_type, title, buyer_id, assigned_to, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'LV visited branch', b, u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"visited","visited_on":"2026-03-18","pending_payment":true}') returning id into p;
  perform public.run_task_rules('2026-04-17 17:59+05:30');
  select count(*) into n from tasks where source_task_id = p;
  if n <> 0 then raise exception 'A-4: nothing before 18:00 on day 30, got %', n; end if;
  perform public.run_task_rules('2026-04-17 18:00+05:30');
  select count(*) into n from tasks where source_task_id = p and task_type = 'payment_collection';
  if n <> 1 then raise exception 'A-4: one Payment Collection at 18:00 on day 30, got %', n; end if;
  select id, title, assigned_to, accounts_staff_id::text, buyer_id, priority, details->>'step_days' into pc, ttl, aid, m, c, pr, st from tasks where source_task_id = p;
  if ttl <> 'Monthly Visit - LV visited branch' or aid <> u1 or m <> u2::text or c <> b or pr <> 'normal' or st <> '30' then raise exception 'A-4: payment task fields (%, %, %)', ttl, pr, st; end if;
  select message into m from notifications where kind = 'payment_escalation' and task_id = p and user_id = u1;
  if m not like '%you have visited and not collected the payment after 30 days' then raise exception 'A-4: wording, got %', m; end if;
  perform public.run_task_rules('2026-04-17 18:20+05:30');
  select count(*) into n from tasks where source_task_id = p;
  if n <> 1 then raise exception 'A-7 must not fire for a visited visit and A-4 must not repeat, got %', n; end if;
  perform public.run_task_rules('2026-05-02 22:14+05:30');
  select count(*) into n from tasks where source_task_id = p;
  if n <> 1 then raise exception 'A-5: nothing at 22:14, got %', n; end if;
  perform public.run_task_rules('2026-05-02 22:15+05:30');
  select count(*) into n from tasks where source_task_id = p;
  if n <> 2 then raise exception 'A-5: a second Payment Collection at 22:15 on day 45, got %', n; end if;
  perform public.run_task_rules('2026-05-17 22:45+05:30');
  select count(*) into n from tasks where source_task_id = p;
  if n <> 3 then raise exception 'A-6: a third Payment Collection at 22:45 on day 60, got %', n; end if;
  select count(*) into n from tasks where source_task_id = p and priority = 'urgent' and details->>'step_days' = '60';
  if n <> 1 then raise exception 'A-6: the day-60 step is urgent'; end if;
  raise notice 'ok A-4 A-5 A-6 (visited branch: 18:00 / 22:15 / 22:45, one Payment Collection per step)';

  -- the links, both ways
  select payment_collection_id into aid from board_monthly_visit where id = p;
  if aid is null or not exists (select 1 from tasks where id = aid and source_task_id = p) then raise exception 'LINK visit -> payment: link to Payment Collection must point at one of its payments'; end if;
  select connected_task_id, connected_board, buyer_name, payment_status, to_char(start_date, 'YYYY-MM-DD')
    into aid, ttl, m, st, pr from board_payment_collection where id = pc;
  if aid <> p or ttl <> 'Monthly Visit' or m <> (select name from buyer_master where id = b) or st <> 'Outstanding' then raise exception 'LINK payment -> visit: Connected Boards (%, %, %, %)', aid, ttl, m, st; end if;
  raise notice 'ok LINK visit <-> Payment Collection (two-way, board named)';

  ------------------------------------------------------------------ A-7 / A-8 / A-9 not-visited branch
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details)
  values ('monthly_visit', 'LV notvisited branch', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"planned","pending_payment":true}') returning id into q;
  perform public.run_task_rules('2026-04-17 18:14+05:30');
  select count(*) into n from tasks where source_task_id = q;
  if n <> 0 then raise exception 'A-7: nothing at 18:14, got %', n; end if;
  perform public.run_task_rules('2026-04-17 18:15+05:30');
  select count(*) into n from tasks where source_task_id = q;
  if n <> 1 then raise exception 'A-7: one Payment Collection at 18:15 on day 30, got %', n; end if;
  select message into m from notifications where kind = 'payment_escalation' and task_id = q and user_id = u1;
  if m not like '%you have not visited and not collected the payment after 30 days' then raise exception 'A-7: wording, got %', m; end if;
  perform public.run_task_rules('2026-05-02 22:15+05:30');
  perform public.run_task_rules('2026-05-17 22:45+05:30');
  select count(*) into n from tasks where source_task_id = q;
  if n <> 3 then raise exception 'A-8 / A-9: three steps in total, got %', n; end if;
  raise notice 'ok A-7 A-8 A-9 (not-visited branch: 18:15 / 22:15 / 22:45)';

  ------------------------------------------------------------------ conditions that stop A-4..A-9
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV nopending', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"visited","visited_on":"2026-03-18","pending_payment":false}') returning id into a;
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV completed pending', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"completed","visited_on":"2026-03-18","pending_payment":true}') returning id into bb;
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, start_date, due_date, details) values ('monthly_visit', 'LV cancelled pending', u1, u2, '2026-03-18', '2026-04-17', '{"visit_status":"visited","visited_on":"2026-03-18","pending_payment":true}') returning id into c;
  update tasks set status = 'cancelled' where id = c;
  perform public.run_task_rules('2026-04-17 18:30+05:30');
  select count(*) into n from tasks where source_task_id in (a, bb, c);
  if n <> 0 then raise exception 'A-4..A-9: Pending = No, Completed and cancelled visits create nothing, got %', n; end if;
  raise notice 'ok A-4..A-9 negatives';

  ------------------------------------------------------------------ A-10 / A-11 Person from the Messenger
  insert into tasks (task_type, title, buyer_id, details) values ('monthly_visit', 'LV msgr', b, '{}') returning id into a;
  select assigned_to, accounts_staff_id::text into aid, m from tasks where id = a;
  if aid is distinct from u3 or m is not null then raise exception 'A-10: Person = Messenger, Accounts empty'; end if;
  insert into tasks (task_type, title, buyer_id, assigned_to, details) values ('monthly_visit', 'LV msgr explicit', b, u1, '{}') returning id into bb;
  select assigned_to into aid from tasks where id = bb;
  if aid is distinct from u1 then raise exception 'A-10 (CRM+ keeps a Person chosen at creation)'; end if;
  update tasks set buyer_id = null where id = a;
  update tasks set assigned_to = u1 where id = a;
  update tasks set buyer_id = b where id = a;
  select assigned_to into aid from tasks where id = a;
  if aid is distinct from u3 then raise exception 'A-11: a new buyer sets Person to the Messenger'; end if;
  update profiles set is_active = false where id = u3;
  insert into tasks (task_type, title, buyer_id, details) values ('monthly_visit', 'LV msgr inactive', b, '{}') returning id into c;
  select assigned_to into aid from tasks where id = c;
  update profiles set is_active = true where id = u3;
  if aid is not null then raise exception 'A-10: an inactive Messenger is not assigned, got %', aid; end if;
  raise notice 'ok A-10 A-11 (Messenger -> Person on create and on buyer change)';

  ------------------------------------------------------------------ LINKS with the other boards
  -- Commission Invoice Delivery <-> Payment Collection
  insert into orders (order_no, buyer_id, supplier_id) values ('TEST-LV-1', b, s) returning id into o;
  insert into commission_invoices (order_id, buyer_id, supplier_id, invoice_no, invoice_date, amount) values (o, b, s, 'CI-LV-1', '2026-03-03', 7000) returning id into ci;
  select id into cid from tasks where dedupe_key = 'ci:' || ci;
  update tasks set accounts_staff_id = u2, assigned_to = u1, start_date = '2026-03-18', details = details || '{"pending_payment":true}' where id = cid;
  perform public.run_task_rules('2026-03-18 18:30+05:30');
  select id into pc2 from tasks where source_task_id = cid and task_type = 'payment_collection';
  if pc2 is null then raise exception 'LINK commission -> payment: the pending delivery creates a Payment Collection'; end if;
  select connected_board, amount::text into ttl, m from board_payment_collection where id = pc2;
  if ttl <> 'Commission Invoice Delivery' then raise exception 'LINK payment -> commission: Connected Boards says %', ttl; end if;
  select payment_collection_id, commission_amount::text, commission_invoice_no, commission_invoice_id into aid, m, ttl, x from board_commission_invoice_delivery where id = cid;
  if aid <> pc2 or m <> '7000' or ttl <> 'CI-LV-1' or x <> ci then raise exception 'LINK commission invoice <-> delivery (%, %, %)', aid, m, ttl; end if;
  raise notice 'ok LINK Commission Invoices <-> Commission Invoice Delivery <-> Payment Collection';

  -- Dispatch and Billing <-> Mill Invoice Delivery
  insert into order_dispatches (order_id, mill_invoice_no, mill_invoice_date) values (o, 'INV-LV-9', '2026-03-03') returning id into d;
  select id, invoice_number, supplier_name into x, ttl, m from board_mill_invoice_delivery where dispatch_and_billing_id = d;
  if x is null or ttl <> 'INV-LV-9' or m <> 'TEST supplier LV' then raise exception 'LINK dispatch -> mill: invoice number and supplier mirror (%, %)', ttl, m; end if;
  raise notice 'ok LINK Dispatch and Billing <-> Mill Invoice Delivery (invoice and supplier mirrors)';

  -- Transport bill -> Transport Freight Invoice
  insert into order_dispatches (order_id, transporter_invoice_no, transporter_invoice_amount) values (o, 'T-LV-1', 450) returning id into d;
  select transport_invoice_id, transport_bill_no, transport_amount::text, buyer into aid, ttl, m, pr from board_freight_invoice where transport_invoice_id = d;
  if aid is null or ttl <> 'T-LV-1' or m::numeric <> 450 or pr <> (select name from buyer_master where id = b) then raise exception 'LINK dispatch -> freight (%, %, %)', ttl, m, pr; end if;
  raise notice 'ok LINK dispatch transport bill -> Transport Freight Invoice';

  -- Sample Delivery: buyer and supplier with their Messengers, feedback due date
  update supplier_master set messenger_id = u2 where id = s;
  insert into tasks (task_type, title, buyer_id, supplier_id, details) values ('sample_delivery', 'LV sample', b, s, '{"delivery_date":"2026-03-18"}') returning id into x;
  select buyer_messenger, supplier_messenger, to_char(feedback_due_date, 'YYYY-MM-DD') into ttl, m, pr from board_sample_delivery where id = x;
  if ttl <> (select name from profiles where id = u3) or m <> (select name from profiles where id = u2) or pr <> '2026-03-25' then raise exception 'LINK sample: messengers and Feedback Due Date (%, %, %)', ttl, m, pr; end if;
  raise notice 'ok LINK Sample Delivery <-> Buyers & Suppliers (messenger mirrors, Delivery Date + 7)';

  -- Cheque Collection groups follow the deposit status
  insert into tasks (task_type, title, buyer_id, assigned_to, accounts_staff_id, details) values ('cheque_collection', 'LV cheque', b, u1, u2, '{}') returning id into x;
  insert into task_cheques (task_id, buyer_id, cheque_no, amount, bank_name) values (x, b, 'LV-CHQ-1', 10, 'LV Bank');
  select group_name, deposit_status into ttl, m from board_cheque_collection where task_id = x;
  if ttl <> 'To Collect' or m <> 'Pending' then raise exception 'LINK cheque: To Collect / Pending, got % / %', ttl, m; end if;
  insert into task_attachments (task_id, kind, file_name, storage_path) values (x, 'photo', 'c.jpg', 'tests/' || x || '/c.jpg');
  select group_name, deposit_status into ttl, m from board_cheque_collection where task_id = x;
  if ttl <> 'Collected' or m <> 'Collected' then raise exception 'LINK cheque: Collected / Collected, got % / %', ttl, m; end if;
  update task_cheques set status = 'deposited', deposit_bank = 'LV Bank', slip_no = 'S-1' where task_id = x;
  select group_name, deposit_status into ttl, m from board_cheque_collection where task_id = x;
  if ttl <> 'In Progress' or m <> 'Deposited' then raise exception 'LINK cheque: In Progress / Deposited, got % / %', ttl, m; end if;
  raise notice 'ok LINK Cheque Collection groups (To Collect / In Progress / Collected)';

  ------------------------------------------------------------------ deleting a linked item
  delete from tasks where id = p;
  select count(*) into n from tasks where source_task_id is null and task_type = 'payment_collection' and title = 'Monthly Visit - LV visited branch';
  if n <> 3 then raise exception 'LINK delete: the payments of a deleted visit stay, unlinked (got %)', n; end if;
  select connected_board into ttl from board_payment_collection where id = pc;
  if ttl is not null then raise exception 'LINK delete: the unlinked payment shows no board, got %', ttl; end if;

  delete from tasks where source_task_id = q;
  perform public.run_task_rules('2026-05-17 22:45+05:30');
  select count(*) into n from tasks where source_task_id = q;
  if n <> 0 then raise exception 'LINK delete: a step already taken is not repeated after its payment was deleted, got %', n; end if;
  select payment_collection_id into aid from board_monthly_visit where id = q;
  if aid is not null then raise exception 'LINK delete: the visit no longer links a payment'; end if;
  raise notice 'ok LINK deleting a linked item (payments survive unlinked; no re-creation)';
end $$;

------------------------------------------------------------------ the Connected Boards picker: who may link
do $$
declare u1 uuid; u2 uuid; v uuid; pcx uuid; n int;
begin
  select id into u1 from profiles where is_active order by created_at, id limit 1;
  select id into u2 from profiles where is_active and id <> u1 order by created_at, id limit 1;
  insert into user_permissions (user_id, permission) values (u2, 'task.manage'), (u1, 'task.work');
  insert into tasks (task_type, title, assigned_to, details) values ('monthly_visit', 'LV pick visit', u1, '{}') returning id into v;
  insert into tasks (task_type, title, assigned_to, amount, details) values ('payment_collection', 'LV pick payment', u1, 100, '{}') returning id into pcx;

  perform set_config('request.jwt.claim.sub', u2::text, true);
  set local role authenticated;
  update tasks set source_task_id = v where id = pcx;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception 'PICKER: a manager links a payment to a visit'; end if;

  perform set_config('request.jwt.claim.sub', u1::text, true);
  set local role authenticated;
  begin
    update tasks set source_task_id = null where id = pcx;
    reset role;
    raise exception 'PICKER: a worker must not change the link';
  exception when others then
    reset role;
    if sqlerrm like 'PICKER%' then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'ok PICKER (managers link, workers cannot)';
end $$;

rollback;
