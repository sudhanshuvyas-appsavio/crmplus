
-- T-001 follow-up: the business operates as one brand split into several legal
-- companies for accounting/invoicing, and the same Companies master is being
-- widened to also carry buyer/supplier role flags so a party that is both
-- (or an internal legal entity) is never duplicated across separate tables.

alter table public.companies
  add column if not exists pan_number text,
  add column if not exists mobile text,
  add column if not exists brand_name text,
  add column if not exists is_buyer boolean not null default false,
  add column if not exists is_supplier boolean not null default false;

comment on column public.companies.pan_number is 'Indian PAN (permanent account number), e.g. AHFP5121IG. Stored upper-cased; 10 chars when present.';
comment on column public.companies.mobile is 'Primary contact mobile number, distinct from the office phone_numbers list.';
comment on column public.companies.brand_name is 'The parent/market-facing brand name this legal company trades under. Several legal companies (different ref_prefix/short_name, same brand_name) can share one brand -- groups them without a separate parent table.';
comment on column public.companies.is_buyer is 'This party is (also) a buyer. A record can be is_buyer and is_supplier at once so the same party is never duplicated.';
comment on column public.companies.is_supplier is 'This party is (also) a supplier. See is_buyer.';

-- Loose format guard: upper-cased, 10 characters when present. Not a strict
-- regex, since the PAN example on file does not follow the textbook
-- AAAAA9999A shape -- this still catches stray lowercase/blank-padded input.
alter table public.companies
  add constraint companies_pan_number_format
  check (pan_number is null or (pan_number = upper(pan_number) and length(pan_number) = 10));
