-- OPTIONAL, for testing only.
-- ORD-2026-0010 (Business Unit "Test 2") is covered by the old one-per-order invoice CINV-2026-0005,
-- which was made before the Commission Invoices page existed. While that invoice is live the order is
-- "already invoiced", so the new page lists nothing to bill for it.
-- Cancelling the old invoice frees the order's dispatch lines so a period invoice can be made.
-- Look first, then cancel.

select invoice_no, status, is_legacy, order_id, amount, invoice_date
from public.commission_invoices
where invoice_no = 'CINV-2026-0005';

update public.commission_invoices
   set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Replaced by a period commission invoice (testing)'
 where invoice_no = 'CINV-2026-0005' and is_legacy and status <> 'cancelled';
