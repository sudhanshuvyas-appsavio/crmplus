-- Two fields from monday's creation-form layouts that CRM+ did not have:
--   Leads: "Notes" (a second long-text field beside Remarks).
--   Dispatch and Billing: "Sr. No" (free text).
-- Safe to run twice.

alter table public.leads add column if not exists notes text;
alter table public.orders add column if not exists sr_no text;
