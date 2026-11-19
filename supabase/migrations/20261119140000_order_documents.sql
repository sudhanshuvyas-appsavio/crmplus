-- Dispatch and Billing: Documents (2026-11-19).
--  order_documents: up to 10 files per Dispatch and Billing item (monday's "Documents" column on the
--  Dispatch and Billing board and its creation form), private bucket. Additive only.

begin;

create table if not exists public.order_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists order_documents_order_ix on public.order_documents (order_id);

create or replace function public.order_documents_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from orders where id = new.order_id for update;  -- one upload at a time per item
  if (select count(*) from order_documents where order_id = new.order_id) >= 10 then
    raise exception 'An item can hold at most 10 documents; remove one first';
  end if;
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_at := now();
  return new;
end $$;
drop trigger if exists trg_order_documents_limit on public.order_documents;
create trigger trg_order_documents_limit before insert on public.order_documents
  for each row execute function public.order_documents_limit();
revoke all on function public.order_documents_limit() from public, anon, authenticated;
grant all on function public.order_documents_limit() to service_role;

alter table public.order_documents enable row level security;
drop policy if exists order_documents_sel on public.order_documents;
create policy order_documents_sel on public.order_documents for select to authenticated
  using (has_permission('order.read') or has_permission('order.manage'));
drop policy if exists order_documents_ins on public.order_documents;
create policy order_documents_ins on public.order_documents for insert to authenticated
  with check (has_permission('order.manage'));
drop policy if exists order_documents_del on public.order_documents;
create policy order_documents_del on public.order_documents for delete to authenticated
  using (has_permission('order.manage'));
grant select, insert, delete on public.order_documents to authenticated;
grant all on public.order_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('order-documents', 'order-documents', false, 10485760)
on conflict (id) do nothing;
drop policy if exists order_documents_storage_select on storage.objects;
create policy order_documents_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'order-documents' and (has_permission('order.read') or has_permission('order.manage')));
drop policy if exists order_documents_storage_insert on storage.objects;
create policy order_documents_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'order-documents' and has_permission('order.manage'));
drop policy if exists order_documents_storage_delete on storage.objects;
create policy order_documents_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'order-documents' and has_permission('order.manage'));

commit;
