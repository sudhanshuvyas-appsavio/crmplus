-- MDM parity with the monday.com MDM boards (Business Units, Buyers & Suppliers,
-- Counts, Transport Company, Location MDM, Sizing/Delivery Address, Payment
-- Terms). Business Units already has every column in `companies`; this
-- migration adds what the other masters were missing.
--
-- Nothing here imports monday data: the app is a standalone build and starts
-- from its own records. The seed rows at the end are configuration only.

-- ---------------------------------------------------------------------------
-- 1. Buyer and supplier masters: the profile the monday party board carries
-- ---------------------------------------------------------------------------

alter table public.buyer_master
  add column if not exists short_name         text,
  add column if not exists customer_code      text,
  add column if not exists website            text,
  add column if not exists map_url            text,
  add column if not exists office_phone       text,
  add column if not exists res_phone          text,
  add column if not exists mill_address       text,
  add column if not exists remarks_2          text,
  add column if not exists contact_1_email    text,
  add column if not exists contact_2_name     text,
  add column if not exists contact_2_mobile   text,
  add column if not exists contact_2_email    text,
  add column if not exists contact_3_name     text,
  add column if not exists contact_3_mobile   text,
  add column if not exists contact_3_email    text,
  add column if not exists bank_account_1     text,
  add column if not exists bank_account_2     text,
  add column if not exists sales_person_id    uuid references public.profiles (id) on delete set null,
  add column if not exists collection_staff_id uuid references public.profiles (id) on delete set null,
  add column if not exists messenger_id       uuid references public.profiles (id) on delete set null,
  -- buyer-only block
  add column if not exists machine_types      text[],
  add column if not exists no_of_looms        integer,
  add column if not exists fabric_producing   text,
  add column if not exists reed_pick          text,
  add column if not exists width              text,
  add column if not exists qty_bags_month     numeric(14,2),
  add column if not exists qty_kgs_month      numeric(14,2);

alter table public.supplier_master
  add column if not exists short_name         text,
  add column if not exists customer_code      text,
  add column if not exists website            text,
  add column if not exists map_url            text,
  add column if not exists office_phone       text,
  add column if not exists res_phone          text,
  add column if not exists mill_address       text,
  add column if not exists remarks_2          text,
  add column if not exists contact_1_email    text,
  add column if not exists contact_2_name     text,
  add column if not exists contact_2_mobile   text,
  add column if not exists contact_2_email    text,
  add column if not exists contact_3_name     text,
  add column if not exists contact_3_mobile   text,
  add column if not exists contact_3_email    text,
  add column if not exists sales_person_id    uuid references public.profiles (id) on delete set null,
  add column if not exists collection_staff_id uuid references public.profiles (id) on delete set null,
  add column if not exists messenger_id       uuid references public.profiles (id) on delete set null,
  -- supplier-only block
  add column if not exists machine_type       text,
  add column if not exists counts_supplying   integer,
  add column if not exists spindles           integer,
  add column if not exists monthly_production numeric(14,2),
  add column if not exists qty_bags_month     numeric(14,2),
  add column if not exists qty_kgs_month      numeric(14,2);

-- Shared formats. Phones are optional here (the required mobile stays on the
-- existing columns); when given they are plain digits.
alter table public.buyer_master
  add constraint buyer_master_office_phone_check check (office_phone is null or office_phone ~ '^[0-9]{6,15}$'),
  add constraint buyer_master_res_phone_check check (res_phone is null or res_phone ~ '^[0-9]{6,15}$'),
  add constraint buyer_master_contact_2_mobile_check check (contact_2_mobile is null or contact_2_mobile ~ '^[0-9]{10}$'),
  add constraint buyer_master_contact_3_mobile_check check (contact_3_mobile is null or contact_3_mobile ~ '^[0-9]{10}$'),
  add constraint buyer_master_contact_1_email_check check (contact_1_email is null or position('@' in contact_1_email) > 1),
  add constraint buyer_master_contact_2_email_check check (contact_2_email is null or position('@' in contact_2_email) > 1),
  add constraint buyer_master_contact_3_email_check check (contact_3_email is null or position('@' in contact_3_email) > 1),
  add constraint buyer_master_looms_check check (no_of_looms is null or no_of_looms >= 0);

