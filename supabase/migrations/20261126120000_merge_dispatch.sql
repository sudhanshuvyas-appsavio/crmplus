-- Merge to Dispatch (Sales Confirmation > PDF Generation and Merge tab).
-- One dispatch (one truck / one mill invoice) recorded across the Dispatch and Billing items of several Sales
-- Confirmations at once. Rule (from the lead): the confirmations must have the same buyer and the same supplier,
-- and be in Send with Delivery Info. Each item still gets its own dispatch entry (so its status, Fully Dispatch lock,
-- returns, mill-invoice task and commission work as before); the entries share one merge record (DSP-M-YYYY-NNNN).
begin;

create sequence if not exists dispatch_merge_seq;

create table if not exists dispatch_merges (
  id             uuid primary key default gen_random_uuid(),
  merge_no       text unique,
  buyer_id       uuid,
  supplier_id    uuid,
  dispatch_date  date not null default current_date,
  invoice_no     text,
  invoice_date   date,
  vehicle_no     text,
  lr_no          text,
  transport_type text,
  dc_no          text,
  delivery_date  date,
  remarks        text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);

alter table dispatch_merges enable row level security;
drop policy if exists dispatch_merges_sel on dispatch_merges;
create policy dispatch_merges_sel on dispatch_merges for select using (has_permission('order.read') or has_permission('order.manage'));
drop policy if exists dispatch_merges_ins on dispatch_merges;
create policy dispatch_merges_ins on dispatch_merges for insert with check (has_permission('order.manage'));
grant select, insert on dispatch_merges to authenticated;

alter table order_dispatches add column if not exists merge_id uuid references dispatch_merges(id) on delete set null;
create index if not exists order_dispatches_merge_id_idx on order_dispatches(merge_id);

-- p_lines: [{"order_id": uuid, "quantity": number}, ...]
-- p_details: {"dispatch_date","invoice_no","invoice_date","vehicle_no","lr_no","transport_type","dc_no","delivery_date","remarks"}
-- Runs as the caller (RLS and every dispatch guard apply); all entries are saved or none.
create or replace function merge_dispatch(p_lines jsonb, p_details jsonb)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  m_id uuid; m_no text; l jsonb; o record; q numeric;
  v_buyer uuid; v_supplier uuid; first boolean := true; n int := 0;
  d_date date := coalesce(nullif(p_details->>'dispatch_date','')::date, current_date);
  inv text := nullif(trim(p_details->>'invoice_no'),'');
  inv_date date := case when nullif(trim(p_details->>'invoice_no'),'') is null then null else coalesce(nullif(p_details->>'invoice_date','')::date, current_date) end;
begin
  if not has_permission('order.manage') then raise exception 'Your account cannot dispatch items.'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose at least one item to dispatch.';
  end if;

  -- check every line first: same buyer and supplier, Send with Delivery Info, quantity left
  for l in select * from jsonb_array_elements(p_lines) loop
    select od.id, od.order_no, od.quantity, od.uom, od.status, od.dispatched_qty, od.cancelled_qty, od.returned_qty,
           sc.sc_no, sc.stage, sc.status as sc_status, sc.buyer_id, sc.supplier_id
      into o
      from orders od join sales_confirmations sc on sc.id = od.sales_confirmation_id
     where od.id = (l->>'order_id')::uuid;
    if not found then raise exception 'An item was not found or is not linked to a Sales Confirmation.'; end if;
    if o.sc_status = 'cancelled' or o.stage <> 'send_delivery' then
      raise exception '%: only confirmations in Send with Delivery Info can be merged.', o.sc_no;
    end if;
    if o.status = 'cancelled' then raise exception '%: the item is cancelled.', o.order_no; end if;
    if first then v_buyer := o.buyer_id; v_supplier := o.supplier_id; first := false;
    elsif o.buyer_id is distinct from v_buyer or o.supplier_id is distinct from v_supplier then
      raise exception 'Merged confirmations must have the same buyer and the same supplier (% differs).', o.sc_no;
    end if;
    q := (l->>'quantity')::numeric;
    if q is null or q <= 0 then raise exception '%: enter a quantity above 0.', o.order_no; end if;
  end loop;
  if v_buyer is null or v_supplier is null then raise exception 'The confirmations need a buyer and a supplier to be merged.'; end if;

  insert into dispatch_merges (merge_no, buyer_id, supplier_id, dispatch_date, invoice_no, invoice_date, vehicle_no, lr_no,
                               transport_type, dc_no, delivery_date, remarks)
  values ('DSP-M-' || to_char(now(),'YYYY') || '-' || lpad(nextval('dispatch_merge_seq')::text,4,'0'), v_buyer, v_supplier, d_date,
          inv, inv_date, nullif(upper(trim(p_details->>'vehicle_no')),''), nullif(trim(p_details->>'lr_no'),''),
          nullif(p_details->>'transport_type',''), nullif(trim(p_details->>'dc_no'),''), nullif(p_details->>'delivery_date','')::date,
          nullif(trim(p_details->>'remarks'),''))
  returning id, merge_no into m_id, m_no;

  for l in select * from jsonb_array_elements(p_lines) loop
    -- a Draft item starts (In Progress) with its first dispatch, as the Partially Dispatch choice does
    update orders set status = 'open_for_execution' where id = (l->>'order_id')::uuid and status <> 'open_for_execution';
    insert into order_dispatches (order_id, quantity, dispatch_date, invoice_no, invoice_date, mill_invoice_no, mill_invoice_date,
                                  vehicle_no, lr_no, transport_type, dc_no, delivery_date, remarks, person_id, merge_id)
    select od.id, (l->>'quantity')::numeric, d_date, inv, inv_date, inv, inv_date,
           nullif(upper(trim(p_details->>'vehicle_no')),''), nullif(trim(p_details->>'lr_no'),''), nullif(p_details->>'transport_type',''),
           nullif(trim(p_details->>'dc_no'),''), nullif(p_details->>'delivery_date','')::date, nullif(trim(p_details->>'remarks'),''),
           od.person_id, m_id
      from orders od where od.id = (l->>'order_id')::uuid;
    n := n + 1;
  end loop;

  return m_no;
end $$;

grant execute on function merge_dispatch(jsonb, jsonb) to authenticated;

commit;
