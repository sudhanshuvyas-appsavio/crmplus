-- Board snapshots: the app's own copy of the monday.com boards behind the
-- Transporter Type Details, Transport Invoice and Commission Invoices screens
-- (and the boards they link to), so those screens work with monday
-- disconnected.
--
-- A board is stored the way monday describes it -- its columns (id, title,
-- type, settings) in monday's order -- and each row as { column id ->
-- { text, ids? } }, so the screens, forms, calculations and links keep working
-- unchanged. The rows are copied from monday once (the monday-ttd function's
-- "snapshot" action); after that the app reads and writes only these tables.
-- Rows created in the app get ids "app-<n>" so they can never collide with a
-- monday item id.
--
-- Access follows the order screens: order.read / order.manage to see,
-- order.manage to write.

create table if not exists public.board_snapshots (
    board_id   text primary key,
    board_key  text unique,
    name       text not null,
    columns    jsonb not null default '[]'::jsonb,
    synced_at  timestamptz not null default now()
);

create table if not exists public.board_items (
    board_id   text not null references public.board_snapshots (board_id) on delete cascade,
    item_id    text not null,
    name       text not null default '',
    created_at timestamptz not null default now(),
    "values"   jsonb not null default '{}'::jsonb,
    created_by uuid references public.profiles (id) default auth.uid(),
    updated_at timestamptz not null default now(),
    primary key (board_id, item_id)
);

create index if not exists ix_board_items_board on public.board_items (board_id, created_at);

create sequence if not exists public.board_item_seq;

alter table public.board_snapshots enable row level security;
alter table public.board_items enable row level security;

drop policy if exists bs_sel on public.board_snapshots;
create policy bs_sel on public.board_snapshots for select to authenticated
    using (public.has_permission('order.read') or public.has_permission('order.manage'));
drop policy if exists bs_ins on public.board_snapshots;
create policy bs_ins on public.board_snapshots for insert to authenticated
    with check (public.has_permission('order.manage'));
drop policy if exists bs_upd on public.board_snapshots;
create policy bs_upd on public.board_snapshots for update to authenticated
    using (public.has_permission('order.manage')) with check (public.has_permission('order.manage'));

drop policy if exists bi_sel on public.board_items;
create policy bi_sel on public.board_items for select to authenticated
    using (public.has_permission('order.read') or public.has_permission('order.manage'));
drop policy if exists bi_ins on public.board_items;
create policy bi_ins on public.board_items for insert to authenticated
    with check (public.has_permission('order.manage'));
drop policy if exists bi_upd on public.board_items;
create policy bi_upd on public.board_items for update to authenticated
    using (public.has_permission('order.manage')) with check (public.has_permission('order.manage'));
drop policy if exists bi_del on public.board_items;
create policy bi_del on public.board_items for delete to authenticated
    using (public.has_permission('order.manage'));

grant select, insert, update on public.board_snapshots to authenticated;
grant select, insert, update, delete on public.board_items to authenticated;

-- next id for a row created in the app
create or replace function public.next_board_item_id() returns text
    language sql volatile security definer
    set search_path to 'public'
    as $$ select 'app-' || nextval('public.board_item_seq')::text $$;

revoke execute on function public.next_board_item_id() from public, anon;
grant execute on function public.next_board_item_id() to authenticated;

-- files on these boards (Documents, freight invoice PDFs): a private bucket,
-- path "<board_id>/<item_id>/<file name>"
insert into storage.buckets (id, name, public, file_size_limit)
values ('board-files', 'board-files', false, 10485760)
on conflict (id) do nothing;

drop policy if exists board_files_select on storage.objects;
create policy board_files_select on storage.objects for select to authenticated
    using (bucket_id = 'board-files' and (public.has_permission('order.read') or public.has_permission('order.manage')));
drop policy if exists board_files_insert on storage.objects;
create policy board_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'board-files' and public.has_permission('order.manage'));
