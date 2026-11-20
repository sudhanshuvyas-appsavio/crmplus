-- PRODUCTION-SAFE clean-up of the Master Data QA / test records.
-- Replaces 20261120_master_data_qa_cleanup.sql (do not run both).
--
-- What it does, per test record (matched by name, see the pattern list below):
--   * if NOTHING points at it (no order, deal, confirmation, task, lead... and no other
--     master record), it is DELETED (its own uploaded-document rows go with it);
--   * if ANYTHING points at it, it is NOT deleted and NOT unlinked from anything: it is
--     marked inactive (is_active = false) so it stops appearing in lists and dropdowns,
--     and it is reported;
--   * a record that cannot be changed for any other reason is only reported.
-- It makes no schema changes, never edits another record, and a failure on one record
-- cannot stop the others. It is safe to run more than once.
--
-- Run it in the Supabase SQL editor. The result is a table at the bottom (the result grid),
-- one row per test record: DELETED, MADE INACTIVE (still used by ...), or LEFT (reason).
-- Take a backup first anyway.

create temp table if not exists qa_cleanup_result (
  register text, name text, id uuid, outcome text, detail text
) on commit drop;

do $$
declare
  r record;
  fk record;
  used_by text;
  n bigint;
  has_active boolean;
begin
  for r in
    -- parties first, business units last
    select 1 as ord, 'buyer_master' as t, id, name::text as name from public.buyer_master
      where name ~* '^(QA RT|Lead 2|test$|test lead|Test 2)'
    union all select 1, 'supplier_master', id, name from public.supplier_master
      where name ~* '^(QA RT|Lead 2|test$|test lead|Test 2)'
    union all select 2, 'transporters', id, name from public.transporters
      where name ~* '^(QA RT|test tp)'
    union all select 2, 'payment_terms', id, name from public.payment_terms
      where name ~* '^(HK$|QA RT)'
    union all select 2, 'count_master', id, coalesce(nullif(name, ''), display_name) from public.count_master
      where coalesce(nullif(name, ''), display_name) ~* '^QA RT'
    union all select 2, 'station_master', id, name from public.station_master
      where name ~* '^QA RT'
    union all select 2, 'job_processes', id, name from public.job_processes
      where name ~* '^QA RT'
    union all select 3, 'companies', id, name from public.companies
      where is_home = false and name ~* '^(QA |Lead 2|Test 2|test lead|Test 3)'
    order by 1, 2, 4
  loop
    used_by := '';

    -- everything that points at this record and would be unlinked or refused on delete
    -- (the record's own document rows, ON DELETE CASCADE, do not count)
    for fk in
      select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and c.confrelid = ('public.' || r.t)::regclass
        and c.confdeltype <> 'c'
        and array_length(c.conkey, 1) = 1
    loop
      execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col) into n using r.id;
      if n > 0 then
        used_by := used_by || case when used_by = '' then '' else ', ' end || fk.tbl || ' (' || n || ')';
      end if;
    end loop;

    if used_by = '' then
      begin
        execute format('delete from public.%I where id = $1', r.t) using r.id;
        insert into qa_cleanup_result values (r.t, r.name, r.id, 'DELETED', null);
      exception when others then
        insert into qa_cleanup_result values (r.t, r.name, r.id, 'LEFT', 'delete refused: ' || sqlerrm);
      end;
    else
      select exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = r.t and column_name = 'is_active')
        into has_active;
      if has_active then
        begin
          execute format('update public.%I set is_active = false where id = $1 and is_active', r.t) using r.id;
          insert into qa_cleanup_result values (r.t, r.name, r.id, 'MADE INACTIVE', 'still used by ' || used_by);
        exception when others then
          insert into qa_cleanup_result values (r.t, r.name, r.id, 'LEFT', 'still used by ' || used_by || '; could not deactivate: ' || sqlerrm);
        end;
      else
        insert into qa_cleanup_result values (r.t, r.name, r.id, 'LEFT', 'still used by ' || used_by || ' (this register has no Active flag)');
      end if;
    end if;
  end loop;
end $$;

-- the result: read this
select outcome, register, name, detail, id
from qa_cleanup_result
order by case outcome when 'LEFT' then 0 when 'MADE INACTIVE' then 1 else 2 end, register, name;

-- Uploaded test files stay in Storage (company-documents and the other MDM document
-- buckets): delete those by hand in Storage if you want them gone.
