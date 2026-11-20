-- The Qualify function was recreated with a new signature, which gave the anonymous role execute again.
-- The old one was closed to it (20261104085052). It checks permissions and does nothing for an anonymous caller,
-- but it should stay closed like the other definer functions.
revoke execute on function public.qualify_lead_auto(uuid, text, uuid) from anon;
