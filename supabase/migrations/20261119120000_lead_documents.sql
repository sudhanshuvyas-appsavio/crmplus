-- Leads: Documents (2026-11-19).
--  lead_documents: up to 10 files per lead (monday's Documents column on Leads), private bucket.
--  No edit or delete rules are added here: monday has none (see the notes in the Leads work).

begin;

-- ---------------------------------------------------------------- documents
create table if not exists public.lead_documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists lead_documents_lead_ix on public.lead_documents (lead_id);

create or replace function public.lead_documents_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from leads where id = new.lead_id for update;  -- one upload at a time per lead
  if (select count(*) from lead_documents where lead_id = new.lead_id) >= 10 then
    raise exception 'A lead can hold at most 10 documents; remove one first';
  end if;
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_at := now();
  return new;
end $$;
drop trigger if exists trg_lead_documents_limit on public.lead_documents;
create trigger trg_lead_documents_limit before insert on public.lead_documents
  for each row execute function public.lead_documents_limit();
revoke all on function public.lead_documents_limit() from public, anon, authenticated;
grant all on function public.lead_documents_limit() to service_role;

alter table public.lead_documents enable row level security;
drop policy if exists lead_documents_sel on public.lead_documents;
create policy lead_documents_sel on public.lead_documents for select to authenticated
  using (has_any_permission(array['lead.manage','lead.qualify','deal.read']));
drop policy if exists lead_documents_ins on public.lead_documents;
create policy lead_documents_ins on public.lead_documents for insert to authenticated
  with check (has_permission('lead.manage'));
drop policy if exists lead_documents_del on public.lead_documents;
create policy lead_documents_del on public.lead_documents for delete to authenticated
  using (has_permission('lead.manage'));
grant select, insert, delete on public.lead_documents to authenticated;
grant all on public.lead_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('lead-documents', 'lead-documents', false, 10485760)
on conflict (id) do nothing;
drop policy if exists lead_documents_storage_select on storage.objects;
create policy lead_documents_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'lead-documents' and has_any_permission(array['lead.manage','lead.qualify','deal.read']));
drop policy if exists lead_documents_storage_insert on storage.objects;
create policy lead_documents_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lead-documents' and has_permission('lead.manage'));
drop policy if exists lead_documents_storage_delete on storage.objects;
create policy lead_documents_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lead-documents' and has_permission('lead.manage'));

commit;
