-- SECURITY DEFINER functions in public were executable by everyone because
-- Postgres grants EXECUTE to PUBLIC on creation. Revoking from anon alone
-- (as 20260930083209_security_hardening tried) has no effect while the
-- PUBLIC grant remains, so the advisor kept flagging 30 of them as callable
-- without signing in -- including next_ref_no and order_try_close, which
-- write without checking the caller.

-- A. RPCs the app calls only after sign-in: signed-in users keep EXECUTE.
revoke execute on function public.activity_can(text, boolean) from public, anon;
revoke execute on function public.party_doc_can(text, boolean) from public, anon;
revoke execute on function public.confirm_deal(uuid) from public, anon;
revoke execute on function public.convert_lead_to_deal(uuid) from public, anon;
revoke execute on function public.create_order(uuid) from public, anon;
revoke execute on function public.deal_confirm_problems(uuid) from public, anon;
revoke execute on function public.find_or_create_company_for_lead(text, text, text, text, text, boolean, boolean) from public, anon;
revoke execute on function public.generate_commission_invoice(uuid) from public, anon;
revoke execute on function public.next_ref_no(integer) from public, anon;
revoke execute on function public.order_close_status(uuid) from public, anon;
revoke execute on function public.order_try_close(uuid) from public, anon;
revoke execute on function public.qualify_lead_auto(uuid, text) from public, anon;

grant execute on function public.activity_can(text, boolean) to authenticated;
grant execute on function public.party_doc_can(text, boolean) to authenticated;
grant execute on function public.confirm_deal(uuid) to authenticated;
grant execute on function public.convert_lead_to_deal(uuid) to authenticated;
grant execute on function public.create_order(uuid) to authenticated;
grant execute on function public.deal_confirm_problems(uuid) to authenticated;
grant execute on function public.find_or_create_company_for_lead(text, text, text, text, text, boolean, boolean) to authenticated;
grant execute on function public.generate_commission_invoice(uuid) to authenticated;
grant execute on function public.next_ref_no(integer) to authenticated;
grant execute on function public.order_close_status(uuid) to authenticated;
grant execute on function public.order_try_close(uuid) to authenticated;
grant execute on function public.qualify_lead_auto(uuid, text) to authenticated;

-- B. Trigger functions: nobody calls these directly. EXECUTE is checked when
-- a trigger is created, not each time it fires, so the triggers keep working.
revoke execute on function public.cheque_collection_guard() from public, anon, authenticated;
revoke execute on function public.collection_task_guard() from public, anon, authenticated;
revoke execute on function public.commission_invoice_guard() from public, anon, authenticated;
revoke execute on function public.crm_deals_approve_guard() from public, anon, authenticated;
revoke execute on function public.crm_deals_derive() from public, anon, authenticated;
revoke execute on function public.crm_deals_rate_track() from public, anon, authenticated;
revoke execute on function public.crm_deals_supplier_lock() from public, anon, authenticated;
revoke execute on function public.crm_deals_unconvert() from public, anon, authenticated;
revoke execute on function public.dispatch_entry_stamp() from public, anon, authenticated;
revoke execute on function public.order_close_check() from public, anon, authenticated;
revoke execute on function public.order_exec_guard() from public, anon, authenticated;
revoke execute on function public.order_trip_guard() from public, anon, authenticated;
revoke execute on function public.orders_guard() from public, anon, authenticated;
revoke execute on function public.sc_derive() from public, anon, authenticated;
revoke execute on function public.scn_guard() from public, anon, authenticated;

-- C. has_permission / has_any_permission / is_admin stay executable by anon
-- on purpose: RLS policies granted to PUBLIC (e.g. companies_write, which
-- also covers SELECT and is evaluated when the login page reads branding)
-- call them, and revoking would turn those reads into permission errors.
-- They key off auth.uid(), so for a signed-out caller they return false.
