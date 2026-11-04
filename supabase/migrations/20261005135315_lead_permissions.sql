
insert into public.permission_catalogue (key, label, group_name, hint, dangerous, sort_order) values
    ('lead.manage',  'Create and edit leads', 'Leads', 'Record an inquiry and keep its product and party details up to date.', false, 15),
    ('lead.qualify', 'Qualify a lead',        'Leads', 'Move a lead to Qualified once its count, quantity and party masters are in place.', false, 16)
on conflict (key) do nothing;