alter table public.supplier_master
  add constraint supplier_master_office_phone_check check (office_phone is null or office_phone ~ '^[0-9]{6,15}$'),
  add constraint supplier_master_res_phone_check check (res_phone is null or res_phone ~ '^[0-9]{6,15}$'),
  add constraint supplier_master_contact_2_mobile_check check (contact_2_mobile is null or contact_2_mobile ~ '^[0-9]{10}$'),
  add constraint supplier_master_contact_3_mobile_check check (contact_3_mobile is null or contact_3_mobile ~ '^[0-9]{10}$'),
  add constraint supplier_master_contact_1_email_check check (contact_1_email is null or position('@' in contact_1_email) > 1),
  add constraint supplier_master_contact_2_email_check check (contact_2_email is null or position('@' in contact_2_email) > 1),
  add constraint supplier_master_contact_3_email_check check (contact_3_email is null or position('@' in contact_3_email) > 1),
  add constraint supplier_master_spindles_check check (spindles is null or spindles >= 0);

-- A customer code, when used, is unique within its own master.
create unique index if not exists buyer_master_customer_code_uq
  on public.buyer_master (upper(btrim(customer_code))) where customer_code is not null and btrim(customer_code) <> '';
create unique index if not exists supplier_master_customer_code_uq
  on public.supplier_master (upper(btrim(customer_code))) where customer_code is not null and btrim(customer_code) <> '';

-- ---------------------------------------------------------------------------
-- 2. Locations (monday "Location MDM"): a delivery site, not only a name
-- ---------------------------------------------------------------------------

alter table public.station_master
  add column if not exists state          text,
  add column if not exists address        text,
  add column if not exists gst            text,
  add column if not exists phone          text,
  add column if not exists email          text,
  add column if not exists md_contact     text,
  add column if not exists accounts_phone text,
  add column if not exists zone           text,
  add column if not exists updated_at     timestamptz not null default now();

