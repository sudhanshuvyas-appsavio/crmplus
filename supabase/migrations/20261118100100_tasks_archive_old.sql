-- Tasks module, part 2: retire collection_tasks and cheque_collections.
--
-- The old tables are renamed to *_archive and made read-only (their guards and
-- write policies are removed). Open tasks and every cheque are copied into the
-- new tables; finished tasks stay in the archive, which the reports read for
-- history. Drop the archives in a later migration once you are satisfied.

-- ---------------------------------------------------------------------------
-- 1. Archive
-- ---------------------------------------------------------------------------

alter table public.collection_tasks rename to collection_tasks_archive;
alter table public.cheque_collections rename to cheque_collections_archive;

drop trigger if exists trg_ct_guard on public.collection_tasks_archive;
drop trigger if exists trg_cc_guard on public.cheque_collections_archive;

drop policy if exists ct_ins on public.collection_tasks_archive;
drop policy if exists ct_upd on public.collection_tasks_archive;
drop policy if exists ct_del on public.collection_tasks_archive;
drop policy if exists cc_ins on public.cheque_collections_archive;
drop policy if exists cc_upd on public.cheque_collections_archive;
drop policy if exists cc_del on public.cheque_collections_archive;

revoke all on public.collection_tasks_archive from anon;
revoke all on public.cheque_collections_archive from anon;
revoke insert, update, delete on public.collection_tasks_archive from authenticated;
revoke insert, update, delete on public.cheque_collections_archive from authenticated;

comment on table public.collection_tasks_archive is 'Read-only archive of the old collection_tasks table. Open rows were copied to tasks. Drop once reviewed.';
comment on table public.cheque_collections_archive is 'Read-only archive of the old cheque_collections table. Every row was copied to task_cheques. Drop once reviewed.';

-- ---------------------------------------------------------------------------
-- 2. Copy what is still live
-- ---------------------------------------------------------------------------

insert into public.tasks (
  task_type, title, status, due_date, start_date, assigned_to, buyer_id, supplier_id, order_id,
  amount, mode, notes, details, dedupe_key, created_by, created_at
)
select
  case ct.task_type
    when 'buyer_payment' then 'payment_collection'
    when 'cash_collection' then 'payment_collection'
    when 'commission_invoice' then 'commission_invoice_delivery'
    when 'invoice_delivery' then 'mill_invoice_delivery'
    else ct.task_type
  end,
  coalesce(tt.label, ct.task_type) || ' - ' || coalesce(o.order_no, 'order'),
  case ct.status when 'in_progress' then 'in_progress' else 'todo' end,
  ct.due_date,
  (ct.created_at at time zone 'Asia/Kolkata')::date,
  (select p.id from public.profiles p where p.id = ct.assigned_to and p.is_active),
  o.buyer_id, o.supplier_id, ct.order_id,
  coalesce(ct.amount_to_collect, 0),
  case when ct.task_type = 'cash_collection' then 'cash' end,
  ct.notes,
  case when ct.task_type in ('invoice_delivery', 'commission_invoice')
       then '{"delivery_status":"not_delivered"}'::jsonb else '{}'::jsonb end,
  'legacy:' || ct.id,
  ct.created_by, ct.created_at
from public.collection_tasks_archive ct
join public.orders o on o.id = ct.order_id
left join public.task_types tt on tt.key = case ct.task_type
    when 'buyer_payment' then 'payment_collection'
    when 'cash_collection' then 'payment_collection'
    when 'commission_invoice' then 'commission_invoice_delivery'
    when 'invoice_delivery' then 'mill_invoice_delivery'
    else ct.task_type end
where ct.status in ('pending', 'in_progress')
on conflict (dedupe_key) do nothing;

insert into public.task_cheques (
  order_id, buyer_id, cheque_no, bank_name, amount, status, collected_by, collection_date,
  deposited_on, deposit_bank, slip_no, deposited_by, notes, created_by, created_at
)
select
  cc.order_id, o.buyer_id, cc.cheque_no, cc.bank_name, cc.amount,
  case when cc.deposited_on is null then 'collected' else 'deposited' end,
  (select p.id from public.profiles p where p.id = cc.collected_by and p.is_active),
  cc.collection_date, cc.deposited_on, cc.deposit_bank, cc.slip_no,
  (select p.id from public.profiles p where p.id = cc.deposited_by and p.is_active),
  cc.notes, cc.created_by, cc.created_at
from public.cheque_collections_archive cc
join public.orders o on o.id = cc.order_id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Reports read the new tables (and the archive for finished history)
-- ---------------------------------------------------------------------------

