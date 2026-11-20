-- Qualify a lead: the Business Unit is chosen, not created.
-- Companies now require a name, email, address and bank account (companies_required_chk), and a lead carries none
-- of those, so the old "create the company from the lead" step failed for every new party. The panel now asks for
-- an existing active Business Unit. When none is sent, one that matches the lead's PAN or name is used; if there is
-- none, the lead is not qualified and the message says to add it in Master Data > Business Units first.

drop function if exists public.qualify_lead_auto(uuid, text);

create or replace function public.qualify_lead_auto(p_lead uuid, p_role text, p_company uuid default null) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  l leads%rowtype; v_role text := lower(btrim(coalesce(p_role,'')));
  v_gst text; v_pan text; v_mobile text; v_sc text; v_state text;
  v_company uuid;
  v_buyer uuid; v_supplier uuid; v_code text; v_created text[] := '{}';
  v_need_b boolean; v_need_s boolean;
begin
  if not has_permission('lead.qualify') then
    raise exception 'You need the "Qualify a lead" permission to qualify a lead.' using errcode = '42501';
  end if;
  if v_role not in ('buyer','supplier','both') then raise exception 'Select a Role: Buyer or Supplier.'; end if;
  select * into l from leads where id = p_lead for update;
  if not found then raise exception 'Lead not found'; end if;
  if l.converted_deal_id is not null then raise exception 'This lead has already been converted to a deal.'; end if;
  if v_role = 'both' and l.party_role <> 'both' then raise exception 'Select a Role: Buyer or Supplier.'; end if;
  v_need_b := v_role in ('buyer','both'); v_need_s := v_role in ('supplier','both');

  v_gst := upper(regexp_replace(coalesce(l.gst,''),'\s','','g'));
  if v_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then v_gst := null; end if;
  v_pan := case when v_gst is not null then substr(v_gst,3,10) end;
  v_sc := case when v_gst is not null then left(v_gst,2) end;
  v_mobile := regexp_replace(coalesce(l.mobile,''),'[^0-9]','','g');
  if length(v_mobile) > 10 then v_mobile := right(v_mobile,10); end if;
  if length(v_mobile) <> 10 then v_mobile := null; end if;
  v_state := case v_sc when '01' then 'Jammu and Kashmir' when '02' then 'Himachal Pradesh' when '03' then 'Punjab' when '04' then 'Chandigarh' when '05' then 'Uttarakhand' when '06' then 'Haryana' when '07' then 'Delhi' when '08' then 'Rajasthan' when '09' then 'Uttar Pradesh' when '10' then 'Bihar' when '11' then 'Sikkim' when '12' then 'Arunachal Pradesh' when '13' then 'Nagaland' when '14' then 'Manipur' when '15' then 'Mizoram' when '16' then 'Tripura' when '17' then 'Meghalaya' when '18' then 'Assam' when '19' then 'West Bengal' when '20' then 'Jharkhand' when '21' then 'Odisha' when '22' then 'Chhattisgarh' when '23' then 'Madhya Pradesh' when '24' then 'Gujarat' when '27' then 'Maharashtra' when '29' then 'Karnataka' when '30' then 'Goa' when '32' then 'Kerala' when '33' then 'Tamil Nadu' when '34' then 'Puducherry' when '36' then 'Telangana' when '37' then 'Andhra Pradesh' else null end;

  -- the Business Unit: the one chosen, else an existing one that matches the lead
  v_company := p_company;
  if v_company is null then
    select c.id into v_company from companies c
     where c.is_active and ((v_pan is not null and c.pan_number = v_pan) or lower(btrim(c.name)) = lower(btrim(l.party_name)))
     order by (c.pan_number = v_pan) desc nulls last, c.created_at limit 1;
  end if;
  if v_company is null then
    raise exception 'Choose the Business Unit for this lead. Qualify does not create one: add it in Master Data > Business Units first if it is missing.';
  end if;
  if not exists (select 1 from companies c where c.id = v_company and c.is_active) then
    raise exception 'That Business Unit is not active. Choose another.';
  end if;
  update companies c set is_buyer = c.is_buyer or v_need_b, is_supplier = c.is_supplier or v_need_s
   where c.id = v_company and ((v_need_b and not c.is_buyer) or (v_need_s and not c.is_supplier));

  if v_need_b then
    select id into v_buyer from buyer_master where (v_gst is not null and gst = v_gst) or lower(btrim(name)) = lower(btrim(l.party_name)) order by (gst = v_gst) desc nulls last limit 1;
    if v_buyer is null then
      insert into buyer_master(name, contact_person, mobile, address, gst, pan, state_code, state, company_id, created_by)
      values (btrim(l.party_name), nullif(btrim(coalesce(l.contact_person,'')),''), v_mobile, nullif(btrim(coalesce(l.office_address,'')),''), v_gst, v_pan, v_sc, v_state, v_company, auth.uid())
      returning buyer_master.id, buyer_code into v_buyer, v_code;
      v_created := array_append(v_created, 'Buyer ' || v_code);
    else
      update buyer_master set company_id = v_company where id = v_buyer and company_id is null;
    end if;
  end if;
  if v_need_s then
    select id into v_supplier from supplier_master where (v_gst is not null and gst = v_gst) or lower(btrim(name)) = lower(btrim(l.party_name)) order by (gst = v_gst) desc nulls last limit 1;
    if v_supplier is null then
      insert into supplier_master(name, contact_person, mobile, address, gst, pan, state_code, state, company_id, created_by)
      values (btrim(l.party_name), nullif(btrim(coalesce(l.contact_person,'')),''), v_mobile, nullif(btrim(coalesce(l.office_address,'')),''), v_gst, v_pan, v_sc, v_state, v_company, auth.uid())
      returning supplier_master.id, supplier_code into v_supplier, v_code;
      v_created := array_append(v_created, 'Supplier ' || v_code);
    else
      update supplier_master set company_id = v_company where id = v_supplier and company_id is null;
    end if;
  end if;

  update leads set party_role = v_role, buyer_id = v_buyer, supplier_id = v_supplier, status = 'qualified' where id = p_lead;

  return jsonb_build_object('company_id', v_company, 'buyer_id', v_buyer, 'supplier_id', v_supplier, 'created', to_jsonb(v_created),
    'incomplete', coalesce((select incomplete from buyer_master where id = v_buyer), false) or coalesce((select incomplete from supplier_master where id = v_supplier), false));
end;
$$;

revoke all on function public.qualify_lead_auto(uuid, text, uuid) from public;
grant execute on function public.qualify_lead_auto(uuid, text, uuid) to authenticated, service_role;
