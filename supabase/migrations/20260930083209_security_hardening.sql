-- 0005_security_hardening.sql
--
-- Fixes from the Supabase security advisor after migrations 1-3:
--
-- 1. next_ref_no() writes to deal_ref_sequences, which has RLS enabled with
--    no policies (default deny-all). It only "worked" in manual testing
--    because that ran as a role that bypasses RLS; a real authenticated
--    user calling it through the app would be silently blocked. Fix: make
--    it SECURITY DEFINER, same pattern as has_permission() -- nobody should
--    touch deal_ref_sequences directly anyway, so leaving it with zero
--    policies is correct once the function itself can get past RLS.
-- 2. Six functions had a mutable search_path -- a search_path hijack risk
--    if a malicious schema/function shadowing occurred. Pin search_path on
--    all of them.
-- 3. handle_new_auth_user() is only meant to run from its own trigger on
--    auth.users, not to be called directly over the API. Revoke public
--    execute on it.

alter function public.next_ref_no(integer) security definer set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.record_audit(text, text, text, text) set search_path = public;
alter function public.stage_sort_order(text) set search_path = public;
alter function public.deals_before_insert() set search_path = public;
alter function public.deals_before_update() set search_path = public;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

-- is_admin/has_permission/has_any_permission stay callable by authenticated
-- users on purpose -- the frontend uses them to decide what to show before
-- an action is attempted, not just to enforce it -- but anon has no
-- legitimate reason to call them (auth.uid() is always null pre-login, so
-- they'd just return false anyway, but no sense exposing them).
revoke execute on function public.is_admin() from anon;
revoke execute on function public.has_permission(text) from anon;
revoke execute on function public.has_any_permission(text[]) from anon;