create or replace function public.collection_activity(p_from date, p_to date)
returns table(activity_date date, user_id uuid, name text, cheques_collected bigint, cheques_amount numeric, cash_collections bigint, cash_amount numeric, invoices_delivered bigint, delivery_notes bigint, mill_deposits bigint, mill_deposit_amount numeric, cheques_deposited bigint, cheques_deposited_amount numeric)
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not public.has_any_permission(array['order.read', 'order.manage', 'task.read', 'task.manage']) then
    raise exception 'You need permission to view collection activity';
  end if;
  return query
  with a as (
    select collection_date d, collected_by u, 'chq'::text k, amount amt from task_cheques where collected_by is not null and collection_date between p_from and p_to
    union all
    select deposited_on, deposited_by, 'dep', amount from task_cheques where deposited_on between p_from and p_to and deposited_by is not null
    union all
    select (t.completed_at at time zone 'Asia/Kolkata')::date, coalesce(t.completed_by, t.assigned_to),
           case when t.task_type = 'payment_collection' and t.mode = 'cash' then 'cash'
                when t.task_type in ('mill_invoice_delivery', 'commission_invoice_delivery') then 'inv'
                when t.task_type = 'delivery_note' then 'dn'
                when t.task_type = 'mill_payment_deposit' then 'mill' end,
           case when t.task_type = 'payment_collection' then t.amount_collected else t.amount end
    from tasks t
    where t.status = 'done' and coalesce(t.completed_by, t.assigned_to) is not null
      and t.task_type in ('payment_collection', 'mill_invoice_delivery', 'commission_invoice_delivery', 'delivery_note', 'mill_payment_deposit')
      and (t.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    union all
    select (c.completed_at at time zone 'Asia/Kolkata')::date, c.assigned_to,
           case c.task_type when 'cash_collection' then 'cash' when 'invoice_delivery' then 'inv' when 'delivery_note' then 'dn' when 'mill_payment_deposit' then 'mill' end,
           c.amount_to_collect
    from collection_tasks_archive c
    where c.status = 'done' and c.assigned_to is not null and c.task_type in ('cash_collection', 'invoice_delivery', 'delivery_note', 'mill_payment_deposit')
      and (c.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  )
  select a.d, a.u, p.name,
    count(*) filter (where k = 'chq'), coalesce(sum(amt) filter (where k = 'chq'), 0),
    count(*) filter (where k = 'cash'), coalesce(sum(amt) filter (where k = 'cash'), 0),
    count(*) filter (where k = 'inv'), count(*) filter (where k = 'dn'),
    count(*) filter (where k = 'mill'), coalesce(sum(amt) filter (where k = 'mill'), 0),
    count(*) filter (where k = 'dep'), coalesce(sum(amt) filter (where k = 'dep'), 0)
  from a join profiles p on p.id = a.u
  where a.k is not null
  group by a.d, a.u, p.name order by a.d desc, p.name;
end $$;

create or replace function public.collection_dashboard()
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  t date := (now() at time zone 'Asia/Kolkata')::date;
  res jsonb := jsonb_build_object('as_of', t);
  a int; b int; c numeric; d numeric; e int; aging jsonb;
begin
  if not public.has_any_permission(array['order.read', 'order.manage', 'task.read', 'task.manage']) then
    raise exception 'You need permission to view orders';
  end if;
  with ord as (
    select o.id,
           (coalesce((select sum(x.quantity) from order_dispatches x where x.order_id = o.id), 0) * o.buyer_rate)
             - coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id and p.kind = 'buyer_receipt'), 0) as outstanding,
           (select min(x.dispatch_date) from order_dispatches x where x.order_id = o.id) + coalesce(pt.days, 0) as due
    from orders o left join payment_terms pt on pt.id = o.payment_term_id
    where o.status in ('confirmed', 'open_for_execution', 'closed')
  ), open_ord as (select * from ord where outstanding > 0 and due is not null)
  select count(*), coalesce(sum(outstanding), 0), coalesce(sum(outstanding) filter (where due < t), 0),
    jsonb_build_array(
      jsonb_build_object('label', 'Not yet due', 'orders', count(*) filter (where due >= t), 'amount', coalesce(sum(outstanding) filter (where due >= t), 0)),
      jsonb_build_object('label', '1-15 days overdue', 'orders', count(*) filter (where t - due between 1 and 15), 'amount', coalesce(sum(outstanding) filter (where t - due between 1 and 15), 0)),
      jsonb_build_object('label', '16-30 days overdue', 'orders', count(*) filter (where t - due between 16 and 30), 'amount', coalesce(sum(outstanding) filter (where t - due between 16 and 30), 0)),
      jsonb_build_object('label', '31-60 days overdue', 'orders', count(*) filter (where t - due between 31 and 60), 'amount', coalesce(sum(outstanding) filter (where t - due between 31 and 60), 0)),
      jsonb_build_object('label', 'Over 60 days overdue', 'orders', count(*) filter (where t - due > 60), 'amount', coalesce(sum(outstanding) filter (where t - due > 60), 0)))
  into a, c, d, aging from open_ord;
  res := res || jsonb_build_object('outstanding', jsonb_build_object('orders', a, 'amount', c, 'overdue_amount', d), 'aging', aging);

  select count(*), coalesce(sum(amount), 0) into a, c from order_payments where kind = 'buyer_receipt' and paid_on = t;
  select count(*), coalesce(sum(amount), 0) into b, d from task_cheques where collection_date = t;
  res := res || jsonb_build_object('today', jsonb_build_object('receipts', a, 'receipts_amount', c, 'cheques_collected', b, 'cheques_amount', d));

  select count(*), coalesce(sum(amount), 0), coalesce(max(t - collection_date), 0), count(*) filter (where collection_date < t - 3)
    into a, c, e, b from task_cheques where deposited_on is null and status in ('pending', 'collected');
  res := res || jsonb_build_object('cheques_pending', jsonb_build_object('count', a, 'amount', c, 'oldest_days', e, 'older_than_3_days', b));
  return res;
