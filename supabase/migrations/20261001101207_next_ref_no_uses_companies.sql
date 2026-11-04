create or replace function public.next_ref_no(p_year integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_value integer;
    v_prefix text;
begin
    insert into public.deal_ref_sequences (year, last_value)
    values (p_year, 0)
    on conflict (year) do nothing;

    update public.deal_ref_sequences
    set last_value = last_value + 1
    where year = p_year
    returning last_value into v_value;

    select coalesce(ref_prefix, 'MRG') into v_prefix from public.companies where is_home = true;
    v_prefix := coalesce(v_prefix, 'MRG');

    return v_prefix || '-' || p_year::text || '-' || lpad(v_value::text, 4, '0');
end;
$function$;
