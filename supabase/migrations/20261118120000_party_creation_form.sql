-- Buyers & Suppliers: the two fields of the monday "Buyer & Supplier Creation
-- Form" that the masters did not have.
--
--   record_at           monday's Date (with time): when the record was opened.
--   default_commission  monday's "Default Commision Percentage" status: how
--                       commission is worked out by default for the party
--                       (percentage of ex-mill value, bagwise rate, Rs per kg).
--
-- The buyer / supplier commission type and value of the form already live in
-- commission_basis and commission_value on each master.

alter table public.supplier_master
  add column if not exists record_at timestamptz not null default now(),
  add column if not exists default_commission text;

alter table public.buyer_master
  add column if not exists record_at timestamptz not null default now(),
  add column if not exists default_commission text;

alter table public.supplier_master
  drop constraint if exists supplier_master_default_commission_check,
  add constraint supplier_master_default_commission_check
    check (default_commission is null or default_commission in ('pct', 'per_bag', 'per_kg'));

alter table public.buyer_master
  drop constraint if exists buyer_master_default_commission_check,
  add constraint buyer_master_default_commission_check
    check (default_commission is null or default_commission in ('pct', 'per_bag', 'per_kg'));

-- Existing records were opened when they were created.
update public.supplier_master set record_at = created_at;
update public.buyer_master set record_at = created_at;
