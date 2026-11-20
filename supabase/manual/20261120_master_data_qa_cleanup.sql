-- Clean up the QA / test records left by the Master Data retest
-- (docs/master-data-retest-defects-and-plan.md, section 5).
--
-- Run STEP 1 on its own and read the result. Only then run STEP 2.
-- Nothing here runs automatically. Take a backup first.
--
-- STEP 2 runs in one transaction that ends with ROLLBACK, so the first run is a dry run.
-- A record that something still points to (a deal, an order, a confirmation, a task...) is NOT
-- deleted: it is reported with a NOTICE and kept, and the rest carries on.

-- =====================================================================
-- STEP 1 (read only): the rows that look like test data
-- =====================================================================
select 'companies' as register, id::text, name from public.companies
where name ~* '^(QA |Lead 2|Test 2|test lead|Test 3)'
union all
select 'buyer_master', id::text, name from public.buyer_master
where name ~* '^(QA RT|Lead 2|test$|test lead|Test 2)'
union all
select 'supplier_master', id::text, name from public.supplier_master
where name ~* '^(QA RT|Lead 2|test$|test lead|Test 2)'
union all
select 'transporters', id::text, name from public.transporters
where name ~* '^(QA RT|test tp)'
union all
select 'payment_terms', id::text, name from public.payment_terms
where name ~* '^(HK$|QA RT)'
union all
select 'count_master', id::text, coalesce(name, display_name) from public.count_master
where coalesce(name, display_name) ~* '^QA RT'
union all
select 'station_master', id::text, name from public.station_master
where name ~* '^QA RT'
union all
select 'job_processes', id::text, name from public.job_processes
where name ~* '^QA RT'
order by 1, 3;

-- Duplicate transporter GST numbers (the new screen check refuses a second one)
select upper(btrim(gst)) as gst, count(*) as copies, array_agg(name order by created_at) as names
from public.transporters where nullif(btrim(gst), '') is not null
group by 1 having count(*) > 1;

-- =====================================================================
-- STEP 2 (deletes): dry run first. Change ROLLBACK to COMMIT to keep the deletion.
-- =====================================================================
begin;

do $$
declare
  r record;
  gone int := 0;
  kept int := 0;
begin
  -- order matters: parties before business units, so company links are free to go
  for r in
    select 'buyer_master' as t, id, name from public.buyer_master
      where name ~* '^(QA RT|Lead 2|test$|test lead|Test 2)'
    union all select 'supplier_master', id, name from public.supplier_master
      where name ~* '^(QA RT|Lead 2|test$|test lead|Test 2)'
    union all select 'transporters', id, name from public.transporters
      where name ~* '^(QA RT|test tp)'
    union all select 'payment_terms', id, name from public.payment_terms
      where name ~* '^(HK$|QA RT)'
    union all select 'count_master', id, coalesce(name, display_name) from public.count_master
      where coalesce(name, display_name) ~* '^QA RT'
    union all select 'station_master', id, name from public.station_master
      where name ~* '^QA RT'
    union all select 'job_processes', id, name from public.job_processes
      where name ~* '^QA RT'
    union all select 'companies', id, name from public.companies
      where is_home = false and name ~* '^(QA |Lead 2|Test 2|test lead|Test 3)'
  loop
    begin
      execute format('delete from public.%I where id = $1', r.t) using r.id;
      gone := gone + 1;
    exception when foreign_key_violation or restrict_violation or raise_exception then
      -- raise_exception covers the guards on orders / deals / confirmations that refuse
      -- clearing a link (for example "The order must be Open for Execution first")
      kept := kept + 1;
      raise notice 'kept (still used): % "%" % -> %', r.t, r.name, r.id, sqlerrm;
    end;
  end loop;
  raise notice 'deleted %, kept %', gone, kept;
end $$;

-- What is left that could still collide with the new rules:
select upper(btrim(gst)) as transporter_gst, count(*) from public.transporters
where nullif(btrim(gst), '') is not null group by 1 having count(*) > 1;

rollback;   -- <- change to COMMIT once the notices look right

-- =====================================================================
-- Uploaded test files (company / transporter / location / sizing documents) are removed
-- with their record, but the files stay in Storage: delete them from the Storage buckets
-- (company-documents and the other MDM document buckets) by hand.
-- =====================================================================
