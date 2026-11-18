-- Master data: the "Documents" file column of the monday.com MDM boards that
-- CRM+ did not have yet (Transport Company, Location MDM, Sizing/Delivery
-- Address). Business Units (company_documents) and Buyers & Suppliers
-- (party_documents) already have theirs. Up to 10 files per record, kept in the
-- private `mdm-documents` bucket under <register>/<record id>/<uuid>-<name>.

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.transporter_documents (
  id uuid primary key default gen_random_uuid(),
  transporter_id uuid not null references public.transporters(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists transporter_documents_ix on public.transporter_documents (transporter_id);

create table if not exists public.location_documents (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.station_master(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists location_documents_ix on public.location_documents (station_id);

create table if not exists public.job_process_documents (
  id uuid primary key default gen_random_uuid(),
  job_process_id uuid not null references public.job_processes(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists job_process_documents_ix on public.job_process_documents (job_process_id);

-- ---------------------------------------------------------------------
-- 2. At most 10 files per record
-- ---------------------------------------------------------------------
create or replace function public.mdm_documents_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if tg_table_name = 'transporter_documents' then
    select count(*) into n from transporter_documents where transporter_id = new.transporter_id;
  elsif tg_table_name = 'location_documents' then
    select count(*) into n from location_documents where station_id = new.station_id;
  else
    select count(*) into n from job_process_documents where job_process_id = new.job_process_id;
  end if;
  if n >= 10 then
    raise exception 'A record can hold at most 10 documents; remove one first';
  end if;
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_at := now();
  return new;
end $$;

drop trigger if exists trg_transporter_documents_limit on public.transporter_documents;
create trigger trg_transporter_documents_limit before insert on public.transporter_documents
  for each row execute function public.mdm_documents_limit();
drop trigger if exists trg_location_documents_limit on public.location_documents;
create trigger trg_location_documents_limit before insert on public.location_documents
  for each row execute function public.mdm_documents_limit();
drop trigger if exists trg_job_process_documents_limit on public.job_process_documents;
create trigger trg_job_process_documents_limit before insert on public.job_process_documents
  for each row execute function public.mdm_documents_limit();

-- A trigger function is not meant to be called directly.
revoke execute on function public.mdm_documents_limit() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Row access: same permissions as the register itself
-- ---------------------------------------------------------------------
alter table public.transporter_documents enable row level security;
drop policy if exists transporter_documents_sel on public.transporter_documents;
create policy transporter_documents_sel on public.transporter_documents for select to authenticated
  using (has_permission('transport.read') or has_permission('transport.manage'));
drop policy if exists transporter_documents_ins on public.transporter_documents;
create policy transporter_documents_ins on public.transporter_documents for insert to authenticated
  with check (has_permission('transport.manage'));
drop policy if exists transporter_documents_del on public.transporter_documents;
create policy transporter_documents_del on public.transporter_documents for delete to authenticated
  using (has_permission('transport.manage'));

alter table public.location_documents enable row level security;
drop policy if exists location_documents_sel on public.location_documents;
create policy location_documents_sel on public.location_documents for select to authenticated
  using (has_permission('lead.manage') or has_permission('lead.qualify') or has_permission('deal.read') or has_permission('settings.manage'));
drop policy if exists location_documents_ins on public.location_documents;
create policy location_documents_ins on public.location_documents for insert to authenticated
  with check (has_permission('settings.manage'));
drop policy if exists location_documents_del on public.location_documents;
create policy location_documents_del on public.location_documents for delete to authenticated
  using (has_permission('settings.manage'));

alter table public.job_process_documents enable row level security;
drop policy if exists job_process_documents_sel on public.job_process_documents;
create policy job_process_documents_sel on public.job_process_documents for select to authenticated
  using (has_permission('jobprocess.read') or has_permission('jobprocess.manage'));
drop policy if exists job_process_documents_ins on public.job_process_documents;
create policy job_process_documents_ins on public.job_process_documents for insert to authenticated
  with check (has_permission('jobprocess.manage'));
drop policy if exists job_process_documents_del on public.job_process_documents;
create policy job_process_documents_del on public.job_process_documents for delete to authenticated
  using (has_permission('jobprocess.manage'));

grant select, insert, delete on public.transporter_documents, public.location_documents, public.job_process_documents to authenticated;
grant all on public.transporter_documents, public.location_documents, public.job_process_documents to service_role;

-- ---------------------------------------------------------------------
-- 4. Storage bucket (private, 20 MB per file) and its policies. The first
--    folder of the object path says which register the file belongs to.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('mdm-documents', 'mdm-documents', false, 20971520)
on conflict (id) do nothing;

drop policy if exists mdm_documents_storage_select on storage.objects;
create policy mdm_documents_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'mdm-documents' and (
      ((storage.foldername(name))[1] = 'transporter' and (public.has_permission('transport.read') or public.has_permission('transport.manage')))
      or ((storage.foldername(name))[1] = 'location' and (public.has_permission('lead.manage') or public.has_permission('lead.qualify') or public.has_permission('deal.read') or public.has_permission('settings.manage')))
      or ((storage.foldername(name))[1] = 'job-process' and (public.has_permission('jobprocess.read') or public.has_permission('jobprocess.manage')))
    )
  );

drop policy if exists mdm_documents_storage_insert on storage.objects;
create policy mdm_documents_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'mdm-documents' and (
      ((storage.foldername(name))[1] = 'transporter' and public.has_permission('transport.manage'))
      or ((storage.foldername(name))[1] = 'location' and public.has_permission('settings.manage'))
      or ((storage.foldername(name))[1] = 'job-process' and public.has_permission('jobprocess.manage'))
    )
  );

drop policy if exists mdm_documents_storage_delete on storage.objects;
create policy mdm_documents_storage_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'mdm-documents' and (
      ((storage.foldername(name))[1] = 'transporter' and public.has_permission('transport.manage'))
      or ((storage.foldername(name))[1] = 'location' and public.has_permission('settings.manage'))
      or ((storage.foldername(name))[1] = 'job-process' and public.has_permission('jobprocess.manage'))
    )
  );
