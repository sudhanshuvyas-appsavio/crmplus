-- 0004_documents_storage.sql
--
-- Document attachments on a deal (B/L, invoice, packing list, buyer PO, ...).
-- Nothing in the FastAPI version built this yet -- the document.read /
-- document.upload / document.delete permissions existed in the catalogue but
-- had no table or router behind them (the origination phase stopped short of
-- attachments). This migration is new work, not a port, designed to fit the
-- same three permissions.
--
-- Files themselves live in Supabase Storage, a private bucket -- this table
-- is just the metadata (which deal, what kind, who uploaded it, the storage
-- path). Storage's own access rules are policies on storage.objects, written
-- the same way as every other RLS policy in this project: calling the
-- has_permission() family from migration 1.

create table if not exists public.deal_documents (
    id          uuid primary key default gen_random_uuid(),
    deal_id     uuid not null references public.deals (id) on delete cascade,
    kind        text not null check (kind in (
                    'bl', 'invoice', 'packing_list', 'cert_origin', 'qc_report',
                    'po', 'lc', 'remittance', 'other'
                )),
    file_name   text not null,
    storage_path text not null unique,
    size_bytes  bigint,
    content_type text,
    uploaded_by uuid references public.profiles (id),
    uploaded_at timestamptz not null default now()
);

create index if not exists ix_deal_documents_deal_id on public.deal_documents (deal_id);

alter table public.deal_documents enable row level security;

drop policy if exists deal_documents_select on public.deal_documents;
create policy deal_documents_select on public.deal_documents
    for select to authenticated
    using (public.has_permission('document.read'));

drop policy if exists deal_documents_insert on public.deal_documents;
create policy deal_documents_insert on public.deal_documents
    for insert to authenticated
    with check (public.has_permission('document.upload') and uploaded_by = auth.uid());

drop policy if exists deal_documents_delete on public.deal_documents;
create policy deal_documents_delete on public.deal_documents
    for delete to authenticated
    using (public.has_permission('document.delete'));

insert into storage.buckets (id, name, public, file_size_limit)
values ('deal-documents', 'deal-documents', false, 52428800)
on conflict (id) do nothing;

drop policy if exists deal_documents_storage_select on storage.objects;
create policy deal_documents_storage_select on storage.objects
    for select to authenticated
    using (bucket_id = 'deal-documents' and public.has_permission('document.read'));

drop policy if exists deal_documents_storage_insert on storage.objects;
create policy deal_documents_storage_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'deal-documents' and public.has_permission('document.upload'));

drop policy if exists deal_documents_storage_delete on storage.objects;
create policy deal_documents_storage_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'deal-documents' and public.has_permission('document.delete'));

create or replace function public.deal_documents_after_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    perform public.record_audit('document', 'Attached document', new.deal_id::text, new.file_name);
    return new;
end;
$$;

drop trigger if exists trg_deal_documents_after_insert on public.deal_documents;
create trigger trg_deal_documents_after_insert
    after insert on public.deal_documents
    for each row execute function public.deal_documents_after_insert();

create or replace function public.deal_documents_after_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    perform public.record_audit('document', 'Removed document', old.deal_id::text, old.file_name);
    return old;
end;
$$;

drop trigger if exists trg_deal_documents_after_delete on public.deal_documents;
create trigger trg_deal_documents_after_delete
    after delete on public.deal_documents
    for each row execute function public.deal_documents_after_delete();
