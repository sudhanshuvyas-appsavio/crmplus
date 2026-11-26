-- Leads: four more of monday's Leads columns.
--   Supplier Rate (numbers), Dup. Phone and Dup. Phone 2 (phone numbers), and the link to Sample Delivery (a Sample Delivery task).
-- Safe to run twice.

alter table public.leads
  add column if not exists supplier_rate numeric,
  add column if not exists dup_phone text,
  add column if not exists dup_phone_2 text,
  add column if not exists sample_delivery_id uuid references public.tasks (id) on delete set null;

alter table public.leads drop constraint if exists leads_supplier_rate_check;
alter table public.leads add constraint leads_supplier_rate_check check (supplier_rate is null or supplier_rate >= 0);
create index if not exists leads_sample_delivery_idx on public.leads (sample_delivery_id) where sample_delivery_id is not null;
