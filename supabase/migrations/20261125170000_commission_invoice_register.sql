-- Commission Invoice register (from monday's Commission Board app).
--
-- Before: one invoice per order, buyer + supplier commission added into one amount, number CINV-yyyy-nnnn.
-- Now:    one invoice per Business Unit and PARTY (Buyer or Supplier) for a date range, listing many
--         dispatch lines, with Add / Deduct / TDS / Round Off, a bag total, the net amount and a stored PDF.
--         A dispatch line can be billed once per party: the database refuses a second active line.
--
-- Also: status (Generated / Sent / Pending / Cancelled) and payment tracking (Mode of Payment, Payment Collected,
-- Payment Pending = Net Amount - Payment Collected) as on monday's Commission Invoices board, with every receipt kept.
--
-- What does not change: the delivery task (Commission Invoice Delivery), the payment escalation, order
-- documents. Old per-order invoices stay as "legacy" rows and count as billing both parties of that order.
--
-- Payment follow-through: when an invoice is fully paid, the "payment pending" flag of its delivery task is cleared and the
-- Payment Collection follow-up raised from it is closed; when an invoice is cancelled the follow-up is cancelled too.
--
-- One ledger: a payment recorded on the invoice is copied to its open Payment Collection follow-up, and a payment recorded on
-- that follow-up (by the collector) is copied to the invoice, so the two never disagree and nothing is entered twice.
-- Payment modes are monday's (NEFT, UPI, RTGS, Cash, Cards) plus Online and Cheque, which the follow-up task already offers.
--
-- Order of migrations: this one must run AFTER 20261125100000 and 20261125110000 (Dispatch and Billing cancel / return entries):
-- those two redefine order_close_status and billing_dispatch_dashboard, and this script puts its commission-invoice
-- rules back into them (on top of their new net-dispatched / cancelled / returned quantities).
--
-- Safe to run more than once. No data is deleted.

begin;

-- ---------------------------------------------------------------- 1. the invoice table
alter table public.commission_invoices
  alter column order_id drop not null,
  alter column buyer_id drop not null,
  alter column supplier_id drop not null;

alter table public.commission_invoices drop constraint if exists commission_invoices_order_id_key;

alter table public.commission_invoices
  add column if not exists party_type       text,
  add column if not exists period_from      date,
  add column if not exists period_to        date,
  add column if not exists commission_basis text,
  add column if not exists commission_value numeric,
  add column if not exists total_bags       numeric,
  add column if not exists commission_total numeric,
  add column if not exists add_amount       numeric not null default 0,
  add column if not exists deduct_amount    numeric not null default 0,
  add column if not exists tds_amount       numeric not null default 0,
  add column if not exists round_off        numeric not null default 0,
  add column if not exists net_amount       numeric,
  add column if not exists party_note       text,
  add column if not exists remarks          text,
  add column if not exists status           text not null default 'generated',
  add column if not exists pdf_path         text,
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_by     uuid,
  add column if not exists cancel_reason    text,
  add column if not exists is_legacy        boolean not null default false,
  add column if not exists document_no      text,
  add column if not exists sent_at          timestamptz,
  add column if not exists sent_by          uuid,
  add column if not exists payment_mode     text,
  add column if not exists paid_amount      numeric not null default 0;

-- monday's "Payment Pending" formula: Net Amount - Payment Collected (old per-order rows use their amount)
alter table public.commission_invoices
  add column if not exists payment_pending numeric generated always as (coalesce(net_amount, amount) - paid_amount) stored;

-- every row that exists today is a one-per-order invoice
update public.commission_invoices set is_legacy = true where order_id is not null and party_type is null and not is_legacy;

alter table public.commission_invoices drop constraint if exists ci_party_type_chk;
alter table public.commission_invoices add constraint ci_party_type_chk check (party_type is null or party_type in ('buyer', 'supplier'));
alter table public.commission_invoices drop constraint if exists ci_basis_chk;
alter table public.commission_invoices add constraint ci_basis_chk check (commission_basis is null or commission_basis in ('pct', 'per_kg', 'per_bag'));
alter table public.commission_invoices drop constraint if exists ci_status_chk;
alter table public.commission_invoices add constraint ci_status_chk check (status in ('generated', 'sent', 'pending', 'cancelled'));
alter table public.commission_invoices drop constraint if exists ci_payment_chk;
alter table public.commission_invoices add constraint ci_payment_chk
  check (paid_amount >= 0 and (payment_mode is null or payment_mode in ('neft', 'upi', 'rtgs', 'cash', 'cards', 'online', 'cheque')));
alter table public.commission_invoices drop constraint if exists ci_amounts_chk;
alter table public.commission_invoices add constraint ci_amounts_chk
  check (add_amount >= 0 and deduct_amount >= 0 and tds_amount >= 0 and (commission_value is null or commission_value >= 0));
alter table public.commission_invoices drop constraint if exists ci_period_chk;
alter table public.commission_invoices add constraint ci_period_chk check (period_from is null or period_to is null or period_from <= period_to);
alter table public.commission_invoices drop constraint if exists ci_shape_chk;
alter table public.commission_invoices add constraint ci_shape_chk check (
  (is_legacy and order_id is not null)
  or (not is_legacy and period_from is not null and period_to is not null and net_amount is not null
      and ((party_type = 'buyer' and buyer_id is not null) or (party_type = 'supplier' and supplier_id is not null)))
);

create index if not exists commission_invoices_party_ix on public.commission_invoices (company_id, party_type, invoice_date desc);

-- ---------------------------------------------------------------- 2. numbering (one global series, no race)
create table if not exists public.commission_invoice_counter (
  id      int primary key default 1 check (id = 1),
  last_no bigint not null default 0
);
insert into public.commission_invoice_counter (id, last_no) values (1, 0) on conflict (id) do nothing;
alter table public.commission_invoice_counter enable row level security;   -- no policy: only the functions below touch it

-- the next number; the row update serialises concurrent callers, and a cancelled invoice keeps its number
create or replace function public.next_commission_invoice_no() returns text
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  update commission_invoice_counter set last_no = last_no + 1 where id = 1 returning last_no into n;
  return n::text;
end $$;
revoke all on function public.next_commission_invoice_no() from public, anon, authenticated;

-- old per-order rows keep CINV-yyyy-nnnn; the new ones take the plain series
create or replace function public.commission_invoice_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.party_type is null then
    new.invoice_no := 'CINV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('cinv_seq')::text, 4, '0');
  else
    new.invoice_no := public.next_commission_invoice_no();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 3. the lines
create table if not exists public.commission_invoice_lines (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.commission_invoices(id) on delete cascade,
  dispatch_id    uuid references public.order_dispatches(id) on delete set null,   -- kept as a snapshot if the entry is removed after a cancel
  order_id       uuid not null references public.orders(id) on delete restrict,
  party_type     text not null check (party_type in ('buyer', 'supplier')),
  sr_no          int  not null,
  counterparty   text,
  count_label    text,
  invoice_no     text,   -- the dispatch entry's Invoice No. (monday: the subitem's "Invoice No.")
  invoice_date   date,
  quantity       numeric not null,
  uom            text,
  total_weight   numeric,
  value          numeric,
  basis          text check (basis is null or basis in ('pct', 'per_kg', 'per_bag')),
  rate           numeric,
  amount         numeric not null check (amount >= 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
-- the rule that stops double billing: a dispatch line can be billed once per party while its invoice is live
create unique index if not exists commission_invoice_lines_once_uq on public.commission_invoice_lines (dispatch_id, party_type) where active;
-- earlier draft of this script made the link mandatory and RESTRICT: relax it (safe to run again)
alter table public.commission_invoice_lines alter column dispatch_id drop not null;
alter table public.commission_invoice_lines drop constraint if exists commission_invoice_lines_dispatch_id_fkey;
alter table public.commission_invoice_lines add constraint commission_invoice_lines_dispatch_id_fkey
  foreign key (dispatch_id) references public.order_dispatches(id) on delete set null;
create index if not exists commission_invoice_lines_invoice_ix on public.commission_invoice_lines (invoice_id);
create index if not exists commission_invoice_lines_order_ix on public.commission_invoice_lines (order_id);

alter table public.commission_invoice_lines enable row level security;
drop policy if exists cil_sel on public.commission_invoice_lines;
create policy cil_sel on public.commission_invoice_lines for select to authenticated
  using (has_permission('order.read') or has_permission('order.manage'));
-- no insert / update / delete policy: the functions below are the only way in

-- ---------------------------------------------------------------- 4. which dispatch lines can be billed
-- p_party = null lists every party of the Business Unit (used to fill the party list of the create form).
-- A dispatch entry is monday's Dispatch and Billing SUBITEM (a partial or full dispatch). Business Unit = the order's company (the parent).
-- Invoice No. / Invoice Date = the entry's own (monday's subitem columns); when the entry has no date the order's invoice date is used
-- (monday: the subitem inherits the parent's), then the mill invoice date, then the dispatch date.
-- Commission = the entry's own amount (buyer_commission / supplier_commission), worked out from the order's terms
-- when blank; a manual type + value replaces it for every line (monday: "Commission Type / Value").
drop function if exists public.commission_candidate_lines(uuid, text, uuid, date, date, text, numeric);
create or replace function public.commission_candidate_lines(
  p_company uuid, p_party_type text, p_party uuid, p_from date, p_to date,
  p_basis text default null, p_value numeric default null)
returns table(dispatch_id uuid, order_id uuid, order_no text, party_id uuid, party_name text, counterparty text, count_label text, invoice_no text, invoice_date date,
              quantity numeric, uom text, total_weight numeric, value numeric, basis text, rate numeric, amount numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('order.read') or has_permission('order.manage')) then
    raise exception 'You need permission to view orders';
  end if;
  if p_party_type not in ('buyer', 'supplier') then raise exception 'Party type must be Buyer or Supplier'; end if;
  return query
  select x.dispatch_id, x.order_id, x.order_no, x.party_id, x.party_name, x.counterparty, x.count_label, x.invoice_no, x.invoice_date, x.quantity, x.uom, x.total_weight,
         x.value, x.basis, x.rate, x.amount
  from (
    select od.id as dispatch_id, o.id as order_id, o.order_no,
           case when p_party_type = 'buyer' then o.buyer_id else o.supplier_id end as party_id,
           case when p_party_type = 'buyer' then bm.name else sm.name end as party_name,
           case when p_party_type = 'buyer' then sm.name else bm.name end as counterparty,
           coalesce(nullif(btrim(cm.name), ''), cm.display_name) as count_label,
           coalesce(nullif(btrim(od.invoice_no), ''), od.mill_invoice_no) as invoice_no,
           coalesce(od.invoice_date, o.invoice_date, od.mill_invoice_date, od.dispatch_date) as invoice_date,
           od.quantity, o.uom, od.total_weight, od.entry_value as value,
           case when p_basis is not null then p_basis
                when p_party_type = 'buyer' then o.buyer_comm_basis else o.supplier_comm_basis end as basis,
           case when p_basis is not null then p_value
                when p_party_type = 'buyer' then o.buyer_comm_value else o.supplier_comm_value end as rate,
           round(case when p_basis is not null
                      then trade_commission(p_basis, p_value, od.entry_value, o.uom, od.quantity, od.total_weight, o.bag_weight)
                      when p_party_type = 'buyer'
                      then coalesce(od.buyer_commission, trade_commission(o.buyer_comm_basis, o.buyer_comm_value, od.entry_value, o.uom, od.quantity, od.total_weight, o.bag_weight))
                      else coalesce(od.supplier_commission, trade_commission(o.supplier_comm_basis, o.supplier_comm_value, od.entry_value, o.uom, od.quantity, od.total_weight, o.bag_weight))
                 end, 2) as amount
    from order_dispatches od
    join orders o on o.id = od.order_id
    left join count_master cm on cm.id = o.count_id
    left join supplier_master sm on sm.id = o.supplier_id
    left join buyer_master bm on bm.id = o.buyer_id
    where o.company_id = p_company
      and o.status in ('open_for_execution', 'closed')
      and (p_party is null or (p_party_type = 'buyer' and o.buyer_id = p_party) or (p_party_type = 'supplier' and o.supplier_id = p_party))
      and coalesce(od.invoice_date, o.invoice_date, od.mill_invoice_date, od.dispatch_date) between p_from and p_to
      and not exists (select 1 from commission_invoice_lines l where l.dispatch_id = od.id and l.party_type = p_party_type and l.active)
      and not exists (select 1 from commission_invoices ci where ci.order_id = o.id and ci.is_legacy and ci.status <> 'cancelled')
  ) x
  where x.amount is not null
  order by x.invoice_date, x.order_no, x.dispatch_id;
end $$;
revoke all on function public.commission_candidate_lines(uuid, text, uuid, date, date, text, numeric) from public, anon;
grant execute on function public.commission_candidate_lines(uuid, text, uuid, date, date, text, numeric) to authenticated;

-- The parties of a Business Unit that still have something to bill (monday: the Company list is loaded per Business Unit)
create or replace function public.commission_billable_parties(p_company uuid, p_party_type text)
returns table(party_id uuid, party_name text, lines bigint, first_date date, last_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('order.read') or has_permission('order.manage')) then raise exception 'You need permission to view orders'; end if;
  return query
  select c.party_id, c.party_name, count(*), min(c.invoice_date), max(c.invoice_date)
  from commission_candidate_lines(p_company, p_party_type, null, date '2000-01-01', date '2100-12-31') c
  group by c.party_id, c.party_name
  order by c.party_name;
end $$;
revoke all on function public.commission_billable_parties(uuid, text) from public, anon;
grant execute on function public.commission_billable_parties(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 5. create an invoice (all amounts are worked out here, not in the browser)
-- p: { company_id, party_type, party_id, period_from, period_to, invoice_date?, commission_basis?, commission_value?,
--      dispatch_ids: [uuid], add_amount?, deduct_amount?, tds_amount?, round_off?, party_note?, remarks? }
create or replace function public.create_commission_invoice(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := nullif(p->>'company_id', '')::uuid;
  v_type    text := p->>'party_type';
  v_party   uuid := nullif(p->>'party_id', '')::uuid;
  v_from    date := nullif(p->>'period_from', '')::date;
  v_to      date := nullif(p->>'period_to', '')::date;
  v_date    date := coalesce(nullif(p->>'invoice_date', '')::date, (now() at time zone 'Asia/Kolkata')::date);
  v_basis   text := nullif(p->>'commission_basis', '');
  v_value   numeric := nullif(p->>'commission_value', '')::numeric;
  v_add     numeric := coalesce(nullif(p->>'add_amount', '')::numeric, 0);
  v_deduct  numeric := coalesce(nullif(p->>'deduct_amount', '')::numeric, 0);
  v_tds     numeric := coalesce(nullif(p->>'tds_amount', '')::numeric, 0);
  v_round   numeric := coalesce(nullif(p->>'round_off', '')::numeric, 0);
  v_ids     uuid[];
  v_found   int;
  v_total   numeric; v_bags numeric; v_net numeric;
  v_inv     uuid;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  if v_company is null or not exists (select 1 from companies where id = v_company and is_active) then raise exception 'Choose an active Business Unit'; end if;
  if v_type not in ('buyer', 'supplier') then raise exception 'Party type must be Buyer or Supplier'; end if;
  if v_party is null then raise exception 'Choose the % party', v_type; end if;
  if v_type = 'buyer' and not exists (select 1 from buyer_master where id = v_party) then raise exception 'Buyer not found'; end if;
  if v_type = 'supplier' and not exists (select 1 from supplier_master where id = v_party) then raise exception 'Supplier not found'; end if;
  if v_from is null or v_to is null then raise exception 'Invoice From and To dates are required'; end if;
  if v_from > v_to then raise exception 'Invoice From date cannot be after the To date'; end if;
  if (v_basis is null) <> (v_value is null) then raise exception 'Give both the commission type and the commission value, or neither'; end if;
  if v_basis is not null and v_basis not in ('pct', 'per_kg', 'per_bag') then raise exception 'Commission type must be Percentage, KG or BAG'; end if;
  if v_value is not null and v_value < 0 then raise exception 'Commission value cannot be negative'; end if;
  if v_add < 0 or v_deduct < 0 or v_tds < 0 then raise exception 'Add, Deduct and TDS cannot be negative'; end if;

  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(coalesce(p->'dispatch_ids', '[]'::jsonb)) x;
  if v_ids is null or array_length(v_ids, 1) = 0 then raise exception 'Select at least one dispatch line'; end if;

  -- lock the entries so two people cannot bill the same line at the same moment
  perform 1 from order_dispatches where id = any (v_ids) order by id for update;

  select count(*), sum(c.amount), sum(c.quantity) into v_found, v_total, v_bags
  from commission_candidate_lines(v_company, v_type, v_party, v_from, v_to, v_basis, v_value) c
  where c.dispatch_id = any (v_ids);
  if v_found <> array_length(v_ids, 1) then
    raise exception 'Some selected lines can no longer be billed (already invoiced, or outside the Business Unit, party or dates). Reload the list and try again.';
  end if;

  v_net := v_total + v_add - v_deduct;
  if v_net < 0 then raise exception 'The net amount cannot be negative (deduct is larger than the commission plus add)'; end if;
  if v_net = 0 then raise exception 'The net amount is 0: there is nothing to invoice (check the commission rate on the lines, or Add / Deduct)'; end if;

  begin
    insert into commission_invoices (invoice_date, company_id, buyer_id, supplier_id, party_type, period_from, period_to,
                                     commission_basis, commission_value, total_bags, commission_total, add_amount, deduct_amount,
                                     tds_amount, round_off, net_amount, amount, party_note, remarks, document_no)
    values (v_date, v_company, case when v_type = 'buyer' then v_party end, case when v_type = 'supplier' then v_party end,
            v_type, v_from, v_to, v_basis, v_value, v_bags, v_total, v_add, v_deduct, v_tds, v_round, v_net, v_net,
            nullif(btrim(coalesce(p->>'party_note', '')), ''), nullif(btrim(coalesce(p->>'remarks', '')), ''),
            nullif(btrim(coalesce(p->>'document_no', '')), ''))
    returning id into v_inv;

    insert into commission_invoice_lines (invoice_id, dispatch_id, order_id, party_type, sr_no, counterparty, count_label, invoice_no, invoice_date,
                                          quantity, uom, total_weight, value, basis, rate, amount)
    select v_inv, c.dispatch_id, c.order_id, v_type,
           row_number() over (order by c.invoice_date, c.order_no, c.dispatch_id)::int,
           c.counterparty, c.count_label, c.invoice_no, c.invoice_date, c.quantity, c.uom, c.total_weight, c.value, c.basis, c.rate, c.amount
    from commission_candidate_lines(v_company, v_type, v_party, v_from, v_to, v_basis, v_value) c
    where c.dispatch_id = any (v_ids);
  exception when unique_violation then
    raise exception 'Some selected lines were invoiced a moment ago. Reload the list and try again.';
  end;
  return v_inv;
end $$;
revoke all on function public.create_commission_invoice(jsonb) from public, anon;
grant execute on function public.create_commission_invoice(jsonb) to authenticated;

-- ---------------------------------------------------------------- 6. cancel (frees the lines so they can be billed again)
create or replace function public.cancel_commission_invoice(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare ci commission_invoices;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for cancelling'; end if;
  select * into ci from commission_invoices where id = p_id for update;
  if not found then raise exception 'Commission invoice not found'; end if;
  if ci.is_legacy then raise exception 'This is an old one-per-order invoice and cannot be cancelled here'; end if;
  if ci.status = 'cancelled' then raise exception 'This invoice is already cancelled'; end if;
  if ci.paid_amount > 0 or exists (select 1 from tasks t where t.commission_invoice_id = p_id and coalesce(t.amount_collected, 0) > 0) then
    raise exception 'Payment has already been recorded against this invoice; it cannot be cancelled (delete the payments first if it was a mistake)';
  end if;
  update commission_invoices
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason)
   where id = p_id;
  update commission_invoice_lines set active = false where invoice_id = p_id;
  -- its delivery task is no longer needed
  begin
    update tasks set status = 'cancelled' where commission_invoice_id = p_id and status not in ('done', 'cancelled');
  exception when others then
    null;   -- the invoice is cancelled either way; a person can close the task by hand
  end;
  begin
    -- the Payment Collection follow-up raised from its delivery task is not needed either
    update tasks set status = 'cancelled'
     where task_type = 'payment_collection' and status in ('todo', 'in_progress', 'blocked')
       and source_task_id in (select id from tasks where commission_invoice_id = p_id);
  exception when others then
    null;
  end;
end $$;
revoke all on function public.cancel_commission_invoice(uuid, text) from public, anon;
grant execute on function public.cancel_commission_invoice(uuid, text) to authenticated;

-- the old one-per-order path is replaced by the register
create or replace function public.generate_commission_invoice(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Commission invoices are now made from the Commission Invoices page (pick the Business Unit, party and dates)';
end $$;

-- ---------------------------------------------------------------- 7. delivery task: one per invoice, for either party
create or replace function public.commission_invoice_tasks()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare days int; o orders; pname text; who uuid; maker uuid;
begin
  if new.status = 'cancelled' then return null; end if;
  -- monday leaves People and Accounts empty on most delivery items. Here Accounts is whoever generated the invoice, and Person falls
  -- back to that person when the party has no active Messenger, so a delivery task is never left without anyone.
  select p.id into maker from profiles p where p.id = new.created_by and p.is_active;
  select * into o from orders where id = new.order_id;
  select default_due_days into days from task_types where key = 'commission_invoice_delivery';
  if new.party_type = 'supplier' then
    select s.name, (select p.id from profiles p where p.id = s.messenger_id and p.is_active) into pname, who from supplier_master s where s.id = new.supplier_id;
  else
    select b.name into pname from buyer_master b where b.id = new.buyer_id;
    who := public.default_task_assignee(new.buyer_id);
  end if;
  insert into tasks (task_type, title, due_date, assigned_to, accounts_staff_id, buyer_id, supplier_id, order_id, commission_invoice_id, amount, details, dedupe_key)
  values ('commission_invoice_delivery',
          'Deliver commission invoice ' || coalesce(new.invoice_no, '') ||
            case when o.order_no is not null then ' (' || o.order_no || ')' when pname is not null then ' - ' || pname else '' end,
          (now() at time zone 'Asia/Kolkata')::date + coalesce(days, 2), coalesce(who, maker), maker,
          new.buyer_id, new.supplier_id, new.order_id, new.id, new.amount,
          jsonb_build_object('delivery_status', 'not_delivered', 'invoice_no', new.invoice_no, 'invoice_date', new.invoice_date::text), 'ci:' || new.id)
  on conflict (dedupe_key) do nothing;
  return null;
end $$;
revoke execute on function public.commission_invoice_tasks() from public, anon, authenticated;

-- ---------------------------------------------------------------- 8. closing an order, and the pending list, follow the lines
-- An order's commission is done when every dispatch entry with commission has been billed to each party
-- (or an old one-per-order invoice exists). An order with no commission has nothing to bill.
create or replace function public.order_commission_billed(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from commission_invoices ci where ci.order_id = p_order and ci.is_legacy and ci.status <> 'cancelled')
    or (
      exists (select 1 from order_dispatches where order_id = p_order)
      and not exists (
        select 1 from order_dispatches od
        where od.order_id = p_order
          and ((coalesce(od.buyer_commission, 0) > 0
                and not exists (select 1 from commission_invoice_lines l where l.dispatch_id = od.id and l.party_type = 'buyer' and l.active))
            or (coalesce(od.supplier_commission, 0) > 0
                and not exists (select 1 from commission_invoice_lines l where l.dispatch_id = od.id and l.party_type = 'supplier' and l.active)))
      )
    )
$$;
revoke all on function public.order_commission_billed(uuid) from public, anon;
grant execute on function public.order_commission_billed(uuid) to authenticated;

-- Same as the Dispatch and Billing version (20261125110000: net dispatched, cancelled and returned quantities);
-- only the commission-invoice step differs: it follows the invoice lines.
create or replace function public.order_close_status(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; disp numeric; canc numeric; retq numeric; rec numeric; paid numeric; inv boolean;
begin
  select * into o from orders where id = p_order;
  if not found then return null; end if;
  disp := order_net_dispatched(p_order);
  canc := order_cancelled(p_order);
  retq := order_returned_qty(p_order);
  select coalesce(sum(amount) filter (where kind='buyer_receipt'),0), coalesce(sum(amount) filter (where kind='supplier_payment'),0) into rec, paid from order_payments where order_id = p_order;
  inv := public.order_commission_billed(p_order);
  return jsonb_build_object(
    'dispatched', disp, 'cancelled', canc, 'returned', retq, 'quantity', o.quantity,
    'quantity_done', disp > 0 and (disp + canc >= o.quantity or retq > 0),
    'buyer_received', rec, 'buyer_value', o.buyer_rate * o.quantity, 'buyer_done', rec >= o.buyer_rate * o.quantity,
    'supplier_paid', paid, 'supplier_value', o.supplier_rate * o.quantity, 'supplier_done', paid >= o.supplier_rate * o.quantity,
    'invoice_done', inv);
end $$;

-- billing a line (or cancelling the invoice) can close or reopen the picture for its order
drop trigger if exists trg_cil_close on public.commission_invoice_lines;
create trigger trg_cil_close after insert or update or delete on public.commission_invoice_lines
  for each row execute function public.order_close_check();

-- orders with dispatched commission that is not yet on any invoice
create or replace function public.pending_commission_bills() returns table(order_id uuid, order_no text, order_date date, status text, buyer_id uuid, supplier_id uuid, company_id uuid, quantity numeric, uom text, commission_type text, commission_value numeric, commission_amount numeric, days_pending integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('order.read') or has_permission('order.manage')) then
    raise exception 'You need permission to view orders';
  end if;
  return query
  select o.id, o.order_no, o.order_date, o.status, o.buyer_id, o.supplier_id, o.company_id,
         sum(od.quantity), o.uom, o.commission_type, o.commission_value,
         sum(case when not exists (select 1 from commission_invoice_lines l where l.dispatch_id = od.id and l.party_type = 'buyer' and l.active)
                  then coalesce(od.buyer_commission, 0) else 0 end
           + case when not exists (select 1 from commission_invoice_lines l where l.dispatch_id = od.id and l.party_type = 'supplier' and l.active)
                  then coalesce(od.supplier_commission, 0) else 0 end),
         greatest(0, (current_date - min(coalesce(od.invoice_date, o.invoice_date, od.mill_invoice_date, od.dispatch_date))))::int
  from orders o
  join order_dispatches od on od.order_id = o.id
  where o.status in ('open_for_execution', 'closed')
    and not exists (select 1 from commission_invoices ci where ci.order_id = o.id and ci.is_legacy and ci.status <> 'cancelled')
    and ((coalesce(od.buyer_commission, 0) > 0
          and not exists (select 1 from commission_invoice_lines l where l.dispatch_id = od.id and l.party_type = 'buyer' and l.active))
      or (coalesce(od.supplier_commission, 0) > 0
          and not exists (select 1 from commission_invoice_lines l where l.dispatch_id = od.id and l.party_type = 'supplier' and l.active)))
  group by o.id
  order by min(coalesce(od.invoice_date, o.invoice_date, od.mill_invoice_date, od.dispatch_date)), o.order_no;
end $$;

-- Same as the Dispatch and Billing version (20261125110000, balance by order_balance); only the commission tile differs.
create or replace function public.billing_dispatch_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t date := (now() at time zone 'Asia/Kolkata')::date;
  res jsonb := jsonb_build_object('as_of', t);
  a int; b int; c numeric; d numeric; e int;
begin
  if not (has_permission('order.read') or has_permission('order.manage')) then
    raise exception 'You need permission to view orders';
  end if;
  select count(*), coalesce(sum(quantity), 0) into a, c from order_dispatches where dispatch_date = t;
  select count(*), coalesce(sum(bal), 0) into b, d from (
    select order_balance(o.id) bal
    from orders o where o.status in ('confirmed', 'open_for_execution') and o.tentative_dispatch_date = t) q where bal > 0;
  res := res || jsonb_build_object('dispatch_today', jsonb_build_object('dispatched_entries', a, 'dispatched_qty', c, 'scheduled_orders', b, 'scheduled_balance_qty', d));
  select count(*), count(*) filter (where dispatch_date < t - 3), coalesce(min(t - dispatch_date), 0) into a, b, e
    from order_dispatches where mill_invoice_no is null and mill_invoice_date is null;
  res := res || jsonb_build_object('billing_pending', jsonb_build_object('pending', a, 'older_than_3_days', b, 'oldest_days', (select coalesce(max(t - dispatch_date), 0) from order_dispatches where mill_invoice_no is null and mill_invoice_date is null)));
  select count(*), coalesce(sum(p.commission_amount), 0), count(*) filter (where p.days_pending > 7) into a, c, b from public.pending_commission_bills() p;
  res := res || jsonb_build_object('commission_pending', jsonb_build_object('pending', a, 'amount', c, 'older_than_7_days', b));
  select count(*), coalesce(sum(tr.freight_amount), 0), count(*) filter (where od.dispatch_date < t - 7) into a, c, b
    from order_dispatches od join order_transports tr on tr.id = od.transport_id
    where tr.kind = 'third_party' and od.transporter_invoice_no is null;
  res := res || jsonb_build_object('transport_invoice_pending', jsonb_build_object('pending', a, 'freight_amount', c, 'older_than_7_days', b));
  return res;
end $$;

-- ---------------------------------------------------------------- 9. the stored PDF (private bucket)
insert into storage.buckets (id, name, public, file_size_limit)
values ('commission-invoices', 'commission-invoices', false, 10485760)
on conflict (id) do nothing;
drop policy if exists commission_invoices_storage_select on storage.objects;
create policy commission_invoices_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'commission-invoices' and has_any_permission(array['order.read', 'order.manage']));
drop policy if exists commission_invoices_storage_insert on storage.objects;
create policy commission_invoices_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'commission-invoices' and has_permission('order.manage'));
drop policy if exists commission_invoices_storage_update on storage.objects;
create policy commission_invoices_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'commission-invoices' and has_permission('order.manage'))
  with check (bucket_id = 'commission-invoices' and has_permission('order.manage'));
drop policy if exists commission_invoices_storage_delete on storage.objects;
create policy commission_invoices_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'commission-invoices' and has_permission('order.manage'));

-- the invoice row records where its PDF is (only the manager can set it, only on a live invoice)
create or replace function public.set_commission_invoice_pdf(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  update commission_invoices set pdf_path = nullif(btrim(p_path), '') where id = p_id and status <> 'cancelled' and not is_legacy;
end $$;
revoke all on function public.set_commission_invoice_pdf(uuid, text) from public, anon;
grant execute on function public.set_commission_invoice_pdf(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 9a. a billed dispatch entry cannot be removed or changed under its invoice
-- monday keeps Cancel / Return as statuses on the subitem; CRM+ removes a wrong entry while it is still unbilled.
-- Once it is on a live invoice, that invoice has to be cancelled first, so an invoice never disagrees with the dispatch.
create or replace function public.commission_dispatch_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv text;
begin
  select ci.invoice_no into inv
  from commission_invoice_lines l join commission_invoices ci on ci.id = l.invoice_id
  where l.dispatch_id = old.id and l.active
  limit 1;
  if inv is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'This dispatch entry is billed on commission invoice %. Cancel that invoice first, then remove the entry.', inv;
  end if;
  if new.quantity is distinct from old.quantity or new.invoice_date is distinct from old.invoice_date
     or new.invoice_no is distinct from old.invoice_no then
    raise exception 'This dispatch entry is billed on commission invoice %. Cancel that invoice first, then change the quantity, invoice no. or invoice date.', inv;
  end if;
  return new;
end $$;
revoke all on function public.commission_dispatch_guard() from public, anon, authenticated;
drop trigger if exists trg_od_a_commission_guard on public.order_dispatches;
create trigger trg_od_a_commission_guard before update or delete on public.order_dispatches
  for each row execute function public.commission_dispatch_guard();

-- ---------------------------------------------------------------- 9b. payments and status (monday: Mode of Payment, Payment Collected, Payment Pending, Status)
create table if not exists public.commission_invoice_payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.commission_invoices(id) on delete cascade,
  amount     numeric not null check (amount > 0),
  paid_on    date not null default (now() at time zone 'Asia/Kolkata')::date,
  mode       text check (mode is null or mode in ('neft', 'upi', 'rtgs', 'cash', 'cards', 'online', 'cheque')),   -- null only for a receipt copied from a follow-up payment with no mode
  reference  text,
  note       text,
  task_payment_id uuid references public.task_payments(id) on delete set null,   -- the follow-up payment this receipt is the pair of
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
-- earlier draft of this script: widen the modes and add the link (safe to run again)
alter table public.commission_invoice_payments alter column mode drop not null;
alter table public.commission_invoice_payments drop constraint if exists commission_invoice_payments_mode_check;
alter table public.commission_invoice_payments add constraint commission_invoice_payments_mode_check check (mode is null or mode in ('neft', 'upi', 'rtgs', 'cash', 'cards', 'online', 'cheque'));
alter table public.commission_invoice_payments add column if not exists task_payment_id uuid references public.task_payments(id) on delete set null;
create unique index if not exists commission_invoice_payments_task_uq on public.commission_invoice_payments (task_payment_id) where task_payment_id is not null;
create index if not exists commission_invoice_payments_invoice_ix on public.commission_invoice_payments (invoice_id, paid_on);
alter table public.commission_invoice_payments enable row level security;
drop policy if exists cip_sel on public.commission_invoice_payments;
create policy cip_sel on public.commission_invoice_payments for select to authenticated
  using (has_permission('order.read') or has_permission('order.manage'));
-- no write policy: the functions below are the only way in, and they keep paid_amount in step

-- Fully paid: the delivery task no longer says "payment pending" and its Payment Collection follow-up is done.
-- Best effort: if a task rule refuses the change, the payment is still recorded and the follow-up can be closed by hand.
create or replace function public.commission_invoice_close_followups(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d record; f record;
begin
  for d in select id from tasks where commission_invoice_id = p_invoice and task_type = 'commission_invoice_delivery' loop
    begin
      update tasks set details = coalesce(details, '{}'::jsonb) || jsonb_build_object('pending_payment', false)
       where id = d.id and coalesce((details->>'pending_payment')::boolean, false);
    exception when others then null;
    end;
    for f in select id from tasks
              where task_type = 'payment_collection' and source_task_id = d.id and status in ('todo', 'in_progress', 'blocked') loop
      begin
        update tasks set status = 'done' where id = f.id;
        perform public.task_log(f.id, 'comment', null, null, 'Closed: the commission invoice is fully paid');
      exception when others then null;
      end;
    end loop;
  end loop;
end $$;
revoke all on function public.commission_invoice_close_followups(uuid) from public, anon, authenticated;

create or replace function public.record_commission_payment(
  p_invoice uuid, p_amount numeric, p_mode text, p_paid_on date default null, p_reference text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ci commission_invoices; today date := (now() at time zone 'Asia/Kolkata')::date; pending numeric; pid uuid; fid uuid; tpid uuid;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select * into ci from commission_invoices where id = p_invoice for update;
  if not found then raise exception 'Commission invoice not found'; end if;
  if ci.status = 'cancelled' then raise exception 'This invoice is cancelled; no payment can be recorded against it'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a payment amount above 0'; end if;
  if p_amount <> round(p_amount, 2) then raise exception 'The payment amount can have at most 2 decimals'; end if;
  if p_mode is null or p_mode not in ('neft', 'upi', 'rtgs', 'cash', 'cards', 'online', 'cheque') then raise exception 'Choose the mode of payment (NEFT, UPI, RTGS, Cash, Cards, Online or Cheque)'; end if;
  if coalesce(p_paid_on, today) > today then raise exception 'The payment date cannot be in the future'; end if;
  pending := coalesce(ci.net_amount, ci.amount) - ci.paid_amount;
  if p_amount > pending then raise exception 'The payment (%) is more than the amount pending (%)', p_amount, pending; end if;
  insert into commission_invoice_payments (invoice_id, amount, paid_on, mode, reference, note)
  values (p_invoice, p_amount, coalesce(p_paid_on, today), p_mode, nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into pid;
  update commission_invoices set paid_amount = paid_amount + p_amount, payment_mode = p_mode where id = p_invoice;
  -- the open Payment Collection follow-up shows the same money (the collector sees it, the amounts agree).
  -- Not for old per-order invoices: a follow-up with an order posts its payments there as buyer receipts.
  if not ci.is_legacy then
    select f.id into fid from tasks f join tasks d on d.id = f.source_task_id
     where d.commission_invoice_id = p_invoice and d.task_type = 'commission_invoice_delivery'
       and f.task_type = 'payment_collection' and f.status in ('todo', 'in_progress', 'blocked')
     order by f.created_at limit 1;
    if fid is not null then
      begin
        perform set_config('app.ci_mirror', '1', true);
        insert into task_payments (task_id, amount, paid_on, mode, reference, notes)
        values (fid, p_amount, coalesce(p_paid_on, today), p_mode, nullif(btrim(coalesce(p_reference, '')), ''), 'Recorded on commission invoice ' || coalesce(ci.invoice_no, ''))
        returning id into tpid;
        perform set_config('app.ci_mirror', '', true);
        update commission_invoice_payments set task_payment_id = tpid where id = pid;
      exception when others then
        perform set_config('app.ci_mirror', '', true);   -- the receipt stands; the follow-up can be updated by hand
      end;
    end if;
  end if;
  if p_amount >= pending then perform public.commission_invoice_close_followups(p_invoice); end if;
  return pid;
end $$;
revoke all on function public.record_commission_payment(uuid, numeric, text, date, text, text) from public, anon;
grant execute on function public.record_commission_payment(uuid, numeric, text, date, text, text) to authenticated;

-- a wrong entry can be removed; the collected amount and the last mode follow
create or replace function public.delete_commission_payment(p_payment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv uuid;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select invoice_id into inv from commission_invoice_payments where id = p_payment;
  if inv is null then raise exception 'Payment not found'; end if;
  perform 1 from commission_invoices where id = inv for update;
  delete from commission_invoice_payments where id = p_payment;
  update commission_invoices
     set paid_amount  = coalesce((select sum(amount) from commission_invoice_payments where invoice_id = inv), 0),
         payment_mode = (select mode from commission_invoice_payments where invoice_id = inv order by paid_on desc, created_at desc limit 1)
   where id = inv;
end $$;
revoke all on function public.delete_commission_payment(uuid) from public, anon;
grant execute on function public.delete_commission_payment(uuid) to authenticated;

-- A follow-up raised after part of the invoice was already paid starts with that amount collected, so it shows what is really left.
create or replace function public.commission_followup_catch_up() returns trigger
language plpgsql security definer set search_path = public as $$
declare ci commission_invoices;
begin
  select c.* into ci
    from tasks d join commission_invoices c on c.id = d.commission_invoice_id
   where d.id = new.source_task_id and d.task_type = 'commission_invoice_delivery' and not c.is_legacy and c.status <> 'cancelled';
  if not found or ci.paid_amount <= 0 then return null; end if;
  begin
    perform set_config('app.ci_mirror', '1', true);
    insert into task_payments (task_id, amount, paid_on, mode, notes)
    values (new.id, ci.paid_amount, (now() at time zone 'Asia/Kolkata')::date, ci.payment_mode,
            'Already collected on commission invoice ' || coalesce(ci.invoice_no, ''));
    perform set_config('app.ci_mirror', '', true);
  exception when others then
    perform set_config('app.ci_mirror', '', true);
  end;
  return null;
end $$;
revoke all on function public.commission_followup_catch_up() from public, anon, authenticated;
drop trigger if exists trg_tasks_commission_followup on public.tasks;
create trigger trg_tasks_commission_followup after insert on public.tasks
  for each row when (new.task_type = 'payment_collection' and new.source_task_id is not null)
  execute function public.commission_followup_catch_up();

-- A payment recorded on the Payment Collection follow-up of a commission invoice is also a receipt of that invoice.
-- Skipped when the payment was itself copied from the invoice (app.ci_mirror), for old per-order invoices, and for cancelled invoices.
-- Never more than the pending amount is recorded on the invoice (an over-payment on the task stays on the task).
create or replace function public.commission_task_payment_mirror() returns trigger
language plpgsql security definer set search_path = public as $$
declare ci commission_invoices; pend numeric; amt numeric;
begin
  if coalesce(current_setting('app.ci_mirror', true), '') = '1' then return null; end if;
  select c.* into ci
    from tasks f
    join tasks d on d.id = f.source_task_id and d.task_type = 'commission_invoice_delivery'
    join commission_invoices c on c.id = d.commission_invoice_id
   where f.id = new.task_id and f.task_type = 'payment_collection' and c.status <> 'cancelled' and not c.is_legacy
   for update of c;
  if not found then return null; end if;
  pend := coalesce(ci.net_amount, ci.amount) - ci.paid_amount;
  amt := least(new.amount, pend);
  if amt <= 0 then return null; end if;
  insert into commission_invoice_payments (invoice_id, amount, paid_on, mode, reference, note, task_payment_id, created_by)
  values (ci.id, amt, new.paid_on, new.mode, new.reference,
          coalesce(new.notes, 'Recorded on the payment follow-up') || case when amt < new.amount then ' (only ' || amt || ' of ' || new.amount || ' fitted the invoice)' else '' end,
          new.id, new.created_by);
  update commission_invoices set paid_amount = paid_amount + amt, payment_mode = coalesce(new.mode, payment_mode) where id = ci.id;
  if amt >= pend then perform public.commission_invoice_close_followups(ci.id); end if;
  return null;
end $$;
revoke all on function public.commission_task_payment_mirror() from public, anon, authenticated;
drop trigger if exists trg_task_payment_commission on public.task_payments;
create trigger trg_task_payment_commission after insert on public.task_payments
  for each row execute function public.commission_task_payment_mirror();

-- Change the free-text details of a live invoice (monday lets these columns be edited): Document No, Text (printed under the
-- party's address) and Remarks. Amounts, dates, party and lines stay as generated: to change those, cancel and re-issue.
create or replace function public.update_commission_invoice_details(p_id uuid, p_document_no text, p_party_note text, p_remarks text) returns void
language plpgsql security definer set search_path = public as $$
declare ci commission_invoices;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  select * into ci from commission_invoices where id = p_id for update;
  if not found then raise exception 'Commission invoice not found'; end if;
  if ci.status = 'cancelled' then raise exception 'A cancelled invoice cannot be changed'; end if;
  if ci.is_legacy then raise exception 'This is an old one-per-order invoice and cannot be edited here'; end if;
  update commission_invoices
     set document_no = nullif(btrim(coalesce(p_document_no, '')), ''),
         party_note  = nullif(btrim(coalesce(p_party_note, '')), ''),
         remarks     = nullif(btrim(coalesce(p_remarks, '')), '')
   where id = p_id;
end $$;
revoke all on function public.update_commission_invoice_details(uuid, text, text, text) from public, anon;
grant execute on function public.update_commission_invoice_details(uuid, text, text, text) to authenticated;

-- Generated -> Sent (done) / Pending, as on monday's Status column. Cancelling has its own function.
create or replace function public.set_commission_invoice_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare ci commission_invoices;
begin
  if not has_permission('order.manage') then raise exception 'You need the "Create and manage orders" permission'; end if;
  if p_status not in ('generated', 'sent', 'pending') then raise exception 'Status must be Generated, Sent or Pending (use Cancel to cancel an invoice)'; end if;
  select * into ci from commission_invoices where id = p_id for update;
  if not found then raise exception 'Commission invoice not found'; end if;
  if ci.status = 'cancelled' then raise exception 'A cancelled invoice cannot change status'; end if;
  update commission_invoices
     set status = p_status,
         sent_at = case when p_status = 'sent' then now() else null end,
         sent_by = case when p_status = 'sent' then auth.uid() else null end
   where id = p_id;
end $$;
revoke all on function public.set_commission_invoice_status(uuid, text) from public, anon;
grant execute on function public.set_commission_invoice_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 10. the Commission Invoice Delivery board shows either party
-- monday's "Buyer" column holds the buyer or, on a supplier invoice, the supplier. Same columns as before.
create or replace view public.board_commission_invoice_delivery with (security_invoker = true) as
select
  t.id,
  t.task_no                                              as item_no,
  t.title                                                as name,
  t.assigned_to                                          as person_id,
  pe.name                                                as people,
  t.accounts_staff_id                                    as accounts_id,
  ac.name                                                as accounts,
  t.commission_invoice_id                                as commission_invoice_id,
  coalesce(ci.amount, t.amount)                          as commission_amount,
  t.buyer_id,
  coalesce(b.name, sm.name)                              as buyer,
  coalesce(mp.name, smp.name)                            as buyer_messenger,
  coalesce(ci.invoice_no, t.details->>'invoice_no')      as commission_invoice_no,
  coalesce(ci.invoice_date,
           case when (t.details->>'invoice_date') ~ '^\d{4}-\d{2}-\d{2}$' then (t.details->>'invoice_date')::date end) as invoice_date,
  case t.details->>'acknowledgement' when 'yes' then 'Yes' when 'no' then 'No' end as acknowledgement_received,
  (select count(*) from public.task_attachments a where a.task_id = t.id) as photo_upload_count,
  t.lat, t.lng,
  case when coalesce((t.details->>'pending_payment')::boolean, false) then 'Yes' else 'No' end as pending_payment_status,
  t.start_date                                           as created_date,
  (select pc.id from public.tasks pc where pc.source_task_id = t.id and pc.task_type = 'payment_collection'
    order by pc.created_at limit 1)                      as payment_collection_id,
  t.status, t.due_date, t.created_at
from public.tasks t
left join public.profiles pe on pe.id = t.assigned_to
left join public.profiles ac on ac.id = t.accounts_staff_id
left join public.buyer_master b on b.id = t.buyer_id
left join public.profiles mp on mp.id = b.messenger_id
left join public.supplier_master sm on sm.id = t.supplier_id and t.buyer_id is null
left join public.profiles smp on smp.id = sm.messenger_id
left join public.commission_invoices ci on ci.id = t.commission_invoice_id
where t.task_type = 'commission_invoice_delivery';

commit;
