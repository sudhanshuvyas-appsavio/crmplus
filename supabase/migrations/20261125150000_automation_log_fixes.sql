-- Automation log fixes found in the end-to-end test (2026-11-25).
--
-- 1. Duplicate Invoice No. check: the item was flagged, but the run never reached the Automation log on an edit.
--    The log trigger was "after update OF is_duplicate", and Postgres fires a column trigger only when the UPDATE
--    statement itself names that column. The app updates invoice_no; is_duplicate is set by the BEFORE trigger,
--    so the log trigger never fired. It now fires on every insert/update; the function already logs only when
--    the item has just become a duplicate.
-- 2. Send with Delivery Info: each run was logged twice, under two names. sc_auto_dnb (20261120120000) logs the
--    run with its result and reason; the older trg_sc_zz_log repeated it. The older one is dropped.
-- Safe to run twice.

drop trigger if exists trg_orders_zz_log_duplicate on public.orders;
create trigger trg_orders_zz_log_duplicate
  after insert or update on public.orders
  for each row execute function public.crm_log_orders_duplicate();

drop trigger if exists trg_sc_zz_log on public.sales_confirmations;