end $$;

create or replace function public.staff_performance(p_from date, p_to date)
returns table(user_id uuid, name text, email text, role text, department text, staff_type text, entries bigint, tasks_total bigint, tasks_done bigint, completed_pct numeric, cheques_collected bigint, cheque_amount numeric, invoices_delivered bigint, payments_deposited bigint, deposit_amount numeric)
language plpgsql stable security definer
set search_path to 'public'
as $$
declare t0 timestamptz := p_from::timestamptz; t1 timestamptz := (p_to + 1)::timestamptz;
begin
  if not (public.is_admin() or public.has_permission('report.view')) then raise exception 'You need the report permission to view staff performance'; end if;
  return query
  with ev as (
    select created_by u, created_at at from leads union all
    select created_by, created_at from crm_deals union all
    select created_by, created_at from buyer_master union all
    select created_by, created_at from supplier_master union all
    select created_by, created_at from sales_confirmations union all
    select created_by, created_at from orders union all
    select created_by, created_at from order_transports union all
    select created_by, created_at from order_job_processes union all
    select created_by, created_at from order_dispatches union all
    select created_by, created_at from order_payments union all
    select created_by, created_at from commission_invoices union all
    select created_by, created_at from activity_log union all
    select created_by, created_at from transporters union all
    select created_by, created_at from job_processes union all
    select created_by, created_at from party_md_contacts union all
    select created_by, created_at from tasks union all
    select created_by, created_at from task_cheques union all
    select created_by, created_at from collection_tasks_archive where status in ('done', 'cancelled')
  ), ent as (select u, count(*) c from ev where u is not null and at >= t0 and at < t1 group by u),
  due as (
    select x.u, count(*) total, count(*) filter (where x.done) done
    from (
      select assigned_to u, due_date, (status = 'done') as done from tasks where assigned_to is not null and status <> 'cancelled'
      union all
      select assigned_to, due_date, true from collection_tasks_archive where status = 'done' and assigned_to is not null
    ) x where x.due_date between p_from and p_to group by x.u
  ),
  dn as (
    select x.u,
           count(*) filter (where x.kind = 'inv') inv,
           count(*) filter (where x.kind = 'dep') dp,
           coalesce(sum(x.amt) filter (where x.kind = 'dep'), 0) dpa
    from (
      select coalesce(completed_by, assigned_to) u, completed_at,
             case when task_type in ('mill_invoice_delivery', 'commission_invoice_delivery') then 'inv' when task_type = 'payment_deposit' then 'dep' end kind,
             amount amt
      from tasks where status = 'done'
      union all
      select assigned_to, completed_at,
             case task_type when 'invoice_delivery' then 'inv' when 'payment_deposit' then 'dep' end, amount_to_collect
      from collection_tasks_archive where status = 'done'
    ) x where x.u is not null and x.kind is not null and x.completed_at >= t0 and x.completed_at < t1 group by x.u
  ),
  chq as (select collected_by u, count(*) ch, coalesce(sum(amount), 0) cha from task_cheques
          where collected_by is not null and collection_date between p_from and p_to group by 1)
  select p.id, p.name, p.email, case when p.is_admin then 'admin' else coalesce(p.profile_template, 'unassigned') end, p.department, p.staff_type,
         coalesce(e.c, 0), coalesce(d.total, 0), coalesce(d.done, 0),
         case when coalesce(d.total, 0) = 0 then null else round(100.0 * d.done / d.total, 1) end,
         coalesce(c.ch, 0), coalesce(c.cha, 0), coalesce(n.inv, 0), coalesce(n.dp, 0), coalesce(n.dpa, 0)
  from profiles p left join ent e on e.u = p.id left join due d on d.u = p.id left join dn n on n.u = p.id left join chq c on c.u = p.id
  where p.is_active order by p.name;
