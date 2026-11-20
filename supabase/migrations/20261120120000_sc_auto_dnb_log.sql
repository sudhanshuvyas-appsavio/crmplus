-- Send with Delivery Info creates the Dispatch and Billing item (monday automation). Until now, when the item
-- could not be made (no internal company set, a count row without a rate), the database stopped without a trace.
-- It now writes the run to the automation log: Done with the item number, or Skipped with the reason.

create or replace function public.sc_auto_dnb() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_item uuid;
  v_no text;
  v_reason text;
begin
  if new.stage = 'send_delivery' and old.stage is distinct from 'send_delivery' and new.status = 'confirmed'
     and not exists (select 1 from orders where sales_confirmation_id = new.id and status <> 'cancelled') then
    v_item := dnb_from_sc(new.id);
    if v_item is not null then
      select order_no into v_no from orders where id = v_item;
      perform log_automation('Sales Confirmation', 'Send with Delivery Info creates the Dispatch and Billing item', 'sales_confirmation',
                             new.id, new.sc_no, 'done', 'Created ' || coalesce(v_no, 'the item'));
    else
      v_reason := case
        when not exists (select 1 from sc_lines where sc_id = new.id) then 'The confirmation has no count rows'
        when exists (select 1 from sc_lines where sc_id = new.id and rate is null) then 'A count row has no final rate'
        when coalesce(new.company_id, (select id from companies where is_home and is_active limit 1)) is null
          then 'No internal company is set: mark one Business Unit as the home company'
        else 'The item could not be created'
      end;
      perform log_automation('Sales Confirmation', 'Send with Delivery Info creates the Dispatch and Billing item', 'sales_confirmation',
                             new.id, new.sc_no, 'skipped', v_reason);
    end if;
  end if;
  return null;
end;
$$;
