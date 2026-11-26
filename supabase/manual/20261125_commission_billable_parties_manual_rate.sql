-- Commission Invoices: the party list honours the manual commission rate.
-- Run once in the Supabase SQL editor AFTER 20261125170000_commission_invoice_register.sql.
-- Safe to re-run.

drop function if exists public.commission_billable_parties(uuid, text);

create or replace function public.commission_billable_parties(p_company uuid, p_party_type text, p_basis text default null, p_value numeric default null)
returns table(party_id uuid, party_name text, lines bigint, first_date date, last_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_permission('order.read') or has_permission('order.manage')) then raise exception 'You need permission to view orders'; end if;
  return query
  select c.party_id, c.party_name, count(*), min(c.invoice_date), max(c.invoice_date)
  from commission_candidate_lines(p_company, p_party_type, null, date '2000-01-01', date '2100-12-31', p_basis, p_value) c
  group by c.party_id, c.party_name
  order by c.party_name;
end $$;

revoke all on function public.commission_billable_parties(uuid, text, text, numeric) from public, anon;
grant execute on function public.commission_billable_parties(uuid, text, text, numeric) to authenticated;

notify pgrst, 'reload schema';