alter table public.station_master
  add constraint station_master_zone_check check (zone is null or zone in ('WEST', 'SOUTH', 'NORTH')),
  add constraint station_master_gst_check check (gst is null or (gst = upper(gst) and gst ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')),
  add constraint station_master_phone_check check (phone is null or phone ~ '^[0-9]{6,15}$'),
  add constraint station_master_accounts_phone_check check (accounts_phone is null or accounts_phone ~ '^[0-9]{6,15}$'),
  add constraint station_master_email_check check (email is null or position('@' in email) > 1);

drop trigger if exists trg_station_master_updated_at on public.station_master;
create trigger trg_station_master_updated_at
  before update on public.station_master
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Transport Company (monday): vehicle type, three vehicle numbers, email,
--    a second bank account
-- ---------------------------------------------------------------------------

alter table public.transporters
  add column if not exists email         text,
  add column if not exists vehicle_type  text,
  add column if not exists vehicle_no_1  text,
  add column if not exists vehicle_no_2  text,
  add column if not exists vehicle_no_3  text,
  add column if not exists bank_account_2 text;

alter table public.transporters
  add constraint transporters_vehicle_type_check check (vehicle_type is null or vehicle_type in ('TRUCK', 'LORRY', 'TEMPO')),
  add constraint transporters_email_check check (email is null or position('@' in email) > 1);

-- ---------------------------------------------------------------------------
-- 4. Sizing / Delivery Address (monday): contact e-mails
-- ---------------------------------------------------------------------------

alter table public.job_processes
  add column if not exists email_1 text,
  add column if not exists email_2 text;

alter table public.job_processes
  add constraint job_processes_email_1_check check (email_1 is null or position('@' in email_1) > 1),
  add constraint job_processes_email_2_check check (email_2 is null or position('@' in email_2) > 1);

-- ---------------------------------------------------------------------------
-- 5. Counts (monday): LYCRA and GRS, and any pair of yarns as a blend
-- ---------------------------------------------------------------------------

alter table public.count_master drop constraint if exists count_master_composition_check;
alter table public.count_master add constraint count_master_composition_check
  check (composition in ('COTTON', 'POLYESTER', 'VISCOSE', 'LINEN', 'HEMP', 'LYCRA', 'BLENDED'));

alter table public.count_master drop constraint if exists count_master_certification_check;
alter table public.count_master add constraint count_master_certification_check
  check (certification is null or certification in ('BCI', 'OEKO TEX', 'GOTS', 'NPOP', 'NOP', 'GRS'));

alter table public.count_master drop constraint if exists count_master_blended_check;
alter table public.count_master add constraint count_master_blended_check
  check (
    blended is null or (
      blended ~ '^(COTTON|POLYESTER|VISCOSE|LINEN|HEMP|LYCRA)/(COTTON|POLYESTER|VISCOSE|LINEN|HEMP|LYCRA)$'
      and split_part(blended, '/', 1) <> split_part(blended, '/', 2)
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Links between masters (monday relation columns)
-- ---------------------------------------------------------------------------

-- A location can serve many parties, transporters and delivery addresses, and
-- each of those can use many locations.
create table if not exists public.location_links (
  id          uuid primary key default gen_random_uuid(),
  owner_type  text not null check (owner_type in ('buyer', 'supplier', 'transporter', 'job_process')),
  owner_id    uuid not null,
  location_id uuid not null references public.station_master (id) on delete cascade,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (owner_type, owner_id, location_id)
);
create index if not exists location_links_owner_ix on public.location_links (owner_type, owner_id);
create index if not exists location_links_location_ix on public.location_links (location_id);

-- The counts a buyer buys or a supplier supplies.
create table if not exists public.party_counts (
  id         uuid primary key default gen_random_uuid(),
  party_type text not null check (party_type in ('buyer', 'supplier')),
  party_id   uuid not null,
  count_id   uuid not null references public.count_master (id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (party_type, party_id, count_id)
);
create index if not exists party_counts_party_ix on public.party_counts (party_type, party_id);
create index if not exists party_counts_count_ix on public.party_counts (count_id);

-- Who may change a link depends on what it hangs off, the same permission that
-- guards the record itself.
create or replace function public.link_owner_can(p_type text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select case p_type
    when 'buyer'       then has_permission('buyer.manage')
    when 'supplier'    then has_permission('mill.manage')
    when 'transporter' then has_permission('transport.manage')
    when 'job_process' then has_permission('jobprocess.manage')
    else false
  end
$$;

revoke execute on function public.link_owner_can(text) from public, anon;
grant execute on function public.link_owner_can(text) to authenticated;

alter table public.location_links enable row level security;
alter table public.party_counts enable row level security;

create policy location_links_read on public.location_links
  for select to authenticated
  using (public.has_any_permission(array[
    'buyer.manage', 'mill.manage', 'transport.read', 'transport.manage',
    'jobprocess.read', 'jobprocess.manage', 'lead.manage', 'lead.qualify',
    'deal.read', 'settings.manage']));

create policy location_links_write on public.location_links
  for all to authenticated
  using (public.link_owner_can(owner_type))
  with check (public.link_owner_can(owner_type));

create policy party_counts_read on public.party_counts
  for select to authenticated
  using (public.has_any_permission(array['buyer.manage', 'mill.manage', 'lead.manage', 'lead.qualify', 'deal.read', 'article.manage']));

create policy party_counts_write on public.party_counts
  for all to authenticated
  using (public.link_owner_can(party_type))
  with check (public.link_owner_can(party_type));

-- ---------------------------------------------------------------------------
-- 7. Seed configuration: payment terms (the monday list). Skipped when a term
--    of the same name already exists.
-- ---------------------------------------------------------------------------

insert into public.payment_terms (name, days, advance_pct, description) values
  ('10 DAYS PDC',  10,   0, 'Post-dated cheque, 10 days'),
  ('20 DAYS PDC',  20,   0, 'Post-dated cheque, 20 days'),
  ('30 DAYS PDC',  30,   0, 'Post-dated cheque, 30 days'),
  ('45 DAYS PDC',  45,   0, 'Post-dated cheque, 45 days'),
  ('60 DAYS PDC',  60,   0, 'Post-dated cheque, 60 days'),
  ('ADVANCE RTGS',  0, 100, 'Full advance by RTGS')
on conflict do nothing;