end $$;

create or replace function public.staff_efficiency(p_from date, p_to date, p_idle_hours numeric default 4)
returns table(user_id uuid, name text, email text, job_title text, role text, department text, entries bigint, tasks_completed bigint, tasks_pending bigint, tasks_overdue bigint, last_activity timestamp with time zone, idle_hours numeric, is_idle boolean)
language plpgsql stable security definer
set search_path to 'public'
as $$
declare t0 timestamptz := p_from::timestamptz; t1 timestamptz := (p_to + 1)::timestamptz;
begin
  if not public.is_admin() then raise exception 'Only an administrator can view staff efficiency'; end if;
  return query
  with ev as (
    select created_by u, created_at at from leads union all
    select created_by, created_at from crm_deals union all
    select created_by, created_at from buyer_master union all
    select created_by, created_at from supplier_master union all
    select created_by, created_at from sales_confirmations union all
    select created_by, created_at from orders union all
    select created_by, created_at from order_transports union all
    select created_by, created_at from order_job_processes union all
    select created_by, created_at from order_dispatches union all
    select created_by, created_at from order_payments union all
    select created_by, created_at from commission_invoices union all
    select created_by, created_at from activity_log union all
    select created_by, created_at from transporters union all
    select created_by, created_at from job_processes union all
    select created_by, created_at from party_md_contacts union all
    select created_by, created_at from tasks union all
    select created_by, created_at from task_cheques
  ), act as (
    select u, at from ev where u is not null
    union all select done_by, done_at from activity_log where done_by is not null and done_at is not null
    union all select completed_by, completed_at from tasks where completed_by is not null and completed_at is not null
    union all select actor_id, at from audit_log where actor_id is not null
    union all select id, last_login_at from profiles where last_login_at is not null
  ), last_act as (select u, max(at) la from act group by u),
  ent as (select u, count(*) c from ev where u is not null and at >= t0 and at < t1 group by u),
  tdone as (
    select u, sum(c) c from (
      select done_by u, count(*) c from activity_log where is_done and done_by is not null and done_at >= t0 and done_at < t1 group by 1
      union all
      select completed_by, count(*) from tasks where status = 'done' and completed_by is not null and completed_at >= t0 and completed_at < t1 group by 1
    ) z group by u
  ),
  tpend as (
    select u, sum(c) c, sum(od) od from (
      select created_by u, count(*) c, count(*) filter (where due_date < current_date) od from activity_log
        where due_date is not null and not coalesce(is_done, false) and created_at < t1 group by 1
      union all
      select assigned_to, count(*), count(*) filter (where due_date < current_date) from tasks
        where status in ('todo', 'in_progress', 'blocked') and assigned_to is not null and created_at < t1 group by 1
    ) z group by u
  )
  select p.id, p.name, p.email, p.job_title,
         case when p.is_admin then 'admin' else coalesce(p.profile_template, 'unassigned') end,
         p.department,
         coalesce(e.c, 0), coalesce(d.c, 0)::bigint, coalesce(tp.c, 0)::bigint, coalesce(tp.od, 0)::bigint,
         l.la,
         case when l.la is null then null else round((extract(epoch from (now() - l.la)) / 3600)::numeric, 1) end,
         (l.la is null or now() - l.la > make_interval(secs => p_idle_hours * 3600))
  from profiles p
  left join last_act l on l.u = p.id left join ent e on e.u = p.id left join tdone d on d.u = p.id left join tpend tp on tp.u = p.id
  where p.is_active
  order by p.name;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The old guards have nothing left to guard
-- ---------------------------------------------------------------------------

drop function if exists public.collection_task_guard();
drop function if exists public.cheque_collection_guard();
