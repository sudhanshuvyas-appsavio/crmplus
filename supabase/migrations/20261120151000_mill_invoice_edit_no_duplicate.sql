-- Mill Invoice Delivery: correcting a mill invoice number must not create a second delivery task.
--
-- 20261120110000_crm_automations_round2.sql makes a recorded mill invoice FILL the open task that the new
-- Dispatch and Billing item created. That path updates the task but leaves its dedupe key as
-- 'mill_inv_order:<order>', so a later correction of the invoice number finds no open unfilled task and
-- inserts a new one under 'mill_inv:<dispatch>' (found by the test supabase/tests/task_boards_automations.test.sql,
-- case MILL-EDIT: two tasks for one dispatch).
--
-- The fix is one line: when the invoice fills the task, the task also takes the key 'mill_inv:<dispatch>', so a
-- later correction conflicts with it and creates nothing (the behaviour before round 2). The rest of the function
-- is round 2's, unchanged. Safe to run twice; apply after 20261120110000.

create or replace function public.dispatch_tasks()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare o orders; days int; tr uuid; label text; tid uuid;
begin
  select * into o from orders where id = new.order_id;
  if not found then return null; end if;

  -- The mill invoice has to be carried to the buyer.
  if new.mill_invoice_no is not null and btrim(new.mill_invoice_no) <> ''
     and (tg_op = 'INSERT' or old.mill_invoice_no is distinct from new.mill_invoice_no) then
    select id into tid from tasks
     where dedupe_key = 'mill_inv_order:' || o.id and dispatch_id is null
       and coalesce(details->>'invoice_no', '') = '' and status not in ('done', 'cancelled')
     limit 1;
    if tid is not null then
      update tasks
         set dispatch_id = new.id,
             dedupe_key = 'mill_inv:' || new.id,
             title = 'Deliver mill invoice ' || btrim(new.mill_invoice_no) || ' (' || coalesce(o.order_no, 'order') || ')',
             details = details || (jsonb_build_object('invoice_no', btrim(new.mill_invoice_no),
                                                      'invoice_date', coalesce(new.mill_invoice_date::text, ''))
                                   - case when new.mill_invoice_date is null then 'invoice_date' else '' end)
       where id = tid;
    else
      select default_due_days into days from task_types where key = 'mill_invoice_delivery';
      insert into tasks (task_type, title, due_date, assigned_to, buyer_id, supplier_id, order_id, dispatch_id, details, dedupe_key)
      values ('mill_invoice_delivery', 'Deliver mill invoice ' || btrim(new.mill_invoice_no) || ' (' || coalesce(o.order_no, 'order') || ')',
              (now() at time zone 'Asia/Kolkata')::date + coalesce(days, 2), public.default_task_assignee(o.buyer_id),
              o.buyer_id, o.supplier_id, o.id, new.id,
              jsonb_build_object('delivery_status', 'not_delivered', 'invoice_no', btrim(new.mill_invoice_no),
                                 'invoice_date', coalesce(new.mill_invoice_date::text, '')) - case when new.mill_invoice_date is null then 'invoice_date' else '' end, 'mill_inv:' || new.id)
      on conflict (dedupe_key) do nothing;
    end if;
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
