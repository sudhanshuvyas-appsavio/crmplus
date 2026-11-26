-- Dispatch and Billing: Fully Dispatch is the end of an item.
--
-- An item used to close by itself (status 'closed', then read-only) once four things were done: quantity dispatched, buyer payment
-- completed, supplier payment completed and a commission invoice generated. monday has no such step: an item is finished when it is
-- Fully Dispatch (dispatched + cancelled quantity equals the quantity, or a Return is recorded), and payments are followed on the
-- Payment Collection tasks. So an item no longer closes by itself: it stays open to its invoice and billing details after it is
-- Fully Dispatch. Items that are already closed stay closed. Safe to run twice.

create or replace function public.order_try_close(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- intentionally does nothing: see the note above
  return;
end $$;
