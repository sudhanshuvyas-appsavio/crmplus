-- Master data: the fields monday's creation forms have and CRM+ did not.
--
--   * Date on Location MDM, Transport Company and Sizing/Delivery Address
--     (monday's Date column; until now the grids showed the created date).
--   * Buyers & Suppliers: Quantity and Type (buyer), Current Machines (supplier).
--
-- Safe to run twice. Run this BEFORE the app version that sends these columns.

alter table public.station_master add column if not exists record_date date;
alter table public.transporters   add column if not exists record_date date;
alter table public.job_processes  add column if not exists record_date date;

update public.station_master set record_date = (created_at at time zone 'Asia/Kolkata')::date where record_date is null;
update public.transporters   set record_date = (created_at at time zone 'Asia/Kolkata')::date where record_date is null;
update public.job_processes  set record_date = (created_at at time zone 'Asia/Kolkata')::date where record_date is null;

alter table public.station_master alter column record_date set default ((now() at time zone 'Asia/Kolkata')::date);
alter table public.transporters   alter column record_date set default ((now() at time zone 'Asia/Kolkata')::date);
alter table public.job_processes  alter column record_date set default ((now() at time zone 'Asia/Kolkata')::date);

alter table public.buyer_master
  add column if not exists quantity  numeric check (quantity is null or quantity >= 0),
  add column if not exists type_text text;

alter table public.supplier_master
  add column if not exists current_machines text;
