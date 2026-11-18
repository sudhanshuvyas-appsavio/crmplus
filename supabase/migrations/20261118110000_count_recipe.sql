-- Counts: the yarn recipe, as on the monday.com Counts board.
--
-- A count is Yarn 1 + its percentage and, when Yarn 1 is below 100%, Yarn 2 for
-- the remaining percentage. The name is built from the recipe the way monday's
-- "Summary (Fx)" formula builds it, and a count whose recipe already exists is
-- saved flagged as a duplicate (monday ticks "Is Duplicate" and writes
-- "Duplicate of item ID: ..."; it does not refuse the record).
--
-- composition, ratio and blended stay as columns, now derived from the recipe
-- by the trigger, so the screens that read them (Leads, Deals, Orders) keep
-- working unchanged.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.count_master
  add column if not exists yarn_1         text,
  add column if not exists yarn_1_pct     numeric(5,2),
  add column if not exists yarn_2         text,
  add column if not exists yarn_2_pct     numeric(5,2),
  add column if not exists recipe_key     text not null default '',
  add column if not exists is_duplicate   boolean not null default false,
  add column if not exists duplicate_error text,
  add column if not exists name           text,
  add column if not exists item_no        bigint;

-- monday's "Item ID (auto generated)": a number each count keeps for good.
create sequence if not exists public.count_master_item_no_seq;
alter table public.count_master alter column item_no set default nextval('public.count_master_item_no_seq');
update public.count_master set item_no = nextval('public.count_master_item_no_seq') where item_no is null;
alter table public.count_master alter column item_no set not null;
create unique index if not exists count_master_item_no_uq on public.count_master (item_no);

-- monday allows duplicates (it flags them), so the name is no longer unique.
drop index if exists public.count_master_display_uq;
alter table public.count_master drop constraint if exists count_master_ratio_check;

-- ---------------------------------------------------------------------------
-- 2. Move existing counts onto the recipe
-- ---------------------------------------------------------------------------

-- A blend takes its yarns from the pair and its percentages from the ratio when
-- the ratio is two numbers that total 100 (otherwise 50 / 50). Anything else is
-- a single yarn at 100%; this also normalises a row such as "COTTON 50/50".
update public.count_master set
  yarn_1 = case when composition = 'BLENDED' then split_part(blended, '/', 1) else composition end,
  yarn_2 = case when composition = 'BLENDED' then split_part(blended, '/', 2) end,
  yarn_1_pct = case
    when composition <> 'BLENDED' then 100
    when ratio ~ '^[0-9.]+/[0-9.]+$' and split_part(ratio, '/', 1)::numeric + split_part(ratio, '/', 2)::numeric = 100
      then split_part(ratio, '/', 1)::numeric
    else 50 end,
  yarn_2_pct = case
    when composition <> 'BLENDED' then null
    when ratio ~ '^[0-9.]+/[0-9.]+$' and split_part(ratio, '/', 1)::numeric + split_part(ratio, '/', 2)::numeric = 100
      then split_part(ratio, '/', 2)::numeric
    else 50 end
where yarn_1 is null;

alter table public.count_master
  alter column yarn_1 set not null,
  alter column yarn_1_pct set not null;

-- ---------------------------------------------------------------------------
-- 3. Rules
-- ---------------------------------------------------------------------------

alter table public.count_master
  add constraint count_master_yarn_1_check
    check (yarn_1 in ('COTTON', 'POLYESTER', 'VISCOSE', 'LINEN', 'HEMP', 'LYCRA')),
  add constraint count_master_yarn_2_check
    check (yarn_2 is null or yarn_2 in ('COTTON', 'POLYESTER', 'VISCOSE', 'LINEN', 'HEMP', 'LYCRA')),
  add constraint count_master_yarn_pair_check
    check (yarn_2 is null or yarn_2 <> yarn_1),
  add constraint count_master_yarn_2_rule
    check ((yarn_2 is null) = (yarn_2_pct is null)),
  add constraint count_master_pct_range
    check (yarn_1_pct > 0 and yarn_1_pct <= 100 and (yarn_2_pct is null or (yarn_2_pct > 0 and yarn_2_pct < 100))),
  add constraint count_master_pct_total
    check (yarn_1_pct + coalesce(yarn_2_pct, 0) = 100);

-- ---------------------------------------------------------------------------
-- 4. Name, derived columns and the duplicate flag
-- ---------------------------------------------------------------------------

-- A word as monday's Summary shows it: Cotton, Karded Compact; the acronyms stay upper case.
create or replace function public.count_label(v text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case
    when v is null or v = '' then null
    when upper(v) in ('OE', 'BCI', 'GOTS', 'NPOP', 'NOP', 'GRS', 'OEKO TEX') then upper(v)
    else initcap(lower(v))
  end
$$;

create or replace function public.count_master_set_display()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  p1 text := trim_scale(new.yarn_1_pct)::text;
  p2 text := case when new.yarn_2_pct is null then null else trim_scale(new.yarn_2_pct)::text end;
  dup record;
begin
  -- Derived for the screens that still read them.
  new.composition := case when new.yarn_2 is null then new.yarn_1 else 'BLENDED' end;
  new.ratio       := case when new.yarn_2 is null then p1 || '%' else p1 || '/' || p2 end;
  new.blended     := case when new.yarn_2 is null then null else new.yarn_1 || '/' || new.yarn_2 end;

  -- monday's Summary (Fx): 20S Vortex 20% Cotton 80% Polyester Blended Double Karded OEKO TEX Cheese
  new.display_name := concat_ws(' ',
    new.count_no::text || 'S',
    count_label(new.machine),
    case when new.yarn_1_pct > 0 then p1 || '% ' || count_label(new.yarn_1) end,
    case when new.yarn_2_pct > 0 and new.yarn_2 is not null then p2 || '% ' || count_label(new.yarn_2) end,
    case when new.yarn_1_pct > 0 and new.yarn_1_pct < 100 then 'Blended' end,
    count_label(new.ply), count_label(new.process), count_label(new.certification), count_label(new.yarn_type));

  -- The item name is free text; it follows the summary until someone types their own.
  if new.name is null or btrim(new.name) = '' then new.name := new.display_name; end if;

  -- The same recipe in any yarn order has the same key.
  new.recipe_key := upper(concat_ws('|',
    new.machine,
    new.count_no::text,
    (select string_agg(x, ',' order by x)
       from unnest(array[new.yarn_1 || ':' || p1, case when new.yarn_2 is not null then new.yarn_2 || ':' || p2 end]) as x
      where x is not null),
    coalesce(new.ply, ''), coalesce(new.process, ''), coalesce(new.certification, ''), new.yarn_type));

  select c.item_no, c.name into dup
    from public.count_master c
   where c.recipe_key = new.recipe_key and c.id is distinct from new.id
   order by c.created_at limit 1;
  new.is_duplicate := dup.item_no is not null;
  new.duplicate_error := case when dup.item_no is not null then 'Duplicate of item ID: ' || dup.item_no || ' — "' || dup.name || '"' end;
  return new;
end $$;

revoke execute on function public.count_label(text) from public, anon;

revoke execute on function public.count_master_set_display() from public, anon, authenticated;

drop trigger if exists trg_count_master_display on public.count_master;
create trigger trg_count_master_display
  before insert or update on public.count_master
  for each row execute function public.count_master_set_display();

create index if not exists count_master_recipe_ix on public.count_master (recipe_key);

-- Recompute the name, derived columns and duplicate flags of what already exists.
update public.count_master set count_no = count_no;
