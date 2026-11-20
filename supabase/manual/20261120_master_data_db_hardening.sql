-- Master Data: everything that was left for the database after the QA retest.
-- One script, safe to run on production, safe to run more than once.
-- Run it in the Supabase SQL editor (one go). Take a backup first anyway.
--
-- What it does
--   1. Repairs the few buyer / supplier rows whose PAN disagrees with their GST number
--      (the PAN is characters 3 to 12 of a valid GSTIN: the same rule the lead-qualification
--      function and the new screens use).
--   2. Adds the database rules behind the new screens, so imports and direct edits cannot
--      break them either:
--        - PAN format on buyers, suppliers and transporters;
--        - PAN must match the GST number when both are given;
--        - a GST number may belong to one transporter only (unique index).
--      Each rule is added, then checked against the existing rows; a rule that existing data
--      still violates is left "not validated" (it still guards every new or changed row) and
--      is reported at the end. Nothing is deleted.
--   3. Hides the two leftover test business units (Lead 2, test lead) that the clean-up could
--      not deactivate because they had no email / address / bank account: it fills those three
--      with obvious TEST placeholders and marks them inactive. They stay in the database
--      because deals and confirmations still point to them.
--   4. Marks the QA buyer "QA GST PAN Mismatch" inactive.
--
-- The last query shows the result: read it.

-- ---------------------------------------------------------------------
-- 1. Repair PAN / GST disagreements (only where the GST number itself is a valid GSTIN)
-- ---------------------------------------------------------------------
update public.buyer_master
   set pan = substr(upper(btrim(gst)), 3, 10)
 where upper(btrim(coalesce(gst, ''))) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
   and coalesce(btrim(pan), '') <> ''
   and upper(btrim(pan)) <> substr(upper(btrim(gst)), 3, 10);

update public.supplier_master
   set pan = substr(upper(btrim(gst)), 3, 10)
 where upper(btrim(coalesce(gst, ''))) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
   and coalesce(btrim(pan), '') <> ''
   and upper(btrim(pan)) <> substr(upper(btrim(gst)), 3, 10);

-- tidy case / spaces so the rules below see the same value the screens store
update public.buyer_master    set pan = upper(btrim(pan)) where pan is not null and pan <> upper(btrim(pan));
update public.supplier_master set pan = upper(btrim(pan)) where pan is not null and pan <> upper(btrim(pan));
update public.transporters    set pan = upper(btrim(pan)) where pan is not null and pan <> upper(btrim(pan));
update public.transporters    set gst = upper(btrim(gst)) where gst is not null and gst <> upper(btrim(gst));

-- ---------------------------------------------------------------------
-- 2. Rules. A transporter GST duplicate (if one appears) stops only the index, and is reported.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  -- PAN format and PAN-matches-GST on the three registers
  foreach t in array array['buyer_master', 'supplier_master', 'transporters'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_pan_chk');
    execute format($f$alter table public.%I add constraint %I
      check (pan is null or btrim(pan) = '' or upper(btrim(pan)) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$') not valid$f$, t, t || '_pan_chk');

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_pan_gst_chk');
    execute format($f$alter table public.%I add constraint %I
      check (
        coalesce(btrim(pan), '') = '' or coalesce(btrim(gst), '') = ''
        or upper(btrim(gst)) !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
        or substr(upper(btrim(gst)), 3, 10) = upper(btrim(pan))
      ) not valid$f$, t, t || '_pan_gst_chk');

    -- check the existing rows; keep the rule "not validated" if some still break it
    begin
      execute format('alter table public.%I validate constraint %I', t, t || '_pan_chk');
    exception when others then
      raise notice '% not validated (existing rows break it): %', t || '_pan_chk', sqlerrm;
    end;
    begin
      execute format('alter table public.%I validate constraint %I', t, t || '_pan_gst_chk');
    exception when others then
      raise notice '% not validated (existing rows break it): %', t || '_pan_gst_chk', sqlerrm;
    end;
  end loop;

  -- one GST number per transporter
  begin
    create unique index if not exists transporters_gst_uq
      on public.transporters (upper(btrim(gst)))
      where gst is not null and btrim(gst) <> '';
  exception when others then
    raise notice 'transporters_gst_uq not created (duplicate GST numbers exist): %', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------
-- 3. Hide the leftover test business units (they must keep an email, address and bank account)
-- ---------------------------------------------------------------------
update public.companies
   set email          = coalesce(nullif(btrim(email), ''), 'test-record@example.com'),
       address        = coalesce(nullif(btrim(address), ''), 'TEST RECORD - not a real business unit'),
       bank_account_1 = coalesce(nullif(btrim(bank_account_1), ''), 'TEST RECORD - not a real account'),
       is_active      = false
 where is_home = false
   and is_active
   and name in ('Lead 2', 'test lead');

-- ---------------------------------------------------------------------
-- 4. The QA buyer left behind by the PAN test
-- ---------------------------------------------------------------------
update public.buyer_master set is_active = false
 where name = 'QA GST PAN Mismatch' and is_active;

-- ---------------------------------------------------------------------
-- RESULT: read this
-- ---------------------------------------------------------------------
select 'rule' as kind, c.conrelid::regclass::text as item, c.conname as name,
       case when c.convalidated then 'OK: checked on every row' else 'ACTIVE for new/changed rows; existing rows still break it' end as state
from pg_constraint c
where c.conname in ('buyer_master_pan_chk', 'buyer_master_pan_gst_chk', 'supplier_master_pan_chk',
                    'supplier_master_pan_gst_chk', 'transporters_pan_chk', 'transporters_pan_gst_chk')
union all
select 'index', 'transporters', 'transporters_gst_uq',
       case when exists (select 1 from pg_indexes where indexname = 'transporters_gst_uq')
            then 'OK' else 'NOT CREATED (duplicate GST numbers)' end
union all
select 'test business unit', 'companies', name, case when is_active then 'STILL ACTIVE' else 'hidden (inactive)' end
from public.companies where name in ('Lead 2', 'test lead') and is_home = false
union all
select 'rows still breaking a rule', 'buyers + suppliers', 'PAN format or PAN vs GST',
       (select count(*) from (
          select 1 from public.buyer_master
           where coalesce(btrim(pan), '') <> '' and (upper(btrim(pan)) !~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
              or (upper(btrim(coalesce(gst, ''))) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
                  and substr(upper(btrim(gst)), 3, 10) <> upper(btrim(pan))))
          union all
          select 1 from public.supplier_master
           where coalesce(btrim(pan), '') <> '' and (upper(btrim(pan)) !~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
              or (upper(btrim(coalesce(gst, ''))) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
                  and substr(upper(btrim(gst)), 3, 10) <> upper(btrim(pan))))) x)::text
order by 1, 2, 3;
