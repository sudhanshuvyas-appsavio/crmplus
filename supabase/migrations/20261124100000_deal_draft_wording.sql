-- A deal's first status is shown as "Draft" in the app (the stored value is still new_deal).
-- The approval guard's error message still said "New Deal"; reword it. The function is rewritten from its
-- live definition, so nothing else in it changes.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crm_deals_status_guard';
  if def is null then raise exception 'crm_deals_status_guard not found'; end if;
  if position('Only a New Deal or one sent to Reconsider' in def) > 0 then
    execute replace(def, 'Only a New Deal or one sent to Reconsider can go for Manager Approval',
                         'Only a Draft deal or one sent to Reconsider can go for Manager Approval');
  end if;
end $$;
