-- The trigger functions added by 20261117150000 / 20261117170000 picked up
-- Supabase's default EXECUTE grants for anon and authenticated, so the
-- security advisor lists them as callable over /rest/v1/rpc. They cannot do
-- anything when called directly (Postgres refuses to run a trigger function
-- outside a trigger), but nobody needs to call them, so take the grant away
-- like 20261104085052 did for the older ones.

begin;

revoke execute on function public.crm_deals_status_guard() from public, anon, authenticated;
revoke execute on function public.crm_deals_derive() from public, anon, authenticated;
revoke execute on function public.crm_deals_rate_track() from public, anon, authenticated;
revoke execute on function public.orders_derive() from public, anon, authenticated;
revoke execute on function public.dispatch_entry_derive() from public, anon, authenticated;
revoke execute on function public.order_refresh_from_children() from public, anon, authenticated;
revoke execute on function public.order_commission_amount(uuid) from public, anon;
revoke execute on function public.create_dispatch_bill(uuid) from public, anon;

insert into supabase_migrations.schema_migrations(version, name, created_by)
values ('20261117180000', 'revoke_trigger_function_execute', 'sql-editor') on conflict do nothing;

commit;
