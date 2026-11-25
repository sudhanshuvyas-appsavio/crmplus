-- Clean up the QA / test Business Units before the integrity migration
-- (supabase/migrations/20261118170000_master_data_integrity.sql).
--
-- Run STEP 1 on its own and read the result. Only then run STEP 2.
-- Nothing here runs automatically.

-- =====================================================================
-- STEP 1 (read only): what looks like test data, and what is duplicated
-- =====================================================================
select id, name, short_name, ref_prefix, tax_id, pan_number, is_active, is_home, created_at
from public.companies
where name ilike 'QA BU%'
   or name ilike 'Lead 2%' or name ilike 'test lead%' or name ilike 'Test 2%' or name ilike 'Test 3%'
order by created_at;

-- Duplicate names (case / spacing ignored)
select lower(btrim(name)) as name_key, count(*) as copies, array_agg(name order by created_at) as names
from public.companies group by 1 having count(*) > 1;

-- Duplicate GST numbers and PANs
select upper(btrim(tax_id)) as gst, count(*) as copies, array_agg(name order by created_at) as names
from public.companies where nullif(btrim(tax_id), '') is not null group by 1 having count(*) > 1;

select upper(btrim(pan_number)) as pan, count(*) as copies, array_agg(name order by created_at) as names
from public.companies where nullif(btrim(pan_number), '') is not null group by 1 having count(*) > 1;

-- Where the test companies are still used (they will lose the link, not the record)
select 'buyer_master' as t, count(*) from public.buyer_master where company_id in (select id from public.companies where name ilike 'QA BU%' or name ilike 'Lead 2%' or name ilike 'test lead%' or name ilike 'Test 2%' or name ilike 'Test 3%')
union all select 'supplier_master', count(*) from public.supplier_master where company_id in (select id from public.companies where name ilike 'QA BU%' or name ilike 'Lead 2%' or name ilike 'test lead%' or name ilike 'Test 2%' or name ilike 'Test 3%')
union all select 'transporters', count(*) from public.transporters where company_id in (select id from public.companies where name ilike 'QA BU%' or name ilike 'Lead 2%' or name ilike 'test lead%' or name ilike 'Test 2%' or name ilike 'Test 3%')
union all select 'job_processes', count(*) from public.job_processes where company_id in (select id from public.companies where name ilike 'QA BU%' or name ilike 'Lead 2%' or name ilike 'test lead%' or name ilike 'Test 2%' or name ilike 'Test 3%')
union all select 'crm_deals', count(*) from public.crm_deals where company_id in (select id from public.companies where name ilike 'QA BU%' or name ilike 'Lead 2%' or name ilike 'test lead%' or name ilike 'Test 2%' or name ilike 'Test 3%');

-- Which of them are tied to deals or confirmations (these cannot be deleted: an Approved deal is
-- locked, so clearing its company link is refused). Keep these; see STEP 3.
select c.name as company, 'deal' as used_by, d.id::text as record,
       to_jsonb(d) ->> 'ref_no' as ref_no, to_jsonb(d) ->> 'status' as status
from public.crm_deals d join public.companies c on c.id = d.company_id
where c.name ilike 'QA BU%' or c.name ilike 'Lead 2%' or c.name ilike 'test lead%' or c.name ilike 'Test 2%' or c.name ilike 'Test 3%'
union all
select c.name, 'confirmation', s.id::text, to_jsonb(s) ->> 'ref_no', to_jsonb(s) ->> 'status'
from public.sales_confirmations s
join public.companies c on c.id in (s.company_id, s.buyer_company_id, s.supplier_company_id)
where c.name ilike 'QA BU%' or c.name ilike 'Lead 2%' or c.name ilike 'test lead%' or c.name ilike 'Test 2%' or c.name ilike 'Test 3%';

-- The uploaded test files that belong to them (delete these in Storage > company-documents)
select d.storage_path, d.file_name, c.name
from public.company_documents d join public.companies c on c.id = d.company_id
where c.name ilike 'QA BU%' or c.name ilike 'Lead 2%' or c.name ilike 'test lead%' or c.name ilike 'Test 2%' or c.name ilike 'Test 3%';

-- =====================================================================
-- STEP 2 (deletes): run only after STEP 1 shows exactly the rows you want gone.
-- It runs in a transaction and ends with ROLLBACK, so the first run is a dry run.
-- Change ROLLBACK to COMMIT to keep the deletion.
-- Foreign keys from buyers, suppliers, transporters, delivery addresses, deals and
-- confirmations are ON DELETE SET NULL; company_documents rows are removed with the company.
-- =====================================================================
begin;

-- Companies that a deal or a confirmation points to are left alone (see the query above).
delete from public.companies c
where c.is_home = false
  and (c.name ilike 'QA BU%'
       or c.name ilike 'Lead 2%' or c.name ilike 'test lead%' or c.name ilike 'Test 2%' or c.name ilike 'Test 3%')
  and not exists (select 1 from public.crm_deals d where d.company_id = c.id)
  and not exists (select 1 from public.sales_confirmations s
                  where c.id in (s.company_id, s.buyer_company_id, s.supplier_company_id));

-- Anything still duplicated after that is real data and needs a person's decision:
select lower(btrim(name)) as name_key, count(*) from public.companies group by 1 having count(*) > 1;
select upper(btrim(tax_id)) as gst, count(*) from public.companies where nullif(btrim(tax_id), '') is not null group by 1 having count(*) > 1;
select upper(btrim(pan_number)) as pan, count(*) from public.companies where nullif(btrim(pan_number), '') is not null group by 1 having count(*) > 1;

rollback;   -- <- change to COMMIT once the result looks right

-- =====================================================================
-- STEP 3 (only if STEP 2 still shows duplicates because a kept company is a real one):
-- do NOT delete it. Make it distinguishable instead, for example:
--   update public.companies set name = name || ' (old)' where id = '<id>';
-- or clear a duplicate GST / PAN on the test copy. Send the rows to me and I will write the exact statement.
-- =====================================================================
