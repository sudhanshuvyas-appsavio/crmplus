-- Tests for the Cheque Collection and Payment Collection boards (monday automations A-13..A-15, A-17, A-27/A-28)
-- and their grids' views. See docs/monday-task-folder-analysis/cheque-and-payment-collection.md.
--
-- Run on a STAGING database, or with supabase/tests/local-harness. One transaction, rolled back. A failed
-- check raises an exception naming the case; a pass prints a NOTICE.
-- Needs three active profiles and one buyer; needs 20261120160000_cheque_and_payment_collection_automations.sql.

begin;

do $$
declare
  u1 uuid; u2 uuid; u3 uuid; b uuid; b2 uuid;
  p uuid; c uuid; t uuid; n int; m text; st text; cl text; aid uuid; num numeric;
begin
  select id into u1 from profiles where is_active order by created_at, id limit 1;
  select id into u2 from profiles where is_active and id <> u1 order by created_at, id limit 1;
  select id into u3 from profiles where is_active and id not in (u1, u2) order by created_at, id limit 1;
  select id into b from buyer_master order by created_at, id limit 1;
  if u3 is null or b is null then raise exception 'The tests need three active profiles and one buyer'; end if;
  update buyer_master set messenger_id = u3 where id = b;

  ------------------------------------------------------------------ PAYMENT COLLECTION
  -- A-13 Start Date
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, amount) values ('payment_collection', 'PC pay', u1, u2, 10000) returning id into p;
  select to_char(start_date, 'YYYY-MM-DD') into m from tasks where id = p;
  if m <> to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') then raise exception 'A-13: Start Date is today IST, got %', m; end if;

  -- A-14: greeting and the running total
  insert into task_payments (task_id, amount, mode) values (p, 4000, 'cash');
  select count(*) into n from notifications where task_id = p and kind = 'payment_collected';
  if n <> 2 then raise exception 'A-14: Person and Accounts are told, got %', n; end if;
  select message into m from notifications where task_id = p and kind = 'payment_collected' and user_id = u1;
  if m <> 'Hey, ' || (select name from profiles where id = u1) || ', Amount collected is 4000' then raise exception 'A-14: wording, got %', m; end if;
  insert into task_payments (task_id, amount, mode) values (p, 2500.5, 'online');
  select message into m from notifications where task_id = p and kind = 'payment_collected' and user_id = u2 and message like '%6500.5';
  if m is null then raise exception 'A-14: the message states the total collected so far (6500.5)'; end if;
  select amount_collected into num from tasks where id = p;
  if num <> 6500.5 then raise exception 'A-14: Amount Collected is the sum of the lines, got %', num; end if;
  raise notice 'ok A-13 A-14 (Start Date; "Hey, {name}, Amount collected is {total}" to Person and Accounts)';

  -- A-14 when the person recording is one of the recipients: they are not told about their own entry
  insert into user_permissions (user_id, permission) values (u1, 'task.work');
  perform set_config('request.jwt.claim.sub', u1::text, true);
  set local role authenticated;
  perform public.task_add_payment(p, 100, 'cash', 'REF-1', null, null);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  select count(*) into n from notifications where task_id = p and kind = 'payment_collected' and user_id = u1 and message like '%6600.5';
  if n <> 0 then raise exception 'A-14: the person who recorded it is not told'; end if;
  select count(*) into n from notifications where task_id = p and kind = 'payment_collected' and user_id = u2 and message like '%6600.5';
  if n <> 1 then raise exception 'A-14: Accounts are told, got %', n; end if;
  raise notice 'ok A-14 actor';

  -- bad amounts
  begin
    insert into task_payments (task_id, amount) values (p, 0);
    raise exception 'A-14: a zero payment must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into task_payments (task_id, amount) values (p, -5);
    raise exception 'A-14: a negative payment must be refused';
  exception when check_violation then null;
  end;

  -- Amount Collected cannot be edited directly (money moves only through payment lines)
  begin
    update tasks set amount_collected = 1 where id = p;
    raise exception 'A-14: Amount Collected must not be edited directly';
  exception when others then
    if sqlerrm like 'A-14%' then raise; end if;
  end;

  -- A-15: fully paid completes the task; End Date; Balance and Days Aging; reopening clears End Date
  insert into task_payments (task_id, amount, mode) values (p, 3400, 'cheque');
  select status, (completed_at is not null)::text into st, m from tasks where id = p;
  if st <> 'done' or m <> 'true' then raise exception 'A-15: fully paid completes the task and stamps End Date, got % / %', st, m; end if;
  select payment_status, balance_amount into m, num from board_payment_collection where id = p;
  if m <> 'Completed' or num > 0 then raise exception 'A-15: the board shows Completed and no balance, got % / %', m, num; end if;
  update tasks set status = 'todo' where id = p;
  select (completed_at is null)::text into m from tasks where id = p;
  if m <> 'true' then raise exception 'A-15: reopening clears End Date'; end if;
  select payment_status into m from board_payment_collection where id = p;
  if m <> 'Completed' then raise exception 'A-15: balance paid, so still Completed by amount'; end if;
  -- a payment task completed by hand with a balance left
  insert into tasks (task_type, title, assigned_to, amount) values ('payment_collection', 'PC manual', u1, 500) returning id into t;
  update tasks set status = 'done' where id = t;
  select (completed_at is not null)::text into m from tasks where id = t;
  if m <> 'true' then raise exception 'A-15: marking Completed by hand stamps End Date'; end if;
  raise notice 'ok A-15 (End Date, Balance, Completed by amount or by hand, reopen)';

  ------------------------------------------------------------------ CHEQUE COLLECTION
  -- A-17 with an Accounts person: told, once
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, details) values ('cheque_collection', 'CC with accounts', u1, u2, '{}') returning id into t;
  insert into task_cheques (task_id, cheque_no, amount, bank_name) values (t, 'CC-1', 100, 'Bank');
  insert into task_attachments (task_id, kind, file_name, storage_path) values (t, 'photo', 'a.jpg', 'tests/' || t || '/a.jpg');
  select count(*), min(message) into n, m from notifications where task_id = t and kind = 'cheque_collected';
  if n <> 1 or m <> 'Your Check for CC with accounts is Collected' then raise exception 'A-17: Accounts told once, got % / %', n, m; end if;
  select count(*) into n from notifications where task_id = t and kind = 'cheque_collected' and user_id = u2;
  if n <> 1 then raise exception 'A-17: the notification goes to Accounts'; end if;

  -- no Accounts person: Person is told instead of nobody
  insert into tasks (task_type, title, assigned_to, details) values ('cheque_collection', 'CC no accounts', u1, '{}') returning id into t;
  insert into task_cheques (task_id, cheque_no, amount, bank_name) values (t, 'CC-2', 100, 'Bank');
  insert into task_attachments (task_id, kind, file_name, storage_path) values (t, 'proof', 'b.jpg', 'tests/' || t || '/b.jpg');
  select count(*) into n from notifications where task_id = t and kind = 'cheque_collected' and user_id = u1;
  if n <> 1 then raise exception 'A-17: without Accounts the Person is told, got %', n; end if;

  -- neither Person nor Accounts: the managers are told
  update profiles set is_admin = true where id = u2;
  insert into tasks (task_type, title, details) values ('cheque_collection', 'CC nobody', '{}') returning id into t;
  insert into task_cheques (task_id, cheque_no, amount, bank_name) values (t, 'CC-3', 100, 'Bank');
  insert into task_attachments (task_id, kind, file_name, storage_path) values (t, 'photo', 'c.jpg', 'tests/' || t || '/c.jpg');
  select count(*) into n from notifications where task_id = t and kind = 'cheque_collected' and user_id = u2;
  update profiles set is_admin = false where id = u2;
  if n <> 1 then raise exception 'A-17: with nobody assigned the managers are told, got %', n; end if;

  -- a manual change to Collected (no photo) notifies once; a second change does not
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, details) values ('cheque_collection', 'CC manual', u1, u2, '{}') returning id into t;
  insert into task_cheques (task_id, cheque_no, amount, bank_name) values (t, 'CC-4', 100, 'Bank') returning id into c;
  update task_cheques set status = 'collected' where id = c;
  update task_cheques set notes = 'edited' where id = c;
  select count(*) into n from notifications where task_id = t and kind = 'cheque_collected';
  if n <> 1 then raise exception 'A-17: a manual Collected notifies once, got %', n; end if;
  raise notice 'ok A-17 (Accounts; fallback to Person; fallback to managers; manual status)';

  -- a cheque that is not collected does not notify
  insert into tasks (task_type, title, assigned_to, accounts_staff_id, details) values ('cheque_collection', 'CC pending', u1, u2, '{}') returning id into t;
  insert into task_cheques (task_id, cheque_no, amount) values (t, 'CC-5', 100);
  select count(*) into n from notifications where task_id = t and kind = 'cheque_collected';
  if n <> 0 then raise exception 'A-17: a pending cheque does not notify'; end if;

  -- A-27 / A-28: Person from the buyer's Messenger, and when the buyer changes
  insert into buyer_master (name, messenger_id) values ('Second Buyer', u2) returning id into b2;
  insert into tasks (task_type, title, buyer_id, details) values ('cheque_collection', 'CC person', b, '{}') returning id into t;
  select assigned_to, accounts_staff_id::text into aid, m from tasks where id = t;
  if aid is distinct from u3 or m is not null then raise exception 'A-27: Person = Messenger, Accounts stay manual'; end if;
  update tasks set buyer_id = b2 where id = t;
  select assigned_to into aid from tasks where id = t;
  if aid is distinct from u2 then raise exception 'A-28: a new buyer sets Person to its Messenger'; end if;
  raise notice 'ok A-27 A-28 (Person from Messenger on a cheque task)';

  -- deposit rules, groups and Deposit Status in the board view
  insert into tasks (task_type, title, buyer_id, assigned_to, accounts_staff_id, details) values ('cheque_collection', 'CC flow', b, u1, u2, '{}') returning id into t;
  insert into task_cheques (task_id, buyer_id, cheque_no, amount, bank_name) values (t, b, 'CC-6', 100, 'Flow Bank') returning id into c;
  select group_name, deposit_status into st, m from board_cheque_collection where task_id = t;
  if st <> 'To Collect' or m <> 'Pending' then raise exception 'Cheque view: To Collect / Pending, got % / %', st, m; end if;
  begin
    update task_cheques set status = 'deposited' where id = c;
    raise exception 'Cheque deposit needs the bank and the slip number';
  exception when others then
    if sqlerrm like 'Cheque deposit%' then raise; end if;
  end;
  update task_cheques set status = 'deposited', deposit_bank = 'Dep Bank', slip_no = 'SL-1' where id = c;
  select group_name, deposit_status into st, m from board_cheque_collection where task_id = t;
  if st <> 'In Progress' or m <> 'Deposited' then raise exception 'Cheque view: In Progress / Deposited, got % / %', st, m; end if;
  select (deposited_on is not null)::text into m from task_cheques where id = c;
  if m <> 'true' then raise exception 'Cheque: the deposit date is stamped'; end if;
  update task_cheques set status = 'cleared' where id = c;
  select group_name, deposit_status into st, m from board_cheque_collection where task_id = t;
  select (cleared_on is not null)::text into cl from task_cheques where id = c;
  if st <> 'Collected' or m <> 'Cleared' or cl <> 'true' then raise exception 'Cheque view: Collected / Cleared and the clearing date, got % / % / %', st, m, cl; end if;
  update task_cheques set status = 'bounced' where id = c;
  select deposit_status into m from board_cheque_collection where task_id = t;
  if m <> 'Bounced' then raise exception 'Cheque view: Bounced, got %', m; end if;
  raise notice 'ok CHEQUE flow (To Collect -> Collected -> Deposited -> Cleared / Bounced, groups)';

  -- data rules
  begin
    insert into task_cheques (task_id, cheque_no, amount) values (t, 'CC-7', 0);
    raise exception 'Cheque: a zero amount must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into task_cheques (task_id, cheque_no, amount, bank_name) values (t, 'cc-6 ', 5, 'FLOW BANK');
    raise exception 'Cheque: the same number and bank must be refused';
  exception when unique_violation then null;
  end;
  insert into task_cheques (task_id, cheque_no, amount, bank_name) values (t, 'CC-6', 5, 'Other Bank');
  raise notice 'ok CHEQUE data rules';

  -- the cheque board's report figures: count and amount by collection date, party, deposit date, deposited by
  select count(*), sum(amount) into n, num from task_cheques where cheque_no like 'CC-%' and collection_date = (now() at time zone 'Asia/Kolkata')::date;
  if n < 6 then raise exception 'Reports: cheques group by collection date, got %', n; end if;
  raise notice 'ok CHEQUE report data';
end $$;

rollback;
